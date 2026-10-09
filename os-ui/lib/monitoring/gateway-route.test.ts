/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/gateway — LiteLLM model + MCP tool catalog. */

process.env.LITELLM_URL = 'http://litellm.test';
process.env.LITELLM_MASTER_KEY = 'sk-master-secret';

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

const MODELS = { data: [{ id: 'sovereign-default', owned_by: 'openai' }, { id: 'bare' }] };
const TOOLS = {
  tools: [
    { name: 'search', description: 'Find\n   things', inputSchema: { properties: { q: {}, limit: {} } } },
    { name: 'noargs' },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function get() {
  const r = await import(`../../app/api/gateway/route.ts?${Math.random()}`);
  return r.GET(new Request('http://x/api/gateway'), { params: Promise.resolve({}) });
}

test('401 when signed out — LiteLLM is never called', async () => {
  const f = stubFetch(async () => json({}));
  const res = await get();
  assert.equal(res.status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('both upstreams up → shaped models and tools', async () => {
  USER = AMIR;
  stubFetch(async (url) => (String(url).endsWith('/v1/models') ? json(MODELS) : json(TOOLS)));
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(body.models, [
    { id: 'sovereign-default', ownedBy: 'openai' },
    { id: 'bare', ownedBy: '' },
  ]);
  assert.deepEqual(body.tools, [
    { name: 'search', description: 'Find things', params: ['q', 'limit'] },
    { name: 'noargs', description: '', params: [] },
  ]);
  assert.equal(body.modelsError, '');
  assert.equal(body.toolsError, '');
});

test('both calls carry the master key as a Bearer token', async () => {
  USER = AMIR;
  const f = stubFetch(async (url) => (String(url).endsWith('/v1/models') ? json(MODELS) : json(TOOLS)));
  await get();
  const calls = f.mock.calls.map((c) => c.arguments as [string, RequestInit]);
  assert.deepEqual(calls.map(([u]) => String(u)).sort(), [
    'http://litellm.test/v1/mcp/tools',
    'http://litellm.test/v1/models',
  ]);
  for (const [, init] of calls) {
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer sk-master-secret');
  }
});

test('the master key never appears in the response body', async () => {
  USER = AMIR;
  stubFetch(async (url) => (String(url).endsWith('/v1/models') ? json(MODELS) : json({}, 500)));
  const res = await get();
  assert.ok(!JSON.stringify(await res.json()).includes('sk-master-secret'));
});

test('models down, tools up → 200 with modelsError', async () => {
  USER = AMIR;
  stubFetch(async (url) => (String(url).endsWith('/v1/models') ? json({}, 503) : json(TOOLS)));
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.modelsError, 'HTTP 503');
  assert.deepEqual(body.models, []);
  assert.equal((body.tools as unknown[]).length, 2);
});

test('tools down, models up → 200 with toolsError', async () => {
  USER = AMIR;
  stubFetch(async (url) => {
    if (String(url).endsWith('/v1/models')) return json(MODELS);
    throw new TypeError('fetch failed');
  });
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.toolsError, 'fetch failed');
  assert.equal((body.models as unknown[]).length, 2);
});

test('both down → 502 "Could not reach LiteLLM"', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  const res = await get();
  assert.equal(res.status, 502);
  const { error } = (await res.json()) as { error: string };
  assert.equal(error, 'Could not reach LiteLLM: fetch failed');
});
