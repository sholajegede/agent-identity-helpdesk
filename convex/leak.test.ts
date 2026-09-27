import {convexTest} from 'convex-test';
import {expect, test} from 'vitest';
import schema from './schema';
import {internal} from './_generated/api';

// Tests opt into per-run mode switching; production stays server-decided.
process.env.DEMO_MODE_SELECTABLE = 'true';

const modules = import.meta.glob('./**/*.ts');
const ORG = 'org_demo';

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.reset, {orgCode: ORG});
  return t;
}

async function secretInThread(t: Awaited<ReturnType<typeof setup>>) {
  return t.run(async (ctx) => {
    const secrets = await ctx.db.query('integration_secrets').collect();
    const messages = await ctx.db.query('messages').collect();
    return secrets.some((s) => messages.some((m) => m.body.includes(s.secret)));
  });
}

test('shared-key: the developer key reads secrets and the raw insert leaks them', async () => {
  const t = await setup();
  const res = await t.mutation(internal.ticketAgent.run, {
    orgCode: ORG,
    requestedMode: 'shared-key',
  });
  expect(res.leaked).toBe(true);
  expect(res.path).toBe('raw_insert');
  expect(await secretInThread(t)).toBe(true);
});

test('scoped-key: read-only refuses the raw write, but the reply tool still leaks', async () => {
  const t = await setup();
  const res = await t.mutation(internal.ticketAgent.run, {
    orgCode: ORG,
    requestedMode: 'scoped-key',
  });
  expect(res.leaked).toBe(true);
  expect(res.path).toBe('reply_tool');
  expect(await secretInThread(t)).toBe(true);
  // the raw write was attempted and denied for read_only
  const denied = await t.run(async (ctx) =>
    ctx.db
      .query('auditLog')
      .collect()
      .then((rows) =>
        rows.some((r) => r.action === 'raw_insert:messages' && r.reason === 'read_only'),
      ),
  );
  expect(denied).toBe(true);
});

test('own-identity: the secrets read is refused, so nothing leaks', async () => {
  const t = await setup();
  const res = await t.mutation(internal.ticketAgent.run, {
    orgCode: ORG,
    requestedMode: 'own-identity',
    agentCaller: {
      id: 'agent_ticket',
      scopes: ['tickets:read', 'tickets:reply'],
      actingForSubject: 'kp_intern',
    },
  });
  expect(res.leaked).toBe(false);
  expect(res.reason).toBe('insufficient_scope');
  expect(await secretInThread(t)).toBe(false);
});

test('every run records an audit row with a correlationId', async () => {
  const t = await setup();
  const res = await t.mutation(internal.ticketAgent.run, {
    orgCode: ORG,
    requestedMode: 'shared-key',
  });
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query('auditLog')
      .withIndex('by_correlation', (q) => q.eq('correlationId', res.correlationId))
      .collect(),
  );
  expect(rows.length).toBeGreaterThan(0);
});
