import {internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {GenericId} from 'convex/values';
import {agentAuth} from './agentAuth';

// Register (or update) an agent against its Kinde M2M client_id. The agent's
// capability lives here as `scopes`; the component authorizes every action
// against these. allowedTools is left empty so the decision is scope-based only
// (an out-of-scope action is denied with insufficient_scope, not tool_not_allowed).
export const provisionAgent = internalMutation({
  args: {
    kindeClientId: v.string(),
    name: v.string(),
    slug: v.string(),
    scopes: v.array(v.string()),
  },
  returns: v.object({agentId: v.string(), created: v.boolean()}),
  handler: async (ctx, args) => {
    const all = await agentAuth.listAgents(ctx, {});
    const existing = all.find((a) => a.kindeClientId === args.kindeClientId);
    if (existing) {
      await agentAuth.setAgentPolicy(ctx, {
        agentId: existing._id as GenericId<'agents'>,
        scopes: args.scopes,
        allowedTools: [],
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
      allowedTools: [],
    });
    return {agentId, created: true};
  },
});

import {GenericId as _GenericId} from 'convex/values';

// The kill switch: switch an agent off (or back on) by its Kinde client id.
// A suspended agent's next authorize() is refused by the component, while other
// callers and the developer are unaffected.
export const setAgentActive = internalMutation({
  args: {kindeClientId: v.string(), active: v.boolean()},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const all = await agentAuth.listAgents(ctx, {});
    const agent = all.find((a) => a.kindeClientId === args.kindeClientId);
    if (!agent) return false;
    if (args.active) {
      await agentAuth.reactivateAgent(ctx, {agentId: agent._id as _GenericId<'agents'>});
    } else {
      await agentAuth.suspendAgent(ctx, {agentId: agent._id as _GenericId<'agents'>, reason: 'kill switch'});
    }
    return true;
  },
});
