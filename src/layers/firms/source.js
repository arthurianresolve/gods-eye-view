import { acquisitionMsUtc } from '../../data/firmsCsv.js';

export const FIRMS_HISTORY_MAX_AGE_MS = 120 * 24 * 60 * 60_000;

/** Construct the existing live-fire endpoint without making a request. */
export function createFirmsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function readResponse(response, signal, label) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      /* status below remains authoritative */
    }
    signal?.throwIfAborted();
    if (!response.ok) {
      if (response.status === 503 && payload?.error === 'no_key')
        return { keyRequired: true };
      throw new Error(
        label === 'live'
          ? `FIRMS HTTP ${response.status}`
          : `FIRMS history HTTP ${response.status}`,
      );
    }
    if (!Array.isArray(payload?.fires))
      throw new Error('Malformed fire snapshot');
    return payload;
  }

  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/firms', {
        signal,
        cache: 'no-store',
      });
      return readResponse(response, signal, 'live');
    },
    async getSnapshotAt(targetValue, { signal } = {}) {
      const targetMs =
        typeof targetValue === 'number' ? targetValue : Date.parse(targetValue);
      if (
        !Number.isFinite(targetMs) ||
        targetMs > Date.now() ||
        targetMs < Date.now() - FIRMS_HISTORY_MAX_AGE_MS
      )
        throw new TypeError(
          'FIRMS history target must be within the supported 120-day window',
        );
      signal?.throwIfAborted();
      const target = new Date(targetMs).toISOString();
      const response = await fetchImpl(
        `/api/firms/history?target=${encodeURIComponent(target)}`,
        { signal, cache: 'no-store' },
      );
      const payload = await readResponse(response, signal, 'history');
      if (payload.keyRequired) return payload;
      if (payload.historical !== true || payload.targetTime !== target)
        throw new Error('Malformed FIRMS history window');
      const fromMs = targetMs - 24 * 60 * 60_000;
      const fires = payload.fires.filter((fire) => {
        const observedAt = acquisitionMsUtc(fire?.acqDate, fire?.acqTime);
        return (
          Number.isFinite(observedAt) &&
          observedAt >= fromMs &&
          observedAt <= targetMs
        );
      });
      return {
        ...payload,
        fires,
        count: fires.length,
        window: { from: fromMs, to: targetMs },
      };
    },
  };
}
