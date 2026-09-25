/**
 * app/state.js — shared application state, stable DOM references, and cross-file
 * aliases. Loaded first among the app/ files; every other app file reads from these
 * globals (classic scripts share one global scope, exactly as before the split).
 */

/** Application state — loaded once from storage. All app files mutate this object in place. */
const state = Dashboard.Storage.getData();

/** Stable DOM elements (queried once; the grid element is never re-created, so
 *  delegated listeners attached to it in boot.js survive every re-render). */
const dashboardGrid = document.getElementById('dashboard-grid');
const addWidgetBtn  = document.getElementById('add-widget-btn');
const settingsBtn   = document.getElementById('settings-btn');
const modalContainer = document.getElementById('modal-container');
const modalBody     = document.getElementById('modal-body');

// Tracks the element that opened the current modal so we can restore focus on close.
let lastFocusedBeforeModal = null;

// NOTE: escapeHtml / escapeAttr / toLocalInputValue are already shared globals defined in
// widgets/shared/helpers.js (loaded before any app file). The split app files call them
// bare — no per-file aliases (a top-level `const` here would collide across scripts).
