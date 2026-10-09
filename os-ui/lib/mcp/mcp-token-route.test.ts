/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET /api/mcp/token — mint the caller's personal MCP bearer. */

process.env.OS_PUBLIC_URL = 'https://os.example.test';

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

const AMIR: U = { id: 'amir', name: 'Amir', domains: ['sales'], role: 'builder' };

beforeEach(() => { USER = null; });

const route = await import('../../app/api/mcp/token/route.ts');
const { verifyMcpToken } = await import('./token.ts');

const get = () => route.GET(new Request('http://x/api/mcp/token'), { params: Promise.resolve({}) });

test('401 when signed out — no token minted', async () => {
  const res = await get();
  assert.equal(res.status, 401);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.token, undefined);
});

test('200 → endpoint, path, a verifiable token bound to the caller, and their identity', async () => {
  USER = AMIR;
  const res = await get();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, string>;
  assert.equal(body.endpoint, 'https://os.example.test/api/mcp');
  assert.equal(body.path, '/api/mcp');
  assert.ok(body.token.length > 0);
  assert.equal(verifyMcpToken(body.token)?.id, 'amir', 'token is signed for the caller');
  assert.equal(body.role, 'builder');
  assert.equal(body.id, 'amir');
  assert.equal(body.name, 'Amir');
});
