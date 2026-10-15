// SPDX-License-Identifier: Apache-2.0
// Copied verbatim from charts/sovereign-agentic-os/templates/extensions/cube/cube.yaml
// (cube-sql-config ConfigMap). schemaVersion() hashes the model dir so Cube recompiles
// whenever the model-sync sidecar writes a .cube.yml; checkSqlAuth/queryRewrite only
// matter if the Postgres-wire SQL API is enabled (it is not in this deployment).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BI_PREFIX = 'bi_';
function normDomain(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}
function domainFromBiUser(user) {
  const u = String(user || '').trim().toLowerCase();
  if (!u.startsWith(BI_PREFIX)) return null;
  const d = normDomain(u.slice(BI_PREFIX.length));
  return d || null;
}
var MODEL_DIR = process.env.CUBEJS_SCHEMA_PATH
  ? path.resolve('/cube/conf', process.env.CUBEJS_SCHEMA_PATH)
  : '/cube/conf/model';
function modelHash() {
  try {
    var files = fs.readdirSync(MODEL_DIR).filter(function (f) { return /\.(yml|yaml|js)$/.test(f); }).sort();
    var h = crypto.createHash('sha1');
    for (var i = 0; i < files.length; i++) {
      h.update(files[i]);
      h.update(fs.readFileSync(path.join(MODEL_DIR, files[i])));
    }
    return h.digest('hex');
  } catch (e) {
    return 'model-hash-error';
  }
}
module.exports = {
  schemaVersion: function () { return modelHash(); },
  checkSqlAuth: (query, user, password) => {
    const expected = process.env.CUBEJS_SQL_PASSWORD;
    if (expected && password !== expected) {
      throw new Error('Invalid Cube SQL API credentials');
    }
    const domain = domainFromBiUser(user);
    if (domain) {
      return {
        password: expected,
        securityContext: { sub: 'bi:' + domain, domains: [domain], role: 'creator', scope: 'bi-readonly' },
      };
    }
    return { password: expected, securityContext: { sub: user, domains: [], role: 'creator', scope: 'bi-readonly' } };
  },
  queryRewrite: (query, { securityContext }) => {
    const domains = (securityContext && securityContext.domains) || [];
    if (securityContext && securityContext.scope === 'bi-readonly' && domains.length === 0) {
      throw new Error('Cube SQL API: no domain scope on this principal');
    }
    return query;
  },
};
