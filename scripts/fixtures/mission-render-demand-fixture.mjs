import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationLaunches } from '../../src/app/layers/rocketLaunches.js';
import * as satellites from '../../src/data/satellites.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import {
  getRenderGovernorDiagnostics,
  holdContinuousRender,
  installRenderGovernor,
  releaseContinuousRender,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';

// One per-page run epoch keeps normalized launch dates stable across trials
// without patching Date or depending on a hard-coded calendar window.
const FIXTURE_EPOCH_MS = Math.floor(Date.now() / 1000) * 1000;
const FIXTURE_OWNER = 'mission-render-demand-fixture-control';
const VIEW_SETTINGS = Object.freeze({
  width: 960,
  height: 640,
  resolutionScale: 1,
  msaaSamples: 4,
  requestRenderMode: true,
  maximumRenderTimeChange: 'Infinity',
  baseLayer: false,
  globe: false,
  skyBox: false,
  skyAtmosphere: false,
});
const TRACK_ORBIT_PATHS = new Map();
let currentTrial = null;

function fixtureLaunches() {
  return [
    {
      id: 'mission-a',
      name: 'Fixture Mission Alpha',
      net: new Date(FIXTURE_EPOCH_MS - 3_600_000).toISOString(),
      status: { name: 'Launch Successful' },
      pad: {
        latitude: '28.608',
        longitude: '-80.604',
        name: 'Fixture Launch Site',
      },
      mission: { name: 'Fixture Mission Alpha', orbit: { name: 'LEO' } },
    },
    {
      id: 'mission-b',
      name: 'Fixture Mission Beta',
      net: new Date(FIXTURE_EPOCH_MS - 7_200_000).toISOString(),
      status: { name: 'Launch Successful' },
      pad: {
        latitude: '34.742',
        longitude: '-120.572',
        name: 'Fixture Launch Site West',
      },
      mission: { name: 'Fixture Mission Beta', orbit: { name: 'LEO' } },
    },
  ];
}

const FIXTURE_LAUNCH_RECORDS = fixtureLaunches();

function buildTrack(query, fixtureClock) {
  if (!TRACK_ORBIT_PATHS.has(query)) {
    const offset = query.endsWith('Beta') ? 42 : 0;
    const orbitPath = Array.from({ length: 181 }, (_, index) => {
      const angle = (index / 180) * Cesium.Math.TWO_PI;
      const latitude = 18 * Math.sin(angle) + offset * 0.1;
      const longitude = Cesium.Math.toDegrees(angle) - 180 + offset;
      return Cesium.Cartesian3.fromDegrees(longitude, latitude, 550_000);
    });
    TRACK_ORBIT_PATHS.set(query, orbitPath);
  }
  const orbitPath = TRACK_ORBIT_PATHS.get(query);
  const phaseAt = (timeMs) => {
    const angle =
      ((timeMs - FIXTURE_EPOCH_MS) / 5_400_000) * Cesium.Math.TWO_PI;
    return {
      longitude:
        Cesium.Math.negativePiToPi(angle) * Cesium.Math.DEGREES_PER_RADIAN,
      latitude: 18 * Math.sin(angle),
      altitude: 550_000,
      speedMps: 7_600,
    };
  };
  return {
    name: query,
    noradId: query.endsWith('Beta') ? '900002' : '900001',
    gmstAtBake: 0,
    orbitPath,
    periodSec: 5_400,
    current: phaseAt(fixtureClock.nowMs()),
    positionAt: () => phaseAt(fixtureClock.nowMs()),
  };
}

function fixtureOverlays() {
  return {
    clearMissionOverlaySources() {},
    createReplayVehicleOverlay() {},
    destroyReplayVehicleOverlay() {},
    hideReplayVehicleOverlay() {},
    updateReplayVehicleOverlay() {},
    refreshSelectedMissionOverlayText() {},
    syncMissionOverlayEntries() {},
    missionAnchorVisible: () => true,
    missionAnchorHorizonVisible: () => true,
    missionHoverReticleImage: () =>
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    createRocketMissionMarkerOverlayEntry: () => null,
    createRocketMissionElementOverlayEntry: () => null,
    selectRocketMissionMarkerOverlayCohort: () => [],
    shortMissionLabel: (value) => String(value || ''),
    replayOverlayMode: () => 'hidden',
  };
}

function createFixtureClock() {
  let startedAt = null;
  let durationMs = 0;
  let finished = false;
  return {
    start(duration) {
      if (startedAt !== null) throw new Error('Fixture clock already started');
      startedAt = performance.now();
      durationMs = duration;
      return startedAt;
    },
    finish() {
      if (startedAt === null) throw new Error('Fixture clock was not started');
      finished = true;
    },
    nowMs() {
      if (startedAt === null) return FIXTURE_EPOCH_MS;
      return (
        FIXTURE_EPOCH_MS +
        Math.min(durationMs, Math.max(0, performance.now() - startedAt))
      );
    },
    epochMs: FIXTURE_EPOCH_MS,
    get started() {
      return startedAt !== null;
    },
    get finished() {
      return finished;
    },
  };
}

function waitForRender(scene, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let timeout;
    let remove = () => {};
    const finish = (error) => {
      clearTimeout(timeout);
      remove();
      if (error) reject(error);
      else resolve();
    };
    timeout = setTimeout(
      () =>
        finish(
          new Error('No completed scene render within the fixture deadline'),
        ),
      timeoutMs,
    );
    remove = scene.postRender.addEventListener(() => finish());
    scene.requestRender();
  });
}

function observeNextCameraFlight(camera, timeoutMs = 5_000) {
  const originalFlyTo = camera.flyTo;
  let timer;
  let restore = () => {};
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Native mission camera flight did not complete.')),
      timeoutMs,
    );
    camera.flyTo = function observedFlyTo(options, ...args) {
      const startedAt = performance.now();
      const wrapped = {
        ...options,
        complete(...callbackArgs) {
          try {
            options.complete?.apply(this, callbackArgs);
          } finally {
            clearTimeout(timer);
            resolve({
              status: 'completed',
              elapsedMs: performance.now() - startedAt,
            });
          }
        },
        cancel(...callbackArgs) {
          try {
            options.cancel?.apply(this, callbackArgs);
          } finally {
            clearTimeout(timer);
            reject(new Error('Native mission camera flight was cancelled.'));
          }
        },
      };
      return originalFlyTo.call(this, wrapped, ...args);
    };
    restore = () => {
      camera.flyTo = originalFlyTo;
    };
  });
  return {
    promise,
    restore() {
      clearTimeout(timer);
      restore();
    },
  };
}

function visibleOrbitPrimitiveCount(scene) {
  let count = 0;
  for (let index = 0; index < scene.primitives.length; index += 1) {
    const primitive = scene.primitives.get(index);
    if (primitive instanceof Cesium.PolylineCollection && primitive.show)
      count += 1;
  }
  return count;
}

function visualSettings(viewer) {
  const scene = viewer.scene;
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasClientWidth: scene.canvas.clientWidth,
    canvasClientHeight: scene.canvas.clientHeight,
    canvasWidth: scene.canvas.width,
    canvasHeight: scene.canvas.height,
    viewerResolutionScale: viewer.resolutionScale,
    maximumRenderTimeChange: Number.isFinite(scene.maximumRenderTimeChange)
      ? scene.maximumRenderTimeChange
      : 'Infinity',
    msaaSamples: scene.msaaSamples,
    imageryLayerCount: viewer.imageryLayers.length,
    globe: scene.globe.show,
    skyBox: scene.skyBox?.show ?? false,
    skyAtmosphere: scene.skyAtmosphere?.show ?? false,
  };
}

function classifyRenderer(renderer) {
  const value = String(renderer || '').toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software/.test(value)) return 'software';
  if (/metal/.test(value)) return 'native-metal';
  if (/apple|nvidia|amd|intel/.test(value)) return 'hardware-unclassified';
  return 'unknown';
}

function sceneEntityIds(viewer) {
  const source = viewer.dataSources.get(0);
  return source?.entities?.values?.map((entity) => entity.id).sort() || [];
}

function cameraSnapshot(viewer) {
  const camera = viewer.camera;
  return {
    position: [camera.positionWC.x, camera.positionWC.y, camera.positionWC.z],
    direction: [
      camera.directionWC.x,
      camera.directionWC.y,
      camera.directionWC.z,
    ],
    up: [camera.upWC.x, camera.upWC.y, camera.upWC.z],
  };
}

async function disposeCurrentTrial() {
  if (!currentTrial) return { layerDestroyed: true, viewerDestroyed: true };
  const trial = currentTrial;
  currentTrial = null;
  let layerDestroyed = true;
  let viewerDestroyed = true;
  let governorAfterLayerDestroy = null;
  if (trial.controlHold) releaseContinuousRender(FIXTURE_OWNER);
  try {
    if (trial.layer) await trial.layer.destroy(trial.viewer);
  } catch {
    layerDestroyed = false;
  } finally {
    governorAfterLayerDestroy = getRenderGovernorDiagnostics();
    uninstallRenderGovernor(trial.viewer);
    try {
      trial.viewer.destroy();
    } catch {
      viewerDestroyed = false;
    }
  }
  const governorAfterUninstall = getRenderGovernorDiagnostics();
  return {
    layerDestroyed,
    viewerDestroyed,
    governorAfterLayerDestroy,
    governorAfterUninstall,
    remainingLayerEntityCount: trial.layer?.getStats().count ?? 0,
    remainingViewerDestroyed: trial.viewer.isDestroyed(),
  };
}

async function runTrial({ scenario, variant, durationMs }) {
  if (!['static-empty', 'unselected-orbit', 'selected-live'].includes(scenario))
    throw new Error('Unknown mission render-demand scenario');
  if (!['continuous-control', 'demand-candidate'].includes(variant))
    throw new Error('Unknown mission render-demand variant');
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1_000 ||
    durationMs > 10_000
  )
    throw new Error(
      'Mission fixture duration must be between 1000 and 10000ms',
    );
  const previousCleanup = await disposeCurrentTrial();
  if (!previousCleanup.layerDestroyed || !previousCleanup.viewerDestroyed)
    throw new Error('Previous trial cleanup was incomplete');

  const fixtureClock = createFixtureClock();
  const matrixHistory = [];
  const trackSamples = [];
  const tracks = new Map();
  const track = (query) => {
    if (tracks.has(query)) return tracks.get(query);
    const orbitTrack = buildTrack(query, fixtureClock);
    const samplePosition = orbitTrack.positionAt;
    orbitTrack.positionAt = (date) => {
      const position = samplePosition(date);
      if (trackSamples.length < 4096)
        trackSamples.push({
          query,
          atPerformanceMs: performance.now(),
          fixtureEpochMs: fixtureClock.nowMs(),
          longitude: position.longitude,
          latitude: position.latitude,
          altitude: position.altitude,
        });
      return position;
    };
    tracks.set(query, orbitTrack);
    return orbitTrack;
  };
  const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    msaaSamples: VIEW_SETTINGS.msaaSamples,
    contextOptions: {
      webgl: {
        alpha: false,
        stencil: true,
        powerPreference: 'high-performance',
      },
    },
  });
  const trial = { viewer, layer: null, controlHold: false };
  currentTrial = trial;
  const scene = viewer.scene;
  scene.globe.show = false;
  if (scene.skyBox) scene.skyBox.show = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  viewer.resolutionScale = VIEW_SETTINGS.resolutionScale;
  installRenderGovernor(viewer);
  viewer.resize();

  const satelliteServices = {
    ...satellites,
    getSatelliteOrbitTrack: (query) => track(query),
    findSatelliteOrbitTrackInTle: () => null,
    orbitFrameModelMatrix(gmstAtBake, _date, result) {
      const at = performance.now();
      const matrix = satellites.orbitFrameModelMatrix(
        gmstAtBake,
        new Date(fixtureClock.nowMs()),
        result,
      );
      matrixHistory.push({
        atPerformanceMs: at,
        fixtureEpochMs: fixtureClock.nowMs(),
        matrix: Array.from(matrix),
      });
      if (matrixHistory.length > 256) matrixHistory.shift();
      return matrix;
    },
  };
  const source = {
    async getLaunches() {
      return scenario === 'static-empty' ? [] : FIXTURE_LAUNCH_RECORDS;
    },
    async getActiveTle() {
      return null;
    },
  };
  const layer = createApplicationLaunches({
    source,
    satellites: satelliteServices,
    timelineArbiter: null,
  });
  trial.layer = layer;
  const progress = {
    scenario,
    variant,
    phase: 'viewer-created',
    before: null,
    after: null,
    measurementElapsedMs: null,
    matrixUpdatesDuringMeasurement: null,
    liveTrackSampleCountDuringMeasurement: null,
  };
  window.__missionRenderDemandProgress = progress;
  const frameTimes = [];
  let frameOverflow = false;
  let measuring = false;
  let removePostRender = () => {};
  let focusListeners = [];

  try {
    layer._setRocketMissionOverlayHostForTest(fixtureOverlays());
    layer.init(viewer);
    const cameraFlightProbe = observeNextCameraFlight(viewer.camera);
    let cameraFlight;
    try {
      await layer.enable();
      cameraFlight = await cameraFlightProbe.promise;
    } finally {
      cameraFlightProbe.restore();
    }
    await layer.update();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-98, 35, 18_000_000),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
    });
    if (scenario === 'selected-live')
      layer._setSelectedRocketMissionForTest('mission-a');
    if (variant === 'continuous-control') {
      holdContinuousRender(FIXTURE_OWNER);
      trial.controlHold = true;
    }
    await waitForRender(scene);
    progress.phase = 'setup-render-complete';

    const canvas = scene.canvas;
    const context = scene.context._originalGLContext || scene.context._gl;
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    const before = {
      entityCount: layer.getStats().count,
      dataSourceCount: viewer.dataSources.length,
      sceneEntityIds: sceneEntityIds(viewer),
      primitiveCount: scene.primitives.length,
      visibleOrbitPrimitiveCount: visibleOrbitPrimitiveCount(scene),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      camera: cameraSnapshot(viewer),
      visualSettings: visualSettings(viewer),
      cameraFlight,
      fixtureSource: {
        referenceEpochMs: FIXTURE_EPOCH_MS,
        inputLaunchNets:
          scenario === 'static-empty'
            ? []
            : FIXTURE_LAUNCH_RECORDS.map((launch) => ({
                id: launch.id,
                net: launch.net,
              })),
        effectiveLaunchTimes: layer.getAnalystRecords(10).map((record) => ({
          id: record.id,
          launchTimeMs: record.launchTimeMs,
        })),
        inputsStableAcrossTrials: true,
        nativeSchedulingClockPatched: false,
      },
    };
    progress.before = before;
    // Public observer path remains the source of mode and render-owner evidence.
    const governorBefore = getRenderGovernorDiagnostics();
    const focus = {
      documentVisibleThroughout: document.visibilityState === 'visible',
      documentFocusedThroughout: document.hasFocus(),
      documentFocusedAtStart: document.hasFocus(),
      documentFocusedAtEnd: false,
      desktopForegroundVerification: 'unavailable',
    };
    const recordVisibility = () => {
      if (document.visibilityState !== 'visible')
        focus.documentVisibleThroughout = false;
    };
    const recordBlur = () => {
      focus.documentFocusedThroughout = false;
    };
    focusListeners = [
      [document, 'visibilitychange', recordVisibility],
      [window, 'blur', recordBlur],
    ];
    for (const [target, eventName, listener] of focusListeners)
      target.addEventListener(eventName, listener);
    const measurementStartedAt = performance.now();
    const fixtureClockStartedAt = fixtureClock.start(durationMs);
    const trackSamplesStartedAt = trackSamples.length;
    const onPostRender = () => {
      if (!measuring) return;
      if (frameTimes.length < 4096) frameTimes.push(performance.now());
      else frameOverflow = true;
    };
    removePostRender = scene.postRender.addEventListener(onPostRender);
    measuring = true;
    progress.phase = 'measuring';
    try {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
      measuring = false;
      fixtureClock.finish();
      removePostRender();
      removePostRender = () => {};
      focus.documentFocusedAtEnd = document.hasFocus();
      recordVisibility();
      for (const [target, eventName, listener] of focusListeners)
        target.removeEventListener(eventName, listener);
      focusListeners = [];
    }
    const measurementEndedAt = performance.now();
    progress.measurementElapsedMs = measurementEndedAt - measurementStartedAt;
    progress.phase = 'measurement-complete';
    const matrixDuringMeasurement = matrixHistory
      .filter(
        (entry) =>
          entry.atPerformanceMs >= measurementStartedAt &&
          entry.atPerformanceMs <= measurementEndedAt,
      )
      .map((entry) => ({ ...entry }));
    const trackSamplesDuringMeasurement = trackSamples
      .slice(trackSamplesStartedAt)
      .filter(
        (entry) =>
          entry.atPerformanceMs >= measurementStartedAt &&
          entry.atPerformanceMs <= measurementEndedAt,
      );
    progress.matrixUpdatesDuringMeasurement = matrixDuringMeasurement.length;
    progress.liveTrackSampleCountDuringMeasurement =
      trackSamplesDuringMeasurement.length;
    progress.phase = 'final-settle';

    if (scenario !== 'static-empty') {
      const matrixCountBeforeSettle = matrixHistory.length;
      const settleDeadline = performance.now() + 1_300;
      while (
        matrixHistory.length === matrixCountBeforeSettle &&
        performance.now() < settleDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      if (matrixHistory.length === matrixCountBeforeSettle)
        throw new Error('Orbit fixture did not produce a final cadence update');
    }
    await waitForRender(scene);
    const after = {
      entityCount: layer.getStats().count,
      dataSourceCount: viewer.dataSources.length,
      sceneEntityIds: sceneEntityIds(viewer),
      primitiveCount: scene.primitives.length,
      visibleOrbitPrimitiveCount: visibleOrbitPrimitiveCount(scene),
      camera: cameraSnapshot(viewer),
      fixtureEpochMs: fixtureClock.nowMs(),
    };
    progress.after = after;
    progress.phase = 'endpoint-image';
    const endpointCanvas = await captureFreshCesiumFrame(viewer, {
      timeoutMs: 400,
    });
    if (!endpointCanvas)
      throw new Error('Fresh endpoint pixels were unavailable.');
    let endpointPixels;
    let endpointPngDataUrl;
    try {
      const pixelBytes = endpointCanvas
        .getContext('2d')
        .getImageData(0, 0, endpointCanvas.width, endpointCanvas.height).data;
      let coloredPixels = 0;
      for (let offset = 0; offset < pixelBytes.length; offset += 4) {
        if (
          pixelBytes[offset] > 32 ||
          pixelBytes[offset + 1] > 32 ||
          pixelBytes[offset + 2] > 32
        )
          coloredPixels += 1;
      }
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', pixelBytes),
      );
      endpointPngDataUrl = endpointCanvas.toDataURL('image/png');
      if (endpointPngDataUrl.length > 2_000_000)
        throw new Error('Endpoint PNG exceeded the fixture size bound.');
      endpointPixels = {
        width: endpointCanvas.width,
        height: endpointCanvas.height,
        coloredPixels,
        rgbaSha256: Array.from(digest, (value) =>
          value.toString(16).padStart(2, '0'),
        ).join(''),
      };
      if (scenario !== 'static-empty' && coloredPixels < 100)
        throw new Error(
          'Endpoint image did not contain rendered mission geometry.',
        );
    } finally {
      endpointCanvas.width = 0;
      endpointCanvas.height = 0;
    }
    window.__missionRenderDemandPngDataUrl = endpointPngDataUrl;
    const governorAfter = getRenderGovernorDiagnostics();
    progress.phase = 'trial-ready';
    const intervals = frameTimes
      .slice(1)
      .map((at, index) => at - frameTimes[index]);
    return {
      schema: 'gev-mission-render-demand-trial/v1',
      status: 'passed',
      scenario,
      variant,
      durationMs,
      measurementElapsedMs: measurementEndedAt - measurementStartedAt,
      fixtureClock: {
        scope:
          'fixture satellite source and orbit transform only; native Date/timers/RAF/performance remain unchanged',
        heldEpochMsBeforeMeasurement: fixtureClock.epochMs,
        startNativePerformanceMs: fixtureClockStartedAt,
        endEpochMs: fixtureClock.nowMs(),
        startedOnce: fixtureClock.started,
        endedClamped: fixtureClock.finished,
      },
      cameraFlight,
      focus,
      rendering: {
        frameCount: frameTimes.length,
        frameSampleOverflow: frameOverflow,
        maxFrameIntervalMs: intervals.length ? Math.max(...intervals) : null,
        renderModeAtStart: governorBefore.mode,
        renderModeAtEnd: governorAfter.mode,
        cesiumRequestRenderModeAtStart: scene.requestRenderMode,
        holdsAtStart: governorBefore.holds,
        holdsAtEnd: governorAfter.holds,
        finalFrameCompletedAfterMeasurement: true,
        finalSettlingFrameExcluded: true,
      },
      matrixUpdates: {
        countDuringMeasurement: matrixDuringMeasurement.length,
        timestampsPerformanceMs: matrixDuringMeasurement.map(
          (entry) => entry.atPerformanceMs,
        ),
        fixtureEpochMs: matrixDuringMeasurement.map(
          (entry) => entry.fixtureEpochMs,
        ),
        finalMatrix: matrixHistory.at(-1)?.matrix || null,
      },
      liveTrack: {
        sampleCountDuringMeasurement: trackSamplesDuringMeasurement.length,
        firstPosition: trackSamplesDuringMeasurement[0]
          ? {
              longitude: trackSamplesDuringMeasurement[0].longitude,
              latitude: trackSamplesDuringMeasurement[0].latitude,
              altitude: trackSamplesDuringMeasurement[0].altitude,
            }
          : null,
        lastPosition: trackSamplesDuringMeasurement.at(-1)
          ? {
              longitude: trackSamplesDuringMeasurement.at(-1).longitude,
              latitude: trackSamplesDuringMeasurement.at(-1).latitude,
              altitude: trackSamplesDuringMeasurement.at(-1).altitude,
            }
          : null,
      },
      before,
      after,
      endpointPixels,
      visualSettings: visualSettings(viewer),
      renderer: String(renderer || '').slice(0, 240),
      rendererClassification: classifyRenderer(renderer),
    };
  } catch (error) {
    measuring = false;
    removePostRender();
    for (const [target, eventName, listener] of focusListeners)
      target.removeEventListener(eventName, listener);
    const cleanup = await disposeCurrentTrial().catch(() => null);
    error.fixtureCleanup = cleanup;
    throw error;
  }
}

async function beginFromControls() {
  const button = document.getElementById('runTrial');
  const status = document.getElementById('status');
  const output = document.getElementById('result');
  const download = document.getElementById('download');
  button.disabled = true;
  download.disabled = true;
  output.textContent = '';
  window.__missionRenderDemandResult = null;
  window.__missionRenderDemandProgress = null;
  window.__missionRenderDemandPngDataUrl = null;
  status.textContent = 'Preparing isolated Cesium mission layer…';
  try {
    const scenario = document.getElementById('scenario').value;
    const variant = document.getElementById('variant').value;
    const durationMs = Number(document.getElementById('duration').value);
    const report = await runTrial({ scenario, variant, durationMs });
    window.__missionRenderDemandResult = report;
    output.textContent = JSON.stringify(report, null, 2);
    status.textContent = `Completed ${scenario} / ${variant}; capture counts exclude final-frame settling.`;
    download.disabled = false;
  } catch (error) {
    const failure = {
      schema: 'gev-mission-render-demand-trial/v1',
      status: 'failed',
      scenario: document.getElementById('scenario').value,
      variant: document.getElementById('variant').value,
      error: String(error?.message || error).slice(0, 500),
      partial: window.__missionRenderDemandProgress || null,
      cleanup: error?.fixtureCleanup || null,
    };
    window.__missionRenderDemandResult = failure;
    output.textContent = JSON.stringify(failure, null, 2);
    status.textContent = 'Failed; see bounded trial result.';
  } finally {
    button.disabled = false;
  }
}

document
  .getElementById('runTrial')
  .addEventListener('click', beginFromControls);
document.getElementById('download').addEventListener('click', () => {
  const report = window.__missionRenderDemandResult;
  if (!report) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mission-render-demand-trial.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.disposeMissionRenderDemandTrial = disposeCurrentTrial;
