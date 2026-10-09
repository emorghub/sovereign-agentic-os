/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of POST /api/agents/systems/[id]/demote — revoke sharing one rung down. */

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

const { __resetStore, createSystem, promoteSystem, __recordFor } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const CARA: U = { id: 'cara', name: 'Cara', domains: ['sales'], role: 'creator' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['finance'], role: 'builder' };

function sharedSystem() {
  const s = createSystem(SARA, { name: 'Shared bot' });
  promoteSystem(s.id, SARA);
  return s;
}

async function demote(id: string) {
  const r = await import(`../../app/api/agents/systems/[id]/demote/route.ts?${Math.random()}`);
  return r.POST(new Request(`http://x/api/agents/systems/${id}/demote`, { method: 'POST' }), { params: Promise.resolve({ id }) });
}

test('401 when signed out', async () => {
  assert.equal((await demote('sys_x')).status, 401);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await demote('sys_nope')).status, 404);
});

test('409 when the system is already Personal', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await demote(s.id);
  assert.equal(res.status, 409);
});

test('403 for an out-of-domain user — still Shared', async () => {
  const s = sharedSystem();
  USER = KENJI;
  const res = await demote(s.id);
  assert.equal(res.status, 403);
  assert.equal(__recordFor(s.id)!.visibility, 'Shared');
});

test('403 for an in-domain Creator who is not the owner — still Shared', async () => {
  const s = sharedSystem();
  USER = CARA;
  const res = await demote(s.id);
  assert.equal(res.status, 403);
  assert.equal(__recordFor(s.id)!.visibility, 'Shared');
});

test('200 — the owner unshares Shared → Personal', async () => {
  const s = sharedSystem();
  USER = SARA;
  const res = await demote(s.id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: s.id, visibility: 'Personal' });
  assert.equal(__recordFor(s.id)!.visibility, 'Personal');
});
