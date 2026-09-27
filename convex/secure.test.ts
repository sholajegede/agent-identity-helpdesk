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
const INTERN = 'kp_intern';
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

test('own-identity: the ticket agent is refused the secrets read, nothing leaks', async () => {
  const {t} = await setup();
  const token = await mint(TICKET_CLIENT, ['tickets:read', 'tickets:reply']);
  const res = await t.fetch('/agent/ticket/run', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({orgCode: ORG}),
  });
  const out = await res.json();
  expect(out.leaked).toBe(false);
  expect(out.reason).toBe('insufficient_scope');
  const leaked = await t.run(async (ctx) => {
    const secrets = await ctx.db.query('integration_secrets').collect();
    const messages = await ctx.db.query('messages').collect();
    return secrets.some((s) => messages.some((m) => m.body.includes(s.secret)));
  });
  expect(leaked).toBe(false);
});

test('broken: the refund agent issues a refund the intern could never make', async () => {
  const {t, ticketId} = await setup();
  const token = await mint(REFUND_CLIENT, ['tickets:read', 'tickets:reply', 'refunds:issue']);
  const res = await t.fetch('/agent/refund/run', {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({orgCode: ORG, ticketId, actingSubject: INTERN, role: 'support-intern', mode: 'broken'}),
  });
  const out = await res.json();
  expect(out.allowed).toBe(true);
});

test('intersection: the intern is refused, the lead is allowed', async () => {
  const {t, ticketId} = await setup();
  const token = await mint(REFUND_CLIENT, ['tickets:read', 'tickets:reply', 'refunds:issue']);
  const asIntern = await (
    await t.fetch('/agent/refund/run', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({orgCode: ORG, ticketId, actingSubject: INTERN, role: 'support-intern', mode: 'intersection'}),
    })
  ).json();
  expect(asIntern.allowed).toBe(false);
  expect(asIntern.reason).toBe('insufficient_scope');

  const asLead = await (
    await t.fetch('/agent/refund/run', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({orgCode: ORG, ticketId, actingSubject: LEAD, role: 'support-lead', mode: 'intersection'}),
    })
  ).json();
  expect(asLead.allowed).toBe(true);
});
