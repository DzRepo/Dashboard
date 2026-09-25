/**
 * pomodoro — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderPomodoro(widget, container) {
    widget.data = widget.data || {};
    const cfg = widget.config || {};
    const focusMin   = Math.max(1,  Number(cfg.focusMin)        || 25);
    const shortBrkMin= Math.max(1,  Number(cfg.shortBreakMin)   || 5);
    const longBrkMin = Math.max(1,  Number(cfg.longBreakMin)    || 15);
    const sessionsUntilLong = Math.max(2, Number(cfg.sessionsUntilLong) || 4);

    // Normalise runtime state.
    if (!['focus','short','long'].includes(widget.data.mode)) widget.data.mode = 'focus';
    if (typeof widget.data.remainingSec !== 'number' || !isFinite(widget.data.remainingSec) || widget.data.remainingSec < 0) {
        widget.data.remainingSec = focusMin * 60;
    }
    if (typeof widget.data.completedSessions !== 'number') widget.data.completedSessions = 0;

    // Duration (seconds) for a given mode — single source of truth for the progress bar,
    // session completion, and timestamp math.
    function modeSec(mode) {
        return (mode === 'focus' ? focusMin : mode === 'short' ? shortBrkMin : longBrkMin) * 60;
    }

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'pomodoro-wrap';

    // Static skeleton: build the DOM once and update only textContent / style.width
    // per tick. Rebuilding innerHTML on every render would destroy the buttons and
    // orphan their listeners (P0-1). The mode label, time, progress fill and session
    // count are computed per render because widget.data.mode changes when a session
    // completes — but the elements themselves are created exactly once here.
    const modeEl = document.createElement('div');
    modeEl.className = 'pomodoro-mode';

    const timeEl = document.createElement('div');
    timeEl.className = 'pomodoro-time';
    // P1-6: role="timer" (implicit aria-live "off") — the per-second countdown is not
    // announced. Session completion is a discrete event and is announced via
    // announceStatus() in startTick().
    timeEl.setAttribute('role', 'timer');

    const progressEl = document.createElement('div');
    progressEl.className = 'pomodoro-progress';
    const barEl = document.createElement('div');
    barEl.className = 'pomodoro-bar';
    progressEl.appendChild(barEl);

    const sessionsEl = document.createElement('p');
    sessionsEl.className = 'pomodoro-sessions';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'pomodoro-actions';
    const startPauseBtn = document.createElement('button');
    startPauseBtn.type = 'button';
    startPauseBtn.className = 'pomodoro-btn pomodoro-start-pause';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'pomodoro-btn pomodoro-reset';
    resetBtn.textContent = '↺ Reset';
    actionsEl.appendChild(startPauseBtn);
    actionsEl.appendChild(resetBtn);

    wrap.appendChild(modeEl);
    wrap.appendChild(timeEl);
    wrap.appendChild(progressEl);
    wrap.appendChild(sessionsEl);
    wrap.appendChild(actionsEl);

    function fmt(sec) {
        sec = Math.max(0, Math.round(sec));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    // Update the existing skeleton in place — never rebuild it.
    function renderState() {
        modeEl.textContent = { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[widget.data.mode] || 'Focus';
        timeEl.textContent = fmt(widget.data.remainingSec);

        const totalSec = modeSec(widget.data.mode);
        barEl.style.width = Math.max(0, Math.min(100, (widget.data.remainingSec / totalSec) * 100)).toFixed(1) + '%';

        sessionsEl.textContent = `✓ ${widget.data.completedSessions} session${widget.data.completedSessions === 1 ? '' : 's'} completed`;
        startPauseBtn.textContent = widget.data.running ? '⏸ Pause' : '▶ Start';
    }

    renderState();
    container.appendChild(wrap);

    // ── Timer management ───────────────────────────────────────────────
    function clearTimer() { return clearWidgetTimer(widget.id); }

    // Advance past one completed session: update mode + counter, set remainingSec to
    // the next mode's full duration. Returns a label for status announcements.
    function advanceSession() {
        if (widget.data.mode === 'focus') {
            widget.data.completedSessions++;
            const shouldLong = (widget.data.completedSessions % sessionsUntilLong === 0);
            widget.data.mode = shouldLong ? 'long' : 'short';
        } else {
            // Break finished → back to focus.
            widget.data.mode = 'focus';
        }
        widget.data.remainingSec = modeSec(widget.data.mode);
        return { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[widget.data.mode];
    }

    function persist() {
        if (typeof Dashboard.saveFullState === 'function') Dashboard.saveFullState();
    }

    function startTick() {
        clearTimer(); // prevent stacking on re-render / double-start
        widget.data.running = true;
        // P1-1: time is derived from a wall-clock endTime, not a decremented counter.
        // The interval below is only a ~250 ms render heartbeat — browsers may throttle
        // it in background tabs, but the displayed time always comes from Date.now(),
        // so a running Pomodoro never loses or gains time when the tab is unfocused.
        widget.data.endTime = Date.now() + Math.max(0, widget.data.remainingSec) * 1000;
        persist();
        renderState();

        const id = setInterval(() => {
            // Recompute remaining from the wall clock (never decrement a counter).
            widget.data.remainingSec = Math.max(0, Math.round((widget.data.endTime - Date.now()) / 1000));
            if (widget.data.remainingSec <= 0) {
                // Session finished. The timer auto-advances to the next session and
                // keeps running (matching the previous behavior), so set a fresh endTime.
                const label = advanceSession();
                widget.data.endTime = Date.now() + modeSec(widget.data.mode) * 1000;
                widget.data.remainingSec = modeSec(widget.data.mode);
                persist();

                // Visual + audio cue.
                if (typeof Dashboard.announceStatus === 'function') {
                    Dashboard.announceStatus('Pomodoro complete — starting ' + label.toLowerCase() + '.');
                }
            }
            renderState();
        }, 250);
        setWidgetTimer(widget.id, id);
    }

    function pauseTick() {
        clearTimer();
        widget.data.running = false;
        // Persist the paused remainder so a reload resumes from here, not from endTime.
        widget.data.remainingSec = Math.max(0, Math.round((widget.data.endTime - Date.now()) / 1000));
        delete widget.data.endTime;
        persist();
        renderState();
    }

    // ── Button wiring (the skeleton is built once, so these listeners stay valid) ──
    startPauseBtn.addEventListener('click', () => {
        if (widget.data.running) pauseTick(); else startTick();
    });

    resetBtn.addEventListener('click', () => {
        clearTimer();
        widget.data.running = false;
        delete widget.data.endTime; // no pending wall-clock target after a reset
        widget.data.mode = 'focus';
        widget.data.remainingSec = focusMin * 60;
        persist();
        renderState();
    });

    // Persist when the tab is hidden so a reload can resume from endTime.
    // Bind once per widget object to avoid stacking on dashboard re-renders.
    if (!widget.__pomodoroVisBound) {
        widget.__pomodoroVisBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && widget.data && widget.data.running) {
                if (typeof Dashboard.saveFullState === 'function') Dashboard.saveFullState();
            }
        });
    }

    // ── Load-time resume (P1-1) ───────────────────────────────────────
    // If the timer was running when the page last saved, fast-forward across any
    // sessions that completed while we were closed instead of silently resuming a
    // stale counter. We complete as many full sessions as the elapsed wall-clock time
    // accounts for, then resume the final (possibly partial) session from its endTime.
    if (widget.data.running && typeof widget.data.endTime === 'number' && isFinite(widget.data.endTime)) {
        const now = Date.now();
        if (widget.data.endTime <= now) {
            // At least one full session elapsed while closed. Fast-forward through them.
            let guard = 0;
            while (widget.data.endTime <= now && guard < 1000) {
                const label = advanceSession();
                widget.data.endTime += modeSec(widget.data.mode) * 1000;
                guard++;
            }
            if (typeof Dashboard.announceStatus === 'function') {
                const n = widget.data.completedSessions;
                Dashboard.announceStatus('Pomodoro caught up — ' + (n === 1 ? '1 session' : n + ' sessions') + ' completed while away.');
            }
        }
        // Resume the (possibly fast-forwarded) session from its wall-clock endTime.
        startTick();
    } else {
        // Not running: make sure a stale endTime from an old session can't leak in.
        delete widget.data.endTime;
        clearTimer();
    }
}

/** C2: thin alias over the shared registry — kept so existing call-sites read naturally. */
function clearPomodoroTimer(widgetId) { return clearWidgetTimer(widgetId); }


// P2-9: publish on the shared namespace.
Dashboard.renderPomodoro = renderPomodoro;
Dashboard.clearPomodoroTimer = clearPomodoroTimer;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
