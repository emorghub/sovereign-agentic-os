/* SPDX-License-Identifier: Apache-2.0 */
/*
 * Pretest guard — fail with a readable message when dependencies are missing.
 *
 * Without this, `npm test` on a fresh clone dies inside the test harness with
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'js-yaml'` and a stack trace, which
 * reads like a broken test suite rather than "you haven't installed anything yet".
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(resolve(ROOT, 'node_modules'))) {
  console.error('\n  os-ui: dependencies are not installed.\n\n  Run `npm ci` first (from the repo root: `npm --prefix os-ui ci`).\n');
  process.exit(1);
}
