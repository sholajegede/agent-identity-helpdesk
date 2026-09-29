// Server-only helpers for the agents' Kinde M2M tokens. The client secrets live
// in the Next server env and never reach the browser.

const ISSUER = process.env.KINDE_ISSUER as string;
const AUD = process.env.KINDE_AUDIENCE as string;

export type AgentName = 'ticket' | 'refund';

const CREDENTIALS: Record<AgentName, {id: string; secret: string}> = {
  ticket: {
    id: process.env.TICKET_AGENT_CLIENT_ID as string,
    secret: process.env.TICKET_AGENT_CLIENT_SECRET as string,
  },
  refund: {
    id: process.env.REFUND_AGENT_CLIENT_ID as string,
    secret: process.env.REFUND_AGENT_CLIENT_SECRET as string,
  },
};

export type Claims = {
  azp?: string;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  gty?: string;
  iat: number;
  exp: number;
  scp?: string[];
};

export function decodeClaims(token: string): Claims {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Claims;
}

// One token per agent, reused until a minute before exp. Without this every
// run pays a round trip to Kinde; with it, runs after the first are fast.
const cache = new Map<AgentName, {token: string; exp: number}>();

export async function agentToken(agent: AgentName): Promise<string> {
  const hit = cache.get(agent);
  if (hit && hit.exp - 60 > Date.now() / 1000) return hit.token;
  const {id, secret} = CREDENTIALS[agent];
  const res = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      audience: AUD,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const token = (await res.json()).access_token as string;
  cache.set(agent, {token, exp: decodeClaims(token).exp});
  return token;
}
