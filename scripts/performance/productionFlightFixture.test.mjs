import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DENSE_FLIGHT_FIXTURE_COUNT,
  DEFAULT_FLIGHT_FIXTURE_TIME,
  RENDER_DEMAND_PROFILE,
  RENDER_DEMAND_PROFILE_SHA256,
  normalizeRenderDemandAngleDegrees,
  assessRenderDemandSnapshotStability,
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  createProductionMilitaryFixture,
  classifyRenderDemandRequest,
  respondToRenderDemandApiFixture,
  createRenderDemandFailureReport,
  installFixedWallClock,
  installFrozenWallClock,
  installHeldMonotonicWallClock,
  installPhasedMonotonicWallClock,
  expectedFixtureRunOrdinal,
  installFixtureWallClockOnPage,
  selectFixtureWallClockInstaller,
  assertObservedTrackingRoute,
  respondToProductionFlightFixture,
  respondToProductionMilitaryFixture,
} from './productionFlightFixture.mjs';
import {
  fixtureRequestCommand,
  interceptFixtureSession,
} from './fixtureInterception.mjs';
import {
  createFlightSource,
  createMilitarySource,
} from '../../src/sources/live/standalone.js';

const BASE = 'http://127.0.0.1:4173/';

test('render-demand traffic classifier distinguishes known offline bootstrap/map requests from unexpected requests', () => {
  const origin = 'http://127.0.0.1:4173';
  const classify = (url, method = 'GET') =>
    classifyRenderDemandRequest({ url, origin, method });
  assert.equal(
    classify(`${origin}/api/setup/status`),
    'expected-bootstrap-api',
  );
  assert.equal(
    classify(`${origin}/api/setup/status`, 'POST'),
    'unexpected-api',
  );
  assert.equal(
    classify(`${origin}/api/setup/status?token=hidden`),
    'unexpected-api',
  );
  assert.equal(
    classify('http://user:secret@127.0.0.1:4173/api/setup/status'),
    'unexpected-api',
  );
  assert.equal(
    classify(`${origin}/api/realtime/oauth-status`),
    'unexpected-api',
  );
  for (const [path, method] of [
    ['/api/google/tiles-token', 'GET'],
    ['/api/local-receivers/aircraft', 'GET'],
    ['/api/realtime/debug-log', 'POST'],
  ])
    assert.equal(
      classify(`${origin}${path}`, method),
      'expected-render-demand-api',
    );
  assert.equal(
    classify(`${origin}/api/google/tiles-token?key=hidden`, 'GET'),
    'unexpected-api',
  );
  assert.equal(
    classify(`${origin}/api/realtime/debug-log`, 'GET'),
    'unexpected-api',
  );
  for (const [path, method] of [
    ['/api/google/tiles-token', 'POST'],
    ['/api/local-receivers/aircraft', 'POST'],
    ['/api/realtime/debug-log', 'GET'],
  ])
    assert.equal(classify(`${origin}${path}`, method), 'unexpected-api');
  for (const [path, method] of [
    ['/api/google/tiles-token?provider=google', 'GET'],
    ['/api/local-receivers/aircraft?limit=1', 'GET'],
    ['/api/realtime/debug-log?level=debug', 'POST'],
  ])
    assert.equal(classify(`${origin}${path}`, method), 'unexpected-api');
  const blockedFonts = [
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&icon_names=adjust,arrow_drop_down,arrow_forward,arrow_left,arrow_right,bolt,chevron_left,chevron_right,close,close_fullscreen,dark_mode,draw,east,flare,flight,layers_clear,light_mode,local_fire_department,my_location,navigation,normal,on,open_in_full,public,radar,radio,right_panel_close,right_panel_open,rocket_launch,skip_next,skip_previous,view_in_ar',
  ];
  for (const fontUrl of blockedFonts)
    assert.equal(
      classifyRenderDemandRequest({
        url: fontUrl,
        origin,
        method: 'GET',
        resourceType: 'stylesheet',
      }),
      'expected-blocked-static-font',
    );
  assert.equal(
    classifyRenderDemandRequest({
      url: blockedFonts[0],
      origin,
      method: 'GET',
      resourceType: 'image',
    }),
    'unexpected-external',
  );
  for (const resourceType of [undefined, null, '', 'Document', 'Font'])
    assert.equal(
      classifyRenderDemandRequest({
        url: blockedFonts[0],
        origin,
        method: 'GET',
        resourceType,
      }),
      'unexpected-external',
      `font allowlist rejects resource type ${String(resourceType)}`,
    );
  assert.equal(
    classifyRenderDemandRequest({
      url: blockedFonts[0],
      origin,
      method: 'GET',
    }),
    'unexpected-external',
  );
  assert.equal(
    classifyRenderDemandRequest({
      url: blockedFonts[0],
      origin,
      method: 'POST',
      resourceType: 'stylesheet',
    }),
    'unexpected-external',
  );
  assert.equal(
    classify(`${blockedFonts[0]}&key=hidden`),
    'unexpected-external',
  );
  assert.equal(
    classify(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0',
    ),
    'expected-blocked-map-provider',
  );
  assert.equal(
    classify('https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json'),
    'expected-blocked-map-provider',
  );
  assert.equal(
    classify('https://tile.openstreetmap.org/3/2/1.png'),
    'expected-blocked-map-provider',
  );
  assert.equal(
    classify('https://tile.openstreetmap.org/3/2/1.png?key=hidden'),
    'unexpected-external',
  );
  assert.equal(
    classify('https://example.invalid/tiles/1'),
    'unexpected-external',
  );
  assert.equal(classify('not a URL'), 'invalid-request');
});

test('render-demand camera angle normalization treats equivalent 0 and 360 values equally', () => {
  assert.equal(normalizeRenderDemandAngleDegrees(0), 0);
  assert.equal(normalizeRenderDemandAngleDegrees(360), 0);
  assert.equal(normalizeRenderDemandAngleDegrees(-360), 0);
  assert.equal(normalizeRenderDemandAngleDegrees(359), -1);
  assert.equal(normalizeRenderDemandAngleDegrees(180), -180);
  assert.equal(normalizeRenderDemandAngleDegrees(Number.NaN), null);
});

test('render-demand API fixtures answer only exact known support routes', async () => {
  const origin = new URL(BASE).origin;
  const request = (method) => ({ method: () => method });
  const google = respondToRenderDemandApiFixture(
    new URL('/api/google/tiles-token', BASE),
    request('GET'),
    BASE,
  );
  assert.deepEqual(JSON.parse(google.body), {});
  const local = respondToRenderDemandApiFixture(
    new URL('/api/local-receivers/aircraft', BASE),
    request('GET'),
    BASE,
  );
  assert.deepEqual(JSON.parse(local.body), {
    configured: false,
    feeds: [],
    records: [],
  });
  const log = respondToRenderDemandApiFixture(
    new URL('/api/realtime/debug-log', BASE),
    request('POST'),
    BASE,
  );
  assert.equal(log.status, 204);
  assert.equal(log.body, '');
  assert.equal(
    respondToRenderDemandApiFixture(
      new URL('/api/google/tiles-token?key=hidden', BASE),
      request('GET'),
      BASE,
    ),
    undefined,
  );
  assert.equal(
    respondToRenderDemandApiFixture(
      new URL('/api/realtime/debug-log', BASE),
      request('GET'),
      BASE,
    ),
    undefined,
  );
  assert.equal(
    respondToRenderDemandApiFixture(
      new URL('/api/google/tiles-token', 'https://example.invalid/'),
      request('GET'),
      BASE,
    ),
    undefined,
  );
  assert.equal(origin, 'http://127.0.0.1:4173');
});

test('fixture interception adapter passes paused resource type to scoped responder', async () => {
  let observedResourceType = null;
  const [command, params] = await fixtureRequestCommand(
    {
      requestId: 'stylesheet-request',
      resourceType: 'Stylesheet',
      request: {
        url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
        method: 'GET',
        postData: null,
      },
    },
    BASE,
    (_url, request) => {
      observedResourceType = request.resourceType();
      return undefined;
    },
  );
  assert.equal(observedResourceType, 'Stylesheet');
  assert.equal(
    classifyRenderDemandRequest({
      url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
      origin: new URL(BASE).origin,
      method: 'GET',
      resourceType: observedResourceType,
    }),
    'expected-blocked-static-font',
  );
  assert.equal(command, 'Fetch.failRequest');
  assert.equal(params.errorReason, 'BlockedByClient');
});

test('render-demand failure report retains bounded stages without provider URLs, credentials or bodies', () => {
  const report = createRenderDemandFailureReport({
    stage: 'scene-settle',
    error: new Error(
      'failed https://user:secret@example.invalid/path?token=abc',
    ),
    observations: Array.from({ length: 20 }, (_, index) => ({
      stage: 'fixture-delivery',
      state: {
        index,
        note: 'https://provider.invalid/tile?key=secret',
        body: 'fixture response body',
      },
    })),
    delivery: {
      routeAttempts: { flights: 2, military: 3 },
      acknowledged: { flights: 1, military: 1 },
      invalidFixtureRouteCount: 0,
      body: 'must not appear',
    },
    traffic: {
      expectedBootstrapApiCount: 4,
      expectedRenderDemandApiCount: 3,
      expectedBlockedStaticFontCount: 2,
      expectedBlockedMapProviderCount: 7,
      unexpectedApiCount: 0,
      unexpectedExternalCount: 0,
      otherApiPaths: ['/api/unknown', 'https://bad.invalid/?token=secret'],
    },
    fixture: {
      fixedTime: DEFAULT_FLIGHT_FIXTURE_TIME,
      flightsId: 'empty-flight-fixture-v1',
      flightsSha256: 'a'.repeat(64),
      flightsBytes: 32,
      militaryId: 'empty-military-fixture-v1',
      militarySha256: 'b'.repeat(64),
      militaryBytes: 16,
    },
  });
  assert.equal(report.failedStage, 'scene-settle');
  assert.equal(report.observations.length, 12);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /provider\.invalid|example\.invalid|secret|fixture response body|must not appear/,
  );
  assert.deepEqual(report.delivery.routeAttempts, { flights: 2, military: 3 });
  assert.equal(report.fixture.flightsId, 'empty-flight-fixture-v1');
  assert.equal(report.fixture.militaryBytes, 16);
  assert.equal(report.traffic.otherApiPaths[1], '[other-api-path]');
  assert.ok(Buffer.byteLength(serialized) < 24_000);
});

test('render-demand failure projection retains controlled start/end evidence and terminal tile-demand ownership', () => {
  const sourceCommit = 'a'.repeat(40);
  const snapshot = (frameNumber) => ({
    applicationStatus: 'ready',
    source: {
      appCommit: sourceCommit,
      expectedCommit: sourceCommit,
      matchesHarnessHead: true,
    },
    browser: {
      family: 'chromium',
      version: '155.0.8059.39',
      rendererClass: 'swiftshader',
      renderer: 'ANGLE (Google, Vulkan 1.3.0, SwiftShader driver 4.1)',
      viewport: { width: 1440, height: 1000, dpr: 1 },
      drawingBuffer: { width: 1440, height: 1000 },
    },
    fixtureEpochMs: 1791900000000,
    visibilityState: 'visible',
    focused: true,
    frameNumber,
    camera: {
      latitude: 30.2672,
      longitude: -97.7431,
      altitudeMeters: 800,
      headingDegrees: 15,
      pitchDegrees: -30,
      rollDegrees: 0,
    },
    map: { status: 'ready', activeId: 'esri-imagery' },
    enabledLayerIds: ['flights', 'military'],
    stats: {
      flights: {
        enabled: true,
        lifecycleState: 'enabled',
        count: 0,
        status: 200,
      },
      military: {
        enabled: true,
        lifecycleState: 'enabled',
        count: 0,
        status: 200,
      },
    },
    mapDemand: {
      globeTilesLoaded: false,
      tileQueueCount: 0,
      tileQueues: { high: 0, medium: 0, low: 0 },
      tileQueueStableSamples: 4,
      observedProviderRequests: 12,
      interceptedProviderRequests: 12,
      pendingProviderRequests: 0,
      requestTrackingOverflow: false,
    },
    settings: {
      msaaSamples: 4,
      preserveDrawingBuffer: true,
      antialias: true,
      fxaaEnabled: false,
      resolutionScale: 1,
      canvasWidth: 1440,
      canvasHeight: 1000,
      style: 'normal',
      bloomEnabled: false,
      bloomIntensity: 50,
      bloomVersion: 2,
      sharpenEnabled: false,
      sharpenIntensity: 49,
      detectionMode: 'OFF',
      densityPct: 75,
      visualDensityPct: 75,
      allocation: 'ELASTIC',
      qualityMode: 'manual',
    },
    governor: {
      installed: true,
      mode: 'active',
      holds: ['application-startup'],
      scheduledUpdates: [],
    },
    pageErrors: [],
    body: 'provider response body must never be retained',
  });
  const report = createRenderDemandFailureReport({
    stage: 'foreground-observation',
    error: new Error('render count remained above target'),
    observations: [
      { stage: 'start-snapshot', state: snapshot(100) },
      { stage: 'end-snapshot', state: snapshot(102) },
    ],
    fixture: {
      profileId: RENDER_DEMAND_PROFILE.id,
      profileSha256: RENDER_DEMAND_PROFILE_SHA256,
    },
    source: { commit: sourceCommit, dirtyAtStart: false, identityValid: true },
    sourceFinish: { sourceChangedDuringRun: false, error: null },
    terminal: {
      status: 'failed',
      foreground: {
        durationMs: 10_000,
        completedPostRenderCount: 7,
        eventOverflow: false,
        foregroundUninterrupted: true,
      },
      visibilityControl: {
        mode: 'simulated-document-hidden-property',
        loopStopped: true,
        resumedFrameAfterPrior: true,
      },
      teardown: {
        status: 'destroyed',
        viewerDestroyed: true,
        layers: 0,
        productionHandlesRemoved: true,
        applicationRenderOwnersReleased: true,
        resourcesBefore: {
          postRenderListeners: 3,
          viewerCanvasPresent: true,
          worldOverlayCanvasPresent: true,
          hostCctvMarkupMatches: true,
          canvasInventory: {
            count: 8,
            truncated: false,
            entries: [
              {
                role: 'viewer-scene',
                width: 1440,
                height: 1000,
                hidden: false,
              },
              {
                role: 'world-overlay-host',
                width: 1440,
                height: 1000,
                hidden: false,
              },
              {
                role: 'cctv-template-host',
                width: 300,
                height: 150,
                hidden: true,
              },
              ...Array.from({ length: 5 }, () => ({
                role: 'other',
                width: 300,
                height: 150,
                hidden: false,
              })),
            ],
          },
        },
        resourcesAfter: {
          postRenderListeners: 1,
          canvasInventory: {
            count: 1,
            truncated: false,
            entries: [
              {
                role: 'cctv-template-host',
                width: 300,
                height: 150,
                hidden: true,
              },
            ],
          },
          viewerCanvasRemoved: true,
          worldOverlayCanvasRemoved: true,
          hostCctvMarkupMatches: true,
          hostCctvReferenceRetained: true,
          hostCctvDimensionsUnchanged: true,
          onlyHostCctvCanvasRemains: true,
        },
        teardownErrors: 0,
      },
      mapDemand: {
        settled: true,
        contentReadiness: 'blocked-by-fixture',
        globeTilesLoaded: true,
        settledGlobeTilesLoaded: true,
        pendingTileQueueCount: 0,
        settledPendingTileQueueCount: 0,
        tileQueueStableSamples: 4,
        providerRequestsBefore: 12,
        providerRequestsAfter: 12,
        interceptedProviderRequests: 12,
        pendingProviderRequests: 0,
        requestTrackingOverflow: false,
      },
      fixture: {
        profileId: RENDER_DEMAND_PROFILE.id,
        profileSha256: RENDER_DEMAND_PROFILE_SHA256,
        populations: { flights: 0, military: 0 },
      },
    },
    traffic: {
      expectedBootstrapApiCount: 1,
      expectedRenderDemandApiCount: 3,
      expectedBlockedStaticFontCount: 2,
      expectedBlockedMapProviderCount: 12,
      observedMapProviderRequestCount: 12,
      pendingMapProviderRequestCount: 0,
      mapProviderRequestTrackingOverflow: false,
      mapProviderRequestsBeforeForeground: 12,
      mapProviderRequestsAfterForeground: 12,
      mapProviderTrafficStable: true,
    },
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.fixture.profileId, RENDER_DEMAND_PROFILE.id);
  assert.equal(report.fixture.profileSha256, RENDER_DEMAND_PROFILE_SHA256);
  assert.equal(
    report.observations[0].state.browser.renderer.includes('SwiftShader'),
    true,
  );
  assert.equal(
    report.observations[0].state.mapDemand.tileQueueStableSamples,
    4,
  );
  assert.equal(report.observations[0].state.camera.altitudeMeters, 800);
  assert.equal(report.observations[1].state.settings.msaaSamples, 4);
  assert.equal(report.observations[0].state.settings.densityPct, 75);
  assert.equal(report.observations[0].state.settings.visualDensityPct, 75);
  assert.equal(report.terminal.mapDemand.globeTilesLoaded, true);
  assert.equal(report.terminal.mapDemand.settledGlobeTilesLoaded, true);
  assert.equal(report.terminal.mapDemand.tileContentReady, false);
  assert.equal(report.terminal.mapDemand.queueQuiescent, true);
  assert.equal(
    report.terminal.mapDemand.contentReadiness,
    'blocked-by-fixture',
  );
  assert.equal(report.terminal.mapDemand.pendingProviderRequests, 0);
  assert.equal(
    report.terminal.fixture.profileSha256,
    RENDER_DEMAND_PROFILE_SHA256,
  );
  assert.equal(report.terminal.teardown.totalPostRenderListenersAfter, 1);
  assert.equal(report.terminal.teardown.applicationRenderOwnersReleased, true);
  assert.deepEqual(
    report.terminal.teardown.canvasOwnership.before.entries.map(
      ({ role }) => role,
    ),
    [
      'viewer-scene',
      'world-overlay-host',
      'cctv-template-host',
      'other',
      'other',
      'other',
      'other',
      'other',
    ],
  );
  assert.equal(report.terminal.teardown.canvasOwnership.after.count, 1);
  assert.deepEqual(report.terminal.teardown.canvasOwnership.after.entries[0], {
    role: 'cctv-template-host',
    width: 300,
    height: 150,
    hidden: true,
  });
  assert.equal(
    report.terminal.teardown.canvasOwnership.onlyHostCctvCanvasRemains,
    true,
  );
  assert.equal(
    report.terminal.teardown.canvasOwnership.hostCctvMarkupMatches,
    true,
  );
  assert.equal(
    report.terminal.teardown.canvasOwnership.viewerCanvasPresentBefore,
    true,
  );
  assert.equal(
    report.terminal.teardown.canvasOwnership.worldOverlayCanvasPresentBefore,
    true,
  );
  assert.equal(
    report.terminal.teardown.canvasOwnership.hostCctvMarkupMatchesBefore,
    true,
  );
  assert.equal(
    report.terminal.teardown.canvasOwnership.hostCctvDimensionsUnchanged,
    true,
  );
  assert.equal(report.traffic.mapProviderTrafficStable, true);
  assert.equal(report.traffic.expectedRenderDemandApiCount, 3);
  assert.equal(report.traffic.expectedBlockedStaticFontCount, 2);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /provider response body|authorization|token/);
  assert.ok(Buffer.byteLength(serialized) < 24_000);
});

test('render-demand snapshots allow only bounded receipt-time movement while health and population stay fixed', () => {
  const snapshot = (fixtureEpochMs, lastUpdate, overrides = {}) => ({
    fixtureEpochMs,
    stats: {
      flights: {
        enabled: true,
        lifecycleState: 'enabled',
        lifecycleUncertain: false,
        count: 0,
        status: 200,
        stale: false,
        lastUpdate: lastUpdate.flights,
        retryInSec: 0,
      },
      military: {
        enabled: true,
        lifecycleState: 'enabled',
        lifecycleUncertain: false,
        count: 0,
        status: 200,
        stale: false,
        lastUpdate: lastUpdate.military,
      },
      ...overrides,
    },
  });
  const startEpochMs = 1_791_900_000_000;
  const endEpochMs = startEpochMs + 10_000;
  const assess = (start, end) =>
    assessRenderDemandSnapshotStability(start, end, {
      expectedFlightReceiptMs: startEpochMs,
    });
  const accepted = assess(
    snapshot(startEpochMs, {
      flights: startEpochMs,
      military: startEpochMs - 5_000,
    }),
    snapshot(endEpochMs, {
      flights: startEpochMs,
      military: endEpochMs,
    }),
  );
  assert.equal(accepted.stableHealthAndPopulation, true);
  assert.equal(accepted.receiptTimestampsValid, true);
  assert.deepEqual(accepted.receiptTimestamps.military, {
    startMs: startEpochMs - 5_000,
    endMs: endEpochMs,
    deltaMs: 15_000,
    valid: true,
  });

  const changedPopulation = snapshot(endEpochMs, {
    flights: startEpochMs,
    military: endEpochMs,
  });
  changedPopulation.stats.flights.count = 1;
  assert.equal(
    assess(
      snapshot(startEpochMs, {
        flights: startEpochMs,
        military: startEpochMs - 5_000,
      }),
      changedPopulation,
    ).stableHealthAndPopulation,
    false,
  );

  const changedHealth = snapshot(endEpochMs, {
    flights: startEpochMs,
    military: endEpochMs,
  });
  changedHealth.stats.military.stale = true;
  assert.equal(
    assess(
      snapshot(startEpochMs, {
        flights: startEpochMs,
        military: startEpochMs - 5_000,
      }),
      changedHealth,
    ).stableHealthAndPopulation,
    false,
  );
  changedHealth.stats.flights.status = 503;
  assert.equal(
    assess(
      snapshot(startEpochMs, {
        flights: startEpochMs,
        military: startEpochMs - 5_000,
      }),
      changedHealth,
    ).stableHealthAndPopulation,
    false,
  );

  for (const lastUpdate of [
    { flights: startEpochMs, military: startEpochMs - 1 },
    { flights: startEpochMs + 1, military: endEpochMs },
    { flights: startEpochMs, military: endEpochMs + 1 },
    { flights: startEpochMs, military: startEpochMs - 15_001 },
    { flights: startEpochMs, military: null },
  ]) {
    assert.equal(
      assess(
        snapshot(startEpochMs, {
          flights: startEpochMs,
          military: startEpochMs,
        }),
        snapshot(endEpochMs, lastUpdate),
      ).receiptTimestampsValid,
      false,
    );
  }
});

test('failed render-demand reports preserve bounded feed receipt timestamps in both endpoint snapshots', () => {
  const sourceCommit = 'd'.repeat(40);
  const timestamp = 1_791_900_000_000;
  const endpoint = (fixtureEpochMs, lastUpdate) => ({
    applicationStatus: 'ready',
    source: {
      appCommit: sourceCommit,
      expectedCommit: sourceCommit,
      matchesHarnessHead: true,
    },
    fixtureEpochMs,
    stats: {
      flights: {
        enabled: true,
        count: 0,
        status: 200,
        stale: false,
        lastUpdate,
      },
      military: {
        enabled: true,
        count: 0,
        status: 200,
        stale: false,
        lastUpdate,
      },
    },
  });
  const start = endpoint(timestamp, timestamp);
  const end = endpoint(timestamp + 15_000, timestamp + 15_000);
  const statsStability = assessRenderDemandSnapshotStability(start, end, {
    expectedFlightReceiptMs: timestamp,
  });
  const report = createRenderDemandFailureReport({
    stage: 'end-snapshot',
    error: new Error('controlled endpoint check failed'),
    observations: [
      { stage: 'start-snapshot', state: start },
      { stage: 'end-snapshot', state: { ...end, statsStability } },
    ],
    terminal: { status: 'failed', statsStability },
  });
  assert.equal(
    report.observations[0].state.stats.military.lastUpdateMs,
    timestamp,
  );
  assert.equal(
    report.observations[1].state.stats.military.lastUpdateMs,
    timestamp + 15_000,
  );
  assert.deepEqual(report.terminal.statsStability.receiptTimestamps.military, {
    startMs: timestamp,
    endMs: timestamp + 15_000,
    deltaMs: 15_000,
    valid: true,
  });
  assert.ok(JSON.stringify(report).length < 24_000);
});

test('render-demand failure projection rejects forged controlled-profile identity', () => {
  assert.match(RENDER_DEMAND_PROFILE.hash, /(?:^|&)dd=75(?:&|$)/);
  assert.equal(RENDER_DEMAND_PROFILE.expected.detection.densityPct, 75);
  assert.equal(RENDER_DEMAND_PROFILE.expected.mapStack, 'osm');
  assert.match(RENDER_DEMAND_PROFILE.id, /-osm-v2$/);
  const report = createRenderDemandFailureReport({
    stage: 'fixture-setup',
    error: new Error('profile setup failed'),
    fixture: {
      profileId: 'other-profile',
      profileSha256: 'c'.repeat(64),
    },
  });
  assert.equal(report.fixture.profileId, null);
  assert.equal(report.fixture.profileSha256, null);
  assert.notEqual(report.fixture.profileId, RENDER_DEMAND_PROFILE.id);
  assert.notEqual(report.fixture.profileSha256, RENDER_DEMAND_PROFILE_SHA256);
  assert.equal(report.status, 'failed');
});

test('production flight fixture is deterministic, bounded OpenSky payload data', () => {
  const options = { count: 2500, fixedTime: '2026-10-08T12:00:00.000Z' };
  const first = createProductionFlightFixture(options);
  const second = createProductionFlightFixture(options);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.body, second.body);
  const payload = JSON.parse(first.body);
  assert.equal(payload.states.length, 2500);
  assert.equal(payload.states[0][0], '000001');
  assert.equal(payload.states[0][3], payload.time);
  assert.equal(payload.states[0][4], payload.time);
  assert.ok(first.byteLength < 4 * 1024 * 1024);
  assert.notEqual(
    first.sha256,
    createProductionFlightFixture({
      ...options,
      fixedTime: '2026-10-08T12:00:01.000Z',
    }).sha256,
  );
});

test('production fixture rejects subsecond epochs that OpenSky rows cannot represent', () => {
  assert.throws(
    () =>
      createProductionFlightFixture({
        fixedTime: '2026-10-08T12:00:00.001Z',
      }),
    /whole second/,
  );
});

test('production flight fixture accepts zero and still rejects negative populations', () => {
  assert.equal(createProductionFlightFixture({ count: 0 }).count, 0);
  assert.throws(
    () => createProductionFlightFixture({ count: -1 }),
    /count is invalid/,
  );
});

test('fixed-time empty flight and readsb fixtures preserve production payload contracts', () => {
  const fixedTime = '2026-10-08T12:00:00.000Z';
  const flights = createProductionFlightFixture({ count: 0, fixedTime });
  const military = createProductionMilitaryFixture({ fixedTime });
  assert.deepEqual(JSON.parse(flights.body), {
    time: flights.fixedTimeMs / 1000,
    states: [],
  });
  assert.deepEqual(JSON.parse(military.body), {
    now: flights.fixedTimeMs / 1000,
    ac: [],
  });
  assert.equal(flights.fixedTime, military.fixedTime);
  assert.match(flights.sha256, /^[a-f0-9]{64}$/);
  assert.match(military.sha256, /^[a-f0-9]{64}$/);
  assert.equal(flights.byteLength, Buffer.byteLength(flights.body));
  assert.equal(military.byteLength, Buffer.byteLength(military.body));
});

test('production source normalizers accept the fixed-time empty layer snapshots', async () => {
  const flights = createProductionFlightFixture({ count: 0 });
  const military = createProductionMilitaryFixture({
    fixedTime: flights.fixedTime,
  });
  const responseFor = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => JSON.parse(body),
  });
  const flightSnapshot = await createFlightSource({
    fetchImpl: async () => responseFor(flights.body),
    now: () => flights.fixedTimeMs,
  }).getSnapshot();
  const militarySource = createMilitarySource({
    fetchImpl: async () => responseFor(military.body),
    now: () => flights.fixedTimeMs,
  });
  const militarySnapshot = await militarySource.getSnapshot();
  assert.deepEqual(flightSnapshot.records, []);
  assert.equal(flightSnapshot.complete, true);
  assert.equal(flightSnapshot.freshness, 'current');
  assert.deepEqual(militarySnapshot.records, []);
  assert.equal(militarySnapshot.complete, true);
  assert.equal(militarySnapshot.freshness, 'current');
  assert.deepEqual(await militarySource.getIdentities(), []);
});

test('empty military fixture is restricted to its exact same-origin GET route', () => {
  const fixture = createProductionMilitaryFixture();
  const request = { method: () => 'GET' };
  assert.equal(
    respondToProductionMilitaryFixture(
      new URL('/api/military', BASE),
      request,
      fixture,
      BASE,
    ).body,
    fixture.body,
  );
  for (const [target, method] of [
    ['https://provider.example/api/military', 'GET'],
    ['http://127.0.0.1:4173/api/military?unexpected=1', 'GET'],
    ['http://127.0.0.1:4173/api/military/track', 'GET'],
    ['http://127.0.0.1:4173/api/military', 'POST'],
  ])
    assert.equal(
      respondToProductionMilitaryFixture(
        new URL(target),
        { method: () => method },
        fixture,
        BASE,
      ),
      undefined,
    );
});

test('real flight source accepts all generated vectors and applies its freshness window', async () => {
  const fixture = createProductionFlightFixture();
  const payload = JSON.parse(fixture.body);
  const sourceAtFixtureTime = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs,
  });
  const snapshot = await sourceAtFixtureTime.getSnapshot();
  assert.equal(snapshot.records.length, DENSE_FLIGHT_FIXTURE_COUNT);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.rejectedCount, 0);
  assert.equal(snapshot.records[0].id, '000001');
  assert.equal(snapshot.records.at(-1).id, '0009c4');
  assert.equal(snapshot.records[0].positionTimeMs, fixture.fixedTimeMs);
  assert.equal(snapshot.records[0].latitude, payload.states[0][6]);
  assert.equal(snapshot.records[0].longitude, payload.states[0][5]);
  assert.equal(snapshot.freshness, 'current');

  const sourceNearMeasurementEnd = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs + 90_000,
  });
  const lateSnapshot = await sourceNearMeasurementEnd.getSnapshot();
  assert.equal(lateSnapshot.ageMs, 90_000);
  assert.equal(lateSnapshot.freshness, 'current');
  assert.equal(lateSnapshot.records[0].positionTimeMs, fixture.fixedTimeMs);

  const sourceAfterFreshnessWindow = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs + 120_001,
  });
  const staleSnapshot = await sourceAfterFreshnessWindow.getSnapshot();
  assert.equal(staleSnapshot.records.length, DENSE_FLIGHT_FIXTURE_COUNT);
  assert.equal(staleSnapshot.freshness, 'stale');
});

test('flight fixture response is restricted to same-origin GET /api/flights', () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const request = { method: () => 'GET' };
  assert.equal(
    respondToProductionFlightFixture(
      new URL('/api/flights?lat=30&lon=-97', BASE),
      request,
      fixture,
      BASE,
    ).body,
    fixture.body,
  );
  for (const [url, method] of [
    ['https://provider.example/api/flights', 'GET'],
    ['http://127.0.0.1:4173/api/flights/track', 'GET'],
    ['http://127.0.0.1:4173/api/flights', 'POST'],
  ])
    assert.equal(
      respondToProductionFlightFixture(
        new URL(url),
        { method: () => method },
        fixture,
        BASE,
      ),
      undefined,
    );
});

test('fixture delivery is recorded only after CDP fulfillment acknowledgement', async () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  assert.throws(() => observer.summarize(3), /No flight fixture fulfillment/);
  let pausedHandler;
  let fulfilled = false;
  const client = new EventEmitter();
  client.send = async (method, params) => {
    if (method === 'Fetch.enable') return;
    assert.equal(method, 'Fetch.fulfillRequest');
    assert.equal(params.responseCode, 200);
    fulfilled = true;
  };
  const originalOn = client.on.bind(client);
  client.on = (event, handler) => {
    if (event === 'Fetch.requestPaused') pausedHandler = handler;
    else originalOn(event, handler);
    return client;
  };
  await interceptFixtureSession(
    client,
    BASE,
    (url, request) =>
      respondToProductionFlightFixture(url, request, fixture, BASE),
    (error) => {
      throw error;
    },
    {
      onFulfilled: (event) => {
        assert.equal(fulfilled, true);
        observer.onFulfilled(event);
      },
    },
  );
  await pausedHandler({
    requestId: 'request-1',
    request: { url: `${BASE}api/flights`, method: 'GET', postData: null },
  });
  assert.deepEqual(observer.summarize(3), {
    schema: 'gev-fixture-delivery-observation/v1',
    status: 'observed',
    scope:
      'static-count integration smoke only; not a paired timing fixture or performance acceptance',
    method:
      'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    fulfilledResponseCount: 1,
    observedFlightsCount: 3,
  });
});

test('fixture delivery rejects acknowledged bytes that differ from the fixture', () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  observer.onFulfilled({
    url: `${BASE}api/flights`,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from('{"states":[]}', 'utf8').toString('base64'),
  });
  assert.throws(
    () => observer.summarize(3),
    /body differs from expected bytes/,
  );
});

test('failed CDP fulfillment acknowledgement never counts as delivered', async () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  let pausedHandler;
  const client = new EventEmitter();
  client.send = async (method) => {
    if (method === 'Fetch.enable') return;
    throw new Error('controlled fulfillment failure');
  };
  const originalOn = client.on.bind(client);
  client.on = (event, handler) => {
    if (event === 'Fetch.requestPaused') pausedHandler = handler;
    else originalOn(event, handler);
    return client;
  };
  const errors = [];
  await interceptFixtureSession(
    client,
    BASE,
    (url, request) =>
      respondToProductionFlightFixture(url, request, fixture, BASE),
    (error) => errors.push(error.message),
    { onFulfilled: observer.onFulfilled },
  );
  await pausedHandler({
    requestId: 'request-failed',
    request: { url: `${BASE}api/flights`, method: 'GET', postData: null },
  });
  assert.deepEqual(errors, ['controlled fulfillment failure']);
  assert.throws(() => observer.summarize(3), /No flight fixture fulfillment/);
});

test('fixed page clock changes Date wall time without replacing performance time', () => {
  let performanceTime = 123.5;
  const target = {
    Date,
    performance: { now: () => performanceTime },
  };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  installFixedWallClock(fixed, target);
  assert.equal(target.Date.now(), fixed);
  assert.equal(new target.Date().getTime(), fixed);
  assert.equal(new target.Date(0).getTime(), 0);
  assert.equal(target.Date(), new Date(fixed).toString());
  assert.equal(target.Date(0), new Date(fixed).toString());
  assert.equal(target.Date.parse('1970-01-01T00:00:00.000Z'), 0);
  assert.equal(target.Date.UTC(1970, 0, 1), 0);
  performanceTime += 1500;
  assert.equal(target.Date.now(), fixed + 1500);
  assert.equal(Number.isInteger(target.Date.now()), true);
  assert.equal(new target.Date().getTime(), fixed + 1500);
  assert.equal(target.performance.now(), 1623.5);
});

test('infrastructure fixture wall clock stays frozen while monotonic time advances', () => {
  let performanceTime = 123.5;
  const target = { Date, performance: { now: () => performanceTime } };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  let installedClock = null;
  const fakePage = {
    evaluateOnNewDocument(installer, ...args) {
      installedClock = installer;
      return installer(...args, target);
    },
  };
  installFixtureWallClockOnPage(fakePage, fixed, { infrastructure: true });
  assert.equal(installedClock, installFrozenWallClock);

  assert.equal(target.Date.now(), fixed);
  assert.equal(new target.Date().getTime(), fixed);
  assert.equal(new target.Date(0).getTime(), 0);
  assert.equal(
    new target.Date('2020-01-02T03:04:05.000Z').toISOString(),
    '2020-01-02T03:04:05.000Z',
  );
  assert.equal(target.Date(), new Date(fixed).toString());
  assert.equal(target.Date(fixed + 1000), new Date(fixed).toString());
  assert.equal(target.performance.now(), 123.5);

  performanceTime += 90_000;
  assert.equal(target.Date.now(), fixed);
  assert.equal(new target.Date().getTime(), fixed);
  assert.equal(target.performance.now(), 90_123.5);
});

test('fixture wall-clock selection preserves dense advancing and capture-held contracts', () => {
  assert.equal(
    selectFixtureWallClockInstaller({ phasedClock: true }),
    installPhasedMonotonicWallClock,
  );
  assert.equal(
    selectFixtureWallClockInstaller({ holdClockUntilCapture: true }),
    installHeldMonotonicWallClock,
  );
  assert.equal(selectFixtureWallClockInstaller(), installFixedWallClock);

  let performanceTime = 10;
  const target = { Date, performance: { now: () => performanceTime } };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  selectFixtureWallClockInstaller()(fixed, target);
  performanceTime += 2500;
  assert.equal(target.Date.now(), fixed + 2500);
});

test('held monotonic wall clock starts once without replacing native timers or monotonic time', () => {
  let performanceTime = 123.5;
  const nativeSetTimeout = () => 'timer';
  const nativeRequestAnimationFrame = () => 'raf';
  const target = {
    Date,
    performance: { now: () => performanceTime },
    setTimeout: nativeSetTimeout,
    requestAnimationFrame: nativeRequestAnimationFrame,
  };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  const clockBeforeStart = installHeldMonotonicWallClock(fixed, target);
  assert.deepEqual(clockBeforeStart, {
    schema: 'gev-held-monotonic-wall-clock/v1',
    started: false,
    startCount: 0,
    epochMs: fixed,
    elapsedMs: null,
  });
  assert.equal(target.Date.now(), fixed);
  performanceTime += 60_000;
  assert.equal(target.Date.now(), fixed, 'the held epoch does not drift');
  const started = target.__gevHeldMonotonicWallClockV1.start();
  assert.equal(started.started, true);
  assert.equal(started.startCount, 1);
  assert.equal(started.epochMs, fixed);
  performanceTime += 90_000;
  assert.equal(target.Date.now(), fixed + 90_000);
  assert.equal(Number.isInteger(target.Date.now()), true);
  assert.throws(
    () => target.__gevHeldMonotonicWallClockV1.start(),
    /only once/,
  );
  assert.equal(target.performance.now(), 150_123.5);
  assert.equal(target.setTimeout, nativeSetTimeout);
  assert.equal(target.requestAnimationFrame, nativeRequestAnimationFrame);
});

test('phased wall clock advances only through declared forward phases and caps boundaries', () => {
  let performanceTime = 10;
  const target = { Date, performance: { now: () => performanceTime } };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  installPhasedMonotonicWallClock(fixed, 1000, 1000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  assert.equal(target.Date.now(), fixed);
  assert.throws(() => clock.startMeasurement(), /warmup boundary/);
  clock.startWarmup();
  assert.throws(() => clock.holdWarmupBoundary(), /too early/);
  performanceTime += 1200;
  assert.equal(target.Date.now(), fixed + 1000);
  const warmup = clock.holdWarmupBoundary();
  assert.equal(warmup.epochMs, fixed + 1000);
  performanceTime += 500;
  assert.equal(target.Date.now(), fixed + 1000, 'warmup hold cannot drift');
  const measure = clock.startMeasurement();
  assert.equal(measure.measurementStartCount, 1);
  assert.throws(() => clock.finishMeasurement(), /too early/);
  performanceTime += 1100;
  assert.equal(target.Date.now(), fixed + 2000);
  const completed = clock.finishMeasurement();
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.epochMs, fixed + 2000);
  assert.equal(completed.runOrdinal, 1);
  performanceTime += 20_000;
  assert.equal(
    target.Date.now(),
    fixed + 2000,
    'completed phase remains capped',
  );
  assert.throws(() => clock.startWarmup(), /only once/);
  assert.throws(() => clock.finishMeasurement(), /only once/);
  const nextRun = clock.resetForNextRun();
  assert.equal(nextRun.phase, 'setup');
  assert.equal(nextRun.epochMs, fixed);
  assert.equal(nextRun.elapsedMs, 0);
  assert.equal(nextRun.runOrdinal, 2);
  assert.throws(() => clock.resetForNextRun(), /completed run/);
  clock.startWarmup();
  assert.throws(() => clock.resetForNextRun(), /completed run/);
  performanceTime += 1000;
  const nextWarmup = clock.holdWarmupBoundary();
  assert.equal(nextWarmup.runOrdinal, 2);
  clock.startMeasurement();
  performanceTime += 1000;
  const nextComplete = clock.finishMeasurement();
  assert.equal(nextComplete.runOrdinal, 2);
  assert.equal(target.performance.now(), performanceTime);
});

test('phased clock rejects callbacks retained from a prior completed run', () => {
  let performanceTime = 10;
  const target = { Date, performance: { now: () => performanceTime } };
  const fixed = Date.parse('2026-10-12T18:00:00.000Z');
  installPhasedMonotonicWallClock(fixed, 1000, 1000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  const finishRun = (runOrdinal) => {
    clock.startWarmup(runOrdinal);
    performanceTime += 1000;
    clock.holdWarmupBoundary(runOrdinal);
    clock.startMeasurement(runOrdinal);
    performanceTime += 1000;
    return clock.finishMeasurement(runOrdinal);
  };

  const completedRun1 = finishRun(1);
  assert.equal(completedRun1.phase, 'complete');
  const run1BoundaryCallback = () => clock.holdWarmupBoundary(1);

  clock.resetForNextRun(1);
  clock.startWarmup(2);
  performanceTime += 1000;
  assert.throws(run1BoundaryCallback, /belongs to run 1; current run is 2/);
  assert.equal(clock.snapshot().phase, 'warmup');
  assert.equal(clock.snapshot().runOrdinal, 2);
  assert.equal(target.Date.now(), fixed + 1000);

  clock.holdWarmupBoundary(2);
  clock.startMeasurement(2);
  performanceTime += 1000;
  const completedRun2 = clock.finishMeasurement(2);
  assert.equal(completedRun2.runOrdinal, 2);
  assert.throws(
    () => clock.resetForNextRun(1),
    /belongs to run 1; current run is 2/,
  );
  assert.equal(clock.snapshot().phase, 'complete');
});

test('phased fixture ordinals distinguish reused Austin from fresh provider documents', () => {
  assert.equal(
    expectedFixtureRunOrdinal({
      sharedDocument: true,
      completedSampleCount: 0,
    }),
    1,
  );
  assert.equal(
    expectedFixtureRunOrdinal({
      sharedDocument: true,
      completedSampleCount: 9,
    }),
    10,
  );
  assert.equal(
    expectedFixtureRunOrdinal({
      sharedDocument: false,
      completedSampleCount: 9,
    }),
    1,
  );
  assert.throws(
    () =>
      expectedFixtureRunOrdinal({
        sharedDocument: true,
        completedSampleCount: -1,
      }),
    /nonnegative/,
  );
});

test('completed-render settling removes its listener on render, timeout, and cancellation', async () => {
  const { settleCompletedRender } =
    await import('./productionFlightFixture.mjs');
  class Event {
    handlers = new Set();
    addEventListener(handler) {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }
    removeEventListener(handler) {
      this.handlers.delete(handler);
    }
    fire() {
      for (const handler of [...this.handlers]) handler();
    }
  }
  const makeViewer = (render) => {
    const postRender = new Event();
    return {
      scene: {
        postRender,
        requestRender() {
          if (render) queueMicrotask(() => postRender.fire());
        },
      },
    };
  };
  const rendered = makeViewer(true);
  const settled = await settleCompletedRender(rendered, 100);
  assert.ok(
    settled.settleElapsedMs === null ||
      Number.isFinite(settled.settleElapsedMs),
  );
  assert.equal(rendered.scene.postRender.handlers.size, 0);
  const timedOut = makeViewer(false);
  await assert.rejects(settleCompletedRender(timedOut, 5), /did not settle/);
  assert.equal(timedOut.scene.postRender.handlers.size, 0);
  const requestFailed = makeViewer(false);
  requestFailed.scene.requestRender = () => {
    throw new Error('render request failed');
  };
  await assert.rejects(
    settleCompletedRender(requestFailed, 100),
    /render request failed/,
  );
  assert.equal(requestFailed.scene.postRender.handlers.size, 0);
  const cancelled = makeViewer(false);
  const controller = new AbortController();
  const pending = settleCompletedRender(cancelled, 1000, controller.signal);
  controller.abort(new Error('cancel test'));
  await assert.rejects(pending, /cancel test/);
  assert.equal(cancelled.scene.postRender.handlers.size, 0);
});

test('entity-follow route requires matching fixture epochs, fresh source, and actual target motion', () => {
  const julian = (epoch) => {
    const value = epoch / 86_400_000 + 2_440_587.5;
    const dayNumber = Math.floor(value);
    return { dayNumber, secondsOfDay: (value - dayNumber) * 86_400 };
  };
  const base = Date.parse('2026-10-08T12:00:00.000Z');
  const route = {
    id: 'entity-follow-v1',
    fixtureId: 'opensky-dense-investigation-v1',
    fixtureSha256: 'a'.repeat(64),
    fixedTime: '2026-10-08T12:00:00.000Z',
    selectedIdentity: 'flights:000001',
    selectedIdentityEnd: 'flights:000001',
    trajectoryId: 'opensky-dense-investigation-v1:flights:000001',
    warmupMs: 30_000,
    measurementMs: 60_000,
    startEpochMs: base + 30_000,
    endEpochMs: base + 90_000,
    cesiumCurrentTimeStart: julian(base),
    cesiumCurrentTimeEnd: julian(base),
    cesiumCurrentTimeStartMs: base,
    cesiumCurrentTimeEndMs: base,
    cesiumClockShouldAnimateStart: false,
    cesiumClockShouldAnimateEnd: false,
    cesiumClockStepStart: 0,
    cesiumClockStepEnd: 0,
    sourceFreshness: { start: 'current', end: 'current' },
    sourceAgeStartMs: 30_000,
    sourceAgeEndMs: 90_000,
    sourceLastUpdateStart: base,
    sourceLastUpdateEnd: base,
    sourceCountStart: 2500,
    sourceCountEnd: 2500,
    targetStart: { longitudeDeg: -97.7, latitudeDeg: 30.2, heightM: 1000 },
    targetEnd: { longitudeDeg: -97.6, latitudeDeg: 30.3, heightM: 1000 },
    start: {
      dateEpochMs: base + 30_000,
      position: { x: 1, y: 2, z: 3 },
      direction: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      transform: Array(16).fill(0),
    },
    end: {
      dateEpochMs: base + 90_000,
      position: { x: 4, y: 5, z: 6 },
      direction: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      transform: Array(16).fill(0),
    },
  };
  const lat1 = (route.targetStart.latitudeDeg * Math.PI) / 180;
  const lat2 = (route.targetEnd.latitudeDeg * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon =
    ((route.targetEnd.longitudeDeg - route.targetStart.longitudeDeg) *
      Math.PI) /
    180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  route.motionDistanceM = route.observedTargetDistanceM =
    2 * 6_371_000 * Math.asin(Math.sqrt(h));
  const expected = {
    fixtureId: route.fixtureId,
    fixtureSha256: route.fixtureSha256,
    fixedTime: route.fixedTime,
    warmupMs: 30_000,
    measurementMs: 60_000,
  };
  assert.equal(assertObservedTrackingRoute(route, expected), true);
  for (const mutate of [
    (copy) => {
      copy.selectedIdentity = null;
    },
    (copy) => {
      copy.selectedIdentityEnd = 'flights:000002';
    },
    (copy) => {
      copy.targetEnd = structuredClone(copy.targetStart);
    },
    (copy) => {
      copy.sourceAgeEndMs = 120_001;
    },
    (copy) => {
      copy.sourceAgeEndMs = Number.NaN;
    },
    (copy) => {
      copy.endEpochMs += 1;
    },
    (copy) => {
      copy.targetEnd.latitudeDeg = Number.NaN;
    },
    (copy) => {
      copy.end.transform = null;
    },
  ]) {
    const invalid = structuredClone(route);
    mutate(invalid);
    assert.throws(
      () => assertObservedTrackingRoute(invalid, expected),
      /Invalid entity-follow route/,
    );
  }
});
