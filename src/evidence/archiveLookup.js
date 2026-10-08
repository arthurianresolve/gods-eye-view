import { safeReferenceUrl } from './evidence.js';

export const ARCHIVE_LOOKUP_CACHE_MS = 10 * 60_000;
export const ARCHIVE_LOOKUP_MAX_CONCURRENCY = 2;
export const ARCHIVE_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Client for the same-origin archive lookup endpoint. Requests are coalesced
 * by URL and timestamp and cached briefly so opening an inspector twice does
 * not multiply provider traffic.
 */
export function createArchiveLookup({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  endpoint = '/api/evidence/archive-lookup',
  timeoutMs = ARCHIVE_LOOKUP_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;

  function keyFor(url, timestamp) {
    return `${url}\u0000${timestamp || ''}`;
  }

  function pump() {
    while (active < ARCHIVE_LOOKUP_MAX_CONCURRENCY && queue.length) {
      const task = queue.shift();
      active++;
      void task()
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function lookup({ url, timestamp, signal } = {}) {
    const safeUrl = safeReferenceUrl(url);
    if (!safeUrl)
      return Promise.reject(new TypeError('A public HTTPS URL is required.'));
    const safeTimestamp =
      timestamp == null ? null : String(timestamp).slice(0, 14);
    const key = keyFor(safeUrl, safeTimestamp);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now())
      return Promise.resolve(cached.value);
    if (pending.has(key)) return pending.get(key);

    const promise = new Promise((resolve, reject) => {
      queue.push(async () => {
        const controller = new AbortController();
        const timeoutError = new DOMException(
          'Archive lookup timed out.',
          'TimeoutError',
        );
        let timeoutReject;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutReject = reject;
        });
        const timeout = setTimeout(
          () => {
            controller.abort(timeoutError);
            timeoutReject(timeoutError);
          },
          Math.max(1, Number(timeoutMs) || ARCHIVE_LOOKUP_TIMEOUT_MS),
        );
        const cancel = () => {
          const reason =
            signal?.reason ||
            new DOMException('Archive lookup cancelled.', 'AbortError');
          controller.abort(reason);
          timeoutReject(reason);
        };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          signal?.throwIfAborted();
          const response = await Promise.race([
            fetchImpl(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: safeUrl,
                ...(safeTimestamp ? { timestamp: safeTimestamp } : {}),
              }),
              signal: controller.signal,
            }),
            timeoutPromise,
          ]);
          const value = await response.json();
          if (!response.ok) {
            const error = new Error(value?.message || 'Archive lookup failed.');
            error.code = value?.error || 'archive-lookup-failed';
            throw error;
          }
          cache.set(key, { value, expiresAt: now() + ARCHIVE_LOOKUP_CACHE_MS });
          resolve(value);
        } catch (error) {
          reject(error);
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', cancel);
          pending.delete(key);
        }
      });
      pump();
    });
    pending.set(key, promise);
    return promise;
  }

  return Object.freeze({
    lookup,
    clear() {
      cache.clear();
    },
  });
}
