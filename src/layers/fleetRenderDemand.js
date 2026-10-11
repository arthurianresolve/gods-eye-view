/**
 * Keep ordinary fleet updates on their existing bounded tick cadence while
 * reserving continuous rendering for per-frame tracked-entity callbacks.
 */
export function createFleetRenderDemand(
  render,
  { owner, intervalMs, isEnabled, isTracked, remainingDelayMs },
) {
  const hold = render?.holdContinuousRender || (() => {});
  const release = render?.releaseContinuousRender || (() => {});
  const schedule = render?.scheduleRenderUpdate;
  const canSchedule = typeof schedule === 'function';
  const ownerId = Symbol(String(owner || 'fleet').slice(0, 64));
  let enabled = false;
  let held = false;
  let wakePending = false;
  let cancelWake = () => {};
  let wakeGeneration = 0;
  let disposed = false;

  function clearWake() {
    if (!wakePending) return;
    cancelWake();
    cancelWake = () => {};
    wakePending = false;
    wakeGeneration += 1;
  }

  function holdContinuous() {
    if (held) return;
    clearWake();
    held = true;
    hold(ownerId);
  }

  function releaseContinuous() {
    if (!held) return;
    held = false;
    release(ownerId);
  }

  function scheduleWake(delayMs) {
    if (!canSchedule || !enabled || disposed || isTracked?.()) return;
    clearWake();
    const generation = ++wakeGeneration;
    wakePending = true;
    const cancel = schedule.call(
      render,
      ownerId,
      () => {
        if (disposed || !wakePending || generation !== wakeGeneration) return;
        wakePending = false;
        cancelWake = () => {};
        // Keep a fallback wake alive if the browser omits the requested frame.
        // A completed fleet tick replaces this deadline with one relative to the
        // actual tick time via noteFrame().
        if (enabled && !disposed && !isTracked?.()) {
          const remaining = remainingDelayMs?.();
          scheduleWake(
            Number.isFinite(remaining) && remaining > 0
              ? remaining
              : intervalMs,
          );
        }
      },
      delayMs,
    );
    cancelWake = typeof cancel === 'function' ? cancel : () => {};
  }

  function sync() {
    if (disposed) return;
    if (!enabled || !isEnabled?.()) {
      clearWake();
      releaseContinuous();
      return;
    }
    if (isTracked?.() || !canSchedule) {
      holdContinuous();
      return;
    }
    releaseContinuous();
    if (!wakePending) scheduleWake(0);
  }

  return {
    setEnabled(value) {
      if (disposed) return;
      enabled = Boolean(value);
      sync();
    },
    sync,
    invalidate() {
      if (disposed || !enabled || !isEnabled?.() || isTracked?.()) return;
      scheduleWake(0);
    },
    noteFrame() {
      if (
        !disposed &&
        enabled &&
        isEnabled?.() &&
        !isTracked?.() &&
        canSchedule
      )
        scheduleWake(intervalMs);
    },
    dispose() {
      if (disposed) return;
      enabled = false;
      clearWake();
      releaseContinuous();
      disposed = true;
    },
  };
}

/** Notify the cadence owner only after the existing fleet update actually ran. */
export function createFleetTickCallback({ rendering, state, demand }) {
  return (...args) => {
    const previousTickMs = state._lastFleetTickMs;
    const result = rendering._fleetTick(...args);
    if (state._lastFleetTickMs !== previousTickMs) demand.noteFrame();
    return result;
  };
}
