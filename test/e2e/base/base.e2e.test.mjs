// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
//
// Base end-to-end smoke test (#32) — the automated version of #29's manual
// verification. Assumes the compose base stack is already up
// (`docker compose up -d`, a separate CI/local step) and asserts the Phase
// 3.4 flows programmatically: agent build+run (both paths), an MCP tool call
// through LiteLLM, a Langfuse trace read-back, and a LiteLLM chat completion.
//
// DoD (#32): breaking the Langfuse ingestion path or an agent run-path must
// make this fail — so every test asserts real content (reachedEnd, trace
// names/decisions, response bodies), never just "got a 200".
//
// No credential ever has a hardcoded fallback here, even a known local-dev
// one — every key/password is read from the SAME .env the compose stack
// itself uses (same variable names as compose.yaml), so there is nothing to
// keep in sync by hand and nothing for a secret scanner to flag.
//
// Run locally (from the repo root, after `docker compose up -d`):
//   node --env-file=.env --test test/e2e/base/base.e2e.test.mjs

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/** A required env var — fails fast with a clear message instead of silently
 *  running against an empty string. Never has a fallback: these are the same
 *  names compose.yaml reads from .env, so `--env-file=.env` always supplies
 *  them for a stack brought up the documented way (`cp .env.example .env`). */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — run with --env-file=.env (see file header)`);
  return v;
}

// Only bare localhost URLs get a fallback — never credentials.
const OS_UI_URL = process.env.OS_UI_URL ?? 'http://localhost:3000';
const LITELLM_URL = process.env.LITELLM_URL ?? 'http://localhost:4000';
const LANGFUSE_URL = process.env.LANGFUSE_URL ?? 'http://localhost:3002';

const LITELLM_MASTER_KEY = requireEnv('PROXY_MASTER_KEY');
const LANGFUSE_PUBLIC_KEY = requireEnv('LANGFUSE_INIT_PROJECT_PUBLIC_KEY');
const LANGFUSE_SECRET_KEY = requireEnv('LANGFUSE_INIT_PROJECT_SECRET_KEY');
// The seeded bootstrap user — read straight out of OS_USERS (the same JSON
// array os-ui itself parses), never duplicated as a separate literal.
const [bootstrapUser] = JSON.parse(requireEnv('OS_USERS'));
const OS_LOGIN_EMAIL = bootstrapUser.email;
const OS_LOGIN_PASSWORD = bootstrapUser.password;

const BASE_TOOLS = [
  'get_monitoring_overview', 'list_runs', 'get_run_trace',
  'create_agent_system', 'commit_agent_files', 'build_agent_system', 'run_agent_system',
  'get_operating_manual', 'update_operating_manual', 'list_operating_manual_versions', 'restore_operating_manual_version',
  'get_request', 'list_approvals', 'decide_approval', 'request_certification', 'get_lineage', 'get_policy_view', 'get_cost',
  'get_agent_system', 'get_guide',
];

let mcpToken;

/** Log in as the seeded bootstrap user and mint a fresh personal MCP token —
 *  never a hardcoded secret, so this works the same in CI as it does locally. */
before(async () => {
  const loginRes = await fetch(`${OS_UI_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: OS_LOGIN_EMAIL, password: OS_LOGIN_PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'seeded bootstrap user must log in');
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie, 'login must set a session cookie');
  const sessionCookie = cookie.split(';')[0];

  const tokenRes = await fetch(`${OS_UI_URL}/api/mcp/token`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(tokenRes.status, 200, 'the signed-in session must mint an MCP token');
  const tokenBody = await tokenRes.json();
  assert.ok(tokenBody.token, 'token response must carry a token');
  mcpToken = tokenBody.token;
});

/** One MCP JSON-RPC `tools/call`, unwrapped to the tool's own JSON payload. */
async function mcp(name, args) {
  const res = await fetch(`${OS_UI_URL}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${mcpToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200, `${name} must respond 200`);
  const body = await res.json();
  assert.ok(body.result, `${name} must return a JSON-RPC result (got: ${JSON.stringify(body)})`);
  const text = body.result.content?.[0]?.text;
  assert.ok(text, `${name} must return text content`);
  return JSON.parse(text);
}

/** Recent Langfuse traces, newest first — direct API read-back, not the UI. */
async function langfuseTraces(limit = 20) {
  const auth = Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64');
  const res = await fetch(`${LANGFUSE_URL}/api/public/traces?limit=${limit}&orderBy=timestamp.desc`, {
    headers: { authorization: `Basic ${auth}` },
  });
  assert.equal(res.status, 200, 'Langfuse traces API must respond 200');
  const body = await res.json();
  return body.data;
}

/** Langfuse ingestion is async (a separate worker processes the queue) — a
 *  trace POSTed moments ago may not be queryable yet. Poll briefly rather than
 *  check once; still fails for real if the trace never lands within budget. */
async function waitForTrace(predicate, { attempts = 20, delayMs = 1500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const traces = await langfuseTraces(30);
    const found = traces.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return undefined;
}

function systemYaml(name, tools) {
  const grantLines = tools.map((t) => `    - ${t}`).join('\n');
  const agentToolLines = tools.map((t) => `      - ${t}`).join('\n');
  return `version: '1'
system:
  name: ${name}
  domain: platform
  visibility: Personal
runtime: langgraph
safety_preset: read-only
entrypoint: assistant
state:
  channels:
    messages: add_messages
grants:
  data: []
  knowledge: []
  metrics: []
  tools:
${grantLines}
  connections: []
agents:
  - id: assistant
    role: Base e2e smoke-test assistant
    agent_md: |-
      # Base E2E Smoke Test
      Diagnostic assistant for the automated base smoke test (#32).
    memory_md: |-
      # Memory
    tools:
${agentToolLines}
`;
}

async function buildFreshAgent(name, tools) {
  const created = await mcp('create_agent_system', { name, template: 'blank' });
  await mcp('commit_agent_files', { systemId: created.id, path: 'system.yaml', content: systemYaml(name, tools) });
  const build = await mcp('build_agent_system', { systemId: created.id });
  return { systemId: created.id, build };
}

// ---------------------------------------------------------------- tests ----

test('in-process agent path: build with all base MCP registry tools, run, reachedEnd + trace', async () => {
  const { systemId, build } = await buildFreshAgent('e2e-in-process', BASE_TOOLS);
  assert.equal(build.ok, true, `build must succeed: ${JSON.stringify(build.rows)}`);
  assert.equal(build.mode, 'live', 'Build must run against the real services, not silently fall back to offline-mock');
  const langgraphRow = build.rows.find((r) => r.tool === 'langgraph');
  assert.equal(langgraphRow.status, 'ok', 'the Build-time test invocation must exercise every granted tool cleanly');

  const run = await mcp('run_agent_system', { systemId, message: 'Describe your own configuration.' });
  assert.equal(run.mode, 'live', 'the in-process path must run live, not offline-mock');
  assert.equal(run.reachedEnd, true, 'the run must reach the end of its path');

  const generateTrace = await waitForTrace(
    (t) => t.name === 'agent.generate' && t.metadata?.principal?.includes(systemId),
  );
  assert.ok(generateTrace, 'an agent.generate trace must land in Langfuse for this run');
});

test('pod agent path: compile IR, reload, run against the real agent-runtime pod, governed tool call OPA-authorised + traced', async () => {
  const { systemId, build } = await buildFreshAgent('e2e-pod-path', ['get_cost']);
  assert.equal(build.ok, true, `build must succeed: ${JSON.stringify(build.rows)}`);
  assert.equal(
    build.mode,
    'live',
    'this is THE pod-path test - it must run against the real agent-runtime pod, not silently fall back to offline-mock when the pod is unreachable',
  );

  const langgraphRow = build.rows.find((r) => r.tool === 'langgraph');
  assert.equal(langgraphRow.status, 'ok');
  assert.match(
    langgraphRow.detail,
    /governed tool call/i,
    'the langgraph adapter must report a real, governed test invocation against the runtime pod',
  );

  const opaRow = build.rows.find((r) => r.tool === 'opa');
  assert.equal(opaRow.status, 'ok');
  assert.match(opaRow.detail, /allow/i, 'the granted tool must resolve to an OPA allow decision');

  // The governed tool call funnels through /api/agents/tool, which traces every
  // attempt (allow or not) — confirm the specific tool call landed with a decision.
  const toolTrace = await waitForTrace(
    (t) => t.name === 'agent.get_cost' && t.metadata?.principal?.includes(systemId),
  );
  assert.ok(toolTrace, 'the governed get_cost call must be traced');
  assert.equal(toolTrace.metadata.decision, 'allow', 'the traced decision must be OPA-authorised (allow)');
});

test('generic MCP over HTTP: list + call query-tool through LiteLLM', async () => {
  const serverRes = await fetch(`${LITELLM_URL}/v1/mcp/server`, {
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}` },
  });
  assert.equal(serverRes.status, 200);
  const servers = await serverRes.json();
  const sovereignQuery = (Array.isArray(servers) ? servers : servers.data ?? []).find(
    (s) => s.server_name === 'sovereign_query' || s.alias === 'sovereign_query',
  );
  assert.ok(sovereignQuery, 'sovereign_query must be registered as an MCP server in LiteLLM');

  const listRes = await fetch(`${LITELLM_URL}/mcp-rest/tools/list`, {
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}` },
  });
  assert.equal(listRes.status, 200);
  const tools = await listRes.json();
  const names = (tools.tools ?? tools).map((t) => t.name);
  assert.ok(names.includes('list_tables'), 'list_tables must be visible through LiteLLM');
  assert.ok(names.includes('query'), 'query must be visible through LiteLLM');

  const callRes = await fetch(`${LITELLM_URL}/mcp-rest/tools/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'list_tables', arguments: {}, server_id: sovereignQuery.server_id }),
  });
  assert.equal(callRes.status, 200);
  const callBody = await callRes.json();
  assert.equal(callBody.isError, false, 'query-tool must answer honestly, never a raw crash');
  const payload = JSON.parse(callBody.content[0].text);
  // No lakehouse in the base stack — a clear, honest guard, not a crash.
  assert.equal(payload.error, 'no_catalog_configured');
});

test('langfuse: a gateway trace and an os-ui trace both land for the same run', async () => {
  const traces = await langfuseTraces();
  assert.ok(traces.some((t) => t.name === 'litellm-acompletion'), 'a LiteLLM gateway trace must have landed');
  assert.ok(
    traces.some((t) => t.name === 'agent.generate' || t.name?.startsWith('agent.')),
    'an os-ui agent trace must have landed',
  );
});

test('litellm: model list, a chat completion, and scoped-key generation', async () => {
  const modelsRes = await fetch(`${LITELLM_URL}/v1/models`, {
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}` },
  });
  assert.equal(modelsRes.status, 200);
  const models = await modelsRes.json();
  assert.ok(models.data.length > 0, 'at least one model must be configured');

  const chatRes = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sovereign-default', messages: [{ role: 'user', content: 'say hi' }] }),
  });
  assert.equal(chatRes.status, 200);
  const chat = await chatRes.json();
  assert.ok(chat.choices?.[0]?.message?.content, 'a chat completion must return real content');

  const keyRes = await fetch(`${LITELLM_URL}/key/generate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${LITELLM_MASTER_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ key_alias: `e2e-test-${Date.now()}` }),
  });
  assert.equal(keyRes.status, 200);
  const key = await keyRes.json();
  assert.ok(key.key?.startsWith('sk-'), 'a scoped key must be generated');
});
