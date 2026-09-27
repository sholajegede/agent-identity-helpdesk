// Human roles on the support desk and what each may do. These mirror the
// Supabase demo's RLS roles, but Convex has no RLS, so the guards below enforce
// them in code. The "developer" path deliberately skips these guards — that is
// the service_role-bypasses-RLS equivalent, and the whole point of shared-key mode.

export type Role = 'customer' | 'support-intern' | 'support-lead' | 'developer';

// App permissions a human can hold. Agents are capped by these in intersection mode.
export const PERMISSIONS = {
  'tickets:read': 'Read tickets and their messages',
  'tickets:reply': 'Post a reply on a ticket',
  'refunds:issue': 'Issue a refund on an order',
  'secrets:read': 'Read the integration_secrets table',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  customer: [],
  'support-intern': ['tickets:read', 'tickets:reply'],
  'support-lead': ['tickets:read', 'tickets:reply', 'refunds:issue'],
  // The developer path is all-access by construction (the service_role stand-in).
  developer: ['tickets:read', 'tickets:reply', 'refunds:issue', 'secrets:read'],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
