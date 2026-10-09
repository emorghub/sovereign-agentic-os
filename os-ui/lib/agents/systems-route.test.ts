/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET + POST /api/agents/systems — list the caller's systems / create one. */

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

type Groups = { mine: { id: string; name: string }[]; domain: { id: string }[]; marketplace: { id: string }[] };

async function route() {
  return import(`../../app/api/agents/systems/route.ts?${Math.random()}`);
}
async function list(qs = '') {
  return (await route()).GET(new Request(`http://x/api/agents/systems${qs}`), { params: Promise.resolve({}) });
}
async function create(body: unknown) {
  return (await route()).POST(
    new Request('http://x/api/agents/systems', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
}

test('GET 401 when signed out', async () => {
  assert.equal((await list()).status, 401);
});

test('POST 401 when signed out', async () => {
  assert.equal((await create({ name: 'X' })).status, 401);
});

test('GET 200 lists my own systems under mine, not another user\'s Personal one', async () => {
  const mine = createSystem(SARA, { name: 'Sara bot' });
  const theirs = createSystem(KENJI, { name: 'Kenji bot' });
  USER = SARA;
  const res = await list();
  assert.equal(res.status, 200);
  const g = (await res.json()) as Groups;
  const ids = [...g.mine, ...g.domain, ...g.marketplace].map((s) => s.id);
  assert.ok(g.mine.some((s) => s.id === mine.id), 'own system is listed under mine');
  assert.ok(!ids.includes(theirs.id), 'another user\'s Personal system is not visible');
});

test('POST 400 when the name is missing or blank', async () => {
  USER = SARA;
  for (const body of [{}, { name: '   ' }, { name: 42 }]) {
    const res = await create(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'A system name is required.' });
  }
});

test('POST 200 creates a Personal system owned by the caller', async () => {
  USER = SARA;
  const res = await create({ name: 'Campaign bot' });
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };
  const rec = __recordFor(id)!;
  assert.equal(rec.name, 'Campaign bot');
  assert.equal(rec.owner, 'sara');
  assert.equal(rec.visibility, 'Personal');
  assert.equal(rec.domain, 'sales');
});

test('POST ignores a domain the caller does not belong to', async () => {
  USER = SARA;
  const res = await create({ name: 'Sneaky', domain: 'finance' });
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };
  assert.equal(__recordFor(id)!.domain, 'sales');
});
