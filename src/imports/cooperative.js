import { createMacrotaskScheduler } from './macrotask.js';

const defaultScheduler = createMacrotaskScheduler();

/** Consume main-thread work in bounded batches, keeping one cancellable wake. */
export function consumeInBatches(iterator, options = {}) {
  const {
    signal,
    now = () => performance.now(),
    budgetMs = 4,
    deferStart = false,
    onBatch,
  } = options;
  if (onBatch !== undefined && typeof onBatch !== 'function')
    throw new TypeError('onBatch must be a function when provided.');
  const schedule = options.schedule ?? defaultScheduler.schedule;
  const cancel =
    options.cancel ??
    (options.schedule
      ? (timer) => clearTimeout(timer)
      : defaultScheduler.cancel);
  return new Promise((resolve, reject) => {
    let timer = null;
    let wakeScheduledAt = null;
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      if (timer !== null) cancel(timer);
      timer = null;
      signal?.removeEventListener('abort', abort);
      if (error) {
        try {
          iterator.return?.();
        } catch {}
        reject(error);
      } else resolve(value);
    };
    const abort = () =>
      finish(new DOMException('Import rendering cancelled.', 'AbortError'));
    const step = () => {
      const currentTimer = timer;
      timer = null;
      if (finished) return;
      try {
        const started = now();
        const enqueueToWakeMs =
          onBatch && wakeScheduledAt !== null
            ? Math.max(0, started - wakeScheduledAt)
            : null;
        wakeScheduledAt = null;
        const schedulerBackend = onBatch
          ? currentTimer?.backend ||
            (options.schedule ? 'injected' : 'synchronous-start')
          : null;
        do {
          if (signal?.aborted) return abort();
          const next = iterator.next();
          if (finished) return;
          if (next.done) {
            if (onBatch)
              onBatch({
                activeMs: Math.max(0, now() - started),
                enqueueToWakeMs,
                schedulerBackend,
                budgetMs,
                yielded: false,
              });
            return finish(null, next.value);
          }
        } while (now() - started < budgetMs);
        if (onBatch) {
          onBatch({
            activeMs: Math.max(0, now() - started),
            enqueueToWakeMs,
            schedulerBackend,
            budgetMs,
            yielded: true,
          });
          wakeScheduledAt = now();
        }
        // An observer may synchronously cancel the import. Its abort handler
        // already released ownership, so do not create a replacement wake.
        if (finished) return;
        timer = schedule(step, (error) => finish(error));
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else if (deferStart) {
      try {
        if (onBatch) wakeScheduledAt = now();
        timer = schedule(step, (error) => finish(error));
      } catch (error) {
        finish(error);
      }
    } else step();
  });
}
