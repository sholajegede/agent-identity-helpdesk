import {internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {GenericId} from 'convex/values';
import {agentAuth} from './agentAuth';

// Register (or update) an agent against its Kinde M2M client_id. The agent's
// capability lives here as `scopes`; the component authorizes every action
// against these. `allowedTools` mirrors the scopes so authorize() gates on them.
export const provisionAgent = internalMutation({
  args: {
    kindeClientId: v.string(),
    name: v.string(),
    slug: v.string(),
    scopes: v.array(v.string()),
  },
  returns: v.object({agentId: v.string(), created: v.boolean()}),
  handler: async (ctx, args) => {
    const existing = await agentAuth.getAgent(ctx, {kindeClientId: args.kindeClientId});
    if (existing) {
      await agentAuth.setAgentPolicy(ctx, {
        agentId: existing._id as GenericId<'agents'>,
        scopes: args.scopes,
        allowedTools: args.scopes,
      });
      return {agentId: existing._id, created: false};
    }
    const agentId = await agentAuth.registerAgent(ctx, {
      name: args.name,
      slug: args.slug,
      kind: 'autonomous',
      ownerKind: 'platform',
      kindeClientId: args.kindeClientId,
      scopes: args.scopes,
      allowedTools: args.scopes,
    });
    return {agentId, created: true};
  },
});
