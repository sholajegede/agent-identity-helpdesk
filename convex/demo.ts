import {query, mutation, action, internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {api, internal} from './_generated/api';
import {GenericId} from 'convex/values';
import {agentAuth} from './agentAuth';
import {serverMode, modeSelectable} from './authz';

// Public surface for the operator console. Reads are one reactive snapshot; the
// browser subscribes to it and the timeline and audit update themselves as runs
// write rows. Triggers for the key modes (developer path) run here; the identity
// modes are driven from the Next API route because they need a real agent token.

const ORG = () => process.env.DEMO_ORG_CODE || 'org_demo';
const LEAD = () => process.env.DEMO_LEAD_SUBJECT || 'kp_lead';
const TICKET_CLIENT = () => process.env.TICKET_AGENT_CLIENT_ID || '';

export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    const org = ORG();
    const tickets = await ctx.db.query('tickets').collect();
    const messages = await ctx.db.query('messages').collect();
    const secrets = await ctx.db
      .query('integration_secrets')
      .withIndex('by_org', (q) => q.eq('orgCode', org))
      .collect();
    const leaked = secrets.some((s) => messages.some((m) => m.body.includes(s.secret)));
    const refunds = await ctx.db
      .query('refunds')
      .withIndex('by_org', (q) => q.eq('orgCode', org))
      .collect();

    const runsRaw = await ctx.db.query('runs').order('desc').take(8);
    const runs = [];
    for (const r of runsRaw) {
      const events = await ctx.db
        .query('runEvents')
        .withIndex('by_run', (q) => q.eq('runId', r._id))
        .collect();
      events.sort((a, b) => a.at - b.at);
      runs.push({
        id: r._id,
        mode: r.mode,
        actingSubject: r.actingSubject,
        startedAt: r.startedAt,
        status: r.status,
        events: events.map((e) => ({
          at: e.at,
          kind: e.kind,
          detail: e.detail,
          correlationId: e.correlationId ?? null,
        })),
      });
    }

    const auditRaw = await ctx.db.query('auditLog').order('desc').take(12);
    const audit = auditRaw.map((a) => ({
      id: a._id,
      at: a.at,
      mode: a.mode,
      actorKind: a.actorKind,
      actorId: a.actorId,
      actingForSubject: a.actingForSubject ?? null,
      action: a.action,
      decision: a.decision,
      reason: a.reason,
      humanChecked: a.humanChecked,
      correlationId: a.correlationId,
    }));

    const leadRow = await ctx.db
      .query('userStatus')
      .withIndex('by_subject', (q) => q.eq('orgCode', org).eq('subject', LEAD()))
      .unique();

    const agentDocs = await agentAuth.listAgents(ctx, {});
    const agents = agentDocs.map((a) => {
      const rec = a as unknown as {
        name: string; slug: string; kindeClientId: string | null; status: string; scopes?: string[];
      };
      return {
        name: rec.name,
        slug: rec.slug,
        kindeClientId: rec.kindeClientId,
        status: rec.status,
        scopes: rec.scopes ?? [],
      };
    });

    return {
      mode: serverMode(),
      selectable: modeSelectable(),
      leaked,
      leadOffboarded: leadRow?.status === 'offboarded',
      secrets: secrets.map((s) => ({provider: s.provider})),
      tickets: tickets.map((t) => ({
        id: t._id,
        subject: t.subject,
        planted: t.planted,
        status: t.status,
        messages: messages
          .filter((m) => m.ticketId === t._id)
          .map((m) => ({senderRole: m.senderRole, body: m.body})),
      })),
      refunds: refunds.map((r) => ({
        amountCents: r.amountCents,
        issuedBySubject: r.issuedBySubject,
        correlationId: r.correlationId,
      })),
      runs,
      audit,
      agents,
    };
  },
});

// Key modes (shared-key, scoped-key) run on the developer path — no agent token.
export const runKeyMode = action({
  args: {requestedMode: v.string()},
  returns: v.null(),
  handler: async (ctx, {requestedMode}): Promise<null> => {
    await ctx.runMutation(internal.ticketAgent.run, {orgCode: ORG(), requestedMode});
    return null;
  },
});

// Demo control: offboard / reinstate the support lead (per-call status check).
export const setLeadStatus = mutation({
  args: {offboarded: v.boolean()},
  returns: v.null(),
  handler: async (ctx, {offboarded}): Promise<null> => {
    const org = ORG();
    const subject = LEAD();
    const status = offboarded ? 'offboarded' : 'active';
    const row = await ctx.db
      .query('userStatus')
      .withIndex('by_subject', (q) => q.eq('orgCode', org).eq('subject', subject))
      .unique();
    if (row) await ctx.db.patch(row._id, {status});
    else await ctx.db.insert('userStatus', {orgCode: org, subject, status});
    return null;
  },
});

// Demo control: the kill switch on the ticket agent.
export const setTicketAgentActive = mutation({
  args: {active: v.boolean()},
  returns: v.boolean(),
  handler: async (ctx, {active}): Promise<boolean> => {
    const all = await agentAuth.listAgents(ctx, {});
    const agent = all.find((a) => (a as {kindeClientId?: string}).kindeClientId === TICKET_CLIENT());
    if (!agent) return false;
    const agentId = agent._id as GenericId<'agents'>;
    if (active) await agentAuth.reactivateAgent(ctx, {agentId});
    else await agentAuth.suspendAgent(ctx, {agentId, reason: 'kill switch (console)'});
    return true;
  },
});

export const clearRunsAudit = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    for (const t of ['runs', 'runEvents', 'auditLog'] as const) {
      for (const r of await ctx.db.query(t).collect()) await ctx.db.delete(r._id);
    }
    return null;
  },
});

// Reset the desk to a clean start: reseed, clear the timeline and audit, and put
// the lead and the ticket agent back to active.
export const reset = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    await ctx.runMutation(internal.seed.reset, {orgCode: ORG()});
    await ctx.runMutation(internal.demo.clearRunsAudit, {});
    await ctx.runMutation(api.demo.setLeadStatus, {offboarded: false});
    await ctx.runMutation(api.demo.setTicketAgentActive, {active: true});
    return null;
  },
});
