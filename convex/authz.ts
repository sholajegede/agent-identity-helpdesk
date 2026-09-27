/**
 * The support desk's authorization mode. The SERVER decides it (deployment env
 * `MODE`); a calling agent can never pick how strictly it is checked. A trusted
 * demo operator may switch it per run only when `DEMO_MODE_SELECTABLE=true`.
 *
 *   shared-key   — the agent runs on the developer's all-access path (the Convex
 *                  stand-in for service_role). No agent identity, no scope check.
 *   scoped-key   — the same path, read-only and project-scoped. Writes refused,
 *                  reads still allowed. The researchers' own fix.
 *   own-identity — the agent verifies its own Kinde M2M token; scopes enforced.
 *   broken       — a second agent authorized on its identity alone. The acting
 *                  human's permissions are never checked (the confused deputy).
 *   intersection — authorize() enforces human ∩ agent ∩ token on every call.
 */
export type Mode =
  | 'shared-key'
  | 'scoped-key'
  | 'own-identity'
  | 'broken'
  | 'intersection';

const MODES: readonly Mode[] = [
  'shared-key',
  'scoped-key',
  'own-identity',
  'broken',
  'intersection',
];

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** The server's configured mode. Reads DEMO_MODE (not MODE, which the component reserves). Defaults to shared-key. */
export function serverMode(): Mode {
  const m = process.env.DEMO_MODE;
  return isMode(m) ? m : 'shared-key';
}

/** OFF by default. On a real deployment it stays off and serverMode() alone rules. */
export function modeSelectable(): boolean {
  return process.env.DEMO_MODE_SELECTABLE === 'true';
}

/** The effective mode for one run: the operator's choice only when selection is on. */
export function runMode(requested: unknown): Mode {
  if (modeSelectable() && isMode(requested)) return requested;
  return serverMode();
}
