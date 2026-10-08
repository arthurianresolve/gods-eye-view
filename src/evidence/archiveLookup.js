import { safeReferenceUrl } from './evidence.js';

export const ARCHIVE_LOOKUP_CACHE_MS = 10 * 60_000;
export const ARCHIVE_LOOKUP_MAX_CONCURRENCY = 2;
export const ARCHIVE_LOOKUP_TIMEOUT_MS = 10_000;
export const ARCHIVE_LOOKUP_CACHE_LIMIT = 128;
export const ARCHIVE_LOOKUP_QUEUE_LIMIT = 64;

/** Availability accepts a partial UTC date, never an epoch masquerading as a date. */
export function archiveTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}(?:\d{2}){0,5}$/.test(value))
    throw new TypeError(
      'Use a UTC archive date in YYYY[MM[DD[hh[mm[ss]]]]] format.',
    );
  const full = value + '0101000000'.slice(value.length - 4);
  const iso = full.replace(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    '$1-$2-$3T$4:$5:$6Z',
  );
  const date = new Date(iso);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().replace(/\D/g, '').slice(0, 14) !== full
  )
    throw new TypeError('Invalid UTC archive date.');
  return value;
}

/**
 * Bounded coalescing lookup pool, shared by browser and server. Every subscriber
 * owns its cancellation; the upstream is cancelled only when none remain.
 * The deadline covers reading the response body as well as fetching headers.
 */
export function createArchiveLookup({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  endpoint = '/api/evidence/archive-lookup',
  timeoutMs = ARCHIVE_LOOKUP_TIMEOUT_MS,
  cacheLimit = ARCHIVE_LOOKUP_CACHE_LIMIT,
  requestImpl = async ({ url, timestamp, signal }) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...(timestamp ? { timestamp } : {}) }),
      signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(value?.message || 'Archive lookup failed.'),
        {
          code: value?.error || 'archive-lookup-failed',
          state: value?.state || 'failed',
        },
      );
    if (!['available', 'unavailable'].includes(value?.state))
      throw Object.assign(new Error('Malformed archive response.'), {
        code: 'malformed-response',
        state: 'malformed',
      });
    return value;
  },
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  const limit = Number.isInteger(cacheLimit)
    ? Math.max(1, Math.min(ARCHIVE_LOOKUP_CACHE_LIMIT, cacheLimit))
    : ARCHIVE_LOOKUP_CACHE_LIMIT;

  function pump() {
    while (active < ARCHIVE_LOOKUP_MAX_CONCURRENCY && queue.length) {
      const entry = queue.shift();
      if (entry.controller.signal.aborted) continue;
      active++;
      void run(entry).finally(() => {
        active--;
        pump();
      });
    }
  }

  async function run(entry) {
    const { key, controller } = entry;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      controller.signal.throwIfAborted();
      const value = await Promise.race([
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return requestImpl({
            url: entry.url,
            timestamp: entry.timestamp,
            signal: controller.signal,
          });
        }),
        cancelled,
      ]);
      controller.signal.throwIfAborted();
      if (['available', 'unavailable'].includes(value.state)) {
        while (cache.size >= limit) cache.delete(cache.keys().next().value);
        cache.set(key, {
          value: structuredClone(value),
          expiresAt: now() + ARCHIVE_LOOKUP_CACHE_MS,
        });
      }
      entry.resolve(value);
    } catch (error) {
      entry.reject(error);
    } finally {
      clearTimeout(entry.timer);
      controller.signal.removeEventListener('abort', abort);
      entry.settled = true;
      if (pending.get(key) === entry) pending.delete(key);
    }
  }

  function attach(entry, signal) {
    const consumer = {};
    entry.consumers.add(consumer);
    let onAbort;
    const cancellation = new Promise((_, reject) => {
      onAbort = () => {
        entry.consumers.delete(consumer);
        if (!entry.consumers.size && !entry.settled) {
          clearTimeout(entry.timer);
          entry.controller.abort(signal.reason);
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          entry.reject(signal.reason);
          if (pending.get(entry.key) === entry) pending.delete(entry.key);
        }
        reject(signal.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([entry.promise, cancellation])
      .then((value) => structuredClone(value))
      .finally(() => {
        signal?.removeEventListener('abort', onAbort);
        entry.consumers.delete(consumer);
      });
  }

  function lookup({ url, timestamp, signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const safeUrl = safeReferenceUrl(url);
    if (!safeUrl)
      return Promise.reject(new TypeError('A public HTTPS URL is required.'));
    let safeTimestamp;
    try {
      safeTimestamp = archiveTimestamp(timestamp);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = JSON.stringify([safeUrl, safeTimestamp]);
    for (const [cacheKey, item] of cache)
      if (item.expiresAt <= now()) cache.delete(cacheKey);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(structuredClone(cached.value));
    if (pending.has(key)) return attach(pending.get(key), signal);
    if (pending.size >= ARCHIVE_LOOKUP_QUEUE_LIMIT)
      return Promise.reject(
        Object.assign(
          new Error('Archive lookup queue is full. Try again later.'),
          { code: 'rate-limited', state: 'rate-limited' },
        ),
      );
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
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
    entry.timer = setTimeout(
      () => {
        const error = new DOMException(
          'Archive lookup timed out.',
          'TimeoutError',
        );
        entry.controller.abort(error);
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        entry.reject(error);
        if (pending.get(key) === entry) pending.delete(key);
      },
      Math.max(
        1,
        Math.min(
          ARCHIVE_LOOKUP_TIMEOUT_MS,
          Number(timeoutMs) || ARCHIVE_LOOKUP_TIMEOUT_MS,
        ),
      ),
    );
    pending.set(key, entry);
    queue.push(entry);
    const result = attach(entry, signal);
    pump();
    return result;
  }

  return Object.freeze({
    lookup,
    clear() {
      cache.clear();
    },
  });
}
