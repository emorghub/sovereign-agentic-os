/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of GET + PUT /api/agents/systems/[id]/files — the whitelisted repo files. */

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

const { __resetStore, createSystem, __recordFor, WHITELIST_HINT } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; });

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function route() {
  return import(`../../app/api/agents/systems/[id]/files/route.ts?${Math.random()}`);
}
async function get(id: string, path?: string) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return (await route()).GET(new Request(`http://x/api/agents/systems/${id}/files${qs}`), { params: Promise.resolve({ id }) });
}
async function put(id: string, body: unknown) {
  return (await route()).PUT(
    new Request(`http://x/api/agents/systems/${id}/files`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out (GET + PUT)', async () => {
  assert.equal((await get('sys_x')).status, 401);
  assert.equal((await put('sys_x', { path: 'system.yaml' })).status, 401);
});

test('GET 200 lists the whitelisted files', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await get(s.id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    files: ['system.yaml', 'agents/assistant/AGENT.md', 'agents/assistant/MEMORY.md'],
  });
});

test('GET 200 reads one file with its sha', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await get(s.id, 'system.yaml');
  assert.equal(res.status, 200);
  const f = (await res.json()) as { path: string; content: string; sha: string };
  assert.equal(f.path, 'system.yaml');
  assert.equal(f.content, __recordFor(s.id)!.yaml);
  assert.match(f.sha, /^[0-9a-f]{8}$/);
});

test('GET 403 for a non-owner of a Personal system', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await get(s.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to view this system' });
});

test('GET 403 for a non-whitelisted path', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await get(s.id, '../etc/passwd');
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: `Path '../etc/passwd' is not editable — ${WHITELIST_HINT}` });
});

test('GET 404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await get('sys_nope')).status, 404);
});

test('PUT 400 when path is missing', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await put(s.id, { content: 'x' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'A file path is required.' });
});

test('PUT 403 for a non-owner — nothing written', async () => {
  const s = createSystem(SARA, { name: 'A' });
  const yaml = __recordFor(s.id)!.yaml;
  USER = KENJI;
  const res = await put(s.id, { path: 'agents/assistant/AGENT.md', content: 'pwned' });
  assert.equal(res.status, 403);
  assert.equal(__recordFor(s.id)!.yaml, yaml);
});

test('PUT 409 on a stale sha', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await put(s.id, { path: 'agents/assistant/AGENT.md', content: 'new', sha: 'deadbeef' });
  assert.equal(res.status, 409);
});

test('PUT 200 writes AGENT.md back into the system yaml', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const cur = (await (await get(s.id, 'agents/assistant/AGENT.md')).json()) as { sha: string };
  const res = await put(s.id, { path: 'agents/assistant/AGENT.md', content: 'You are a campaign analyst.', sha: cur.sha });
  assert.equal(res.status, 200);
  const saved = (await res.json()) as { path: string; content: string; sha: string };
  assert.equal(saved.content, 'You are a campaign analyst.');
  assert.notEqual(saved.sha, cur.sha);
  const reread = (await (await get(s.id, 'agents/assistant/AGENT.md')).json()) as { content: string };
  assert.equal(reread.content, 'You are a campaign analyst.');
  assert.match(__recordFor(s.id)!.yaml, /campaign analyst/);
});
