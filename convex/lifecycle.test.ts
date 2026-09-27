/// <reference types="vite/client" />
import {beforeAll, beforeEach, afterEach, test, expect, vi} from 'vitest';
import {SignJWT, exportJWK, generateKeyPair} from 'jose';
import {convexTest} from 'convex-test';
import schema from './schema';
import {internal} from './_generated/api';
import agentAuthComponent from '@kinde-oss/kinde-convex-agent-auth/test';

const modules = import.meta.glob('./**/*.ts');
const DOMAIN = 'agentidentity.kinde.com';
const ISSUER = `https://${DOMAIN}`;
const JWKS_URL = `https://${DOMAIN}/.well-known/jwks`;
const CONFIG_URL = `https://${DOMAIN}/.well-known/openid-configuration`;
const AUD = 'helpdesk-api';
const ORG = 'org_demo';
const TICKET_CLIENT = 'm2m_ticket_agent';
const REFUND_CLIENT = 'm2m_refund_agent';
const LEAD = 'kp_lead';

let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwk: Record<string, string | string[]>;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', {extractable: true});
  key = kp.privateKey;
  const pub = await exportJWK(kp.publicKey);
  jwk = {kid: 'k1', alg: 'RS256', use: 'sig'};
  for (const [k, val] of Object.entries(pub)) if (typeof val === 'string') jwk[k] = val;
});

function stubKinde() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === CONFIG_URL) return new Response(JSON.stringify({jwks_uri: JWKS_URL}), {status: 200});
      if (url === JWKS_URL) return new Response(JSON.stringify({keys: [jwk]}), {status: 200});
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function mint(client: string, scopes: string[]) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({gty: 'client_credentials', azp: client, scp: scopes})
    .setProtectedHeader({alg: 'RS256', kid: 'k1'})
    .setIssuedAt(now - 60)
    .setIssuer(ISSUER)
    .setSubject(client)
    .setAudience(AUD)
    .setExpirationTime(now + 3600)
    .sign(key);
}

beforeEach(() => {
  vi.stubEnv('KINDE_DOMAIN', DOMAIN);
  vi.stubEnv('KINDE_AUDIENCE', AUD);
  vi.stubEnv('DELEGATION_SIGNING_SECRET', 'test-secret');
  vi.stubEnv('MODE', 'test');
  stubKinde();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  agentAuthComponent.register(t);
  await t.mutation(internal.seed.reset, {orgCode: ORG});
  await t.mutation(internal.agents.provisionAgent, {
    kindeClientId: TICKET_CLIENT, name: 'Ticket agent', slug: 'ticket-agent',
    scopes: ['tickets:read', 'tickets:reply'],
  });
  await t.mutation(internal.agents.provisionAgent, {
    kindeClientId: REFUND_CLIENT, name: 'Refund agent', slug: 'refund-agent',
    scopes: ['tickets:read', 'tickets:reply', 'refunds:issue'],
  });
  const ticket = await t.run(async (ctx) =>
    ctx.db.query('tickets').filter((q) => q.eq(q.field('planted'), true)).first(),
  );
  return {t, ticketId: ticket!._id};
}

async function refund(t: Awaited<ReturnType<typeof setup>>['t'], token: string, ticketId: string, subject: string) {
  const res = await t.fetch('/agent/refund/run', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({orgCode: ORG, ticketId, actingSubject: subject, role: 'support-lead', mode: 'intersection'}),
  });
  return res.json();
}

async function ticketRead(t: Awaited<ReturnType<typeof setup>>['t'], token: string) {
  const res = await t.fetch('/agent/ticket/read', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({orgCode: ORG}),
  });
  return res.json();
}

test('offboarding: the same valid token is refused once the human is offboarded', async () => {
  const {t, ticketId} = await setup();
  const token = await mint(REFUND_CLIENT, ['tickets:read', 'tickets:reply', 'refunds:issue']);

  // The lead can refund, so while active the refund goes through.
  const before = await refund(t, token, ticketId, LEAD);
  expect(before.allowed).toBe(true);

  // Offboard the lead. The token is untouched and still verifies.
  await t.mutation(internal.status.setStatus, {orgCode: ORG, subject: LEAD, status: 'offboarded'});

  // Same token, same agent, same human. The per-call status check refuses it.
  const after = await refund(t, token, ticketId, LEAD);
  expect(after.allowed).toBe(false);
  expect(after.reason).toBe('user_offboarded');
  expect(after.correlationId).toBeTruthy();
});

test('kill switch: suspending one agent refuses its next call, others unaffected', async () => {
  const {t} = await setup();
  const ticketToken = await mint(TICKET_CLIENT, ['tickets:read', 'tickets:reply']);
  const refundToken = await mint(REFUND_CLIENT, ['tickets:read', 'tickets:reply', 'refunds:issue']);

  // Both agents can read tickets to begin with.
  expect((await ticketRead(t, ticketToken)).allowed).toBe(true);
  expect((await ticketRead(t, refundToken)).allowed).toBe(true);

  // Flip the kill switch on the ticket agent only.
  const flipped = await t.mutation(internal.agents.setAgentActive, {
    kindeClientId: TICKET_CLIENT, active: false,
  });
  expect(flipped).toBe(true);

  // The ticket agent's very next call is refused; the refund agent still works.
  const denied = await ticketRead(t, ticketToken);
  expect(denied.allowed).toBe(false);
  expect(denied.reason).toBe('agent_suspended');
  expect((await ticketRead(t, refundToken)).allowed).toBe(true);
});
