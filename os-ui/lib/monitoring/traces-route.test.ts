/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/traces — recent Langfuse traces, scoped to the caller. */

process.env.LANGFUSE_URL = 'http://langfuse.test';
process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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
const ADMIN: U = { id: 'root', name: 'Root', domains: [], role: 'admin' };

type Row = { id: string; name: string | null; input: string; output: string; timestamp: string | null; tags: string[] };

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

const trace = (id: string, principal?: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `t-${id}`,
  input: 'in',
  output: 'out',
  timestamp: '2026-10-01T00:00:00Z',
  tags: ['a'],
  ...(principal === undefined ? {} : { metadata: { principal } }),
  ...extra,
});

const FIXTURE = [
  trace('mine-id', 'amir'),
  trace('mine-domain', 'sales'),
  trace('other', 'bea'),
  trace('unlabeled'),
];

const okFetch = (body: unknown) => stubFetch(async () => new Response(JSON.stringify(body), { status: 200 }));

async function get() {
  const r = await import(`../../app/api/traces/route.ts?${Math.random()}`);
  return r.GET(new Request('http://x/api/traces'), { params: Promise.resolve({}) });
}

test('401 when signed out — Langfuse is never called', async () => {
  const f = okFetch({ data: FIXTURE });
  const res = await get();
  assert.equal(res.status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('calls the Langfuse public API with project basic auth', async () => {
  USER = AMIR;
  const f = okFetch({ data: [] });
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(f.mock.callCount(), 1);
  const [url, init] = f.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(String(url), 'http://langfuse.test/api/public/traces?limit=20');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`);
});

test('non-admin sees only traces under their own id or domain — others and unlabeled are dropped', async () => {
  USER = AMIR;
  okFetch({ data: FIXTURE });
  const { traces } = (await (await get()).json()) as { traces: Row[] };
  assert.deepEqual(traces.map((t) => t.id).sort(), ['mine-domain', 'mine-id']);
});

test('admin sees every trace, including unlabeled ones', async () => {
  USER = ADMIN;
  okFetch({ data: FIXTURE });
  const { traces } = (await (await get()).json()) as { traces: Row[] };
  assert.deepEqual(traces.map((t) => t.id), ['mine-id', 'mine-domain', 'other', 'unlabeled']);
});

test('row shaping: whitespace collapsed, long previews truncated, nulls blank, bad tags → []', async () => {
  USER = ADMIN;
  okFetch({
    data: [
      { id: 'x', input: 'a \n\t  b', output: 'y'.repeat(200), tags: 'not-an-array' },
      { id: 'y', name: 'n', input: { q: 1 }, output: null, timestamp: '2026-10-01T00:00:00Z', tags: ['k'] },
    ],
  });
  const { traces } = (await (await get()).json()) as { traces: Row[] };
  const [x, y] = traces;
  assert.equal(x.input, 'a b');
  assert.equal(x.output, `${'y'.repeat(140)}…`);
  assert.deepEqual(x.tags, []);
  assert.equal(x.name, null);
  assert.equal(x.timestamp, null);
  assert.equal(y.input, '{"q":1}');
  assert.equal(y.output, '');
  assert.deepEqual(y.tags, ['k']);
});

test('Langfuse non-2xx → 502 carrying the upstream status', async () => {
  USER = AMIR;
  stubFetch(async () => new Response('boom', { status: 500 }));
  const res = await get();
  assert.equal(res.status, 502);
  const { error } = (await res.json()) as { error: string };
  assert.match(error, /^Langfuse 500: boom/);
});

test('network failure → 502 "Could not reach Langfuse"', async () => {
  USER = AMIR;
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  const res = await get();
  assert.equal(res.status, 502);
  const { error } = (await res.json()) as { error: string };
  assert.equal(error, 'Could not reach Langfuse: fetch failed');
});

test('200 with malformed JSON → 502 — FINDING: reported as "Could not reach Langfuse" though it answered', async () => {
  // Current behaviour, pinned so a fix is a deliberate change: JSON.parse throws
  // inside the same try as fetch(), so a parse error masquerades as a network error.
  USER = AMIR;
  stubFetch(async () => new Response('<html>not json', { status: 200 }));
  const res = await get();
  assert.equal(res.status, 502);
  const { error } = (await res.json()) as { error: string };
  assert.match(error, /^Could not reach Langfuse: /);
});
