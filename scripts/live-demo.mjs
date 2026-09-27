// Live demo runner. Drives all five modes against the real Kinde tenant and the
// deployed Convex functions, and captures the lifetime numbers the talk needs.
//
//   node scripts/live-demo.mjs
//
// Prereqs: fill the KINDE_* and *_AGENT_* values in .env.local, and have the dev
// deployment pushed (npx convex dev). The runner provisions agents and seeds data
// itself (idempotent), then runs the flows and prints a report.

import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';

// --- env ---------------------------------------------------------------
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const need = (k) => {
  const v = env[k];
  if (!v || v.startsWith('PASTE_')) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
  return v;
};
const ISSUER = need('KINDE_ISSUER');
const AUD = need('KINDE_AUDIENCE');
const SITE = need('NEXT_PUBLIC_CONVEX_SITE_URL');
const TICKET_ID = need('TICKET_AGENT_CLIENT_ID');
const TICKET_SECRET = need('TICKET_AGENT_CLIENT_SECRET');
const REFUND_ID = need('REFUND_AGENT_CLIENT_ID');
const REFUND_SECRET = need('REFUND_AGENT_CLIENT_SECRET');
const ORG = need('DEMO_ORG_CODE');
const INTERN = need('DEMO_INTERN_SUBJECT');
const LEAD = need('DEMO_LEAD_SUBJECT');

// --- helpers -----------------------------------------------------------
const line = () => console.log('-'.repeat(66));
const ok = (b) => (b ? 'PASS' : 'FAIL');

function cvx(fn, args) {
  const out = execSync(`npx convex run ${fn} '${JSON.stringify(args)}'`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try {
    return out ? JSON.parse(out) : null;
  } catch {
    return out;
  }
}

async function token(clientId, clientSecret) {
  const res = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: AUD,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

function claims(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
}

async function post(path, body, tok) {
  const t0 = Date.now();
  const res = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${tok}`, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  return {status: res.status, ms, body: await res.json()};
}

// --- setup (idempotent) -----------------------------------------------
console.log('Setting up: provisioning agents, seeding, resetting state...');
cvx('agents:provisionAgent', {kindeClientId: TICKET_ID, name: 'Ticket agent', slug: 'ticket-agent', scopes: ['tickets:read', 'tickets:reply']});
cvx('agents:provisionAgent', {kindeClientId: REFUND_ID, name: 'Refund agent', slug: 'refund-agent', scopes: ['tickets:read', 'tickets:reply', 'refunds:issue']});
cvx('seed:reset', {orgCode: ORG});
cvx('status:setStatus', {orgCode: ORG, subject: LEAD, status: 'active'});
cvx('status:setStatus', {orgCode: ORG, subject: INTERN, status: 'active'});
cvx('agents:setAgentActive', {kindeClientId: TICKET_ID, active: true});
const planted = cvx('secureOps:latestPlantedTicket', {orgCode: ORG});
const ticketId = planted?._id;
if (!ticketId) {
  console.error('No planted ticket found after seed — aborting.');
  process.exit(1);
}

const ticketTok = await token(TICKET_ID, TICKET_SECRET);
const refundTok = await token(REFUND_ID, REFUND_SECRET);

console.log('\n=== AUTHENTICATING AI AGENTS — live capture ===');

// --- own-identity ------------------------------------------------------
line();
const oi = await post('/agent/ticket/run', {orgCode: ORG}, ticketTok);
console.log(`own-identity   leaked=${oi.body.leaked} reason=${oi.body.reason}  [${ok(oi.body.leaked === false)}]`);

// --- broken ------------------------------------------------------------
const br = await post('/agent/refund/run', {orgCode: ORG, ticketId, actingSubject: INTERN, role: 'support-intern', mode: 'broken'}, refundTok);
console.log(`broken         allowed=${br.body.allowed}  (intern issued a refund)  [${ok(br.body.allowed === true)}]`);

// --- intersection ------------------------------------------------------
const ix1 = await post('/agent/refund/run', {orgCode: ORG, ticketId, actingSubject: INTERN, role: 'support-intern', mode: 'intersection'}, refundTok);
console.log(`intersection   intern allowed=${ix1.body.allowed} reason=${ix1.body.reason}  [${ok(ix1.body.allowed === false)}]`);
const ix2 = await post('/agent/refund/run', {orgCode: ORG, ticketId, actingSubject: LEAD, role: 'support-lead', mode: 'intersection'}, refundTok);
console.log(`intersection   lead   allowed=${ix2.body.allowed}  [${ok(ix2.body.allowed === true)}]`);

// --- lifetime: offboarding --------------------------------------------
line();
const c = claims(refundTok);
const lifeSec = c.exp - c.iat;
console.log(`token lifetime  ${lifeSec}s (${(lifeSec / 3600).toFixed(1)}h) — issued ${new Date(c.iat * 1000).toISOString()}, expires ${new Date(c.exp * 1000).toISOString()}`);
const before = await post('/agent/refund/run', {orgCode: ORG, ticketId, actingSubject: LEAD, role: 'support-lead', mode: 'intersection'}, refundTok);
console.log(`before offboard lead allowed=${before.body.allowed}`);
cvx('status:setStatus', {orgCode: ORG, subject: LEAD, status: 'offboarded'});
const after = await post('/agent/refund/run', {orgCode: ORG, ticketId, actingSubject: LEAD, role: 'support-lead', mode: 'intersection'}, refundTok);
const secsLeft = c.exp - Math.floor(Date.now() / 1000);
console.log(`after offboard  lead allowed=${after.body.allowed} reason=${after.body.reason}  refused in ${after.ms}ms  [${ok(after.body.allowed === false && after.body.reason === 'user_offboarded')}]`);
console.log(`                the SAME token was still valid for ${(secsLeft / 3600).toFixed(1)}h — the per-call status check is what refused it`);

// --- lifetime: kill switch --------------------------------------------
line();
const kr1 = await post('/agent/ticket/read', {orgCode: ORG}, ticketTok);
console.log(`kill switch    before: ticket agent read allowed=${kr1.body.allowed}`);
cvx('agents:setAgentActive', {kindeClientId: TICKET_ID, active: false});
const kr2 = await post('/agent/ticket/read', {orgCode: ORG}, ticketTok);
console.log(`kill switch    after suspend: ticket agent read allowed=${kr2.body.allowed} reason=${kr2.body.reason}  refused in ${kr2.ms}ms  [${ok(kr2.body.allowed === false)}]`);
const kr3 = await post('/agent/ticket/read', {orgCode: ORG}, refundTok);
console.log(`kill switch    refund agent unaffected: read allowed=${kr3.body.allowed}  [${ok(kr3.body.allowed === true)}]`);

// --- cleanup -----------------------------------------------------------
cvx('status:setStatus', {orgCode: ORG, subject: LEAD, status: 'active'});
cvx('agents:setAgentActive', {kindeClientId: TICKET_ID, active: true});
line();
console.log('Done. State reset (lead active, ticket agent active).');
