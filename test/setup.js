/**
 * Test setup — loads the dashboard's classic-script files in dependency order into a shared
 * browser-like scope, so tests can exercise the same code the page runs.
 *
 * P2-9: each file is wrapped in an IIFE that publishes its public API on the shared
 * `Dashboard` namespace (created by storage.js). The test harness reads everything from
 * `sandbox.Dashboard` after loading all files. No export-snippet appending is needed —
 * the namespace IS the public API.
 *
 * Top-level `const`/`let` in a vm context are not visible on the sandbox object (only
 * `function`/`var` are), but since all our files use IIFEs that assign to `root.Dashboard`,
 * the namespace object is a plain property on the sandbox and fully accessible.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Minimal browser-global stubs (only what the files reference at LOAD time) ─────
const _ls = {};

// A permissive DOM element stub: callable, with the props app/boot.js touches.
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
  // app/boot.js touches the DOM at load (state init + element lookups). Stub enough to not throw.
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
  confirm: () => true,
  window: undefined, // assigned to the sandbox itself below (like a browser's top-level scope)
  Dashboard: undefined // created by storage.js IIFE at load time
};

// In a browser, `window` is the global object; mirror that so app/boot.js's
// IIFE receives the sandbox as `root` (via typeof window !== 'undefined' ? window : globalThis).
sandbox.window = sandbox;

const context = vm.createContext(sandbox);

// ── Evaluate each file in the shared context, dependency order ───────────────────
const ROOT = path.resolve(__dirname, '..');

function loadFile(name) {
  const code = fs.readFileSync(path.join(ROOT, name), 'utf8');
  vm.runInContext(code, context, { filename: name });
}

// Order matches index.html: storage → widget files (shared first) → registry, then app/.
loadFile('storage.js');
const WIDGET_FILES = [
  'widgets/shared/helpers.js',
  'widgets/shortcuts.js', 'widgets/lists.js', 'widgets/clock.js',
  'widgets/search.js', 'widgets/weather.js', 'widgets/notes.js',
  'widgets/stocks.js', 'widgets/countdown.js', 'widgets/rss.js',
  'widgets/pomodoro.js', 'widgets/currency.js', 'widgets/habits.js'
];
for (const f of WIDGET_FILES) loadFile(f);
loadFile('registry.js');

// Pre-seed localStorage with a complete v5 default state so app/boot.js's init()
// skips seedDashboard()'s DOM-building path. The remaining boot (applySettings + empty
// renderDashboard) is a no-op against the stubbed DOM.
const _seed = sandbox.Dashboard.Storage._defaultState();
_seed.settings.theme = 'light'; // avoid the matchMedia system-theme path
sandbox.localStorage.setItem('personalDashboard:data', JSON.stringify(_seed));

// P2-10: app split into app/ files, loaded in dependency order (matches index.html).
// The last file (boot.js) ends with a guarded boot: `if (typeof window !== 'undefined')
// Dashboard.init()`. In the VM, sandbox.window IS defined (we set it above), so init()
// WILL run. The stubbed DOM makes all its operations no-ops, which is fine for tests
// that only exercise pure helpers (hexToRgb, adjustFillForTheme, etc.).
const APP_FILES = [
  'app/state.js',
  'app/toasts.js',
  'app/dnd.js',
  'app/widget-card.js',
  'app/grid.js',
  'app/palette.js',
  'app/modals/modal.js',
  'app/modals/edit-widget.js',
  'app/modals/settings.js',
  'app/boot.js'
];
for (const f of APP_FILES) loadFile(f);

// Expose the namespace for tests. All public API is on sandbox.Dashboard.
module.exports = {
  sandbox,
  Dashboard: sandbox.Dashboard || {},
  localStorage: sandbox.localStorage
};
