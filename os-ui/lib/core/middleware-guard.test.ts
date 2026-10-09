/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
// Disabled-tab guard in middleware.ts on a base-8 install. TAB_FEATURES is read
// once at import, and every test file is its own process — so set the env BEFORE
// the middleware (→ lib/core/tabs) is imported.
process.env.OS_ENABLED_TABS = 'home,about,agents,monitoring,llm-gateway,mcp,governance,tutorials';
process.env.OS_SESSION_SECRET = 'middleware-test-secret';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { middleware } = await import('../../middleware.ts');
const { signSession, SESSION_COOKIE } = await import('./session.ts');

/** The slice of NextRequest the middleware reads. */
function req(path: string, opts: { method?: string; cookie?: string } = {}) {
  const url = new URL(`http://os.test${path}`);
  const nextUrl = Object.assign(url, { clone: () => new URL(url.href) });
  const cookies = new Map(opts.cookie ? [[SESSION_COOKIE, opts.cookie]] : []);
  return {
    nextUrl,
    method: opts.method ?? 'GET',
    headers: new Headers(),
    cookies: { get: (k: string) => (cookies.has(k) ? { name: k, value: cookies.get(k)! } : undefined) },
  } as unknown as Parameters<typeof middleware>[0];
}

const validCookie = () =>
  signSession({ id: 'amir', name: 'Amir', domains: ['sales'], role: 'creator' }, 'middleware-test-secret');

const isPassThrough = (res: Response) => res.status === 200 && res.headers.get('x-middleware-next') === '1';

test('a disabled tab\'s page → 404', async () => {
  const res = await middleware(req('/data'));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Not found');
});

test('a disabled tab\'s sub-path → 404 (prefix match)', async () => {
  assert.equal((await middleware(req('/data/datasets/abc'))).status, 404);
  assert.equal((await middleware(req('/platform/settings'))).status, 404, 'Admin (/platform) is not in base-8');
});

test('404 wins even for a signed-in user — the guard runs before the session check', async () => {
  const res = await middleware(req('/strategy', { cookie: await validCookie() }));
  assert.equal(res.status, 404);
});

test('prefix match respects the segment boundary — /database is not the /data tab', async () => {
  const res = await middleware(req('/database'));
  assert.notEqual(res.status, 404);
});

test('an enabled tab without a session → redirect to /signin (not 404)', async () => {
  const res = await middleware(req('/agents'));
  assert.equal(res.status, 307);
  const loc = new URL(res.headers.get('location')!);
  assert.equal(loc.pathname, '/signin');
  assert.equal(loc.searchParams.get('next'), '/agents');
});

test('home (/) is enabled → not 404', async () => {
  const res = await middleware(req('/'));
  assert.notEqual(res.status, 404);
  assert.equal(res.status, 307);
});

test('a tampered session cookie → redirect to /signin', async () => {
  const forged = (await validCookie()).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const res = await middleware(req('/agents', { cookie: forged }));
  assert.equal(res.status, 307);
});

test('an enabled tab with a valid session → pass-through, x-pathname forwarded', async () => {
  const res = await middleware(req('/agents/sys-1', { cookie: await validCookie() }));
  assert.ok(isPassThrough(res));
  assert.equal(res.headers.get('x-middleware-request-x-pathname'), '/agents/sys-1');
});

test('public paths pass without a session', async () => {
  for (const p of ['/signin', '/api/auth/me', '/.well-known/oauth-protected-resource/api/mcp']) {
    assert.ok(isPassThrough(await middleware(req(p))), p);
  }
});

test('FINDING: a disabled tab\'s REST API passes the middleware (APIs self-guard on auth only)', async () => {
  // The guard covers PAGES only. /api/* is passed through so routes can return a
  // clean 401 — but nothing at the edge stops a signed-in caller from hitting a
  // disabled tab's REST API. MCP tools ARE flag-gated (register-gating-*.test.ts);
  // REST routes are not. Pinned as current behaviour.
  assert.ok(isPassThrough(await middleware(req('/api/data/datasets'))));
  assert.ok(isPassThrough(await middleware(req('/api/strategy'))));
});

test('FINDING: the moved /experimental/<tab> pages are NOT matched by the guard', async () => {
  // The data page lives at app/experimental/data → URL /experimental/data, but the
  // tab's href (lib/core/tabs.ts) is still '/data'. The guard matches on href, so
  // /experimental/data slips past it: signed out it's a /signin redirect (not 404),
  // signed in it passes straight through to the page. Pinned as current behaviour —
  // fix by matching /experimental<href> too (or updating the hrefs).
  const anon = await middleware(req('/experimental/data'));
  assert.equal(anon.status, 307);
  const signedIn = await middleware(req('/experimental/data', { cookie: await validCookie() }));
  assert.ok(isPassThrough(signedIn));
});
