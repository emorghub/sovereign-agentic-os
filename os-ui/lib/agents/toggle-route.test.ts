/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/toggle — the route test drives the REAL
 * in-memory store; only the session gate is mocked.
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

beforeEach(() => { __resetStore(); USER = null; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function post(id: string, body: unknown) {
  const r = await import(`../../app/api/agents/systems/[id]/toggle/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/toggle`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out', async () => {
  assert.equal((await post('sys_x', { agentId: 'assistant' })).status, 401);
});

test('400 when agentId is missing', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await post(s.id, {});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'agentId is required.' });
});

test('403 for a non-owner of a Personal system', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await post(s.id, { agentId: 'assistant' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to edit this system' });
  assert.deepEqual(__recordFor(s.id)!.disabledAgents, [], 'nothing written');
});

test('404 for an unknown system', async () => {
  USER = SARA;
  const res = await post('sys_nope', { agentId: 'assistant' });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'System not found' });
});

test('404 for an unknown agent inside the system', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await post(s.id, { agentId: 'ghost' });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Agent 'ghost' not found" });
});

test('200 turns an agent off, then back on, and persists it', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  let res = await post(s.id, { agentId: 'assistant', on: false });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { disabledAgents: ['assistant'] });
  assert.deepEqual(__recordFor(s.id)!.disabledAgents, ['assistant']);

  res = await post(s.id, { agentId: 'assistant' }); // `on` omitted ⇒ on
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { disabledAgents: [] });
  assert.deepEqual(__recordFor(s.id)!.disabledAgents, []);
});
