/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/agents/tool-catalog — the role-filtered MCP tool catalog. */

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

const { buildCatalog } = await import('./tool-catalog.ts');

beforeEach(() => { USER = null; });

async function get() {
  const r = await import(`../../app/api/agents/tool-catalog/route.ts?${Math.random()}`);
  return r.GET();
}

test('401 when signed out', async () => {
  const res = await get();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not authenticated' });
});

test('200 returns the catalog filtered to the caller role', async () => {
  USER = { id: 'amir', name: 'Amir', domains: ['sales'], role: 'creator' };
  const creator = (await (await get()).json()) as { tools: { name: string }[] };
  assert.deepEqual(creator, { tools: buildCatalog('creator') });

  USER = { id: 'arya', name: 'Arya', domains: ['sales'], role: 'admin' };
  const res = await get();
  assert.equal(res.status, 200);
  const admin = (await res.json()) as { tools: { name: string }[] };
  assert.deepEqual(admin, { tools: buildCatalog('admin') });
  assert.ok(admin.tools.length >= creator.tools.length, 'admin sees at least what a creator sees');
});
