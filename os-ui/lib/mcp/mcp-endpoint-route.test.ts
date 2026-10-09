/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { CurrentUser } from '@/lib/core/auth';

/**
 * Behaviour of /api/mcp — the overarching MCP endpoint (Streamable HTTP, JSON-RPC 2.0).
 * Auth here is NOT the cookie session: lib/mcp/http.ts resolves an MCP bearer token,
 * so the token resolver is what's mocked. handleRpc + the tool registry are real
 * (test-setup.mjs turns every tab on).
 */

const CREATOR: CurrentUser = { id: 'dan', name: 'Dan', domains: ['sales'], role: 'creator' };
const ADMIN: CurrentUser = { id: 'ada', name: 'Ada', domains: ['sales'], role: 'admin' };
const TOKENS: Record<string, CurrentUser> = { good: CREATOR, admin: ADMIN };

mock.module('@/lib/mcp/token', {
  namedExports: {
    resolveMcpUser: async (token: string | null) => (token && TOKENS[token]) || null,
  },
});

type Rpc = { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };

const route = await import('../../app/api/mcp/route.ts');

function post(body: unknown, token: string | null = 'good', raw = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return route.POST(new Request('http://x/api/mcp', {
    method: 'POST',
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  }));
}

const rpc = (method: string, params?: Record<string, unknown>, id: number = 1) => ({ jsonrpc: '2.0', id, method, params });

test('no bearer → 401 with JSON-RPC -32001 and a WWW-Authenticate challenge', async () => {
  const res = await post(rpc('tools/list'), null);
  assert.equal(res.status, 401);
  const body = (await res.json()) as Rpc;
  assert.equal(body.error?.code, -32001);
  const www = res.headers.get('WWW-Authenticate') ?? '';
  assert.match(www, /^Bearer realm="Sovereign Agentic OS MCP"/);
  assert.match(www, /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
});

test('wrong bearer → 401 -32001', async () => {
  const res = await post(rpc('tools/list'), 'forged');
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as Rpc).error?.code, -32001);
});

test('malformed JSON body → 400 -32700 Parse error', async () => {
  const res = await post('{not json', 'good', true);
  assert.equal(res.status, 400);
  const body = (await res.json()) as Rpc;
  assert.deepEqual(body.error, { code: -32700, message: 'Parse error' });
});

test('initialize → serverInfo and non-empty instructions', async () => {
  const res = await post(rpc('initialize'));
  assert.equal(res.status, 200);
  const { result } = (await res.json()) as Rpc;
  assert.equal((result?.serverInfo as { name: string }).name, 'sovereign-agentic-os');
  assert.equal(typeof result?.instructions, 'string');
  assert.ok((result?.instructions as string).length > 0);
});

test('tools/list is role-scoped — a creator sees a strict subset of what an admin sees', async () => {
  const names = async (token: string) =>
    (((await (await post(rpc('tools/list'), token)).json()) as Rpc).result?.tools as { name: string }[]).map((t) => t.name);
  const creator = await names('good');
  const admin = await names('admin');
  assert.ok(creator.length < admin.length);
  for (const n of creator) assert.ok(admin.includes(n), `${n} visible to creator but not admin`);
  assert.ok(admin.includes('promote') && !creator.includes('promote'), 'elevated tool hidden from creator');
});

test('tools/call on an unknown tool → -32602 "Tool not available"', async () => {
  const res = await post(rpc('tools/call', { name: 'no_such_tool', arguments: {} }));
  const body = (await res.json()) as Rpc;
  assert.deepEqual(body.error, { code: -32602, message: 'Tool not available: no_such_tool' });
});

test('unknown method → -32601', async () => {
  const body = (await (await post(rpc('bogus/method'))).json()) as Rpc;
  assert.equal(body.error?.code, -32601);
  assert.match(body.error?.message ?? '', /Method not found: bogus\/method/);
});

test('batch → an array of responses, ids preserved', async () => {
  const res = await post([rpc('ping', undefined, 1), rpc('bogus', undefined, 2)]);
  const out = (await res.json()) as Rpc[];
  assert.ok(Array.isArray(out));
  assert.deepEqual(out.map((r) => r.id), [1, 2]);
  assert.deepEqual(out[0].result, {});
  assert.equal(out[1].error?.code, -32601);
});

test('a lone notification → 202 with no body', async () => {
  const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
});

test('a batch of only notifications → 202', async () => {
  const res = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
  assert.equal(res.status, 202);
});

test('GET → an open, idle text/event-stream (no 405)', async () => {
  const res = await route.GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), ': mcp stream open\n\n');
  // MUST cancel: the stream holds a 25s keep-alive setInterval that would keep
  // the test process alive until it times out.
  await reader.cancel();
});
