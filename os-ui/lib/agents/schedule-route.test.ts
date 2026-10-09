/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/schedule. The k8s CronJob reconcile is
 * stubbed (no cluster in CI); isValidCron is the real pure helper.
 */

type U = { id: string; name: string; domains: string[]; role: Role };

// Session mock: USER=null → requireUser THROWS a 401-tagged error, exactly like the
// real gate (withRoute reads the error's `status`).
let USER: U | null = null;
mock.module('@/lib/core/auth', {
  namedExports: {
    requireUser: async () => {
      if (!USER) {
        const e = new Error('Not authenticated') as Error & { status?: number };
        e.status = 401;
        throw e;
      }
      return USER;
    },
  },
});

const { isValidCron } = await import('../core/cron-util.ts');
const reconcileCalls: { id: string; schedule: unknown }[] = [];
mock.module('@/lib/agents/schedule-cron', {
  namedExports: {
    isValidCron,
    reconcileScheduleCron: async (id: string, schedule: unknown) => {
      reconcileCalls.push({ id, schedule });
      return { ok: true, live: true, action: 'created', name: 'cron-' + id, detail: 'stub' };
    },
  },
});

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; reconcileCalls.length = 0; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function post(id: string, body: unknown) {
  const r = await import(`../../app/api/agents/systems/[id]/schedule/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/schedule`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out', async () => {
  assert.equal((await post('sys_x', { kind: 'manual' })).status, 401);
});

test('400 for an invalid cron — nothing saved, no CronJob touched', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const before = __recordFor(s.id)!.schedule;
  const res = await post(s.id, { kind: 'cron', cron: 'every monday' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'A cron schedule needs 5 fields, e.g. "0 9 * * 1".' });
  assert.deepEqual(__recordFor(s.id)!.schedule, before);
  assert.equal(reconcileCalls.length, 0);
});

test('403 for a non-owner', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await post(s.id, { kind: 'cron', cron: '0 9 * * 1' });
  assert.equal(res.status, 403);
  assert.equal(reconcileCalls.length, 0);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await post('sys_nope', { kind: 'manual' })).status, 404);
});

test('200 saves a cron schedule and reconciles the CronJob', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await post(s.id, { kind: 'cron', cron: '0 9 * * 1' });
  assert.equal(res.status, 200);
  const json = (await res.json()) as { schedule: { kind: string; cron?: string }; cron: { ok: boolean } };
  assert.equal(json.schedule.kind, 'cron');
  assert.equal(json.schedule.cron, '0 9 * * 1');
  assert.equal(json.cron.ok, true);
  assert.equal(__recordFor(s.id)!.schedule.kind, 'cron');
  assert.equal(__recordFor(s.id)!.schedule.cron, '0 9 * * 1');
  assert.deepEqual(reconcileCalls.map((c) => c.id), [s.id]);
});

test('an unknown kind falls back to manual', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await post(s.id, { kind: 'whenever' });
  assert.equal(res.status, 200);
  assert.equal(__recordFor(s.id)!.schedule.kind, 'manual');
});
