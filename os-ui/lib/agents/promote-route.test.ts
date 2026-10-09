/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST + GET /api/agents/systems/[id]/promote — share a system up the
 * governance ladder, or file an approval request when the caller may not promote.
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

const { __resetStore, createSystem, __recordFor } = await import('./store.ts');
const { __resetApprovals } = await import('../governance/approvals.ts');

beforeEach(() => { __resetStore(); __resetApprovals(); USER = null; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const CARA: U = { id: 'cara', name: 'Cara', domains: ['sales'], role: 'creator' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function route() {
  return import(`../../app/api/agents/systems/[id]/promote/route.ts?${Math.random()}`);
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function promote(id: string) {
  return (await route()).POST(new Request(`http://x/api/agents/systems/${id}/promote`, { method: 'POST' }), ctx(id));
}
async function pending(id: string) {
  return (await route()).GET(new Request(`http://x/api/agents/systems/${id}/promote`), ctx(id));
}

test('401 when signed out (POST + GET)', async () => {
  assert.equal((await promote('sys_x')).status, 401);
  assert.equal((await pending('sys_x')).status, 401);
});

test('POST 404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await promote('sys_nope')).status, 404);
});

test('POST 403 for a non-owner who cannot see the Personal system', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await promote(s.id);
  assert.equal(res.status, 403);
  assert.equal(__recordFor(s.id)!.visibility, 'Personal');
});

test('POST 200 — a Domain admin owner promotes Personal → Shared directly', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await promote(s.id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: s.id, visibility: 'Shared' });
  assert.equal(__recordFor(s.id)!.visibility, 'Shared');
});

test('POST 200 — a Creator owner files an approval request instead; GET shows it pending', async () => {
  USER = CARA;
  const s = createSystem(CARA, { name: 'A' });

  let res = await pending(s.id);
  assert.deepEqual(await res.json(), { request: null });

  res = await promote(s.id);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { requested: boolean; approval: { id: string; status: string } };
  assert.equal(json.requested, true);
  assert.equal(json.approval.status, 'pending');
  assert.equal(__recordFor(s.id)!.visibility, 'Personal', 'not promoted until approved');

  res = await pending(s.id);
  assert.equal(res.status, 200);
  const { request } = (await res.json()) as { request: { id: string } | null };
  assert.equal(request?.id, json.approval.id);
});
