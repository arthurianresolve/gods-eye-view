import * as Cesium from 'cesium';
import { MapSourceController } from '../../src/maps/controller.js';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { installWorkerDiagnostics } from '../performance/workerDiagnostics.mjs';

installWorkerDiagnostics(window);
window.__terrainPickingBuildIdentity = {
  applicationCommit:
    typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
  harnessCommit:
    typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
};

const STATUS = document.querySelector('#status');
const RESULT = document.querySelector('#result');
const RUN = document.querySelector('#run');
const VIEWER_SIZE = Object.freeze({ width: 960, height: 640 });
const DRAIN_MS = 10_000;
const READY_MS = 30_000;
const CYCLES = 5;
const CAMERA = Object.freeze({ longitude: 0, latitude: 0, height: 90_000 });
let lifecycleCycles = CYCLES;
let lifecycleDrainMs = DRAIN_MS;

function snapshotWorkers() {
  const snapshot = window.__gevSoakWorkers?.snapshot?.();
  if (
    !snapshot ||
    snapshot.instrumented !== true ||
    snapshot.overflow !== false ||
    !Array.isArray(snapshot.workers) ||
    snapshot.workers.length > 64
  )
    throw new Error(
      'Worker diagnostics are missing, overflowing, or malformed.',
    );
  for (const worker of snapshot.workers) {
    const values = [
      worker.submitted,
      worker.completed,
      worker.cancelled,
      worker.pending,
      worker.taskErrors,
      worker.workerErrors,
      worker.postErrors,
    ];
    if (
      values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      worker.submitted !==
        worker.completed + worker.cancelled + worker.pending ||
      worker.taskErrors ||
      worker.workerErrors ||
      worker.postErrors
    )
      throw new Error(
        'Worker counters report pending, invalid, or failed work.',
      );
  }
  return {
    instrumented: true,
    overflow: false,
    pending: snapshot.pending,
    workers: snapshot.workers.map(({ kind, ...worker }) => ({
      kind,
      ...worker,
    })),
  };
}

function workerSignature(snapshot) {
  return JSON.stringify(
    snapshot.workers.map((worker) => ({
      kind: worker.kind,
      submitted: worker.submitted,
      completed: worker.completed,
      cancelled: worker.cancelled,
      pending: worker.pending,
      taskErrors: worker.taskErrors,
      workerErrors: worker.workerErrors,
      postErrors: worker.postErrors,
    })),
  );
}

function workerTotals(snapshot) {
  return snapshot.workers.reduce(
    (totals, worker) => {
      totals.submitted += worker.submitted;
      totals.completed += worker.completed;
      totals.cancelled += worker.cancelled;
      totals.pending += worker.pending;
      return totals;
    },
    { submitted: 0, completed: 0, cancelled: 0, pending: 0 },
  );
}

function workerKindTotals(snapshot) {
  return Object.fromEntries(
    snapshot.workers.map((worker) => [
      worker.kind,
      {
        submitted: worker.submitted,
        completed: worker.completed,
        cancelled: worker.cancelled,
        pending: worker.pending,
      },
    ]),
  );
}

function resetFixtureCamera(viewer) {
  viewer.camera.cancelFlight();
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      CAMERA.longitude,
      CAMERA.latitude,
      CAMERA.height,
    ),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
  });
}

function cameraPose(viewer) {
  const camera = viewer.camera;
  const vectors = [camera.positionWC, camera.directionWC, camera.upWC];
  if (
    vectors.some(
      (vector) =>
        !vector || ![vector.x, vector.y, vector.z].every(Number.isFinite),
    )
  )
    return null;
  return vectors.map((vector) => [vector.x, vector.y, vector.z]);
}

function diagnosticSnapshot(viewer, controller, cableLayer) {
  const workerCounters = snapshotWorkers();
  const canvas = viewer.scene.canvas;
  return {
    map: controller.getPerformanceDiagnostics(),
    cables: cableLayer.getPerformanceDiagnostics(),
    scene: {
      dataSources: viewer.dataSources.length,
      imageryLayers: viewer.imageryLayers.length,
      primitives: viewer.scene.primitives.length,
      terrainProviderKind: viewer.terrainProvider?.constructor?.name || null,
      globeTilesLoaded: viewer.scene.globe.tilesLoaded,
      dataSourceDisplayReady: viewer.dataSourceDisplay.ready,
      frameNumber: viewer.scene.frameState.frameNumber,
      postRenderCount,
      canvas: [canvas.width, canvas.height],
      camera: cameraPose(viewer),
      renderer: readRendererOnce(viewer),
    },
    workerCounters,
  };
}

let postRenderCount = 0;
let rendererCaptured = false;
let rendererInfo = null;

function readRendererOnce(viewer) {
  if (rendererCaptured) return rendererInfo;
  rendererCaptured = true;
  const gl =
    viewer.scene.context?._originalGLContext ||
    viewer.scene.context?._gl ||
    null;
  if (!gl) return null;
  try {
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    rendererInfo = {
      vendor: String(gl.getParameter(gl.VENDOR) || '').slice(0, 120),
      renderer: String(gl.getParameter(gl.RENDERER) || '').slice(0, 160),
      unmaskedVendor: extension
        ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) || '').slice(
            0,
            120,
          )
        : null,
      unmaskedRenderer: extension
        ? String(
            gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '',
          ).slice(0, 160)
        : null,
    };
  } catch {}
  return rendererInfo;
}

function waitFor(predicate, timeoutMs, label, onPoll = null) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      let result;
      try {
        result = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (result) {
        resolve({ elapsedMs: performance.now() - started, value: result });
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        reject(new Error(`${label} exceeded ${timeoutMs}ms.`));
        return;
      }
      try {
        onPoll?.();
      } catch (error) {
        reject(error);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

function boundedErrorDetails(error, depth = 0) {
  if (!error || depth > 2) return null;
  const sanitizeMessage = (value) =>
    String(value || 'Unknown failure')
      .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 300);
  const detail = {
    name: String(error.name || 'Error').slice(0, 80),
    message: sanitizeMessage(error.message || error),
  };
  if (error.cause) detail.cause = boundedErrorDetails(error.cause, depth + 1);
  return detail;
}

async function waitForStableScene(
  viewer,
  label,
  timeoutMs = lifecycleDrainMs,
  onSample = null,
) {
  const started = performance.now();
  const history = [];
  let stableSince = null;
  let previous = null;
  while (performance.now() - started <= timeoutMs) {
    const workers = snapshotWorkers();
    const pose = cameraPose(viewer);
    const sample = {
      elapsedMs: performance.now() - started,
      frameNumber: viewer.scene.frameState.frameNumber,
      postRenderCount,
      tilesLoaded: viewer.scene.globe.tilesLoaded,
      dataSourceDisplayReady: viewer.dataSourceDisplay.ready,
      pending: workers.pending,
      workerCounters: workers,
      workerSignature: workerSignature(workers),
      camera: pose,
    };
    if (history.length < 64) history.push(sample);
    onSample?.(sample);
    const stable =
      sample.tilesLoaded === true &&
      viewer.dataSourceDisplay.ready === true &&
      sample.pending === 0 &&
      sample.camera &&
      sample.frameNumber >= 0 &&
      previous &&
      sample.workerSignature === previous.workerSignature &&
      JSON.stringify(sample.camera) === JSON.stringify(previous.camera) &&
      sample.postRenderCount > previous.postRenderCount;
    if (stable) {
      stableSince ??= sample.elapsedMs;
      if (sample.elapsedMs - stableSince >= 1000 && history.length >= 3)
        return {
          status: 'ready',
          label,
          elapsedMs: performance.now() - started,
          stableWindowMs: sample.elapsedMs - stableSince,
          samples: history,
          final: sample,
        };
    } else stableSince = null;
    previous = sample;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Object.assign(
    new Error(`${label} did not reach stable scene ownership.`),
    {
      sceneHistory: history,
    },
  );
}

function cableFixture() {
  return {
    cables: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'qa-cable-1',
          properties: { id: 'qa-cable-1', name: 'Local cable fixture' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-0.02, 0],
              [0.02, 0],
            ],
          },
        },
      ],
    },
    landingPoints: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'qa-landing-1',
          properties: { id: 'qa-landing-1', name: 'Local landing fixture' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    },
  };
}

function localImageryProvider(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);
  return new Cesium.SingleTileImageryProvider({
    url: canvas.toDataURL(),
    tileWidth: 2,
    tileHeight: 2,
  });
}

function createLocalReliefProvider(requestCount) {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: 16,
    height: 16,
    callback(x, y, level) {
      requestCount.count++;
      const heights = new Float32Array(16 * 16);
      for (let index = 0; index < heights.length; index++)
        heights[index] = 40 + ((x * 3 + y * 5 + level + index) % 20);
      return heights;
    },
  });
}

function createMapController(viewer, mapEvents, terrainCalls, delayed) {
  const imageryA = localImageryProvider('#406080');
  const imageryB = localImageryProvider('#806040');
  const registry = {
    defaultId: 'qa-terrain-flat',
    sources: [
      {
        descriptor: {
          id: 'qa-terrain-flat',
          label: 'Fixture flat',
          kind: 'imagery',
        },
        imagery: async ({ signal }) => {
          signal.throwIfAborted();
          return imageryA;
        },
        terrain: {
          id: 'qa-flat-provider',
          create: async ({ signal }) => {
            signal.throwIfAborted();
            terrainCalls.flat++;
            return { provider: new Cesium.EllipsoidTerrainProvider() };
          },
        },
      },
      {
        descriptor: {
          id: 'qa-terrain-relief',
          label: 'Fixture relief',
          kind: 'imagery',
        },
        imagery: async ({ signal }) => {
          signal.throwIfAborted();
          return imageryB;
        },
        terrain: {
          id: 'qa-heightmap-provider',
          create: async ({ signal }) => {
            signal.throwIfAborted();
            terrainCalls.relief++;
            return { provider: createLocalReliefProvider(terrainCalls.tiles) };
          },
        },
      },
      {
        descriptor: {
          id: 'qa-terrain-delayed',
          label: 'Fixture delayed',
          kind: 'imagery',
        },
        imagery: async ({ signal }) => {
          signal.throwIfAborted();
          return imageryA;
        },
        terrain: {
          id: 'qa-delayed-provider',
          create: ({ signal }) => {
            terrainCalls.delayedSignal = signal;
            terrainCalls.delayed++;
            return delayed.promise;
          },
        },
      },
    ],
  };
  return new MapSourceController(viewer, {
    registry,
    createImageryLayer: (provider) => new Cesium.ImageryLayer(provider),
    onChange(state) {
      if (state.status !== 'ready' && state.status !== 'error') return;
      const event = new Event('gev:map-stack-changed');
      event.detail = { activeId: state.activeId };
      mapEvents.dispatchEvent(event);
    },
  });
}

function boundsMatch(snapshot, baseline) {
  const sameCamera =
    snapshot.scene.camera?.length === baseline.scene.camera?.length &&
    snapshot.scene.camera.every((vector, vectorIndex) =>
      vector.every(
        (value, axis) =>
          Math.abs(value - baseline.scene.camera[vectorIndex][axis]) <= 1e-6,
      ),
    );
  return (
    snapshot.map.cacheEntries === baseline.map.cacheEntries &&
    snapshot.map.pendingJobs === baseline.map.pendingJobs &&
    snapshot.map.primitives === baseline.map.primitives &&
    snapshot.map.imageryLayers === baseline.map.imageryLayers &&
    snapshot.cables.dataSources === baseline.cables.dataSources &&
    snapshot.cables.listeners === baseline.cables.listeners &&
    snapshot.cables.pendingJobs === baseline.cables.pendingJobs &&
    snapshot.cables.cacheEntries === baseline.cables.cacheEntries &&
    snapshot.scene.dataSources === baseline.scene.dataSources &&
    snapshot.scene.imageryLayers === baseline.scene.imageryLayers &&
    snapshot.scene.primitives === baseline.scene.primitives &&
    snapshot.scene.terrainProviderKind === 'EllipsoidTerrainProvider' &&
    sameCamera &&
    snapshot.workerCounters.pending === 0
  );
}

async function runFixture() {
  const options = window.__terrainPickingLifecycleOptions || {};
  lifecycleCycles = Number.isSafeInteger(options.cycles)
    ? options.cycles
    : CYCLES;
  lifecycleDrainMs = Number.isSafeInteger(options.drainMs)
    ? options.drainMs
    : DRAIN_MS;
  const startedAt = new Date().toISOString();
  const report = {
    schema: 'gev-terrain-picking-lifecycle/v1',
    status: 'running',
    applicationCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    harnessCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    fixture: {
      identity: 'local-geojson-custom-heightmap-v1',
      externalProviderCalls: 0,
      terrain:
        'Cesium CustomHeightmapTerrainProvider 16x16 deterministic local heights; ellipsoid reset provider',
      cableFeatures: 1,
      landingFeatures: 1,
      viewport: VIEWER_SIZE,
      camera: CAMERA,
      cycles: lifecycleCycles,
      coldReadinessBudgetMs: READY_MS,
      operationDrainBudgetMs: lifecycleDrainMs,
      terrainCoverage:
        'local custom heightmap tiles and ellipsoid reset; no network quantized-mesh tiles',
    },
    startedAt,
    initialReadiness: null,
    warmup: null,
    cycles: [],
    staleTerrainReplacement: null,
    destroyLateTerrain: null,
    cleanup: null,
    failedPhase: null,
    error: null,
  };
  const publish = () => {
    try {
      window.__terrainPickingLifecycleProgress = {
        status: report.status,
        phase: report.phase || report.failedPhase || 'initialization',
        failedPhase: report.failedPhase || null,
        currentObservation: report.currentObservation || null,
      };
      window.__terrainPickingLifecycleResult = JSON.parse(
        JSON.stringify(report),
      );
    } catch {}
  };
  publish();
  let lastObservationPublishedAt = 0;
  const observe = (stage, observation, force = false) => {
    report.currentObservation = { stage, ...observation };
    const now = performance.now();
    if (force || now - lastObservationPublishedAt >= 250) {
      lastObservationPublishedAt = now;
      publish();
    }
  };
  const sceneObserver = (label) => (sample) => observe(label, sample);
  const waitForScene = (label, timeoutMs = lifecycleDrainMs) =>
    waitForStableScene(viewer, label, timeoutMs, sceneObserver(label));
  let viewer;
  let controller;
  let cableLayer;
  let postRenderRemove;
  let originalMapEvents = 0;
  const mapEvents = new EventTarget();
  const terrainCalls = { flat: 0, relief: 0, delayed: 0, tiles: { count: 0 } };
  let delayed = deferred();
  let currentPick = null;
  let cameraFlights = 0;
  let cableFetches = 0;
  let handler;
  const overlay = {
    entries: [],
    visible: false,
    clearSource() {
      this.entries = [];
    },
    setEntries(_source, entries) {
      this.entries = entries.slice();
    },
    setVisible(_source, visible) {
      this.visible = visible;
    },
  };
  try {
    viewer = new Cesium.Viewer('viewer', {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      infoBox: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      requestRenderMode: false,
      msaaSamples: 1,
    });
    viewer.resize();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        CAMERA.longitude,
        CAMERA.latitude,
        CAMERA.height,
      ),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
    });
    postRenderRemove = viewer.scene.postRender.addEventListener(() => {
      postRenderCount++;
    });
    const source = {
      label: 'S49 local synthetic cable fixture',
      async fetch(signal) {
        cableFetches++;
        signal.throwIfAborted();
        return cableFixture();
      },
    };
    cableLayer = createSubmarineCableLayer({
      source,
      overlayHost: overlay,
      mapStackEventTarget: mapEvents,
      sweepClock: () => performance.now(),
      screenSpaceEventHandlerFactory(canvas) {
        handler = new Cesium.ScreenSpaceEventHandler(canvas);
        return handler;
      },
    });
    cableLayer.init(viewer);
    cableLayer.enable(viewer);
    controller = createMapController(viewer, mapEvents, terrainCalls, delayed);

    report.phase = 'initial-local-terrain-and-entity-warmup';
    publish();
    observe(
      report.phase,
      diagnosticSnapshot(viewer, controller, cableLayer),
      true,
    );
    await controller.setStack('qa-terrain-flat');
    await waitFor(
      () =>
        cableLayer.getStats().loading === false &&
        cableLayer.getStats().count === 2,
      lifecycleDrainMs,
      'local cable load',
      () => {
        const workers = snapshotWorkers();
        observe('local-cable-load', {
          cableStats: cableLayer.getStats(),
          workerCounters: workers,
          frameNumber: viewer.scene.frameState.frameNumber,
          tilesLoaded: viewer.scene.globe.tilesLoaded,
          dataSourceDisplayReady: viewer.dataSourceDisplay.ready,
          camera: cameraPose(viewer),
        });
      },
    );
    await waitForStableScene(
      viewer,
      report.phase,
      READY_MS,
      sceneObserver(report.phase),
    );
    report.initialReadiness = diagnosticSnapshot(
      viewer,
      controller,
      cableLayer,
    );
    publish();
    const beforePick = cameraFlights;
    const center = new Cesium.Cartesian2(
      viewer.canvas.clientWidth / 2,
      viewer.canvas.clientHeight / 2,
    );
    const nativeFlyTo = viewer.camera.flyTo.bind(viewer.camera);
    viewer.camera.flyTo = (...args) => {
      cameraFlights++;
      return nativeFlyTo(...args);
    };
    currentPick = viewer.scene.pick(center);
    if (!currentPick?.id || !cableLayer.getStats().count)
      throw new Error(
        'Actual Cesium scene pick did not resolve a fixture entity.',
      );
    handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
      position: center,
    });
    if (cameraFlights !== beforePick + 1)
      throw new Error(
        'Production click action did not fly to the actual picked cable entity.',
      );
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        CAMERA.longitude,
        CAMERA.latitude,
        CAMERA.height,
      ),
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    });
    report.initialPick = {
      status: 'passed',
      pickedEntityId: String(currentPick.id.id).slice(0, 120),
      cameraFlights,
      center: [center.x, center.y],
    };
    publish();

    report.phase = 'warm-relief-provider';
    publish();
    const firstTerrainBefore = diagnosticSnapshot(
      viewer,
      controller,
      cableLayer,
    );
    const firstTerrainSubmitted = workerTotals(
      firstTerrainBefore.workerCounters,
    );
    const firstTerrainKindsBefore = workerKindTotals(
      firstTerrainBefore.workerCounters,
    );
    const firstTerrainTileRequestsBefore = terrainCalls.tiles.count;
    report.firstTerrainTransition = {
      status: 'running',
      beforeWorkerCounters: firstTerrainBefore.workerCounters,
      beforeWorkerTotals: firstTerrainSubmitted,
      workerKindTotalsBefore: firstTerrainKindsBefore,
      tileRequestsBefore: firstTerrainTileRequestsBefore,
      initialSceneAndCableWorkerActivity: {
        scope:
          'cumulative startup, cable, and initial flat-scene worker work before heightmap terrain is selected',
        atInitialReadiness: report.initialReadiness.workerCounters,
        beforeTerrainSwitch: firstTerrainBefore.workerCounters,
      },
    };
    publish();
    await controller.setStack('qa-terrain-relief');
    await waitForScene(report.phase);
    const firstTerrainAfter = diagnosticSnapshot(
      viewer,
      controller,
      cableLayer,
    );
    const firstTerrainCompleted = workerTotals(
      firstTerrainAfter.workerCounters,
    );
    const submittedDelta =
      firstTerrainCompleted.submitted - firstTerrainSubmitted.submitted;
    const completedDelta =
      firstTerrainCompleted.completed - firstTerrainSubmitted.completed;
    const tileRequestsAfter = terrainCalls.tiles.count;
    const transitionPassed =
      submittedDelta > 0 && completedDelta > 0 && tileRequestsAfter > 0;
    Object.assign(report.firstTerrainTransition, {
      status: transitionPassed ? 'passed' : 'failed',
      beforeWorkerCounters: firstTerrainBefore.workerCounters,
      afterWorkerCounters: firstTerrainAfter.workerCounters,
      beforeWorkerTotals: firstTerrainSubmitted,
      afterWorkerTotals: firstTerrainCompleted,
      workerKindTotalsBefore: firstTerrainKindsBefore,
      workerKindTotalsAfter: workerKindTotals(firstTerrainAfter.workerCounters),
      submittedDelta,
      completedDelta,
      tileRequestsBefore: firstTerrainTileRequestsBefore,
      tileRequestsAfter,
      scope:
        'cumulative worker activity during the first local heightmap switch; worker counters include all fixture work',
    });
    publish();
    if (!transitionPassed)
      throw new Error(
        'The first local heightmap transition did not produce tile requests and completed worker activity.',
      );
    await controller.setStack('qa-terrain-flat');
    await waitForScene('return-to-flat-baseline');
    const baseline = diagnosticSnapshot(viewer, controller, cableLayer);
    if (
      baseline.map.pendingJobs ||
      baseline.cables.pendingJobs ||
      baseline.workerCounters.pending
    )
      throw new Error('Warm fixture baseline still owns pending work.');
    report.warmup = baseline;
    report.localTerrain = { tileRequests: terrainCalls.tiles.count };
    publish();

    for (let cycle = 1; cycle <= lifecycleCycles; cycle++) {
      const row = { cycle, status: 'running', checkpoints: [] };
      report.cycles.push(row);
      publish();
      await controller.setStack('qa-terrain-relief');
      row.relief = await waitForScene(`cycle-${cycle}-relief`);
      row.reliefSnapshot = diagnosticSnapshot(viewer, controller, cableLayer);
      if (
        row.reliefSnapshot.scene.terrainProviderKind !==
        'CustomHeightmapTerrainProvider'
      )
        throw new Error(`Cycle ${cycle} did not install local relief terrain.`);
      await controller.setStack('qa-terrain-flat');
      row.flat = await waitForScene(`cycle-${cycle}-flat`);
      row.flatSnapshot = diagnosticSnapshot(viewer, controller, cableLayer);
      if (!boundsMatch(row.flatSnapshot, baseline))
        throw new Error(
          `Cycle ${cycle} did not return to warmed ownership baseline.`,
        );
      row.status = 'passed';
      publish();
    }

    report.phase = 'stale-terrain-provider-replacement';
    publish();
    const delayedStarted = waitFor(
      () => terrainCalls.delayed > 0,
      lifecycleDrainMs,
      'delayed terrain factory',
    ).catch((error) => {
      throw error;
    });
    const staleSwitch = controller.setStack('qa-terrain-delayed');
    await delayedStarted;
    const replacement = controller.setStack('qa-terrain-relief');
    await replacement;
    await waitForScene('stale-terrain-replacement');
    const providerBeforeLate = viewer.terrainProvider;
    delayed.resolve({ provider: new Cesium.EllipsoidTerrainProvider() });
    await staleSwitch;
    if (
      viewer.terrainProvider !== providerBeforeLate ||
      controller.getActiveId() !== 'qa-terrain-relief'
    )
      throw new Error(
        'A stale local terrain completion replaced the selected map.',
      );
    report.staleTerrainReplacement = {
      status: 'passed',
      delayedSignalAborted: terrainCalls.delayedSignal?.aborted === true,
      selectedStack: controller.getActiveId(),
      installedProviderKind: viewer.terrainProvider?.constructor?.name || null,
    };
    publish();

    report.phase = 'cable-disable-reenable-stale-pick';
    publish();
    const staleEntity = currentPick?.id;
    const nativeScenePick = viewer.scene.pick.bind(viewer.scene);
    const selectionRows = [];
    let retiredEntity = staleEntity;
    for (let cycle = 1; cycle <= 3; cycle++) {
      cableLayer.disable();
      if (
        viewer.dataSources.length !== 0 ||
        cableLayer.getPerformanceDiagnostics().dataSources !== 0
      )
        throw new Error(
          `Cable disable ${cycle} did not release Cesium data sources.`,
        );
      const beforeStaleClick = cameraFlights;
      viewer.scene.pick = () => ({ id: retiredEntity });
      handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
        position: center,
      });
      if (cameraFlights !== beforeStaleClick)
        throw new Error(
          `Retired pick ${cycle} triggered camera selection while disabled.`,
        );
      viewer.scene.pick = nativeScenePick;
      cableLayer.enable(viewer);
      await waitFor(
        () =>
          !cableLayer.getStats().loading && cableLayer.getStats().count === 2,
        lifecycleDrainMs,
        `cable re-enable ${cycle}`,
      );
      await waitForScene(`cable-reenabled-${cycle}`);
      const activeEntity = viewer.scene.pick(center)?.id;
      if (!activeEntity || activeEntity === retiredEntity)
        throw new Error(
          `Re-enable ${cycle} did not produce a fresh Cesium pick target.`,
        );
      const beforeCurrentClick = cameraFlights;
      handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
        position: center,
      });
      if (cameraFlights !== beforeCurrentClick + 1)
        throw new Error(
          `Current pick ${cycle} did not select its active cable entity.`,
        );
      resetFixtureCamera(viewer);
      await waitForScene(`selection-camera-reset-${cycle}`);
      const beforeRetiredClick = cameraFlights;
      viewer.scene.pick = () => ({ id: retiredEntity });
      handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
        position: center,
      });
      if (cameraFlights !== beforeRetiredClick)
        throw new Error(`Retired pick ${cycle} was accepted after re-enable.`);
      viewer.scene.pick = nativeScenePick;
      selectionRows.push({
        cycle,
        retiredEntityId: String(retiredEntity?.id || '').slice(0, 120),
        activeEntityId: String(activeEntity.id || '').slice(0, 120),
        activePickSelected: true,
        retiredPickRejected: true,
      });
      publish();
      retiredEntity = activeEntity;
    }
    report.selectionLifecycle = {
      status: 'passed',
      sourceFetches: cableFetches,
      completedReenablePicks: selectionRows.length,
      stalePickAccepted: false,
      cameraFlights,
      cycles: selectionRows,
    };
    publish();

    report.phase = 'destroy-late-terrain-provider';
    publish();
    // Exercise destruction while a local terrain factory is pending. The
    // replacement controller is not attached to the viewer after this point.
    const late = deferred();
    const destroyController = createMapController(
      viewer,
      new EventTarget(),
      terrainCalls,
      late,
    );
    const destroyPending = destroyController.setStack('qa-terrain-delayed');
    await waitFor(
      () => terrainCalls.delayed > 1,
      lifecycleDrainMs,
      'destroy late terrain factory',
    );
    destroyController.destroy();
    const lateProvider = new Cesium.EllipsoidTerrainProvider();
    let disposalHookCalls = 0;
    // EllipsoidTerrainProvider has no destroy() contract in this Cesium build.
    // A fixture-owned hook records the controller's disposal call without
    // claiming native terrain resource reclamation.
    lateProvider.destroy = () => {
      disposalHookCalls++;
    };
    report.destroyLateTerrain = {
      status: 'running',
      signalAborted: terrainCalls.delayedSignal?.aborted === true,
      fixtureOwnedDisposalHookCalledOnce: false,
      disposalHookCalls,
      disposalScope:
        'fixture-owned hook only; this Cesium EllipsoidTerrainProvider has no native destroy method',
    };
    publish();
    late.resolve({ provider: lateProvider });
    await destroyPending;
    report.destroyLateTerrain.disposalHookCalls = disposalHookCalls;
    report.destroyLateTerrain.fixtureOwnedDisposalHookCalledOnce =
      disposalHookCalls === 1;
    publish();
    await waitFor(
      () => disposalHookCalls === 1,
      lifecycleDrainMs,
      'late terrain provider disposal hook',
    );
    if (disposalHookCalls !== 1)
      throw new Error(
        'Late provider fixture-owned disposal hook did not run exactly once.',
      );
    report.destroyLateTerrain.status = 'passed';
    publish();

    report.phase = 'destroy-layer-and-map-controller';
    publish();
    cableLayer.destroy(viewer);
    controller.destroy();
    const final = diagnosticSnapshot(viewer, controller, cableLayer);
    if (
      final.cables.listeners !== 0 ||
      final.cables.pendingJobs !== 0 ||
      final.cables.dataSources !== 0 ||
      final.cables.cacheEntries !== 0 ||
      final.map.pendingJobs !== 0 ||
      final.map.cacheEntries !== 0 ||
      final.map.imageryLayers !== 0 ||
      viewer.dataSources.length !== 0
    )
      throw new Error(
        'Final fixture cleanup did not return owned resources to zero.',
      );
    report.cleanup = { status: 'passed', final };
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failedPhase = report.phase || 'initialization';
    report.error = String(error?.message || error)
      .replace(/https?:\/\/[^\s]+/g, '[url]')
      .slice(0, 500);
    report.errorDetails = boundedErrorDetails(error);
    report.failureEvidence = {
      phase: report.failedPhase,
      sceneHistory: Array.isArray(error?.sceneHistory)
        ? error.sceneHistory.slice(-32)
        : [],
      currentObservation: report.currentObservation || null,
      snapshot:
        viewer && controller && cableLayer
          ? (() => {
              try {
                return diagnosticSnapshot(viewer, controller, cableLayer);
              } catch {
                return null;
              }
            })()
          : null,
    };
  } finally {
    report.phase = report.phase || 'cleanup';
    try {
      cableLayer?.destroy(viewer);
    } catch {}
    try {
      controller?.destroy();
    } catch {}
    try {
      postRenderRemove?.();
    } catch {}
    const beforeDestroy =
      viewer && !viewer.isDestroyed() ? viewer.dataSources.length : null;
    try {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    } catch (error) {
      report.cleanup = {
        ...(report.cleanup || {}),
        viewerDestroyError: String(error?.message || error).slice(0, 250),
      };
    }
    report.cleanup = {
      ...(report.cleanup || {}),
      status:
        report.status === 'passed' && !report.cleanup?.viewerDestroyError
          ? 'passed'
          : 'failed',
      viewerDestroyed: !viewer || viewer.isDestroyed(),
      dataSourcesBeforeViewerDestroy: beforeDestroy,
      pageErrors: [],
    };
  }
  publish();
  RESULT.textContent = JSON.stringify(report, null, 2);
  STATUS.textContent = report.status;
  return report;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

RUN.addEventListener('click', async () => {
  RUN.disabled = true;
  STATUS.textContent = 'running';
  try {
    await runFixture();
  } finally {
    RUN.disabled = false;
  }
});
window.runTerrainPickingLifecycleFixture = runFixture;
