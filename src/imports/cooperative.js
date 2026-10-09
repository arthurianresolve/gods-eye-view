/** Consume main-thread work in bounded batches, keeping one cancellable wake. */
export function consumeInBatches(
  iterator,
  {
    signal,
    now = () => performance.now(),
    schedule = (callback) => setTimeout(callback, 0),
    cancel = (timer) => clearTimeout(timer),
    budgetMs = 4,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let timer = null;
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
      timer = null;
      if (finished) return;
      try {
        const started = now();
        do {
          if (signal?.aborted) return abort();
          const next = iterator.next();
          if (finished) return;
          if (next.done) return finish(null, next.value);
        } while (now() - started < budgetMs);
        timer = schedule(step);
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else step();
  });
}
