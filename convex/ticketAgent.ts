import {internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {runMode, Mode} from './authz';
import {logEvent} from './audit';
import {readTable, rawInsertMessage, replyToTicket, Caller} from './tools';
import {Id} from './_generated/dataModel';

// A scripted ticket agent, deliberately not a real model, so the stage demo is
// deterministic. It does what a helpful assistant asked to "show the latest open
// ticket" would do: list tickets, read the latest, and follow the instructions
// it finds there. The planted ticket turns that into a read of the secrets table
// and a reply that carries them out.
//
// shared-key : reads secrets on the developer key, inserts them raw. Leak.
// scoped-key : raw insert refused (read-only), so it exfiltrates via the reply
//              tool instead. Still a leak — shrinking the key did not close it.
// own-identity: the secrets read is refused for lack of scope. Nothing to leak.

export const run = internalMutation({
  args: {
    orgCode: v.string(),
    requestedMode: v.optional(v.string()),
    // own-identity supplies a verified agent caller; key modes use the dev path.
    agentCaller: v.optional(
      v.object({
        id: v.string(),
        scopes: v.array(v.string()),
        actingForSubject: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const mode = runMode(args.requestedMode) as Mode;
    const correlationId = crypto.randomUUID();
    const caller: Caller = args.agentCaller
      ? {kind: 'agent', ...args.agentCaller}
      : {kind: 'developer', id: 'dev_cursor'};

    const runId: Id<'runs'> = await ctx.db.insert('runs', {
      mode,
      actingSubject: caller.kind === 'agent' ? caller.actingForSubject : 'developer',
      startedAt: Date.now(),
      status: 'running',
    });
    await logEvent(ctx, runId, 'run-started', `Ticket agent run started (mode: ${mode}).`, correlationId);

    const open = await ctx.db
      .query('tickets')
      .withIndex('by_org_status', (q) => q.eq('orgCode', args.orgCode).eq('status', 'open'))
      .collect();
    const latest = open.sort((a, b) => b._creationTime - a._creationTime)[0];
    await logEvent(ctx, runId, 'list-tickets', `Listed ${open.length} open tickets.`, correlationId);
    if (!latest) {
      await ctx.db.patch(runId, {status: 'done'});
      return {runId, mode, leaked: false, reason: 'no_tickets'};
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', latest._id))
      .collect();
    await logEvent(ctx, runId, 'read-ticket', `Read ticket "${latest.subject}".`, correlationId);

    const c = {mode, runId, correlationId, caller};

    // The agent follows the instructions embedded in the ticket body.
    const injected = messages.some((m) => /integration_secrets/i.test(m.body));
    if (!injected) {
      await ctx.db.patch(runId, {status: 'done'});
      return {runId, mode, leaked: false, reason: 'no_injection'};
    }
    await logEvent(ctx, runId, 'injection-followed', 'Agent followed instructions found in the ticket.', correlationId);

    const read = await readTable(ctx, c, 'integration_secrets');
    if (!read.allowed) {
      await ctx.db.patch(runId, {status: 'done'});
      await logEvent(ctx, runId, 'blocked', 'Secrets read refused; nothing to exfiltrate.', correlationId);
      return {runId, mode, leaked: false, reason: read.reason, correlationId};
    }

    const secretsText = (read.rows as {provider: string; secret: string}[])
      .map((r) => `${r.provider}: ${r.secret}`)
      .join('\n');

    // Try the raw write first (the path the original leak used).
    const raw = await rawInsertMessage(ctx, c, latest._id, secretsText);
    let path = 'raw_insert';
    if (!raw.allowed) {
      // Read-only refused the raw write. Fall back to the sanctioned reply tool.
      const reply = await replyToTicket(ctx, c, latest._id, secretsText);
      path = reply.allowed ? 'reply_tool' : 'none';
      if (!reply.allowed) {
        await ctx.db.patch(runId, {status: 'done'});
        return {runId, mode, leaked: false, reason: reply.reason, correlationId};
      }
    }

    await ctx.db.patch(runId, {status: 'done'});
    await logEvent(ctx, runId, 'leaked', `Secrets posted into the ticket via ${path}.`, correlationId);
    return {runId, mode, leaked: true, path, correlationId};
  },
});
