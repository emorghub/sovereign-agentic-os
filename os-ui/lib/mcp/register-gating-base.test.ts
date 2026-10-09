/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
// #28 real flag-gating, base-only install. TAB_FEATURES is read ONCE at import
// time and every test file runs in its own process, so overriding the
// test-setup.mjs "every tab on" default here — before the MCP server is imported —
// gives this file a genuine base-8 registry.
process.env.OS_ENABLED_TABS = 'home,about,agents,monitoring,llm-gateway,mcp,governance,tutorials';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CurrentUser } from '@/lib/core/auth';

const { TAB_FEATURES } = await import('../core/tabs.ts');
const { ALL_MCP_TOOLS, handleRpc } = await import('./server.ts');
const { isBundleRegistered } = await import('./registry.ts');
const { grantedToolExecutor } = await import('../agents/build/os-tools.ts');
const { parseSystem } = await import('../agents/system-schema.ts');

const ADMIN: CurrentUser = { id: 'ada', name: 'Ada', domains: ['sales'], role: 'admin' };
const names = new Set(ALL_MCP_TOOLS.map((t) => t.name));

test('precondition: this process really runs with only the base-8 features', () => {
  assert.equal(TAB_FEATURES.has('data'), false);
  assert.equal(TAB_FEATURES.has('agents'), true);
});

test('base tools are always registered', () => {
  for (const n of ['get_agent_system', 'get_guide', 'get_monitoring_overview', 'list_runs', 'get_run_trace', 'whoami']) {
    assert.ok(names.has(n), `base tool ${n} missing`);
  }
});

test('tools behind a disabled feature are not registered', () => {
  for (const n of ['create_dataset', 'list_pillars', 'browse_marketplace']) {
    assert.ok(!names.has(n), `${n} registered although its feature is off`);
  }
});

test('a disabled feature\'s bundle never registers', () => {
  for (const b of ['data-write', 'strategy', 'marketplace', 'file-write', 'knowledge-write']) {
    assert.equal(isBundleRegistered(b), false, `${b} registered`);
  }
  for (const b of ['monitoring', 'agent-write', 'governance', 'discovery']) {
    assert.equal(isBundleRegistered(b), true, `base bundle ${b} not registered`);
  }
});

test('tools/call on a gated-off tool → -32602, even for an admin', async () => {
  const res = await handleRpc(ADMIN, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_dataset', arguments: {} } });
  assert.deepEqual(res?.error, { code: -32602, message: 'Tool not available: create_dataset' });
});

test('KNOWN GAP (#52 #1): query_data / search_knowledge / science_predict still register on a base install', () => {
  // register-experimental.ts registers these through `registerAlways`, not
  // `registerIfEnabled` — they predate the flag-gating and were extracted
  // unconditionally from server.ts. This pins the CURRENT behaviour; when they
  // become flag-gated, flip these to `!names.has(...)`.
  for (const n of ['query_data', 'search_knowledge', 'science_predict']) {
    assert.ok(names.has(n), `${n} — gap closed? update this test`);
  }
  for (const b of ['platform-tools', 'data-query', 'science-predict', 'knowledge-search']) {
    assert.equal(isBundleRegistered(b), true);
  }
});

test('agent executor: a legacy alias whose target feature is off → "feature is not enabled"', async () => {
  const sys = parseSystem({
    version: '1',
    system: { name: 'T', domain: 'sales', visibility: 'Personal' },
    runtime: 'langgraph',
    entrypoint: 'a',
    grants: { tools: ['write_file'] },
    agents: [{ id: 'a', role: 'agent', agent_md: '', memory_md: '' }],
  });
  const exec = grantedToolExecutor(ADMIN, sys, 'sys1');
  const out = await exec('write_file', {});
  assert.equal(out.isError, true);
  assert.deepEqual(JSON.parse(out.text), {
    error: { code: 'not_found', reason: "Tool not available: the 'files' feature is not enabled" },
  });
  // A plain unknown tool keeps the generic message — no feature guess.
  const plain = await exec('nope_tool', {});
  assert.deepEqual(JSON.parse(plain.text), { error: { code: 'not_found', reason: 'Tool not available: nope_tool' } });
});
