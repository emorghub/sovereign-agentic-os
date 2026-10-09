/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Behaviour of POST /api/agents/scheduled-run — the CronJob receiver. No user session:
 * the gate is the shared runtime bearer (runtimeTokenOk). The live run itself
 * (runScheduledSystem) is stubbed; the store is real.
 */

// config reads env at load → set the runtime bearer BEFORE anything imports config.
process.env.AGENT_RUNTIME_TOKEN = 'test-token';

type Outcome = { ok: true; report: unknown } | { ok: false; status: number; error: string };
let OUTCOME: Outcome = { ok: true, report: { ran: true } };
const runs: { systemId: string; prompt: string }[] = [];
mock.module('@/lib/agents/build/scheduled', {
  namedExports: {
    runScheduledSystem: async (systemId: string, _rec: unknown, prompt: string) => {
      runs.push({ systemId, prompt });
      return OUTCOME;
    },
  },
});

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');

const SARA = { id: 'sara', domains: ['sales'], role: 'domain_admin' as const };

beforeEach(() => {
  __resetStore();
  runs.length = 0;
  OUTCOME = { ok: true, report: { ran: true } };
});

async function post(body: unknown, authorization?: string) {
  const r = await import(`../../app/api/agents/scheduled-run/route.ts?${Math.random()}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return r.POST(new Request('http://x/api/agents/scheduled-run', { method: 'POST', headers, body: JSON.stringify(body) }));
}

test('401 without an Authorization header', async () => {
  const res = await post({ systemId: 'sys_x' });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
});

test('401 for a wrong token (same length and different length) and an empty bearer', async () => {
  for (const h of ['Bearer test-tokem', 'Bearer nope', 'Bearer ', 'test-token-but-longer']) {
    const res = await post({ systemId: 'sys_x' }, h);
    assert.equal(res.status, 401, h);
  }
  assert.equal(runs.length, 0, 'nothing ran');
});

test('400 when systemId is missing', async () => {
  const res = await post({}, 'Bearer test-token');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'systemId is required' });
});

test('404 for an unknown system', async () => {
  const res = await post({ systemId: 'sys_nope' }, 'Bearer test-token');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'system not found' });
  assert.equal(runs.length, 0);
});

test('200 runs the system, returns the report and records activity', async () => {
  const s = createSystem(SARA, { name: 'Nightly' });
  assert.equal(__recordFor(s.id)!.lastActivity, null);
  OUTCOME = { ok: true, report: { ran: true, steps: 3 } };
  const res = await post({ systemId: s.id }, 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ran: true, steps: 3 });
  assert.deepEqual(runs, [{ systemId: s.id, prompt: 'Scheduled run' }], 'default prompt');
  assert.equal(typeof __recordFor(s.id)!.lastActivity, 'string', 'activity recorded');
});

test('the bearer scheme is case-insensitive and a custom prompt is passed through', async () => {
  const s = createSystem(SARA, { name: 'Nightly' });
  const res = await post({ systemId: s.id, prompt: 'Summarise Q3' }, 'bearer test-token');
  assert.equal(res.status, 200);
  assert.equal(runs[0].prompt, 'Summarise Q3');
});

test('a failed run surfaces its own status + error (e.g. 409 owner gone)', async () => {
  const s = createSystem(SARA, { name: 'Nightly' });
  OUTCOME = { ok: false, status: 409, error: 'owner no longer active' };
  const res = await post({ systemId: s.id }, 'Bearer test-token');
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'owner no longer active' });
});
