'use strict';
const { Dashboard: D } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// hexToRgb / rgbaString / adjustFillForTheme live in app.js (published on the namespace).
const { hexToRgb, rgbaString, adjustFillForTheme } = D;

// hexToRgb returns an object created in the vm realm, so deepEqual (which checks
// prototype identity) fails on cross-realm objects. Compare field-by-field instead.
function assertRgb(actual, r, g, b) {
  assert.equal(actual.r, r);
  assert.equal(actual.g, g);
  assert.equal(actual.b, b);
}

test('hexToRgb parses #RRGGBB', () => {
  assertRgb(hexToRgb('#ff00aa'), 255, 0, 170);
});

test('hexToRgb parses RRGGBB without leading #', () => {
  assertRgb(hexToRgb('0a84ff'), 10, 132, 255);
});

test('hexToRgb trims whitespace', () => {
  assertRgb(hexToRgb('  #007aff  '), 0, 122, 255);
});

test('hexToRgb returns null for invalid input', () => {
  assert.equal(hexToRgb('#12345'), null);      // too short
  assert.equal(hexToRgb('#gggghh'), null);     // non-hex chars
  assert.equal(hexToRgb(''), null);            // empty
  assert.equal(hexToRgb(null), null);          // null/undefined
});

test('rgbaString formats an rgba() string', () => {
  assert.equal(rgbaString(10, 132, 255, 0.9), 'rgba(10, 132, 255, 0.9)');
});

test('adjustFillForTheme is a no-op in light theme', () => {
  assertRgb(adjustFillForTheme({ r: 10, g: 10, b: 10 }, 'light'), 10, 10, 10);
});

test('adjustFillForTheme lightens a near-black fill in dark theme', () => {
  const out = adjustFillForTheme({ r: 10, g: 10, b: 10 }, 'dark');
  // Lightness should be nudged up well above the input.
  const lum = (out.r + out.g + out.b) / 3;
  assert.ok(lum > 60, `expected lightened fill, got ${out}`);
});

test('adjustFillForTheme leaves an already-light fill unchanged in dark theme', () => {
  assertRgb(adjustFillForTheme({ r: 240, g: 240, b: 240 }, 'dark'), 240, 240, 240);
});
