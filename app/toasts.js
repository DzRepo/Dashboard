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
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200);
    };

    // Auto-dismiss timer.
    const autoTimer = setTimeout(dismiss, undoToasts.autoDismissMs);

    if (onUndo) {
        el.querySelector('.toast-undo-btn').addEventListener('click', () => {
            clearTimeout(autoTimer);
            try { onUndo(); } catch (e) { console.error('Undo failed:', e); }
            dismiss();
        });
    }

    el.querySelector('.toast-dismiss-btn').addEventListener('click', () => {
        clearTimeout(autoTimer);
        dismiss();
    });

    // Pause the auto-dismiss while hovering so users have time to read / click.
    el.addEventListener('mouseenter', () => { if (!dismissed) clearTimeout(autoTimer); });
    el.addEventListener('mouseleave', () => {
        if (dismissed) return;
        setTimeout(dismiss, 2000);
    });

    region.appendChild(el);
}

// Publish the public API on the shared namespace.
Dashboard.showUndoToast = showUndoToast;
