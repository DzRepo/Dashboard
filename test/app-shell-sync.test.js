'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function scriptSrcsFromIndex() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  return srcs;
}

function appShellFromSw() {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const start = sw.indexOf('const APP_SHELL = [');
  assert.ok(start >= 0, 'APP_SHELL not found in sw.js');
  const end = sw.indexOf('];', start);
  const block = sw.slice(start, end + 2);
  const urls = [];
  const re = /'\.\/([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) urls.push(m[1]);
  return urls;
}

test('every index.html script is listed in sw.js APP_SHELL', () => {
  const scripts = scriptSrcsFromIndex();
  const shell = new Set(appShellFromSw());
  const missing = scripts.filter(s => !shell.has(s));
  assert.deepEqual(missing, [], 'APP_SHELL missing scripts: ' + missing.join(', '));
});

test('index.html and APP_SHELL share the same JS load order for app shell files', () => {
  const scripts = scriptSrcsFromIndex();
  const shellJs = appShellFromSw().filter(u => u.endsWith('.js'));
  // APP_SHELL includes style/manifest/icons; compare only the script subset in order.
  const shellScripts = shellJs.filter(u => scripts.includes(u));
  assert.deepEqual(shellScripts, scripts);
});
