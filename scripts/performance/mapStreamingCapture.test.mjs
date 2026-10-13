import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import * as Cesium from 'cesium';
import {
  createFinalizedMapStreamingCaptureEvidence,
  MAP_STREAMING_ROUTE,
  mapStreamingCaptureWorkloadFields,
  runNativeMapStreamingJourneyInPage,
  validateMapStreamingCaptureReport,
} from './mapStreamingCapture.mjs';
import { createMapStreamingFixtureDelivery } from './mapStreamingFixtureDelivery.mjs';
import { createDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
  resolveMapFixtureBuildProfile,
} from './buildProvenance.mjs';

function routeViewUnion(route) {
  const scene = {
    canvas: { clientWidth: 1440, clientHeight: 900 },
    drawingBufferWidth: 1440,
    drawingBufferHeight: 900,
    ellipsoid: Cesium.Ellipsoid.WGS84,
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    mode: Cesium.SceneMode.SCENE3D,
  };
  const camera = new Cesium.Camera(scene);
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      route.start.longitude,
      route.start.latitude,
      route.start.heightM,
    ),
    orientation: {
      heading: route.headingRadians,
      pitch: route.pitchRadians,
      roll: 0,
    },
  });
  const origin = Cesium.Cartesian3.clone(camera.positionWC);
  const right = Cesium.Cartesian3.clone(camera.rightWC);
  const direction = Cesium.Cartesian3.clone(camera.directionWC);
  const up = Cesium.Cartesian3.clone(camera.upWC);
  const result = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  for (let second = 0; second <= 60; second += 1) {
    const destination = Cesium.Cartesian3.add(
      origin,
      Cesium.Cartesian3.multiplyByScalar(
        right,
        second * route.moveRightMetersPerSecond,
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    camera.setView({ destination, orientation: { direction, up } });
    const view = camera.computeViewRectangle(Cesium.Ellipsoid.WGS84);
    assert.ok(view, `Route camera intersects the ellipsoid at ${second}s.`);
    result.west = Math.min(result.west, Cesium.Math.toDegrees(view.west));
    result.south = Math.min(result.south, Cesium.Math.toDegrees(view.south));
    result.east = Math.max(result.east, Cesium.Math.toDegrees(view.east));
    result.north = Math.max(result.north, Cesium.Math.toDegrees(view.north));
  }
  return result;
}

function nativeCameraRouteEndpoints(durationMs) {
  const scene = {
    canvas: { clientWidth: 1440, clientHeight: 900 },
    drawingBufferWidth: 1440,
    drawingBufferHeight: 900,
    ellipsoid: Cesium.Ellipsoid.WGS84,
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    mode: Cesium.SceneMode.SCENE3D,
  };
  const camera = new Cesium.Camera(scene);
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      MAP_STREAMING_ROUTE.start.longitude,
      MAP_STREAMING_ROUTE.start.latitude,
      MAP_STREAMING_ROUTE.start.heightM,
    ),
    orientation: {
      heading: MAP_STREAMING_ROUTE.headingRadians,
      pitch: MAP_STREAMING_ROUTE.pitchRadians,
      roll: 0,
    },
  });
  const origin = Cesium.Cartesian3.clone(camera.positionWC);
  const right = Cesium.Cartesian3.clone(camera.rightWC);
  const direction = Cesium.Cartesian3.clone(camera.directionWC);
  const up = Cesium.Cartesian3.clone(camera.upWC);
  const start = cameraObservation(camera);
  const destination = Cesium.Cartesian3.add(
    origin,
    Cesium.Cartesian3.multiplyByScalar(
      right,
      (durationMs * MAP_STREAMING_ROUTE.moveRightMetersPerSecond) / 1000,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  camera.setView({ destination, orientation: { direction, up } });
  return { start, end: cameraObservation(camera) };
}

function cameraObservation(camera) {
  const position = camera.positionCartographic;
  return {
    longitude: Cesium.Math.toDegrees(position.longitude),
    latitude: Cesium.Math.toDegrees(position.latitude),
    heightM: position.height,
    headingRadians: camera.heading,
    pitchRadians: camera.pitch,
  };
}

function createFakePage({ failStack = null, scheduleAtZero = true } = {}) {
  const listeners = new Set();
  const frames = new Map();
  let nextFrame = 0;
  let pageClock = 0;
  let activeStack = 'photoreal';
  let currentPosition = { x: 0, y: 0, z: 6_000 };
  const event = {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ellipsoid = {
    cartographicToCartesian({ longitude, latitude, height }) {
      const radius = 6_378_137 + height;
      return {
        x: radius * Math.cos(latitude) * Math.cos(longitude),
        y: radius * Math.cos(latitude) * Math.sin(longitude),
        z: radius * Math.sin(latitude),
      };
    },
  };
  const camera = {
    positionCartographic: {
      longitude: Cesium.Math.toRadians(-97.72),
      latitude: Cesium.Math.toRadians(30.27),
      height: 6_000,
    },
    positionWC: currentPosition,
    rightWC: {
      x: -Math.sin(Cesium.Math.toRadians(-97.72)),
      y: Math.cos(Cesium.Math.toRadians(-97.72)),
      z: 0,
    },
    directionWC: { x: 0, y: 0, z: -1 },
    upWC: { x: 1, y: 0, z: 0 },
    heading: 0,
    pitch: -Math.PI / 2,
    setView({ destination, orientation }) {
      currentPosition = { ...destination };
      this.positionWC = currentPosition;
      this.positionCartographic = {
        longitude: Math.atan2(destination.y, destination.x),
        latitude: Math.asin(
          destination.z /
            Math.hypot(destination.x, destination.y, destination.z),
        ),
        height:
          Math.hypot(destination.x, destination.y, destination.z) - 6_378_137,
      };
      if (orientation?.heading != null) this.heading = orientation.heading;
      if (orientation?.pitch != null) this.pitch = orientation.pitch;
      if (orientation?.direction) this.directionWC = orientation.direction;
      if (orientation?.up) this.upWC = orientation.up;
    },
    computeViewRectangle() {
      const { longitude, latitude } = this.positionCartographic;
      const halfWidth = Cesium.Math.toRadians(0.02);
      const halfHeight = Cesium.Math.toRadians(0.02);
      return new Cesium.Rectangle(
        longitude - halfWidth,
        latitude - halfHeight,
        longitude + halfWidth,
        latitude + halfHeight,
      );
    },
  };
  // Match the minified constructor names emitted by the production global Cesium bundle.
  const CesiumTypes = {
    CesiumTerrainProvider: class Sf {},
    EllipsoidTerrainProvider: class mZ {},
    ArcGisMapServerImageryProvider: class ap {},
    OpenStreetMapImageryProvider: class ZO {},
  };
  const terrainProvider = new CesiumTypes.CesiumTerrainProvider();
  const imageryLayers = {
    length: 1,
    get() {
      const imageryProvider =
        activeStack === 'osm'
          ? new CesiumTypes.OpenStreetMapImageryProvider()
          : new CesiumTypes.ArcGisMapServerImageryProvider();
      return {
        show: activeStack !== 'photoreal',
        imageryProvider,
      };
    },
  };
  const scene = {
    postRender: event,
    globe: {
      ellipsoid,
      show: activeStack !== 'photoreal',
      tilesLoaded: true,
      terrainProvider,
      maximumScreenSpaceError: 2,
      getHeight(point) {
        return 400 + ((point.longitude * 10) % 250);
      },
    },
    imageryLayers,
    msaaSamples: 4,
    postProcessStages: { fxaa: { enabled: false } },
    canvas: { clientWidth: 1440, clientHeight: 900 },
    context: { drawingBufferWidth: 1440, drawingBufferHeight: 900 },
    requestRender() {
      for (const listener of [...listeners]) listener();
    },
  };
  const controller = {
    getActiveId: () => activeStack,
    getState: () => ({
      status: 'ready',
      switchOrigin: 'manual',
      lastError: null,
    }),
    isStackAvailable: () => true,
    async setStack(stackId) {
      if (stackId === failStack)
        throw new Error(`controlled ${stackId} failure`);
      activeStack = stackId;
      scene.globe.show = stackId !== 'photoreal';
      return { activeId: stackId, lastError: null, switchOrigin: 'manual' };
    },
  };
  const app = {
    viewer: { scene, camera, resolutionScale: 1 },
    mapStackController: controller,
    tileset: {
      show: activeStack === 'photoreal',
      tilesLoaded: true,
      statistics: { numberOfTilesWithContentReady: 7, selected: 4 },
      maximumScreenSpaceError: 16,
      cacheBytes: 1536 * 1024 * 1024,
      maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    },
    styleManager: {
      _adaptiveQuality: { getMode: () => 'manual' },
      services: {
        getDetectionTuning: () => ({ densityPct: 75 }),
        getDetectionMode: () => 'DENSE',
      },
      getVisualState: () => ({
        style: 'normal',
        bloom: { enabled: false, intensity: 0, version: 'test-v1' },
        sharpen: { enabled: false, intensity: 0 },
        detection: {
          mode: 'DENSE',
          density: 75,
          allocation: 'stable',
          fadePct: 7,
          outsideOpacityPct: 0,
        },
        scope: { enabled: false, featherPct: 0 },
        hud: { visible: true, variant: 'full' },
        mapStack: activeStack,
        styleParams: {},
      }),
    },
  };
  const context = vm.createContext({
    window: {
      Cesium: CesiumTypes,
      __godsEyeView: app,
      __gevRecoveryEarlyRendererProbe: {
        contextAttributes: { antialias: true, preserveDrawingBuffer: false },
      },
    },
    AbortController,
    performance: { now: () => pageClock },
    setTimeout(callback, delay = 0) {
      if (delay > 1_000) {
        const timer = { cancelled: false, real: null };
        timer.real = setTimeout(() => {
          if (timer.cancelled) return;
          pageClock += delay;
          callback();
        }, 0);
        return timer;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout(timer) {
      if (timer && typeof timer === 'object') {
        timer.cancelled = true;
        clearTimeout(timer.real);
      } else clearTimeout(timer);
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      const timer = setTimeout(() => {
        frames.delete(id);
        pageClock += 5_000;
        callback(pageClock);
      }, 0);
      frames.set(id, timer);
      return id;
    },
    cancelAnimationFrame(id) {
      const timer = frames.get(id);
      if (timer) clearTimeout(timer);
      frames.delete(id);
    },
  });
  const serializedDriver = vm.runInContext(
    `(${runNativeMapStreamingJourneyInPage.toString()})`,
    context,
  );
  return {
    context,
    serializedDriver,
    listeners,
    frames,
    CesiumTypes,
    route: scheduleAtZero
      ? {
          ...MAP_STREAMING_ROUTE,
          durationLimitMs: 60_000,
          stackSchedule: MAP_STREAMING_ROUTE.stackSchedule.map((row) => ({
            ...row,
            atMs: 0,
          })),
        }
      : MAP_STREAMING_ROUTE,
  };
}

test('map camera route stays inside the declared corpus footprint at 1-second checkpoints', () => {
  const observed = routeViewUnion(MAP_STREAMING_ROUTE);
  const bounds = MAP_STREAMING_ROUTE.declaredBounds;
  assert.ok(observed.west >= bounds.west, `west ${observed.west} is covered`);
  assert.ok(
    observed.south >= bounds.south,
    `south ${observed.south} is covered`,
  );
  assert.ok(observed.east <= bounds.east, `east ${observed.east} is covered`);
  assert.ok(
    observed.north <= bounds.north,
    `north ${observed.north} is covered`,
  );
});

test('serialized native journey observes actual completed renders and returns measured settings', async () => {
  const harness = createFakePage({ scheduleAtZero: false });
  const result = await harness.serializedDriver({
    durationMs: 60_000,
    route: harness.route,
  });
  assert.deepEqual(
    Object.values(harness.CesiumTypes).map((Provider) => Provider.name),
    ['Sf', 'mZ', 'ap', 'ZO'],
    'The fixture deliberately models production-minified constructor names.',
  );
  assert.equal(result.transitions.length, 4);
  assert.equal(
    result.transitions[1].state.terrainProviderClass,
    'CesiumTerrainProvider',
  );
  assert.equal(
    result.transitions[1].state.imageryProviderClass,
    'ArcGisMapServerImageryProvider',
  );
  assert.equal(
    result.transitions[2].state.imageryProviderClass,
    'OpenStreetMapImageryProvider',
  );
  assert.equal(result.route.finalPostRenderObserved, true);
  assert.deepEqual(result.settingsAfter, result.settingsBefore);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('serialized native journey reads bloom and sharpen from the common visual snapshot', async () => {
  const harness = createFakePage();
  const app = harness.context.window.__godsEyeView;
  const getVisualState = app.styleManager.getVisualState;
  app.styleManager.getVisualState = () => ({
    ...getVisualState(),
    bloom: { enabled: true, intensity: 0.625, version: 'test-v1' },
    sharpen: { enabled: false, intensity: 23 },
  });
  assert.equal('bloomEnabled' in app.styleManager, false);
  assert.equal('bloomIntensity' in app.styleManager, false);
  assert.equal('sharpenEnabled' in app.styleManager, false);
  assert.equal('sharpenIntensity' in app.styleManager, false);

  const result = await harness.serializedDriver({
    durationMs: 60_000,
    route: harness.route,
  });
  assert.equal(result.settingsBefore.bloom, true);
  assert.equal(result.settingsBefore.bloomIntensity, 0.625);
  assert.equal(result.settingsBefore.sharpen, false);
  assert.equal(result.settingsBefore.sharpenIntensity, 23);
  assert.deepEqual(result.settingsAfter, result.settingsBefore);
});

test('serialized native journey rejects missing or non-finite visual intensities', async () => {
  for (const field of ['bloom', 'sharpen']) {
    for (const invalidIntensity of [undefined, Number.NaN]) {
      const harness = createFakePage();
      const app = harness.context.window.__godsEyeView;
      const getVisualState = app.styleManager.getVisualState;
      app.styleManager.getVisualState = () => {
        const visual = getVisualState();
        const visualField = { ...visual[field] };
        if (invalidIntensity === undefined) delete visualField.intensity;
        else visualField.intensity = invalidIntensity;
        return {
          ...visual,
          [field]: visualField,
        };
      };
      await assert.rejects(
        harness.serializedDriver({
          durationMs: 60_000,
          route: harness.route,
        }),
        /Native visual state is unavailable from the app observer\./,
        `${field} intensity ${String(invalidIntensity)} is rejected`,
      );
      assert.equal(harness.listeners.size, 0);
      assert.equal(harness.frames.size, 0);
    }
  }
});

test('transition failure cancels and drains the route sibling without leaving render callbacks', async () => {
  const harness = createFakePage({ failStack: 'esri-imagery' });
  await assert.rejects(
    harness.serializedDriver({ durationMs: 10_000, route: harness.route }),
    /controlled esri-imagery failure/,
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('map capture report binds real fixture hashes and acknowledged fixture delivery', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const profile = resolveMapFixtureBuildProfile(MAP_FIXTURE_BUILD_PROFILE_ID);
  const adapter = createMapStreamingFixtureDelivery(fixture, {
    appOrigin: 'http://127.0.0.1:4173/',
  });
  const key = getMapFixtureBuildProfileGoogleApiKey(profile.id);
  const requiredAssets = fixture.manifest.assets;
  for (const asset of requiredAssets) {
    let url;
    if (asset.path === 'tileset/tileset.json')
      url = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
    else if (asset.path.startsWith('tiles/')) {
      const match = asset.path.match(/^tiles\/(level-\d+\/\d+-\d+\.glb)$/);
      assert.ok(
        match,
        `Native Google content path ${asset.path} is canonical.`,
      );
      url = `https://tile.googleapis.com/v1/tiles/${match[1]}?key=${key}`;
    } else if (asset.path === 'google/credit-placeholder.png')
      url = 'https://assets.ion.cesium.com/google-credit.png';
    else if (asset.kind === 'arcgis-mapserver-metadata-json')
      url =
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json';
    else if (asset.kind === 'arcgis-missing-tile-probe-png') {
      const { level, row, column } = asset.identity;
      url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${row}/${column}`;
    } else if (asset.path.startsWith('terrain/')) {
      const tail = asset.path.slice('terrain/'.length);
      url = `https://terrain.reearth.land/cesium-mesh/ellipsoid/${tail}`;
    } else if (asset.path.startsWith('imagery/')) {
      const [, level, x, y] = asset.path.match(
        /^imagery\/(\d+)\/(\d+)\/(\d+)\.png$/,
      );
      url = `https://tile.openstreetmap.org/${level}/${x}/${y}.png`;
    }
    assert.ok(url, `Fixture asset ${asset.path} has a native request URL.`);
    const response = await adapter.respond(new URL(url), {
      url: () => url,
      method: () => 'GET',
    });
    assert.ok(response, `Native request ${url} resolves to fixture bytes.`);
    assert.equal(
      adapter.onFulfilled({
        url,
        method: 'GET',
        status: 200,
        bodyBase64: response.body.toString('base64'),
      }),
      true,
    );
  }
  adapter.cancel();
  const summary = adapter.dispose();
  const row = {
    documentRole: 'main-setup',
    documentId: 'map-document-1',
    sessionOrdinal: 1,
    delivery: summary,
    release: {
      documentRole: 'main-setup',
      documentId: 'map-document-1',
      sessionOrdinal: 1,
      confirmed: true,
      targetClosed: true,
      stop: {
        confirmed: true,
        pendingCommandsAfterDrain: 0,
        pendingPreparationsAfterDrain: 0,
        pendingAbortSubscriptionsAfterDrain: 0,
        unexpectedLateRequestCount: 0,
      },
      interception: { confirmed: true },
    },
  };
  const fixtureDelivery = {
    schema: summary.schema,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    status: 'observed',
    requestedCount: summary.requestedCount,
    fulfilledAckCount: summary.fulfilledAckCount,
    cancelledCount: summary.cancelledCount,
    pendingCount: summary.pendingCount,
    unexpectedFulfillmentCount: summary.unexpectedFulfillmentCount,
    errorObservationCount: summary.errorObservationCount,
    assets: summary.assets,
    cleanupConfirmed: true,
    browserDecodeObserved: false,
    renderedReadinessObserved: false,
  };
  const journeyHarness = createFakePage({ scheduleAtZero: false });
  const journey = await journeyHarness.serializedDriver({
    durationMs: 60_000,
    route: journeyHarness.route,
  });
  const nativeEndpoints = nativeCameraRouteEndpoints(60_000);
  journey.initialState.camera = nativeEndpoints.start;
  journey.finalState.camera = nativeEndpoints.end;
  journey.route.start = nativeEndpoints.start;
  journey.route.end = nativeEndpoints.end;
  const finalized = createFinalizedMapStreamingCaptureEvidence({
    fixture,
    journey,
    profile,
    documentDeliveries: [row],
  });
  const report = finalized.mapStreamingCapture;
  assert.deepEqual(finalized.fixtureDelivery, fixtureDelivery);
  assert.deepEqual(
    mapStreamingCaptureWorkloadFields(finalized),
    {
      mapStreamingCapture: report,
      mapStreamingFixtureDocuments: [row],
      performanceAcceptanceEligible: false,
    },
    'The actual finalizer projection is the workload shape serialized by capture CLI.',
  );
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(
    report.fixtureDelivery.assets.length,
    fixture.manifest.assets.length,
  );
  assert.ok(report.route.elapsedMs >= report.route.durationMs);

  const zeroCacheSettings = structuredClone(report);
  const settingsSnapshots = [
    zeroCacheSettings.settingsBefore,
    zeroCacheSettings.settingsAfter,
    zeroCacheSettings.initialState.settings,
    zeroCacheSettings.finalState.settings,
    ...zeroCacheSettings.transitions.map(
      (transition) => transition.state.settings,
    ),
  ];
  for (const settings of settingsSnapshots) {
    settings.tilesetCacheBytes = 0;
    settings.tilesetMaximumCacheOverflowBytes = 0;
  }
  assert.equal(
    validateMapStreamingCaptureReport(zeroCacheSettings, { fixture, profile }),
    true,
    'Valid observed zero cache limits remain representable.',
  );

  const emptySettings = structuredClone(report);
  emptySettings.settingsBefore = {};
  emptySettings.settingsAfter = {};
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(emptySettings, { fixture, profile }),
    /Before route quality mode is recognized/,
  );
  const zeroPhotorealSelection = structuredClone(report);
  zeroPhotorealSelection.initialState.photorealSelectedTiles = 0;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(zeroPhotorealSelection, {
        fixture,
        profile,
      }),
    /photorealSelectedTiles/,
  );

  const invalidOwnerRelease = structuredClone(report);
  invalidOwnerRelease.documentDeliveries[0].release.confirmed = false;
  invalidOwnerRelease.documentDeliveries[0].release.targetClosed = false;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(invalidOwnerRelease, {
        fixture,
        profile,
      }),
    /requires confirmed cleanup for all owner documents/,
  );

  const undrainedOwner = structuredClone(report);
  undrainedOwner.documentDeliveries[0].release.stop.pendingCommandsAfterDrain = 99;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(undrainedOwner, { fixture, profile }),
    /fixture commands drained/,
  );

  const modifiedTransitionSettings = structuredClone(report);
  modifiedTransitionSettings.transitions[1].state.settings.resolutionScale = 0.1;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(modifiedTransitionSettings, {
        fixture,
        profile,
      }),
    /Transition esri-imagery settings preserves/,
  );

  const alteredRouteStart = structuredClone(report);
  alteredRouteStart.route.start.longitude = 0;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(alteredRouteStart, {
        fixture,
        profile,
      }),
    /Observed route starts at the declared native camera pose/,
  );

  const alteredDeliveryAggregate = structuredClone(report);
  alteredDeliveryAggregate.fixtureDelivery.requestedCount += 100;
  alteredDeliveryAggregate.fixtureDelivery.fulfilledAckCount += 100;
  assert.throws(
    () =>
      validateMapStreamingCaptureReport(alteredDeliveryAggregate, {
        fixture,
        profile,
      }),
    /Aggregate fixture delivery is recomputed/,
  );
});
