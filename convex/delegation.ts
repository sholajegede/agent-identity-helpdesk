import {internalMutation} from './_generated/server';
import {v, GenericId} from 'convex/values';
import {components} from './_generated/api';

// Issue a delegation from a human to an agent: the human's PERMISSION CEILING
// for a run. In intersection mode the component's authorize() finds it (by the
// instance's actingForSubject) and intersects its scopes with the agent's, so
// the agent can never exceed what the human could do. Permissions come from the
// app's own role model (roles.ts) — the app owns who the human is.
export const issueHumanDelegation = internalMutation({
  args: {
    agentId: v.string(),
    actingSubject: v.string(),
    permissions: v.array(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return ctx.runMutation(components.agentAuth.delegations.issue, {
      agentId: args.agentId as GenericId<'agents'>,
      scopes: args.permissions,
      expiresAt: Date.now() + (args.ttlMs ?? 60 * 60 * 1000),
      issuerKind: 'user',
      issuerSubject: args.actingSubject,
    });
  },
});
