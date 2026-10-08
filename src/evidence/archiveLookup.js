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
      void run(task)
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  async function run(entry) {
    const { key, controller } = entry;
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
    try {
      controller.signal.throwIfAborted();
      const response = await Promise.race([
        fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: entry.url,
            ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
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
      entry.resolve(value);
    } catch (error) {
      entry.reject(error);
    } finally {
      clearTimeout(timeout);
      entry.settled = true;
      pending.delete(key);
    }
  }

  function attach(entry, signal) {
    if (!signal) return entry.promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    const consumer = {};
    entry.consumers.add(consumer);
    let onAbort;
    const cancellation = new Promise((_, reject) => {
      onAbort = () => {
        entry.consumers.delete(consumer);
        if (!entry.consumers.size && !entry.settled)
          entry.controller.abort(signal.reason);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([entry.promise, cancellation]).finally(() => {
      signal.removeEventListener('abort', onAbort);
      entry.consumers.delete(consumer);
    });
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
    if (pending.has(key)) return attach(pending.get(key), signal);

    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry = {
      key,
      url: safeUrl,
      timestamp: safeTimestamp,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      consumers: new Set(),
      settled: false,
    };
    pending.set(key, entry);
    queue.push(entry);
    pump();
    return attach(entry, signal);
  }

  return Object.freeze({
    lookup,
    clear() {
      cache.clear();
    },
  });
}
