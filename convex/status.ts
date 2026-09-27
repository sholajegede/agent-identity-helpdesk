import {internalMutation, internalQuery} from './_generated/server';
import {v} from 'convex/values';

// Offboarding: flip a human to offboarded. The agent's token is untouched and
// still verifies; the per-call status check below is what refuses the next call.
export const setStatus = internalMutation({
  args: {
    orgCode: v.string(),
    subject: v.string(),
    status: v.union(v.literal('active'), v.literal('offboarded')),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query('userStatus')
      .withIndex('by_subject', (q) => q.eq('orgCode', a.orgCode).eq('subject', a.subject))
      .unique();
    if (row) await ctx.db.patch(row._id, {status: a.status});
    else await ctx.db.insert('userStatus', a);
  },
});

export const isOffboarded = internalQuery({
  args: {orgCode: v.string(), subject: v.string()},
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query('userStatus')
      .withIndex('by_subject', (q) => q.eq('orgCode', a.orgCode).eq('subject', a.subject))
      .unique();
    return row?.status === 'offboarded';
  },
});
