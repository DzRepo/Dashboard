'use strict';
const { exports: E, localStorage } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Storage lives in storage.js (loaded into the shared context).
const { Storage } = E['storage'];

test('isValidHttpUrl accepts http/https and rejects others', () => {
  assert.equal(Storage.isValidHttpUrl('https://example.com'), true);
  assert.equal(Storage.isValidHttpUrl('http://example.com/x?y=1'), true);
  assert.equal(Storage.isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(Storage.isValidHttpUrl('not a url'), false);
  assert.equal(Storage.isValidHttpUrl(null), false);
});

test('_defaultState returns a deep clone (mutations do not leak)', () => {
  const a = Storage._defaultState();
  const b = Storage._defaultState();
  a.settings.theme = 'dark';
  a.widgets.push('x');
  assert.notEqual(b.settings.theme, 'dark', 'nested settings must not alias the singleton');
  assert.deepEqual(b.widgets, [], 'widgets array must not alias the singleton');
});

test('getData returns a fresh default state when nothing is saved', () => {
  localStorage.clear();
  const data = Storage.getData();
  assert.equal(data.version, 5); // CURRENT_VERSION
  assert.deepEqual(data.widgets, []);
});
