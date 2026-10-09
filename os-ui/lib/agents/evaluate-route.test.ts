/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/evaluate — the LLM judge over the last
 * run's output. The ONE model call (assistantComplete) is stubbed; the agents store,
 * view-scope and the judge's prompt/parse logic are real.
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

type Msg = { role: string; content: string };
const JUDGE_OK = JSON.stringify({
  clarity: { score: 4, why: 'clear' },
  grounding: { score: 3, why: 'some sources' },
  actionability: { score: 5, why: 'concrete' },
});
let MODEL_REPLY = JUDGE_OK;
const modelCalls: { messages: Msg[]; opts: { user: string } }[] = [];
mock.module('@/lib/assistant/complete', {
  namedExports: {
    assistantComplete: async (messages: Msg[], opts: { user: string }) => {
      modelCalls.push({ messages, opts });
      return { content: MODEL_REPLY, model: 'test-model' };
    },
  },
});

const { __resetStore, createSystem, promoteSystem, setLastRun } = await import('./store.ts');

beforeEach(() => {
  __resetStore();
  USER = null;
  MODEL_REPLY = JUDGE_OK;
  modelCalls.length = 0;
});

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['finance'], role: 'builder' };

async function evaluate(id: string, body: Record<string, unknown> = {}) {
  const r = await import(`../../app/api/agents/systems/[id]/evaluate/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/evaluate`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

test('401 when signed out — the model is never called', async () => {
  assert.equal((await evaluate('sys_x', { output: 'x' })).status, 401);
  assert.equal(modelCalls.length, 0);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await evaluate('sys_nope', { output: 'x' })).status, 404);
});

test('403 when the caller cannot view the system', async () => {
  const s = createSystem(SARA, { name: 'Desk' });
  promoteSystem(s.id, SARA);
  USER = KENJI;
  const res = await evaluate(s.id, { output: 'x' });
  assert.equal(res.status, 403);
  assert.equal(modelCalls.length, 0);
});

test('400 "Run the team first" with no body output and no persisted run', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Desk' });
  const res = await evaluate(s.id, { output: '   ' });
  assert.equal(res.status, 400);
  const { error } = (await res.json()) as { error: string };
  assert.match(error, /^Run the team first/);
  assert.equal(modelCalls.length, 0);
});

test('200 → three scores + overall, judged as the caller', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Desk' });
  const res = await evaluate(s.id, { output: 'Do X because Y.', description: 'Triage invoices', tacitKnowledge: 'Always cite.' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scores: { dimension: string; score: number }[]; overall: number };
  assert.deepEqual(body.scores.map((x) => [x.dimension, x.score]), [['clarity', 4], ['grounding', 3], ['actionability', 5]]);
  assert.equal(body.overall, 4);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].opts.user, 'sara');
  const prompt = modelCalls[0].messages.map((m) => m.content).join('\n');
  for (const s of ['Do X because Y.', 'Triage invoices', 'Always cite.']) assert.ok(prompt.includes(s), `prompt lacks ${s}`);
});

test('200 falls back to the persisted last run output and a generated description', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'Desk' });
  setLastRun(s.id, SARA, { at: 1, running: false, ok: true, path: [], traces: 0, held: 0, steps: [], output: 'Persisted result text' });
  const res = await evaluate(s.id);
  assert.equal(res.status, 200);
  const prompt = modelCalls[0].messages.map((m) => m.content).join('\n');
  assert.ok(prompt.includes('Persisted result text'));
  assert.ok(prompt.includes('Desk'), 'falls back to a description naming the system');
});

test('a judge reply without JSON → 500 (withRoute default)', async () => {
  USER = SARA;
  MODEL_REPLY = 'I refuse to answer in JSON';
  const s = createSystem(SARA, { name: 'Desk' });
  const res = await evaluate(s.id, { output: 'x' });
  assert.equal(res.status, 500);
});
