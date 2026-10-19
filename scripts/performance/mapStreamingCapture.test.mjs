import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as Cesium from 'cesium';
import TweenCollection from '../../node_modules/@cesium/engine/Source/Scene/TweenCollection.js';
import { flyToAustin } from '../../src/camera.js';
import {
  createFinalizedMapStreamingCaptureEvidence,
  MAP_STREAMING_ROUTE,
  runNativeMapStreamingFaultControl,
  runNativeMapStreamingFaultControlInPage,
  validateMapStreamingFaultControlReport,
  mapStreamingCaptureWorkloadFields,
  runNativeMapStreamingJourney,
  runNativeMapStreamingJourneyInPage,
  validateMapStreamingJourneyEvidence,
  validateMapStreamingCaptureReport,
  projectMapStreamingJourneyFailureEvidence,
  createMapStreamingJourneyValidationFailureEvidence,
  projectMapStreamingJourneyValidationFailureEvidence,
} from './mapStreamingCapture.mjs';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import {
  attachMapStreamingJourneyFailureEvidence,
  compactCaptureCliFailure,
  projectMapStreamingJourneyFailureForSmoke,
  projectMapStreamingJourneyValidationFailureForSmoke,
  runNativeMapJourneyForSmoke,
} from '../qa-performance-build-smoke.mjs';
import { createMapStreamingFixtureDelivery } from './mapStreamingFixtureDelivery.mjs';
import { createDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
  resolveMapFixtureBuildProfile,
} from './buildProvenance.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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

function nativeStartupCamera() {
  const scene = {
    canvas: { clientWidth: 1440, clientHeight: 900 },
    drawingBufferWidth: 1440,
    drawingBufferHeight: 900,
    ellipsoid: Cesium.Ellipsoid.WGS84,
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    mode: Cesium.SceneMode.SCENE3D,
    tweens: new TweenCollection(),
    screenSpaceCameraController: {
      minimumZoomDistance: 1,
      maximumZoomDistance: 1_000_000_000,
    },
  };
  const camera = new Cesium.Camera(scene);
  scene.camera = camera;
  return { scene, camera, viewer: { camera, isDestroyed: () => false } };
}

function setDeclaredRoutePose(camera) {
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
}

function assertDeclaredRoutePose(camera) {
  const observed = cameraObservation(camera);
  assert.ok(Math.abs(observed.heightM - MAP_STREAMING_ROUTE.start.heightM) < 1);
  assert.ok(
    Math.abs(observed.longitude - MAP_STREAMING_ROUTE.start.longitude) < 1e-5,
  );
  assert.ok(
    Math.abs(observed.latitude - MAP_STREAMING_ROUTE.start.latitude) < 1e-5,
  );
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

function createFakePage({
  failStack = null,
  notReadyGlobeStack = null,
  scheduleAtZero = true,
  failPollCount = 0,
  failStartResponse = false,
  failCancel = false,
  failDispose = false,
  wrongCancelIdentity = false,
  wrongDisposeIdentity = false,
  blockFrames = false,
  pollDelayMs = 0,
  timerOvershootMs = 0,
  advancePageClockOnRenderMs = 0,
  holdCameraPreparation = false,
} = {}) {
  const listeners = new Set();
  const frames = new Map();
  const cameraEvents = [];
  const pendingCameraPreparationTimers = new Map();
  let cameraPreparationTimerSequence = 0;
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
      cameraEvents.push('setView');
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
    cancelFlight() {
      cameraEvents.push('cancelFlight');
    },
    flyTo() {
      cameraEvents.push('startupFlyTo');
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
    get length() {
      return activeStack === 'photoreal' ? 0 : 1;
    },
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
      _surface: {
        _tileLoadQueueHigh: [],
        _tileLoadQueueMedium: [],
        _tileLoadQueueLow: [],
        _tilesToRender: [],
      },
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
      pageClock += advancePageClockOnRenderMs;
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
      scene.globe.tilesLoaded = stackId !== notReadyGlobeStack;
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
      if (delay === MAP_STREAMING_ROUTE.startupFlightDelayMs) {
        const timer = { cancelled: false, callback, dueAt: pageClock + delay };
        const sequence = ++cameraPreparationTimerSequence;
        if (holdCameraPreparation && sequence === 2) {
          pendingCameraPreparationTimers.set(timer, callback);
        } else {
          queueMicrotask(() => {
            if (timer.cancelled) return;
            pageClock = Math.max(pageClock, timer.dueAt);
            callback();
          });
        }
        return timer;
      }
      if (delay > 1_000) {
        const timer = { cancelled: false, real: null };
        timer.real = setTimeout(() => {
          if (timer.cancelled) return;
          pageClock += delay + timerOvershootMs;
          callback();
        }, 0);
        return timer;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout(timer) {
      if (timer && typeof timer === 'object') {
        timer.cancelled = true;
        pendingCameraPreparationTimers.delete(timer);
        clearTimeout(timer.real);
      } else clearTimeout(timer);
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      if (blockFrames) {
        frames.set(id, null);
        return id;
      }
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
  context.setTimeout(
    () => camera.flyTo(),
    MAP_STREAMING_ROUTE.startupFlightDelayMs,
  );
  const serializedDriver = vm.runInContext(
    `(${runNativeMapStreamingJourneyInPage.toString()})`,
    context,
  );
  const pageCalls = [];
  let remainingPollFailures = failPollCount;
  let startResponseFailed = false;
  const page = {
    async evaluate(fn, args) {
      if (args?.command === 'cancel' && failCancel)
        throw new Error('simulated cancellation protocol failure');
      if (args?.command === 'dispose' && failDispose)
        throw new Error('simulated disposal protocol failure');
      if (args?.command === 'poll' && remainingPollFailures > 0) {
        remainingPollFailures -= 1;
        throw new Error('simulated per-command protocol timeout');
      }
      if (args?.command === 'poll' && pollDelayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      const startedAt = Date.now();
      const pageFunction = vm.runInContext(`(${fn.toString()})`, context);
      let value = await pageFunction(args);
      if (args?.command === 'cancel' && wrongCancelIdentity)
        value = { ...value, operationId: 'foreign-operation' };
      if (args?.command === 'dispose' && wrongDisposeIdentity)
        value = { ...value, operationId: 'foreign-operation' };
      if (
        args?.command === 'start' &&
        failStartResponse &&
        !startResponseFailed
      ) {
        startResponseFailed = true;
        throw new Error('simulated start response timeout');
      }
      pageCalls.push({
        command: args?.command,
        elapsedMs: Date.now() - startedAt,
      });
      return value;
    },
  };
  return {
    context,
    serializedDriver,
    page,
    pageCalls,
    listeners,
    frames,
    cameraEvents,
    pendingCameraPreparationTimers,
    fireHeldCameraPreparation() {
      const entry = [...pendingCameraPreparationTimers.entries()][0];
      if (!entry) return false;
      const [timer, callback] = entry;
      pendingCameraPreparationTimers.delete(timer);
      if (timer.cancelled) return false;
      pageClock = Math.max(pageClock, timer.dueAt);
      callback();
      return true;
    },
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

function createMapFaultControlHarness({
  scenarioId,
  fixture,
  renderDuringPreparation = false,
  deferRequestedRender = false,
}) {
  const declaredFaultAssetPath = fixture.manifest.assets.find(
    (asset) => asset.kind === 'arcgis-mapserver-metadata-json',
  )?.path;
  assert.equal(typeof declaredFaultAssetPath, 'string');
  const listeners = new Set();
  const types = {
    Cartesian3: {
      fromDegrees: (longitude, latitude, height) => ({
        longitude,
        latitude,
        height,
      }),
    },
    CesiumTerrainProvider: class Terrain {},
    EllipsoidTerrainProvider: class Ellipsoid {},
    ArcGisMapServerImageryProvider: class ArcGis {},
    OpenStreetMapImageryProvider: class OSM {},
  };
  let activeStack = 'photoreal';
  let origin = 'manual';
  let status = 'ready';
  let lastError = null;
  let generation = 0;
  let renderSequence = 0;
  let resolveFirstEsri;
  const firstEsriGate = new Promise((resolve) => {
    resolveFirstEsri = resolve;
  });
  const render = () => {
    renderSequence += 1;
    for (const listener of [...listeners]) listener();
  };
  const controller = {
    getActiveId: () => activeStack,
    getSwitchGeneration: () => generation,
    getState: () => ({ status, switchOrigin: origin, lastError }),
    async setStack(stackId) {
      const ownGeneration = ++generation;
      status = 'switching';
      origin = 'manual';
      lastError = null;
      if (stackId === 'esri-imagery' && ownGeneration === 1) {
        if (scenarioId === 'esri-metadata-superseded-v1') await firstEsriGate;
        else {
          activeStack = 'osm';
          origin = 'automatic';
          status = 'ready';
          lastError = 'declared fixture metadata fault';
          scene.globe.show = true;
          scene.globe.terrainProvider = new types.CesiumTerrainProvider();
          app.tileset.show = false;
          render();
          return this.getState();
        }
      }
      if (ownGeneration !== generation) return this.getState();
      activeStack = stackId;
      origin = 'manual';
      status = 'ready';
      lastError = null;
      scene.globe.show = stackId !== 'photoreal';
      scene.globe.terrainProvider =
        stackId === 'photoreal'
          ? new types.EllipsoidTerrainProvider()
          : new types.CesiumTerrainProvider();
      app.tileset.show = stackId === 'photoreal';
      render();
      return this.getState();
    },
  };
  const imageryLayers = {
    get length() {
      return activeStack === 'photoreal' ? 0 : 1;
    },
    get: () => ({
      show: activeStack !== 'photoreal',
      imageryProvider:
        activeStack === 'osm'
          ? new types.OpenStreetMapImageryProvider()
          : new types.ArcGisMapServerImageryProvider(),
    }),
  };
  const camera = {
    positionCartographic: {
      longitude: (-97.72 * Math.PI) / 180,
      latitude: (30.27 * Math.PI) / 180,
      height: renderDuringPreparation ? 24_000 : 6_000,
    },
    heading: 0,
    pitch: -Math.PI / 2,
    cancelFlight() {},
    setView({ destination }) {
      this.positionCartographic = {
        longitude: (destination.longitude * Math.PI) / 180,
        latitude: (destination.latitude * Math.PI) / 180,
        height: destination.height,
      };
    },
  };
  const scene = {
    postRender: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
    globe: {
      show: activeStack !== 'photoreal',
      tilesLoaded: true,
      terrainProvider: new types.EllipsoidTerrainProvider(),
      maximumScreenSpaceError: 2,
    },
    imageryLayers,
    msaaSamples: 4,
    postProcessStages: { fxaa: { enabled: false } },
    context: {
      drawingBufferWidth: 1440,
      drawingBufferHeight: 900,
      _gl: {
        getContextAttributes: () => ({
          antialias: true,
          preserveDrawingBuffer: true,
        }),
      },
    },
    requestRender() {
      if (!deferRequestedRender) render();
    },
  };
  let qualityMode = 'auto';
  let densityPct = 50;
  let detectionMode = 'OFF';
  const qualityControl = {
    value: 'auto',
    dispatchEvent() {
      qualityMode = this.value;
    },
  };
  const densityControl = {
    value: '50',
    dispatchEvent() {
      densityPct = Number(this.value);
    },
  };
  const app = {
    viewer: { scene, camera, resolutionScale: 1 },
    mapStackController: controller,
    tileset: {
      show: true,
      tilesLoaded: true,
      maximumScreenSpaceError: 16,
      cacheBytes: 1536 * 1024 * 1024,
      maximumCacheOverflowBytes: 1024 * 1024 * 1024,
      statistics: { numberOfTilesWithContentReady: 4, selected: 2 },
    },
    styleManager: {
      _adaptiveQuality: {
        getMode: () => qualityMode,
        setMode: (mode) => {
          qualityMode = mode;
        },
      },
      services: {
        getDetectionTuning: () => ({ densityPct }),
        getDetectionMode: () => detectionMode,
        setDetectionModeByLabel: (mode) => {
          detectionMode = mode;
        },
      },
      async applyVisualState(state) {
        if (state.style !== 'normal') throw new Error('unexpected style');
        if (state.detection?.mode !== 'DENSE')
          throw new Error('unexpected detection mode');
      },
      getVisualState: () => ({
        style: 'normal',
        bloom: { enabled: false, intensity: 0 },
        sharpen: { enabled: false, intensity: 0 },
        detection: { mode: detectionMode, density: densityPct },
        scope: { enabled: false },
        mapStack: activeStack,
        styleParams: {},
      }),
    },
  };
  let now = 0;
  const context = vm.createContext({
    window: { Cesium: types, __godsEyeView: app },
    document: {
      getElementById(id) {
        return id === 'presentation-quality-mode'
          ? qualityControl
          : id === 'detection-density-slider'
            ? densityControl
            : null;
      },
    },
    Event: class EventMock {},
    performance: { now: () => ++now },
    setTimeout(callback, delay = 0) {
      now += delay;
      if (
        renderDuringPreparation &&
        delay === MAP_STREAMING_ROUTE.startupFlightDelayMs
      )
        render();
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
  });
  const page = {
    async evaluate(fn, args) {
      return vm.runInContext(`(${fn.toString()})`, context)(args);
    },
  };
  const delivery = {
    released: false,
    async waitForFaultRequest() {
      return true;
    },
    releaseFaultResponse() {
      this.released = true;
      resolveFirstEsri();
      return true;
    },
    summary() {
      return {
        schema: 'gev-map-streaming-fixture-delivery/v1',
        status: 'active',
        pendingCount:
          scenarioId === 'esri-metadata-superseded-v1' && !this.released
            ? 1
            : 0,
        faultInjection: {
          assetPath: declaredFaultAssetPath,
          requestId: 'page-fault-test-4',
          heldRequestCount:
            scenarioId === 'esri-metadata-superseded-v1' && !this.released
              ? 1
              : 0,
        },
      };
    },
  };
  return {
    page,
    delivery,
    listeners,
    context,
    flushRender: render,
  };
}

function nativeFaultAssetUrl(asset, googleKey) {
  if (asset.kind === 'arcgis-mapserver-metadata-json')
    return 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json';
  if (asset.kind === 'arcgis-missing-tile-probe-png') {
    const { level, row, column } = asset.identity;
    return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${row}/${column}`;
  }
  if (asset.kind === 'webmercator-imagery-png') {
    const [, level, column, row] = asset.path.match(
      /^imagery\/(\d+)\/(\d+)\/(\d+)\.png$/,
    );
    return `https://tile.openstreetmap.org/${level}/${column}/${row}.png`;
  }
  if (asset.kind === 'quantized-mesh-layer-metadata')
    return 'https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json';
  if (asset.kind === 'quantized-mesh-1.0')
    return `https://terrain.reearth.land/cesium-mesh/ellipsoid/${asset.path.slice('terrain/'.length)}`;
  if (asset.kind === '3d-tiles-1.1')
    return new Cesium.Resource({
      url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
      queryParameters: { key: googleKey },
    }).url;
  if (asset.kind === 'textured-glb') {
    const root = new Cesium.Resource({
      url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
      queryParameters: { key: googleKey },
    });
    return root.getDerivedResource({ url: `../${asset.path}` }).url;
  }
  if (asset.kind === 'synthetic-google-credit-placeholder-png')
    return 'https://assets.ion.cesium.com/google-credit.png';
  throw new Error(`Unmapped native map asset kind ${asset.kind}`);
}

async function buildValidFaultDeliverySummary(fixture, scenarioId) {
  const adapter = createMapStreamingFixtureDelivery(fixture, {
    appOrigin: 'http://127.0.0.1:4173/',
    faultScenarioId: scenarioId,
  });
  const requiredKinds = [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ];
  const rows = requiredKinds.map((kind) =>
    fixture.manifest.assets.find((asset) => asset.kind === kind),
  );
  assert.ok(rows.every(Boolean));
  const googleKey = getMapFixtureBuildProfileGoogleApiKey(
    MAP_FIXTURE_BUILD_PROFILE_ID,
  );
  let requestOrdinal = 0;
  let held = null;
  for (const asset of rows) {
    const url = nativeFaultAssetUrl(asset, googleKey);
    const requestId = `page-fault-test-${++requestOrdinal}`;
    const responsePromise = adapter.respond(new URL(url), {
      requestId,
      url: () => url,
      method: () => 'GET',
    });
    if (
      scenarioId === 'esri-metadata-superseded-v1' &&
      asset.kind === 'arcgis-mapserver-metadata-json'
    ) {
      await adapter.waitForFaultRequest({ timeoutMs: 1_000 });
      held = { responsePromise, requestId, url };
      continue;
    }
    const response = await responsePromise;
    assert.ok(response);
    assert.equal(
      adapter.onFulfilled({
        requestId,
        url,
        method: 'GET',
        status: response.status,
        bodyBase64: response.body.toString('base64'),
      }),
      true,
    );
  }
  if (held) {
    assert.equal(adapter.releaseFaultResponse(), true);
    const response = await held.responsePromise;
    assert.equal(
      adapter.onFulfilled({
        requestId: held.requestId,
        url: held.url,
        method: 'GET',
        status: response.status,
        bodyBase64: response.body.toString('base64'),
      }),
      true,
    );
  }
  const summary = adapter.dispose();
  const declaredFaultAssetPath = fixture.manifest.assets.find(
    (asset) => asset.kind === 'arcgis-mapserver-metadata-json',
  )?.path;
  assert.equal(summary.faultInjection?.assetPath, declaredFaultAssetPath);
  return summary;
}

function makeTerrainChain(seed) {
  const parity = seed % 2;
  let parent = {
    _x: parity,
    _y: 0,
    _level: 0,
    state: 1,
    parent: null,
    data: {
      terrainState: 0,
      mesh: {},
      terrainData: { _mesh: {}, canUpsample: true },
    },
  };
  let x = parity;
  let y = 0;
  for (let level = 1; level <= 23; level += 1) {
    x = x * 2 + parity;
    y *= 2;
    parent = {
      _x: x,
      _y: y,
      _level: level,
      state: 1,
      parent,
      data: {
        terrainState: level % 7,
        mesh: {},
        terrainData: { _mesh: {}, canUpsample: true },
      },
    };
  }
  return parent;
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

test('serialized map fault owner observes explicit retry recovery and supersession', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  for (const scenarioId of [
    'esri-metadata-missing-v1',
    'esri-metadata-corrupt-v1',
    'esri-metadata-superseded-v1',
  ]) {
    const harness = createMapFaultControlHarness({ scenarioId, fixture });
    const report = await runNativeMapStreamingFaultControl(harness.page, {
      scenarioId,
      route: MAP_STREAMING_ROUTE,
      delivery: harness.delivery,
      operationTimeoutMs: 15_000,
    });
    assert.equal(report.status, 'observed');
    assert.equal(report.performanceAcceptanceEligible, false);
    assert.equal(report.initial.activeStack, 'photoreal');
    assert.equal(report.transitions.length, 2);
    assert.equal(report.operationRetirement.status, 'disposed');
    report.delivery = await buildValidFaultDeliverySummary(fixture, scenarioId);
    assert.equal(validateMapStreamingFaultControlReport(report, fixture), true);
    assert.equal(harness.listeners.size, 0);
    assert.equal(
      harness.context.window.__gevMapStreamingFaultControlV1,
      undefined,
    );
    if (scenarioId === 'esri-metadata-superseded-v1') {
      assert.equal(harness.delivery.released, true);
      assert.equal(report.final.activeStack, 'osm');
      assert.equal(report.switchOutcomes.initialEsri.activeStack, 'osm');
      const staleGeneration = structuredClone(report);
      staleGeneration.switchInvocations.supersedingOsm.generationAfterStart =
        staleGeneration.switchInvocations.initialEsri.generationAfterStart;
      assert.throws(() =>
        validateMapStreamingFaultControlReport(staleGeneration, fixture),
      );
      const preReleaseFrame = structuredClone(report);
      preReleaseFrame.final.postRenderSequence =
        preReleaseFrame.transitions[0].postRenderSequence;
      assert.throws(() =>
        validateMapStreamingFaultControlReport(preReleaseFrame, fixture),
      );
      const finalNotLastTransition = structuredClone(report);
      finalNotLastTransition.final = structuredClone(
        finalNotLastTransition.transitions[0],
      );
      assert.throws(() =>
        validateMapStreamingFaultControlReport(finalNotLastTransition, fixture),
      );
      const nonMonotonicTransitions = structuredClone(report);
      nonMonotonicTransitions.transitions[1].postRenderSequence =
        nonMonotonicTransitions.transitions[0].postRenderSequence;
      nonMonotonicTransitions.final = structuredClone(
        nonMonotonicTransitions.transitions[1],
      );
      assert.throws(() =>
        validateMapStreamingFaultControlReport(
          nonMonotonicTransitions,
          fixture,
        ),
      );
    } else {
      assert.equal(report.transitions[0].activeStack, 'osm');
      assert.equal(report.transitions[0].hasError, true);
      assert.equal(report.final.activeStack, 'esri-imagery');
      assert.equal(report.switchOutcomes.retryEsri.activeStack, 'esri-imagery');
      const missingSettings = structuredClone(report);
      delete missingSettings.settingsBefore.msaaSamples;
      assert.throws(() =>
        validateMapStreamingFaultControlReport(missingSettings, fixture),
      );
      const wrongProvider = structuredClone(report);
      wrongProvider.transitions[1].imageryProviderClass =
        'OpenStreetMapImageryProvider';
      assert.throws(() =>
        validateMapStreamingFaultControlReport(wrongProvider, fixture),
      );
      const wrongInitialTerrain = structuredClone(report);
      wrongInitialTerrain.initial.terrainProviderClass =
        'CesiumTerrainProvider';
      assert.throws(() =>
        validateMapStreamingFaultControlReport(wrongInitialTerrain, fixture),
      );
      const wrongRecoveryTerrain = structuredClone(report);
      wrongRecoveryTerrain.transitions[1].terrainProviderClass =
        'EllipsoidTerrainProvider';
      wrongRecoveryTerrain.final.terrainProviderClass =
        'EllipsoidTerrainProvider';
      assert.throws(() =>
        validateMapStreamingFaultControlReport(wrongRecoveryTerrain, fixture),
      );
      const wrongPose = structuredClone(report);
      wrongPose.final.camera.longitude = 0;
      assert.throws(() =>
        validateMapStreamingFaultControlReport(wrongPose, fixture),
      );
    }
  }
});

test('map fault initial readiness discards startup-pose frames before fixed-pose boundary', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const harness = createMapFaultControlHarness({
    scenarioId: 'esri-metadata-missing-v1',
    fixture,
    renderDuringPreparation: true,
  });
  const report = await runNativeMapStreamingFaultControl(harness.page, {
    scenarioId: 'esri-metadata-missing-v1',
    route: MAP_STREAMING_ROUTE,
    delivery: harness.delivery,
    operationTimeoutMs: 15_000,
  });
  report.delivery = await buildValidFaultDeliverySummary(
    fixture,
    'esri-metadata-missing-v1',
  );
  assert.equal(report.preparation.poseEstablishedAtRenderSequence, 1);
  assert.ok(
    report.initial.postRenderSequence >
      report.preparation.poseEstablishedAtRenderSequence,
  );
  assert.equal(
    report.initial.camera.heightM,
    MAP_STREAMING_ROUTE.start.heightM,
  );
  assert.equal(validateMapStreamingFaultControlReport(report, fixture), true);

  const staleBoundary = structuredClone(report);
  staleBoundary.initial.postRenderSequence =
    staleBoundary.preparation.poseEstablishedAtRenderSequence;
  assert.throws(
    () => validateMapStreamingFaultControlReport(staleBoundary, fixture),
    /after the fixed pose/,
  );
  assert.equal(harness.listeners.size, 0);
});

test('fault switching stays blocked until a separately delivered post-pose render', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const harness = createMapFaultControlHarness({
    scenarioId: 'esri-metadata-missing-v1',
    fixture,
    renderDuringPreparation: true,
    deferRequestedRender: true,
  });
  const operationId = 'map-fault-post-pose-render-gate';
  const prepared = await harness.page.evaluate(
    runNativeMapStreamingFaultControlInPage,
    {
      command: 'prepare',
      operationId,
      route: MAP_STREAMING_ROUTE,
    },
  );
  assert.equal(prepared.preparation.poseEstablishedAtRenderSequence, 1);
  let poll = await harness.page.evaluate(
    runNativeMapStreamingFaultControlInPage,
    {
      command: 'poll',
      operationId,
      route: MAP_STREAMING_ROUTE,
    },
  );
  assert.equal(poll.renderCount, 1);
  assert.equal(poll.latest, null);
  await assert.rejects(
    harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
      command: 'begin-esri',
      operationId,
      route: MAP_STREAMING_ROUTE,
    }),
    /completed render after the fixed pose/,
  );
  assert.equal(
    harness.context.window.__godsEyeView.mapStackController.getSwitchGeneration(),
    0,
  );

  harness.flushRender();
  poll = await harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
    command: 'poll',
    operationId,
    route: MAP_STREAMING_ROUTE,
  });
  assert.ok(
    poll.latest.postRenderSequence >
      prepared.preparation.poseEstablishedAtRenderSequence,
  );
  assert.equal(poll.latest.camera.heightM, MAP_STREAMING_ROUTE.start.heightM);
  const started = await harness.page.evaluate(
    runNativeMapStreamingFaultControlInPage,
    { command: 'begin-esri', operationId, route: MAP_STREAMING_ROUTE },
  );
  assert.equal(started.status, 'switch-started');
  await Promise.resolve();
  await Promise.resolve();
  const disposed = await harness.page.evaluate(
    runNativeMapStreamingFaultControlInPage,
    { command: 'dispose', operationId, route: MAP_STREAMING_ROUTE },
  );
  assert.equal(disposed.status, 'disposed');
  assert.equal(harness.listeners.size, 0);
});

test('map supersession can start only while the initial Esri switch is still pending', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const harness = createMapFaultControlHarness({
    scenarioId: 'esri-metadata-superseded-v1',
    fixture,
  });
  await harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
    command: 'prepare',
    operationId: 'map-fault-too-late-supersession',
    route: MAP_STREAMING_ROUTE,
  });
  await harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
    command: 'begin-esri',
    operationId: 'map-fault-too-late-supersession',
    route: MAP_STREAMING_ROUTE,
  });
  harness.delivery.releaseFaultResponse();
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(
    harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
      command: 'begin-osm',
      operationId: 'map-fault-too-late-supersession',
      route: MAP_STREAMING_ROUTE,
    }),
    /initial Esri request to remain pending/,
  );
});

test('map fault control rejects an altered preserve-drawing-buffer setting', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const harness = createMapFaultControlHarness({
    scenarioId: 'esri-metadata-missing-v1',
    fixture,
  });
  harness.context.window.__godsEyeView.viewer.scene.context._gl.getContextAttributes =
    () => ({ antialias: true, preserveDrawingBuffer: false });
  await assert.rejects(
    harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
      command: 'prepare',
      operationId: 'map-fault-invalid-buffer-setting',
      route: MAP_STREAMING_ROUTE,
    }),
    /visual settings are incomplete/,
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(
    Object.keys(harness.context.window.__gevMapStreamingFaultControlV1 || {})
      .length,
    0,
  );
});

test('serialized map fault owner rejects a route mutation before retaining page state', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const harness = createMapFaultControlHarness({
    scenarioId: 'esri-metadata-missing-v1',
    fixture,
  });
  await assert.rejects(
    harness.page.evaluate(runNativeMapStreamingFaultControlInPage, {
      command: 'prepare',
      operationId: 'map-fault-invalid-route',
      route: { ...MAP_STREAMING_ROUTE, headingRadians: 1 },
    }),
    /declared route/,
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(
    harness.context.window.__gevMapStreamingFaultControlV1,
    undefined,
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
  assert.equal(result.route.startupFlightDelayMs, 500);
  assert.ok(result.route.startupFlightPreparationElapsedMs >= 500);
  assert.equal(result.route.startupFlightCancelled, true);
  assert.deepEqual(harness.cameraEvents.slice(0, 3), [
    'startupFlyTo',
    'cancelFlight',
    'setView',
  ]);
  assert.deepEqual(result.settingsAfter, result.settingsBefore);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('host journey polls a full 60-second page operation through short protocol calls', async () => {
  const harness = createFakePage({ scheduleAtZero: false });
  const result = await runNativeMapStreamingJourney(harness.page, {
    durationMs: 60_000,
    route: harness.route,
  });
  assert.equal(result.route.durationMs, 60_000);
  assert.equal(result.route.startupFlightDelayMs, 500);
  assert.ok(result.route.startupFlightPreparationElapsedMs >= 500);
  assert.equal(result.route.startupFlightCancelled, true);
  assert.equal(result.route.finalPostRenderObserved, true);
  assert.equal(harness.pageCalls[0].command, 'start');
  assert.ok(harness.pageCalls.some((call) => call.command === 'poll'));
  assert.equal(harness.pageCalls.at(-1).command, 'dispose');
  assert.ok(harness.pageCalls.every((call) => call.elapsedMs < 15_000));
  assert.equal(
    harness.context.window.__gevMapStreamingJourneyV1,
    undefined,
    'The terminal operation registry is removed after result transfer.',
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('serialized native map journey retains full DPR through its deferred run', async () => {
  for (const dpr of [2, 1.25]) {
    const harness = createFakePage({ scheduleAtZero: false });
    const window = harness.context.window;
    const scene = window.__godsEyeView.viewer.scene;
    window.devicePixelRatio = dpr;
    scene.canvas.width = scene.context.drawingBufferWidth = Math.floor(
      1440 * dpr,
    );
    scene.canvas.height = scene.context.drawingBufferHeight = Math.floor(
      900 * dpr,
    );
    const result = await runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
      comparisonProfile: 'native-sharpness-v1',
    });
    assert.equal(
      result.settingsBefore.nativeSharpnessProfile.viewport.dpr,
      dpr,
    );
    assert.equal(
      result.settingsBefore.nativeSharpnessProfile.drawingBuffer.width,
      Math.floor(1440 * dpr),
    );
    assert.deepEqual(result.settingsAfter, result.settingsBefore);
    assert.equal(result.transitions.length, 4);
    assert.ok(
      result.transitions.every(
        ({ state }) =>
          state.viewport.drawingBufferWidth === Math.floor(1440 * dpr),
      ),
    );
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.frames.size, 0);
  }
});

test('native map journey rejects downscaled buffers and changing native settings', async () => {
  for (const fault of ['downscale', 'dpr', 'sse', 'resolution', 'canvas']) {
    const harness = createFakePage({ scheduleAtZero: false });
    const window = harness.context.window;
    const viewer = window.__godsEyeView.viewer;
    const scene = viewer.scene;
    window.devicePixelRatio = 2;
    scene.canvas.width = scene.context.drawingBufferWidth =
      fault === 'downscale' ? 1440 : 2880;
    scene.canvas.height = scene.context.drawingBufferHeight =
      fault === 'downscale' ? 900 : 1800;
    const render = scene.requestRender;
    let renders = 0;
    scene.requestRender = () => {
      if (++renders === 3) {
        if (fault === 'dpr') window.devicePixelRatio = 1.25;
        if (fault === 'sse') scene.globe.maximumScreenSpaceError = 2;
        if (fault === 'resolution') viewer.resolutionScale = 0.5;
        if (fault === 'canvas') scene.canvas.width = 1440;
      }
      render();
    };
    await assert.rejects(
      runNativeMapStreamingJourney(harness.page, {
        durationMs: 60_000,
        route: harness.route,
        comparisonProfile: 'native-sharpness-v1',
      }),
      /drawing buffer changed|native sharpness settings changed/,
    );
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.frames.size, 0);
  }
});

test('camera preparation cancels a pending startup flight before the route pose', async () => {
  const harness = createFakePage({ holdCameraPreparation: true });
  const operationId = 'map-camera-preparation-cancel';
  await harness.serializedDriver({
    command: 'start',
    operationId,
    durationMs: 60_000,
    route: harness.route,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.pendingCameraPreparationTimers.size, 1);
  assert.deepEqual(harness.cameraEvents, ['startupFlyTo']);

  const cancelPending = harness.serializedDriver({
    command: 'cancel',
    operationId,
  });
  assert.equal(harness.pendingCameraPreparationTimers.size, 1);
  assert.equal(harness.fireHeldCameraPreparation(), true);
  const cancelled = await cancelPending;
  assert.equal(cancelled.status, 'failed');
  assert.equal(cancelled.drainStatus, 'drained');
  assert.equal(harness.pendingCameraPreparationTimers.size, 0);
  assert.equal(harness.fireHeldCameraPreparation(), false);
  assert.deepEqual(harness.cameraEvents, ['startupFlyTo', 'cancelFlight']);

  const terminal = await harness.serializedDriver({
    command: 'poll',
    operationId,
  });
  assert.equal(terminal.checkpoint.phase, 'camera-preparation');
  assert.equal(terminal.checkpoint.cameraPreparationElapsedMs, null);
  assert.equal(terminal.checkpoint.startupFlightCancelled, true);
  assert.equal(harness.cameraEvents.includes('setView'), false);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.pendingCameraPreparationTimers.size, 0);
  assert.equal(
    (await harness.serializedDriver({ command: 'dispose', operationId }))
      .status,
    'disposed',
  );
});

test('the pinned Cesium startup flight needs the full pending interval before route ownership', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const negative = nativeStartupCamera();
  const disposeNegative = flyToAustin(negative.viewer);
  negative.camera.cancelFlight();
  setDeclaredRoutePose(negative.camera);
  t.mock.timers.tick(MAP_STREAMING_ROUTE.startupFlightDelayMs);
  assert.equal(negative.scene.tweens.length, 1);
  negative.scene.tweens.update(0);
  negative.scene.tweens.update(1_000);
  assert.ok(
    Math.abs(
      cameraObservation(negative.camera).heightM -
        MAP_STREAMING_ROUTE.start.heightM,
    ) > 1_000,
    'cancelFlight alone cannot cancel a startup callback that has not fired.',
  );
  disposeNegative();
  assert.equal(negative.scene.tweens.length, 0);

  const retired = nativeStartupCamera();
  const disposeRetired = flyToAustin(retired.viewer);
  disposeRetired();
  t.mock.timers.tick(MAP_STREAMING_ROUTE.startupFlightDelayMs);
  assert.equal(retired.scene.tweens.length, 0);
  assert.ok(cameraObservation(retired.camera).heightM > 20_000);

  const pending = nativeStartupCamera();
  const disposePending = flyToAustin(pending.viewer);
  const pendingPreparation = new Promise((resolve) =>
    setTimeout(resolve, MAP_STREAMING_ROUTE.startupFlightDelayMs),
  );
  t.mock.timers.tick(MAP_STREAMING_ROUTE.startupFlightDelayMs);
  await pendingPreparation;
  assert.equal(pending.scene.tweens.length, 1);
  pending.camera.cancelFlight();
  setDeclaredRoutePose(pending.camera);
  pending.scene.tweens.update(0);
  pending.scene.tweens.update(2_000);
  assertDeclaredRoutePose(pending.camera);
  disposePending();
  assert.equal(pending.scene.tweens.length, 0);

  const active = nativeStartupCamera();
  const disposeActive = flyToAustin(active.viewer);
  t.mock.timers.tick(MAP_STREAMING_ROUTE.startupFlightDelayMs);
  active.scene.tweens.update();
  active.scene.tweens.update();
  assert.equal(active.scene.tweens.length, 1);
  const activePreparation = new Promise((resolve) =>
    setTimeout(resolve, MAP_STREAMING_ROUTE.startupFlightDelayMs),
  );
  t.mock.timers.tick(MAP_STREAMING_ROUTE.startupFlightDelayMs);
  await activePreparation;
  active.camera.cancelFlight();
  setDeclaredRoutePose(active.camera);
  active.scene.tweens.update(1_000);
  assertDeclaredRoutePose(active.camera);
  disposeActive();
  t.mock.timers.tick(5_000);
  assertDeclaredRoutePose(active.camera);
  assert.equal(active.scene.tweens.length, 0);
});

test('host protocol failure cancels and drains the page operation without losing its checkpoint', async () => {
  const harness = createFakePage({ failPollCount: 1 });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.match(error.message, /simulated per-command protocol timeout/);
      assert.ok(
        [
          'initial-readiness',
          'transition',
          'transition-readiness',
          'route',
          'final-readiness',
          'completed',
        ].includes(error.actual?.phase),
      );
      assert.equal(typeof error.actual?.initialReadinessComplete, 'boolean');
      assert.equal(typeof error.actual?.transitionCount, 'number');
      return true;
    },
  );
  assert.ok(harness.pageCalls.some((call) => call.command === 'cancel'));
  assert.equal(harness.pageCalls.at(-1).command, 'dispose');
  assert.equal(
    harness.context.window.__gevMapStreamingJourneyV1,
    undefined,
    'Cancellation drains before the operation state is disposed.',
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('host journey uses a monotonic elapsed deadline when individual polls are slow', async () => {
  const harness = createFakePage({ blockFrames: true, pollDelayMs: 45 });
  const startedAt = performance.now();
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
      hostDeadlineMs: 120,
    }),
    (error) => {
      assert.match(error.message, /monotonic host deadline/);
      assert.equal(
        error.mapStreamingJourneyFailure?.failureCode,
        'host-deadline',
      );
      assert.equal(
        error.mapStreamingJourneyFailure?.retirement?.drainStatus,
        'drained',
      );
      assert.equal(
        error.mapStreamingJourneyFailure?.retirement?.disposeStatus,
        'confirmed',
      );
      assert.ok(error.mapStreamingJourneyFailure.elapsedMs >= 100);
      assert.ok(error.mapStreamingJourneyFailure.elapsedMs < 1_000);
      assert.ok(
        [
          'initial-readiness',
          'transition',
          'transition-readiness',
          'route',
          'final-readiness',
        ].includes(error.mapStreamingJourneyFailure.checkpoint.phase),
      );
      return true;
    },
  );
  assert.ok(performance.now() - startedAt < 1_000);
  assert.equal(harness.context.window.__gevMapStreamingJourneyV1, undefined);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('host start response failure retires an operation that was accepted by the page', async () => {
  const harness = createFakePage({ failStartResponse: true });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    /simulated start response timeout/,
  );
  assert.ok(harness.pageCalls.some((call) => call.command === 'cancel'));
  assert.equal(harness.pageCalls.at(-1).command, 'dispose');
  assert.equal(harness.context.window.__gevMapStreamingJourneyV1, undefined);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('host failure report records unconfirmed cancellation and leaves ownership to page close', async () => {
  const harness = createFakePage({ failPollCount: 1, failCancel: true });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.cancelStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.drainStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeStatus,
        'not-attempted',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.cancelErrorKind,
        'evaluation-failed',
      );
      return true;
    },
  );
  assert.equal(
    harness.pageCalls.some((call) => call.command === 'dispose'),
    false,
  );
});

test('host cancellation rejects a response owned by another operation', async () => {
  const harness = createFakePage({
    failPollCount: 1,
    wrongCancelIdentity: true,
  });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.cancelStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.terminalStatus,
        'unknown',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeStatus,
        'not-attempted',
      );
      return true;
    },
  );
});

test('host operation failures report the transition checkpoint and dispose after sibling cleanup', async () => {
  const harness = createFakePage({ failStack: 'esri-imagery' });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.match(error.message, /controlled esri-imagery failure/);
      assert.equal(error.actual?.phase, 'transition');
      assert.equal(error.actual?.targetStack, 'esri-imagery');
      assert.equal(error.expected?.status, 'completed');
      const projected = projectMapStreamingJourneyFailureEvidence({
        ...error.mapStreamingJourneyFailure,
        unexpected: { payload: 'must be discarded' },
      });
      assert.equal(projected.unexpected, undefined);
      const report = createCaptureFailureReport({
        source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
        phase: 'austin-map-streaming-route',
        error,
        errorActual: error.actual,
        errorExpected: error.expected,
        workload: { mapStreamingJourneyFailure: projected },
        completedSamples: Array.from({ length: 30 }, (_, run) => ({
          scenario: 'scripted-motion',
          run,
          measurements: Array.from({ length: 20 }, () => 'x'.repeat(1_000)),
        })),
      });
      const serialized = JSON.stringify(report);
      assert.ok(Buffer.byteLength(serialized, 'utf8') <= 256 * 1024);
      const replay = JSON.parse(serialized);
      assert.equal(replay.progress.completedSampleCount, 30);
      assert.ok(replay.progress.completedSamplesRetained < 30);
      assert.equal(
        replay.workload.mapStreamingJourneyFailure.checkpoint.phase,
        'transition',
      );
      assert.equal(
        replay.workload.mapStreamingJourneyFailure.retirement.disposeStatus,
        'confirmed',
      );
      assert.deepEqual(
        replay.workload.mapStreamingJourneyFailure.expected,
        error.expected,
      );
      assert.equal(replay.failure.actual.phase, 'transition');
      assert.equal(replay.failure.expected.status, 'completed');
      return true;
    },
  );
  assert.equal(harness.pageCalls.at(-1).command, 'dispose');
  assert.equal(harness.context.window.__gevMapStreamingJourneyV1, undefined);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('strict smoke journey rejection retains bounded observed route and transition evidence through serializers', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const profile = resolveMapFixtureBuildProfile(MAP_FIXTURE_BUILD_PROFILE_ID);
  const harness = createFakePage();
  const observed = await runNativeMapStreamingJourney(harness.page, {
    durationMs: 60_000,
    route: MAP_STREAMING_ROUTE,
  });
  validateMapStreamingJourneyEvidence(observed, fixture);
  const mapStreamingCaptureModule = {
    MAP_STREAMING_ROUTE,
    async runNativeMapStreamingJourney() {
      return observed;
    },
    validateMapStreamingJourneyEvidence,
    createMapStreamingJourneyValidationFailureEvidence,
    projectMapStreamingJourneyValidationFailureEvidence,
  };
  const accepted = await runNativeMapJourneyForSmoke({
    page: { revision: 'a'.repeat(40) },
    revision: 'a'.repeat(40),
    fixture,
    buildProfile: profile,
    mapStreamingCaptureModule,
  });
  assert.equal(accepted.performanceAcceptanceEligible, false);
  assert.equal(accepted.journey, observed);
  observed.route.start = {
    ...observed.route.start,
    longitude: observed.route.start.longitude + 0.01,
  };
  observed.privateDiagnostic =
    'https://provider.invalid/tile?key=secret-provider-key';
  observed.privatePayload = { body: 'provider response must not survive' };

  let rejection;
  await assert.rejects(
    runNativeMapJourneyForSmoke({
      page: { revision: 'a'.repeat(40) },
      revision: 'a'.repeat(40),
      fixture,
      buildProfile: profile,
      mapStreamingCaptureModule,
    }),
    (error) => {
      rejection = error;
      assert.match(
        error.message,
        /route starts at the declared native camera pose/,
      );
      return true;
    },
  );
  const envelope = rejection.mapStreamingJourneyValidationFailure;
  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.performanceAcceptanceEligible, false);
  assert.equal(envelope.revision, 'a'.repeat(40));
  assert.equal(envelope.fixtureId, fixture.id);
  assert.equal(envelope.manifestSha256, fixture.manifestSha256);
  assert.equal(envelope.buildProfileId, profile.id);
  assert.equal(envelope.routeId, MAP_STREAMING_ROUTE.id);
  assert.notEqual(
    envelope.journey.route.start.longitude,
    envelope.journey.initialState.camera.longitude,
  );
  assert.equal(envelope.journey.transitions.length, 4);
  assert.equal(envelope.journey.transitionCount, 4);
  assert.equal(envelope.journey.omittedTransitionCount, 0);
  assert.equal(envelope.journey.transitions[1].state.globeTilesLoaded, true);
  assert.equal(envelope.journey.finalState.photorealReadyContentTiles, 7);
  const failureReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    phase: 'native-map-streaming-journey-validation',
    error: rejection,
    workload: { mapStreamingJourneyValidationFailure: envelope },
  });
  const compacted = compactCaptureCliFailure(failureReport);
  const outerProjection = projectMapStreamingJourneyValidationFailureForSmoke(
    { captureCliFailure: compacted },
    mapStreamingCaptureModule,
  );
  assert.deepEqual(outerProjection, envelope);
  const serialized = JSON.stringify({ smokeDiagnostics: { outerProjection } });
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 16_384);
  assert.equal(serialized.includes('provider.invalid'), false);
  assert.equal(serialized.includes('secret-provider-key'), false);
  assert.equal(serialized.includes('provider response'), false);
  assert.equal(
    compacted.summary.mapStreamingJourneyValidationFailure.status,
    'failed',
  );
  assert.deepEqual(
    compacted.rawReport.workload.mapStreamingJourneyValidationFailure,
    envelope,
  );
  const historicalEnvelope = structuredClone(envelope);
  delete historicalEnvelope.journey.route.startupFlightDelayMs;
  delete historicalEnvelope.journey.route.startupFlightPreparationElapsedMs;
  delete historicalEnvelope.journey.route.startupFlightCancelled;
  const projectedHistoricalEnvelope =
    projectMapStreamingJourneyValidationFailureEvidence(historicalEnvelope);
  assert.equal(
    projectedHistoricalEnvelope.journey.route.startupFlightDelayMs,
    null,
  );
  assert.equal(
    projectedHistoricalEnvelope.journey.route.startupFlightPreparationElapsedMs,
    null,
  );
  assert.equal(
    projectedHistoricalEnvelope.journey.route.startupFlightCancelled,
    null,
  );
  assert.deepEqual(
    projectMapStreamingJourneyValidationFailureEvidence(
      projectedHistoricalEnvelope,
    ),
    projectedHistoricalEnvelope,
    'Historical v1 failure envelopes remain stable after additive projection.',
  );
  for (const { fixtureId, manifestSha256 } of [
    {
      fixtureId: 'austin-map-streaming-synthetic-v1',
      manifestSha256:
        '36eb2997bb092b029a541b810f92d7c19d982010e763129948acb438c18a277f',
    },
    {
      fixtureId: 'austin-map-streaming-synthetic-v1',
      manifestSha256:
        '798411accb8f7f52c8f58562ec6263f1bebd48cdbcda97527b57c1a4ef5fe0d4',
    },
    {
      fixtureId: 'austin-map-streaming-synthetic-v1',
      manifestSha256: 'f'.repeat(64),
    },
    {
      fixtureId: 'austin-map-streaming-synthetic-v2',
      manifestSha256:
        '31f63be4f0d20864e909134f44a319c2af72e2e1f724ab4996bbd8f5a12fae7c',
    },
    {
      fixtureId: 'austin-map-streaming-synthetic-v2',
      manifestSha256: 'e'.repeat(64),
    },
    {
      fixtureId: 'austin-map-streaming-synthetic-v3',
      manifestSha256: 'd'.repeat(64),
    },
  ]) {
    const historicalFailure = structuredClone(projectedHistoricalEnvelope);
    historicalFailure.fixtureId = fixtureId;
    historicalFailure.manifestSha256 = manifestSha256;
    const projectedFailure =
      projectMapStreamingJourneyValidationFailureEvidence(historicalFailure);
    assert.equal(projectedFailure.fixtureId, fixtureId);
    assert.equal(projectedFailure.manifestSha256, manifestSha256);
    assert.equal(projectedFailure.status, 'failed');
    assert.equal(projectedFailure.performanceAcceptanceEligible, false);
    assert.deepEqual(
      projectMapStreamingJourneyValidationFailureEvidence(projectedFailure),
      projectedFailure,
      'Historical failure evidence preserves its supported version and digest.',
    );
    const historicalFailureReport = createCaptureFailureReport({
      source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
      phase: 'historical-map-journey-validation',
      error: rejection,
      workload: { mapStreamingJourneyValidationFailure: historicalFailure },
    });
    const compacted = compactCaptureCliFailure(historicalFailureReport);
    const outer = projectMapStreamingJourneyValidationFailureForSmoke(
      { captureCliFailure: compacted },
      mapStreamingCaptureModule,
    );
    assert.deepEqual(outer, projectedFailure);
    assert.equal(
      compacted.rawReport.workload.mapStreamingJourneyValidationFailure
        .fixtureId,
      fixtureId,
    );
  }
  const unknownHistoricalFixture = structuredClone(projectedHistoricalEnvelope);
  unknownHistoricalFixture.fixtureId = 'austin-map-streaming-synthetic-v999';
  assert.throws(
    () =>
      projectMapStreamingJourneyValidationFailureEvidence(
        unknownHistoricalFixture,
      ),
    /known fixture version/,
  );
  const malformedHistoricalDigest = structuredClone(
    projectedHistoricalEnvelope,
  );
  malformedHistoricalDigest.fixtureId = 'austin-map-streaming-synthetic-v1';
  malformedHistoricalDigest.manifestSha256 = 'z'.repeat(64);
  assert.throws(
    () =>
      projectMapStreamingJourneyValidationFailureEvidence(
        malformedHistoricalDigest,
      ),
    /64-character hexadecimal SHA-256/,
    'Known historical IDs still require a well-formed digest.',
  );
  for (const historicalFixtureId of [
    'austin-map-streaming-synthetic-v1',
    'austin-map-streaming-synthetic-v2',
    'austin-map-streaming-synthetic-v3',
  ])
    await assert.rejects(
      runNativeMapJourneyForSmoke({
        page: { revision: 'a'.repeat(40) },
        revision: 'a'.repeat(40),
        fixture: { ...fixture, id: historicalFixtureId },
        buildProfile: profile,
        mapStreamingCaptureModule,
      }),
      /austin-map-streaming-synthetic-v4/,
      `Live smoke rejects historical ${historicalFixtureId} fixtures.`,
    );
  for (const [field, invalidValue] of [
    ['startupFlightDelayMs', '500'],
    ['startupFlightPreparationElapsedMs', Number.NaN],
    ['startupFlightCancelled', 'true'],
  ]) {
    const malformed = structuredClone(projectedHistoricalEnvelope);
    malformed.journey.route[field] = invalidValue;
    assert.throws(
      () => projectMapStreamingJourneyValidationFailureEvidence(malformed),
      `Malformed supplied ${field} is rejected.`,
    );
  }
  const extendedEvidence = createMapStreamingJourneyValidationFailureEvidence({
    journey: {
      ...observed,
      transitions: [
        ...observed.transitions,
        structuredClone(observed.transitions.at(-1)),
      ],
    },
    revision: 'a'.repeat(40),
    fixture,
    buildProfile: profile,
    route: MAP_STREAMING_ROUTE,
  });
  assert.equal(extendedEvidence.journey.transitionCount, 5);
  assert.equal(extendedEvidence.journey.transitions.length, 4);
  assert.equal(extendedEvidence.journey.omittedTransitionCount, 1);

  const missingStartJourney = structuredClone(observed);
  missingStartJourney.route.start = null;
  const missingStartModule = {
    ...mapStreamingCaptureModule,
    async runNativeMapStreamingJourney() {
      return missingStartJourney;
    },
  };
  let missingStartError;
  await assert.rejects(
    runNativeMapJourneyForSmoke({
      page: { revision: 'a'.repeat(40) },
      revision: 'a'.repeat(40),
      fixture,
      buildProfile: profile,
      mapStreamingCaptureModule: missingStartModule,
    }),
    (error) => {
      missingStartError = error;
      assert.match(error.message, /Observed route endpoints are present/);
      return true;
    },
  );
  const missingStartEnvelope =
    missingStartError.mapStreamingJourneyValidationFailure;
  assert.equal(missingStartEnvelope.journey.route.start.status, 'unavailable');
  assert.equal(missingStartEnvelope.journey.route.start.longitude, null);
  assert.equal(missingStartEnvelope.journey.route.end.status, 'observed');
  assert.equal(
    missingStartEnvelope.journey.initialState.camera.status,
    'observed',
  );
  const reprojectedMissingStart =
    projectMapStreamingJourneyValidationFailureEvidence(missingStartEnvelope);
  assert.deepEqual(reprojectedMissingStart, missingStartEnvelope);
  const missingStartReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    phase: 'native-map-streaming-missing-route-start',
    error: missingStartError,
    workload: { mapStreamingJourneyValidationFailure: missingStartEnvelope },
  });
  const missingStartCompacted = compactCaptureCliFailure(missingStartReport);
  const missingStartOuter = projectMapStreamingJourneyValidationFailureForSmoke(
    { captureCliFailure: missingStartCompacted },
    missingStartModule,
  );
  assert.deepEqual(missingStartOuter, missingStartEnvelope);
});

test('host failure report retains terminal state when disposal is unconfirmed', async () => {
  const harness = createFakePage({
    failStack: 'esri-imagery',
    failDispose: true,
  });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.terminalStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeErrorKind,
        'evaluation-failed',
      );
      return true;
    },
  );
});

test('native map failure report retains bounded Cesium terrain queue diagnostics', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  const surface =
    harness.context.window.__godsEyeView.viewer.scene.globe._surface;
  const makeTile = (queueIndex, imageryCount) => ({
    _x: queueIndex,
    _y: queueIndex + 1,
    _level: 10,
    state: 1,
    data: {
      terrainState: queueIndex % 7,
      mesh: queueIndex % 2 ? null : {},
      terrainData: { _mesh: {}, canUpsample: true },
      imagery: Array.from({ length: imageryCount }, (_, index) => ({
        loadingImagery: { state: index % 8 },
      })),
    },
  });
  surface._tileLoadQueueHigh = Array.from({ length: 5 }, (_, index) =>
    makeTile(index, index === 0 ? 40 : 2),
  );
  surface._tileLoadQueueMedium = Array.from({ length: 5 }, (_, index) =>
    makeTile(index + 5, 2),
  );
  surface._tileLoadQueueLow = Array.from({ length: 5 }, (_, index) =>
    makeTile(index + 10, 0),
  );
  let parent = null;
  for (let level = 0; level <= 23; level += 1) {
    parent = {
      _x: 0,
      _y: 0,
      _level: level,
      state: 1,
      parent,
      data: {
        terrainState: 1,
        mesh: {},
        terrainData: { _mesh: {}, canUpsample: true },
      },
    };
  }
  const firstQueuedTile = makeTile(0, 40);
  firstQueuedTile._y = 1;
  firstQueuedTile._level = 24;
  firstQueuedTile.parent = parent;
  surface._tileLoadQueueHigh[0] = firstQueuedTile;
  surface._tilesToRender = Array.from({ length: 3 }, (_, index) =>
    makeTile(index + 20, 0),
  );

  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const original = error.mapStreamingJourneyFailure;
      assert.ok(error.actual?.latestObservation, JSON.stringify(original));
      const queue = original.checkpointGlobeQueueDiagnostics;
      assert.equal(queue.available, true);
      assert.deepEqual(JSON.parse(JSON.stringify(queue.queueCounts)), {
        high: 5,
        medium: 5,
        low: 5,
        total: 15,
      });
      assert.equal(queue.renderedTileCount, 3);
      assert.equal(queue.sampledTiles.length, 8);
      assert.equal(queue.omittedSampledTileCount, 7);
      assert.equal(queue.sampledTiles[0].queue, 'high');
      assert.equal(queue.sampledTiles[0].x, 0);
      assert.equal(queue.sampledTiles[0].tileState, 1);
      assert.equal(queue.sampledTiles[0].terrainState, 0);
      assert.equal(queue.sampledTiles[0].meshPresent, true);
      assert.equal(queue.sampledTiles[1].meshPresent, false);
      assert.equal(queue.sampledTiles[0].imageryEntryCount, 40);
      assert.equal(queue.sampledTiles[0].imageryEntriesSampled, 32);
      assert.equal(queue.sampledTiles[0].omittedImageryEntryCount, 8);
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(queue.sampledTiles[0].loadingImageryStateCounts),
        ),
        Array.from({ length: 8 }, () => 4),
      );
      const ancestry = original.checkpointGlobeQueueDiagnostics.terrainAncestry;
      assert.equal(ancestry.available, true);
      assert.deepEqual(ancestry.sample, {
        queue: 'high',
        x: 0,
        y: 1,
        level: 24,
      });
      assert.equal(ancestry.rows.length, 24);
      assert.equal(ancestry.rows[0].level, 24);
      assert.equal(ancestry.rows.at(-1).level, 1);
      assert.equal(ancestry.rows.at(-1).parentPresent, true);
      assert.equal(ancestry.truncated, true);
      assert.equal(ancestry.cycleDetected, false);
      assert.deepEqual(ancestry.unsupportedFields, []);

      const report = createCaptureFailureReport({
        source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
        phase: 'native-map-initial-readiness',
        error,
        errorActual: error.actual,
        errorExpected: error.expected,
        workload: { mapStreamingJourneyFailure: original },
      });
      const serialized = JSON.stringify(report);
      assert.ok(Buffer.byteLength(serialized, 'utf8') <= 256 * 1024);
      const replay = JSON.parse(serialized);
      const retained =
        replay.workload.mapStreamingJourneyFailure
          .checkpointGlobeQueueDiagnostics;
      assert.equal(retained.queueCounts.total, 15);
      assert.equal(retained.renderedTileCount, 3);
      assert.equal(retained.sampledTiles.length, 8);
      assert.deepEqual(
        retained.sampledTiles[0].loadingImageryStateCounts,
        Array.from({ length: 8 }, () => 4),
      );
      assert.equal(
        replay.workload.mapStreamingJourneyFailure
          .checkpointGlobeQueueDiagnostics.terrainAncestry.rows.length,
        24,
      );
      assert.equal(
        replay.workload.mapStreamingJourneyFailure
          .checkpointGlobeQueueDiagnostics.terrainAncestry.truncated,
        true,
      );
      assert.equal(
        replay.workload.mapStreamingJourneyFailure.checkpoint.latestObservation
          .globeQueueDiagnostics,
        undefined,
      );

      const smokeFailure = new Error('controlled map readiness failure');
      smokeFailure.smokeDiagnostics = { phase: 'native-map-transition' };
      attachMapStreamingJourneyFailureEvidence(smokeFailure, original);
      const outerFailureJson = JSON.stringify(smokeFailure.smokeDiagnostics);
      const outerFailure = JSON.parse(outerFailureJson);
      assert.equal(
        outerFailure.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .queueCounts.total,
        15,
      );
      assert.equal(
        outerFailure.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .sampledTiles.length,
        8,
      );
      assert.equal(
        outerFailure.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainAncestry.rows.length,
        24,
      );

      const oversized = structuredClone(original);
      oversized.checkpointGlobeQueueDiagnostics.sampledTiles.push(
        structuredClone(queue.sampledTiles[0]),
      );
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(oversized),
        /sampledTiles.length/,
      );
      const malformed = structuredClone(original);
      malformed.checkpointGlobeQueueDiagnostics.sampledTiles[0].loadingImageryStateCounts.pop();
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(malformed),
        /8/,
      );
      const inconsistentQueueCount = structuredClone(original);
      inconsistentQueueCount.checkpointGlobeQueueDiagnostics.sampledTiles[0].queue =
        'low';
      inconsistentQueueCount.checkpointGlobeQueueDiagnostics.queueCounts.low = 0;
      assert.throws(() =>
        projectMapStreamingJourneyFailureEvidence(inconsistentQueueCount),
      );
      const missingAncestry = structuredClone(original);
      delete missingAncestry.checkpointGlobeQueueDiagnostics.terrainAncestry;
      assert.doesNotThrow(() =>
        projectMapStreamingJourneyFailureEvidence(missingAncestry),
      );
      const badSample = structuredClone(original);
      badSample.checkpointGlobeQueueDiagnostics.terrainAncestry.sample.x = 1;
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(badSample),
        /equal/,
      );
      const badParentCoordinates = structuredClone(original);
      badParentCoordinates.checkpointGlobeQueueDiagnostics.terrainAncestry.rows[1].y = 9;
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(badParentCoordinates),
        /equal/,
      );
      const badUnsupportedField = structuredClone(original);
      badUnsupportedField.checkpointGlobeQueueDiagnostics.terrainAncestry.unsupportedFields =
        ['secret'];
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(badUnsupportedField),
        /MAP_TERRAIN_ANCESTRY_FIELDS/,
      );
      const overLimitAncestry = structuredClone(original);
      overLimitAncestry.checkpointGlobeQueueDiagnostics.terrainAncestry.rows.push(
        structuredClone(ancestry.rows.at(-1)),
      );
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(overLimitAncestry),
        /length/,
      );
      const falseTruncation = structuredClone(original);
      falseTruncation.checkpointGlobeQueueDiagnostics.terrainAncestry.truncated = false;
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(falseTruncation),
        /unsupportedFields/,
      );
      return true;
    },
  );
});

test('native map failure retains bounded temporal terrain history through outer serialization', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 2_500,
  });
  const app = harness.context.window.__godsEyeView;
  const surface = app.viewer.scene.globe._surface;
  const originalRequestRender = app.viewer.scene.requestRender.bind(
    app.viewer.scene,
  );
  let esriRenderCount = 0;
  app.viewer.scene.requestRender = () => {
    if (app.mapStackController.getActiveId() === 'esri-imagery') {
      esriRenderCount += 1;
      if (esriRenderCount === 1) surface._tileLoadQueueHigh = [];
      else surface._tileLoadQueueHigh = [makeTerrainChain(esriRenderCount)];
    }
    originalRequestRender();
  };

  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const evidence = error.mapStreamingJourneyFailure;
      const history = evidence.checkpointGlobeQueueDiagnostics?.terrainHistory;
      assert.ok(
        history,
        JSON.stringify({ projected: evidence, raw: error.actual }),
      );
      assert.equal(history.finalized, true);
      assert.ok(history.completedObservationCount > 8);
      assert.equal(history.samples.length, 8);
      assert.equal(history.samples[0].sequence, 1);
      assert.equal(history.samples[0].identityStatus, 'unavailable');
      assert.equal(history.samples[1].identityStatus, 'unavailable');
      assert.ok(
        history.samples
          .slice(2)
          .some((sample) => sample.identityStatus === 'changed'),
      );
      assert.equal(history.samples.at(-1).final, true);
      assert.equal(
        history.samples.at(-1).sequence,
        history.completedObservationCount,
      );
      assert.ok(history.ancestryRows.length <= 8 * 24);
      assert.equal(history.ancestryRows.length, 7 * 24);
      assert.equal(
        history.ancestryRows.filter((row) => row.sampleSequence === 1).length,
        0,
      );
      assert.equal(
        history.ancestryRows.filter(
          (row) => row.sampleSequence === history.samples.at(-1).sequence,
        ).length,
        24,
      );
      assert.ok(
        history.samples
          .slice(1, -1)
          .every(
            (sample, index, rows) =>
              sample.observedElapsedMs -
                (index === 0
                  ? history.samples[0].observedElapsedMs
                  : rows[index - 1].observedElapsedMs) >=
              2_000,
          ),
      );

      const twiceProjected =
        projectMapStreamingJourneyFailureEvidence(evidence);
      assert.deepEqual(
        twiceProjected,
        evidence,
        'Projection is idempotent for the shallow queue-history form.',
      );
      const inProgressCheckpoint = structuredClone(error.actual);
      inProgressCheckpoint.terrainHistory.finalized = false;
      inProgressCheckpoint.terrainHistory.finalSequence = null;
      for (const sample of inProgressCheckpoint.terrainHistory.samples)
        sample.final = false;
      const inProgress = projectMapStreamingJourneyFailureEvidence({
        schema: evidence.schema,
        operationId: evidence.operationId,
        failureCode: evidence.failureCode,
        elapsedMs: evidence.elapsedMs,
        checkpoint: inProgressCheckpoint,
        expected: evidence.expected,
        retirement: evidence.retirement,
      });
      assert.deepEqual(
        projectMapStreamingJourneyFailureEvidence(inProgress),
        inProgress,
        'An in-progress history projection is idempotent.',
      );
      const malformed = structuredClone(evidence);
      malformed.checkpointGlobeQueueDiagnostics.terrainHistory.samples[0].sequence = 0;
      assert.throws(() => projectMapStreamingJourneyFailureEvidence(malformed));
      const badCounts = structuredClone(evidence);
      badCounts.checkpointGlobeQueueDiagnostics.terrainHistory.recordedObservationCount += 1;
      assert.throws(() => projectMapStreamingJourneyFailureEvidence(badCounts));
      const badFinalMarker = structuredClone(evidence);
      badFinalMarker.checkpointGlobeQueueDiagnostics.terrainHistory.samples.at(
        -1,
      ).final = false;
      assert.throws(() =>
        projectMapStreamingJourneyFailureEvidence(badFinalMarker),
      );
      const badRowIndex = structuredClone(evidence);
      badRowIndex.checkpointGlobeQueueDiagnostics.terrainHistory.ancestryRows[1].rowIndex = 0;
      assert.throws(() =>
        projectMapStreamingJourneyFailureEvidence(badRowIndex),
      );
      const badState = structuredClone(evidence);
      badState.checkpointGlobeQueueDiagnostics.terrainHistory.ancestryRows[0].terrainState = 99;
      assert.throws(() => projectMapStreamingJourneyFailureEvidence(badState));
      const unknownField = structuredClone(evidence);
      unknownField.checkpointGlobeQueueDiagnostics.terrainHistory.samples[1].ancestryUnsupportedFields =
        'unknown-private-field';
      assert.throws(() =>
        projectMapStreamingJourneyFailureEvidence(unknownField),
      );
      const conflict = structuredClone(evidence);
      conflict.checkpoint.terrainHistory = structuredClone(history);
      conflict.checkpoint.terrainHistory.phase = 'initial-readiness';
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(conflict),
        /Duplicate terrain history/,
      );

      const unavailableQueueConflictCheckpoint = structuredClone(error.actual);
      const unavailableQueue =
        unavailableQueueConflictCheckpoint.latestObservation
          .globeQueueDiagnostics;
      unavailableQueue.available = false;
      unavailableQueue.unavailableReason = 'private-queue-fields-unavailable';
      unavailableQueue.queueCounts = null;
      unavailableQueue.renderedTileCount = null;
      unavailableQueue.sampledTiles = [];
      unavailableQueue.omittedSampledTileCount = null;
      delete unavailableQueue.terrainAncestry;
      unavailableQueue.terrainHistory = structuredClone(history);
      unavailableQueueConflictCheckpoint.terrainHistory =
        structuredClone(history);
      unavailableQueueConflictCheckpoint.terrainHistory.phase =
        'initial-readiness';
      const unavailableConflict = {
        ...evidence,
        checkpoint: unavailableQueueConflictCheckpoint,
      };
      delete unavailableConflict.checkpointGlobeQueueDiagnostics;
      assert.throws(
        () => projectMapStreamingJourneyFailureEvidence(unavailableConflict),
        /Duplicate terrain history/,
        'Unavailable queue histories must be compared with checkpoint history.',
      );

      for (const field of ['observedElapsedMs', 'routeElapsedMs']) {
        const overElapsedBound = structuredClone(evidence);
        const samples =
          overElapsedBound.checkpointGlobeQueueDiagnostics.terrainHistory
            .samples;
        for (const sample of samples) sample[field] += 240_001;
        assert.throws(
          () => projectMapStreamingJourneyFailureEvidence(overElapsedBound),
          `${field} must remain within the 240-second history bound.`,
        );
      }

      const smokeFailure = new Error('temporal readiness failure');
      attachMapStreamingJourneyFailureEvidence(smokeFailure, evidence);
      const report = createCaptureFailureReport({
        source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
        phase: 'native-map-transition-readiness',
        error: smokeFailure,
        errorActual: error.actual,
        errorExpected: error.expected,
        workload: smokeFailure.smokeDiagnostics,
      });
      const encoded = JSON.stringify(report);
      assert.ok(Buffer.byteLength(encoded, 'utf8') <= 256 * 1024);
      const replay = JSON.parse(encoded);
      const retained =
        replay.workload.mapStreamingJourneyFailure
          .checkpointGlobeQueueDiagnostics.terrainHistory;
      assert.deepEqual(retained, JSON.parse(JSON.stringify(history)));
      assert.ok(esriRenderCount > 8);
      return true;
    },
  );
});

test('final actual render inside the cadence interval is retained before readiness timeout', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 500,
  });
  const app = harness.context.window.__godsEyeView;
  const originalRequestRender = app.viewer.scene.requestRender.bind(
    app.viewer.scene,
  );
  let esriRenderCount = 0;
  app.viewer.scene.requestRender = () => {
    if (app.mapStackController.getActiveId() !== 'esri-imagery') {
      originalRequestRender();
      return;
    }
    esriRenderCount += 1;
    if (esriRenderCount <= 56) originalRequestRender();
  };
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const history =
        error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          ?.terrainHistory;
      assert.ok(history);
      assert.equal(history.finalized, true);
      assert.equal(history.finalSequence, history.completedObservationCount);
      assert.equal(history.samples.length, 8);
      assert.equal(history.samples.at(-1).observedElapsedMs, 28_000);
      assert.ok(
        history.samples.at(-1).observedElapsedMs -
          history.samples.at(-2).observedElapsedMs <
          2_000,
      );
      assert.equal(harness.listeners.size, 0);
      assert.equal(harness.frames.size, 0);
      return true;
    },
  );
});

test('full bounded terrain history survives actual CLI compaction and outer smoke projection', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 2_500,
  });
  const app = harness.context.window.__godsEyeView;
  const surface = app.viewer.scene.globe._surface;
  const originalRequestRender = app.viewer.scene.requestRender.bind(
    app.viewer.scene,
  );
  let renderCount = 0;
  app.viewer.scene.requestRender = () => {
    if (app.mapStackController.getActiveId() === 'esri-imagery') {
      renderCount += 1;
      surface._tileLoadQueueHigh = [makeTerrainChain(renderCount)];
    }
    originalRequestRender();
  };
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const evidence = error.mapStreamingJourneyFailure;
      const history = evidence.checkpointGlobeQueueDiagnostics.terrainHistory;
      assert.equal(history.samples.length, 8);
      assert.equal(history.ancestryRows.length, 8 * 24);
      assert.ok(
        history.samples.every((sample) => sample.ancestryRowCount === 24),
      );

      const report = createCaptureFailureReport({
        source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
        phase: 'native-map-transition-readiness',
        error,
        errorActual: error.actual,
        errorExpected: error.expected,
        workload: { mapStreamingJourneyFailure: evidence },
      });
      const compacted = compactCaptureCliFailure(report);
      const outerProjection = projectMapStreamingJourneyFailureForSmoke(
        { captureCliFailure: compacted },
        { projectMapStreamingJourneyFailureEvidence },
      );
      assert.equal(outerProjection.status, undefined);
      assert.equal(
        outerProjection.checkpointGlobeQueueDiagnostics.terrainHistory
          .ancestryRows.length,
        8 * 24,
      );
      const outerFailure = new Error('bounded outer projection');
      attachMapStreamingJourneyFailureEvidence(outerFailure, outerProjection);
      const serialized = JSON.stringify(outerFailure.smokeDiagnostics);
      assert.ok(Buffer.byteLength(serialized, 'utf8') < 256 * 1024);
      const replay = JSON.parse(serialized);
      assert.equal(
        replay.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainHistory.ancestryRows.length,
        8 * 24,
      );
      return true;
    },
  );
});

test('native map readiness timeout with no completed render does not invent queue history', async () => {
  const harness = createFakePage({ blockFrames: true });
  harness.context.window.__godsEyeView.viewer.scene.requestRender = () => {};
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const evidence = error.mapStreamingJourneyFailure;
      assert.equal(evidence.checkpoint.phase, 'initial-readiness');
      assert.equal(evidence.checkpoint.latestObservation, null);
      assert.equal(evidence.checkpointGlobeQueueDiagnostics, undefined);
      assert.equal(evidence.retirement.disposeStatus, 'confirmed');
      assert.deepEqual(
        projectMapStreamingJourneyFailureEvidence(evidence),
        evidence,
      );
      return true;
    },
  );
});

test('native map queue ancestry reports cycles and unsupported getters explicitly', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  const surface =
    harness.context.window.__godsEyeView.viewer.scene.globe._surface;
  const sample = {
    _x: 0,
    _y: 1,
    _level: 3,
    state: 1,
    data: {
      terrainState: 0,
      mesh: null,
      terrainData: { _mesh: null, canUpsample: false },
    },
  };
  const parent2 = {
    _x: 0,
    _y: 0,
    _level: 2,
    state: 1,
    data: {
      terrainState: 0,
      mesh: null,
      terrainData: { _mesh: null, canUpsample: false },
    },
  };
  const parent1 = {
    _x: 0,
    _y: 0,
    _level: 1,
    state: 1,
    data: {
      terrainState: 0,
      mesh: null,
      terrainData: { _mesh: null, canUpsample: false },
    },
  };
  const root = {
    _x: 0,
    _y: 0,
    _level: 0,
    state: 1,
    data: {
      terrainState: 0,
      mesh: null,
      terrainData: { _mesh: null, canUpsample: false },
    },
  };
  sample.parent = parent2;
  parent2.parent = parent1;
  parent1.parent = root;
  root.parent = sample;
  surface._tileLoadQueueHigh = [sample];

  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const ancestry =
        error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainAncestry;
      assert.equal(ancestry.available, true);
      assert.equal(ancestry.cycleDetected, true);
      assert.equal(ancestry.truncated, false);
      assert.equal(ancestry.rows.length, 4);
      assert.equal(ancestry.rows.at(-1).level, 0);
      assert.equal(ancestry.rows.at(-1).parentPresent, true);
      return true;
    },
  );

  const throwingParentHarness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  const throwingSurface =
    throwingParentHarness.context.window.__godsEyeView.viewer.scene.globe
      ._surface;
  const tileWithoutData = {
    _x: 7,
    _y: 9,
    _level: 4,
    state: 1,
    get parent() {
      throw new Error('controlled private getter failure');
    },
  };
  throwingSurface._tileLoadQueueHigh = [tileWithoutData];
  await assert.rejects(
    runNativeMapStreamingJourney(throwingParentHarness.page, {
      durationMs: 60_000,
      route: throwingParentHarness.route,
    }),
    (error) => {
      const ancestry =
        error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainAncestry;
      assert.equal(ancestry.available, true);
      assert.equal(ancestry.cycleDetected, false);
      assert.equal(ancestry.truncated, false);
      assert.deepEqual(ancestry.unsupportedFields, ['data', 'parent']);
      assert.equal(ancestry.rows.length, 1);
      assert.equal(ancestry.rows[0].dataPresent, null);
      assert.equal(ancestry.rows[0].parentPresent, null);
      return true;
    },
  );

  const invalidAncestorHarness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  const invalidAncestorSurface =
    invalidAncestorHarness.context.window.__godsEyeView.viewer.scene.globe
      ._surface;
  const invalidIdentitySample = {
    _x: 7,
    _y: 9,
    _level: 4,
    state: 1,
    parent: { _x: -1, _y: 4, _level: 3, state: 1 },
    data: {
      terrainState: 0,
      mesh: null,
      terrainData: { _mesh: null, canUpsample: false },
    },
  };
  invalidAncestorSurface._tileLoadQueueHigh = [invalidIdentitySample];
  await assert.rejects(
    runNativeMapStreamingJourney(invalidAncestorHarness.page, {
      durationMs: 60_000,
      route: invalidAncestorHarness.route,
    }),
    (error) => {
      const ancestry =
        error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainAncestry;
      assert.equal(ancestry.available, true);
      assert.equal(ancestry.rows.length, 1);
      assert.equal(ancestry.rows[0].parentPresent, true);
      assert.deepEqual(ancestry.unsupportedFields, ['x']);
      return true;
    },
  );

  const rowAtLimit = [];
  for (let level = 23; level >= 0; level -= 1) {
    const child = rowAtLimit.at(-1);
    rowAtLimit.push({
      _x: child ? Math.floor(child._x / 2) : 2 ** 23 - 1,
      _y: child ? Math.floor(child._y / 2) : 2 ** 22 - 1,
      _level: level,
      state: 1,
      data: {
        terrainState: 0,
        mesh: null,
        terrainData: { _mesh: null, canUpsample: false },
      },
    });
  }
  rowAtLimit.at(-1).parent = rowAtLimit[0];
  for (let index = 0; index + 1 < rowAtLimit.length; index += 1)
    rowAtLimit[index].parent = rowAtLimit[index + 1];
  const boundaryCycleHarness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  boundaryCycleHarness.context.window.__godsEyeView.viewer.scene.globe._surface._tileLoadQueueHigh =
    [rowAtLimit[0]];
  await assert.rejects(
    runNativeMapStreamingJourney(boundaryCycleHarness.page, {
      durationMs: 60_000,
      route: boundaryCycleHarness.route,
    }),
    (error) => {
      const ancestry =
        error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
          .terrainAncestry;
      assert.equal(ancestry.rows.length, 24);
      assert.equal(ancestry.truncated, false);
      assert.equal(ancestry.cycleDetected, true);
      assert.equal(ancestry.rows.at(-1).level, 0);
      assert.equal(ancestry.rows.at(-1).parentPresent, true);
      return true;
    },
  );

  const unsupportedTerrainDataCases = [
    {
      name: 'throwing mesh and missing canUpsample',
      terrainData: {
        get _mesh() {
          throw new Error('controlled mesh getter failure');
        },
      },
    },
    {
      name: 'missing mesh and throwing canUpsample',
      terrainData: {
        get canUpsample() {
          throw new Error('controlled canUpsample getter failure');
        },
      },
    },
  ];
  for (const testCase of unsupportedTerrainDataCases) {
    const unsupportedTerrainDataHarness = createFakePage({
      notReadyGlobeStack: 'esri-imagery',
      advancePageClockOnRenderMs: 5_000,
    });
    const unsupportedSurface =
      unsupportedTerrainDataHarness.context.window.__godsEyeView.viewer.scene
        .globe._surface;
    unsupportedSurface._tileLoadQueueHigh = [
      {
        _x: 7,
        _y: 9,
        _level: 0,
        state: 1,
        parent: null,
        data: {
          terrainState: 0,
          mesh: null,
          terrainData: testCase.terrainData,
        },
      },
    ];
    await assert.rejects(
      runNativeMapStreamingJourney(unsupportedTerrainDataHarness.page, {
        durationMs: 60_000,
        route: unsupportedTerrainDataHarness.route,
      }),
      (error) => {
        const ancestry =
          error.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
            .terrainAncestry;
        assert.equal(ancestry.rows.length, 1, testCase.name);
        assert.equal(ancestry.rows[0].terrainDataPresent, true, testCase.name);
        assert.equal(ancestry.rows[0].terrainMeshPresent, null, testCase.name);
        assert.equal(ancestry.rows[0].canUpsample, null, testCase.name);
        assert.deepEqual(
          ancestry.unsupportedFields,
          ['canUpsample', 'terrainMesh'],
          testCase.name,
        );
        return true;
      },
    );
  }
});

test('Cesium queue diagnostic is explicitly unavailable when Globe surface internals are absent', async () => {
  const harness = createFakePage({
    notReadyGlobeStack: 'esri-imagery',
    advancePageClockOnRenderMs: 5_000,
  });
  harness.context.window.__godsEyeView.viewer.scene.globe._surface = null;
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const queue = error.actual.latestObservation.globeQueueDiagnostics;
      assert.deepEqual(JSON.parse(JSON.stringify(queue)), {
        available: false,
        unavailableReason: 'surface-unavailable',
        queueCounts: null,
        renderedTileCount: null,
        sampledTiles: [],
        omittedSampledTileCount: null,
        terrainAncestry: {
          available: false,
          unavailableReason: 'no-queued-sample',
          sample: null,
          rows: [],
          truncated: false,
          cycleDetected: false,
          unsupportedFields: [],
        },
      });
      return true;
    },
  );
});

test('page cancellation evidence retains late timer scheduling beyond its deadline', async () => {
  const harness = createFakePage({ timerOvershootMs: 2_000 });
  const operationId = 'map-late-drain';
  harness.context.window.__gevMapStreamingJourneyV1 = {
    [operationId]: {
      status: 'running',
      checkpoint: {
        phase: 'route',
        initialReadinessComplete: true,
        transitionCount: 3,
        targetStack: null,
        routeElapsedMs: 3_000,
        latestObservation: null,
      },
      completion: new Promise(() => {}),
      cancel() {},
    },
  };

  const cancelled = await harness.serializedDriver({
    command: 'cancel',
    operationId,
  });
  assert.equal(cancelled.drainStatus, 'timed-out');
  assert.equal(cancelled.drainWaitMs, 7_500);
  const projected = projectMapStreamingJourneyFailureEvidence({
    schema: 'gev-map-streaming-journey-failure/v1',
    operationId,
    failureCode: 'host-deadline',
    elapsedMs: 8_000,
    checkpoint: cancelled.checkpoint,
    expected: { maxElapsedMs: 60_000 },
    retirement: {
      cancelStatus: 'acknowledged',
      drainStatus: cancelled.drainStatus,
      drainWaitMs: cancelled.drainWaitMs,
      terminalStatus: cancelled.status,
      disposeStatus: 'not-attempted',
      cancelErrorKind: null,
      disposeErrorKind: null,
    },
  });
  assert.equal(projected.retirement.drainWaitMs, 7_500);
  assert.equal(projected.retirement.drainStatus, 'timed-out');
});

test('completed route checkpoint survives a failed disposal with measured tile counts', async () => {
  const harness = createFakePage({ failDispose: true });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      const evidence = error.mapStreamingJourneyFailure;
      assert.equal(evidence.failureCode, 'operation-disposal-failed');
      assert.equal(evidence.checkpoint.phase, 'completed');
      assert.equal(evidence.checkpoint.transitionCount, 3);
      assert.equal(
        evidence.checkpoint.latestObservation.photorealReadyContentTiles,
        7,
      );
      assert.equal(
        evidence.checkpoint.latestObservation.photorealSelectedTiles,
        4,
      );
      assert.equal(evidence.retirement.terminalStatus, 'completed');
      assert.equal(evidence.retirement.disposeStatus, 'failed');

      const report = createCaptureFailureReport({
        source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
        phase: 'austin-map-streaming-route',
        error,
        errorActual: error.actual,
        errorExpected: error.expected,
        workload: { mapStreamingJourneyFailure: evidence },
      });
      const serialized = JSON.stringify(report);
      assert.ok(Buffer.byteLength(serialized, 'utf8') <= 256 * 1024);
      const replay = JSON.parse(serialized);
      const retained = replay.workload.mapStreamingJourneyFailure;
      assert.equal(retained.checkpoint.phase, 'completed');
      assert.equal(retained.checkpoint.transitionCount, 3);
      assert.equal(
        retained.checkpoint.latestObservation.photorealReadyContentTiles,
        7,
      );
      assert.equal(
        retained.checkpoint.latestObservation.photorealSelectedTiles,
        4,
      );
      assert.equal(retained.retirement.terminalStatus, 'completed');
      assert.equal(retained.retirement.disposeStatus, 'failed');
      return true;
    },
  );
  assert.equal(
    Object.values(harness.context.window.__gevMapStreamingJourneyV1 || {})[0]
      ?.status,
    'completed',
    'The completed operation remains owned when disposal is unconfirmed.',
  );
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('host disposal requires the same operation identity it started', async () => {
  const harness = createFakePage({
    failStack: 'esri-imagery',
    wrongDisposeIdentity: true,
  });
  await assert.rejects(
    runNativeMapStreamingJourney(harness.page, {
      durationMs: 60_000,
      route: harness.route,
    }),
    (error) => {
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeStatus,
        'failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.disposeErrorKind,
        'evaluation-failed',
      );
      assert.equal(
        error.mapStreamingJourneyFailure.retirement.terminalStatus,
        'failed',
      );
      return true;
    },
  );
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
  const requiredAssets = [
    ...new Map(
      fixture.manifest.assets.map((asset) => [asset.kind, asset]),
    ).values(),
  ];
  let requestOrdinal = 0;
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
    const requestId = `map-capture-test-${++requestOrdinal}`;
    const response = await adapter.respond(new URL(url), {
      requestId,
      url: () => url,
      method: () => 'GET',
    });
    assert.ok(response, `Native request ${url} resolves to fixture bytes.`);
    assert.equal(
      response.body.length,
      asset.byteLength,
      `${asset.path} length`,
    );
    assert.equal(digest(response.body), asset.sha256, `${asset.path} SHA-256`);
    assert.equal(
      adapter.onFulfilled({
        requestId,
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
    missingAssetPathEvidence: summary.missingAssetPathEvidence,
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
  assert.equal(report.fixtureDelivery.assets.length, requiredAssets.length);
  assert.ok(report.route.elapsedMs >= report.route.durationMs);

  const timedFinalized = createFinalizedMapStreamingCaptureEvidence({
    fixture,
    journey,
    journeys: Array.from({ length: 5 }, (_, index) => ({
      run: index + 1,
      ...structuredClone(journey),
    })),
    profile,
    documentDeliveries: [row],
  });
  assert.equal(
    timedFinalized.mapStreamingCapture.performanceAcceptanceEligible,
    true,
  );
  assert.deepEqual(
    timedFinalized.mapStreamingCapture.journeys.map(({ run }) => run),
    [1, 2, 3, 4, 5],
  );

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
