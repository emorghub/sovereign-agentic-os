/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
// #28 real flag-gating: base-8 + `data`. Set before the MCP server is imported
// (TAB_FEATURES is read once at import; each test file is its own process).
process.env.OS_ENABLED_TABS = 'home,about,agents,monitoring,llm-gateway,mcp,governance,tutorials,data';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ALL_MCP_TOOLS } = await import('./server.ts');
const { isBundleRegistered } = await import('./registry.ts');

const names = new Set(ALL_MCP_TOOLS.map((t) => t.name));

test('enabling `data` registers the data-write bundle and its tools', () => {
  assert.equal(isBundleRegistered('data-write'), true);
  assert.ok(names.has('create_dataset'));
});

test('enabling `data` turns on nothing else — strategy / marketplace stay off', () => {
  assert.equal(isBundleRegistered('strategy'), false);
  assert.equal(isBundleRegistered('marketplace'), false);
  assert.ok(!names.has('list_pillars'));
  assert.ok(!names.has('browse_marketplace'));
});
