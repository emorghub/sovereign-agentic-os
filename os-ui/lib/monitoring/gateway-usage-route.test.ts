/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/gateway/usage — LiteLLM 30-day activity + 7-day run spend + budget. */

process.env.LITELLM_URL = 'http://litellm.test';
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

type Usage = {
  activity: { requests: number; tokens: number } | null;
  weekly: { telemetryOk: boolean };
  budgetUsd: number;
  budgetWindow: string;
};

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

async function get() {
  const r = await import(`../../app/api/gateway/usage/route.ts?${Math.random()}`);
  return r.GET(new Request('http://x/api/gateway/usage'), { params: Promise.resolve({}) });
}

test('401 when signed out — nothing is fetched', async () => {
  const f = stubFetch(async () => new Response('{}'));
  const res = await get();
  assert.equal(res.status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('200 with LiteLLM activity and Langfuse reachable', async () => {
  USER = AMIR;
  const f = stubFetch(async (url: string) => {
    if (String(url).startsWith('http://litellm.test/global/activity')) {
      return new Response(JSON.stringify({ sum_api_requests: 12, sum_total_tokens: 3400 }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 }); // Langfuse traces
  });
  const res = await get();
  assert.equal(res.status, 200);
  const { usage } = (await res.json()) as { usage: Usage };
  assert.deepEqual(usage.activity, { requests: 12, tokens: 3400 });
  assert.equal(usage.weekly.telemetryOk, true);
  assert.equal(typeof usage.budgetUsd, 'number');
  assert.equal(typeof usage.budgetWindow, 'string');
  const urls = f.mock.calls.map((c) => String(c.arguments[0]));
  assert.ok(urls.some((u) => /\/global\/activity\?start_date=\d{4}-\d{2}-\d{2}&end_date=\d{4}-\d{2}-\d{2}$/.test(u)));
});

test('200 with honest nulls when both LiteLLM and Langfuse are down', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  const res = await get();
  assert.equal(res.status, 200);
  const { usage } = (await res.json()) as { usage: Usage };
  assert.equal(usage.activity, null, 'gateway did not answer → null, not 0');
  assert.equal(usage.weekly.telemetryOk, false, 'spend unknown, not 0');
});
