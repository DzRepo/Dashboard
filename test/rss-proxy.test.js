'use strict';
const { Dashboard: D } = require('./setup');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// buildProxyStrategies is a pure function published on the Dashboard namespace.
// It returns an ordered array of { label, url } proxy attempts (the caller prepends
// the direct feed URL as its first attempt).

const FEED = 'https://example.com/feed.xml';
const ENC  = encodeURIComponent(FEED);

test('no proxy configured → empty strategy list', () => {
  const s = D.buildProxyStrategies(FEED, {});
  assert.equal(s.length, 0);
});

test('no settings object → empty strategy list', () => {
  const s = D.buildProxyStrategies(FEED, null);
  assert.equal(s.length, 0);
});

test('user proxy with {url} placeholder', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: 'https://myproxy.example.com/proxy?url={url}' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[0].url, 'https://myproxy.example.com/proxy?url=' + ENC);
});

test('user proxy with {URL} placeholder (case-insensitive)', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: 'https://myproxy.example.com/proxy?url={URL}' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[0].url, 'https://myproxy.example.com/proxy?url=' + ENC);
});

test('user proxy with existing query string (trailing ?)', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: 'https://myproxy.example.com/proxy?' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[0].url, 'https://myproxy.example.com/proxy?url=' + ENC);
});

test('user proxy with trailing slash (path prefix)', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: 'https://myproxy.example.com/proxy/' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[0].url, 'https://myproxy.example.com/proxy/?url=' + ENC);
});

test('user proxy with no trailing slash or ? (append)', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: 'https://myproxy.example.com/proxy' });
  assert.equal(s.length, 1);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[0].url, 'https://myproxy.example.com/proxy?url=' + ENC);
});

test('public proxies are NOT included by default (opt-in)', () => {
  const s = D.buildProxyStrategies(FEED, {});
  assert.equal(s.length, 0);

  const s2 = D.buildProxyStrategies(FEED, { rssAllowPublicProxies: false });
  assert.equal(s2.length, 0);

  const s3 = D.buildProxyStrategies(FEED, { corsProxyUrl: '', rssAllowPublicProxies: false });
  assert.equal(s3.length, 0);
});

test('public proxies ARE included when opt-in is enabled', () => {
  const s = D.buildProxyStrategies(FEED, { rssAllowPublicProxies: true });
  assert.equal(s.length, 3);
  assert.equal(s[0].label, 'allorigins');
  assert.equal(s[1].label, 'corsproxy.io');
  assert.equal(s[2].label, 'codetabs');
  // Verify the URLs contain the encoded feed URL.
  for (const x of s) {
    assert.ok(x.url.includes(ENC), 'expected ' + ENC + ' in ' + x.url);
  }
});

test('user proxy comes BEFORE public proxies when both are set', () => {
  const s = D.buildProxyStrategies(FEED, {
    corsProxyUrl: 'https://myproxy.example.com/proxy?url={url}',
    rssAllowPublicProxies: true
  });
  assert.equal(s.length, 4);
  assert.equal(s[0].label, 'custom');
  assert.equal(s[1].label, 'allorigins');
  assert.equal(s[2].label, 'corsproxy.io');
  assert.equal(s[3].label, 'codetabs');
});

test('whitespace-only proxy URL is treated as empty', () => {
  const s = D.buildProxyStrategies(FEED, { corsProxyUrl: '   ' });
  assert.equal(s.length, 0);
});
