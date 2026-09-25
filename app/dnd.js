/**
 * app/dnd.js — drag-and-drop reordering. Cards are grabbed by the grip handle in their
 * header; a dashed drop indicator shows the target slot, and dropping into empty grid
 * area moves the card to the end. Also provides keyboard reordering (arrow keys on the
 * handle) as the accessible alternative. Reorders mutate state.widgets and persist via
 * Storage, then re-render through renderDashboard.
 */

let draggingCard = null;
let dropIndicator = null;
let indicatorTarget = null;    // card the indicator sits before/after (null = end of grid)
let indicatorPosition = null;  // 'before' | 'after' | 'end'

function handleDragStart(e, card) {
    draggingCard = card;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    // Defer the class so the browser captures the drag image before styling changes.
    requestAnimationFrame(() => card.classList.add('dragging'));
}

function handleDragEnd(e, card) {
    card.classList.remove('dragging');
    card.draggable = false;
    if (draggingCard === card) draggingCard = null;
    clearDropIndicator();
}

function handleDragOver(e, card) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (card === draggingCard) return;
    showDropIndicator(card, getDropPosition(e, card));
}

function handleDrop(e, card) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = draggingCard ? draggingCard.dataset.id: null;
    clearDropIndicator();
    if (!draggedId || card === draggingCard) return;
    commitReorder(draggedId, card.dataset.id, getDropPosition(e, card));
}

/**
 * Decide whether the pointer is in the "before" or "after" half of the target card.
 * Uses the dominant axis: side-by-side cards split left/right, stacked cards split top/bottom.
 */
function getDropPosition(e, card) {
    const rect = card.getBoundingClientRect();
    const vOverlap = Math.min(rect.bottom, e.clientY) - Math.max(rect.top, e.clientY);
    const hOverlap = Math.min(rect.right, e.clientX) - Math.max(rect.left, e.clientX);
    if (hOverlap > vOverlap) {
        return e.clientX < rect.left + rect.width / 2 ? 'before': 'after';
    }
    return e.clientY < rect.top + rect.height / 2 ? 'before': 'after';
}

function ensureDropIndicator() {
    if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
        dropIndicator.setAttribute('aria-hidden', 'true');
    }
    return dropIndicator;
}

function showDropIndicator(card, position) {
    if (indicatorTarget === card && indicatorPosition === position) return;
    clearDropIndicator();
    const indicator = ensureDropIndicator();
    if (position === 'before') card.before(indicator);
    else card.after(indicator);
    indicatorTarget = card;
    indicatorPosition = position;
}

function showDropIndicatorAtEnd() {
    if (indicatorTarget === null && indicatorPosition === 'end') return;
    clearDropIndicator();
    dashboardGrid.appendChild(ensureDropIndicator());
    indicatorTarget = null;
    indicatorPosition = 'end';
}

function clearDropIndicator() {
    if (dropIndicator && dropIndicator.parentNode) dropIndicator.remove();
    indicatorTarget = null;
    indicatorPosition = null;
}

/**
 * Grid-level handlers: dropping outside any card (gaps or empty space) lands at the end.
 */
function handleGridDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropIndicator && e.target === dropIndicator) return; // already showing a slot
    showDropIndicatorAtEnd();
}

function handleGridDragLeave(e) {
    if (!dashboardGrid.contains(e.relatedTarget)) clearDropIndicator();
}

function handleGridDrop(e) {
    e.preventDefault();
    if (!draggingCard) return;
    const draggedId = draggingCard.dataset.id;

    if (dropIndicator && e.target === dropIndicator && dropIndicator.parentNode) {
        // Dropped onto the indicator slot: land before the next card, or at the end.
        let sibling = dropIndicator.nextElementSibling;
        while (sibling && !sibling.classList.contains('widget-card')) {
            sibling = sibling.nextElementSibling;
        }
        clearDropIndicator();
        if (sibling) commitReorder(draggedId, sibling.dataset.id, 'before');
        else commitReorderToEnd(draggedId);
        return;
    }

    clearDropIndicator();
    commitReorderToEnd(draggedId);
}

/**
 * Commit reorders and persist state.
 */
function commitReorder(draggedId, targetId, position) {
    if (draggedId === targetId) return;
    const fromIndex = state.widgets.findIndex(w => w.id === draggedId);
    if (fromIndex === -1) return;

    const item = state.widgets.splice(fromIndex, 1)[0];
    let toIndex = state.widgets.findIndex(w => w.id === targetId);
    if (toIndex === -1) toIndex = 0;
    if (position === 'after') toIndex += 1;
    state.widgets.splice(toIndex, 0, item);

    persistReorder();
}

function commitReorderToEnd(draggedId) {
    const fromIndex = state.widgets.findIndex(w => w.id === draggedId);
    if (fromIndex === -1) return;
    const item = state.widgets.splice(fromIndex, 1)[0];
    state.widgets.push(item);
    persistReorder();
}

function persistReorder() {
    // Keep the position fields in sync with array order.
    state.widgets.forEach((w, i) => { w.position = i; });
    Dashboard.Storage.saveData(state);
    renderDashboard();
}

/**
 * Keyboard reordering for the drag handle (arrow keys), used as the
 * accessible replacement for the removed up/down buttons.
 */
function reorderWidgetByOffset(id, direction) {
    const index = state.widgets.findIndex(w => w.id === id);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.widgets.length) return;

    const item = state.widgets.splice(index, 1)[0];
    state.widgets.splice(newIndex, 0, item);
    persistReorder();

    // Keep focus on the handle so arrow keys can be pressed repeatedly.
    const card = dashboardGrid.querySelector(`.widget-card[data-id="${id}"]`);
    const handle = card && card.querySelector('.widget-drag-handle');
    if (handle) handle.focus();
}

// Publish the public API on the shared namespace.
Dashboard.handleDragStart = handleDragStart;
Dashboard.handleDragEnd = handleDragEnd;
Dashboard.handleDragOver = handleDragOver;
Dashboard.handleDrop = handleDrop;
Dashboard.getDropPosition = getDropPosition;
Dashboard.ensureDropIndicator = ensureDropIndicator;
Dashboard.showDropIndicator = showDropIndicator;
Dashboard.showDropIndicatorAtEnd = showDropIndicatorAtEnd;
Dashboard.clearDropIndicator = clearDropIndicator;
Dashboard.handleGridDragOver = handleGridDragOver;
Dashboard.handleGridDragLeave = handleGridDragLeave;
Dashboard.handleGridDrop = handleGridDrop;
Dashboard.commitReorder = commitReorder;
Dashboard.commitReorderToEnd = commitReorderToEnd;
Dashboard.persistReorder = persistReorder;
Dashboard.reorderWidgetByOffset = reorderWidgetByOffset;
