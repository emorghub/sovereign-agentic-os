/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of POST /api/agents/systems/[id]/probe — a governed test call of one connection. */

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

const probes: { id: string; opts: { connectionId: string; write: boolean; requestedBy: string } }[] = [];
mock.module('@/lib/agents/build/server', {
  namedExports: {
    // tripwire: this route must not call these — a stray call fails loudly instead of doing real I/O
    buildSystem: async () => { throw new Error('not used'); },
    runSystem: async () => { throw new Error('not used'); },
    probeConnection: async (_sys: unknown, id: string, opts: { connectionId: string; write: boolean; requestedBy: string }) => {
      probes.push({ id, opts });
      return { effect: 'allow', reason: 'stub', held: false };
    },
  },
});

const { __resetStore, createSystem } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; probes.length = 0; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function probe(id: string, body: unknown) {
  const r = await import(`../../app/api/agents/systems/[id]/probe/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/probe`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out', async () => {
  assert.equal((await probe('sys_x', { connectionId: 'c1' })).status, 401);
  assert.equal(probes.length, 0);
});

test('400 when connectionId is missing', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await probe(s.id, {});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'connectionId is required.' });
});

test('403 for a non-owner — nothing probed', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await probe(s.id, { connectionId: 'c1' });
  assert.equal(res.status, 403);
  assert.equal(probes.length, 0);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await probe('sys_nope', { connectionId: 'c1' })).status, 404);
});

test('200 returns the probe decision; write flag + requester are passed through', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  let res = await probe(s.id, { connectionId: 'c1' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { effect: 'allow', reason: 'stub', held: false });
  assert.deepEqual(probes[0], { id: s.id, opts: { connectionId: 'c1', write: false, requestedBy: 'sara' } });

  res = await probe(s.id, { connectionId: 'c1', write: true });
  assert.equal(res.status, 200);
  assert.equal(probes[1].opts.write, true);
});
