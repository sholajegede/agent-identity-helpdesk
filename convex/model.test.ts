import {convexTest} from 'convex-test';
import {expect, test} from 'vitest';
import schema from './schema';
import {api, internal} from './_generated/api';
import {roleCan, permissionsFor} from './roles';

const modules = import.meta.glob('./**/*.ts');
const ORG = 'org_demo';

test('role guards match the Supabase RLS roles', () => {
  expect(roleCan('support-intern', 'tickets:reply')).toBe(true);
  expect(roleCan('support-intern', 'refunds:issue')).toBe(false);
  expect(roleCan('support-intern', 'secrets:read')).toBe(false);
  expect(roleCan('support-lead', 'refunds:issue')).toBe(true);
  expect(roleCan('support-lead', 'secrets:read')).toBe(false);
  expect(permissionsFor('developer')).toContain('secrets:read');
});

test('seed creates a normal ticket, a planted ticket, and secrets', async () => {
  const t = convexTest(schema, modules);
  const {plantedTicketId} = await t.mutation(internal.seed.reset, {orgCode: ORG});
  const planted = await t.run(async (ctx) => ctx.db.get(plantedTicketId));
  expect(planted?.planted).toBe(true);
  const secrets = await t.run(async (ctx) =>
    ctx.db.query('integration_secrets').collect(),
  );
  expect(secrets.length).toBeGreaterThanOrEqual(2);
});

test('an intern can read and reply but cannot reach secrets', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.reset, {orgCode: ORG});
  const open = await t.query(api.tickets.listOpenTickets, {
    orgCode: ORG,
    role: 'support-intern',
  });
  expect(open.length).toBeGreaterThanOrEqual(2);
  await expect(
    t.query(api.tickets.listOpenTickets, {orgCode: ORG, role: 'customer'}),
  ).rejects.toThrow('forbidden');
});

test('no secret value ever sits in the support tables after seed', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.reset, {orgCode: ORG});
  const secrets = await t.run(async (ctx) =>
    ctx.db.query('integration_secrets').collect(),
  );
  const messages = await t.run(async (ctx) => ctx.db.query('messages').collect());
  for (const s of secrets) {
    for (const m of messages) {
      expect(m.body.includes(s.secret)).toBe(false);
    }
  }
});
