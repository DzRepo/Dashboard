/**
 * app/modals/modal.js — shared modal plumbing: close, focus-into, and Tab trap. The
 * individual open functions (add / edit widget, settings) live in their own files; these
 * three are shared by all of them. Loaded after state.js so it can read modalContainer /
 * modalBody / lastFocusedBeforeModal. Published to Dashboard for boot.js's init().
 */

function closeModal() {
    const wasOpen = !modalContainer.hidden;
    modalContainer.hidden = true;
    if (wasOpen && lastFocusedBeforeModal) {
        // Return focus to whatever triggered the dialog so keyboard users aren't stranded.
        try { lastFocusedBeforeModal.focus(); } catch(e) {}
        lastFocusedBeforeModal = null;
    }
}

/**
 * P2-1: set the modal's accessible name. The #modal-title element is referenced
 * by aria-labelledby on #modal-container; without this, screen readers announce
 * every dialog as "Dialog". Call with the modal's title before showing it.
 */
function _setModalTitle(title) {
    const el = document.getElementById('modal-title');
    if (el) el.textContent = title || 'Dialog';
}

/**
 * Focus management for modals: remember the trigger, then move focus into the
 * dialog (first input or first button). Call right after setting modalContainer.hidden=false.
 */
function _focusIntoModal() {
    if (!lastFocusedBeforeModal) lastFocusedBeforeModal = document.activeElement;
    // Give the browser a tick to finish layout before focusing inside.
    requestAnimationFrame(() => {
        const firstInput  = modalBody.querySelector('input, textarea, select');
        const firstButton = firstInput ? null : modalBody.querySelector('button');
        (firstInput || firstButton || modalContainer).focus();
    });
}

/** Simple trap: keep Tab / Shift+Tab inside the open modal. */
function _trapModalFocus(e) {
    if (e.key !== 'Tab' || modalContainer.hidden) return;
    // P2-2: query from modalContainer (not modalBody) so the .modal-close ×
    // button — which lives in .modal-content, a sibling of #modal-body — is
    // included in Tab cycling. Previously keyboard users could only close via
    // Esc or backdrop click (mouse-only).
    const focusables = Array.from(modalContainer.querySelectorAll(
        'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
    }
}

// Publish the public API on the shared namespace.
Dashboard.closeModal = closeModal;
Dashboard._focusIntoModal = _focusIntoModal;
Dashboard._trapModalFocus = _trapModalFocus;
Dashboard._setModalTitle = _setModalTitle;
