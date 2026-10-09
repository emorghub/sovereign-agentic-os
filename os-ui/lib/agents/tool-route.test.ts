/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Behaviour of POST /api/agents/tool — the governed tool door the agent runtime calls.
 * Gate = shared runtime bearer. Authorization is REAL (app-registry grant, else OPA);
 * only the network (OPA / Langfuse) is faked through globalThis.fetch.
 */

process.env.AGENT_RUNTIME_TOKEN = 'test-token';

const { __resetStore, createSystem } = await import('./store.ts');
const { registerConnection } = await import('../infra/app-registry.ts');
const { recentTraces } = await import('../infra/agent-governed.ts');

const SARA = { id: 'sara', domains: ['sales'], role: 'domain_admin' as const };

/** Every outbound call fails (OPA + Langfuse unreachable) unless a test overrides it. */
function offline() {
  mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
}
beforeEach(() => { __resetStore(); offline(); });
afterEach(() => mock.restoreAll());

function grant(systemId: string, tools: string[]) {
  registerConnection({
    id: `conn-${systemId}`,
    appId: systemId,
    name: 'test grant',
    principal: `os-${systemId}`,
    tools: tools.map((name) => ({ name, description: name, write: false })),
    owner: 'sara',
    domain: 'sales',
    visibility: 'Personal',
    createdAt: new Date().toISOString(),
  } as Parameters<typeof registerConnection>[0]);
}

async function post(body: unknown, authorization?: string) {
  const r = await import(`../../app/api/agents/tool/route.ts?${Math.random()}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return r.POST(new Request('http://x/api/agents/tool', { method: 'POST', headers, body: JSON.stringify(body) }));
}

test('401 without / with a wrong runtime token', async () => {
  for (const h of [undefined, 'Bearer wrong-token', 'Bearer ']) {
    const res = await post({ systemId: 's', tool: 't' }, h);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  }
});

test('400 when systemId or tool is missing', async () => {
  for (const body of [{}, { systemId: 's' }, { tool: 't' }]) {
    const res = await post(body, 'Bearer test-token');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'systemId and tool are required' });
  }
});

test('ungranted tool + OPA unreachable → deny (fail-closed), not executed, still traced', async () => {
  const s = createSystem(SARA, { name: 'A' });
  const res = await post({ systemId: s.id, node: 'n1', tool: 'delete_everything' }, 'Bearer test-token');
  assert.equal(res.status, 200);
  const json = (await res.json()) as { effect: string; reason: string; output: { held: boolean } };
  assert.equal(json.effect, 'deny');
  assert.match(json.reason, /failing closed/);
  assert.deepEqual(json.output, { held: false });
  const t = recentTraces(1)[0];
  assert.equal(t.tool, 'delete_everything');
  assert.equal(t.principal, `os-${s.id}:n1`);
  assert.equal(t.decision, 'deny');
});

test('unknown system → deny (no grants can resolve for it)', async () => {
  const res = await post({ systemId: 'sys_nope', tool: 'custom_tool' }, 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { effect: string }).effect, 'deny');
});

test('OPA says requires_approval → held, not executed', async () => {
  const s = createSystem(SARA, { name: 'A' });
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (url: string) =>
    String(url).includes('/v1/data/agentic/authz/decision')
      ? new Response(JSON.stringify({ result: { effect: 'requires_approval', reason: 'needs a human' } }), { status: 200 })
      : new Response('{}', { status: 200 }),
  );
  const res = await post({ systemId: s.id, tool: 'send_email', write: true }, 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { effect: 'requires_approval', reason: 'needs a human', output: { held: true } });
});

test('granted tool → allow, side effect runs and is traced', async () => {
  const s = createSystem(SARA, { name: 'A' });
  grant(s.id, ['custom_tool']);
  const res = await post({ systemId: s.id, tool: 'custom_tool', args: { a: 1 } }, 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    effect: 'allow',
    reason: 'granted by the app MCP connection',
    output: { ok: true, tool: 'custom_tool', note: 'governed tool invoked' },
  });
  const t = recentTraces(1)[0];
  assert.equal(t.principal, `os-${s.id}:run`);
  assert.equal(t.decision, 'allow');
  assert.deepEqual(t.input, { a: 1, write: false });
});
