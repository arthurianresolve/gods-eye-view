import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  assertStartupAttributionMode,
  createStartupAttribution,
  readStartupAttributionPageState,
  STARTUP_ATTRIBUTION_SCHEMA,
} from './startupAttribution.mjs';
import {
  isSupportedStartupOnlyFixture,
  resolveStartupOnlyFixtureIdentity,
} from './captureComparisonContract.mjs';

function attribution(overrides = {}) {
  return createStartupAttribution({
    startedAtMs: 1000,
    navigationCompletedAtMs: 1100,
    foregroundStartedAtMs: 1100,
    foregroundCompletedAtMs: 1200,
    viewerWaitStartedAtMs: 1200,
    viewerObservedAtMs: 1400,
    diagnosticsDisableStartedAtMs: 1400,
    diagnosticsDisableCompletedAtMs: 1450,
    loaderWaitStartedAtMs: 1450,
    loaderHiddenObservedAtMs: 1600,
    navigationTiming: {
      startTime: 0,
      duration: 1080,
      domContentLoadedEventEnd: 700,
      loadEventEnd: 1080,
    },
    locale: 'en',
    navigatorLanguages: ['en-US', 'en'],
    enabledLayerIds: [],
    ...overrides,
  });
}

test('startup attribution is opt-in only for startup-only diagnostic shards', () => {
  assert.equal(
    assertStartupAttributionMode({ enabled: false, startupOnlyShard: false }),
    false,
  );
  assert.equal(
    assertStartupAttributionMode({ enabled: true, startupOnlyShard: true }),
    true,
  );
  assert.throws(
    () =>
      assertStartupAttributionMode({ enabled: true, startupOnlyShard: false }),
    /requires --startup-only-shard/,
  );
});

test('startup attribution reports separate host observation boundaries', () => {
  const result = attribution();
  assert.equal(result.schema, STARTUP_ATTRIBUTION_SCHEMA);
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.hostBoundaries.foregroundActivation.elapsedMs, 100);
  assert.equal(result.hostBoundaries.viewerExistence.elapsedFromStartMs, 400);
  assert.equal(result.hostBoundaries.diagnosticsDisable.elapsedMs, 50);
  assert.equal(
    result.hostBoundaries.loadingScreenHidden.elapsedFromStartMs,
    600,
  );
  assert.equal(result.navigationTiming.loadEventEnd, 1080);
  assert.deepEqual(result.pageState.navigatorLanguages, ['en-US', 'en']);
  assert.deepEqual(result.pageState.enabledLayerIds, []);
});

test('startup attribution rejects missing and out-of-order boundaries', () => {
  assert.throws(() => createStartupAttribution(), /startedAtMs/);
  assert.throws(
    () => attribution({ diagnosticsDisableStartedAtMs: 1700 }),
    /must not precede the prior boundary/,
  );
});

test('startup attribution bounds locale, language, layer and timing fields', () => {
  const result = attribution({
    locale: 'e'.repeat(80),
    navigatorLanguages: Array.from(
      { length: 12 },
      (_, index) => `lang-${index}`,
    ),
    enabledLayerIds: Array.from({ length: 70 }, (_, index) => `layer-${index}`),
    navigationTiming: { duration: 123, privatePayload: 'discard' },
  });
  assert.equal(result.pageState.locale.length, 32);
  assert.equal(result.pageState.navigatorLanguages.length, 8);
  assert.equal(result.pageState.omittedNavigatorLanguageCount, 4);
  assert.equal(result.pageState.enabledLayerIds.length, 64);
  assert.equal(result.pageState.omittedEnabledLayerIdCount, 6);
  assert.deepEqual(Object.keys(result.navigationTiming).sort(), [
    'domComplete',
    'domContentLoadedEventEnd',
    'domInteractive',
    'duration',
    'loadEventEnd',
    'responseStart',
    'startTime',
  ]);
});

test('serialized page-state observer reports real locale, enabled layers and navigation timing', () => {
  const readState = runInNewContext(
    `(${readStartupAttributionPageState.toString()})`,
    {
      window: {
        __godsEyeView: {
          dataManager: {
            getAll: () => [
              { id: 'flights', enabled: true },
              { id: 'cctv', enabled: false },
            ],
          },
        },
      },
      performance: {
        getEntriesByType: (kind) =>
          kind === 'navigation'
            ? [{ startTime: 0, duration: 500, loadEventEnd: 500 }]
            : [],
      },
      document: { documentElement: { lang: 'de' } },
      navigator: { languages: ['de-DE', 'en-US'] },
    },
  );
  const state = readState();
  assert.equal(state.locale, 'de');
  assert.deepEqual([...state.navigatorLanguages], ['de-DE', 'en-US']);
  assert.deepEqual([...state.enabledLayerIds], ['flights']);
  assert.equal(state.navigationTiming.startTime, 0);
  assert.equal(state.navigationTiming.duration, 500);
  assert.equal(state.navigationTiming.loadEventEnd, 500);
  assert.equal(state.navigationTiming.responseStart, undefined);
});

test('dense startup fixture identity is the registered 2500-record production fixture', () => {
  assert.equal(isSupportedStartupOnlyFixture('dense-investigation'), true);
  assert.deepEqual(
    resolveStartupOnlyFixtureIdentity('dense-investigation', {
      productionFlightFixture: {
        id: 'opensky-dense-investigation-v1',
        count: 2500,
        sha256: 'd'.repeat(64),
      },
    }),
    {
      workloadId: 'dense-investigation',
      id: 'opensky-dense-investigation-v1',
      sha256: 'd'.repeat(64),
    },
  );
  assert.throws(
    () =>
      resolveStartupOnlyFixtureIdentity('dense-investigation', {
        productionFlightFixture: {
          id: 'wrong-fixture',
          count: 2500,
          sha256: 'd'.repeat(64),
        },
      }),
    /strictly equal/,
  );
});
