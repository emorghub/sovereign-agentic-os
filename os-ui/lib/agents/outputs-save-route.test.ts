/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/outputs/save — persist the run result
 * into a DECLARED output through the tab's own governed create. The files /
 * knowledge / data stores are real; only the network-bound CSV ingest is stubbed.
 */

// Offline: the stores' durable mirrors fall back to in-memory when fetch fails.
globalThis.fetch = (() => Promise.reject(new Error('offline-stub'))) as typeof fetch;

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

let INGEST_OK = true;
const ingests: { datasetId: string; fileName: string; body: string }[] = [];
mock.module('@/lib/experimental/data/ingest', {
  namedExports: {
    ingestAndRegisterBronze: async (_u: unknown, datasetId: string, fileName: string, body: Buffer) => {
      ingests.push({ datasetId, fileName, body: body.toString('utf8') });
      return INGEST_OK
        ? { ok: true, report: { ok: true, mode: 'test', columns: [] }, dataset: null }
        : { ok: false, report: { ok: false, mode: 'trino-down', columns: [] }, dataset: null };
    },
  },
});

const { __resetStore, createSystem, promoteSystem, setLastRun } = await import('./store.ts');
const { parseSystem, serializeSystem } = await import('./system-schema.ts');
const { listFiles } = await import('../experimental/files/store.ts');
const { getPersonalKnowledge } = await import('../experimental/knowledge/personal-store.ts');
const { getDataset, __resetStore: resetData } = await import('../experimental/data/store.ts');

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['finance'], role: 'builder' };

beforeEach(() => {
  __resetStore();
  resetData();
  USER = null;
  INGEST_OK = true;
  ingests.length = 0;
});

const OUTPUTS = [
  { kind: 'files', name: 'weekly-report', folder: { path: '/reports', scope: 'personal' } },
  { kind: 'knowledge', name: 'Lessons', folder: { path: '/notes', scope: 'personal' } },
  { kind: 'data', name: 'scores', folder: { path: '/', scope: 'personal' } },
] as const;
const IDX = { files: 0, knowledge: 1, data: 2 };
const CSV = 'name,score\nann,3\nbob,5';

/** A Sara-owned system that declares the three outputs above. */
function systemWithOutputs() {
  const base = createSystem(SARA, { name: 'Desk' });
  const sys = parseSystem(base.yaml);
  sys.outputs = OUTPUTS.map((o) => ({ ...o, folder: { ...o.folder } }));
  return createSystem(SARA, { name: 'Desk', yaml: serializeSystem(sys) });
}

async function save(id: string, body: Record<string, unknown>) {
  const r = await import(`../../app/api/agents/systems/[id]/outputs/save/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/outputs/save`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out', async () => {
  assert.equal((await save('sys_x', { index: 0, text: 'x' })).status, 401);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await save('sys_nope', { index: 0, text: 'x' })).status, 404);
});

test('403 when the caller cannot view the system', async () => {
  const s = systemWithOutputs();
  promoteSystem(s.id, SARA);
  USER = KENJI;
  assert.equal((await save(s.id, { index: IDX.files, text: 'x' })).status, 403);
});

test('400 "No such declared output." for a bad / missing index', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  for (const body of [{ index: 99, text: 'x' }, { text: 'x' }, { index: '0', text: 'x' }]) {
    const res = await save(s.id, body);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'No such declared output.');
  }
});

test('400 "no run result" when there is no text and no persisted run', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  const res = await save(s.id, { index: IDX.files, text: '  ' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /no run result to save yet/);
});

test('400 for a data output when the result is not tabular — no dataset is ingested', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  const res = await save(s.id, { index: IDX.data, text: 'just prose, no table' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /not tabular/);
  assert.equal(ingests.length, 0);
});

test('200 files → a .md file in the declared folder, owned by the caller', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  const res = await save(s.id, { index: IDX.files, text: '# Report' });
  assert.equal(res.status, 200);
  const { saved } = (await res.json()) as { saved: { kind: string; id: string; name: string; folder: string } };
  assert.equal(saved.kind, 'files');
  assert.equal(saved.name, 'weekly-report.md');
  assert.equal(saved.folder, '/reports');
  assert.ok(listFiles(SARA).mine.some((f) => f.id === saved.id && f.folder === '/reports'));
});

test('200 knowledge → a My-knowledge note; falls back to the persisted last run text', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  setLastRun(s.id, SARA, { at: 1, running: false, ok: true, path: [], traces: 0, held: 0, steps: [], output: 'Persisted lesson' });
  const res = await save(s.id, { index: IDX.knowledge });
  assert.equal(res.status, 200);
  const { saved } = (await res.json()) as { saved: { kind: string; id: string; name: string } };
  assert.equal(saved.kind, 'knowledge');
  const note = getPersonalKnowledge(saved.id, SARA);
  assert.equal(note.title, 'Lessons');
  assert.equal(note.md, 'Persisted lesson');
});

test('200 data → a dataset is created and the CSV ingested as its Bronze', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  const res = await save(s.id, { index: IDX.data, text: CSV });
  assert.equal(res.status, 200);
  const { saved } = (await res.json()) as { saved: { kind: string; id: string; name: string } };
  assert.equal(saved.kind, 'data');
  assert.equal(getDataset(saved.id, SARA).name, 'scores');
  assert.deepEqual(ingests, [{ datasetId: saved.id, fileName: 'scores.csv', body: CSV }]);
});

test('502 when the ingest fails after the dataset was created', async () => {
  USER = SARA;
  INGEST_OK = false;
  const s = systemWithOutputs();
  const res = await save(s.id, { index: IDX.data, text: CSV });
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /could not be ingested \(trino-down\)/);
});

test('saving the same data output twice → 409 (the dataset name is taken), nothing re-ingested', async () => {
  USER = SARA;
  const s = systemWithOutputs();
  assert.equal((await save(s.id, { index: IDX.data, text: CSV })).status, 200);
  const res = await save(s.id, { index: IDX.data, text: CSV });
  assert.equal(res.status, 409);
  assert.equal(ingests.length, 1);
});
