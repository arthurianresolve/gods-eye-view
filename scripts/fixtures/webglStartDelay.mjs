function snapshotEnvironment(windowTarget, documentTarget) {
  let focused = null;
  let visibility = 'unknown';
  let width = null;
  let height = null;
  try {
    if (typeof documentTarget.hasFocus === 'function') {
      const value = documentTarget.hasFocus();
      focused = typeof value === 'boolean' ? value : null;
    }
  } catch {
    // The report keeps unavailable browser state explicit.
  }
  try {
    visibility = String(documentTarget.visibilityState || 'unknown');
  } catch {
    // The report keeps unavailable browser state explicit.
  }
  try {
    width = Number.isFinite(windowTarget.innerWidth)
      ? windowTarget.innerWidth
      : null;
    height = Number.isFinite(windowTarget.innerHeight)
      ? windowTarget.innerHeight
      : null;
  } catch {
    // The report keeps unavailable viewport state explicit.
  }
  return {
    focused,
    visibility,
    viewport: { width, height },
  };
}

function changedFields(before, after) {
  return {
    focus: before.focused !== after.focused,
    visibility: before.visibility !== after.visibility,
    viewport:
      before.viewport.width !== after.viewport.width ||
      before.viewport.height !== after.viewport.height,
  };
}

/** Read a bounded browser-preparation state snapshot for diagnostic reports. */
export function readPreparationState(windowTarget, documentTarget) {
  return snapshotEnvironment(windowTarget, documentTarget);
}

/**
 * Wait once before a diagnostic measurement while owning only temporary
 * listeners and one timer. The resolved record describes preparation; it does
 * not include any measurement-window observations.
 */
export function createStartDelay({
  delayMs,
  now = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (id) => clearTimeout(id),
  windowTarget = window,
  documentTarget = document,
}) {
  if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 10_000) {
    throw new RangeError('Preparation delay must be between 1 and 10000 ms.');
  }

  const startedAtMs = now();
  const started = snapshotEnvironment(windowTarget, documentTarget);
  const changes = { focus: false, visibility: false, viewport: false };
  const events = [];
  let timerId = null;
  let settled = false;
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const onChange = (kind) => {
    if (settled) return;
    if (kind === 'focus') changes.focus = true;
    else if (kind === 'visibility') changes.visibility = true;
    else if (kind === 'viewport') changes.viewport = true;
    if (events.length < 16) events.push(kind);
  };
  const onPageHide = () => settle('pagehide');
  const listeners = [
    [windowTarget, 'focus', () => onChange('focus')],
    [windowTarget, 'blur', () => onChange('focus')],
    [windowTarget, 'resize', () => onChange('viewport')],
    [windowTarget, 'pagehide', onPageHide],
    [documentTarget, 'visibilitychange', () => onChange('visibility')],
  ];
  const attached = [];

  const cleanup = () => {
    if (timerId !== null) {
      try {
        clearTimer(timerId);
      } catch {
        // All listeners are still released even if a timer host is unavailable.
      }
      timerId = null;
    }
    for (const [target, type, listener] of attached.splice(0)) {
      try {
        target.removeEventListener(type, listener);
      } catch {
        // Continue releasing the remaining owned listeners.
      }
    }
  };

  const settle = (reason = 'elapsed') => {
    if (settled) return;
    settled = true;
    let completed;
    try {
      completed = snapshotEnvironment(windowTarget, documentTarget);
      const finalChanges = changedFields(started, completed);
      changes.focus ||= finalChanges.focus;
      changes.visibility ||= finalChanges.visibility;
      changes.viewport ||= finalChanges.viewport;
    } finally {
      cleanup();
    }
    resolvePromise({
      requestedDelayMs: delayMs,
      actualDelayMs: Math.max(0, now() - startedAtMs),
      started,
      completed: completed || null,
      changes,
      changeEvents: events.slice(),
      outcome: reason === 'elapsed' ? 'elapsed' : 'cancelled',
      cancelReason: reason === 'elapsed' ? null : reason,
    });
  };

  try {
    for (const entry of listeners) {
      const [target, type, listener] = entry;
      target.addEventListener(type, listener);
      attached.push(entry);
    }
    timerId = setTimer(() => settle('elapsed'), delayMs);
    if (timerId === null || timerId === undefined) {
      throw new Error('Could not schedule the preparation delay.');
    }
  } catch (error) {
    try {
      cleanup();
    } catch {
      // Preserve the setup error; callers still own page-level cleanup.
    }
    throw error;
  }

  return {
    promise,
    cancel(reason = 'user-cancelled') {
      settle(reason);
    },
    dispose() {
      settle('disposed');
    },
  };
}
