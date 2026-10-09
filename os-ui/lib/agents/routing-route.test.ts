/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/agents/routing — the static model-routing table, signed-in only. */

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

const { ACTIVITIES, TIER_MODELS, defaultRoutingTable } = await import('./routing.ts');

beforeEach(() => { USER = null; });

async function get() {
  const r = await import(`../../app/api/agents/routing/route.ts?${Math.random()}`);
  return r.GET(new Request('http://x/api/agents/routing'), { params: Promise.resolve({}) });
}

test('401 when signed out', async () => {
  const res = await get();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not authenticated' });
});

test('200 returns activities, tiers and the default routing table', async () => {
  USER = { id: 'amir', name: 'Amir', domains: ['sales'], role: 'creator' };
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    activities: ACTIVITIES,
    tiers: TIER_MODELS,
    table: defaultRoutingTable(),
  });
});
