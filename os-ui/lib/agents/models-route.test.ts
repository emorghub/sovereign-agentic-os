/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/agents/models — live LiteLLM model list, else the offline catalog. */

process.env.LITELLM_URL = 'http://litellm.test';
process.env.LITELLM_MASTER_KEY = 'sk-test';

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

const { MODEL_CATALOG } = await import('./routing.ts');
const { roleModels } = await import('../models/roles.ts');

type Row = { model_name: string; providerType: string; dbModel: boolean };
type Body = { models: Row[]; source: string; roles: unknown };

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
  const r = await import(`../../app/api/agents/models/route.ts?${Math.random()}`);
  return r.GET();
}

test('401 when signed out — LiteLLM is never called', async () => {
  const f = stubFetch(async () => new Response('{}'));
  const res = await get();
  assert.equal(res.status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('200 source=litellm — dedupes models and carries the db_model flag', async () => {
  USER = AMIR;
  const f = stubFetch(async () =>
    new Response(JSON.stringify({
      data: [
        { model_name: 'gpt-x', litellm_params: { model: 'openai/gpt-x' }, model_info: { db_model: true } },
        { model_name: 'gpt-x', litellm_params: { model: 'openai/gpt-x' }, model_info: { db_model: true } },
        { model_name: 'local-y', litellm_params: { model: 'openai/local-y' }, model_info: {} },
        { litellm_params: { model: 'nameless' } },
      ],
    }), { status: 200 }),
  );
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.source, 'litellm');
  assert.deepEqual(body.models.map((m) => m.model_name), ['gpt-x', 'local-y']);
  assert.equal(body.models[0].dbModel, true);
  assert.equal(body.models[1].dbModel, false);
  assert.deepEqual(body.roles, roleModels());

  const [url, init] = f.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, 'http://litellm.test/model/info');
  assert.equal((init.headers as Record<string, string>).authorization, 'Bearer sk-test');
});

test('200 source=offline when LiteLLM is down', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  const body = (await (await get()).json()) as Body;
  assert.equal(body.source, 'offline');
  assert.equal(body.models.length, Object.keys(MODEL_CATALOG).length);
  assert.ok(body.models.every((m) => m.providerType === 'stackit' && m.dbModel === false));
});

test('200 source=offline when LiteLLM answers non-2xx or an empty list', async () => {
  USER = AMIR;
  stubFetch(async () => new Response('nope', { status: 500 }));
  assert.equal(((await (await get()).json()) as Body).source, 'offline');
  stubFetch(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  assert.equal(((await (await get()).json()) as Body).source, 'offline');
});
