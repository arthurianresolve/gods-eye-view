import { createHash } from 'node:crypto';

export const DENSE_FLIGHT_FIXTURE_ID = 'opensky-dense-investigation-v1';
export const DENSE_FLIGHT_FIXTURE_COUNT = 2500;
export const DEFAULT_FLIGHT_FIXTURE_TIME = '2026-10-08T12:00:00.000Z';
const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;

const RENDER_DEMAND_BOOTSTRAP_API_ROUTES = new Set(['GET /api/setup/status']);
const RENDER_DEMAND_MAP_PROVIDER_HOSTS = new Map([
  [
    'services.arcgisonline.com',
    /^\/ArcGIS\/rest\/services\/World_Imagery\/MapServer(?:\/|$)/i,
  ],
  ['terrain.reearth.land', /^\/cesium-mesh\/ellipsoid(?:\/|$)/i],
  ['tile.openstreetmap.org', /^\/(?:\d+\/\d+\/\d+\.png)?$/],
]);
const RENDER_DEMAND_STAGES = new Set([
  'fixture-setup',
  'application-start',
  'fixture-delivery',
  'scene-settle',
  'start-snapshot',
  'foreground-observation',
  'visibility-control',
  'end-snapshot',
  'application-destroy',
  'fixture-cleanup',
]);

function boundedRenderDemandCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function scrubRenderDemandText(value, limit = 200) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[path]')
    .replace(
      /\b(?:token|password|secret|authorization)\b[^\n]{0,120}/gi,
      '[redacted]',
    )
    .slice(0, limit);
}

function projectRenderDemandValue(value, depth = 0) {
  if (depth > 5) return '[depth-limited]';
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return scrubRenderDemandText(value, 160);
  if (Array.isArray(value))
    return value
      .slice(0, 8)
      .map((entry) => projectRenderDemandValue(entry, depth + 1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:body|url|path|token|secret|password|authorization)/i.test(key),
      )
      .slice(0, 24)
      .map(([key, entry]) => [
        /^[a-z][a-zA-Z0-9]{0,39}$/.test(key) ? key : 'other',
        projectRenderDemandValue(entry, depth + 1),
      ]),
  );
}

/** Classify only deterministic bootstrap/map traffic; callers still block it. */
export function classifyRenderDemandRequest({ url, origin, method } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid-request';
  }
  const normalizedMethod = String(method || '').toUpperCase();
  if (parsed.origin === origin) {
    const route = `${normalizedMethod} ${parsed.pathname}`;
    if (
      RENDER_DEMAND_BOOTSTRAP_API_ROUTES.has(route) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
      return 'expected-bootstrap-api';
    if (parsed.pathname.startsWith('/api/')) return 'unexpected-api';
    return 'same-origin-non-api';
  }
  const providerPath = RENDER_DEMAND_MAP_PROVIDER_HOSTS.get(
    parsed.hostname.toLowerCase(),
  );
  const hasCredentialQuery = [...parsed.searchParams.keys()].some((key) =>
    /(?:token|key|auth|secret|password)/i.test(key),
  );
  return providerPath?.test(parsed.pathname) &&
    !parsed.username &&
    !parsed.password &&
    !hasCredentialQuery
    ? 'expected-blocked-map-provider'
    : 'unexpected-external';
}

/** Bounded, URL/body-free failure envelope for the full-app diagnostic. */
export function createRenderDemandFailureReport({
  stage,
  error,
  observations = [],
  delivery = null,
  traffic = null,
  fixture = null,
} = {}) {
  const safeMessage = scrubRenderDemandText(
    error?.message || 'Diagnostic failed',
  );
  return {
    schema: 'gev-application-render-demand-diagnostic/v1',
    status: 'failed',
    failedStage: RENDER_DEMAND_STAGES.has(stage) ? stage : 'fixture-setup',
    scope:
      'full application with enabled-empty civil and military source layers; diagnostic only',
    fixture:
      fixture && typeof fixture === 'object'
        ? {
            fixedTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
              fixture.fixedTime || '',
            )
              ? fixture.fixedTime
              : null,
            flightsId: /^[a-z0-9-]{1,64}$/.test(fixture.flightsId || '')
              ? fixture.flightsId
              : null,
            flightsSha256: /^[a-f0-9]{64}$/.test(fixture.flightsSha256 || '')
              ? fixture.flightsSha256
              : null,
            flightsBytes: boundedRenderDemandCount(fixture.flightsBytes),
            militaryId: /^[a-z0-9-]{1,64}$/.test(fixture.militaryId || '')
              ? fixture.militaryId
              : null,
            militarySha256: /^[a-f0-9]{64}$/.test(fixture.militarySha256 || '')
              ? fixture.militarySha256
              : null,
            militaryBytes: boundedRenderDemandCount(fixture.militaryBytes),
          }
        : null,
    failure: {
      name: /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error?.name || '')
        ? error.name
        : 'Error',
      message: safeMessage,
    },
    observations: Array.isArray(observations)
      ? observations.slice(-12).map((entry) => {
          let state = null;
          try {
            const projected = projectRenderDemandValue(entry?.state ?? null);
            const encoded = JSON.stringify(projected);
            state =
              encoded.length <= 1800
                ? projected
                : { omitted: true, encodedChars: encoded.length };
          } catch {
            state = { unavailable: true };
          }
          return {
            stage: RENDER_DEMAND_STAGES.has(entry?.stage)
              ? entry.stage
              : 'fixture-setup',
            state,
          };
        })
      : [],
    delivery:
      delivery && typeof delivery === 'object'
        ? {
            routeAttempts: {
              flights: boundedRenderDemandCount(
                delivery.routeAttempts?.flights,
              ),
              military: boundedRenderDemandCount(
                delivery.routeAttempts?.military,
              ),
            },
            acknowledged: {
              flights: boundedRenderDemandCount(delivery.acknowledged?.flights),
              military: boundedRenderDemandCount(
                delivery.acknowledged?.military,
              ),
            },
            invalidFixtureRouteCount: boundedRenderDemandCount(
              delivery.invalidFixtureRouteCount,
            ),
          }
        : null,
    traffic:
      traffic && typeof traffic === 'object'
        ? {
            expectedBootstrapApiCount: boundedRenderDemandCount(
              traffic.expectedBootstrapApiCount,
            ),
            expectedBlockedMapProviderCount: boundedRenderDemandCount(
              traffic.expectedBlockedMapProviderCount,
            ),
            unexpectedApiCount: boundedRenderDemandCount(
              traffic.unexpectedApiCount,
            ),
            unexpectedExternalCount: boundedRenderDemandCount(
              traffic.unexpectedExternalCount,
            ),
            sameOriginNonApiCount: boundedRenderDemandCount(
              traffic.sameOriginNonApiCount,
            ),
            otherApiPaths: Array.isArray(traffic.otherApiPaths)
              ? traffic.otherApiPaths
                  .slice(0, 8)
                  .map((path) =>
                    /^\/api\/[a-z0-9/_-]{1,96}$/i.test(path)
                      ? path
                      : '[other-api-path]',
                  )
              : [],
            otherApiPathOverflow: traffic.otherApiPathOverflow === true,
          }
        : null,
  };
}

/** Build a bounded fixed-time OpenSky states payload used by the real source. */
export function createProductionFlightFixture({
  count = DENSE_FLIGHT_FIXTURE_COUNT,
  fixedTime = DEFAULT_FLIGHT_FIXTURE_TIME,
} = {}) {
  if (!Number.isInteger(count) || count < 0 || count > 20_000)
    throw new TypeError('Flight fixture count is invalid.');
  const fixedTimeMs = Date.parse(fixedTime);
  if (
    !Number.isFinite(fixedTimeMs) ||
    new Date(fixedTimeMs).toISOString() !== fixedTime
  )
    throw new TypeError('Flight fixture time must be canonical ISO-8601 UTC.');
  if (fixedTimeMs % 1000 !== 0)
    throw new TypeError(
      'Flight fixture time must be aligned to a whole second.',
    );
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

/** Build the fixed-epoch empty readsb payload used by app render-demand QA. */
export function createProductionMilitaryFixture({
  fixedTime = DEFAULT_FLIGHT_FIXTURE_TIME,
} = {}) {
  const fixedTimeMs = Date.parse(fixedTime);
  if (
    !Number.isFinite(fixedTimeMs) ||
    new Date(fixedTimeMs).toISOString() !== fixedTime
  )
    throw new TypeError(
      'Military fixture time must be canonical ISO-8601 UTC.',
    );
  if (fixedTimeMs % 1000 !== 0)
    throw new TypeError(
      'Military fixture time must be aligned to a whole second.',
    );
  const payload = { now: Math.floor(fixedTimeMs / 1000), ac: [] };
  const body = JSON.stringify(payload);
  return {
    id: 'readsb-empty-render-demand-v1',
    fixedTime: new Date(fixedTimeMs).toISOString(),
    fixedTimeMs,
    body,
    byteLength: Buffer.byteLength(body, 'utf8'),
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
    (typeof request?.method === 'function'
      ? request.method()
      : request?.method) !== 'GET'
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

/** Fulfill only the production military-source endpoint on the app origin. */
export function respondToProductionMilitaryFixture(
  url,
  request,
  fixture,
  baseUrl,
) {
  const base = new URL(baseUrl);
  if (
    url.origin !== base.origin ||
    url.pathname !== '/api/military' ||
    url.search ||
    url.username ||
    url.password ||
    (typeof request?.method === 'function'
      ? request.method()
      : request?.method) !== 'GET'
  )
    return undefined;
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    headers: {
      'cache-control': 'no-store',
      'x-feed-source': 'fixture-readsb-v1',
    },
    body: fixture.body,
  };
}

/** Count only successful CDP fulfill acknowledgements for the exact flight route. */
export function createFlightFixtureDeliveryObserver(fixture, baseUrl) {
  const base = new URL(baseUrl);
  const expectedBodyBase64 = Buffer.from(fixture.body, 'utf8').toString(
    'base64',
  );
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
        throw new Error(
          'Acknowledged flight fixture body differs from expected bytes.',
        );
      if (fulfilledResponseCount < 1)
        throw new Error('No flight fixture fulfillment was acknowledged.');
      if (actualEnabledPopulation !== fixture.count)
        throw new Error(
          'Observed flights layer population differs from fixture.',
        );
      return {
        schema: 'gev-fixture-delivery-observation/v1',
        status: 'observed',
        scope:
          'static-count integration smoke only; not a paired timing fixture or performance acceptance',
        method:
          'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
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
  const nativePerformanceNow = target.performance?.now?.bind(
    target.performance,
  );
  if (typeof nativePerformanceNow !== 'function')
    throw new Error(
      'Native performance clock is required for fixed wall time.',
    );
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

/** Install a wall clock that remains at one fixture epoch for the document lifetime. */
export function installFrozenWallClock(fixedTimeMs, target = globalThis) {
  if (!Number.isSafeInteger(fixedTimeMs) || fixedTimeMs < 1)
    throw new TypeError('Frozen wall clock epoch must be a positive integer.');
  const NativeDate = target.Date;
  const FixedDate = new Proxy(NativeDate, {
    apply(dateConstructor) {
      return new dateConstructor(fixedTimeMs).toString();
    },
    construct(dateConstructor, args, newTarget) {
      return Reflect.construct(
        dateConstructor,
        args.length ? args : [fixedTimeMs],
        newTarget,
      );
    },
    get(dateConstructor, property) {
      if (property === 'now') return () => fixedTimeMs;
      return Reflect.get(dateConstructor, property, dateConstructor);
    },
  });
  Object.defineProperty(target, 'Date', {
    configurable: true,
    writable: true,
    value: FixedDate,
  });
  return fixedTimeMs;
}

/** Select the wall-clock contract used by each fixture path. */
export function selectFixtureWallClockInstaller({
  infrastructure = false,
  phasedClock = false,
  holdClockUntilCapture = false,
} = {}) {
  if (infrastructure) return installFrozenWallClock;
  if (phasedClock) return installPhasedMonotonicWallClock;
  if (holdClockUntilCapture) return installHeldMonotonicWallClock;
  return installFixedWallClock;
}

/** Pass the selected serializable clock installer to a new browser document. */
export function installFixtureWallClockOnPage(
  page,
  fixedTimeMs,
  options = {},
  installerArgs = [],
) {
  if (typeof page?.evaluateOnNewDocument !== 'function')
    throw new TypeError('A page with evaluateOnNewDocument is required.');
  if (!Array.isArray(installerArgs))
    throw new TypeError('Fixture clock installer arguments must be an array.');
  return page.evaluateOnNewDocument(
    selectFixtureWallClockInstaller(options),
    fixedTimeMs,
    ...installerArgs,
  );
}

/** Install a capture-only wall clock held at one epoch until a one-shot start. */
export function installHeldMonotonicWallClock(
  fixedTimeMs,
  target = globalThis,
) {
  if (!Number.isSafeInteger(fixedTimeMs) || fixedTimeMs < 1)
    throw new TypeError('Held wall clock epoch must be a positive integer.');
  const NativeDate = target.Date;
  const nativePerformanceNow = target.performance?.now?.bind(
    target.performance,
  );
  if (typeof nativePerformanceNow !== 'function')
    throw new Error('Native performance clock is required for held wall time.');
  let startedAt = null;
  const now = () =>
    fixedTimeMs +
    (startedAt === null ? 0 : Math.max(0, nativePerformanceNow() - startedAt));
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
  const clock = Object.freeze({
    schema: 'gev-held-monotonic-wall-clock/v1',
    start() {
      if (startedAt !== null)
        throw new Error('Held capture clock can start only once.');
      startedAt = nativePerformanceNow();
      return this.snapshot();
    },
    snapshot() {
      const elapsedMs =
        startedAt === null
          ? null
          : Math.max(0, nativePerformanceNow() - startedAt);
      return {
        schema: 'gev-held-monotonic-wall-clock/v1',
        started: startedAt !== null,
        startCount: startedAt === null ? 0 : 1,
        epochMs: Math.floor(now()),
        elapsedMs,
      };
    },
  });
  Object.defineProperty(target, '__gevHeldMonotonicWallClockV1', {
    configurable: false,
    enumerable: false,
    value: clock,
  });
  return clock.snapshot();
}

/** Install a monotonic fixture wall clock with held warmup/measurement boundaries. */
export function installPhasedMonotonicWallClock(
  fixedTimeMs,
  warmupMs,
  measurementMs,
  target = globalThis,
) {
  if (!Number.isSafeInteger(fixedTimeMs) || fixedTimeMs < 1)
    throw new TypeError('Phased wall clock epoch must be a positive integer.');
  if (
    !Number.isSafeInteger(warmupMs) ||
    warmupMs < 0 ||
    !Number.isSafeInteger(measurementMs) ||
    measurementMs <= 0
  )
    throw new TypeError('Phased wall clock durations are invalid.');
  const nativeDate = target.Date;
  const nativeNow = target.performance?.now?.bind(target.performance);
  if (typeof nativeNow !== 'function')
    throw new Error(
      'Native performance clock is required for phased wall time.',
    );
  let phase = 'setup';
  let runOrdinal = 1;
  let phaseStartedAt = null;
  let elapsedWarmupMs = 0;
  let elapsedMeasurementMs = 0;
  let warmupNativeElapsedMs = null;
  let measurementNativeElapsedMs = null;
  const now = () => {
    let elapsed = 0;
    if (phase === 'warmup')
      elapsed = Math.min(
        warmupMs,
        elapsedWarmupMs + Math.max(0, nativeNow() - phaseStartedAt),
      );
    else if (phase === 'warmup-held' || phase === 'measurement')
      elapsed =
        warmupMs +
        (phase === 'measurement'
          ? Math.min(
              measurementMs,
              elapsedMeasurementMs + Math.max(0, nativeNow() - phaseStartedAt),
            )
          : 0);
    else if (phase === 'complete') elapsed = warmupMs + measurementMs;
    return fixedTimeMs + elapsed;
  };
  const FixedDate = new Proxy(nativeDate, {
    apply(ctor) {
      return new ctor(now()).toString();
    },
    construct(ctor, args, newTarget) {
      return Reflect.construct(ctor, args.length ? args : [now()], newTarget);
    },
    get(ctor, property) {
      if (property === 'now') return () => Math.floor(now());
      return Reflect.get(ctor, property, ctor);
    },
  });
  Object.defineProperty(target, 'Date', {
    configurable: true,
    writable: true,
    value: FixedDate,
  });
  const snapshot = () => ({
    schema: 'gev-phased-monotonic-wall-clock/v1',
    phase,
    epochMs: Math.floor(now()),
    elapsedMs: Math.floor(now() - fixedTimeMs),
    warmupMs,
    measurementMs,
    warmupNativeElapsedMs:
      phase === 'warmup'
        ? Math.max(0, nativeNow() - phaseStartedAt)
        : warmupNativeElapsedMs,
    measurementNativeElapsedMs:
      phase === 'measurement'
        ? Math.max(0, nativeNow() - phaseStartedAt)
        : measurementNativeElapsedMs,
    startCount: phase === 'setup' ? 0 : 1,
    measurementStartCount: ['measurement', 'complete'].includes(phase) ? 1 : 0,
    runOrdinal,
  });
  const assertExpectedRunOrdinal = (expectedRunOrdinal) => {
    if (
      expectedRunOrdinal !== undefined &&
      expectedRunOrdinal !== null &&
      expectedRunOrdinal !== runOrdinal
    )
      throw new Error(
        `Phased clock callback belongs to run ${expectedRunOrdinal}; current run is ${runOrdinal}.`,
      );
  };
  const clock = Object.freeze({
    schema: 'gev-phased-monotonic-wall-clock/v1',
    startWarmup(expectedRunOrdinal = null) {
      assertExpectedRunOrdinal(expectedRunOrdinal);
      if (phase !== 'setup')
        throw new Error('Warmup can start only once from setup.');
      phase = 'warmup';
      phaseStartedAt = nativeNow();
      return snapshot();
    },
    holdWarmupBoundary(expectedRunOrdinal = null) {
      assertExpectedRunOrdinal(expectedRunOrdinal);
      if (phase !== 'warmup')
        throw new Error('Warmup boundary requires active warmup.');
      const elapsed = Math.min(
        warmupMs,
        elapsedWarmupMs + Math.max(0, nativeNow() - phaseStartedAt),
      );
      if (elapsed < warmupMs)
        throw new Error('Warmup boundary reached too early.');
      elapsedWarmupMs = elapsed;
      warmupNativeElapsedMs = Math.max(0, nativeNow() - phaseStartedAt);
      phase = 'warmup-held';
      phaseStartedAt = null;
      return snapshot();
    },
    startMeasurement(expectedRunOrdinal = null) {
      assertExpectedRunOrdinal(expectedRunOrdinal);
      if (phase !== 'warmup-held')
        throw new Error('Measurement requires the held warmup boundary.');
      phase = 'measurement';
      phaseStartedAt = nativeNow();
      return snapshot();
    },
    finishMeasurement(expectedRunOrdinal = null) {
      assertExpectedRunOrdinal(expectedRunOrdinal);
      if (phase !== 'measurement')
        throw new Error('Measurement can finish only once while active.');
      const elapsed = Math.min(
        measurementMs,
        elapsedMeasurementMs + Math.max(0, nativeNow() - phaseStartedAt),
      );
      if (elapsed < measurementMs)
        throw new Error('Measurement boundary reached too early.');
      elapsedMeasurementMs = elapsed;
      measurementNativeElapsedMs = Math.max(0, nativeNow() - phaseStartedAt);
      phase = 'complete';
      phaseStartedAt = null;
      return snapshot();
    },
    resetForNextRun(expectedRunOrdinal = null) {
      assertExpectedRunOrdinal(expectedRunOrdinal);
      if (phase !== 'complete')
        throw new Error('A phased clock can reset only after a completed run.');
      phase = 'setup';
      phaseStartedAt = null;
      elapsedWarmupMs = 0;
      elapsedMeasurementMs = 0;
      warmupNativeElapsedMs = null;
      measurementNativeElapsedMs = null;
      runOrdinal += 1;
      return snapshot();
    },
    snapshot,
  });
  Object.defineProperty(target, '__gevPhasedMonotonicWallClockV1', {
    configurable: false,
    enumerable: false,
    value: clock,
  });
  return snapshot();
}

/** Hold the provider fixture clock at warmup completion inside the render probe. */
export function holdProviderWarmupBoundary(
  warmupMs,
  expectedRunOrdinal = null,
) {
  const clock = globalThis.window?.__gevPhasedMonotonicWallClockV1;
  const held = clock?.holdWarmupBoundary?.(expectedRunOrdinal);
  if (!held || held.phase !== 'warmup-held' || held.elapsedMs !== warmupMs)
    throw new Error(
      'Provider fixture warmup did not reach its declared boundary.',
    );
  const snapshot = clock.snapshot?.();
  if (
    !snapshot ||
    snapshot.phase !== 'warmup-held' ||
    snapshot.elapsedMs !== warmupMs
  )
    throw new Error('Provider fixture warmup boundary snapshot is invalid.');
  return snapshot;
}

/**
 * Provider samples on fresh documents each begin at run one; the Austin
 * operating workload deliberately reuses one measured document.
 */
export function expectedFixtureRunOrdinal({
  sharedDocument = false,
  completedSampleCount = 0,
} = {}) {
  if (!Number.isSafeInteger(completedSampleCount) || completedSampleCount < 0)
    throw new TypeError('Completed fixture sample count must be nonnegative.');
  return sharedDocument ? completedSampleCount + 1 : 1;
}

/** Wait for one completed Cesium render after a held clock boundary. */
export function settleCompletedRender(
  viewerOrTimeout,
  timeoutMs = 5000,
  signal = null,
) {
  const viewer =
    typeof viewerOrTimeout === 'number'
      ? globalThis.__godsEyeView?.viewer
      : viewerOrTimeout;
  if (typeof viewerOrTimeout === 'number') timeoutMs = viewerOrTimeout;
  if (
    !viewer?.scene?.postRender?.addEventListener ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    return Promise.reject(
      new TypeError(
        'A viewer postRender event and positive timeout are required.',
      ),
    );
  return new Promise((resolve, reject) => {
    let done = false;
    let removeListener = null;
    let listener = null;
    let timer = null;
    const startedAt = globalThis.performance?.now?.();
    const onAbort = () =>
      finish(
        signal.reason || new Error('Completed render settling was aborted.'),
      );
    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (typeof removeListener === 'function') removeListener();
        else if (listener)
          viewer.scene.postRender.removeEventListener?.(listener);
      } catch {}
      try {
        signal?.removeEventListener?.('abort', onAbort);
      } catch {}
    };
    const finish = (error) => {
      if (done) return;
      done = true;
      cleanup();
      if (error) reject(error);
      else
        resolve({
          settleElapsedMs:
            Number.isFinite(startedAt) &&
            Number.isFinite(globalThis.performance?.now?.())
              ? Math.max(0, globalThis.performance.now() - startedAt)
              : null,
        });
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    timer = setTimeout(
      () =>
        finish(
          new Error(
            'Completed render did not settle before the boundary timeout.',
          ),
        ),
      timeoutMs,
    );
    try {
      listener = () => finish();
      removeListener = viewer.scene.postRender.addEventListener(listener);
      viewer.scene.requestRender?.();
    } catch (error) {
      finish(error);
    }
  });
}

/** Validate a sampled public tracking target at both declared fixture epochs. */
export function assertObservedTrackingRoute(
  route,
  {
    fixtureId,
    fixtureSha256,
    fixedTime,
    warmupMs,
    measurementMs,
    fixtureCount = DENSE_FLIGHT_FIXTURE_COUNT,
    selectedIdentity = 'flights:000001',
    freshnessWindowMs = 120_000,
  } = {},
) {
  const fail = (message) => {
    throw new TypeError(`Invalid entity-follow route: ${message}`);
  };
  if (route?.id !== 'entity-follow-v1') fail('route id is unavailable');
  if (
    route.fixtureId !== fixtureId ||
    route.fixtureSha256 !== fixtureSha256 ||
    route.fixedTime !== fixedTime
  )
    fail('fixture identity differs');
  if (
    route.selectedIdentity !== selectedIdentity ||
    route.selectedIdentityEnd !== selectedIdentity ||
    route.trajectoryId !== `${fixtureId}:${selectedIdentity}`
  )
    fail('tracked identity differs');
  if (route.warmupMs !== warmupMs || route.measurementMs !== measurementMs)
    fail('phase durations differ');
  const startMs = Date.parse(fixedTime);
  const startEpoch = startMs + warmupMs;
  const endEpoch = startEpoch + measurementMs;
  if (route.startEpochMs !== startEpoch || route.endEpochMs !== endEpoch)
    fail('phase epochs differ');
  if (
    route.start?.dateEpochMs !== startEpoch ||
    route.end?.dateEpochMs !== endEpoch
  )
    fail('observed wall-clock epoch differs from the declared boundary');
  if (
    !Number.isFinite(route.cesiumCurrentTimeStartMs) ||
    !Number.isFinite(route.cesiumCurrentTimeEndMs) ||
    !route.cesiumCurrentTimeStart ||
    !route.cesiumCurrentTimeEnd ||
    typeof route.cesiumClockShouldAnimateStart !== 'boolean' ||
    typeof route.cesiumClockShouldAnimateEnd !== 'boolean' ||
    !Number.isFinite(route.cesiumClockStepStart) ||
    !Number.isFinite(route.cesiumClockStepEnd)
  )
    fail('Cesium clock state was not observed at both boundaries');
  if (
    route.sourceFreshness?.start !== 'current' ||
    route.sourceFreshness?.end !== 'current'
  )
    fail('source freshness was lost');
  if (
    route.sourceLastUpdateStart !== startMs ||
    route.sourceLastUpdateEnd !== startMs ||
    route.sourceCountStart !== fixtureCount ||
    route.sourceCountEnd !== fixtureCount
  )
    fail('source fixture identity/count changed at a boundary');
  if (
    !Number.isFinite(route.sourceAgeStartMs) ||
    !Number.isFinite(route.sourceAgeEndMs) ||
    route.sourceAgeStartMs < 0 ||
    route.sourceAgeStartMs > freshnessWindowMs ||
    route.sourceAgeEndMs < 0 ||
    route.sourceAgeEndMs > freshnessWindowMs ||
    route.sourceAgeStartMs !== warmupMs ||
    route.sourceAgeEndMs !== warmupMs + measurementMs
  )
    fail('source age is outside its declared phase or freshness window');
  const point = (value, label) => {
    if (
      !value ||
      !['longitudeDeg', 'latitudeDeg', 'heightM'].every((key) =>
        Number.isFinite(value[key]),
      )
    )
      fail(`${label} target position is unavailable`);
    if (Math.abs(value.latitudeDeg) > 90 || Math.abs(value.longitudeDeg) > 180)
      fail(`${label} target position is invalid`);
  };
  point(route.targetStart, 'start');
  point(route.targetEnd, 'end');
  const latitude1 = (route.targetStart.latitudeDeg * Math.PI) / 180;
  const latitude2 = (route.targetEnd.latitudeDeg * Math.PI) / 180;
  const dLatitude = latitude2 - latitude1;
  const dLongitude =
    ((route.targetEnd.longitudeDeg - route.targetStart.longitudeDeg) *
      Math.PI) /
    180;
  const haversine =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(dLongitude / 2) ** 2;
  const horizontalMovedM =
    2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, haversine)));
  const movedM = Math.hypot(
    horizontalMovedM,
    route.targetEnd.heightM - route.targetStart.heightM,
  );
  if (!(movedM > 1e-6))
    fail('tracked target did not move beyond numeric roundoff');
  if (
    !Number.isFinite(route.motionDistanceM) ||
    !Number.isFinite(route.observedTargetDistanceM) ||
    Math.abs(route.motionDistanceM - movedM) > 1e-6 ||
    Math.abs(route.observedTargetDistanceM - movedM) > 1e-6
  )
    fail(
      'tracked target distance does not match the observed boundary positions',
    );
  const pose = (value, label) => {
    if (
      !value ||
      !['position', 'direction', 'up'].every(
        (key) =>
          value[key] &&
          ['x', 'y', 'z'].every((axis) => Number.isFinite(value[key][axis])),
      ) ||
      !Array.isArray(value.transform) ||
      value.transform.length !== 16 ||
      !value.transform.every(Number.isFinite)
    )
      fail(`${label} camera boundary pose is unavailable`);
  };
  pose(route.start, 'start');
  pose(route.end, 'end');
  return true;
}
