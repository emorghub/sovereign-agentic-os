/* SPDX-License-Identifier: Apache-2.0 */
// Per-module line-coverage floors. Node's built-in --test-coverage-lines is ONE
// global threshold, so this reads the lcov report `npm run test:coverage` writes,
// sums lines found / hit per module prefix from coverage-floors.json, and
// fails (exit 1) when any module drops below its floor. The table goes to stdout
// and, in CI, to $GITHUB_STEP_SUMMARY (the published report).
//
// Usage: node scripts/coverage-floor.mjs [lcov path]   (default coverage/lcov.info)
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lcovPath = resolve(ROOT, process.argv[2] ?? 'coverage/lcov.info');
const floorsPath = resolve(ROOT, 'coverage-floors.json');

if (!existsSync(lcovPath)) {
  console.error(`coverage-floor: ${relative(ROOT, lcovPath)} not found — run \`npm run test:coverage\` first.`);
  process.exit(1);
}

// Keys starting with "_" are comments (e.g. the ratchet note), not modules.
const floors = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(floorsPath, 'utf8'))).filter(([k]) => !k.startsWith('_')),
);
const modules = Object.keys(floors);
const totals = Object.fromEntries(modules.map((m) => [m, { found: 0, hit: 0, files: 0 }]));

/** Longest matching module prefix (so lib/a/b wins over lib/a if both are listed). */
function moduleFor(file) {
  let best = null;
  for (const m of modules) {
    if ((file === m || file.startsWith(`${m}/`)) && (!best || m.length > best.length)) best = m;
  }
  return best;
}

// A file can appear in several records: route tests import `route.ts?<random>`
// for a fresh module per test, and each such instance is reported on its own. So
// union the per-line hits (DA:<line>,<count>) per file instead of summing LF/LH,
// which would count those files once per instance.
const lineHits = new Map(); // file -> Map<line, hit?>
let file = null;
for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    const sf = line.slice(3).trim().replace(/\?.*$/, '');
    file = relative(ROOT, isAbsolute(sf) ? sf : resolve(ROOT, sf)).split('\\').join('/');
    if (!lineHits.has(file)) lineHits.set(file, new Map());
  } else if (line.startsWith('DA:') && file) {
    const [ln, count] = line.slice(3).split(',');
    const hits = lineHits.get(file);
    hits.set(ln, hits.get(ln) || Number(count) > 0);
  } else if (line === 'end_of_record') {
    file = null;
  }
}

for (const [f, hits] of lineHits) {
  // Tests measure the code, not themselves; lib/experimental is out of scope.
  if (f.endsWith('.test.ts') || f.startsWith('lib/experimental/')) continue;
  const m = moduleFor(f);
  if (!m) continue;
  totals[m].found += hits.size;
  totals[m].hit += [...hits.values()].filter(Boolean).length;
  totals[m].files += 1;
}

const rows = modules.map((m) => {
  const { found, hit, files } = totals[m];
  const pct = found ? (hit / found) * 100 : 0;
  return { module: m, files, found, hit, pct, floor: floors[m], ok: found > 0 && pct >= floors[m] };
});

const fmt = (n) => n.toFixed(2);
const table = [
  '| Module | Files | Lines hit / found | Line % | Floor | |',
  '|---|---:|---:|---:|---:|---|',
  ...rows.map((r) => `| \`${r.module}\` | ${r.files} | ${r.hit} / ${r.found} | ${fmt(r.pct)} | ${r.floor} | ${r.ok ? '✅' : '❌'} |`),
].join('\n');

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## os-ui line coverage (per-module floors)\n\n${table}\n`);
}

const failed = rows.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) {
    console.error(
      r.found === 0
        ? `coverage-floor: ${r.module} has no measured lines — wrong prefix, or its tests didn't run.`
        : `coverage-floor: ${r.module} is at ${fmt(r.pct)}%, below its floor of ${r.floor}%.`,
    );
  }
  process.exit(1);
}
console.log('coverage-floor: every module is at or above its floor.');
