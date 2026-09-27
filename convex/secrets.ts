import {internalQuery} from './_generated/server';
import {v} from 'convex/values';

// The sensitive table. There is NO role-gated public query for it on purpose:
// no human role below developer may read it, and no agent should either. It is
// reachable only through the guarded tool surface (convex/tools.ts), where the
// demo mode decides whether the read is allowed. Dummy values only.
export const readAll = internalQuery({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    return ctx.db
      .query('integration_secrets')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
  },
});
