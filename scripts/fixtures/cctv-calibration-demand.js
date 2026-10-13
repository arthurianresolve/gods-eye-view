import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createApplicationCctv } from '../../src/app/layers/cctv.js';
import { cameraHue, viewshedColors } from '../../src/data/cctvViewshed.js';
import {
  destroyWorldOverlay,
  initWorldOverlay,
} from '../../src/overlays/worldOverlay.js';
import {
  getRenderGovernorDiagnostics,
  holdContinuousRender,
  installRenderGovernor,
  releaseContinuousRender,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';
import {
  compareCctvCalibrationPair,
  summarizeCctvRgbaDifference,
  validateCctvCalibrationDemandReport,
} from '../performance/cctvCalibrationDemand.mjs';
import {
  createImportFrameDiagnostics,
  createSceneFrameTimingDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';
import {
  CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
  CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR,
  CCTV_VIEWSHED_RETENTION_FIXTURE_ID,
  CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256,
  CCTV_VIEWSHED_RETENTION_LIMIT,
  CCTV_VIEWSHED_RETENTION_MODES,
  validateCctvViewshedRetentionReport,
} from '../performance/cctvViewshedRetention.mjs';

const FIXTURE_ID = 'cctv-calibration-native-drag/v1';
const CAMERA_ID = 'qa-cctv-calibration-camera-001';
const PAIRS = 5;
const IDLE_MS = 10_000;
const MAX_FAILURE_PNG_DATA_URL_CHARS = 1_500_000;
const MAX_VIEWSHED_FAILURE_PNG_CHARS = 300_000;
const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 8, 12, 0, 0);
const OWNER = 'qa-cctv-adjust-legacy-control';
const COMMIT =
  typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null;
const FRAME_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQ7rnzH4QZYAwAVbIKKdmcsa8AAAAASUVORK5CYII=';
const CAMERA = Object.freeze({
  id: CAMERA_ID,
  name: 'Calibration demand fixture',
  city: 'Austin',
  cityId: 'austin',
  lat: 30.2672,
  lon: -97.7431,
  headingDeg: 0,
  fovDeg: 70,
  rangeM: 700,
  mountHeightM: 22,
  pitchDeg: -17,
  groundElevationM: 0,
  feedType: 'image',
  provider: 'Synthetic CCTV fixture',
  sourceKind: 'synthetic',
  url: 'fixture://cctv-calibration-frame',
});
const CAMERA_SOURCE = {
  async getCatalog() {
    const viewshedMode =
      new URLSearchParams(location.search).get('mode') === 'viewshed-retention';
    const descriptor = CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR;
    const layout = descriptor.cameraLayout;
    return {
      sources: viewshedMode
        ? Array.from({ length: descriptor.cameraIds.length }, (_, index) => ({
            ...CAMERA,
            id: descriptor.cameraIds[index],
            name: `Viewshed retention camera ${index + 1}`,
            lat:
              CAMERA.lat +
              (Math.floor(index / layout.gridColumns) - 1.5) *
                layout.stepDegrees,
            lon:
              CAMERA.lon +
              ((index % layout.gridColumns) - 1.5) * layout.stepDegrees,
          }))
        : [{ ...CAMERA }],
    };
  },
  async getHealth() {
    return { cameras: [] };
  },
  getFrameUrl: () => FRAME_DATA_URI,
  getMediaUrl: () => FRAME_DATA_URI,
};
const FIXTURE_SURFACE = {
  terrain: {
    async resolveEllipsoidalGround(points) {
      return points.map(() => ({ ellipsoid: 0, source: 'fixture-ellipsoid' }));
    },
  },
  groundFloor: {
    async resolveGroundFloorCells() {
      return [];
    },
    warmGroundFloor() {},
    cachedGroundFloor() {
      return 0;
    },
  },
  meshFloor: {
    sampleMeshFloorCells() {
      return false;
    },
  },
};
const FIXTURE_SOURCE_HASH_PAYLOAD = JSON.stringify({
  fixtureId: FIXTURE_ID,
  epochMs: FIXTURE_EPOCH_MS,
  camera: CAMERA,
  frame: FRAME_DATA_URI,
  view: { longitude: CAMERA.lon, latitude: CAMERA.lat, heightM: 3500 },
  settings: { coverageMode: 'off', showProjection: false, autoHop: false },
  idleMs: IDLE_MS,
});

const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const resultNode = document.querySelector('#result');
const pointerNode = document.querySelector('#pointer-instruction');
const viewerNode = document.querySelector('#viewer');
const creditsNode = document.querySelector('#credits');
let activeReport = null;
let activeRun = null;
const visualizerUpdates = new WeakMap();

function observeVisualizerUpdates(viewer) {
  const display = viewer.dataSourceDisplay;
  const own = Object.getOwnPropertyDescriptor(display, 'update');
  const original = display.update;
  const state = { ready: null, updates: 0, lastReadyFrameAtMs: null };
  // DataSourceDisplay.ready is latched after its first success. The public
  // update() result describes this update, including geometry rebuilt later.
  function observedUpdate(...args) {
    const result = original.apply(this, args);
    state.ready = result;
    state.updates++;
    return result;
  }
  display.update = observedUpdate;
  const removeRender = viewer.scene.postRender.addEventListener(() => {
    if (state.ready === true) state.lastReadyFrameAtMs = performance.now();
  });
  visualizerUpdates.set(viewer, state);
  return () => {
    removeRender();
    if (display.update === observedUpdate) {
      if (own) Object.defineProperty(display, 'update', own);
      else delete display.update;
    }
    visualizerUpdates.delete(viewer);
  };
}
let terminalReportText = null;

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

function hex(bytes) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));
}

async function sourceDigest() {
  return sha256(new TextEncoder().encode(FIXTURE_SOURCE_HASH_PAYLOAD));
}

function updateStatus(message) {
  statusNode.textContent = String(message).slice(0, 180);
}

function setPhase(phase) {
  if (activeReport) activeReport.phase = phase;
  if (activeRun?.status === 'running') activeRun.phase = phase;
  publishPartial();
}

function publishPartial() {
  window.__cctvCalibrationDemandResult = activeReport;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rendererName(viewer) {
  try {
    const gl =
      viewer.scene.context?._originalGLContext ||
      viewer.scene.context?._gl ||
      viewer.canvas.getContext('webgl2') ||
      viewer.canvas.getContext('webgl');
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const masked = gl.getParameter(gl.RENDERER);
    return {
      renderer: typeof renderer === 'string' ? renderer.slice(0, 240) : null,
      maskedRenderer: typeof masked === 'string' ? masked.slice(0, 240) : null,
      rendererIdentity: extension ? 'unmasked-extension' : 'masked-fallback',
    };
  } catch {
    return {
      renderer: null,
      maskedRenderer: null,
      rendererIdentity: 'unavailable',
    };
  }
}

function currentCalibration(layer) {
  const values = layer.getParams()?.calibration?.values;
  check(
    values && Number.isFinite(values.offsetEastM),
    'CCTV calibration state is unavailable.',
  );
  return {
    offsetEastM: values.offsetEastM,
    offsetNorthM: values.offsetNorthM,
    headingDeg: values.headingDeg,
    pitchDeg: values.pitchDeg,
    fovDeg: values.fovDeg,
    rangeScale: values.rangeScale,
    heightM: values.heightM,
  };
}

function frameCountListener(viewer) {
  let count = 0;
  let overflowCount = 0;
  const startedAt = performance.now();
  const elapsedMs = [];
  const remove = viewer.scene.postRender.addEventListener(() => {
    count = Math.min(count + 1, 10_000);
    if (elapsedMs.length < 32)
      elapsedMs.push(Math.max(0, performance.now() - startedAt));
    else overflowCount = Math.min(overflowCount + 1, Number.MAX_SAFE_INTEGER);
  });
  return {
    read: () => count,
    samples: () => ({
      scope: 'Completed postRender timestamps from listener attachment',
      sampleLimit: 32,
      elapsedMs: [...elapsedMs],
      overflowCount,
    }),
    remove,
  };
}

function layoutSnapshot(viewer) {
  const canvas = viewer.canvas;
  const rect = canvas.getBoundingClientRect();
  return {
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
    cssWidth: rect.width,
    cssHeight: rect.height,
    cssLeft: rect.left,
    cssTop: rect.top,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function sameLayout(a, b) {
  return Boolean(
    a &&
    b &&
    Object.keys(a).every((key) => Number.isFinite(a[key]) && a[key] === b[key]),
  );
}

function applySettledLayout(trial, viewer, attrs) {
  const layout = layoutSnapshot(viewer);
  trial.viewport = {
    width: layout.drawingBufferWidth,
    height: layout.drawingBufferHeight,
    devicePixelRatio: layout.devicePixelRatio,
    cssWidth: layout.cssWidth,
    cssHeight: layout.cssHeight,
    viewportWidth: layout.viewportWidth,
    viewportHeight: layout.viewportHeight,
  };
  trial.layoutEvidence = {
    settled: layout,
    cameraCapture: null,
    beforePixelsCapture: null,
    afterPixelsCapture: null,
  };
  trial.renderingSettings = {
    initialRequestRenderMode: viewer.scene.requestRenderMode,
    drawingBufferWidth: layout.drawingBufferWidth,
    drawingBufferHeight: layout.drawingBufferHeight,
    cssWidth: layout.cssWidth,
    cssHeight: layout.cssHeight,
    viewportWidth: layout.viewportWidth,
    viewportHeight: layout.viewportHeight,
    devicePixelRatio: layout.devicePixelRatio,
    msaaSamples: viewer.scene.msaaSamples,
    antialias: attrs?.antialias ?? null,
    preserveDrawingBuffer: attrs?.preserveDrawingBuffer ?? null,
    contextAttributes: attrs
      ? {
          alpha: attrs.alpha,
          antialias: attrs.antialias,
          depth: attrs.depth,
          premultipliedAlpha: attrs.premultipliedAlpha,
          preserveDrawingBuffer: attrs.preserveDrawingBuffer,
          stencil: attrs.stencil,
        }
      : null,
    requestRenderModeDuringIdle: null,
  };
  return layout;
}

function safeCameraState(viewer) {
  const camera = viewer?.camera;
  const vector = (value) =>
    value && [value.x, value.y, value.z].every(Number.isFinite)
      ? [value.x, value.y, value.z]
      : null;
  return {
    position: vector(camera?.positionWC),
    direction: vector(camera?.directionWC),
    up: vector(camera?.upWC),
  };
}

function propertyValue(property, time) {
  try {
    return property?.getValue ? property.getValue(time) : property;
  } catch {
    return null;
  }
}

function colorState(value) {
  return value &&
    [value.red, value.green, value.blue, value.alpha].every(Number.isFinite)
    ? [value.red, value.green, value.blue, value.alpha]
    : null;
}

function materialState(property, time) {
  if (!property) return null;
  const resolved = propertyValue(property, time);
  return {
    type: String(property.constructor?.name || 'unknown').slice(0, 80),
    color: colorState(resolved?.color || resolved),
  };
}

function gizmoStyleSnapshot(viewer) {
  const time = viewer.clock.currentTime;
  return viewer.entities.values
    .filter((entity) => String(entity.id).startsWith('cctv-gizmo-'))
    .map((entity) => {
      const point = entity.point;
      const polyline = entity.polyline;
      return {
        id: String(entity.id),
        entityShow: Boolean(entity.show),
        point: point
          ? {
              show: propertyValue(point.show, time) ?? null,
              pixelSize: propertyValue(point.pixelSize, time) ?? null,
              color: colorState(propertyValue(point.color, time)),
              outlineColor: colorState(propertyValue(point.outlineColor, time)),
              outlineWidth: propertyValue(point.outlineWidth, time) ?? null,
            }
          : null,
        polyline: polyline
          ? {
              show: propertyValue(polyline.show, time) ?? null,
              width: propertyValue(polyline.width, time) ?? null,
              material: materialState(polyline.material, time),
              depthFailMaterial: materialState(
                polyline.depthFailMaterial,
                time,
              ),
            }
          : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function safeRequestStack(stack) {
  return String(stack || '')
    .split('\n')
    .slice(2, 8)
    .map((line) => {
      const functionName =
        line.match(/^\s*at\s+([^\s(]+)(?:\s+\(|$)/)?.[1] || 'anonymous';
      const location = line.match(/\(([^()]*)\)\s*$/)?.[1] || line.trim();
      const source = location
        .split(/[?#]/, 1)[0]
        .split(/[\\/]/)
        .pop()
        ?.replace(/:\d+:\d+$/, '');
      return {
        function: /^[\w.$<>-]{1,100}$/.test(functionName)
          ? functionName
          : 'anonymous',
        source: /^[\w.-]{1,100}$/.test(source || '') ? source : null,
      };
    })
    .filter((frame) => frame.function !== 'anonymous' || frame.source);
}

function observeSceneRenderRequests(scene) {
  const original = scene?.requestRender;
  if (typeof original !== 'function') return null;
  const descriptor = Object.getOwnPropertyDescriptor(scene, 'requestRender');
  const startedAt = performance.now();
  const startedAtEpochMs = Date.now();
  let calls = 0;
  let overflowCount = 0;
  const samples = [];
  const wrapper = function (...args) {
    calls = Math.min(calls + 1, Number.MAX_SAFE_INTEGER);
    if (samples.length < 32) {
      samples.push({
        elapsedMs: Math.max(0, performance.now() - startedAt),
        epochMs: Date.now(),
        callers: safeRequestStack(new Error().stack),
      });
    } else {
      overflowCount = Math.min(overflowCount + 1, Number.MAX_SAFE_INTEGER);
    }
    return original.apply(this, args);
  };
  try {
    scene.requestRender = wrapper;
  } catch {
    return null;
  }
  if (scene.requestRender !== wrapper) return null;
  let disposed = false;
  return {
    startedAtEpochMs,
    snapshot() {
      return {
        scope: 'Observed scene.requestRender calls; not a render or GPU timing',
        startedAtEpochMs,
        endedAtEpochMs: Date.now(),
        totalCalls: calls,
        sampleLimit: 32,
        sampleOverflowCount: overflowCount,
        samples: [...samples],
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scene.requestRender !== wrapper) return;
      if (descriptor) Object.defineProperty(scene, 'requestRender', descriptor);
      else delete scene.requestRender;
    },
  };
}

function renderGovernorSnapshot() {
  const diagnostics = getRenderGovernorDiagnostics();
  return {
    capturedAtEpochMs: Date.now(),
    installed: diagnostics.installed,
    mode: diagnostics.mode,
    holds: [...diagnostics.holds].slice(0, 32),
    scheduledUpdates: [...diagnostics.scheduledUpdates].slice(0, 32),
    recentRequests: diagnostics.recentRequests.slice(-16).map((request) => ({
      reason: String(request.reason || '').slice(0, 80),
      at: Number.isFinite(request.at) ? request.at : null,
    })),
    recentRequestCapacity: 16,
  };
}

function sceneSnapshot(viewer, layer) {
  let layerStats = null;
  let layerDiagnostics = null;
  try {
    const stats = layer?.getStats?.();
    if (stats) {
      layerStats = {
        count: Number.isSafeInteger(stats.count) ? stats.count : null,
        loading: typeof stats.loading === 'boolean' ? stats.loading : null,
      };
    }
    const diagnostics = layer?.getPerformanceDiagnostics?.();
    if (diagnostics) {
      layerDiagnostics = {
        pendingJobs: Number.isSafeInteger(diagnostics.pendingJobs)
          ? diagnostics.pendingJobs
          : null,
        listeners: Number.isSafeInteger(diagnostics.listeners)
          ? diagnostics.listeners
          : null,
      };
    }
  } catch {
    layerStats = null;
    layerDiagnostics = null;
  }
  return {
    layout: viewer ? layoutSnapshot(viewer) : null,
    frameNumber: Number.isSafeInteger(viewer?.scene?.frameState?.frameNumber)
      ? viewer.scene.frameState.frameNumber
      : null,
    requestRenderMode: viewer?.scene?.requestRenderMode ?? null,
    globeVisible: viewer?.scene?.globe?.show ?? null,
    tilesLoaded: viewer?.scene?.globe?.tilesLoaded ?? null,
    camera: safeCameraState(viewer),
    layerStats,
    layerDiagnostics,
    viewerDestroyed: viewer?.isDestroyed?.() ?? null,
  };
}

async function collectCaptureFailureDiagnostics(
  viewer,
  layer,
  phase,
  error,
  before,
  after,
) {
  const lifecycle = createImportFrameDiagnostics({
    windowTarget: window,
    documentTarget: document,
  });
  const scene = viewer?.scene;
  let frameTimingDiagnostics = null;
  let frameTimingSetupError = null;
  let frameTiming = null;
  try {
    frameTimingDiagnostics = createSceneFrameTimingDiagnostics(scene);
  } catch (diagnosticError) {
    frameTimingSetupError = String(
      diagnosticError?.message || diagnosticError,
    ).slice(0, 240);
  }
  const eventNames = ['preUpdate', 'postUpdate', 'preRender', 'postRender'];
  const sceneEvents = Object.fromEntries(eventNames.map((name) => [name, 0]));
  const removes = [];
  const renderErrors = [];
  const listenerCleanupErrors = [];
  const sceneBefore = sceneSnapshot(viewer, layer);
  const lifecycleBefore = lifecycle.snapshotCanvas(viewer?.canvas);
  let result;
  try {
    if (scene) {
      for (const name of eventNames) {
        const event = scene[name];
        if (!event?.addEventListener) continue;
        const remove = event.addEventListener(() => {
          sceneEvents[name] = Math.min(sceneEvents[name] + 1, 10_000);
        });
        if (typeof remove === 'function') removes.push(remove);
      }
      if (scene.renderError?.addEventListener) {
        const remove = scene.renderError.addEventListener((_, cause) => {
          if (renderErrors.length < 8) {
            renderErrors.push({
              name: String(cause?.name || 'Error').slice(0, 80),
              message: String(cause?.message || cause || '').slice(0, 240),
            });
          }
        });
        if (typeof remove === 'function') removes.push(remove);
      }
    }
    const frameHealth = await observeImportFrameHealth({ durationMs: 1000 });
    result = {
      phase,
      captureTimeoutMs: 400,
      primaryError: {
        name: String(error?.name || 'Error').slice(0, 80),
        message: String(error?.message || error).slice(0, 300),
      },
      before,
      after,
      lifecycleBefore,
      lifecycleAfter: lifecycle.snapshotCanvas(viewer?.canvas),
      lifecycleEvents: lifecycle.events(),
      frameHealth,
      frameTimingSetupError,
      sceneEventCounts: sceneEvents,
      renderErrors,
      sceneBefore,
      sceneAfter: sceneSnapshot(viewer, layer),
      listenerCleanupErrors,
    };
  } catch (diagnosticError) {
    result = {
      phase,
      captureTimeoutMs: 400,
      primaryError: {
        name: String(error?.name || 'Error').slice(0, 80),
        message: String(error?.message || error).slice(0, 300),
      },
      before,
      after,
      diagnosticError: String(
        diagnosticError?.message || diagnosticError,
      ).slice(0, 240),
      frameTimingSetupError,
      sceneEventCounts: sceneEvents,
      renderErrors,
      sceneBefore,
      sceneAfter: sceneSnapshot(viewer, layer),
      listenerCleanupErrors,
    };
  } finally {
    try {
      frameTiming = frameTimingDiagnostics?.stop() ?? null;
    } catch (diagnosticError) {
      frameTimingSetupError ||= String(
        diagnosticError?.message || diagnosticError,
      ).slice(0, 240);
    }
    for (const remove of removes) {
      try {
        remove();
      } catch (error) {
        if (listenerCleanupErrors.length < 8)
          listenerCleanupErrors.push(
            String(error?.message || error).slice(0, 160),
          );
      }
    }
    try {
      lifecycle.dispose();
    } catch (error) {
      if (listenerCleanupErrors.length < 8)
        listenerCleanupErrors.push(
          String(error?.message || error).slice(0, 160),
        );
    }
  }
  if (result) {
    result.frameTiming = frameTiming;
    result.frameTimingSetupError = frameTimingSetupError;
  }
  return result;
}

async function captureTrialFrame(viewer, layer, trial, phase) {
  const before = layoutSnapshot(viewer);
  const expected = trial.layoutEvidence?.settled;
  let canvas = null;
  let failure = null;
  try {
    canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
    check(canvas, 'Fresh viewer frame was unavailable within 400 ms.');
  } catch (error) {
    failure = error;
  }
  const after = layoutSnapshot(viewer);
  const entry = { before, after, stable: sameLayout(before, after) };
  if (phase === 'camera-pose') trial.layoutEvidence.cameraCapture = entry;
  else if (phase === 'before-pixels')
    trial.layoutEvidence.beforePixelsCapture = entry;
  else if (phase === 'after-pixels')
    trial.layoutEvidence.afterPixelsCapture = entry;
  if (failure) {
    trial.captureDiagnostics = await collectCaptureFailureDiagnostics(
      viewer,
      layer,
      phase,
      failure,
      before,
      after,
    );
    throw failure;
  }
  if (!entry.stable || !sameLayout(expected, after)) {
    canvas.width = 0;
    canvas.height = 0;
    const error = new Error(
      'CCTV canvas layout changed after settled fixture initialization.',
    );
    trial.captureDiagnostics = await collectCaptureFailureDiagnostics(
      viewer,
      layer,
      phase,
      error,
      before,
      after,
    );
    throw error;
  }
  return canvas;
}

function cameraSnapshot(viewer, layer) {
  const camera = viewer.camera;
  const entities = viewer.entities.values
    .filter((entity) => String(entity.id).startsWith('cctv-gizmo-'))
    .map((entity) => {
      const position = entity.position?.getValue?.(viewer.clock.currentTime);
      const positions =
        entity.polyline?.positions?.getValue?.(viewer.clock.currentTime) ||
        entity.polyline?.positions;
      return {
        id: String(entity.id),
        entityShow: Boolean(entity.show),
        positionAvailable: Boolean(position),
        visiblePosition: Boolean(entity.show && position),
        position: position ? [position.x, position.y, position.z] : null,
        positions: Array.isArray(positions)
          ? positions.map((value) => [value.x, value.y, value.z])
          : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  check(entities.length > 0, 'CCTV calibration gizmo geometry is missing.');
  const params = layer.getParams();
  return {
    selectedCameraId: params.selectedCameraId,
    position: [camera.positionWC.x, camera.positionWC.y, camera.positionWC.z],
    direction: [
      camera.directionWC.x,
      camera.directionWC.y,
      camera.directionWC.z,
    ],
    up: [camera.upWC.x, camera.upWC.y, camera.upWC.z],
    geometryPayload: entities,
    stylePayload: gizmoStyleSnapshot(viewer),
  };
}

async function attachCameraGeometryDigest(run, viewer, layer) {
  const camera = cameraSnapshot(viewer, layer);
  run.camera = {
    selectedCameraId: camera.selectedCameraId,
    position: camera.position,
    direction: camera.direction,
    up: camera.up,
    geometrySha256: await sha256(
      new TextEncoder().encode(JSON.stringify(camera.geometryPayload)),
    ),
  };
}

function viewportSnapshot(viewer) {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    canvasLayout: viewer ? layoutSnapshot(viewer) : null,
  };
}

function observeIdleConditions(viewer) {
  const startedAt = performance.now();
  const before = viewportSnapshot(viewer);
  const events = [];
  let eventOverflow = false;
  let canvasLayoutUnchanged = Boolean(before.canvasLayout);
  let foregroundUninterrupted =
    before.visibilityState === 'visible' && before.focused;
  const record = (event) => {
    const value = { type: event.type, ...viewportSnapshot(viewer) };
    if (value.visibilityState !== 'visible' || !value.focused)
      foregroundUninterrupted = false;
    if (
      value.viewportWidth !== before.viewportWidth ||
      value.viewportHeight !== before.viewportHeight ||
      value.devicePixelRatio !== before.devicePixelRatio
    )
      foregroundUninterrupted = false;
    if (!sameLayout(value.canvasLayout, before.canvasLayout)) {
      canvasLayoutUnchanged = false;
      foregroundUninterrupted = false;
    }
    if (events.length < 16) events.push(value);
    else eventOverflow = true;
  };
  document.addEventListener('visibilitychange', record);
  for (const type of ['focus', 'blur', 'resize'])
    window.addEventListener(type, record);
  return {
    finish({ completedPhase = 'observation' } = {}) {
      document.removeEventListener('visibilitychange', record);
      for (const type of ['focus', 'blur', 'resize'])
        window.removeEventListener(type, record);
      const after = viewportSnapshot(viewer);
      if (after.visibilityState !== 'visible' || !after.focused)
        foregroundUninterrupted = false;
      if (!sameLayout(after.canvasLayout, before.canvasLayout)) {
        canvasLayoutUnchanged = false;
        foregroundUninterrupted = false;
      }
      return {
        before,
        after,
        events,
        eventOverflow,
        foregroundUninterrupted,
        canvasLayoutUnchanged,
        durationMs: performance.now() - startedAt,
        completedPhase,
      };
    },
  };
}

async function capturePixels(viewer, layer, trial, phase) {
  const canvas = await captureTrialFrame(viewer, layer, trial, phase);
  try {
    const sampledCamera = cameraSnapshot(viewer, layer);
    const dataSourceDisplayReady = viewer.dataSourceDisplay?.ready ?? null;
    const rgba = canvas
      .getContext('2d')
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    check(rgba && rgba.length, 'CCTV pixel readback is unavailable.');
    let nonBackgroundPixels = 0;
    // Match the declared #09141f clear color with a small byte margin; merely
    // counting nonzero RGB would classify every clear pixel as geometry.
    for (let index = 0; index < rgba.length; index += 4)
      if (
        Math.abs(rgba[index] - 9) > 8 ||
        Math.abs(rgba[index + 1] - 20) > 8 ||
        Math.abs(rgba[index + 2] - 31) > 8
      )
        nonBackgroundPixels++;
    check(
      nonBackgroundPixels > 20,
      'CCTV viewer frame contains no visible fixture geometry.',
    );
    const bytes = new Uint8Array(rgba.length);
    bytes.set(rgba);
    const captureState = {
      dataSourceDisplayReady,
      currentVisualizerUpdateReady:
        visualizerUpdates.get(viewer)?.ready ?? null,
      selectedCameraId: sampledCamera.selectedCameraId,
      position: sampledCamera.position,
      direction: sampledCamera.direction,
      up: sampledCamera.up,
      geometrySha256: await sha256(
        new TextEncoder().encode(JSON.stringify(sampledCamera.geometryPayload)),
      ),
      styleSha256: await sha256(
        new TextEncoder().encode(JSON.stringify(sampledCamera.stylePayload)),
      ),
      stylePayload: sampledCamera.stylePayload,
    };
    const result = {
      sha256: await sha256(bytes),
      width: canvas.width,
      height: canvas.height,
      nonBackgroundPixels,
      captureState,
    };
    if (phase === 'after-pixels')
      Object.defineProperty(result, 'rgbaEvidence', {
        configurable: true,
        enumerable: false,
        value: bytes,
      });
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function observeIncompleteVisualizers(viewer, layer, trial) {
  if (trial.afterPixels?.captureState?.currentVisualizerUpdateReady !== false)
    return;
  const startedAt = performance.now();
  const report = {
    scope:
      'Diagnostic only: passive completion after the original captured frame; never replaces its acceptance pixels',
    initialReady: false,
    completedFrames: 0,
    readyObserved: false,
    readyElapsedMs: null,
    finalPixels: null,
    error: null,
  };
  trial.visualizerFollowup = report;
  let remove = null;
  let timeout = null;
  try {
    await new Promise((resolve) => {
      remove = viewer.scene.postRender.addEventListener(() => {
        report.completedFrames++;
        if (visualizerUpdates.get(viewer)?.ready === true) {
          report.readyObserved = true;
          report.readyElapsedMs = performance.now() - startedAt;
          resolve();
        }
      });
      timeout = setTimeout(resolve, 2000);
    });
  } finally {
    remove?.();
    clearTimeout(timeout);
    report.elapsedMs = performance.now() - startedAt;
  }
  if (report.readyObserved) {
    try {
      report.finalPixels = await capturePixels(
        viewer,
        layer,
        trial,
        'diagnostic-ready-pixels',
      );
    } catch (error) {
      report.error = String(error?.message || error).slice(0, 240);
    }
  }
}

function renderRgbaFailurePng(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    check(context, 'Could not create bounded CCTV mismatch image canvas.');
    const image = context.createImageData(width, height);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    check(
      dataUrl.startsWith('data:image/png;base64,'),
      'Invalid mismatch PNG.',
    );
    if (dataUrl.length > MAX_FAILURE_PNG_DATA_URL_CHARS) return null;
    return dataUrl.slice('data:image/png;base64,'.length);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function pairPixelFailureEvidence(pair) {
  const control = pair.runs.find((run) => run.mode === 'legacy-control');
  const candidate = pair.runs.find((run) => run.mode === 'candidate');
  const controlPixels = control?.afterPixels;
  const candidatePixels = candidate?.afterPixels;
  if (
    !controlPixels?.rgbaEvidence ||
    !candidatePixels?.rgbaEvidence ||
    controlPixels.width !== candidatePixels.width ||
    controlPixels.height !== candidatePixels.height
  )
    return {
      status: 'unavailable',
      reason: 'Both bounded after-pixel RGBA surfaces were not retained.',
    };
  const summary = summarizeCctvRgbaDifference(
    controlPixels.rgbaEvidence,
    candidatePixels.rgbaEvidence,
    controlPixels.width,
    controlPixels.height,
  );
  if (summary.differenceCount === 0) return null;
  const evidence = {
    status: 'mismatch',
    ...summary,
    width: controlPixels.width,
    height: controlPixels.height,
    controlPngBase64: null,
    candidatePngBase64: null,
    pngOmitted: null,
  };
  try {
    evidence.controlPngBase64 = renderRgbaFailurePng(
      controlPixels.rgbaEvidence,
      controlPixels.width,
      controlPixels.height,
    );
    evidence.candidatePngBase64 = renderRgbaFailurePng(
      candidatePixels.rgbaEvidence,
      candidatePixels.width,
      candidatePixels.height,
    );
    if (!evidence.controlPngBase64 || !evidence.candidatePngBase64) {
      evidence.controlPngBase64 = null;
      evidence.candidatePngBase64 = null;
      evidence.pngOmitted = 'A failure PNG exceeded the bounded report size.';
    }
  } catch (error) {
    evidence.controlPngBase64 = null;
    evidence.candidatePngBase64 = null;
    evidence.pngOmitted = String(error?.message || error).slice(0, 160);
  }
  return evidence;
}

function releasePairRgbaEvidence(pair) {
  for (const run of pair.runs || []) {
    if (run.afterPixels && Object.hasOwn(run.afterPixels, 'rgbaEvidence'))
      delete run.afterPixels.rgbaEvidence;
  }
}

function createViewer() {
  const viewer = createApplicationViewer({
    container: viewerNode,
    creditContainer: creditsNode,
  });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#09141f');
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.scene.globe.show = false;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(
    new Date(FIXTURE_EPOCH_MS),
  );
  viewer.clock.shouldAnimate = false;
  viewer.clock.multiplier = 0;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(CAMERA.lon, CAMERA.lat, 3500),
    orientation: {
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    },
  });
  installRenderGovernor(viewer);
  initWorldOverlay(viewer);
  return viewer;
}

function installViewshedPrimitiveObserver(viewer) {
  const collection = viewer.scene.primitives;
  const ownAdd = Object.getOwnPropertyDescriptor(collection, 'add');
  const ownRemove = Object.getOwnPropertyDescriptor(collection, 'remove');
  const originalAdd = collection.add;
  const originalRemove = collection.remove;
  const live = new Map();
  const livePrimitives = new Set();
  let created = 0;
  let removed = 0;
  let destroyed = 0;
  let peakLive = 0;
  let duplicateCameraIds = 0;
  function observedAdd(primitive) {
    const result = originalAdd.call(this, primitive);
    if (typeof primitive?._gevViewshed === 'string') {
      if (live.has(primitive._gevViewshed)) duplicateCameraIds++;
      live.set(primitive._gevViewshed, primitive);
      livePrimitives.add(primitive);
      created++;
      peakLive = Math.max(peakLive, livePrimitives.size);
    }
    return result;
  }
  function observedRemove(primitive, destroyPrimitives) {
    const result = originalRemove.call(this, primitive, destroyPrimitives);
    const id = primitive?._gevViewshed;
    if (result && typeof id === 'string' && livePrimitives.has(primitive)) {
      if (live.get(id) === primitive) live.delete(id);
      livePrimitives.delete(primitive);
      removed++;
      if (primitive.isDestroyed?.() === true) destroyed++;
    }
    return result;
  }
  collection.add = observedAdd;
  collection.remove = observedRemove;
  return {
    live,
    counts: () => ({
      created,
      removed,
      destroyed,
      live: livePrimitives.size,
      peakLive,
      duplicateCameraIds,
    }),
    restore() {
      if (ownAdd) Object.defineProperty(collection, 'add', ownAdd);
      else delete collection.add;
      if (ownRemove) Object.defineProperty(collection, 'remove', ownRemove);
      else delete collection.remove;
      return (
        collection.add === originalAdd && collection.remove === originalRemove
      );
    },
  };
}

function viewshedCameraPose(viewer) {
  const cartographic = viewer.camera.positionCartographic;
  return {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
  };
}

function viewshedSettings(viewer, layer, attrs) {
  const params = layer?.getParams?.() || {};
  return {
    coverageMode: params.coverageMode ?? null,
    showProjection: params.showProjection ?? null,
    autoHop: params.autoHop ?? null,
    requestRenderMode: viewer.scene.requestRenderMode,
    globeShown: viewer.scene.globe.show,
    clockEpochMs: Date.parse(viewer.clock.currentTime.toString()),
    drawingBufferWidth: viewer.scene.drawingBufferWidth,
    drawingBufferHeight: viewer.scene.drawingBufferHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    msaaSamples: viewer.scene.msaaSamples,
    antialias: attrs?.antialias ?? null,
    preserveDrawingBuffer: attrs?.preserveDrawingBuffer ?? null,
    camera: viewshedCameraPose(viewer),
  };
}

async function viewshedPixelSummary(viewer, { includeRgba = false } = {}) {
  const frameBefore = viewer.scene.frameState.frameNumber;
  const canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
  check(canvas, 'Viewshed comparison did not produce a fresh frame.');
  try {
    const frameAfter = viewer.scene.frameState.frameNumber;
    check(
      frameAfter > frameBefore,
      'Viewshed comparison reused a stale frame.',
    );
    const context = canvas.getContext('2d', { willReadFrequently: true });
    check(context, 'Viewshed comparison pixel reader is unavailable.');
    const { width, height } = canvas;
    const rgba = context.getImageData(0, 0, width, height).data;
    const distinct = new Set();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      const red = rgba[index];
      const green = rgba[index + 1];
      const blue = rgba[index + 2];
      if (Math.abs(red - 9) + Math.abs(green - 20) + Math.abs(blue - 31) > 12)
        nonBackgroundPixels++;
      if (distinct.size < 32) distinct.add(`${red},${green},${blue}`);
    }
    check(
      nonBackgroundPixels >= 50 && distinct.size >= 2,
      'Viewshed comparison produced a black or empty frame.',
    );
    const summary = {
      width,
      height,
      frameBefore,
      frameAfter,
      rgbaSha256: await sha256(rgba),
      nonBackgroundPixels,
      distinctRgbSamples: distinct.size,
    };
    return includeRgba
      ? { summary, rgba: new Uint8ClampedArray(rgba) }
      : summary;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function waitForViewshedLayer(
  viewer,
  layer,
  observer,
  expectedCount = 14,
) {
  const startedAt = performance.now();
  let completedFrames = 0;
  while (performance.now() - startedAt < 20_000) {
    const canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      completedFrames++;
    }
    const stats = layer.getStats();
    const diagnostics = layer.getPerformanceDiagnostics();
    const primitives = [...observer.live.values()];
    const ownership = observer.counts();
    if (
      ownership.live > CCTV_VIEWSHED_RETENTION_LIMIT ||
      ownership.duplicateCameraIds !== 0
    )
      throw new Error('Viewshed cohort exceeded its production ownership cap.');
    if (
      stats.count === CCTV_VIEWSHED_RETENTION_CAMERA_COUNT &&
      stats.loading === false &&
      diagnostics.pendingJobs === 0 &&
      completedFrames >= 3 &&
      primitives.length === expectedCount &&
      primitives.every((primitive) => primitive.ready === true)
    )
      return { elapsedMs: performance.now() - startedAt, completedFrames };
    await wait(25);
  }
  throw new Error(
    'Viewshed layer did not settle within its bounded setup window.',
  );
}

async function waitForViewshedCatalog(viewer, layer) {
  const startedAt = performance.now();
  let completedFrames = 0;
  while (performance.now() - startedAt < 20_000) {
    const canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      completedFrames++;
    }
    const stats = layer.getStats();
    const diagnostics = layer.getPerformanceDiagnostics();
    if (
      stats.count === CCTV_VIEWSHED_RETENTION_CAMERA_COUNT &&
      stats.loading === false &&
      diagnostics.pendingJobs === 0 &&
      completedFrames >= 3
    )
      return;
    await wait(25);
  }
  throw new Error(
    'Viewshed source catalog did not settle within its bounded setup window.',
  );
}

function observedVolumeColor(observer, cameraId, active) {
  const primitive = observer.live.get(cameraId);
  check(primitive?.ready === true, `Viewshed volume ${cameraId} is not ready.`);
  check(
    primitive.show === true,
    'Viewshed volume is not visible in its active mode.',
  );
  check(primitive.allowPicking === false, 'Viewshed volume became pickable.');
  check(
    primitive.appearance?.translucent === true,
    'Viewshed volume is not translucent.',
  );
  const instanceId = `gev-viewshed:${cameraId}`;
  const actual = primitive.getGeometryInstanceAttributes(instanceId)?.color;
  check(actual?.length === 4, 'Viewshed volume tint is unavailable.');
  const orderedIds = Array.from(
    { length: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT },
    (_, index) => `qa-viewshed-camera-${String(index).padStart(2, '0')}`,
  ).sort();
  const colorSet = viewshedColors(cameraHue(orderedIds.indexOf(cameraId)));
  const expected = Cesium.ColorGeometryInstanceAttribute.fromColor(
    active ? colorSet.fillActive : colorSet.fill,
  ).value;
  return {
    expectedRgba: Array.from(expected),
    observedRgba: Array.from(actual),
    translucent: primitive.appearance.translucent,
    allowPicking: primitive.allowPicking,
  };
}

function snapshotSettings(viewer, layer, attrs) {
  const settings = viewshedSettings(viewer, layer, attrs);
  return JSON.parse(JSON.stringify(settings));
}

function countDifferentRgbaPixels(left, right) {
  check(
    left != null &&
      right != null &&
      Number.isSafeInteger(left.length) &&
      left.length === right.length &&
      left.length % 4 === 0,
    'CCTV pixel comparison buffers are incomplete.',
  );
  let changedPixels = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (
      left[index] !== right[index] ||
      left[index + 1] !== right[index + 1] ||
      left[index + 2] !== right[index + 2]
    )
      changedPixels++;
  }
  return changedPixels;
}

function smallViewshedFailurePng(rgba, width, height) {
  check(
    rgba != null && rgba.length === width * height * 4,
    'CCTV mismatch image source is incomplete.',
  );
  const scaledWidth = Math.max(
    1,
    Math.round((width * 320) / Math.max(width, height)),
  );
  const scaledHeight = Math.max(
    1,
    Math.round((height * 320) / Math.max(width, height)),
  );
  const source = document.createElement('canvas');
  const preview = document.createElement('canvas');
  source.width = width;
  source.height = height;
  preview.width = scaledWidth;
  preview.height = scaledHeight;
  try {
    const sourceContext = source.getContext('2d');
    const previewContext = preview.getContext('2d');
    check(
      sourceContext && previewContext,
      'CCTV mismatch image canvas is unavailable.',
    );
    const image = sourceContext.createImageData(width, height);
    image.data.set(rgba);
    sourceContext.putImageData(image, 0, 0);
    previewContext.drawImage(source, 0, 0, scaledWidth, scaledHeight);
    const dataUrl = preview.toDataURL('image/png');
    if (
      !dataUrl.startsWith('data:image/png;base64,') ||
      dataUrl.length > MAX_VIEWSHED_FAILURE_PNG_CHARS
    )
      return null;
    return dataUrl.slice('data:image/png;base64,'.length);
  } finally {
    source.width = 0;
    source.height = 0;
    preview.width = 0;
    preview.height = 0;
  }
}

function viewshedMismatchEvidence(left, right, width, height) {
  const encode = (rgba) => {
    try {
      return smallViewshedFailurePng(rgba, width, height);
    } catch {
      return null;
    }
  };
  const leftPng = encode(left);
  const rightPng = encode(right);
  return {
    width,
    height,
    previewMaxDimension: 320,
    retainedPngBase64: leftPng,
    comparisonPngBase64: rightPng,
    omitted: leftPng === null || rightPng === null,
  };
}

async function runViewshedRetentionFixture() {
  runButton.disabled = true;
  downloadButton.disabled = true;
  terminalReportText = null;
  resultNode.textContent = '';
  const fixtureDescriptor = CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR;
  const cameraIds = [...fixtureDescriptor.cameraIds];
  const sourcePayload = JSON.stringify(fixtureDescriptor);
  const report = {
    schema: 'gev-cctv-viewshed-retention/v2',
    status: 'running',
    scope: 'rendered CCTV component retention comparison',
    performanceAcceptanceEligible: false,
    applicationCommit: COMMIT,
    harnessCommit: COMMIT,
    environment: {
      renderer: null,
      maskedRenderer: null,
      rendererIdentity: 'unavailable',
      userAgent: navigator.userAgent.slice(0, 240),
    },
    fixture: {
      id: CCTV_VIEWSHED_RETENTION_FIXTURE_ID,
      sha256: null,
      descriptor: fixtureDescriptor,
      cameraCount: cameraIds.length,
      cameraIds,
    },
    settings: null,
    cohort: {
      limit: CCTV_VIEWSHED_RETENTION_LIMIT,
      peakLiveVolumes: 0,
      initialVolumeCount: 0,
      retainedModeToggleBuilds: 0,
      disableEnableCycles: 2,
      disableEnableBuilds: 0,
      disableEnableIdentitiesPreserved: false,
      disableEnableCameraId: null,
      beforeHandoffIds: [],
      afterHandoffIds: [],
      modeSequence: [],
      preReadyTintFlipObserved: false,
      duplicateCameraIdCount: 0,
    },
    hiddenPoseEdit: null,
    activeTint: null,
    preReadyTint: null,
    retained: null,
    rebuildControl: null,
    pixelFailureEvidence: null,
    cleanup: {
      layerDestroyed: false,
      retainedLayerDestroyed: false,
      viewerDestroyed: false,
      wrappersRestored: false,
      worldOverlayDestroyed: false,
      governorUninstalled: false,
      liveVolumes: 0,
      createdVolumes: 0,
      removedVolumes: 0,
      destroyedVolumes: 0,
      postRenderListenersBefore: 0,
      postRenderListenersAfter: 0,
      postRenderListenersAfterLayer: 0,
      postRenderListenersAfterOwners: 0,
    },
    phase: 'startup',
    error: null,
  };
  window.__cctvViewshedRetentionResult = report;
  let viewer = null;
  let layer = null;
  let observer = null;
  let attrs = null;
  let retainedPixelSummary = null;
  let retainedPixelRgba = null;
  let rebuildPixelRgba = null;
  let viewshedOnRgba = null;
  let wireframeRgba = null;
  let retainedPose = null;
  let retainedSettings = null;
  let failure = null;
  try {
    check(
      (await sha256(new TextEncoder().encode(FRAME_DATA_URI))) ===
        fixtureDescriptor.frameDataSha256,
      'Viewshed fixture frame differs from its pinned descriptor.',
    );
    check(
      JSON.stringify(CAMERA) === JSON.stringify(fixtureDescriptor.camera) &&
        FIXTURE_EPOCH_MS === fixtureDescriptor.epochMs &&
        cameraIds.length === CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
      'Viewshed camera or clock inputs differ from their pinned descriptor.',
    );
    report.fixture.sha256 = await sha256(
      new TextEncoder().encode(sourcePayload),
    );
    check(
      report.fixture.sha256 === CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256,
      'Viewshed fixture descriptor digest differs from its pinned identity.',
    );
    check(
      /^[a-f0-9]{40}$/.test(COMMIT || ''),
      'Fixture requires an application commit.',
    );
    viewer = createViewer();
    observer = installViewshedPrimitiveObserver(viewer);
    Object.assign(report.environment, rendererName(viewer));
    report.cleanup.postRenderListenersBefore =
      viewer.scene.postRender.numberOfListeners;
    const gl =
      viewer.scene.context?._originalGLContext || viewer.scene.context?._gl;
    attrs = gl?.getContextAttributes?.() || null;
    layer = createApplicationCctv({
      surface: FIXTURE_SURFACE,
      source: CAMERA_SOURCE,
    });
    await layer.init(viewer);
    layer.setParams({
      autoHop: false,
      showProjection: false,
      coverageMode: 'off',
    });
    layer.enable();
    check(
      layer.selectCamera(cameraIds[0]),
      'Initial synthetic CCTV camera was not selected.',
    );
    await waitForViewshedCatalog(viewer, layer);
    layer.setParams({ coverageMode: 'viewshed' });
    report.phase = 'pre-ready-tint';
    const initialLive = [...observer.live.values()];
    check(
      initialLive.length === CCTV_VIEWSHED_RETENTION_LIMIT,
      'Initial viewshed cohort is incomplete.',
    );
    check(
      initialLive.some((primitive) => primitive._gevViewshed === cameraIds[0]),
      'Initial active volume was not created.',
    );
    layer.setParams({ selectedCameraId: cameraIds[1] });
    report.cohort.preReadyTintFlipObserved =
      initialLive.every((primitive) => primitive.ready !== true) &&
      layer.getParams().selectedCameraId === cameraIds[1];
    check(
      report.cohort.preReadyTintFlipObserved,
      'Active tint did not change before primitive readiness.',
    );
    await waitForViewshedLayer(viewer, layer, observer);
    report.cohort.initialVolumeCount = observer.counts().live;
    report.cohort.peakLiveVolumes = observer.counts().peakLive;
    report.cohort.beforeHandoffIds = [...observer.live.keys()].sort();
    const tint = observedVolumeColor(observer, cameraIds[1], true);
    report.preReadyTint = {
      cameraId: cameraIds[1],
      readyAtSwitch: false,
      ...tint,
    };

    let buildsBeforeToggles = observer.counts().created;
    for (const mode of CCTV_VIEWSHED_RETENTION_MODES.slice(1)) {
      report.phase = `coverage-${mode}`;
      layer.setParams({ coverageMode: mode });
      report.cohort.modeSequence.push(mode);
      check(
        layer.getParams().coverageMode === mode,
        `CCTV layer did not apply the ${mode} coverage mode.`,
      );
      if (mode === 'off')
        check(
          [...observer.live.values()].every(
            (primitive) => primitive.show === false,
          ),
          'Off mode left a viewshed visible.',
        );
      if (mode === 'on')
        check(
          [...observer.live.values()].every(
            (primitive) => primitive.show === false,
          ),
          'Wireframe mode left a viewshed visible.',
        );
      await waitForViewshedLayer(viewer, layer, observer);
    }
    report.cohort.modeSequence.unshift('viewshed');
    report.cohort.retainedModeToggleBuilds =
      observer.counts().created - buildsBeforeToggles;

    report.phase = 'disable-enable-retention';
    const buildsBeforeLifecycleToggles = observer.counts().created;
    const primitivesBeforeLifecycleToggles = new Map(observer.live);
    for (let cycle = 0; cycle < report.cohort.disableEnableCycles; cycle++) {
      layer.disable();
      check(
        [...observer.live.values()].every(
          (primitive) => primitive.show === false,
        ),
        'Disabled CCTV layer left a viewshed visible.',
      );
      layer.enable();
      await waitForViewshedLayer(viewer, layer, observer);
    }
    report.cohort.disableEnableBuilds =
      observer.counts().created - buildsBeforeLifecycleToggles;
    report.cohort.disableEnableIdentitiesPreserved =
      observer.live.size === primitivesBeforeLifecycleToggles.size &&
      [...primitivesBeforeLifecycleToggles].every(
        ([id, primitive]) => observer.live.get(id) === primitive,
      );
    report.cohort.disableEnableCameraId = layer.getParams().selectedCameraId;
    check(
      report.cohort.disableEnableBuilds === 0 &&
        report.cohort.disableEnableIdentitiesPreserved,
      'CCTV disable/enable rebuilt retained viewshed volumes.',
    );

    report.phase = 'camera-handoff';
    layer.setParams({ selectedCameraId: cameraIds.at(-1) });
    await waitForViewshedLayer(viewer, layer, observer);
    report.cohort.afterHandoffIds = [...observer.live.keys()].sort();
    report.cohort.peakLiveVolumes = observer.counts().peakLive;
    report.cohort.duplicateCameraIdCount = observer.counts().duplicateCameraIds;
    check(
      observer.counts().live <= CCTV_VIEWSHED_RETENTION_LIMIT,
      'Viewshed cohort exceeded its production cap.',
    );
    check(
      observer.live.has(cameraIds.at(-1)),
      'Selected handoff camera volume is absent.',
    );

    report.phase = 'hidden-pose-edit';
    layer.setParams({ coverageMode: 'off' });
    check(
      [...observer.live.values()].every(
        (primitive) => primitive.show === false,
      ),
      'Hidden pose edit began with a visible volume.',
    );
    const beforeOffset = layer.getParams()?.calibration?.values?.offsetEastM;
    layer.setParams({
      calibration: {
        cameraId: cameraIds.at(-1),
        patch: { offsetEastM: beforeOffset + 18 },
      },
    });
    const afterOffset = layer.getParams()?.calibration?.values?.offsetEastM;
    check(
      Number.isFinite(beforeOffset) &&
        Number.isFinite(afterOffset) &&
        beforeOffset !== afterOffset,
      'Hidden pose edit did not apply.',
    );
    const buildsBeforeReentry = observer.counts().created;
    layer.setParams({ coverageMode: 'viewshed' });
    await waitForViewshedLayer(viewer, layer, observer);
    report.hiddenPoseEdit = {
      coverageHidden: true,
      calibrationChanged: true,
      beforeOffsetEastM: beforeOffset,
      afterOffsetEastM: afterOffset,
      reentryBuildCount: observer.counts().created - buildsBeforeReentry,
    };
    report.activeTint = {
      cameraId: cameraIds.at(-1),
      ...observedVolumeColor(observer, cameraIds.at(-1), true),
    };
    report.phase = 'rendered-visibility-check';
    const viewshedPixels = await viewshedPixelSummary(viewer, {
      includeRgba: true,
    });
    viewshedOnRgba = viewshedPixels.rgba;
    layer.setParams({ coverageMode: 'on' });
    check(
      [...observer.live.values()].every(
        (primitive) => primitive.show === false,
      ),
      'Wireframe-only mode left a viewshed volume visible.',
    );
    const wireframePixels = await viewshedPixelSummary(viewer, {
      includeRgba: true,
    });
    wireframeRgba = wireframePixels.rgba;
    const changedPixels = countDifferentRgbaPixels(
      viewshedOnRgba,
      wireframeRgba,
    );
    if (changedPixels === 0)
      report.pixelFailureEvidence = viewshedMismatchEvidence(
        viewshedOnRgba,
        wireframeRgba,
        viewshedPixels.summary.width,
        viewshedPixels.summary.height,
      );
    viewshedOnRgba.fill(0);
    wireframeRgba.fill(0);
    viewshedOnRgba = null;
    wireframeRgba = null;
    check(changedPixels > 0, 'Viewshed volume did not change rendered pixels.');
    layer.setParams({ coverageMode: 'viewshed' });
    await waitForViewshedLayer(viewer, layer, observer);
    report.viewshedVisibility = {
      changedPixels,
      viewshedOn: viewshedPixels.summary,
      viewshedOff: wireframePixels.summary,
    };
    report.settings = snapshotSettings(viewer, layer, attrs);
    retainedSettings = JSON.parse(JSON.stringify(report.settings));
    retainedPose = viewshedCameraPose(viewer);
    report.retained = {
      cameraId: cameraIds.at(-1),
      camera: retainedPose,
      settings: retainedSettings,
      liveVolumes: observer.counts().live,
      pixels: null,
    };
    const retainedCapture = await viewshedPixelSummary(viewer, {
      includeRgba: true,
    });
    report.retained.pixels = retainedCapture.summary;
    retainedPixelRgba = retainedCapture.rgba;
    retainedPixelSummary = report.retained.pixels;

    report.phase = 'full-layer-rebuild-control';
    const beforeControlBuilds = observer.counts().created;
    layer.disable();
    layer.destroy(viewer);
    report.cleanup.retainedLayerDestroyed = true;
    layer = createApplicationCctv({
      surface: FIXTURE_SURFACE,
      source: CAMERA_SOURCE,
    });
    await layer.init(viewer);
    layer.setParams({
      autoHop: false,
      showProjection: false,
      coverageMode: 'off',
    });
    layer.enable();
    check(
      layer.selectCamera(cameraIds.at(-1)),
      'Rebuild-control camera was not selected.',
    );
    await waitForViewshedCatalog(viewer, layer);
    layer.setParams({
      calibration: {
        cameraId: cameraIds.at(-1),
        patch: { offsetEastM: afterOffset },
      },
    });
    layer.setParams({ coverageMode: 'viewshed' });
    await waitForViewshedLayer(viewer, layer, observer);
    const rebuildSettings = snapshotSettings(viewer, layer, attrs);
    const rebuildPose = viewshedCameraPose(viewer);
    const rebuildCapture = await viewshedPixelSummary(viewer, {
      includeRgba: true,
    });
    rebuildPixelRgba = rebuildCapture.rgba;
    const rebuildPixels = rebuildCapture.summary;
    const changedOutputPixels = countDifferentRgbaPixels(
      retainedPixelRgba,
      rebuildPixelRgba,
    );
    if (changedOutputPixels !== 0)
      report.pixelFailureEvidence = viewshedMismatchEvidence(
        retainedPixelRgba,
        rebuildPixelRgba,
        retainedCapture.summary.width,
        retainedCapture.summary.height,
      );
    report.rebuildControl = {
      label: 'full-layer-rebuild-control',
      cameraId: cameraIds.at(-1),
      camera: rebuildPose,
      settings: rebuildSettings,
      buildCount: observer.counts().created - beforeControlBuilds,
      pixels: rebuildPixels,
      pixelComparison: {
        exactMatch: changedOutputPixels === 0,
        changedPixels: changedOutputPixels,
      },
    };
    retainedPixelRgba.fill(0);
    rebuildPixelRgba.fill(0);
    retainedPixelRgba = null;
    rebuildPixelRgba = null;
    report.phase = 'complete';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = String(error?.message || error).slice(0, 400);
  } finally {
    retainedPixelRgba?.fill(0);
    rebuildPixelRgba?.fill(0);
    viewshedOnRgba?.fill(0);
    wireframeRgba?.fill(0);
    try {
      if (layer) {
        layer.disable();
        layer.destroy(viewer);
        report.cleanup.layerDestroyed = true;
      }
    } catch (error) {
      report.cleanup.error = String(error?.message || error).slice(0, 200);
      report.status = 'failed';
      report.error ||= report.cleanup.error;
    }
    if (viewer) {
      report.cleanup.postRenderListenersAfterLayer =
        viewer.scene.postRender.numberOfListeners;
      report.cleanup.postRenderListenersAfter =
        report.cleanup.postRenderListenersAfterLayer;
    }
    if (observer) {
      const counts = observer.counts();
      report.cohort.peakLiveVolumes = counts.peakLive;
      report.cohort.duplicateCameraIdCount = counts.duplicateCameraIds;
      report.cleanup.createdVolumes = counts.created;
      report.cleanup.removedVolumes = counts.removed;
      report.cleanup.destroyedVolumes = counts.destroyed;
      report.cleanup.liveVolumes = counts.live;
      report.cleanup.wrappersRestored = observer.restore();
    }
    if (viewer) {
      try {
        destroyWorldOverlay();
        report.cleanup.worldOverlayDestroyed = true;
      } catch (error) {
        report.cleanup.error ||= String(error?.message || error).slice(0, 200);
      }
      try {
        const diagnostics = getRenderGovernorDiagnostics();
        if (diagnostics.holds.includes('cctv-adjust'))
          releaseContinuousRender('cctv-adjust');
        uninstallRenderGovernor(viewer);
        report.cleanup.governorUninstalled = true;
      } catch (error) {
        report.cleanup.error ||= String(error?.message || error).slice(0, 200);
      }
      report.cleanup.postRenderListenersAfterOwners =
        viewer.scene.postRender.numberOfListeners;
      try {
        if (!viewer.isDestroyed()) viewer.destroy();
        report.cleanup.viewerDestroyed = viewer.isDestroyed();
      } catch (error) {
        report.cleanup.error ||= String(error?.message || error).slice(0, 200);
      }
    }
    if (report.cleanup.error) {
      report.status = 'failed';
      report.error ||= report.cleanup.error;
    }
    if (failure) report.phase ||= 'unknown';
    if (!failure && report.status !== 'failed') {
      report.status = 'passed';
      try {
        validateCctvViewshedRetentionReport(report, { expectedCommit: COMMIT });
      } catch (error) {
        report.status = 'failed';
        report.error = String(error?.message || error).slice(0, 400);
      }
    }
    window.__cctvViewshedRetentionResult = report;
    resultNode.textContent = JSON.stringify(report);
    terminalReportText = resultNode.textContent;
    enableTerminalDownload(terminalReportText);
    updateStatus(
      report.status === 'passed'
        ? 'Viewshed retention completed.'
        : `Viewshed retention failed: ${report.error || 'incomplete evidence'}`,
    );
    runButton.disabled = false;
  }
}

async function waitForLayerReady(layer, viewer, timeoutMs = 20_000) {
  const start = performance.now();
  let priorSignature = null;
  let stableSince = null;
  let completedFrames = 0;
  const removeFrame = viewer.scene.postRender.addEventListener(() => {
    completedFrames = Math.min(completedFrames + 1, 10_000);
  });
  try {
    while (performance.now() - start < timeoutMs) {
      const stats = layer.getStats();
      const diagnostics = layer.getPerformanceDiagnostics();
      const signature = JSON.stringify({
        stats,
        diagnostics,
        active: layer.getParams()?.selectedCameraId,
      });
      if (
        stats.count === 1 &&
        stats.loading === false &&
        diagnostics.pendingJobs === 0 &&
        diagnostics.listeners >= 1 &&
        completedFrames >= 3
      ) {
        if (signature !== priorSignature) {
          priorSignature = signature;
          stableSince = performance.now();
        } else if (performance.now() - stableSince >= 500) {
          return { elapsedMs: performance.now() - start, completedFrames };
        }
      } else {
        priorSignature = null;
        stableSince = null;
      }
      await wait(25);
      // This is bounded preparation, before the measured idle interval. It
      // lets Entity/gizmo work materialize in request-render mode.
      viewer.scene.requestRender();
    }
    throw new Error(
      'CCTV trial layer did not settle within its bounded setup window.',
    );
  } finally {
    removeFrame();
  }
}

function projectHandle(viewer, part) {
  const entity = viewer.entities.getById(`cctv-gizmo-${part}`);
  const now = viewer.clock.currentTime;
  const position = entity?.position?.getValue?.(now);
  check(entity?.show && position, `CCTV gizmo handle ${part} is not visible.`);
  const point = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    position,
  );
  check(
    point && Number.isFinite(point.x) && Number.isFinite(point.y),
    'CCTV drag handle is outside the view.',
  );
  const rect = viewer.canvas.getBoundingClientRect();
  const from = { x: rect.left + point.x, y: rect.top + point.y };
  const axisBase =
    entity.polyline.positions?.getValue?.(now)?.[0] ||
    entity.polyline.positions?.[0];
  const axisTip = position;
  check(axisBase && axisTip, 'CCTV east-handle axis is unavailable.');
  const basePixel = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axisBase,
  );
  const tipPixel = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axisTip,
  );
  check(basePixel && tipPixel, 'CCTV east-handle axis cannot be projected.');
  const dx = tipPixel.x - basePixel.x;
  const dy = tipPixel.y - basePixel.y;
  const length = Math.hypot(dx, dy);
  check(length >= 4, 'CCTV east-handle axis is too small to drag safely.');
  const to = {
    x: from.x + (dx / length) * Math.min(18, length * 0.45),
    y: from.y + (dy / length) * Math.min(18, length * 0.45),
  };
  check(
    to.x >= rect.left &&
      to.x < rect.right &&
      to.y >= rect.top &&
      to.y < rect.bottom,
    'CCTV native drag endpoint falls outside the viewer canvas.',
  );
  return {
    from,
    to,
    handlePosition: { x: point.x, y: point.y },
    axisLengthPx: length,
  };
}

function observeNativeInput(viewer, layer, targetPoint) {
  const canvas = viewer.canvas;
  const state = {
    trustedPointerDown: false,
    trustedPointerMoveCount: 0,
    trustedPointerUp: false,
    pickIdentity: null,
    pickEvidence: null,
    canvasLayoutAtPointerDown: null,
    dragInputsDisabledObserved: false,
    dragInputsRestoredAfterRelease: false,
  };
  let poll = null;
  const timeouts = new Set();
  const ownedTimeout = (callback) => {
    const handle = setTimeout(() => {
      timeouts.delete(handle);
      sampleInputs();
      callback?.();
    }, 0);
    timeouts.add(handle);
  };
  const sampleInputs = () => {
    if (!viewer.isDestroyed()) {
      if (!viewer.scene.screenSpaceCameraController.enableInputs)
        state.dragInputsDisabledObserved = true;
      if (
        state.trustedPointerUp &&
        viewer.scene.screenSpaceCameraController.enableInputs
      )
        state.dragInputsRestoredAfterRelease = true;
    }
  };
  const onDown = (event) => {
    if (event.isTrusted && event.button === 0) {
      state.trustedPointerDown = true;
      const rect = canvas.getBoundingClientRect();
      state.canvasLayoutAtPointerDown = layoutSnapshot(viewer);
      const local = new Cesium.Cartesian2(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      let picked = null;
      try {
        picked = viewer.scene.pick(local, 14, 14);
      } catch {
        picked = null;
      }
      const pickedId =
        picked?.id?.id ??
        picked?.id ??
        picked?.primitive?.id?.id ??
        picked?.primitive?.id;
      const entityId = typeof pickedId === 'string' ? pickedId : null;
      const stringId = (value) =>
        typeof value === 'string' ? value.slice(0, 120) : null;
      state.pickEvidence = {
        returnedObject: picked !== null && picked !== undefined,
        pickedObjectType: String(picked?.constructor?.name || '').slice(0, 100),
        idType: typeof picked?.id,
        entityId: stringId(picked?.id?.id ?? picked?.id),
        primitiveType: String(picked?.primitive?.constructor?.name || '').slice(
          0,
          100,
        ),
        primitiveId: stringId(
          picked?.primitive?.id?.id ?? picked?.primitive?.id,
        ),
        client: { x: event.clientX, y: event.clientY },
        canvasRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        cssLocal: { x: local.x, y: local.y },
        drawingBuffer: {
          width: canvas.width,
          height: canvas.height,
          x: rect.width ? (local.x * canvas.width) / rect.width : null,
          y: rect.height ? (local.y * canvas.height) / rect.height : null,
        },
      };
      state.pickIdentity = {
        entityId,
        kind: entityId?.startsWith('cctv-gizmo-')
          ? entityId.slice('cctv-gizmo-'.length)
          : null,
        cameraId: layer.getParams()?.selectedCameraId ?? null,
        trusted: true,
        x: event.clientX,
        y: event.clientY,
        targetDistancePx: Math.hypot(
          event.clientX - targetPoint.x,
          event.clientY - targetPoint.y,
        ),
      };
    }
    if (poll === null) poll = setInterval(sampleInputs, 1);
    queueMicrotask(sampleInputs);
    ownedTimeout();
  };
  const onMove = (event) => {
    if (event.isTrusted && event.buttons & 1) state.trustedPointerMoveCount++;
    sampleInputs();
  };
  const onUp = (event) => {
    state.trustedPointerUp ||= event.isTrusted && event.button === 0;
    if (event.isTrusted && event.button === 0)
      state.releasedAtMs = performance.now();
    queueMicrotask(sampleInputs);
    ownedTimeout();
  };
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  return {
    state,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      if (poll !== null) clearInterval(poll);
      poll = null;
      for (const handle of timeouts) clearTimeout(handle);
      timeouts.clear();
    },
  };
}

async function waitForNativeRelease(run, viewer, layer, input) {
  // The Windows CUA path observes the visible instruction before dispatch.
  // This bounded input wait is separate from the ten-second render window.
  const deadline = performance.now() + 30_000;
  const startCalibration = run.drag.calibrationBefore;
  while (performance.now() < deadline) {
    input.state.dragInputsDisabledObserved ||=
      !viewer.scene.screenSpaceCameraController.enableInputs;
    if (
      input.state.trustedPointerUp &&
      viewer.scene.screenSpaceCameraController.enableInputs
    ) {
      input.state.dragInputsRestoredAfterRelease = true;
      const calibrationAfter = currentCalibration(layer);
      run.drag.calibrationAfter = calibrationAfter;
      run.drag.changedFields = Object.keys(startCalibration).filter(
        (field) => calibrationAfter[field] !== startCalibration[field],
      );
      run.drag.acceptedCalibrationChanged =
        run.drag.changedFields.includes('offsetEastM');
      run.drag.committedAfterRelease = run.drag.acceptedCalibrationChanged;
      run.drag.trustedPointerDown = input.state.trustedPointerDown;
      run.drag.trustedPointerMoveCount = input.state.trustedPointerMoveCount;
      run.drag.trustedPointerUp = input.state.trustedPointerUp;
      run.drag.pickIdentity = input.state.pickIdentity;
      run.drag.pickEvidence = input.state.pickEvidence;
      run.drag.canvasLayoutAtPointerDown =
        input.state.canvasLayoutAtPointerDown;
      run.drag.dragInputsDisabledObserved =
        input.state.dragInputsDisabledObserved;
      run.drag.dragInputsRestoredAfterRelease =
        input.state.dragInputsRestoredAfterRelease;
      run.drag.instructionDelivered = true;
      return;
    }
    await wait(10);
  }
  run.drag.trustedPointerDown = input.state.trustedPointerDown;
  run.drag.trustedPointerMoveCount = input.state.trustedPointerMoveCount;
  run.drag.trustedPointerUp = input.state.trustedPointerUp;
  run.drag.pickIdentity = input.state.pickIdentity;
  run.drag.pickEvidence = input.state.pickEvidence;
  run.drag.canvasLayoutAtPointerDown = input.state.canvasLayoutAtPointerDown;
  run.drag.dragInputsDisabledObserved = input.state.dragInputsDisabledObserved;
  run.drag.dragInputsRestoredAfterRelease =
    input.state.dragInputsRestoredAfterRelease;
  throw new Error('Native CCTV calibration drag did not complete or release.');
}

async function waitForEditedGeometry(viewer, layer, trial, releasedAtMs) {
  check(Number.isFinite(releasedAtMs), 'Missing native release timestamp.');
  const timeoutMs = 2000;
  const startedAt = performance.now();
  const report = {
    status: 'pending',
    releaseAtMs: releasedAtMs,
    readyFrameAtMs: null,
    timeoutMs,
    elapsedMs: 0,
    forcedFrames: 0,
  };
  trial.drag.geometrySettlement = report;
  // Observe automatic worker-completion rendering. A fresh frame can precede
  // asynchronous entity rebuilding, so capture only a completed edited scene.
  // Never drive extra frames to make the production render-demand path pass.
  while (performance.now() - releasedAtMs < timeoutMs) {
    const state = visualizerUpdates.get(viewer);
    if (
      state?.ready === true &&
      state.lastReadyFrameAtMs >= releasedAtMs &&
      layer.getPerformanceDiagnostics().pendingJobs === 0
    ) {
      report.status = 'passed';
      report.readyFrameAtMs = state.lastReadyFrameAtMs;
      report.elapsedMs = performance.now() - startedAt;
      return;
    }
    await wait(10);
  }
  report.status = 'failed';
  report.elapsedMs = performance.now() - startedAt;
  throw new Error('Edited CCTV geometry did not finish in a natural render.');
}

async function runTrial(mode, pair, runIndex, fixtureSha256, pairRecord) {
  const trial = {
    schema: 'gev-cctv-calibration-trial/v1',
    status: 'running',
    mode,
    pair,
    fixtureId: FIXTURE_ID,
    fixtureSha256,
    applicationCommit: COMMIT,
    harnessCommit: COMMIT,
    startedAt: new Date().toISOString(),
    phase: 'trial-startup',
    viewport: null,
    environment: { renderer: null },
    camera: null,
    initialCalibration: null,
    renderingSettings: null,
    layoutEvidence: null,
    captureDiagnostics: null,
    setup: null,
    idle: null,
    drag: null,
    beforePixels: null,
    afterPixels: null,
    cleanup: {
      layerDisabled: false,
      layerDestroyed: false,
      worldOverlayDestroyed: false,
      governorUninstalled: false,
      viewerDestroyed: false,
      ownedEntitiesBeforeDestroy: 0,
      ownedEntitiesAfterLayerDestroy: null,
      governorHoldsAfterLayerDestroy: null,
      error: null,
    },
  };
  pairRecord.runs.push(trial);
  activeReport.cleanup.trials++;
  activeRun = trial;
  publishPartial();
  let viewer = null;
  let layer = null;
  let holdInstalled = false;
  let idleCounter = null;
  let idleObserver = null;
  let inputObserver = null;
  let interactionObserver = null;
  let disposeVisualizerObserver = null;
  const cleanupErrors = [];
  try {
    setPhase(`pair-${pair}-setup-${mode}`);
    updateStatus(`Pair ${pair + 1}/5: ${mode} setup`);
    viewer = createViewer();
    disposeVisualizerObserver = observeVisualizerUpdates(viewer);
    const gl =
      viewer.scene.context?._originalGLContext || viewer.scene.context?._gl;
    const attrs = gl?.getContextAttributes?.() || null;
    Object.assign(trial.environment, rendererName(viewer));
    trial.environment.userAgent = navigator.userAgent.slice(0, 240);
    if (!activeReport.environment.renderer) {
      activeReport.environment.renderer = trial.environment.renderer;
      activeReport.environment.maskedRenderer =
        trial.environment.maskedRenderer;
      activeReport.environment.rendererIdentity =
        trial.environment.rendererIdentity;
      activeReport.environment.userAgent = trial.environment.userAgent;
    }
    layer = createApplicationCctv({
      surface: FIXTURE_SURFACE,
      source: CAMERA_SOURCE,
    });
    await layer.init(viewer);
    layer.setParams({
      autoHop: false,
      showProjection: false,
      coverageMode: 'off',
    });
    layer.enable();
    check(
      layer.selectCamera(CAMERA_ID),
      'The synthetic CCTV camera was not selectable.',
    );
    layer.setParams({ calibrationMode: true });
    trial.setup = await waitForLayerReady(layer, viewer);
    applySettledLayout(trial, viewer, attrs);
    if (!activeReport.viewport)
      activeReport.viewport = {
        width: trial.viewport.width,
        height: trial.viewport.height,
        devicePixelRatio: trial.viewport.devicePixelRatio,
        cssWidth: trial.viewport.cssWidth,
        cssHeight: trial.viewport.cssHeight,
        viewportWidth: trial.viewport.viewportWidth,
        viewportHeight: trial.viewport.viewportHeight,
      };
    setPhase(`pair-${pair}-camera-pose-${mode}`);
    const cameraPosition = Cesium.Cartesian3.fromDegrees(
      CAMERA.lon,
      CAMERA.lat,
      3500,
    );
    viewer.camera.setView({
      destination: cameraPosition,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    });
    await captureTrialFrame(viewer, layer, trial, 'camera-pose').then(
      (canvas) => {
        check(canvas, 'CCTV fixture camera pose did not render.');
        canvas.width = 0;
        canvas.height = 0;
      },
    );
    await wait(100);
    await attachCameraGeometryDigest(trial, viewer, layer);
    trial.initialCalibration = currentCalibration(layer);
    trial.beforePixels = await capturePixels(
      viewer,
      layer,
      trial,
      'before-pixels',
    );
    const dragPointer = projectHandle(viewer, 'move-east');
    trial.drag = {
      instructionId: `calibration-${pair}-${mode}-${runIndex}`,
      instructionDelivered: false,
      from: dragPointer.from,
      to: dragPointer.to,
      handlePosition: dragPointer.handlePosition,
      axisLengthPx: dragPointer.axisLengthPx,
      kind: 'drag',
      steps: 6,
      calibrationBefore: trial.initialCalibration,
      calibrationAfter: null,
      changedFields: [],
      acceptedCalibrationChanged: false,
      committedAfterRelease: false,
      trustedPointerDown: false,
      trustedPointerMoveCount: 0,
      trustedPointerUp: false,
      dragInputsDisabledObserved: false,
      dragInputsRestoredAfterRelease: false,
      selectedCameraIdAfterRelease: null,
      pickIdentity: null,
      pickEvidence: null,
      canvasLayoutAtPointerDown: null,
      canvasLayoutObservations: null,
      geometrySha256After: null,
    };
    if (mode === 'legacy-control') {
      holdContinuousRender(OWNER);
      holdInstalled = true;
    }
    await wait(500);
    const initialMode = viewer.scene.requestRenderMode;
    check(
      initialMode === (mode === 'candidate'),
      'CCTV governor mode does not match the trial.',
    );
    trial.renderingSettings.requestRenderModeDuringIdle = initialMode;
    idleCounter = frameCountListener(viewer);
    const sceneRequestObservation = observeSceneRenderRequests(viewer.scene);
    const renderDemandBefore = renderGovernorSnapshot();
    const idleStartEpochMs = Date.now();
    const idleStart = performance.now();
    idleObserver = observeIdleConditions(viewer);
    let renderDemandAfter;
    let sceneRequestRenderCalls;
    try {
      await wait(IDLE_MS);
    } finally {
      try {
        renderDemandAfter = renderGovernorSnapshot();
        sceneRequestRenderCalls = sceneRequestObservation?.snapshot() || null;
      } finally {
        sceneRequestObservation?.dispose();
      }
    }
    const idleDurationMs = performance.now() - idleStart;
    const idleEndEpochMs = Date.now();
    trial.idle = {
      requestedDurationMs: IDLE_MS,
      durationMs: idleDurationMs,
      completedFrames: idleCounter.read(),
      completedFrameSamples: idleCounter.samples(),
      renderMode: viewer.scene.requestRenderMode,
      forcedCaptureFramesIncluded: false,
      conditions: idleObserver.finish(),
      renderDemand: {
        startedAtEpochMs: idleStartEpochMs,
        endedAtEpochMs: idleEndEpochMs,
        governorBefore: renderDemandBefore,
        governorAfter: renderDemandAfter,
        governorRequestsDuringIdle: renderDemandAfter.recentRequests.filter(
          (request) =>
            Number.isFinite(request.at) &&
            request.at >= idleStartEpochMs &&
            request.at <= idleEndEpochMs,
        ),
        governorRecentRequestWindowMayBeTruncated:
          renderDemandAfter.recentRequests.length >=
          renderDemandAfter.recentRequestCapacity,
        sceneRequestRenderCalls,
      },
    };
    idleObserver = null;
    idleCounter.remove();
    idleCounter = null;
    check(
      trial.idle.renderMode === initialMode,
      'CCTV demand mode changed during the idle window.',
    );

    setPhase(`pair-${pair}-${mode}-native-drag`);
    updateStatus(`Pair ${pair + 1}/5: native drag (${mode})`);
    interactionObserver = observeIdleConditions(viewer);
    inputObserver = observeNativeInput(viewer, layer, trial.drag.from);
    const instruction = {
      id: trial.drag.instructionId,
      kind: 'drag',
      from: trial.drag.from,
      to: trial.drag.to,
      steps: 6,
    };
    trial.drag.canvasLayoutObservations = {
      beforeInstruction: layoutSnapshot(viewer),
      afterInstruction: null,
      afterRelease: null,
      afterCapture: null,
    };
    pointerNode.textContent = JSON.stringify(instruction);
    trial.drag.canvasLayoutObservations.afterInstruction =
      layoutSnapshot(viewer);
    if (
      !sameLayout(
        trial.drag.canvasLayoutObservations.beforeInstruction,
        trial.drag.canvasLayoutObservations.afterInstruction,
      )
    )
      throw new Error(
        'Native pointer instructions changed the settled CCTV canvas layout.',
      );
    publishPartial();
    await waitForNativeRelease(trial, viewer, layer, inputObserver);
    await waitForEditedGeometry(
      viewer,
      layer,
      trial,
      inputObserver.state.releasedAtMs,
    );
    pointerNode.textContent = '';
    inputObserver.dispose();
    inputObserver = null;
    trial.drag.canvasLayoutObservations.afterRelease = layoutSnapshot(viewer);
    check(
      trial.drag.pickIdentity?.entityId === 'cctv-gizmo-move-east',
      'Native drag did not scene-pick the expected east-move gizmo.',
    );
    trial.drag.selectedCameraIdAfterRelease =
      layer.getParams().selectedCameraId;
    const cameraAfter = cameraSnapshot(viewer, layer);
    trial.drag.geometrySha256After = await sha256(
      new TextEncoder().encode(JSON.stringify(cameraAfter.geometryPayload)),
    );
    setPhase(`pair-${pair}-${mode}-after-drag-render`);
    trial.afterPixels = await capturePixels(
      viewer,
      layer,
      trial,
      'after-pixels',
    );
    trial.drag.canvasLayoutObservations.afterCapture =
      trial.layoutEvidence.afterPixelsCapture.after;
    trial.drag.conditions = interactionObserver.finish({
      completedPhase: 'after-frame-capture',
    });
    interactionObserver = null;
    await observeIncompleteVisualizers(viewer, layer, trial);
    check(
      trial.beforePixels.sha256 !== trial.afterPixels.sha256,
      'Accepted CCTV calibration drag did not change rendered pixels.',
    );
    trial.status = 'passed';
    return trial;
  } catch (error) {
    if (
      viewer &&
      !trial.captureDiagnostics &&
      /setup|camera-pose/.test(String(trial.phase || ''))
    ) {
      const layout = layoutSnapshot(viewer);
      trial.captureDiagnostics = await collectCaptureFailureDiagnostics(
        viewer,
        layer,
        trial.phase || 'setup',
        error,
        layout,
        layout,
      );
    }
    trial.status = 'failed';
    trial.failedPhase = trial.phase || activeReport.phase;
    trial.error = String(error?.message || error).slice(0, 500);
    if (trial.drag && inputObserver) {
      Object.assign(trial.drag, inputObserver.state);
    }
    if (trial.drag && interactionObserver) {
      try {
        trial.drag.conditions = interactionObserver.finish();
      } catch {
        trial.drag.conditions = null;
      }
      interactionObserver = null;
    }
    throw error;
  } finally {
    pointerNode.textContent = '';
    idleCounter?.remove();
    idleObserver?.finish();
    inputObserver?.dispose();
    if (interactionObserver) {
      try {
        trial.drag && (trial.drag.conditions = interactionObserver.finish());
      } catch {
        if (trial.drag) trial.drag.conditions = null;
      }
      interactionObserver = null;
    }
    if (holdInstalled) {
      try {
        releaseContinuousRender(OWNER);
        holdInstalled = false;
      } catch (error) {
        cleanupErrors.push(
          `hold: ${String(error?.message || error).slice(0, 200)}`,
        );
      }
    }
    if (layer) {
      trial.cleanup.ownedEntitiesBeforeDestroy =
        viewer?.entities?.values?.filter((entity) =>
          String(entity.id).startsWith('cctv-gizmo-'),
        ).length ?? 0;
      try {
        if (layer.getStats) layer.disable();
        trial.cleanup.layerDisabled = true;
      } catch (error) {
        cleanupErrors.push(
          `disable: ${String(error?.message || error).slice(0, 200)}`,
        );
      }
      try {
        layer.destroy(viewer);
        trial.cleanup.layerDestroyed = true;
      } catch (error) {
        cleanupErrors.push(
          `layer: ${String(error?.message || error).slice(0, 200)}`,
        );
      }
      trial.cleanup.ownedEntitiesAfterLayerDestroy =
        viewer?.entities?.values?.filter((entity) =>
          String(entity.id).startsWith('cctv-gizmo-'),
        ).length ?? null;
      trial.cleanup.governorHoldsAfterLayerDestroy =
        getRenderGovernorDiagnostics().holds.length;
    }
    try {
      destroyWorldOverlay();
      trial.cleanup.worldOverlayDestroyed = true;
    } catch (error) {
      cleanupErrors.push(
        `overlay: ${String(error?.message || error).slice(0, 200)}`,
      );
    }
    if (viewer) {
      try {
        const diagnostics = getRenderGovernorDiagnostics();
        if (diagnostics.holds.includes(OWNER)) releaseContinuousRender(OWNER);
        uninstallRenderGovernor(viewer);
        trial.cleanup.governorUninstalled = true;
      } catch (error) {
        cleanupErrors.push(
          `governor: ${String(error?.message || error).slice(0, 200)}`,
        );
      }
      try {
        disposeVisualizerObserver?.();
        if (!viewer.isDestroyed()) viewer.destroy();
        trial.cleanup.viewerDestroyed = viewer.isDestroyed();
      } catch (error) {
        cleanupErrors.push(
          `viewer: ${String(error?.message || error).slice(0, 200)}`,
        );
      }
    }
    trial.cleanup.error = cleanupErrors.length
      ? cleanupErrors.join('; ')
      : null;
    if (cleanupErrors.length && trial.status === 'passed') {
      trial.status = 'failed';
      trial.failedPhase = 'cleanup';
      trial.error = trial.cleanup.error;
    }
    publishPartial();
  }
}

function enableTerminalDownload(reportText) {
  terminalReportText = reportText;
  downloadButton.disabled = false;
}

function downloadTerminalReport() {
  if (!terminalReportText) return;
  const blob = new Blob([terminalReportText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const shortCommit = String(COMMIT || 'unknown').slice(0, 12);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  anchor.href = url;
  anchor.download = `cctv-calibration-${shortCommit}-${stamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateCleanupSummary() {
  const trials = activeReport.pairs.flatMap((pair) => pair.runs || []);
  activeReport.cleanup.trials = trials.length;
  activeReport.cleanup.viewerDestroyedCount = trials.filter(
    (run) => run.cleanup?.viewerDestroyed === true,
  ).length;
  activeReport.cleanup.governorUninstalledCount = trials.filter(
    (run) => run.cleanup?.governorUninstalled === true,
  ).length;
  activeReport.cleanup.allTrialsReleased =
    trials.length === PAIRS * 2 &&
    trials.every(
      (run) =>
        run.cleanup?.viewerDestroyed === true &&
        run.cleanup?.governorUninstalled === true,
    );
}

async function runFixture() {
  runButton.disabled = true;
  downloadButton.disabled = true;
  terminalReportText = null;
  resultNode.textContent = '';
  pointerNode.textContent = '';
  activeReport = {
    schema: 'gev-cctv-calibration-render-demand/v1',
    fixture: {
      id: FIXTURE_ID,
      sha256: null,
      cameraId: CAMERA_ID,
      epochMs: FIXTURE_EPOCH_MS,
      idleRequestedMs: IDLE_MS,
    },
    applicationCommit: COMMIT,
    harnessCommit: COMMIT,
    scope:
      'isolated production CCTV layer; native calibration input and render-demand comparison',
    status: 'running',
    phase: 'startup',
    pairs: [],
    cleanup: { trials: 0, allTrialsReleased: false },
    environment: {
      renderer: null,
      userAgent: navigator.userAgent.slice(0, 240),
      desktopForegroundVerification: 'unavailable',
    },
    viewport: null,
    startedAt: new Date().toISOString(),
  };
  publishPartial();
  let failure = null;
  try {
    activeReport.fixture.sha256 = await sourceDigest();
    check(
      /^[a-f0-9]{40}$/.test(COMMIT || ''),
      'Fixture requires a declared Vite application commit.',
    );
    let runIndex = 0;
    for (let pairIndex = 0; pairIndex < PAIRS; pairIndex++) {
      const order =
        pairIndex % 2
          ? ['candidate', 'legacy-control']
          : ['legacy-control', 'candidate'];
      const pair = {
        pair: pairIndex,
        order,
        runs: [],
        comparison: null,
        visualMismatch: null,
      };
      activeReport.pairs.push(pair);
      for (const mode of order) {
        setPhase(`pair-${pairIndex}-setup-${mode}`);
        await runTrial(
          mode,
          pairIndex,
          runIndex++,
          activeReport.fixture.sha256,
          pair,
        );
        publishPartial();
      }
      setPhase(`pair-${pairIndex}-comparison`);
      try {
        pair.visualMismatch = await pairPixelFailureEvidence(pair);
        pair.comparison = compareCctvCalibrationPair(pair);
      } finally {
        releasePairRgbaEvidence(pair);
      }
      publishPartial();
    }
    activeReport.status = 'passed';
    activeReport.phase = 'complete';
    updateCleanupSummary();
    activeReport.finishedAt = new Date().toISOString();
    validateCctvCalibrationDemandReport(activeReport, {
      expectedCommit: COMMIT,
    });
  } catch (error) {
    failure = error;
    activeReport.status = 'failed';
    activeReport.failedPhase ||=
      activeRun?.failedPhase ||
      (activeReport.phase === 'complete'
        ? 'report-validation'
        : activeReport.phase);
    activeReport.error = String(error?.message || error).slice(0, 500);
  } finally {
    for (const pair of activeReport.pairs || []) releasePairRgbaEvidence(pair);
    updateCleanupSummary();
    activeReport.finishedAt ||= new Date().toISOString();
    if (failure && activeRun?.status === 'running') {
      activeRun.status = 'failed';
      activeRun.failedPhase ||= activeReport.phase;
      activeRun.error ||= activeReport.error;
    }
    publishPartial();
    terminalReportText = JSON.stringify(activeReport);
    resultNode.textContent = terminalReportText;
    enableTerminalDownload(terminalReportText);
    updateStatus(
      activeReport.status === 'passed'
        ? 'Completed and validated.'
        : `Failed: ${activeReport.error || 'incomplete evidence'}`,
    );
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => {
  if (new URLSearchParams(location.search).get('mode') === 'viewshed-retention')
    void runViewshedRetentionFixture();
  else void runFixture();
});
downloadButton.addEventListener('click', downloadTerminalReport);
