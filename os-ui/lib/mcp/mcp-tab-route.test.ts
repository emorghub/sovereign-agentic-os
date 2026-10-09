/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { CurrentUser } from '@/lib/core/auth';

/**
 * Behaviour of /api/mcp/[tab] — the per-tab MCP lens. Same bearer auth + JSON-RPC
 * shell as /api/mcp; only the tool subset, serverInfo and instructions differ.
 */

const ADMIN: CurrentUser = { id: 'ada', name: 'Ada', domains: ['sales'], role: 'admin' };

mock.module('@/lib/mcp/token', {
  namedExports: {
    resolveMcpUser: async (token: string | null) => (token === 'good' ? ADMIN : null),
  },
});

type Rpc = { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };

const route = await import('../../app/api/mcp/[tab]/route.ts');
const { ALL_MCP_TOOLS } = await import('./server.ts');

function post(tab: string, body: unknown, token: string | null = 'good') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return route.POST(
    new Request(`http://x/api/mcp/${tab}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ tab }) },
  );
}

const rpc = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, method, params });

test('unknown tab → 404 -32601 "Unknown MCP tab" (checked before auth)', async () => {
  const res = await post('nope', rpc('tools/list'), null);
  assert.equal(res.status, 404);
  const body = (await res.json()) as Rpc;
  assert.deepEqual(body.error, { code: -32601, message: 'Unknown MCP tab: nope' });
});

test('known tab still requires a bearer → 401', async () => {
  const res = await post('agents', rpc('tools/list'), null);
  assert.equal(res.status, 401);
});

test('agents lens: tools/list holds only agents-tab and meta tools', async () => {
  const { result } = (await (await post('agents', rpc('tools/list'))).json()) as Rpc;
  const names = (result?.tools as { name: string }[]).map((t) => t.name);
  assert.ok(names.length > 0);
  const byName = new Map(ALL_MCP_TOOLS.map((t) => [t.name, t]));
  for (const n of names) {
    const t = byName.get(n)!;
    assert.ok(t.tab === 'agents' || t.tab === 'meta' || t.extraTabs?.includes('agents'), `${n} (tab ${t.tab}) leaked into the agents lens`);
  }
  assert.ok(names.includes('whoami'), 'meta tools ride along on every lens');
  assert.ok(!names.includes('create_dataset'), 'a data tool is not in the agents lens');
});

test('agents lens: calling a data tool → -32602 (out of the lens, even for an admin)', async () => {
  const body = (await (await post('agents', rpc('tools/call', { name: 'create_dataset', arguments: {} }))).json()) as Rpc;
  assert.deepEqual(body.error, { code: -32602, message: 'Tool not available: create_dataset' });
});

test('initialize on a tab → per-tab serverInfo + instructions', async () => {
  const { result } = (await (await post('agents', rpc('initialize'))).json()) as Rpc;
  const info = result?.serverInfo as { name: string; title: string };
  assert.equal(info.name, 'sovereign-agentic-os-agents');
  assert.match(info.title, /^Sovereign Agentic OS — /);
  assert.ok(typeof result?.instructions === 'string' && (result.instructions as string).length > 0);
});

test('GET → text/event-stream', async () => {
  const res = await route.GET();
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
  await res.body!.cancel(); // stop the 25s keep-alive interval
});
