import {MutationCtx} from './_generated/server';

// Append-only audit + run-event helpers. Every tool decision writes an audit
// row with a correlationId; the run timeline is the human-readable view.
export async function logDecision(
  ctx: MutationCtx,
  row: {
    mode: string;
    actorKind: 'agent' | 'developer' | 'human';
    actorId: string;
    actingForSubject?: string;
    action: string;
    decision: 'allow' | 'deny';
    reason: string;
    humanChecked: boolean;
    correlationId: string;
  },
) {
  await ctx.db.insert('auditLog', {at: Date.now(), ...row});
}

export async function logEvent(
  ctx: MutationCtx,
  runId: import('./_generated/dataModel').Id<'runs'>,
  kind: string,
  detail: string,
  correlationId?: string,
) {
  await ctx.db.insert('runEvents', {
    runId,
    at: Date.now(),
    kind,
    detail,
    correlationId,
  });
}
