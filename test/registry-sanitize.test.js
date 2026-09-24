'use strict';
const { Dashboard: D } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// WidgetRegistry lives in registry.js (published on the namespace).
const { WidgetRegistry } = D;

test('every registered type has the core contract', () => {
  const types = Object.keys(WidgetRegistry);
  assert.ok(types.length >= 9, `expected 9+ widget types, got ${types.length}`);
  for (const t of types) {
    const e = WidgetRegistry[t];
    assert.equal(typeof e.label, 'string', `${t}: label`);
    assert.equal(typeof e.defaults, 'function', `${t}: defaults()`);
    assert.equal(typeof e.render, 'function', `${t}: render`);
    assert.equal(typeof e.sanitize, 'function', `${t}: sanitize()`);
  }
});

test('shortcuts.sanitize drops non-http(s) URLs and backfills defaults', () => {
  const out = WidgetRegistry['shortcuts'].sanitize({
    id: 'w1', title: 'Links', span: 2, position: 3,
    data: { items: [
      { label: 'Good', url: 'https://example.com' },
      { label: 'Bad',  url: 'javascript:alert(1)' },   // dropped
      { label: 'NoUrl' }                                // dropped (no url)
    ]}
  });
  assert.equal(out.type, 'shortcuts');
  assert.equal(out.id, 'w1');
  assert.equal(out.span, 2);
  assert.equal(out.position, 3);
  assert.equal(out.data.items.length, 1);
  assert.equal(out.data.items[0].label, 'Good');
  // openInNewTab defaults to true when unset.
  assert.equal(out.data.items[0].openInNewTab, true);
});

test('shortcuts.sanitize returns null for non-object input', () => {
  assert.equal(WidgetRegistry['shortcuts'].sanitize(null), null);
  assert.equal(WidgetRegistry['shortcuts'].sanitize('x'), null);
});

test('lists.sanitize keeps only items with a string text', () => {
  const out = WidgetRegistry['lists'].sanitize({
    id: 'w2', data: { items: [
      { text: 'Real item' },
      { completed: true },          // dropped (no text)
      null                          // dropped
    ]}
  });
  assert.equal(out.data.items.length, 1);
  assert.equal(out.data.items[0].text, 'Real item');
});

test('search.sanitize accepts legacy perplexity type alias', () => {
  const out = WidgetRegistry['search'].sanitize({ id: 'w3', type: 'perplexity' });
  assert.equal(out.type, 'search');
});
