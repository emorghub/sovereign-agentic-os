/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/build. The live build (Forgejo commit +
 * runtime reload) is stubbed; the store and the owner-grant governance are real.
 */

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

type Report = { ok: boolean; rows: { stage: string; ok: boolean }[]; mode: string };
let BUILD: (id: string, yaml: string) => Promise<Report> = async () => ({ ok: true, rows: [{ stage: 'commit', ok: true }], mode: 'offline-mock' });
const builds: { id: string; yaml: string }[] = [];
mock.module('@/lib/agents/build/server', {
  namedExports: {
    buildSystem: async (id: string, yaml: string) => { builds.push({ id, yaml }); return BUILD(id, yaml); },
    // tripwire: this route must not call these — a stray call fails loudly instead of doing real I/O
    runSystem: async () => { throw new Error('not used'); },
    probeConnection: async () => { throw new Error('not used'); },
  },
});

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');

beforeEach(() => {
  __resetStore();
  USER = null;
  builds.length = 0;
  BUILD = async () => ({ ok: true, rows: [{ stage: 'commit', ok: true }], mode: 'offline-mock' });
});

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function build(id: string) {
  const r = await import(`../../app/api/agents/systems/[id]/build/route.ts?${Math.random()}`);
  return r.POST(new Request(`http://x/api/agents/systems/${id}/build`, { method: 'POST' }), { params: Promise.resolve({ id }) });
}

test('401 when signed out — nothing built', async () => {
  const res = await build('sys_x');
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not authenticated' });
  assert.equal(builds.length, 0);
});

test('403 for a non-owner — nothing built', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await build(s.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to edit this system' });
  assert.equal(builds.length, 0);
  assert.equal(__recordFor(s.id)!.lastBuild, undefined);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  const res = await build('sys_nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'System not found' });
});

test('200 builds the governed yaml, records lastBuild and clears the activity marker', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await build(s.id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, rows: [{ stage: 'commit', ok: true }], mode: 'offline-mock' });
  assert.equal(builds.length, 1);
  assert.equal(builds[0].id, s.id);
  const rec = __recordFor(s.id)!;
  assert.equal(rec.lastBuild?.ok, true);
  assert.deepEqual(rec.lastBuild?.rows, [{ stage: 'commit', ok: true }]);
  assert.equal(rec.activity, undefined, 'building marker cleared');
});

test('a failing build returns its error and still clears the activity marker', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  BUILD = async () => { throw Object.assign(new Error('Forgejo is down'), { status: 502 }); };
  const res = await build(s.id);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'Forgejo is down' });
  assert.equal(__recordFor(s.id)!.activity, undefined);
});

test('an untagged build error defaults to 500', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  BUILD = async () => { throw new Error('boom'); };
  assert.equal((await build(s.id)).status, 500);
});
