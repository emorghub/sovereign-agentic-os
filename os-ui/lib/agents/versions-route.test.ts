/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of GET + POST /api/agents/systems/[id]/versions. Two sources: the git
 * history in Forgejo (faked client) and, when Forgejo has none / is down, the in-store
 * snapshot log (real). The post-restore reload (buildSystem) is stubbed.
 */

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

type Commit = { sha: string; date: string; author: string; message: string };
// null = Forgejo unreachable / repo has no history.
let COMMITS: Commit[] | null = null;
let COMMIT_FILES: Record<string, string> = {};
const writes: { repo: string; path: string; message: string }[] = [];
mock.module('@/lib/agents/build/live-clients', {
  namedExports: {
    realForgejo: () => ({
      listCommits: async () => COMMITS,
      getCommitFiles: async () => COMMIT_FILES,
      readFile: async () => ({ sha: 'blob-1' }),
      writeFile: async (repo: string, path: string, _content: string, _sha: string, message: string) => {
        writes.push({ repo, path, message });
        return { sha: 'newcommit123' };
      },
    }),
  },
});
const reloads: string[] = [];
mock.module('@/lib/agents/build/server', {
  namedExports: {
    buildSystem: async (id: string) => { reloads.push(id); return { ok: true, rows: [], mode: 'offline-mock' }; },
    // tripwire: this route must not call these — a stray call fails loudly instead of doing real I/O
    runSystem: async () => { throw new Error('not used'); },
    probeConnection: async () => { throw new Error('not used'); },
  },
});

const { __resetStore, createSystem, renameAgentSystem, listSystemVersions, __recordFor } = await import('./store.ts');
const { parseSystem, serializeSystem } = await import('./system-schema.ts');

beforeEach(() => {
  __resetStore();
  USER = null;
  COMMITS = null;
  COMMIT_FILES = {};
  writes.length = 0;
  reloads.length = 0;
});

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };

async function route() {
  return import(`../../app/api/agents/systems/[id]/versions/route.ts?${Math.random()}`);
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function get(id: string) {
  return (await route()).GET(new Request(`http://x/api/agents/systems/${id}/versions`), ctx(id));
}
async function restore(id: string, body: unknown) {
  return (await route()).POST(
    new Request(`http://x/api/agents/systems/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),
    ctx(id),
  );
}

test('401 when signed out (GET + POST)', async () => {
  assert.equal((await get('sys_x')).status, 401);
  assert.equal((await restore('sys_x', { version: 1 })).status, 401);
});

// ---------------------------------------------------------------- GET --

test('GET 200 source=git when Forgejo has history (newest = version 0)', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  COMMITS = [
    { sha: 'bbbbbbbb22', date: '2026-10-02T00:00:00Z', author: 'sara', message: 'second build\n\nbody' },
    { sha: 'aaaaaaaa11', date: '2026-10-01T00:00:00Z', author: 'sara', message: 'first build' },
  ];
  const res = await get(s.id);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    source: 'git',
    versions: [
      { version: 0, at: '2026-10-02T00:00:00Z', author: 'sara', summary: 'second build' },
      { version: 1, at: '2026-10-01T00:00:00Z', author: 'sara', summary: 'first build' },
    ],
  });
});

test('GET 200 source=snapshot when Forgejo has no history', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Old' });
  renameAgentSystem(s.id, SARA, 'New'); // records one snapshot
  const res = await get(s.id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { source: string; versions: { version: number; summary: string }[] };
  assert.equal(body.source, 'snapshot');
  assert.equal(body.versions.length, 1);
  assert.equal(body.versions[0].summary, 'rename');
});

test('GET 403 for a non-owner (git branch never consulted)', async () => {
  const s = createSystem(SARA, { name: 'A' });
  COMMITS = [{ sha: 'aaaaaaaa11', date: 'd', author: 'sara', message: 'x' }];
  USER = KENJI;
  const res = await get(s.id);
  assert.equal(res.status, 403);
});

test('GET 404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await get('sys_nope')).status, 404);
});

// --------------------------------------------------------------- POST --

test('POST 400 without a numeric version', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  for (const body of [{}, { version: '1' }]) {
    const res = await restore(s.id, body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'A version number is required.' });
  }
});

test('POST 403 for a non-owner — nothing restored', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await restore(s.id, { version: 1 });
  assert.equal(res.status, 403);
  assert.equal(writes.length, 0);
});

test('POST snapshot restore brings back the earlier yaml', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const original = __recordFor(s.id)!.yaml;
  // A file write snapshots the prior yaml, then changes it.
  const { writeFile, readFile } = await import('./store.ts');
  const cur = readFile(s.id, SARA, 'agents/assistant/AGENT.md');
  writeFile(s.id, SARA, { path: 'agents/assistant/AGENT.md', content: 'changed', sha: cur.sha });
  assert.notEqual(__recordFor(s.id)!.yaml, original);

  const [v] = listSystemVersions(s.id, SARA);
  const res = await restore(s.id, { version: v.version });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; source: string };
  assert.equal(body.id, s.id);
  assert.equal(body.source, 'snapshot');
  assert.equal(__recordFor(s.id)!.yaml, original);
});

test('POST snapshot restore of an unknown version → 404', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await restore(s.id, { version: 99 });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Version 99 not found' });
});

test('POST git restore re-commits the chosen build, applies its yaml and reloads', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const sys = parseSystem(__recordFor(s.id)!.yaml);
  sys.agents[0].agent_md = 'restored prompt';
  const yaml = serializeSystem(sys);
  COMMITS = [
    { sha: 'headhead00', date: 'd2', author: 'sara', message: 'current' },
    { sha: 'oldoldold1', date: 'd1', author: 'sara', message: 'older' },
  ];
  COMMIT_FILES = { 'system.yaml': yaml };
  const res = await restore(s.id, { version: 1 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; source: string; sha: string };
  assert.equal(body.source, 'git');
  assert.equal(body.sha, 'oldoldold1');
  assert.deepEqual(writes, [{ repo: `os-${s.id}`, path: 'system.yaml', message: 'restore of oldoldol (by sara)' }]);
  assert.equal(__recordFor(s.id)!.yaml, yaml);
  assert.deepEqual(reloads, [s.id]);
});
