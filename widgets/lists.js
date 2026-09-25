/**
 * lists — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderLists(widget, container) {
    // Clear any previous render so re-renders don't stack duplicate DOM.
    container.innerHTML = '';

    const items = widget.data.items || [];
    const showCompleted = widget.data.showCompleted ?? true;
    let visible = showCompleted ? items.slice() : items.filter(i => !i.completed).slice();

    // Optional: sort by due date (nulls last), then text. Only when the user toggles it on.
    if (widget.data.sortByDueDate) {
        visible.sort((a, b) => {
            const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            return String(a.text || '').localeCompare(String(b.text || ''));
        });
    }

    // "Today" in local time, at midnight — used to flag overdue items.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const total = items.length;
    const completed = items.filter(i => i.completed).length;
    const remaining = total - completed;

    const stats = document.createElement('div');
    stats.className = 'list-stats';
    stats.style.fontSize = '12px';
    stats.style.marginBottom = '10px';
    stats.innerText = `Remaining: ${remaining} | Completed: ${completed}`;

    container.appendChild(stats);

    // NOTE: the "Show completed", "Sort by due date" and "Clear completed"
    // controls now live on this widget's Edit page (see WidgetRegistry['lists'].editFields).
    // They are intentionally NOT rendered in the card body anymore.

    // Semantic <ul>/<li> list
    const list = document.createElement('ul');
    list.className = 'lists-container';
    list.setAttribute('role', 'list');

    visible.forEach((item) => {
        const realIndex = items.indexOf(item);

        // Overdue: has a due date in the past and is not yet completed.
        let overdue = false;
        if (item.dueDate && !item.completed) {
            const d = new Date(item.dueDate);
            if (!isNaN(d.getTime()) && d < todayMidnight) overdue = true;
        }

        const li = document.createElement('li');
        li.className = 'list-item' + (item.completed ? ' completed' : '') + (overdue ? ' overdue' : '');
        // The whole row is a click target that opens the inline editor for due date + note.
        // NOTE: intentionally NOT role="button" / tabindex — this <li> also contains real
        // interactive controls (checkbox + delete). A button role wrapping other interactives
        // confuses screen readers. Click-to-open still works via the delegated handler in app.js;
        // keyboard users reach the checkbox/delete directly, and can open the editor by clicking.
        li.dataset.index = realIndex;
        li.title = 'Click to set due date and add/edit note';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-item-checkbox';
        checkbox.checked = !!item.completed;
        checkbox.dataset.index = realIndex;
        checkbox.setAttribute('aria-label', `Mark \"${item.text}\" as ${item.completed ? 'not completed' : 'completed'}`);

        const labelWrap = document.createElement('span');
        labelWrap.className = 'list-item-label';
        labelWrap.appendChild(checkbox);
        const span = document.createElement('span');
        span.className = 'list-item-text';
        span.textContent = item.text;
        labelWrap.appendChild(span);

        // Compact due-date chip (informational; the row click opens the editor).
        if (item.dueDate) {
            const dLabel = new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const dueChip = document.createElement('span');
            dueChip.className = 'list-due-chip list-due-chip-static' + (overdue ? ' overdue' : '');
            dueChip.textContent = (overdue ? '⚠ ' : '') + dLabel;
            li.appendChild(dueChip);
        }

        // Inline note preview when present.
        if (item.note) {
            const noteSpan = document.createElement('span');
            noteSpan.className = 'list-note-inline';
            noteSpan.title = item.note;
            noteSpan.textContent = truncate(item.note, 24);
            li.appendChild(noteSpan);
        }

        // Delete button — the only per-item control remaining in-card.
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-list-btn';
        deleteBtn.dataset.index = realIndex;
        deleteBtn.textContent = '×';
        deleteBtn.title = `Delete \"${item.text}\"`;
        deleteBtn.setAttribute('aria-label', `Delete \"${item.text}\"`);

        li.appendChild(labelWrap);
        li.appendChild(deleteBtn);

        // Inline editor for due date + note. Hidden by default; toggled open when the row is clicked.
        const editor = document.createElement('div');
        editor.className = 'list-item-editor';
        editor.dataset.index = realIndex;
        editor.hidden = true;

        const dueInputWrap = document.createElement('label');
        dueInputWrap.className = 'list-edit-field';
        dueInputWrap.innerHTML = '<span>Due date</span>' +
            `<input type="date" class="list-due-input" value="${escapeAttr((item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) ? item.dueDate : '')}">`;

        const noteWrap = document.createElement('label');
        noteWrap.className = 'list-edit-field';
        noteWrap.innerHTML = '<span>Note</span>' +
            `<textarea class="list-note-input" placeholder="Add a note…">${escapeHtml(item.note || '')}</textarea>`;

        const actionsRow = document.createElement('div');
        actionsRow.className = 'list-edit-actions';
        actionsRow.innerHTML = `
            <button type="button" class="list-editor-save">Save</button>
            <button type="button" class="list-editor-cancel">Cancel</button>
        `;

        editor.appendChild(dueInputWrap);
        editor.appendChild(noteWrap);
        editor.appendChild(actionsRow);
        li.appendChild(editor);

        list.appendChild(li);
    });

    if (visible.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'list-empty';
        empty.textContent = showCompleted ? 'No items yet.' : 'No remaining items — all done!';
        list.appendChild(empty);
    }

    const inputArea = document.createElement('div');
    inputArea.className = 'list-input-area';
    inputArea.innerHTML = `
        <input type="text" placeholder="New item..." class="list-input">
        <button class="add-list-btn">Add</button>
    `;

    container.appendChild(list);
    container.appendChild(inputArea);
}


// P2-9: publish on the shared namespace.
Dashboard.renderLists = renderLists;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
