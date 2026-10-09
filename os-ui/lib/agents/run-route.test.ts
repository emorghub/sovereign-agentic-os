/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of POST /api/agents/systems/[id]/run. Two execution paths are covered:
 *  • agentic-os team (the starter system grants `search_knowledge`) → runOsTeam,
 *    both as JSON and as a text/event-stream;
 *  • runtime fallback (a system with no granted tools) → runSystem.
 * Both executors are stubbed; the store, run-vs-edit authz and owner-grant
 * governance are real.
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

type Team = { path: string[]; finalText: string; runs: unknown[] };
type TeamInput = {
  systemId: string;
  messages: { role: string; content: string }[];
  disabledAgents?: string[];
  user: { id: string };
  onNodeStart?: (ev: { node: string }) => void;
  onNodeComplete?: (ev: { node: string; status: string; finalText: string }) => void;
  onStep?: (ev: unknown) => void;
};
const okTeam = (): Team => ({
  path: ['assistant'],
  finalText: 'All good.',
  runs: [{ node: 'assistant', model: 'm', status: 'ok', result: { finalText: 'All good.', steps: [] } }],
});
let TEAM: (input: TeamInput) => Promise<Team> = async () => okTeam();
const teamRuns: TeamInput[] = [];
mock.module('@/lib/agents/build/agentic-graph-server', {
  namedExports: {
    runOsTeam: async (input: TeamInput) => {
      teamRuns.push(input);
      input.onNodeStart?.({ node: 'assistant' });
      const t = await TEAM(input);
      input.onNodeComplete?.({ node: 'assistant', status: 'ok', finalText: t.finalText });
      return t;
    },
    // tripwire: this route must not call runPhaseTurn — a stray call fails loudly instead of doing real I/O
    runPhaseTurn: async () => { throw new Error('not used'); },
    handoffBudget: () => 0,
    preamble: () => '',
    osPreamble: () => '',
  },
});

type RunOpts = { prompt: string; requestedBy: string; disabledAgents: string[] };
let RUN: () => Promise<Record<string, unknown>> = async () => ({ ok: true, mode: 'offline-mock', path: ['assistant'], steps: [], output: 'done', traces: 1 });
const runtimeRuns: { id: string; opts: RunOpts }[] = [];
mock.module('@/lib/agents/build/server', {
  namedExports: {
    // tripwire: this route must not call these — a stray call fails loudly instead of doing real I/O
    buildSystem: async () => { throw new Error('not used'); },
    probeConnection: async () => { throw new Error('not used'); },
    runSystem: async (id: string, _yaml: string, opts: RunOpts) => {
      runtimeRuns.push({ id, opts });
      return RUN();
    },
  },
});

const { __resetStore, createSystem, promoteSystem, setRunning, __recordFor } = await import('./store.ts');
const { parseSystem, serializeSystem } = await import('./system-schema.ts');

beforeEach(() => {
  __resetStore();
  USER = null;
  teamRuns.length = 0;
  runtimeRuns.length = 0;
  TEAM = async () => okTeam();
  RUN = async () => ({ ok: true, mode: 'offline-mock', path: ['assistant'], steps: [], output: 'done', traces: 1 });
});

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'domain_admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['sales'], role: 'builder' };
const CARA: U = { id: 'cara', name: 'Cara', domains: ['sales'], role: 'creator' };

/** A system with NO granted tools — not an agentic-os team → runtime path. */
function runtimeSystem() {
  const s = createSystem(SARA, { name: 'Legacy' });
  const sys = parseSystem(__recordFor(s.id)!.yaml);
  sys.grants.tools = [];
  for (const a of sys.agents) a.tools = [];
  __recordFor(s.id)!.yaml = serializeSystem(sys);
  return s;
}

async function run(id: string, body: unknown = {}, headers: Record<string, string> = {}) {
  const r = await import(`../../app/api/agents/systems/[id]/run/route.ts?${Math.random()}`);
  return r.POST(
    new Request(`http://x/api/agents/systems/${id}/run`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

// ----------------------------------------------------------- gates --

test('401 when signed out — nothing runs', async () => {
  const res = await run('sys_x');
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not authenticated' });
  assert.equal(teamRuns.length + runtimeRuns.length, 0);
});

test('403 for a non-owner of a Personal system — nothing runs', async () => {
  const s = createSystem(SARA, { name: 'A' });
  USER = KENJI;
  const res = await run(s.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Not permitted to run this system' });
  assert.equal(teamRuns.length + runtimeRuns.length, 0);
  assert.equal(__recordFor(s.id)!.activity, undefined);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  const res = await run('sys_nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'System not found' });
});

// --------------------------------------------- agentic-os team path --

test('team 200: runs with the default task, persists lastRun, clears the marker', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await run(s.id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { team: boolean; ok: boolean; finalText: string; path: string[]; running: boolean };
  assert.equal(body.team, true);
  assert.equal(body.ok, true);
  assert.equal(body.finalText, 'All good.');
  assert.deepEqual(body.path, ['assistant']);
  assert.equal(body.running, false);

  assert.equal(teamRuns.length, 1);
  assert.equal(runtimeRuns.length, 0);
  assert.equal(teamRuns[0].systemId, s.id);
  assert.equal(teamRuns[0].user.id, 'sara');
  assert.match(teamRuns[0].messages[0].content, /^Do your standard job as the /);

  const rec = __recordFor(s.id)!;
  assert.equal(rec.lastRun?.ok, true);
  assert.equal(rec.lastRun?.output, 'All good.');
  assert.equal(rec.lastRun?.mode, 'live');
  assert.equal(rec.activity, undefined, 'running marker cleared');
});

test('team: a custom prompt and the disabled agents are passed through', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  __recordFor(s.id)!.disabledAgents = ['helper'];
  await run(s.id, { prompt: '  Summarise Q3  ' });
  assert.deepEqual(teamRuns[0].messages, [{ role: 'user', content: 'Summarise Q3' }]);
  assert.deepEqual(teamRuns[0].disabledAgents, ['helper']);
});

test('team: a failing node is reported ok:false', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  TEAM = async () => ({ ...okTeam(), runs: [{ node: 'assistant', model: 'm', status: 'error', error: 'llm down', result: { finalText: '', steps: [] } }] });
  const body = (await (await run(s.id)).json()) as { ok: boolean };
  assert.equal(body.ok, false);
  assert.equal(__recordFor(s.id)!.lastRun?.ok, false);
});

test('team: an executor crash returns 500 and still clears the marker', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  TEAM = async () => { throw new Error('graph exploded'); };
  const res = await run(s.id);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'graph exploded' });
  assert.equal(__recordFor(s.id)!.activity, undefined);
});

test('team stream: text/event-stream emits node-started, node-completed, done', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  const res = await run(s.id, { stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
  const text = await res.text();
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(events, ['node-started', 'node-completed', 'done']);
  assert.match(text, /"finalText":"All good\."/);
  assert.equal(__recordFor(s.id)!.lastRun?.ok, true);
  assert.equal(__recordFor(s.id)!.activity, undefined, 'marker cleared when the stream closes');
});

test('team stream: Accept: text/event-stream also streams; a crash becomes an error event', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  TEAM = async () => { throw new Error('graph exploded'); };
  const res = await run(s.id, {}, { accept: 'text/event-stream' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /^event: error\ndata: \{"error":"graph exploded"\}/m);
  assert.equal(__recordFor(s.id)!.activity, undefined);
});

test('run ≠ edit: an in-domain Creator may RUN a Shared system she cannot edit', async () => {
  const s = createSystem(SARA, { name: 'Shared bot' });
  promoteSystem(s.id, SARA);
  USER = CARA;
  const res = await run(s.id);
  assert.equal(res.status, 200);
  assert.equal(teamRuns[0].user.id, 'cara');
});

// --------------------------------------------------- runtime path --

test('runtime 200: a system with no granted tools goes through runSystem', async () => {
  USER = SARA;
  const s = runtimeSystem();
  const res = await run(s.id, { prompt: 'Go' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.running, false);
  assert.equal(body.output, 'done');
  assert.equal(teamRuns.length, 0);
  assert.deepEqual(runtimeRuns.map((r) => [r.id, r.opts.prompt, r.opts.requestedBy]), [[s.id, 'Go', 'sara']]);
  const rec = __recordFor(s.id)!;
  assert.equal(rec.lastRun?.output, 'done');
  assert.deepEqual(rec.lastRun?.path, ['assistant']);
  assert.equal(rec.activity, undefined);
});

test('runtime: a failure returns 500 and still clears the marker', async () => {
  USER = SARA;
  const s = runtimeSystem();
  RUN = async () => { throw new Error('runtime unreachable'); };
  const res = await run(s.id);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'runtime unreachable' });
  assert.equal(__recordFor(s.id)!.activity, undefined);
});

// ------------------------------------------------------------- stop --

test('stop: true stops a running system without running it', async () => {
  USER = SARA;
  const s = createSystem(SARA, { name: 'A' });
  setRunning(s.id, SARA, true);
  const res = await run(s.id, { stop: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { running: false });
  assert.equal(__recordFor(s.id)!.running, false);
  assert.equal(teamRuns.length + runtimeRuns.length, 0);
});

test('stop: true is edit-scoped — a non-owner gets 403', async () => {
  const s = createSystem(SARA, { name: 'A' });
  setRunning(s.id, SARA, true);
  USER = KENJI;
  const res = await run(s.id, { stop: true });
  assert.equal(res.status, 403);
  assert.equal(__recordFor(s.id)!.running, true);
});
