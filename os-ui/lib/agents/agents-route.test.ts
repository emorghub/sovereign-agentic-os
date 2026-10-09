/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/agents — the deployed-agent registry + live /health probes. */

// Recognisable probe targets; Hermes stays gated off (HERMES_ENABLED unset).
process.env.SAMPLE_AGENT_URL = 'http://sample.test';
process.env.ML_AGENT_URL = 'http://ml.test';
delete process.env.HERMES_ENABLED;

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

type Row = { key: string; up: boolean; detail: string; optional: boolean };
type Body = { agents: Row[]; up: number; total: number };

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
  const r = await import(`../../app/api/agents/route.ts?${Math.random()}`);
  return r.GET();
}
const byKey = (b: Body) => Object.fromEntries(b.agents.map((a) => [a.key, a]));

test('401 when signed out — and nothing is probed', async () => {
  const f = stubFetch(async () => new Response('ok'));
  const res = await get();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not authenticated' });
  assert.equal(f.mock.callCount(), 0);
});

test('200 — reachable agents are up (any HTTP status counts), Hermes gated off', async () => {
  USER = AMIR;
  const f = stubFetch(async (url: string) =>
    new Response('', { status: String(url).startsWith('http://ml.test') ? 404 : 200 }),
  );
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  const a = byKey(body);
  assert.equal(body.total, 3);
  assert.equal(a['sample-agent'].up, true);
  assert.equal(a['sample-agent'].detail, 'HTTP 200');
  assert.equal(a['ml-agent'].up, true, '404 on /health still means the process is serving');
  assert.equal(a['ml-agent'].detail, 'HTTP 404');
  assert.equal(a['hermes-gateway'].up, false);
  assert.equal(a['hermes-gateway'].detail, 'gated off (hermes.enabled=false)');
  assert.equal(body.up, 2);
  const urls = f.mock.calls.map((c) => String(c.arguments[0])).sort();
  assert.deepEqual(urls, ['http://ml.test/health', 'http://sample.test/health']);
});

test('200 — a network failure marks the agent down/unreachable, not an error response', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  const a = byKey(body);
  assert.equal(a['sample-agent'].up, false);
  assert.equal(a['sample-agent'].detail, 'unreachable');
  assert.equal(a['ml-agent'].detail, 'unreachable');
  assert.equal(body.up, 0);
});

test('200 — an aborted probe is reported as a timeout', async () => {
  USER = AMIR;
  stubFetch(async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  });
  const a = byKey((await (await get()).json()) as Body);
  assert.equal(a['sample-agent'].detail, 'timeout');
});
