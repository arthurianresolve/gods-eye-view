import { createHash } from 'node:crypto';

export const DENSE_FLIGHT_FIXTURE_ID = 'opensky-dense-investigation-v1';
export const DENSE_FLIGHT_FIXTURE_COUNT = 2500;
export const DEFAULT_FLIGHT_FIXTURE_TIME = '2026-10-08T12:00:00.000Z';
const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;

/** Build a bounded fixed-time OpenSky states payload used by the real source. */
export function createProductionFlightFixture({
  count = DENSE_FLIGHT_FIXTURE_COUNT,
  fixedTime = DEFAULT_FLIGHT_FIXTURE_TIME,
} = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 20_000)
    throw new TypeError('Flight fixture count is invalid.');
  const fixedTimeMs = Date.parse(fixedTime);
  if (!Number.isFinite(fixedTimeMs) || new Date(fixedTimeMs).toISOString() !== fixedTime)
    throw new TypeError('Flight fixture time must be canonical ISO-8601 UTC.');
  const epochSeconds = Math.floor(fixedTimeMs / 1000);
  const states = Array.from({ length: count }, (_, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt((index + 0.5) / count);
    return [
      (index + 1).toString(16).padStart(6, '0'),
      `FX${String(index + 1).padStart(5, '0')}`,
      'QA fixture',
      epochSeconds,
      epochSeconds,
      -97.7431 + Math.cos(angle) * radius * 0.18,
      30.2672 + Math.sin(angle) * radius * 0.14,
      1_500 + (index % 16) * 850,
      false,
      70 + (index % 90),
      index % 360,
      0,
      null,
      1_500 + (index % 16) * 850,
      null,
      false,
      0,
      0,
    ];
  });
  const body = JSON.stringify({ time: epochSeconds, states });
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_FIXTURE_BYTES)
    throw new RangeError('Flight fixture exceeds its bounded payload size.');
  return {
    id: DENSE_FLIGHT_FIXTURE_ID,
    count,
    fixedTime: new Date(fixedTimeMs).toISOString(),
    fixedTimeMs,
    body,
    byteLength: bytes,
    sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  };
}

/** Fulfill only the production flight-source endpoint on the app origin. */
export function respondToProductionFlightFixture(
  url,
  request,
  fixture,
  baseUrl,
) {
  const base = new URL(baseUrl);
  if (
    url.origin !== base.origin ||
    url.pathname !== '/api/flights' ||
    url.username ||
    url.password ||
    (typeof request?.method === 'function' ? request.method() : request?.method) !== 'GET'
  )
    return undefined;
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    headers: {
      'cache-control': 'no-store',
      'x-flight-source': 'fixture-opensky-v1',
      'x-flight-coverage': 'fixed deterministic Austin test grid',
    },
    body: fixture.body,
  };
}

/** Count only successful CDP fulfill acknowledgements for the exact flight route. */
export function createFlightFixtureDeliveryObserver(fixture, baseUrl) {
  const base = new URL(baseUrl);
  const expectedBodyBase64 = Buffer.from(fixture.body, 'utf8').toString('base64');
  let fulfilledResponseCount = 0;
  let bodyMismatchCount = 0;
  return {
    onFulfilled({ url, method, status, bodyBase64 } = {}) {
      let requestUrl;
      try {
        requestUrl = new URL(url);
      } catch {
        return;
      }
      if (
        requestUrl.origin === base.origin &&
        requestUrl.pathname === '/api/flights' &&
        method === 'GET' &&
        status === 200
      ) {
        if (bodyBase64 !== expectedBodyBase64) bodyMismatchCount += 1;
        else fulfilledResponseCount += 1;
      }
    },
    summarize(actualEnabledPopulation) {
      if (bodyMismatchCount > 0)
        throw new Error('Acknowledged flight fixture body differs from expected bytes.');
      if (fulfilledResponseCount < 1)
        throw new Error('No flight fixture fulfillment was acknowledged.');
      if (actualEnabledPopulation !== fixture.count)
        throw new Error('Observed flights layer population differs from fixture.');
      return {
        schema: 'gev-fixture-delivery-observation/v1',
        status: 'observed',
        scope:
          'static-count integration smoke only; not a paired timing fixture or performance acceptance',
        method: 'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
        fixtureSha256: fixture.sha256,
        fixedTime: fixture.fixedTime,
        fulfilledResponseCount,
        observedFlightsCount: actualEnabledPopulation,
      };
    },
  };
}

/** Install a wall-clock-only override; animation and monotonic clocks are untouched. */
export function installFixedWallClock(fixedTimeMs, target = globalThis) {
  if (!Number.isFinite(fixedTimeMs))
    throw new TypeError('Fixed wall clock must be a finite timestamp.');
  const NativeDate = target.Date;
  const nativePerformanceNow = target.performance?.now?.bind(target.performance);
  if (typeof nativePerformanceNow !== 'function')
    throw new Error('Native performance clock is required for fixed wall time.');
  const performanceStart = nativePerformanceNow();
  const now = () => fixedTimeMs + (nativePerformanceNow() - performanceStart);
  const FixedDate = new Proxy(NativeDate, {
    apply(dateConstructor) {
      return new dateConstructor(now()).toString();
    },
    construct(dateConstructor, args, newTarget) {
      return Reflect.construct(
        dateConstructor,
        args.length ? args : [now()],
        newTarget,
      );
    },
    get(dateConstructor, property) {
      if (property === 'now') return () => Math.floor(now());
      return Reflect.get(dateConstructor, property, dateConstructor);
    },
  });
  Object.defineProperty(target, 'Date', {
    configurable: true,
    writable: true,
    value: FixedDate,
  });
  return now();
}
