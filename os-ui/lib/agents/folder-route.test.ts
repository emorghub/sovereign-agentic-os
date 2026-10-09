/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of POST /api/agents/systems/[id]/folder — move a system into a folder. */

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

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function move(id: string, body: unknown) {
  const r = await import(`../../app/api/agents/systems/[id]/folder/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/folder`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out', async () => {
  assert.equal((await move('sys_x', { folder: '/a' })).status, 401);
});

test('400 when folder is missing', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await move(s.id, {});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'a folder path is required' });
});

test('403 for a non-owner — nothing written', async () => {
  const s = createSystem(SARA, { name: 'A' });
  const before = __recordFor(s.id)!.folder;
  USER = KENJI;
  const res = await move(s.id, { folder: '/stolen' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to edit this system' });
  assert.equal(__recordFor(s.id)!.folder, before);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  const res = await move('sys_nope', { folder: '/a' });
  assert.equal(res.status, 404);
});

test('200 moves the system into the folder', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await move(s.id, { folder: '/campaigns/q3' });
  assert.equal(res.status, 200);
  const { system } = (await res.json()) as { system: { id: string; folder: string } };
  assert.equal(system.id, s.id);
  assert.equal(system.folder, __recordFor(s.id)!.folder);
  assert.match(__recordFor(s.id)!.folder ?? '', /campaigns\/q3/);
});
