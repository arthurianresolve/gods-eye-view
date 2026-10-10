import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createVesselLayer } from '../../src/layers/vessels/index.js';
import * as focus from '../../src/data/focusDeemphasis.js';
import * as renderGovernor from '../../src/renderGovernor.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { vesselSnapshot } from '../../src/sources/live/vessels.js';
import {
  FOCUS_UPDATE_MS,
  VISIBILITY_UPDATE_MS,
} from '../../src/layers/vessels/policy.js';
import { compareVesselRenderDemandRuns } from '../performance/vesselRenderDemand.mjs';

const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 8, 12, 0, 0);
const FIXTURE_ROWS = Array.from({ length: 32 }, (_, index) => {
  const row = index % 8;
  const column = Math.floor(index / 8);
  return {
    mmsi: String(900_000_001 + index),
    name: `Fixture Vessel ${String(index + 1).padStart(2, '0')}`,
    type: index % 2 ? 'Cargo' : 'Tanker',
    lat: 37.8 + (row - 3.5) * 0.055,
    lon: -122.3 + (column - 1.5) * 0.06,
    speed: 4 + (index % 7),
    course: (index * 23) % 360,
    heading: (index * 29) % 360,
    last_position_epoch: FIXTURE_EPOCH_MS / 1000,
    last_position_UTC: new Date(FIXTURE_EPOCH_MS).toISOString(),
  };
});
const FIXTURE_SOURCE = JSON.stringify(FIXTURE_ROWS);
const PAIR_COUNT = 5;
let fixtureSha256 = null;
let viewer = null;
let activeLayer = null;
let report = null;
let phaseName = 'startup';
let measurement = null;
let removePostRender = null;
let scheduledUpdates = null;
let governorInstalled = false;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function source() {
  return {
    label: 'Synthetic AIS render-demand fixture',
    async getSnapshot() {
      return {
        ...vesselSnapshot(
          { rows: FIXTURE_ROWS, status: 'live' },
          { source: 'Synthetic AIS render-demand fixture' },
        ),
      };
    },
  };
}

function fixtureServices(mode, updates, run) {
  const visibilityPasses = run.visibilityPasses;
  const focusPasses = run.focusPasses;
  const observedFocusTimes = new Set();
  const services = {
    context: {
      clearSelectedEntityContextForLayer() {},
      registerEntityContext() {},
      selectEntityContext() {},
    },
    trails: {
      createTrail() {
        return { setPositions() {}, clear() {}, destroy() {} };
      },
    },
    labels: { formatKnots: (value) => String(value) },
    picking: {
      registerPickOwner() {},
      unregisterPickOwner() {},
      resolvePickId: () => null,
      isOwnedByOtherLayer: () => false,
    },
    overlay: {
      setOverlayEntries() {
        const elapsedMs = performance.now() - run.startedAtMonotonic;
        if (
          ['idleBefore', 'idleAfter'].includes(phaseName) &&
          visibilityPasses.length < 256
        )
          visibilityPasses.push({ phase: phaseName, elapsedMs });
      },
      setOverlaySourceVisible() {},
      clearOverlaySource() {},
      hitTest: () => null,
    },
    geoid: {
      geoidHeight: () => 0,
      ensureGeoidReady: () => Promise.resolve(),
    },
    sprites: {
      registerSpriteCollection() {},
      restoreSpriteOrder() {},
      restoreSpriteOrderOnEnable() {},
    },
    focus: {
      ...focus,
      advanceSpriteFocus(sprite, input) {
        const nowMs = input?.nowMs;
        if (
          ['focusActive', 'focusRelease'].includes(phaseName) &&
          Number.isFinite(nowMs) &&
          !observedFocusTimes.has(nowMs)
        ) {
          observedFocusTimes.add(nowMs);
          if (focusPasses.length < 256)
            focusPasses.push({
              phase: phaseName,
              elapsedMs: performance.now() - run.startedAtMonotonic,
            });
        }
        return focus.advanceSpriteFocus(sprite, input);
      },
    },
    worldFocus: { requestWorldFocus() {} },
  };
  if (mode === 'control') {
    // This deliberately selects the layer's legacy continuous-render path.
    services.render = {
      holdContinuousRender: renderGovernor.holdContinuousRender,
      releaseContinuousRender: renderGovernor.releaseContinuousRender,
    };
  } else {
    services.render = {
      ...renderGovernor,
      scheduleRenderUpdate(owner, callback, delayMs) {
        const requestedAt = performance.now();
        const entry = {
          requestedDelayMs: delayMs,
          actualDelayMs: null,
          completed: false,
          requestedPhase: phaseName,
          firedPhase: null,
          firedAt: null,
        };
        if (updates.length < 512) updates.push(entry);
        return renderGovernor.scheduleRenderUpdate(
          owner,
          () => {
            entry.actualDelayMs = performance.now() - requestedAt;
            entry.completed = true;
            entry.firedPhase = phaseName;
            entry.firedAt = performance.now();
            callback();
          },
          delayMs,
        );
      },
    };
  }
  return services;
}

function vesselCollection() {
  if (!viewer) return null;
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive instanceof Cesium.BillboardCollection) return primitive;
  }
  return null;
}

function visibleVesselCount() {
  const collection = vesselCollection();
  if (!collection) return 0;
  let count = 0;
  for (let index = 0; index < collection.length; index++)
    if (collection.get(index).show) count++;
  return count;
}

function alphaFingerprint() {
  const collection = vesselCollection();
  if (!collection) return '';
  const alpha = [];
  for (let index = 0; index < collection.length; index++)
    alpha.push(Math.round(collection.get(index).color.alpha * 255));
  return alpha.join(',');
}

function minimumAlpha(fingerprint = alphaFingerprint()) {
  if (!fingerprint) return null;
  return Math.min(...fingerprint.split(',').map(Number));
}

function dimmedVesselCount() {
  const collection = vesselCollection();
  if (!collection) return 0;
  let count = 0;
  for (let index = 0; index < collection.length; index++)
    if (collection.get(index).color.alpha < 0.98) count++;
  return count;
}

function recordPostRender() {
  if (!measurement) return;
  if (measurement.frameTimes.length < 1024)
    measurement.frameTimes.push(performance.now());
  else measurement.frameOverflow = true;
  const fingerprint = alphaFingerprint();
  const minAlpha = minimumAlpha(fingerprint);
  if (minAlpha !== null)
    measurement.minAlpha =
      measurement.minAlpha === null
        ? minAlpha
        : Math.min(measurement.minAlpha, minAlpha);
  if (fingerprint !== measurement.lastAlphaFingerprint) {
    measurement.lastAlphaFingerprint = fingerprint;
    if (measurement.alphaChanges.length < 512)
      measurement.alphaChanges.push({
        elapsedMs: performance.now() - measurement.startedAt,
        fingerprint,
      });
    else measurement.alphaOverflow = true;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capturePixels() {
  const canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
  if (!canvas) throw new Error(`No completed output frame for ${phaseName}`);
  try {
    const pixels = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBackgroundPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
      if (
        pixels[offset] > 24 ||
        pixels[offset + 1] > 31 ||
        pixels[offset + 2] > 40
      )
        nonBackgroundPixels++;
    const bytes = new Uint8Array(pixels.length);
    bytes.set(pixels);
    return {
      width: canvas.width,
      height: canvas.height,
      nonBackgroundPixels,
      rgbaSha256: await sha256(bytes),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function measurePhase(run, name, durationMs) {
  phaseName = name;
  const phaseStartElapsedMs = performance.now() - run.startedAtMonotonic;
  measurement = {
    startedAt: performance.now(),
    frameTimes: [],
    frameOverflow: false,
    alphaChanges: [],
    alphaOverflow: false,
    lastAlphaFingerprint: null,
    minAlpha: null,
  };
  const active = measurement;
  await wait(durationMs);
  const endedAt = performance.now();
  const endMinAlpha = minimumAlpha();
  const endDimmedVesselCount = dimmedVesselCount();
  measurement = null;
  phaseName = 'capture';
  const pixels = await capturePixels();
  return {
    name,
    requestedDurationMs: durationMs,
    elapsedMs: endedAt - active.startedAt,
    startElapsedMs: phaseStartElapsedMs,
    endElapsedMs: endedAt - run.startedAtMonotonic,
    completedFrames: active.frameTimes.length,
    frameOverflow: active.frameOverflow,
    visibleVesselCount: visibleVesselCount(),
    minAlpha: active.minAlpha,
    endMinAlpha,
    endDimmedVesselCount,
    requestRenderModeAtEnd: viewer.scene.requestRenderMode,
    alphaChanges: active.alphaChanges,
    alphaOverflow: active.alphaOverflow,
    ...pixels,
  };
}

function setFixtureCamera() {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-122.3, 37.8, 1_300_000),
    orientation: {
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    },
  });
}

async function waitForPopulation() {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (
      activeLayer.getStats().count === FIXTURE_ROWS.length &&
      visibleVesselCount() > 0
    )
      return;
    await wait(25);
  }
  throw new Error('AIS fixture population did not materialize');
}

function setupTrialViewer() {
  viewer = new Cesium.Viewer('viewer', {
    baseLayer: false,
    globe: false,
    skyBox: false,
    skyAtmosphere: false,
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    msaaSamples: 4,
  });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#09141f');
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(
    new Date(FIXTURE_EPOCH_MS),
  );
  viewer.clock.shouldAnimate = false;
  viewer.clock.multiplier = 0;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  setFixtureCamera();
  renderGovernor.installRenderGovernor(viewer);
  governorInstalled = true;
  removePostRender = viewer.scene.postRender.addEventListener(recordPostRender);
  const canvas = viewer.scene.canvas;
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const attributes = gl?.getContextAttributes?.() || null;
  const renderingSettings = {
    requestRenderMode: viewer.scene.requestRenderMode,
    maximumRenderTimeChange: Number.isFinite(
      viewer.scene.maximumRenderTimeChange,
    )
      ? viewer.scene.maximumRenderTimeChange
      : 'Infinity',
    msaaSamples: viewer.scene.msaaSamples,
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
    devicePixelRatio: window.devicePixelRatio,
    contextAttributes: attributes
      ? {
          alpha: attributes.alpha,
          antialias: attributes.antialias,
          depth: attributes.depth,
          premultipliedAlpha: attributes.premultipliedAlpha,
          preserveDrawingBuffer: attributes.preserveDrawingBuffer,
          stencil: attributes.stencil,
        }
      : null,
  };
  report.viewport ||= {
    width: canvas.width,
    height: canvas.height,
    devicePixelRatio: window.devicePixelRatio,
  };
  if (!report.environment.renderer) {
    report.environment.renderer = observedRenderer();
    report.environment.graphics = {
      contextAttributes: attributes
        ? {
            alpha: attributes.alpha,
            antialias: attributes.antialias,
            depth: attributes.depth,
            premultipliedAlpha: attributes.premultipliedAlpha,
            preserveDrawingBuffer: attributes.preserveDrawingBuffer,
            stencil: attributes.stencil,
          }
        : null,
      drawingBufferWidth: gl?.drawingBufferWidth ?? null,
      drawingBufferHeight: gl?.drawingBufferHeight ?? null,
    };
    report.renderingSettings = renderingSettings;
  }
  return renderingSettings;
}

function destroyTrialViewer(run) {
  const errors = [];
  removePostRender?.();
  removePostRender = null;
  if (governorInstalled && viewer) {
    try {
      const diagnostics = renderGovernor.getRenderGovernorDiagnostics();
      if (diagnostics.scheduledUpdates.length)
        throw new Error('Vessel trial left a scheduled render update');
      renderGovernor.uninstallRenderGovernor(viewer);
      governorInstalled = false;
      run.cleanup.governorUninstalled = true;
      report.cleanup.governorUninstalledCount += 1;
    } catch (error) {
      errors.push(
        `governor cleanup: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
  if (viewer && !viewer.isDestroyed()) {
    try {
      viewer.destroy();
      run.cleanup.viewerDestroyed = true;
      report.cleanup.viewerDestroyedCount += 1;
    } catch (error) {
      errors.push(
        `viewer destroy: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
  viewer = null;
  if (errors.length) {
    run.cleanup.error = errors.join('; ');
    if (run.status === 'passed') {
      run.status = 'failed';
      run.failedPhase = 'trial-cleanup';
      run.error = run.cleanup.error;
      throw new Error(run.cleanup.error);
    }
  }
}

async function runTrial(mode, pair) {
  phaseName = `${mode}-setup`;
  const renderingSettings = setupTrialViewer();
  const updates = [];
  const run = {
    schema: 'gev-vessel-render-demand/v1',
    status: 'running',
    mode,
    fixtureSha256,
    population: FIXTURE_ROWS.length,
    viewport: {
      width: viewer.scene.canvas.width,
      height: viewer.scene.canvas.height,
      devicePixelRatio: window.devicePixelRatio,
    },
    applicationCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    harnessCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    renderingSettings,
    phases: [],
    startedAtMonotonic: performance.now(),
    focusPasses: [],
    focusGeometry: null,
    visibilityPasses: [],
    scheduledUpdates: updates,
    cleanup: {
      layerDestroyed: false,
      renderDemandDisposed: false,
      viewerDestroyed: false,
      governorUninstalled: false,
    },
  };
  report.currentPair = pair;
  report.currentRun = run;
  report.phase = phaseName;
  window.__vesselRenderDemandResult = report;
  try {
    focus.clearFocusTarget('vessel-render-demand-fixture');
    setFixtureCamera();
    activeLayer = createVesselLayer({
      source: source(),
      services: fixtureServices(mode, updates, run),
    });
    activeLayer.init(viewer);
    await activeLayer.enable(viewer);
    await waitForPopulation();
    await wait(900);

    run.phases.push(await measurePhase(run, 'idleBefore', 3000));
    report.phase = phaseName = `${mode}-focus-active`;
    const collection = vesselCollection();
    let focusBillboard = null;
    for (let index = 0; collection && index < collection.length; index++) {
      const candidate = collection.get(index);
      if (candidate.show && candidate.position) {
        focusBillboard = candidate;
        break;
      }
    }
    if (!focusBillboard)
      throw new Error('No visible vessel is available as a focus-ray target');
    const focusPosition = Cesium.Cartesian3.lerp(
      viewer.camera.positionWC,
      focusBillboard.position,
      0.5,
      new Cesium.Cartesian3(),
    );
    const focusTarget = focus.publishFocusTargetFromCachedPosition({
      ownerLayer: 'vessel-render-demand-fixture',
      id: 'fixture-focus',
      scene: viewer.scene,
      camera: viewer.camera,
      displayPosition: focusPosition,
      widthPx: 46,
      heightPx: 46,
    });
    if (!focusTarget)
      throw new Error('Synthetic focus target could not be projected');
    const targetParams = focus.getFocusDeemphasisParams();
    const fartherThresholdM =
      focusTarget.cameraDistance * (1 + targetParams.distanceHysteresisRatio);
    let minimumVisibleVesselDistanceM = Number.POSITIVE_INFINITY;
    let distanceEligibleVesselCount = 0;
    let overlappingVesselCount = 0;
    let focusCompetingVesselCount = 0;
    for (let index = 0; collection && index < collection.length; index++) {
      const billboard = collection.get(index);
      if (!billboard.show || !billboard.position) continue;
      const distanceM = Cesium.Cartesian3.distance(
        viewer.camera.positionWC,
        billboard.position,
      );
      minimumVisibleVesselDistanceM = Math.min(
        minimumVisibleVesselDistanceM,
        distanceM,
      );
      const farther = distanceM >= fartherThresholdM;
      if (farther) distanceEligibleVesselCount++;
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        billboard.position,
      );
      if (!screen) continue;
      const halfWidth = ((billboard.width || 32) * (billboard.scale || 1)) / 2;
      const halfHeight =
        ((billboard.height || 32) * (billboard.scale || 1)) / 2;
      const overlaps =
        focus.focusTargetEmphasis(
          screen,
          Number.POSITIVE_INFINITY,
          focusTarget,
          undefined,
          false,
          halfWidth,
          halfHeight,
        ) < 1;
      if (overlaps) overlappingVesselCount++;
      if (
        focus.focusTargetEmphasis(
          screen,
          distanceM,
          focusTarget,
          undefined,
          false,
          halfWidth,
          halfHeight,
        ) < 1
      )
        focusCompetingVesselCount++;
    }
    run.focusGeometry = {
      sourceVesselId: String(
        focusBillboard.id?.mmsi ?? focusBillboard.id,
      ).slice(0, 80),
      cameraRayFraction: 0.5,
      cameraWorldPosition: [
        viewer.camera.positionWC.x,
        viewer.camera.positionWC.y,
        viewer.camera.positionWC.z,
      ],
      targetWorldPosition: [focusPosition.x, focusPosition.y, focusPosition.z],
      targetBillboardWorldPosition: [
        focusBillboard.position.x,
        focusBillboard.position.y,
        focusBillboard.position.z,
      ],
      targetCameraDistanceM: focusTarget.cameraDistance,
      fartherThresholdM,
      minimumVisibleVesselDistanceM: Number.isFinite(
        minimumVisibleVesselDistanceM,
      )
        ? minimumVisibleVesselDistanceM
        : null,
      distanceEligibleVesselCount,
      overlappingVesselCount,
      focusCompetingVesselCount,
    };
    if (focusCompetingVesselCount === 0)
      throw new Error(
        'Synthetic focus target has no visible vessel inside its production distance and screen-overlap bounds',
      );
    run.phases.push(await measurePhase(run, 'focusActive', 800));

    report.phase = phaseName = `${mode}-focus-release`;
    focus.clearFocusTarget('vessel-render-demand-fixture', 'fixture-focus');
    run.phases.push(await measurePhase(run, 'focusRelease', 1000));
    report.phase = phaseName = `${mode}-idle-after`;
    run.phases.push(await measurePhase(run, 'idleAfter', 2000));
    run.status = 'passed';
    return run;
  } catch (error) {
    const primaryError = error;
    run.status = 'failed';
    run.error = String(error?.message || error).slice(0, 500);
    run.failedPhase = phaseName;
    throw primaryError;
  } finally {
    const cleanupErrors = [];
    try {
      focus.clearFocusTarget('vessel-render-demand-fixture');
    } catch (error) {
      cleanupErrors.push(
        `focus cleanup: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
    if (activeLayer) {
      try {
        activeLayer.destroy(viewer);
        run.cleanup.layerDestroyed = true;
      } catch (error) {
        cleanupErrors.push(
          `layer cleanup: ${String(error?.message || error).slice(0, 300)}`,
        );
      } finally {
        activeLayer = null;
      }
    }
    run.cleanup.renderDemandDisposed =
      renderGovernor.getRenderGovernorDiagnostics().scheduledUpdates.length ===
      0;
    try {
      destroyTrialViewer(run);
    } catch (error) {
      cleanupErrors.push(String(error?.message || error).slice(0, 300));
    }
    if (cleanupErrors.length) {
      run.cleanup.error = cleanupErrors.join('; ');
      if (run.status === 'passed') {
        run.status = 'failed';
        run.failedPhase = 'trial-cleanup';
        run.error = run.cleanup.error;
        throw new Error(run.cleanup.error);
      }
    }
    window.__vesselRenderDemandResult = report;
  }
}

function observedRenderer() {
  const gl =
    viewer.scene.canvas.getContext('webgl2') ||
    viewer.scene.canvas.getContext('webgl');
  if (!gl) return null;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return debug
    ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
}

async function runFixture() {
  fixtureSha256 = await sha256(new TextEncoder().encode(FIXTURE_SOURCE));
  report = {
    schema: 'gev-vessel-render-demand/v1',
    status: 'running',
    mode: 'paired',
    applicationCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    harnessCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    fixtureSha256,
    fixtureEpochMs: FIXTURE_EPOCH_MS,
    fixtureClock: { epochMs: FIXTURE_EPOCH_MS, shouldAnimate: false },
    scope: 'isolated synthetic billboard-only layer; shared overlays excluded',
    population: FIXTURE_ROWS.length,
    environment: { renderer: null },
    viewport: null,
    renderingSettings: null,
    cadencePolicyMs: {
      idleVisibility: VISIBILITY_UPDATE_MS,
      activeFocus: FOCUS_UPDATE_MS,
    },
    pairs: [],
    startedAt: new Date().toISOString(),
    cleanup: {
      viewerDestroyed: false,
      governorUninstalled: false,
      viewerDestroyedCount: 0,
      governorUninstalledCount: 0,
    },
  };
  window.__vesselRenderDemandResult = report;
  for (let pairNumber = 0; pairNumber < PAIR_COUNT; pairNumber++) {
    const order =
      pairNumber % 2 === 0
        ? ['control', 'candidate']
        : ['candidate', 'control'];
    const runs = [];
    const pair = { pair: pairNumber, order, runs, comparison: null };
    report.pairs.push(pair);
    window.__vesselRenderDemandResult = report;
    for (const runMode of order) {
      const run = await runTrial(runMode, pairNumber);
      runs.push(run);
      window.__vesselRenderDemandResult = report;
    }
    const control = runs.find((run) => run.mode === 'control');
    const candidate = runs.find((run) => run.mode === 'candidate');
    const comparison = compareVesselRenderDemandRuns(control, candidate, {
      expectedCommit: report.applicationCommit,
    });
    pair.comparison = { phaseResults: comparison.phaseResults };
    report.currentPair = pairNumber;
    report.currentRun = null;
    window.__vesselRenderDemandResult = report;
  }
  report.cleanup.viewerDestroyed =
    report.cleanup.viewerDestroyedCount === PAIR_COUNT * 2;
  report.cleanup.governorUninstalled =
    report.cleanup.governorUninstalledCount === PAIR_COUNT * 2;
  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  return report;
}

async function cleanup() {
  measurement = null;
  removePostRender?.();
  removePostRender = null;
  focus.clearFocusTarget('vessel-render-demand-fixture');
  const errors = [];
  if (activeLayer && viewer) {
    try {
      activeLayer.destroy(viewer);
      activeLayer = null;
    } catch (error) {
      errors.push(
        `layer destroy: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
  if (governorInstalled && viewer) {
    try {
      const diagnostics = renderGovernor.getRenderGovernorDiagnostics();
      if (diagnostics.scheduledUpdates.length)
        throw new Error('Scheduled render updates remain');
      renderGovernor.uninstallRenderGovernor(viewer);
      governorInstalled = false;
      if (report) report.cleanup.governorUninstalled = true;
    } catch (error) {
      errors.push(
        `governor cleanup: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
  if (viewer && !viewer.isDestroyed()) {
    try {
      viewer.destroy();
      report && (report.cleanup.viewerDestroyed = true);
    } catch (error) {
      errors.push(
        `viewer destroy: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

function publish() {
  window.__vesselRenderDemandResult = report;
  document.getElementById('result').textContent = JSON.stringify(report);
  document.getElementById('status').textContent =
    report?.status === 'passed' ? 'Finished' : 'Failed';
  document.getElementById('download').disabled = false;
}

document.getElementById('run').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  document.getElementById('status').textContent =
    'Running five alternating pairs';
  try {
    await runFixture();
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error).slice(0, 500);
    report.failedPhase = phaseName;
    report.finishedAt = new Date().toISOString();
  } finally {
    try {
      await cleanup();
    } catch (error) {
      report.status = 'failed';
      report.cleanup.error = String(error?.message || error).slice(0, 500);
    }
    publish();
  }
});

document.getElementById('download').addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `vessel-render-demand-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
