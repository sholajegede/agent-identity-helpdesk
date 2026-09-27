import {query, mutation} from './_generated/server';
import {v} from 'convex/values';
import {Role, roleCan} from './roles';

const roleValidator = v.union(
  v.literal('customer'),
  v.literal('support-intern'),
  v.literal('support-lead'),
  v.literal('developer'),
);

// Reads a role from app input for the demo. A real app derives the role from a
// verified session; here the desk's role switcher supplies it and every guard
// still runs against it.
export const listOpenTickets = query({
  args: {orgCode: v.string(), role: roleValidator},
  handler: async (ctx, {orgCode, role}) => {
    if (!roleCan(role as Role, 'tickets:read')) {
      throw new Error('forbidden: tickets:read');
    }
    return ctx.db
      .query('tickets')
      .withIndex('by_org_status', (q) =>
        q.eq('orgCode', orgCode).eq('status', 'open'),
      )
      .collect();
  },
});

export const readTicket = query({
  args: {ticketId: v.id('tickets'), role: roleValidator},
  handler: async (ctx, {ticketId, role}) => {
    if (!roleCan(role as Role, 'tickets:read')) {
      throw new Error('forbidden: tickets:read');
    }
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) return null;
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', ticketId))
      .collect();
    return {ticket, messages};
  },
});

export const replyToTicket = mutation({
  args: {ticketId: v.id('tickets'), body: v.string(), role: roleValidator},
  handler: async (ctx, {ticketId, body, role}) => {
    if (!roleCan(role as Role, 'tickets:reply')) {
      throw new Error('forbidden: tickets:reply');
    }
    return ctx.db.insert('messages', {
      ticketId,
      senderRole: 'support',
      body,
    });
  },
});
