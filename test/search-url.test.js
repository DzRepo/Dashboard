'use strict';
const { exports: E } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// buildSearchUrl lives in registry.js (loaded into the shared context).
const { buildSearchUrl } = E['registry'];

test('buildSearchUrl defaults to perplexity', () => {
  assert.equal(buildSearchUrl('perplexity', 'cats'), 'https://www.perplexity.ai/search/?q=cats');
  assert.equal(buildSearchUrl(undefined, 'cats'), 'https://www.perplexity.ai/search/?q=cats');
});

test('buildSearchUrl builds google/bing/ddg URLs', () => {
  assert.equal(buildSearchUrl('google', 'cats'), 'https://www.google.com/search?q=cats');
  assert.equal(buildSearchUrl('bing', 'cats'), 'https://www.bing.com/search?q=cats');
  assert.equal(buildSearchUrl('ddg', 'cats'), 'https://duckduckgo.com/?q=cats');
});

test('buildSearchUrl URL-encodes the query', () => {
  assert.equal(buildSearchUrl('google', 'a b & c'), 'https://www.google.com/search?q=a%20b%20%26%20c');
});
