/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/agents/systems/[id]/run/diagnostics — per-node Langfuse metrics. */

process.env.LANGFUSE_URL = 'http://langfuse.test';

type U = { id: string; name: string; domains: string[]; role: Role };

// Session mock: USER=null → requireUser THROWS a 401-tagged error, exactly like the
// real gate.
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

const AMIR: U = { id: 'amir', name: 'Amir', domains: ['sales'], role: 'creator' };

const { shapeTraceMetrics } = await import('./build/run-diagnostics.ts');

const UNAVAILABLE = { available: false, perNode: {}, totals: { tokens: 0, latencyMs: 0, costUsd: 0 } };

beforeEach(() => { USER = null; });
// Fake the network per test. Restore ONLY this fetch stub — mock.restoreAll() would
// also undo the module mock of the session gate above.
let FETCH: ReturnType<typeof mock.method> | undefined;
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  FETCH?.mock.restore();
  FETCH = mock.method(globalThis, 'fetch', impl);
  return FETCH;
}
afterEach(() => { FETCH?.mock.restore(); FETCH = undefined; });

async function get(qs = '') {
  const r = await import(`../../app/api/agents/systems/[id]/run/diagnostics/route.ts?${Math.random()}`);
  return r.GET(new Request(`http://x/api/agents/systems/sys_1/run/diagnostics${qs}`), { params: Promise.resolve({ id: 'sys_1' }) });
}

test('401 when signed out — Langfuse is never called', async () => {
  const f = stubFetch(async () => new Response('{}'));
  const res = await get();
  assert.equal(res.status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('200 shapes Langfuse observations into per-node metrics', async () => {
  USER = AMIR;
  const obs = [
    { name: 'plan', metadata: { node: 'plan' }, latency: 1.5, calculatedTotalCost: 0.01, usage: { total: 100 } },
    { name: 'write', metadata: { node: 'write' }, latency: 0.5, calculatedTotalCost: 0.02, usage: { total: 50 } },
  ];
  const f = stubFetch(async () => new Response(JSON.stringify({ data: obs }), { status: 200 }));
  const res = await get('?nodes=plan, write,');
  assert.equal(res.status, 200);
  const { metrics } = (await res.json()) as { metrics: { available: boolean; perNode: Record<string, unknown> } };
  assert.deepEqual(metrics, shapeTraceMetrics(obs, ['plan', 'write']));
  assert.equal(metrics.available, true);
  assert.deepEqual(Object.keys(metrics.perNode).sort(), ['plan', 'write']);
  assert.match(String(f.mock.calls[0].arguments[0]), /^http:\/\/langfuse\.test\/api\/public\/observations\?/);
});

test('200 metrics unavailable when Langfuse is down or non-2xx', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  assert.deepEqual(await (await get()).json(), { metrics: UNAVAILABLE });
  stubFetch(async () => new Response('err', { status: 503 }));
  assert.deepEqual(await (await get()).json(), { metrics: UNAVAILABLE });
});

test('200 empty observation list → unavailable (no data yet)', async () => {
  USER = AMIR;
  stubFetch(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  const { metrics } = (await (await get()).json()) as { metrics: { available: boolean } };
  assert.equal(metrics.available, false);
});
