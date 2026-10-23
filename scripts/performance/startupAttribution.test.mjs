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
  const projected = attribution({
    resourceTimingSummary: {
      entryCount: 300,
      summarizedEntryCount: 256,
      omittedEntryCount: 44,
      truncated: true,
      originCounts: { sameOrigin: 200, crossOrigin: 56, unavailable: 0 },
      initiatorCounts: { script: 80, privateType: 220 },
      duration: { availableCount: 256, maxMs: 320 },
      transferSize: {
        availableCount: 2,
        knownPositiveBytes: 2048,
        zeroOrUnavailableCount: 254,
      },
      encodedBodySize: {
        availableCount: 1,
        knownPositiveBytes: 1024,
        zeroOrUnavailableCount: 255,
      },
      providerClasses: {
        tokenApi: {
          count: 3,
          durationAvailableCount: 3,
          maxDurationMs: 51,
          latestResponseEndMs: 60,
        },
      },
      leakedUrl: 'https://private.example/path?token=secret',
    },
    mapIdentity: {
      activeId: 'esri-imagery',
      status: 'ready',
      switchOrigin: 'automatic',
      globeShown: true,
      terrainProviderKind: 'cesium-terrain',
      url: 'https://private.example/?token=secret',
    },
  });
  assert.equal(projected.pageState.resourceTimingSummary.limit, 256);
  assert.equal(
    projected.pageState.resourceTimingSummary.coverage,
    'bounded-retained-resource-entries-only',
  );
  assert.equal(projected.pageState.resourceTimingSummary.entryCount, 300);
  assert.equal(projected.pageState.resourceTimingSummary.omittedEntryCount, 44);
  assert.equal(
    projected.pageState.resourceTimingSummary.initiatorCounts.other,
    null,
  );
  assert.equal(projected.pageState.resourceTimingSummary.bufferCapacity, null);
  assert.equal(
    projected.pageState.resourceTimingSummary.droppedEntryCount,
    null,
  );
  assert.equal(
    projected.pageState.resourceTimingSummary.providerClasses.tokenApi.count,
    3,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(projected.pageState.mapIdentity)),
    {
      activeStackId: 'esri-imagery',
      status: 'ready',
      switchOrigin: 'automatic',
      globeShown: true,
      terrainProviderKind: 'cesium-terrain',
    },
  );
  assert.equal(JSON.stringify(projected).includes('private.example'), false);
  assert.equal(JSON.stringify(projected).includes('secret'), false);
});

test('serialized page-state observer reports real locale, enabled layers and navigation timing', () => {
  const resourceEntries = [
    {
      name: 'https://app.example/api/google/tiles-token?token=secret',
      initiatorType: 'fetch',
      duration: 12,
      responseEnd: 15,
      transferSize: 100,
      encodedBodySize: 90,
    },
    {
      name: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=secret',
      initiatorType: 'img',
      duration: 44,
      responseEnd: 50,
      transferSize: 0,
      encodedBodySize: 0,
    },
    {
      name: 'http://[invalid',
      initiatorType: 'private initiator',
      duration: 5,
      responseEnd: 10,
      transferSize: 20,
      encodedBodySize: 10,
    },
    {
      name: 'https://api.cesium.com/v1/assets/secret/endpoint?access_token=secret',
      initiatorType: 'xmlhttprequest',
      duration: 22,
      responseEnd: 23,
      transferSize: 30,
      encodedBodySize: 20,
    },
    {
      name: 'https://services.arcgisonline.com/ArcGIS/rest?token=secret',
      initiatorType: 'img',
      duration: 31,
      responseEnd: 32,
      transferSize: 0,
      encodedBodySize: 0,
    },
    {
      name: 'https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json',
      initiatorType: 'fetch',
      duration: 16,
      responseEnd: 17,
      transferSize: 0,
      encodedBodySize: 0,
    },
    {
      name: 'https://tile.openstreetmap.org/0/0/0.png',
      initiatorType: 'img',
      duration: 17,
      responseEnd: 18,
      transferSize: 0,
      encodedBodySize: 0,
    },
    ...Array.from({ length: 251 }, (_, index) => ({
      name: `https://app.example/assets/resource-${index}.js?token=secret`,
      initiatorType: 'fetch',
      duration: 1,
      responseEnd: 2,
      transferSize: 0,
      encodedBodySize: 0,
    })),
  ];
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
          mapStackController: {
            getState: () => ({
              activeId: 'esri-imagery',
              status: 'ready',
              switchOrigin: 'manual',
              activeStack: {
                url: 'https://private.example/with?token=secret',
              },
            }),
          },
          viewer: {
            scene: { globe: { show: true } },
            terrainProvider: {
              constructor: { name: 'CesiumTerrainProvider' },
            },
          },
        },
      },
      performance: {
        getEntriesByType: (kind) =>
          kind === 'navigation'
            ? [{ startTime: 0, duration: 500, loadEventEnd: 500 }]
            : kind === 'resource'
              ? resourceEntries
              : [],
      },
      document: { documentElement: { lang: 'de' } },
      navigator: { languages: ['de-DE', 'en-US'] },
      location: {
        href: 'https://app.example/start?credential=secret',
        origin: 'https://app.example',
      },
      URL,
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
  assert.equal(state.resourceTimingSummary.entryCount, 258);
  assert.equal(state.resourceTimingSummary.summarizedEntryCount, 256);
  assert.equal(state.resourceTimingSummary.omittedEntryCount, 2);
  assert.equal(state.resourceTimingSummary.truncated, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.resourceTimingSummary.originCounts)),
    {
      sameOrigin: 250,
      crossOrigin: 5,
      unavailable: 1,
    },
  );
  assert.equal(state.resourceTimingSummary.initiatorCounts.script, 0);
  assert.equal(state.resourceTimingSummary.initiatorCounts.img, 3);
  assert.equal(state.resourceTimingSummary.initiatorCounts.fetch, 251);
  assert.equal(state.resourceTimingSummary.initiatorCounts.xmlhttprequest, 1);
  assert.equal(state.resourceTimingSummary.initiatorCounts.other, 1);
  assert.equal(state.resourceTimingSummary.duration.maxMs, 44);
  assert.equal(state.resourceTimingSummary.transferSize.availableCount, 3);
  assert.equal(
    state.resourceTimingSummary.transferSize.zeroOrUnavailableCount,
    253,
  );
  assert.equal(state.resourceTimingSummary.providerClasses.tokenApi.count, 1);
  assert.equal(state.resourceTimingSummary.providerClasses.google.count, 1);
  assert.equal(
    state.resourceTimingSummary.providerClasses.sameOriginAssets.count,
    249,
  );
  assert.equal(state.resourceTimingSummary.providerClasses.unknown.count, 1);
  assert.equal(state.resourceTimingSummary.providerClasses.cesium.count, 1);
  assert.equal(state.resourceTimingSummary.providerClasses.esri.count, 1);
  assert.equal(state.resourceTimingSummary.providerClasses.reearth.count, 1);
  assert.equal(state.resourceTimingSummary.providerClasses.osm.count, 1);
  assert.equal(
    state.resourceTimingSummary.providerClasses.google.maxDurationMs,
    44,
  );
  assert.equal(
    state.resourceTimingSummary.providerClasses.google.latestResponseEndMs,
    50,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(state.mapIdentity)), {
    activeId: 'esri-imagery',
    status: 'ready',
    switchOrigin: 'manual',
    globeShown: true,
    terrainProviderKind: 'cesium-terrain',
  });
  const serialized = JSON.stringify(state);
  for (const secret of [
    'app.example',
    'tiles.example',
    'private.example',
    'secret',
  ])
    assert.equal(serialized.includes(secret), false);
});

test('resource and map state are explicitly unavailable when browser APIs fail', () => {
  const state = runInNewContext(
    `(${readStartupAttributionPageState.toString()})()`,
    {
      window: {
        __godsEyeView: {
          mapStackController: {
            getState: () => {
              throw new Error('unavailable');
            },
          },
        },
      },
      performance: {
        getEntriesByType: (kind) => {
          if (kind === 'resource') throw new Error('unsupported');
          return [];
        },
      },
      document: { documentElement: {} },
      navigator: {},
      location: { href: 'https://app.example/', origin: 'https://app.example' },
      URL,
    },
  );
  assert.equal(state.resourceTimingSummary, null);
  assert.equal(state.mapIdentity, null);
});

test('resource classes do not treat missing names or local APIs as assets', () => {
  const state = runInNewContext(
    `(${readStartupAttributionPageState.toString()})()`,
    {
      window: {},
      performance: {
        getEntriesByType: (kind) =>
          kind === 'resource'
            ? [
                { name: undefined },
                { name: '   ' },
                { name: 'data:text/plain,secret' },
                { name: 'https://app.example/api/private?token=secret' },
                { name: 'https://app.example/cesium-ab123/Workers/job.js' },
              ]
            : [],
      },
      document: { documentElement: {} },
      navigator: {},
      location: { href: 'https://app.example/', origin: 'https://app.example' },
      URL,
    },
  );
  const summary = state.resourceTimingSummary;
  assert.equal(summary.providerClasses.unknown.count, 3);
  assert.equal(summary.providerClasses.otherSameOrigin.count, 1);
  assert.equal(summary.providerClasses.sameOriginAssets.count, 1);
  assert.equal(summary.duration.maxMs, null);
  assert.equal(summary.duration.availableCount, 0);
  assert.equal(summary.originCounts.unavailable, 3);
  assert.equal(JSON.stringify(state).includes('secret'), false);
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
