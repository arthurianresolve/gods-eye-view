import { normalizeEarthquakeSnapshot } from './records.js';
const API_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const HISTORY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
export const EARTHQUAKE_HISTORY_WINDOW_MS = 24 * 60 * 60_000;
const HISTORY_CACHE_MS = 5 * 60_000;
const HISTORY_CACHE_LIMIT = 4;
const UTC_DAY_MS = 24 * 60 * 60_000;

function validTarget(value) {
  const target = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(target) && target <= Date.now() ? target : null;
}

function metadataSnapshot(payload, rows, receivedAt) {
  const generated = Number(payload?.metadata?.generated);
  return {
    rows,
    receivedAt,
    snapshotAt:
      Number.isFinite(generated) && generated > 0 && generated <= receivedAt
        ? generated
        : null,
  };
}

/** Request and validate a complete USGS snapshot before it can replace displayed events. */
export function createUsgsEarthquakeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const historyCache = new Map();
  async function getSnapshotWithMetadata({ signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(API_URL, { signal });
    if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);
    const payload = await response.json();
    signal?.throwIfAborted();
    const rows = normalizeEarthquakeSnapshot(payload);
    if (!rows) throw new Error('Malformed USGS response');
    return metadataSnapshot(payload, rows, Date.now());
  }

  async function getSnapshotAt(targetValue, { signal } = {}) {
    const targetMs = validTarget(targetValue);
    if (targetMs === null)
      throw new TypeError('USGS history target must be a finite past time');
    signal?.throwIfAborted();
    const dayStartMs = Math.floor(targetMs / UTC_DAY_MS) * UTC_DAY_MS;
    let base = historyCache.get(dayStartMs);
    if (!base || Date.now() - base.receivedAt >= HISTORY_CACHE_MS) {
      const queryStartMs = dayStartMs - UTC_DAY_MS;
      const queryEndMs = Math.min(dayStartMs + UTC_DAY_MS, Date.now());
      const url = new URL(HISTORY_URL);
      url.searchParams.set('format', 'geojson');
      url.searchParams.set('starttime', new Date(queryStartMs).toISOString());
      url.searchParams.set('endtime', new Date(queryEndMs).toISOString());
      url.searchParams.set('minmagnitude', '2.5');
      url.searchParams.set('orderby', 'time');
      url.searchParams.set('limit', '20000');
      const response = await fetchImpl(url.href, { signal });
      if (!response.ok) throw new Error(`USGS history HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeEarthquakeSnapshot(payload);
      if (!rows) throw new Error('Malformed USGS history response');
      const receivedAt = Date.now();
      base = {
        ...metadataSnapshot(payload, rows, receivedAt),
        receivedAt,
        truncated: Number(payload?.metadata?.count) > rows.length,
      };
      historyCache.delete(dayStartMs);
      historyCache.set(dayStartMs, base);
      while (historyCache.size > HISTORY_CACHE_LIMIT)
        historyCache.delete(historyCache.keys().next().value);
    } else {
      historyCache.delete(dayStartMs);
      historyCache.set(dayStartMs, base);
    }
    signal?.throwIfAborted();
    const effectiveTarget = Math.floor(targetMs / 60_000) * 60_000;
    const effectiveFrom = effectiveTarget - EARTHQUAKE_HISTORY_WINDOW_MS;
    const rows = base.rows.filter(
      (row) =>
        Number.isFinite(row.time) &&
        row.time >= effectiveFrom &&
        row.time <= effectiveTarget,
    );
    return {
      rows,
      receivedAt: base.receivedAt,
      snapshotAt: base.snapshotAt,
      targetTime: new Date(targetMs).toISOString(),
      effectiveTime: new Date(effectiveTarget).toISOString(),
      window: { from: effectiveFrom, to: effectiveTarget },
      truncated: base.truncated,
    };
  }
  return {
    async getSnapshot({ signal } = {}) {
      return (await getSnapshotWithMetadata({ signal })).rows;
    },
    getSnapshotWithMetadata,
    getSnapshotAt,
  };
}
