'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Dashboard: D } = require('./setup');

const { escapeHtml, escapeAttr, applyWidgetShell, genWidgetId } = D;

test('escapeHtml escapes angle brackets and ampersands', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"hi"'), '&quot;hi&quot;');
});

test('escapeAttr escapes quotes for attribute context', () => {
  assert.equal(escapeAttr('x"y'), 'x&quot;y');
  assert.equal(escapeAttr('<z>'), '&lt;z&gt;');
});

test('applyWidgetShell keeps fillColor icon and validated id', () => {
  const typed = { id: 'tmp', type: 'notes', title: 'N', position: 0, span: 1, config: {}, data: {} };
  const raw = { id: 'widget-abc', icon: '📌', fillColor: '#112233', fillOpacity: 0.5 };
  const out = applyWidgetShell(raw, typed);
  assert.equal(out.id, 'widget-abc');
  assert.equal(out.icon, '📌');
  assert.equal(out.fillColor, '#112233');
  assert.equal(out.fillOpacity, 0.5);
});

test('applyWidgetShell rejects unsafe ids', () => {
  const typed = { id: genWidgetId(), type: 'notes', title: 'N', position: 0, span: 1, config: {}, data: {} };
  const out = applyWidgetShell({ id: 'bad id with spaces' }, typed);
  assert.match(out.id, /^[\w-]+$/);
  assert.notEqual(out.id, 'bad id with spaces');
});

test('showUndoToast does not throw (TDZ regression)', () => {
  assert.doesNotThrow(() => D.showUndoToast('test', null));
});
