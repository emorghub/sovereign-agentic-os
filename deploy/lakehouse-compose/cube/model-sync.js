'use strict';
// Copied from charts/sovereign-agentic-os/templates/extensions/cube/cube.yaml
// (cube-model-sync ConfigMap, modelSync.source = os-ui). Polls os-ui's
// GET /api/cube/models and writes each governed dataset's `<slug>.cube.yml` into the
// shared model dir that Cube reads; prunes delivered models that disappeared.
var http = require('http');
var fs = require('fs');
var path = require('path');

var URL_STR = process.env.OSUI_MODELS_URL || 'http://os-ui:3000/api/cube/models';
var MODEL_DIR = process.env.MODEL_DIR || '/cube/conf/model';
var POLL_MS = (parseInt(process.env.POLL_SECONDS || '30', 10) || 30) * 1000;
var written = new Map();
var polls = 0;

function log(msg) { process.stdout.write('[cube-model-sync] ' + msg + '\n'); }

function fetchJson(u) {
  return new Promise(function (resolve, reject) {
    var req = http.get(u, { timeout: 8000 }, function (res) {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function safeName(file) {
  var b = path.basename(String(file || ''));
  return /^[a-z0-9_]+\.cube\.yml$/.test(b) ? b : null;
}

function pruneStale(expectedNames) {
  var files;
  try { files = fs.readdirSync(MODEL_DIR); } catch (e) { return; }
  var removed = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!/^[a-z0-9_]+\.cube\.yml$/.test(f)) continue;
    if (expectedNames.indexOf(f) !== -1) continue;
    try {
      fs.unlinkSync(path.join(MODEL_DIR, f));
      written.delete(f);
      removed++;
    } catch (e) { log('prune error for ' + f + ': ' + (e && e.message)); }
  }
  if (removed) log('pruned ' + removed + ' stale delivered model(s) from ' + MODEL_DIR);
}

function syncOnce() {
  return fetchJson(URL_STR).then(function (payload) {
    var models = (payload && Array.isArray(payload.models)) ? payload.models : [];
    var changed = 0;
    var expected = [];
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      var name = safeName(m && m.file);
      if (!name || typeof m.model !== 'string') continue;
      expected.push(name);
      if (written.get(name) === m.model) continue;
      var dest = path.join(MODEL_DIR, name);
      var tmp = dest + '.tmp';
      fs.writeFileSync(tmp, m.model);
      fs.renameSync(tmp, dest);
      written.set(name, m.model);
      changed++;
    }
    if (changed) log('wrote ' + changed + ' model(s) to ' + MODEL_DIR);
    pruneStale(expected);
  });
}

function loop() {
  polls++;
  if (polls % 60 === 0) log('heartbeat: ' + polls + ' polls, tracking ' + written.size + ' delivered model(s)');
  syncOnce().catch(function (e) { log('sync error: ' + (e && e.message)); }).then(function () {
    setTimeout(loop, POLL_MS);
  });
}

try { fs.mkdirSync(MODEL_DIR, { recursive: true }); } catch (e) { /* volume pre-created */ }
log('polling ' + URL_STR + ' every ' + (POLL_MS / 1000) + 's -> ' + MODEL_DIR);
loop();
