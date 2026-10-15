// End-to-end medallion validation, run INSIDE the os-ui container of this deployment:
//
//   docker compose ... exec -T os-ui node - < deploy/lakehouse-compose/validate/e2e-medallion.js
//
// Drives the application's OWN governed MCP tools (the same dispatch the Data tab and
// agents use) as the seeded `admin` user:
//   create_dataset -> ingest_dataset (CSV -> Bronze) -> profile_dataset (bronze)
//   -> transform_silver -> add_dataset_version gold passThrough -> profile_dataset (gold)
//   -> query_data (count(*) on the physical Gold table).
// Every step must report mode `live` and a real Iceberg table; any offline-mock,
// error or row-count mismatch fails the run (exit 1).
//
// Auth: mints a short-lived (10 min), in-memory MCP bearer for `admin` with the
// container's own OS_MCP_TOKEN_SECRET / OS_SESSION_SECRET (same format as
// os-ui/lib/mcp/token.ts). Nothing is stored. Creates ONE new personal dataset.
'use strict';
const { createHmac } = require('node:crypto');

const USER = process.env.E2E_USER || 'admin';
const secret = process.env.OS_MCP_TOKEN_SECRET || process.env.OS_SESSION_SECRET;
const now = Math.floor(Date.now() / 1000);
const body = Buffer.from(JSON.stringify({ id: USER, iat: now, exp: now + 600 })).toString('base64url');
const token = 'soa_mcp_' + body + '.' + createHmac('sha256', secret).update(body).digest('base64url');

const CSV = [
  'order_id,region,amount',
  '1,DE,10.5',
  '2,FR,20.0',
  '3,DE,7.25',
  '4,IT,12.0',
  '5,FR,3.75',
].join('\n') + '\n';
const EXPECTED_ROWS = 5;

let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return r.json();
}
async function tool(name, args) {
  const j = await rpc('tools/call', { name, arguments: args });
  const text = j?.result?.content?.map((c) => c.text).join('\n') ?? '';
  if (j?.error || j?.result?.isError) throw new Error(`${name} failed: ${text || JSON.stringify(j.error)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const results = [];
function check(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step} — ${detail}`);
  if (!ok) throw new Error(`step failed: ${step}`);
}

(async () => {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lakehouse-e2e', version: '1' } });
  const name = `lakehouse_e2e_${now}`;

  const ds = await tool('create_dataset', { name });
  const id = ds.id ?? ds.dataset?.id;
  check('create_dataset', Boolean(id), `id=${id} name=${name}`);

  const ing = await tool('ingest_dataset', { datasetId: id, content: CSV, fileName: `${name}.csv` });
  check('ingest_dataset (Bronze)', ing.mode === 'live' && ing.rowCount === EXPECTED_ROWS,
    `mode=${ing.mode} table=${ing.table} rowCount=${ing.rowCount}`);

  const pb = await tool('profile_dataset', { datasetId: id, layer: 'bronze' });
  check('profile_dataset bronze', pb.available === true && Number(pb.rowCount) === EXPECTED_ROWS,
    `available=${pb.available} fqn=${pb.fqn} rowCount=${pb.rowCount}${pb.reason ? ' reason=' + pb.reason : ''}`);

  const cols = (pb.columns ?? []).map((c) => c.name ?? c);
  const sv = await tool('transform_silver', { datasetId: id, columns: cols.length ? cols : ['order_id', 'region', 'amount'] });
  check('transform_silver (Silver CTAS)', sv.mode === 'live' && sv.silverRegistered === true,
    `mode=${sv.mode} target=${sv.target}`);

  // Returns the updated dataset on success (a failed/offline build throws above). That
  // the Gold table is REAL is proven by the profile + query_data steps below.
  const gd = await tool('add_dataset_version', { datasetId: id, layer: 'gold', passThrough: true });
  check('add_dataset_version gold passThrough', gd.versions?.gold?.built === true,
    `gold.built=${gd.versions?.gold?.built} passThrough=${gd.versions?.gold?.passThrough}`);

  const g = await tool('get_dataset', { datasetId: id, layer: 'gold' });
  check('get_dataset gold resolves', g.queryable?.layer === 'gold' && g.versions?.gold?.built === true,
    `layer=${g.queryable?.layer} fqn=${g.queryable?.fqn}`);

  const pg = await tool('profile_dataset', { datasetId: id, layer: 'gold' });
  check('profile_dataset gold', pg.available === true && Number(pg.rowCount) === EXPECTED_ROWS,
    `available=${pg.available} fqn=${pg.fqn} rowCount=${pg.rowCount}`);

  const q = await tool('query_data', { sql: `SELECT count(*) AS n, sum(CAST(amount AS double)) AS total FROM ${g.queryable.fqn}` });
  const n = Number(q.rows?.[0]?.[0]);
  check('query_data on Gold', n === EXPECTED_ROWS, `rows=${JSON.stringify(q.rows)} principal=${q.principal}`);

  console.log(`\nALL ${results.length} CHECKS PASSED — dataset ${id} (${name})`);
})().catch((e) => {
  console.error(`\nVALIDATION FAILED: ${e.message}`);
  process.exit(1);
});
