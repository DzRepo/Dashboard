/**
 * app/toasts.js — undo toast system: a small, dependency-free stack of transient
 * notifications in the bottom-right corner. Each toast carries a label and an optional
 * `onUndo` callback; auto-dismisses after ~6 s (paused on hover). Published to
 * Dashboard.showUndoToast so the modals can trigger them.
 */

const undoToasts = {
    maxVisible: 5,
    autoDismissMs: 6000
};

function _getToastRegion() {
    const el = document.getElementById('undo-toast-region');
    if (!el) return null; // markup missing — degrade gracefully (no-op)
    return el;
}

/**
 * Show a toast with an optional Undo button.
 * @param {string} label   Human-readable description of what was done.
 * @param {Function|null} onUndo  Called when the user clicks "Undo". Pass null for info-only toasts.
 */
function showUndoToast(label, onUndo) {
    const region = _getToastRegion();
    if (!region) return; // no region — silent no-op

    // Cap the visible stack: drop the oldest toast(s) beyond maxVisible.
    const existing = region.querySelectorAll('.toast');
    while (existing.length >= undoToasts.maxVisible) {
        existing[0].remove();
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `
        <span class="toast-label">${escapeHtml(label)}</span>
        ${onUndo ? '<button type="button" class="toast-undo-btn">Undo</button>' : ''}
        <button type="button" class="toast-dismiss-btn" aria-label="Dismiss">×</button>
    `;

    let dismissed = false;
    let autoTimer = null;
    let leaveTimer = null;

    // Function declaration (not const) so setTimeout can reference it without TDZ.
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(autoTimer);
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200);
    }

    // P2-3: track the leave timer so it can be cleared on re-hover and in
    // dismiss(). The old code scheduled an untracked 2 s setTimeout on every
    // mouseleave — re-entering the toast within that window still dismissed it,
    // and repeated leave/enter cycles stacked multiple timers.
    autoTimer = setTimeout(dismiss, undoToasts.autoDismissMs);

    if (onUndo) {
        el.querySelector('.toast-undo-btn').addEventListener('click', () => {
            try { onUndo(); } catch (e) { console.error('Undo failed:', e); }
            dismiss();
        });
    }

    el.querySelector('.toast-dismiss-btn').addEventListener('click', () => {
        dismiss();
    });

    // Pause the auto-dismiss while hovering so users have time to read / click.
    el.addEventListener('mouseenter', () => {
        if (dismissed) return;
        clearTimeout(autoTimer);
        // P2-3: also cancel any pending leave-dismiss so a quick re-hover
        // doesn't still fire the old timer.
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    });
    el.addEventListener('mouseleave', () => {
        if (dismissed) return;
        // P2-3: store the timer so mouseenter / dismiss can cancel it.
        leaveTimer = setTimeout(dismiss, 2000);
    });

    region.appendChild(el);
}

// Publish the public API on the shared namespace.
Dashboard.showUndoToast = showUndoToast;
