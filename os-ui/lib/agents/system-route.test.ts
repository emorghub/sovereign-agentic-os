/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of GET / POST / DELETE /api/agents/systems/[id]. The external side
 * effects (k8s CronJob reconcile, Forgejo repo delete) are stubbed; the store is real.
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
const reconciled: string[] = [];
mock.module('@/lib/agents/schedule-cron', {
  namedExports: {
    isValidCron,
    reconcileScheduleCron: async (id: string) => {
      reconciled.push(id);
      return { ok: true, live: false, action: 'noop', name: 'cron-' + id, detail: 'stub' };
    },
  },
});
const deletedRepos: string[] = [];
mock.module('@/lib/agents/build/live-clients', {
  namedExports: {
    realForgejo: () => ({
      deleteRepo: async (repo: string) => { deletedRepos.push(repo); return { deleted: true }; },
    }),
  },
});

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; reconciled.length = 0; deletedRepos.length = 0; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function route() {
  return import(`../../app/api/agents/systems/[id]/route.ts?${Math.random()}`);
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function get(id: string) {
  return (await route()).GET(new Request(`http://x/api/agents/systems/${id}`), ctx(id));
}
async function post(id: string, body: unknown) {
  return (await route()).POST(
    new Request(`http://x/api/agents/systems/${id}`, { method: 'POST', body: JSON.stringify(body) }),
    ctx(id),
  );
}
async function del(id: string) {
  return (await route()).DELETE(new Request(`http://x/api/agents/systems/${id}`, { method: 'DELETE' }), ctx(id));
}

test('401 when signed out (GET / POST / DELETE)', async () => {
  assert.equal((await get('sys_x')).status, 401);
  assert.equal((await post('sys_x', { action: 'archive' })).status, 401);
  assert.equal((await del('sys_x')).status, 401);
});

// ---------------------------------------------------------------- GET --

test('GET 200 returns the system view for the owner', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Campaign bot' });
  const res = await get(s.id);
  assert.equal(res.status, 200);
  const v = (await res.json()) as Record<string, unknown>;
  assert.equal(v.id, s.id);
  assert.equal(v.name, 'Campaign bot');
  assert.equal(v.owner, 'sara');
  assert.equal(v.visibility, 'Personal');
  assert.equal(v.canEdit, true);
  assert.equal(v.canRun, true);
  assert.equal(v.role, 'domain_admin');
  assert.equal(v.archived, false);
  assert.ok(v.system && typeof v.system === 'object', 'parsed system is returned');
  assert.ok('ir' in v && 'compileError' in v);
});

test('GET 403 for a non-owner of a Personal system', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await get(s.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to view this system' });
});

test('GET 404 for an unknown system', async () => {
  USER = SARA;
  const res = await get('sys_nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'System not found' });
});

// --------------------------------------------------------------- POST --

test('POST 400 for an unknown action', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await post(s.id, { action: 'explode' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Unknown action' });
});

test('POST rename: 200 renames, 400 on a blank name', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Old' });
  let res = await post(s.id, { action: 'rename', name: '  New name ' });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { system: { name: string } }).system.name, 'New name');
  assert.equal(__recordFor(s.id)!.name, 'New name');

  res = await post(s.id, { action: 'rename', name: '   ' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'a system needs a name' });
});

test('POST archive / unarchive flips the flag and reconciles the CronJob', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  let res = await post(s.id, { action: 'archive' });
  assert.equal(res.status, 200);
  assert.equal(__recordFor(s.id)!.archived, true);
  assert.equal(__recordFor(s.id)!.running, false);

  res = await post(s.id, { action: 'unarchive' });
  assert.equal(res.status, 200);
  assert.equal(__recordFor(s.id)!.archived, false);
  assert.deepEqual(reconciled, [s.id, s.id]);
});

test('POST 403 for a non-owner — nothing changed', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await post(s.id, { action: 'archive' });
  assert.equal(res.status, 403);
  assert.notEqual(__recordFor(s.id)!.archived, true);
  assert.equal(reconciled.length, 0);
});

// ------------------------------------------------------------- DELETE --

test('DELETE 403 for a non-owner — nothing purged', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await del(s.id);
  assert.equal(res.status, 403);
  assert.ok(__recordFor(s.id), 'record still exists');
  assert.equal(deletedRepos.length, 0);
});

test('DELETE 404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await del('sys_nope')).status, 404);
});

test('DELETE 200 removes the record and purges its backing resources', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await del(s.id);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; physical: { recordDeleted: boolean; physical: { ok: boolean }[] } };
  assert.equal(json.ok, true);
  assert.equal(json.physical.recordDeleted, true);
  assert.ok(json.physical.physical.every((p) => p.ok), 'every purge target reported ok');
  assert.equal(__recordFor(s.id), undefined);
});
