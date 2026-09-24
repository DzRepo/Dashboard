'use strict';
const { exports: E } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// pruneHabitsLog lives in widgets.js (loaded into the shared context).
const { pruneHabitsLog } = E['widgets'];

function key(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('pruneHabitsLog removes entries older than the cutoff and reports it', () => {
  const old = new Date(); old.setDate(old.getDate() - 40);   // beyond default 30-day cutoff
  const recent = new Date(); recent.setDate(recent.getDate() - 2); // within cutoff
  const widget = { data: { log: { [key(old)]: ['h1'], [key(recent)]: ['h2'] } } };

  const removed = pruneHabitsLog(widget);
  assert.equal(removed, true);
  assert.ok(!widget.data.log[key(old)], 'old entry should be pruned');
  assert.deepEqual(widget.data.log[key(recent)], ['h2'], 'recent entry should remain');
});

test('pruneHabitsLog returns false when nothing is pruned', () => {
  const recent = new Date();
  const widget = { data: { log: { [key(recent)]: ['h1'] } } };
  assert.equal(pruneHabitsLog(widget), false);
});

test('pruneHabitsLog handles missing log gracefully', () => {
  assert.equal(pruneHabitsLog({ data: {} }), false);
  assert.equal(pruneHabitsLog(null), false);
});
