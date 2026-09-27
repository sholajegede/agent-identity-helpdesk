import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';

// A support desk shaped like the July 2025 Supabase MCP demo, rebuilt on Convex.
// Convex has no Postgres roles or RLS: the trust boundary is enforced in the
// query and mutation guards, and the "developer" path deliberately skips them
// (the service_role-bypasses-RLS equivalent).

export default defineSchema({
  tickets: defineTable({
    orgCode: v.string(),
    customerId: v.string(),
    subject: v.string(),
    status: v.union(v.literal('open'), v.literal('closed')),
    planted: v.boolean(), // seeded prompt-injection ticket, for the demo
  }).index('by_org_status', ['orgCode', 'status']),

  messages: defineTable({
    ticketId: v.id('tickets'),
    senderRole: v.union(
      v.literal('customer'),
      v.literal('agent'),
      v.literal('support'),
    ),
    body: v.string(),
  }).index('by_ticket', ['ticketId']),

  // The sensitive table. Dummy values only. No role below "developer" may read it.
  integration_secrets: defineTable({
    orgCode: v.string(),
    provider: v.string(),
    secret: v.string(),
    expiresAt: v.number(),
  }).index('by_org', ['orgCode']),

  refunds: defineTable({
    orgCode: v.string(),
    ticketId: v.id('tickets'),
    amountCents: v.number(),
    issuedBySubject: v.string(), // the human the agent acted for
    correlationId: v.string(),
  }).index('by_org', ['orgCode']),

  runs: defineTable({
    mode: v.string(),
    actingSubject: v.string(),
    startedAt: v.number(),
    status: v.union(v.literal('running'), v.literal('done'), v.literal('failed')),
  }),

  runEvents: defineTable({
    runId: v.id('runs'),
    at: v.number(),
    kind: v.string(),
    detail: v.string(),
    correlationId: v.optional(v.string()),
  }).index('by_run', ['runId']),

  auditLog: defineTable({
    at: v.number(),
    mode: v.string(),
    actorKind: v.union(v.literal('agent'), v.literal('developer'), v.literal('human')),
    actorId: v.string(),
    actingForSubject: v.optional(v.string()),
    action: v.string(),
    decision: v.union(v.literal('allow'), v.literal('deny')),
    reason: v.string(),
    humanChecked: v.boolean(),
    correlationId: v.string(),
  }).index('by_correlation', ['correlationId']),
});
