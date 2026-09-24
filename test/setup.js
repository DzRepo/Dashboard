/**
 * Test setup — loads the dashboard's classic-script files in dependency order into a shared
 * browser-like scope, so tests can exercise the same code the page runs.
 *
 * The app is deliberately built as classic <script> tags (no ES modules) to keep double-click
 * file:// loading working. To make the pure helpers unit-testable without a build step, we
 * (1) stub the browser globals each file touches at load time and (2) evaluate each file in a
 * single shared vm context, mirroring how classic scripts share the global object.
 *
 * Top-level `const`/`let` in a vm context are not visible on the sandbox object (only
 * `function`/`var` are), so we append a tiny export snippet to each file's source that copies
 * its public symbols onto `globalThis.__exports`. This is test-only — the production files are
 * never modified.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Minimal browser-global stubs (only what the files reference at LOAD time) ─────
const _ls = {};

// A permissive DOM element stub: callable, with the props app.js's boot code touches.
// querySelector returns a fresh permissive element (so .querySelector(...).appendChild()
// chains don't crash) and querySelectorAll returns [] so loops are no-ops.
function makeEl() {
  const el = function () { return null; };
  el.style = { setProperty() {}, removeProperty() {} };
  el.dataset = {};
  el.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  el.setAttribute = () => {};
  el.getAttribute = () => null;
  el.removeAttribute = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  el.appendChild = () => {};
  el.querySelector = () => makeEl();
  el.querySelectorAll = () => [];
  return el;
}

const sandbox = {
  console,
  Date, URL, Math, JSON, Object, Array, Number, String, Boolean, Set, Map, Promise,
  // Stub the timer functions so widget boot (clock/pomodoro ticks) doesn't create real
  // intervals that keep the Node process alive. Tests don't exercise live timers.
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  encodeURIComponent, decodeURIComponent,
  structuredClone, isFinite, parseInt, parseFloat, isNaN, Error, TypeError, RangeError,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
    setItem: (k, v) => { _ls[k] = String(v); },
    removeItem: (k) => { delete _ls[k]; },
    clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; }
  },
  // widgets.js / registry.js reference these render fns (only invoked by tests that need them).
  renderShortcuts: function () {},
  renderLists: function () {},
  renderClock: function () {},
  renderPerplexity: function () {},
  // app.js touches the DOM at load (state init + element lookups). Stub enough to not throw.
  document: {
    getElementById: () => makeEl(), createElement: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [],
    documentElement: makeEl(), body: makeEl(),
    addEventListener: () => {}, removeEventListener: () => {}
  },
  navigator: { serviceWorker: undefined, userAgent: 'node-test' },
  location: { protocol: 'file:' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  alert: (msg) => console.error('DBG ALERT:', msg),
  window: undefined, // assigned to the sandbox itself below (like a browser's top-level scope)
  __exports: {},     // per-file public symbols, populated by the appended export snippet
  init: function () {} // app.js calls this at load; stub it so no DOM boot happens in tests
};

// In a browser, `window` is the global object; mirror that so app.js's
// window.state / window.saveFullState assignments land on the sandbox.
sandbox.window = sandbox;

const context = vm.createContext(sandbox);

// ── Evaluate each file in the shared context, dependency order ───────────────────
const ROOT = path.resolve(__dirname, '..');

// Symbols each file publishes that tests need. The appended snippet copies them onto
// globalThis.__exports so they're readable from outside the context (const/let are not).
const EXPORTS = {
  'storage.js': ['Storage'],
  'registry.js': ['WidgetRegistry', 'buildSearchUrl', 'genWidgetId', 'getRegisteredTypes'],
  'widgets.js': ['pruneHabitsLog', '_dateKey', 'setWidgetTimer', 'clearWidgetTimer'],
  'app.js': ['hexToRgb', 'rgbaString', 'adjustFillForTheme']
};

function loadFile(name) {
  let code = fs.readFileSync(path.join(ROOT, name), 'utf8');
  const syms = EXPORTS[name] || [];
  if (syms.length) {
    // `this` in a non-strict vm script is the context's global object (the sandbox), so
    // this.__exports lands on our sandbox — unlike `globalThis`, which points at Node's
    // own global (a different realm) and would miss the sandbox entirely.
    code += `\n;this.__exports.${name.replace('.js', '')} = { ${syms.join(', ')} };`;
  }
  vm.runInContext(code, context, { filename: name });
}

// Order matches index.html: storage → registry → widgets, then app.js.
loadFile('storage.js');
loadFile('registry.js');
loadFile('widgets.js');

// Pre-seed localStorage with a complete v5 default state so app.js's top-level init()
// (which runs because its bare `init()` call resolves to the real function) skips
// seedDashboard()'s DOM-building path. The remaining boot (applySettings + empty
// renderDashboard) is a no-op against the stubbed DOM, so loading app.js defines its
// module-level helpers cleanly. We build it from Storage._defaultState() so the shape is exact.
const _seed = sandbox.__exports.storage.Storage._defaultState();
_seed.settings.theme = 'light'; // avoid the matchMedia system-theme path
sandbox.localStorage.setItem('personalDashboard:data', JSON.stringify(_seed));

loadFile('app.js');

module.exports = { sandbox, exports: sandbox.__exports || {}, localStorage: sandbox.localStorage };
