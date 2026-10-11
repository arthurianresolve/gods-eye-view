/** Diagnostic-only observer. Never install it in acceptance latency samples. */
export function observeFleetTiming({
  scene,
  timers = globalThis,
  now = () => performance.now(),
  maxEvents = 4096,
}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 20000)
    throw new RangeError('Invalid timing trace capacity');
  const start = now();
  const report = {
    scope: 'Instrumented attribution only; not latency acceptance evidence',
    start,
    maxEvents,
    truncated: false,
    events: [],
  };
  let disposed = false;
  let nextId = 0;
  const pending = new Map();
  const cleanup = [];
  function record(kind, fields = {}) {
    if (disposed) return;
    if (report.events.length === maxEvents) {
      report.truncated = true;
      return;
    }
    report.events.push({ kind, at: now() - start, ...fields });
  }
  function replace(target, key, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    target[key] = wrapper;
    cleanup.push(() => {
      if (target[key] !== wrapper) return;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
  }
  function stop() {
    if (disposed) return report;
    record('stop');
    disposed = true;
    for (const remove of cleanup.reverse()) remove();
    pending.clear();
    return report;
  }
  try {
    const nativeSet = timers.setTimeout;
    const nativeClear = timers.clearTimeout;
    replace(timers, 'setTimeout', function (callback, delay, ...args) {
      // Observe only ordinary short function timers. Leave long-lived source
      // polling and nonnumeric/browser-specific coercion semantics untouched.
      if (
        disposed ||
        typeof callback !== 'function' ||
        (delay !== undefined &&
          (typeof delay !== 'number' || !Number.isFinite(delay))) ||
        delay > 1000
      )
        return nativeSet.call(this, callback, delay, ...args);
      const id = ++nextId;
      const scheduledAt = now() - start;
      const effectiveDelay = Math.max(0, delay ?? 0);
      // Keep only a categorical owner; do not retain stacks or URLs.
      const owner = new Error().stack?.includes('renderGovernor.js')
        ? 'render-governor'
        : 'other';
      let handle;
      handle = nativeSet.call(
        this,
        function (...values) {
          pending.delete(handle);
          record('timer-start', { id });
          try {
            return callback.apply(this, values);
          } finally {
            record('timer-end', { id });
          }
        },
        delay,
        ...args,
      );
      pending.set(handle, id);
      record('timer-scheduled', {
        id,
        owner,
        scheduledAt,
        dueAt: scheduledAt + effectiveDelay,
      });
      return handle;
    });
    replace(timers, 'clearTimeout', function (handle) {
      const id = pending.get(handle);
      if (id !== undefined) {
        record('timer-cancelled', { id });
        pending.delete(handle);
      }
      return nativeClear.call(this, handle);
    });
    for (const method of ['initializeFrame', 'render', 'requestRender']) {
      const original = scene[method];
      if (typeof original !== 'function') continue;
      replace(scene, method, function (...args) {
        record(`${method}-start`);
        try {
          return original.apply(this, args);
        } finally {
          record(`${method}-end`);
        }
      });
    }
    for (const phase of [
      'preUpdate',
      'postUpdate',
      'preRender',
      'postRender',
    ]) {
      const event = scene[phase];
      if (!event?.addEventListener) continue;
      const callback = () => record(phase);
      const remove = event.addEventListener(callback);
      cleanup.push(
        typeof remove === 'function'
          ? remove
          : () => event.removeEventListener(callback),
      );
    }
  } catch (error) {
    stop();
    throw error;
  }
  record('start');
  return { report, stop };
}
