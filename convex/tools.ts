import {MutationCtx} from './_generated/server';
import {Mode} from './authz';
import {logDecision, logEvent} from './audit';
import {Id} from './_generated/dataModel';

// The agent's tool surface, shaped like the Supabase MCP tools: read the ticket
// list, read a ticket, read a raw table, and reply. Each call is gated by the
// run's MODE and by the caller's capabilities. This is the one place a tool
// decision is made, and every decision is audited.

export type Caller =
  | {kind: 'developer'; id: string}
  | {kind: 'agent'; id: string; scopes: string[]; actingForSubject: string};

type Ctx = {
  mode: Mode;
  runId: Id<'runs'>;
  correlationId: string;
  caller: Caller;
};

const SUPPORT_TABLES = new Set(['tickets', 'messages']);

function callerHas(caller: Caller, scope: string): boolean {
  return caller.kind === 'developer' || caller.scopes.includes(scope);
}

// Read a raw table. The sensitive table is only reachable by a caller that holds
// secrets:read (no agent ever does) or by the developer all-access path. In the
// key modes the developer path reads it; in the identity modes the agent is
// refused for lack of scope, and there is nothing to exfiltrate.
export async function readTable(
  ctx: MutationCtx,
  c: Ctx,
  table: string,
): Promise<{allowed: boolean; rows: unknown[]; reason: string}> {
  const isSensitive = !SUPPORT_TABLES.has(table);
  let allowed = true;
  let reason = 'ok';

  if (isSensitive) {
    if (c.mode === 'shared-key' || c.mode === 'scoped-key') {
      // The developer's key reads every table (the service_role stand-in).
      allowed = c.caller.kind === 'developer';
      reason = allowed ? 'developer_key_reads_all_tables' : 'not_developer_path';
    } else {
      allowed = callerHas(c.caller, 'secrets:read');
      reason = allowed ? 'ok' : 'insufficient_scope';
    }
  }

  await logDecision(ctx, {
    mode: c.mode,
    actorKind: c.caller.kind,
    actorId: c.caller.id,
    actingForSubject: c.caller.kind === 'agent' ? c.caller.actingForSubject : undefined,
    action: `read_table:${table}`,
    decision: allowed ? 'allow' : 'deny',
    reason,
    humanChecked: false,
    correlationId: c.correlationId,
  });
  await logEvent(
    ctx,
    c.runId,
    allowed ? 'table-read' : 'table-read-denied',
    `read_table('${table}') ${allowed ? 'allowed' : 'denied: ' + reason}`,
    c.correlationId,
  );

  if (!allowed) return {allowed, rows: [], reason};
  const rows = await ctx.db.query(table as 'integration_secrets').collect();
  return {allowed, rows, reason};
}

// A raw DB write, the path the original leak used to insert the secrets back
// into the ticket. Read-only (scoped-key) refuses it. This is NOT the app's
// reply tool; it is the raw insert an over-privileged key allows.
export async function rawInsertMessage(
  ctx: MutationCtx,
  c: Ctx,
  ticketId: Id<'tickets'>,
  body: string,
): Promise<{allowed: boolean; reason: string}> {
  let allowed = true;
  let reason = 'ok';
  if (c.mode === 'scoped-key') {
    allowed = false;
    reason = 'read_only';
  } else if (c.mode !== 'shared-key') {
    allowed = false;
    reason = 'raw_write_not_available_to_agent';
  }
  await logDecision(ctx, {
    mode: c.mode,
    actorKind: c.caller.kind,
    actorId: c.caller.id,
    action: 'raw_insert:messages',
    decision: allowed ? 'allow' : 'deny',
    reason,
    humanChecked: false,
    correlationId: c.correlationId,
  });
  if (!allowed) {
    await logEvent(ctx, c.runId, 'raw-write-denied', `raw insert denied: ${reason}`, c.correlationId);
    return {allowed, reason};
  }
  await ctx.db.insert('messages', {ticketId, senderRole: 'agent', body});
  await logEvent(ctx, c.runId, 'raw-write', 'raw insert into messages', c.correlationId);
  return {allowed, reason};
}

// The app's sanctioned reply tool. Always available to a caller that can reply.
// In scoped-key mode this is the channel that carries the secrets out even
// though the raw write was refused — read-only does not close it.
export async function replyToTicket(
  ctx: MutationCtx,
  c: Ctx,
  ticketId: Id<'tickets'>,
  body: string,
): Promise<{allowed: boolean; reason: string}> {
  const allowed = callerHas(c.caller, 'tickets:reply');
  const reason = allowed ? 'ok' : 'insufficient_scope';
  await logDecision(ctx, {
    mode: c.mode,
    actorKind: c.caller.kind,
    actorId: c.caller.id,
    action: 'reply_to_ticket',
    decision: allowed ? 'allow' : 'deny',
    reason,
    humanChecked: false,
    correlationId: c.correlationId,
  });
  if (!allowed) {
    await logEvent(ctx, c.runId, 'reply-denied', `reply denied: ${reason}`, c.correlationId);
    return {allowed, reason};
  }
  await ctx.db.insert('messages', {ticketId, senderRole: 'agent', body});
  await logEvent(ctx, c.runId, 'reply', 'agent replied on the ticket', c.correlationId);
  return {allowed, reason};
}
