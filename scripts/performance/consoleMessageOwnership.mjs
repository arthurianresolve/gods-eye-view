const MAX_DIAGNOSTIC_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_PENDING_DISPOSALS = 4096;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;

function increment(value, amount = 1) {
  return Math.min(MAX_DIAGNOSTIC_COUNT, value + amount);
}

/**
 * Owns console argument handles only while this callback is the sole page
 * console consumer and no Puppeteer worker console consumer can share them.
 * Call from the page's console callback after recording message.text().
 */
export function createExclusiveConsoleMessageHandleOwner(page) {
  let disposed = 0;
  let skipped = 0;
  let errors = 0;
  const pending = new Set();

  function canDisposeExclusively() {
    try {
      if (page.listenerCount('console') !== 1) return false;
      if (typeof page.workers !== 'function') return false;
      return page.workers().every((worker) => {
        return (
          typeof worker.listenerCount === 'function' &&
          worker.listenerCount('console') === 0
        );
      });
    } catch {
      return false;
    }
  }

  function snapshot() {
    return {
      disposed,
      skipped,
      pending: pending.size,
      errors,
    };
  }

  function disposeMessageArgsIfExclusive(message) {
    const args = message.args();
    if (!args.length) return;
    if (!canDisposeExclusively()) {
      skipped = increment(skipped, args.length);
      return;
    }

    for (const [index, handle] of args.entries()) {
      if (pending.size >= MAX_PENDING_DISPOSALS) {
        skipped = increment(skipped, args.length - index);
        break;
      }
      let result;
      try {
        result = handle.dispose();
      } catch {
        errors = increment(errors);
        continue;
      }
      let task;
      task = Promise.resolve(result)
        .then(() => {
          disposed = increment(disposed);
        })
        .catch(() => {
          errors = increment(errors);
        })
        .finally(() => pending.delete(task));
      pending.add(task);
    }
  }

  async function drain({ timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      throw new RangeError(
        'Console handle drain timeout must be non-negative.',
      );
    if (pending.size) {
      let timeout;
      try {
        await Promise.race([
          (async () => {
            while (pending.size) await Promise.all([...pending]);
          })(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              const error = new Error(
                `Console handle drain exceeded ${timeoutMs}ms.`,
              );
              error.name = 'ConsoleHandleDrainTimeoutError';
              reject(error);
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
    return snapshot();
  }

  return { disposeMessageArgsIfExclusive, snapshot, drain };
}

/** Remove the listener before draining, so cleanup cannot accept new handles. */
export async function cleanupExclusiveConsoleMessageHandleOwner(
  page,
  listener,
  owner,
) {
  page.off('console', listener);
  return owner.drain();
}

export function readConsoleMessageHandleOwnership(owner) {
  return owner?.snapshot() ?? null;
}
