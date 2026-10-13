import assert from 'node:assert/strict';
import { MAP_STREAMING_DELIVERY_SCHEMA } from './mapStreamingFixtureDelivery.mjs';
import {
  MAP_STREAMING_CAPTURE_SCHEMA,
  MAP_STREAMING_WORKLOAD_ID,
} from './mapStreamingWorkloadContract.mjs';
import {
  MAP_STREAMING_FIXTURE_ID,
  validateDeterministicMapStreamingFixture,
} from './mapStreamingFixture.mjs';
import { MAP_FIXTURE_BUILD_PROFILE_ID } from './buildProvenance.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

export const MAP_STREAMING_STACK_SEQUENCE = Object.freeze([
  'photoreal',
  'esri-imagery',
  'osm',
  'photoreal',
]);

// Chosen to keep the actual 1440x900 camera footprint inside the M1 corpus.
// The route geometry test uses pinned Cesium.Camera, not endpoint-only checks.
export const MAP_STREAMING_ROUTE = Object.freeze({
  id: 'austin-map-rightward-v1',
  start: Object.freeze({
    longitude: -97.72,
    latitude: 30.27,
    heightM: 6_000,
  }),
  headingRadians: 0,
  pitchRadians: -Math.PI / 2,
  moveRightMetersPerSecond: 120,
  durationLimitMs: 60_000,
  declaredBounds: Object.freeze({
    west: -97.82,
    south: 30.2,
    east: -97.58,
    north: 30.34,
  }),
  stackSchedule: Object.freeze([
    Object.freeze({ atMs: 0, stackId: 'photoreal' }),
    Object.freeze({ atMs: 15_000, stackId: 'esri-imagery' }),
    Object.freeze({ atMs: 30_000, stackId: 'osm' }),
    Object.freeze({ atMs: 45_000, stackId: 'photoreal' }),
  ]),
});

const EXPECTED_IMAGERY_CLASS = Object.freeze({
  'esri-imagery': 'ArcGisMapServerImageryProvider',
  osm: 'OpenStreetMapImageryProvider',
});

/** Browser-serialized driver. Keep all helpers inside this function. */
export async function runNativeMapStreamingJourneyInPage({
  durationMs,
  route,
}) {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const controller = app?.mapStackController;
  if (!viewer || !controller?.getActiveId || !controller?.setStack)
    throw new Error(
      'Native map workload requires the application map controller.',
    );
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > route.durationLimitMs
  )
    throw new Error('Map route duration is outside the declared bound.');
  if (
    route?.id !== 'austin-map-rightward-v1' ||
    !Number.isFinite(route?.start?.longitude) ||
    !Number.isFinite(route?.start?.latitude) ||
    !Number.isFinite(route?.start?.heightM) ||
    !Array.isArray(route?.stackSchedule) ||
    route.stackSchedule.length !== 4
  )
    throw new Error('Map route contract is malformed.');

  const scene = viewer.scene;
  const camera = viewer.camera;
  const globe = scene?.globe;
  if (!scene?.postRender?.addEventListener || !camera?.setView || !globe)
    throw new Error('Native map workload requires a renderable Cesium scene.');
  const Cesium = window.Cesium;
  if (
    typeof Cesium?.CesiumTerrainProvider !== 'function' ||
    typeof Cesium?.EllipsoidTerrainProvider !== 'function' ||
    typeof Cesium?.ArcGisMapServerImageryProvider !== 'function' ||
    typeof Cesium?.OpenStreetMapImageryProvider !== 'function'
  )
    throw new Error('Native Cesium provider constructors are unavailable.');
  const canonicalProviderType = (value) => {
    if (value instanceof Cesium.CesiumTerrainProvider)
      return 'CesiumTerrainProvider';
    if (value instanceof Cesium.EllipsoidTerrainProvider)
      return 'EllipsoidTerrainProvider';
    if (value instanceof Cesium.ArcGisMapServerImageryProvider)
      return 'ArcGisMapServerImageryProvider';
    if (value instanceof Cesium.OpenStreetMapImageryProvider)
      return 'OpenStreetMapImageryProvider';
    return null;
  };
  const expectedImageryClass = {
    'esri-imagery': 'ArcGisMapServerImageryProvider',
    osm: 'OpenStreetMapImageryProvider',
  };
  const readyTimeoutMs = Math.min(30_000, route.durationLimitMs);
  const cancellationError = (message) => {
    const error = new Error(message);
    error.code = 'GEV_MAP_JOURNEY_CANCELLED';
    return error;
  };

  const projectSnapshotSettings = () => {
    const style = app.styleManager;
    const services = style?.services;
    if (
      typeof style?._adaptiveQuality?.getMode !== 'function' ||
      typeof services?.getDetectionTuning !== 'function' ||
      typeof services?.getDetectionMode !== 'function' ||
      typeof style?.getVisualState !== 'function'
    )
      throw new Error(
        'Native visual settings are unavailable from the shared app observer.',
      );
    const visual = style.getVisualState();
    if (
      !visual ||
      typeof visual !== 'object' ||
      typeof visual.style !== 'string' ||
      !visual.bloom ||
      typeof visual.bloom.enabled !== 'boolean' ||
      !Number.isFinite(visual.bloom.intensity) ||
      !visual.sharpen ||
      typeof visual.sharpen.enabled !== 'boolean' ||
      !Number.isFinite(visual.sharpen.intensity) ||
      !visual.detection ||
      typeof visual.detection.mode !== 'string' ||
      !Number.isFinite(visual.detection.density) ||
      !visual.scope ||
      typeof visual.scope.enabled !== 'boolean' ||
      typeof visual.mapStack !== 'string' ||
      !visual.styleParams ||
      typeof visual.styleParams !== 'object'
    )
      throw new Error(
        'Native visual state is unavailable from the app observer.',
      );
    const tuning = services.getDetectionTuning();
    const contextAttributes =
      window.__gevRecoveryEarlyRendererProbe?.contextAttributes;
    if (
      !contextAttributes ||
      !Number.isFinite(tuning?.densityPct) ||
      tuning.densityPct < 0 ||
      tuning.densityPct > 100 ||
      !['manual', 'auto', 'quality', 'performance'].includes(
        style._adaptiveQuality.getMode(),
      ) ||
      typeof services.getDetectionMode() !== 'string' ||
      !Number.isFinite(viewer.resolutionScale) ||
      viewer.resolutionScale <= 0 ||
      typeof contextAttributes.antialias !== 'boolean' ||
      typeof contextAttributes.preserveDrawingBuffer !== 'boolean' ||
      !Number.isSafeInteger(scene.msaaSamples) ||
      scene.msaaSamples < 0 ||
      typeof scene.postProcessStages?.fxaa?.enabled !== 'boolean' ||
      typeof style.bloomEnabled !== 'boolean' ||
      !Number.isFinite(style.bloomIntensity) ||
      typeof style.sharpenEnabled !== 'boolean' ||
      !Number.isFinite(style.sharpenIntensity) ||
      !Number.isFinite(globe.maximumScreenSpaceError) ||
      globe.maximumScreenSpaceError <= 0
    )
      throw new Error('Native common visual settings are incomplete.');
    const tileset = app.tileset;
    return {
      qualityMode: style._adaptiveQuality.getMode(),
      densityPct: tuning.densityPct,
      detectionMode: services.getDetectionMode(),
      resolutionScale: viewer.resolutionScale ?? null,
      antialias: contextAttributes.antialias,
      msaaSamples: scene.msaaSamples ?? null,
      fxaa: scene.postProcessStages?.fxaa?.enabled ?? null,
      preserveDrawingBuffer: contextAttributes.preserveDrawingBuffer ?? null,
      bloom: style.bloomEnabled ?? null,
      bloomIntensity: style.bloomIntensity ?? null,
      sharpen: style.sharpenEnabled ?? null,
      sharpenIntensity: style.sharpenIntensity ?? null,
      visualState: visual,
      globeMaximumScreenSpaceError: globe.maximumScreenSpaceError ?? null,
      tilesetMaximumScreenSpaceError: tileset?.maximumScreenSpaceError ?? null,
      tilesetCacheBytes: tileset?.cacheBytes ?? null,
      tilesetMaximumCacheOverflowBytes:
        tileset?.maximumCacheOverflowBytes ?? null,
    };
  };

  const cameraState = () => {
    const position = camera.positionCartographic;
    return {
      longitude: (position.longitude * 180) / Math.PI,
      latitude: (position.latitude * 180) / Math.PI,
      heightM: position.height,
      headingRadians: camera.heading,
      pitchRadians: camera.pitch,
    };
  };

  const viewRectangleDegrees = () => {
    const rectangle = camera.computeViewRectangle(globe.ellipsoid);
    if (!rectangle)
      throw new Error(
        'Native camera frustum does not intersect the ellipsoid.',
      );
    return {
      west: (rectangle.west * 180) / Math.PI,
      south: (rectangle.south * 180) / Math.PI,
      east: (rectangle.east * 180) / Math.PI,
      north: (rectangle.north * 180) / Math.PI,
    };
  };

  const readTerrainSamples = () => {
    const center = camera.positionCartographic;
    const samples = [-0.004, 0, 0.004].map((delta) => {
      const point = {
        longitude: center.longitude + (delta * Math.PI) / 180,
        latitude: center.latitude,
        height: 0,
      };
      return {
        longitude: (point.longitude * 180) / Math.PI,
        latitude: (point.latitude * 180) / Math.PI,
        heightM: globe.getHeight(point) ?? null,
      };
    });
    return samples;
  };

  const captureState = (postRenderElapsedMs = null) => {
    const controllerState = controller.getState?.() || null;
    const tileset = app.tileset;
    const imageryLayer = scene.imageryLayers?.get?.(0) || null;
    const provider = imageryLayer?.imageryProvider || null;
    const viewport = {
      width: scene.canvas?.clientWidth ?? null,
      height: scene.canvas?.clientHeight ?? null,
      drawingBufferWidth: scene.context?.drawingBufferWidth ?? null,
      drawingBufferHeight: scene.context?.drawingBufferHeight ?? null,
    };
    if (
      viewport.width !== 1440 ||
      viewport.height !== 900 ||
      viewport.drawingBufferWidth !== 1440 ||
      viewport.drawingBufferHeight !== 900
    )
      throw new Error('Map workload viewport or drawing buffer changed.');
    return {
      activeStack: controller.getActiveId(),
      controllerStatus: controllerState?.status ?? null,
      switchOrigin: controllerState?.switchOrigin ?? null,
      lastError: controllerState?.lastError ?? null,
      stackAvailable:
        controller.isStackAvailable?.(controller.getActiveId()) === true,
      globeShown: globe.show === true,
      globeTilesLoaded:
        typeof globe.tilesLoaded === 'boolean' ? globe.tilesLoaded : null,
      terrainProviderClass: canonicalProviderType(globe.terrainProvider),
      terrainSamples: readTerrainSamples(),
      imageryLayerCount: scene.imageryLayers?.length ?? null,
      imageryProviderClass: canonicalProviderType(provider),
      imageryLayerShow: imageryLayer?.show ?? null,
      photorealShown: tileset?.show === true,
      photorealTilesLoaded:
        typeof tileset?.tilesLoaded === 'boolean' ? tileset.tilesLoaded : null,
      photorealReadyContentTiles: Number.isSafeInteger(
        tileset?.statistics?.numberOfTilesWithContentReady,
      )
        ? tileset.statistics.numberOfTilesWithContentReady
        : null,
      photorealSelectedTiles: Number.isSafeInteger(
        tileset?.statistics?.selected,
      )
        ? tileset.statistics.selected
        : null,
      camera: cameraState(),
      viewRectangle: viewRectangleDegrees(),
      viewport,
      settings: projectSnapshotSettings(),
      postRenderElapsedMs,
    };
  };

  const journeyAbort = new AbortController();
  const waitForPostRender = (timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let remove = null;
      const onAbort = () =>
        finish(cancellationError('Map journey was cancelled.'));
      const timer = setTimeout(
        () =>
          finish(
            new Error('Completed render did not arrive before its bound.'),
          ),
        timeoutMs,
      );
      const finish = (error, observedAt) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        try {
          remove?.();
        } catch {
          // The event may be retired with the page; the owning context closes next.
        }
        if (error) reject(error);
        else resolve(observedAt);
      };
      const listener = () => finish(null, performance.now());
      try {
        if (signal?.aborted)
          return finish(cancellationError('Map journey was cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
        remove = scene.postRender.addEventListener(listener);
        scene.requestRender?.();
      } catch (error) {
        finish(error);
      }
    });

  const isReady = (state, stackId) => {
    if (
      state.activeStack !== stackId ||
      state.controllerStatus !== 'ready' ||
      state.switchOrigin === 'automatic' ||
      state.lastError !== null ||
      state.stackAvailable !== true
    )
      return false;
    if (stackId === 'photoreal')
      return (
        state.photorealShown &&
        state.photorealTilesLoaded === true &&
        state.photorealReadyContentTiles > 0 &&
        state.photorealSelectedTiles > 0
      );
    return (
      state.globeShown &&
      state.globeTilesLoaded === true &&
      state.terrainProviderClass === 'CesiumTerrainProvider' &&
      state.imageryLayerShow === true &&
      state.imageryLayerCount > 0 &&
      state.imageryProviderClass === expectedImageryClass[stackId]
    );
  };

  const waitForReadyStack = async (stackId) => {
    const deadline = performance.now() + readyTimeoutMs;
    let readyFrames = 0;
    let last = null;
    while (performance.now() < deadline) {
      const postRenderAt = await waitForPostRender(
        Math.max(1, deadline - performance.now()),
        journeyAbort.signal,
      );
      last = captureState(postRenderAt);
      if (isReady(last, stackId)) readyFrames += 1;
      else readyFrames = 0;
      if (readyFrames >= 2) return last;
    }
    throw new Error(
      `Map stack ${stackId} lacked two completed ready renders: ${JSON.stringify(last)}`,
    );
  };

  const initialStack = controller.getActiveId();
  if (initialStack !== 'photoreal')
    throw new Error(
      `Native Google startup stack is ${initialStack}, expected photoreal.`,
    );
  const settingsBefore = projectSnapshotSettings();
  const ellipsoid = globe.ellipsoid;
  const radians = Math.PI / 180;
  const startDestination = ellipsoid.cartographicToCartesian({
    longitude: route.start.longitude * radians,
    latitude: route.start.latitude * radians,
    height: route.start.heightM,
  });
  camera.setView({
    destination: startDestination,
    orientation: {
      heading: route.headingRadians,
      pitch: route.pitchRadians,
      roll: 0,
    },
  });
  scene.requestRender?.();

  const initialState = await waitForReadyStack('photoreal');
  const transitions = [
    {
      stackId: 'photoreal',
      scheduledAtMs: 0,
      actualStartMs: 0,
      settledAtMs: 0,
      state: initialState,
    },
  ];
  const routeStartedAt = performance.now();
  const routeOrigin = {
    position: {
      x: camera.positionWC.x,
      y: camera.positionWC.y,
      z: camera.positionWC.z,
    },
    right: { x: camera.rightWC.x, y: camera.rightWC.y, z: camera.rightWC.z },
    direction: {
      x: camera.directionWC.x,
      y: camera.directionWC.y,
      z: camera.directionWC.z,
    },
    up: { x: camera.upWC.x, y: camera.upWC.y, z: camera.upWC.z },
  };
  let coverageSamples = 0;
  let coverageError = null;
  const coverage = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  const includeView = () => {
    const view = viewRectangleDegrees();
    coverage.west = Math.min(coverage.west, view.west);
    coverage.south = Math.min(coverage.south, view.south);
    coverage.east = Math.max(coverage.east, view.east);
    coverage.north = Math.max(coverage.north, view.north);
    coverageSamples += 1;
  };
  includeView();
  const routeCoverageListener = () => {
    if (journeyAbort.signal.aborted) return;
    try {
      includeView();
    } catch (error) {
      coverageError = error;
    }
  };
  const removeCoverageListener = scene.postRender.addEventListener(
    routeCoverageListener,
  );
  let animationFrame = null;
  const routeTask = new Promise((resolve, reject) => {
    const onAbort = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      finish(cancellationError('Map route was cancelled.'));
    };
    journeyAbort.signal.addEventListener('abort', onAbort, { once: true });
    const finish = (error) => {
      journeyAbort.signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const applyAt = (elapsedMs) => {
      if (journeyAbort.signal.aborted) return;
      const distance =
        (Math.min(elapsedMs, durationMs) * route.moveRightMetersPerSecond) /
        1000;
      const destination = {
        x: routeOrigin.position.x + routeOrigin.right.x * distance,
        y: routeOrigin.position.y + routeOrigin.right.y * distance,
        z: routeOrigin.position.z + routeOrigin.right.z * distance,
      };
      camera.setView({
        destination,
        orientation: { direction: routeOrigin.direction, up: routeOrigin.up },
      });
      scene.requestRender?.();
    };
    const tick = (now) => {
      if (journeyAbort.signal.aborted) return;
      animationFrame = null;
      if (coverageError) {
        finish(coverageError);
        return;
      }
      const elapsed = Math.min(durationMs, Math.max(0, now - routeStartedAt));
      try {
        applyAt(elapsed);
      } catch (error) {
        finish(error);
        return;
      }
      if (elapsed >= durationMs) {
        finish();
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    if (journeyAbort.signal.aborted) onAbort();
    else animationFrame = requestAnimationFrame(tick);
  });
  const transitionTask = (async () => {
    for (const schedule of route.stackSchedule.slice(1)) {
      if (journeyAbort.signal.aborted) return;
      const delay = routeStartedAt + schedule.atMs - performance.now();
      if (delay > 0)
        await new Promise((resolve, reject) => {
          let settled = false;
          let timer = null;
          const finishDelay = (error) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            journeyAbort.signal.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
          };
          const onAbort = () => {
            finishDelay(cancellationError('Map journey was cancelled.'));
          };
          journeyAbort.signal.addEventListener('abort', onAbort, {
            once: true,
          });
          if (journeyAbort.signal.aborted) onAbort();
          else timer = setTimeout(() => finishDelay(), delay);
        });
      if (journeyAbort.signal.aborted) return;
      const actualStartMs = performance.now() - routeStartedAt;
      const switchState = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `Map stack switch to ${schedule.stackId} exceeded its readiness bound.`,
              ),
            ),
          readyTimeoutMs,
        );
        const onAbort = () =>
          finish(cancellationError('Map journey was cancelled.'));
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          journeyAbort.signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve(value);
        };
        journeyAbort.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(controller.setStack(schedule.stackId)).then(
          (value) => finish(null, value),
          (error) => finish(error),
        );
      });
      if (
        switchState?.activeId !== schedule.stackId ||
        switchState?.lastError ||
        switchState?.switchOrigin === 'automatic'
      )
        throw new Error(
          `Native map stack switch to ${schedule.stackId} failed or fell back.`,
        );
      const state = await waitForReadyStack(schedule.stackId);
      transitions.push({
        stackId: schedule.stackId,
        scheduledAtMs: schedule.atMs,
        actualStartMs,
        settledAtMs: performance.now() - routeStartedAt,
        state,
      });
    }
  })();
  try {
    const tasks = [routeTask, transitionTask];
    try {
      await Promise.all(tasks);
    } catch (primaryError) {
      journeyAbort.abort();
      const settled = await Promise.allSettled(tasks);
      const cleanupErrors = settled
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => entry.reason)
        .filter(
          (error) =>
            error !== primaryError &&
            error?.code !== 'GEV_MAP_JOURNEY_CANCELLED',
        );
      if (cleanupErrors.length)
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'Map route or transition failed and sibling cancellation also failed.',
          { cause: primaryError },
        );
      throw primaryError;
    }
    {
      const distance = (durationMs * route.moveRightMetersPerSecond) / 1000;
      camera.setView({
        destination: {
          x: routeOrigin.position.x + routeOrigin.right.x * distance,
          y: routeOrigin.position.y + routeOrigin.right.y * distance,
          z: routeOrigin.position.z + routeOrigin.right.z * distance,
        },
        orientation: { direction: routeOrigin.direction, up: routeOrigin.up },
      });
      scene.requestRender?.();
    }
    const finalState = await waitForReadyStack('photoreal');
    includeView();
    const terrainSamples = transitions
      .filter((entry) => entry.stackId !== 'photoreal')
      .flatMap((entry) => entry.state.terrainSamples);
    const knownTerrainHeights = terrainSamples
      .map((sample) => sample.heightM)
      .filter((height) => Number.isFinite(height));
    const terrainEvidence = {
      providerClass:
        transitions.find((entry) => entry.stackId === 'esri-imagery')?.state
          .terrainProviderClass ?? null,
      sampleCount: knownTerrainHeights.length,
      minHeightM: knownTerrainHeights.length
        ? Math.min(...knownTerrainHeights)
        : null,
      maxHeightM: knownTerrainHeights.length
        ? Math.max(...knownTerrainHeights)
        : null,
    };
    const routeElapsedMs = performance.now() - routeStartedAt;
    return {
      initialStack,
      initialState,
      transitions,
      route: {
        id: route.id,
        durationMs,
        elapsedMs: routeElapsedMs,
        moveRightMetersPerSecond: route.moveRightMetersPerSecond,
        headingRadians: route.headingRadians,
        pitchRadians: route.pitchRadians,
        start: initialState.camera,
        end: finalState.camera,
        declaredBounds: route.declaredBounds,
        observedFrustumUnion: { ...coverage },
        observedFrustumSamples: coverageSamples,
        finalPostRenderObserved: true,
      },
      finalState,
      settingsBefore,
      settingsAfter: projectSnapshotSettings(),
      terrainEvidence,
    };
  } finally {
    journeyAbort.abort();
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    try {
      removeCoverageListener?.();
    } catch {
      // The page's owning context is the fallback retirement boundary.
    }
  }
}

export async function runNativeMapStreamingJourney(page, options) {
  return page.evaluate(runNativeMapStreamingJourneyInPage, options);
}

export function createMapStreamingCaptureReport({
  fixture,
  fixtureDelivery,
  journey,
  profile,
  documentDeliveries,
}) {
  validateDeterministicMapStreamingFixture(fixture);
  const report = {
    schema: MAP_STREAMING_CAPTURE_SCHEMA,
    workloadId: MAP_STREAMING_WORKLOAD_ID,
    status: 'observed',
    performanceAcceptanceEligible: false,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    buildProfile: profile,
    route: journey.route,
    initialState: journey.initialState,
    transitions: journey.transitions,
    finalState: journey.finalState,
    settingsBefore: journey.settingsBefore,
    settingsAfter: journey.settingsAfter,
    terrainEvidence: journey.terrainEvidence,
    fixtureDelivery,
    documentDeliveries,
    scope: 'full application map-stack diagnostic; no performance acceptance',
  };
  validateMapStreamingCaptureReport(report, { fixture, profile });
  return report;
}

/** Aggregate only acknowledged native requests after every owner is retired. */
export function aggregateMapStreamingDocumentDeliveries(
  fixture,
  documentDeliveries,
) {
  const counts = new Map();
  let requestedCount = 0;
  let fulfilledAckCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;
  let unexpectedFulfillmentCount = 0;
  let errorObservationCount = 0;
  for (const row of documentDeliveries) {
    const delivery = row.delivery;
    requestedCount += delivery.requestedCount;
    fulfilledAckCount += delivery.fulfilledAckCount;
    cancelledCount += delivery.cancelledCount;
    pendingCount += delivery.pendingCount;
    unexpectedFulfillmentCount += delivery.unexpectedFulfillmentCount;
    errorObservationCount += delivery.errorObservationCount;
    for (const asset of delivery.assets) {
      let total = counts.get(asset.path);
      if (!total) {
        total = {
          path: asset.path,
          sha256: asset.sha256,
          byteLength: asset.byteLength,
          requests: 0,
          fulfilledAckCount: 0,
          cancelledCount: 0,
        };
        counts.set(asset.path, total);
      }
      total.requests += asset.requests;
      total.fulfilledAckCount += asset.fulfilledAckCount;
      total.cancelledCount += asset.cancelledCount;
    }
  }
  const report = {
    schema: MAP_STREAMING_DELIVERY_SCHEMA,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    status: 'observed',
    requestedCount,
    fulfilledAckCount,
    cancelledCount,
    pendingCount,
    unexpectedFulfillmentCount,
    errorObservationCount,
    assets: [...counts.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    cleanupConfirmed: documentDeliveries.every(
      (row) =>
        row.delivery.cleanupConfirmed === true &&
        row.release?.confirmed === true,
    ),
    browserDecodeObserved: false,
    renderedReadinessObserved: false,
  };
  validateAggregatedMapDelivery(report, fixture, documentDeliveries);
  return report;
}

function validateAggregatedMapDelivery(report, fixture, documents) {
  const expectedAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  assert.equal(report?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(report.fixtureId, fixture.id);
  assert.equal(report.manifestSha256, fixture.manifestSha256);
  assert.equal(report.status, 'observed');
  assert.equal(
    report.cleanupConfirmed,
    true,
    'Aggregate map delivery requires confirmed cleanup for all owner documents.',
  );
  assert.equal(report.pendingCount, 0);
  assert.equal(report.unexpectedFulfillmentCount, 0);
  assert.equal(report.errorObservationCount, 0);
  assert.ok(Number.isSafeInteger(report.requestedCount));
  assert.ok(report.requestedCount > 0);
  assert.equal(
    report.fulfilledAckCount + report.cancelledCount,
    report.requestedCount,
  );
  const seen = new Set();
  for (const asset of report.assets) {
    const expected = expectedAssets.get(asset.path);
    assert.ok(
      expected,
      `Aggregate asset ${asset.path} belongs to the manifest.`,
    );
    assert.equal(
      seen.has(asset.path),
      false,
      `Aggregate asset ${asset.path} is unique.`,
    );
    seen.add(asset.path);
    assert.equal(asset.sha256, expected.sha256);
    assert.equal(asset.byteLength, expected.byteLength);
    assert.ok(asset.requests >= 1);
    assert.equal(
      asset.requests,
      asset.fulfilledAckCount + asset.cancelledCount,
    );
  }
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
  for (const kind of requiredKinds) {
    const delivered = report.assets.some((asset) => {
      const expected = expectedAssets.get(asset.path);
      return expected?.kind === kind && asset.fulfilledAckCount > 0;
    });
    assert.equal(
      delivered,
      true,
      `Native map asset kind ${kind} was acknowledged.`,
    );
  }
  for (const document of documents) {
    assert.equal(document.delivery.fixtureId, fixture.id);
    assert.equal(document.delivery.manifestSha256, fixture.manifestSha256);
    assert.equal(document.delivery.status, 'disposed');
    assert.equal(document.delivery.cleanupConfirmed, true);
    assert.equal(document.delivery.pendingCount, 0);
    assert.equal(document.delivery.errorObservationCount, 0);
    assert.equal(document.release.documentRole, document.documentRole);
    assert.equal(document.release.documentId, document.documentId);
    assert.equal(document.release.sessionOrdinal, document.sessionOrdinal);
    assert.equal(
      document.release.confirmed,
      true,
      `Map document ${document.documentId} release is confirmed.`,
    );
    assert.equal(
      document.release.targetClosed,
      true,
      `Map document ${document.documentId} target is closed.`,
    );
    assert.equal(
      document.release.stop?.confirmed,
      true,
      `Map document ${document.documentId} fixture stop is confirmed.`,
    );
    assert.equal(
      document.release.stop?.pendingCommandsAfterDrain,
      0,
      `Map document ${document.documentId} fixture commands drained.`,
    );
    assert.equal(
      document.release.stop?.pendingPreparationsAfterDrain,
      0,
      `Map document ${document.documentId} fixture preparations drained.`,
    );
    assert.equal(
      document.release.stop?.pendingAbortSubscriptionsAfterDrain,
      0,
      `Map document ${document.documentId} abort subscriptions drained.`,
    );
    assert.equal(
      document.release.stop?.unexpectedLateRequestCount,
      0,
      `Map document ${document.documentId} had no late fixture request.`,
    );
    assert.equal(
      document.release.interception?.confirmed,
      true,
      `Map document ${document.documentId} interception is released.`,
    );
  }
}

export function validateMapStreamingCaptureReport(
  report,
  { fixture, profile },
) {
  validateDeterministicMapStreamingFixture(fixture);
  assert.equal(report?.schema, MAP_STREAMING_CAPTURE_SCHEMA);
  assert.equal(report.workloadId, MAP_STREAMING_WORKLOAD_ID);
  assert.equal(report.status, 'observed');
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.fixtureId, MAP_STREAMING_FIXTURE_ID);
  assert.equal(report.manifestSha256, fixture.manifestSha256);
  assert.deepEqual(report.buildProfile, profile);
  assert.equal(profile?.id, MAP_FIXTURE_BUILD_PROFILE_ID);
  assert.match(profile?.configurationSha256 || '', SHA256);
  assert.equal(report.initialState?.activeStack, 'photoreal');
  assert.equal(report.initialState?.photorealShown, true);
  assert.equal(report.initialState?.photorealTilesLoaded, true);
  assert.ok(report.initialState?.photorealReadyContentTiles > 0);
  assert.ok(report.initialState?.photorealSelectedTiles > 0);
  const assertSettings = (settings, label) => {
    assert.ok(
      settings && typeof settings === 'object',
      `${label} settings exist.`,
    );
    assert.ok(
      ['manual', 'auto', 'quality', 'performance'].includes(
        settings.qualityMode,
      ),
      `${label} quality mode is recognized.`,
    );
    assert.ok(
      Number.isFinite(settings.densityPct) &&
        settings.densityPct >= 0 &&
        settings.densityPct <= 100,
      `${label} density is bounded.`,
    );
    assert.ok(
      typeof settings.detectionMode === 'string' &&
        settings.detectionMode.length > 0,
      `${label} detection mode is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.resolutionScale) && settings.resolutionScale > 0,
      `${label} resolution scale is observed.`,
    );
    assert.equal(
      typeof settings.antialias,
      'boolean',
      `${label} antialias state is observed.`,
    );
    assert.ok(
      Number.isSafeInteger(settings.msaaSamples) && settings.msaaSamples >= 0,
      `${label} MSAA setting is observed.`,
    );
    assert.equal(
      typeof settings.fxaa,
      'boolean',
      `${label} FXAA state is observed.`,
    );
    assert.equal(
      typeof settings.preserveDrawingBuffer,
      'boolean',
      `${label} drawing-buffer state is observed.`,
    );
    assert.equal(
      typeof settings.bloom,
      'boolean',
      `${label} bloom state is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.bloomIntensity),
      `${label} bloom intensity is observed.`,
    );
    assert.equal(
      typeof settings.sharpen,
      'boolean',
      `${label} sharpen state is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.sharpenIntensity),
      `${label} sharpen intensity is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.globeMaximumScreenSpaceError) &&
        settings.globeMaximumScreenSpaceError > 0,
      `${label} terrain detail is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetMaximumScreenSpaceError) &&
        settings.tilesetMaximumScreenSpaceError > 0,
      `${label} photoreal detail is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetCacheBytes) &&
        settings.tilesetCacheBytes >= 0,
      `${label} photoreal cache byte setting is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetMaximumCacheOverflowBytes) &&
        settings.tilesetMaximumCacheOverflowBytes >= 0,
      `${label} photoreal cache overflow setting is observed.`,
    );
    const visual = settings.visualState;
    assert.ok(
      visual && typeof visual === 'object',
      `${label} expanded visual state exists.`,
    );
    assert.ok(
      typeof visual.style === 'string' && visual.style.length > 0,
      `${label} style is observed.`,
    );
    assert.equal(
      typeof visual.bloom?.enabled,
      'boolean',
      `${label} expanded bloom is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.bloom?.intensity),
      `${label} expanded bloom intensity is observed.`,
    );
    assert.equal(
      typeof visual.sharpen?.enabled,
      'boolean',
      `${label} expanded sharpen is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.sharpen?.intensity),
      `${label} expanded sharpen intensity is observed.`,
    );
    assert.equal(
      typeof visual.detection?.mode,
      'string',
      `${label} expanded detection mode is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.detection?.density),
      `${label} expanded detection density is observed.`,
    );
    assert.equal(
      typeof visual.scope?.enabled,
      'boolean',
      `${label} scope state is observed.`,
    );
    assert.equal(
      typeof visual.mapStack,
      'string',
      `${label} map stack is observed.`,
    );
    assert.ok(
      visual.styleParams && typeof visual.styleParams === 'object',
      `${label} style parameters are observed.`,
    );
  };
  assertSettings(report.settingsBefore, 'Before route');
  assertSettings(report.settingsAfter, 'After route');
  const withoutMapStack = (settings) => {
    const projected = structuredClone(settings);
    projected.visualState.mapStack = null;
    return projected;
  };
  const assertUnchangedSettings = (settings, label) =>
    assert.deepEqual(
      withoutMapStack(settings),
      withoutMapStack(report.settingsBefore),
      `${label} preserves visual, density, rendering, terrain, and tileset settings.`,
    );
  assertUnchangedSettings(report.settingsAfter, 'Final route settings');
  assertUnchangedSettings(
    report.initialState?.settings,
    'Initial render settings',
  );
  assert.equal(
    report.initialState?.settings?.visualState?.mapStack,
    'photoreal',
    'Initial visual settings record the selected photoreal stack.',
  );
  assert.equal(
    report.transitions?.length,
    MAP_STREAMING_ROUTE.stackSchedule.length,
  );
  for (
    let index = 0;
    index < MAP_STREAMING_ROUTE.stackSchedule.length;
    index += 1
  ) {
    const expected = MAP_STREAMING_ROUTE.stackSchedule[index];
    const transition = report.transitions[index];
    assert.equal(transition?.stackId, expected.stackId);
    assert.equal(transition?.scheduledAtMs, expected.atMs);
    assert.equal(transition?.state?.activeStack, expected.stackId);
    assert.equal(transition?.state?.controllerStatus, 'ready');
    assert.equal(transition?.state?.lastError, null);
    assert.equal(transition?.state?.switchOrigin, 'manual');
    assert.equal(transition?.state?.stackAvailable, true);
    assertUnchangedSettings(
      transition?.state?.settings,
      `Transition ${expected.stackId} settings`,
    );
    assert.equal(
      transition?.state?.settings?.visualState?.mapStack,
      expected.stackId,
      `Transition ${expected.stackId} visual settings record the selected stack.`,
    );
    assert.ok(Number.isFinite(transition?.state?.postRenderElapsedMs));
    if (expected.stackId === 'photoreal') {
      assert.equal(transition.state.photorealShown, true);
      assert.ok(transition.state.photorealReadyContentTiles > 0);
      assert.ok(transition.state.photorealSelectedTiles > 0);
      assert.equal(transition.state.photorealTilesLoaded, true);
    } else {
      assert.equal(transition.state.globeShown, true);
      assert.equal(transition.state.globeTilesLoaded, true);
      assert.equal(
        transition.state.terrainProviderClass,
        'CesiumTerrainProvider',
      );
      assert.equal(transition.state.imageryLayerShow, true);
      assert.ok(transition.state.imageryLayerCount > 0);
      assert.equal(
        transition.state.imageryProviderClass,
        EXPECTED_IMAGERY_CLASS[expected.stackId],
      );
      assert.ok(
        transition.state.terrainSamples.some(
          (sample) => Number.isFinite(sample.heightM) && sample.heightM > 0,
        ),
      );
    }
  }
  assert.equal(report.finalState?.activeStack, 'photoreal');
  assertUnchangedSettings(report.finalState?.settings, 'Final rendered state');
  assert.equal(
    report.finalState?.settings?.visualState?.mapStack,
    'photoreal',
    'Final visual settings record the restored photoreal stack.',
  );
  assert.ok(report.finalState?.photorealSelectedTiles > 0);
  assert.equal(report.finalState?.photorealTilesLoaded, true);
  assert.equal(report.finalState?.lastError, null);
  assert.equal(report.route?.id, MAP_STREAMING_ROUTE.id);
  assert.equal(
    report.route?.moveRightMetersPerSecond,
    MAP_STREAMING_ROUTE.moveRightMetersPerSecond,
  );
  assert.equal(
    report.route?.headingRadians,
    MAP_STREAMING_ROUTE.headingRadians,
  );
  assert.equal(report.route?.pitchRadians, MAP_STREAMING_ROUTE.pitchRadians);
  assert.ok(report.route?.elapsedMs >= report.route?.durationMs);
  assert.ok(
    report.route?.durationMs > 0 &&
      report.route.durationMs <= MAP_STREAMING_ROUTE.durationLimitMs,
  );
  assert.ok(report.route?.finalPostRenderObserved === true);
  const routeStart = report.route?.start;
  const routeEnd = report.route?.end;
  const expectedSurfaceDistanceM =
    (report.route.durationMs * MAP_STREAMING_ROUTE.moveRightMetersPerSecond) /
    1000;
  assert.ok(routeStart && routeEnd, 'Observed route endpoints are present.');
  assert.ok(
    Math.abs(routeStart.longitude - MAP_STREAMING_ROUTE.start.longitude) <
      0.0001 &&
      Math.abs(routeStart.latitude - MAP_STREAMING_ROUTE.start.latitude) <
        0.0001 &&
      Math.abs(routeStart.heightM - MAP_STREAMING_ROUTE.start.heightM) < 1,
    'Observed route starts at the declared native camera pose.',
  );
  assert.deepEqual(
    routeStart,
    report.initialState.camera,
    'Route start is the actual initial camera observation.',
  );
  assert.deepEqual(
    routeEnd,
    report.finalState.camera,
    'Route end is the actual final camera observation.',
  );
  const angularDifference = (actual, expected) =>
    Math.abs(
      Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)),
    );
  assert.ok(
    angularDifference(
      routeStart.headingRadians,
      MAP_STREAMING_ROUTE.headingRadians,
    ) < 0.001 &&
      Math.abs(routeStart.pitchRadians - MAP_STREAMING_ROUTE.pitchRadians) <
        0.001,
    'Observed route starts with the declared native camera orientation.',
  );
  assert.ok(
    Math.abs(routeEnd.latitude - routeStart.latitude) < 0.0001 &&
      Math.abs(routeEnd.heightM - routeStart.heightM) <=
        Math.max(1, expectedSurfaceDistanceM * 0.001),
    'Observed route endpoint follows the declared eastward tangent-plane route.',
  );
  assert.ok(
    angularDifference(
      routeEnd.headingRadians,
      MAP_STREAMING_ROUTE.headingRadians,
    ) < 0.003 &&
      Math.abs(routeEnd.pitchRadians - MAP_STREAMING_ROUTE.pitchRadians) <
        0.003,
    'Observed route ends with the declared native camera orientation.',
  );
  assert.ok(
    routeEnd.longitude > routeStart.longitude,
    'Observed route moves east along the declared rightward camera path.',
  );
  const radians = Math.PI / 180;
  const latitudeMidpoint =
    ((routeStart.latitude + routeEnd.latitude) / 2) * radians;
  const longitudeDelta = (routeEnd.longitude - routeStart.longitude) * radians;
  const latitudeDelta = (routeEnd.latitude - routeStart.latitude) * radians;
  const routeSurfaceDistanceM =
    6_371_008.8 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
          Math.cos(latitudeMidpoint) ** 2 * Math.sin(longitudeDelta / 2) ** 2,
      ),
    );
  assert.ok(
    Math.abs(routeSurfaceDistanceM - expectedSurfaceDistanceM) <=
      Math.max(5, expectedSurfaceDistanceM * 0.01),
    `Observed route displacement ${routeSurfaceDistanceM}m matches declared ${expectedSurfaceDistanceM}m elapsed-time movement.`,
  );
  assert.ok(report.route?.observedFrustumSamples >= 2);
  assert.deepEqual(
    report.route?.declaredBounds,
    fixture.manifest.routeBoundsDegrees,
  );
  const bounds = report.route?.declaredBounds;
  const observed = report.route?.observedFrustumUnion;
  assert.ok(observed && bounds);
  assert.ok(
    observed.west >= bounds.west &&
      observed.south >= bounds.south &&
      observed.east <= bounds.east &&
      observed.north <= bounds.north,
    'Every sampled native camera frustum remains within declared fixture coverage.',
  );
  assert.ok(
    Math.abs(report.route.end.longitude - report.route.start.longitude) > 0.01,
    'Elapsed route changes camera position.',
  );
  assert.equal(report.terrainEvidence?.providerClass, 'CesiumTerrainProvider');
  assert.ok(report.terrainEvidence.sampleCount >= 2);
  assert.ok(report.terrainEvidence.minHeightM >= 120);
  assert.ok(report.terrainEvidence.maxHeightM <= 880);
  assert.ok(
    report.terrainEvidence.maxHeightM > report.terrainEvidence.minHeightM,
    'Terrain samples prove nonflat rendered heights.',
  );
  const manifestAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  assert.equal(report.fixtureDelivery?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(report.fixtureDelivery?.fixtureId, fixture.id);
  assert.equal(report.fixtureDelivery?.manifestSha256, fixture.manifestSha256);
  assert.equal(report.fixtureDelivery?.cleanupConfirmed, true);
  assert.equal(report.fixtureDelivery?.pendingCount, 0);
  assert.equal(report.fixtureDelivery?.unexpectedFulfillmentCount, 0);
  assert.equal(report.fixtureDelivery?.errorObservationCount, 0);
  assert.ok(Array.isArray(report.fixtureDelivery.assets));
  const delivered = new Map();
  for (const asset of report.fixtureDelivery.assets) {
    const expected = manifestAssets.get(asset.path);
    assert.ok(
      expected,
      `Delivered map asset ${asset.path} is in fixture manifest.`,
    );
    assert.equal(asset.sha256, expected.sha256);
    assert.equal(asset.byteLength, expected.byteLength);
    assert.ok(Number.isSafeInteger(asset.requests) && asset.requests >= 1);
    assert.ok(
      Number.isSafeInteger(asset.fulfilledAckCount) &&
        asset.fulfilledAckCount >= 1,
    );
    delivered.set(
      expected.kind,
      (delivered.get(expected.kind) || 0) + asset.fulfilledAckCount,
    );
  }
  assert.ok(
    (delivered.get('3d-tiles-1.1') || 0) >= 1,
    'Native Google root tileset was acknowledged.',
  );
  assert.ok(
    (delivered.get('textured-glb') || 0) >= 1,
    'Native Google content tile was acknowledged.',
  );
  assert.ok(
    (delivered.get('arcgis-mapserver-metadata-json') || 0) >= 1,
    'Native Esri metadata was acknowledged.',
  );
  assert.ok(
    (delivered.get('webmercator-imagery-png') || 0) >= 1,
    'Native imagery tiles were acknowledged.',
  );
  assert.ok(
    (delivered.get('quantized-mesh-layer-metadata') || 0) >= 1,
    'Native terrain metadata was acknowledged.',
  );
  assert.ok(
    (delivered.get('quantized-mesh-1.0') || 0) >= 1,
    'Native terrain meshes were acknowledged.',
  );
  assert.ok(Array.isArray(report.documentDeliveries));
  assert.ok(
    report.documentDeliveries.length >= 1 &&
      report.documentDeliveries.length <= 16,
  );
  const identities = new Set();
  for (const row of report.documentDeliveries) {
    assert.match(row.documentRole || '', /^[a-z0-9-]{1,48}$/i);
    assert.match(row.documentId || '', /^[a-z0-9._:-]{1,96}$/i);
    assert.ok(
      Number.isSafeInteger(row.sessionOrdinal) && row.sessionOrdinal > 0,
    );
    const identity = `${row.documentRole}\0${row.documentId}\0${row.sessionOrdinal}`;
    assert.equal(
      identities.has(identity),
      false,
      'Map fixture document identity is unique.',
    );
    identities.add(identity);
    assert.equal(row.delivery?.cleanupConfirmed, true);
  }
  const recomputedDelivery = aggregateMapStreamingDocumentDeliveries(
    fixture,
    report.documentDeliveries,
  );
  assert.deepEqual(
    report.fixtureDelivery,
    recomputedDelivery,
    'Aggregate fixture delivery is recomputed from every acknowledged document owner.',
  );
  return true;
}
