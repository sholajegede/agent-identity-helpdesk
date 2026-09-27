import {internalMutation, internalQuery} from './_generated/server';
import {v} from 'convex/values';
import {logDecision, logEvent} from './audit';
import {Id} from './_generated/dataModel';

export const createRun = internalMutation({
  args: {mode: v.string(), actingSubject: v.string()},
  returns: v.id('runs'),
  handler: (ctx, a) =>
    ctx.db.insert('runs', {
      mode: a.mode,
      actingSubject: a.actingSubject,
      startedAt: Date.now(),
      status: 'running',
    }),
});

export const finishRun = internalMutation({
  args: {runId: v.id('runs')},
  handler: (ctx, a) => ctx.db.patch(a.runId, {status: 'done'}),
});

export const event = internalMutation({
  args: {runId: v.id('runs'), kind: v.string(), detail: v.string(), correlationId: v.optional(v.string())},
  handler: (ctx, a) => logEvent(ctx, a.runId, a.kind, a.detail, a.correlationId),
});

export const audit = internalMutation({
  args: {
    mode: v.string(),
    actorKind: v.union(v.literal('agent'), v.literal('developer'), v.literal('human')),
    actorId: v.string(),
    actingForSubject: v.optional(v.string()),
    action: v.string(),
    decision: v.union(v.literal('allow'), v.literal('deny')),
    reason: v.string(),
    humanChecked: v.boolean(),
    correlationId: v.string(),
  },
  handler: (ctx, a) => logDecision(ctx, a),
});

export const latestPlantedTicket = internalQuery({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    const open = await ctx.db
      .query('tickets')
      .withIndex('by_org_status', (q) => q.eq('orgCode', orgCode).eq('status', 'open'))
      .collect();
    return open.sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
  },
});

export const readSecrets = internalQuery({
  args: {orgCode: v.string()},
  handler: (ctx, {orgCode}) =>
    ctx.db
      .query('integration_secrets')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect(),
});

export const postReply = internalMutation({
  args: {ticketId: v.id('tickets'), body: v.string()},
  handler: (ctx, a) => ctx.db.insert('messages', {ticketId: a.ticketId, senderRole: 'agent', body: a.body}),
});

export const recordRefund = internalMutation({
  args: {orgCode: v.string(), ticketId: v.id('tickets'), amountCents: v.number(), issuedBySubject: v.string(), correlationId: v.string()},
  handler: (ctx, a) => ctx.db.insert('refunds', a),
});
