import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createImportedGeometryLayer } from '../../src/imports/runtimeLayer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { getContextStore } from '../../src/data/contextStore.js';
import { createMessageChannelWakeScheduler } from '../performance/geometryWakeScheduler.mjs';

const resultElement = document.querySelector('#result');
const params = new URLSearchParams(location.search);
const arms = new Set([
  'whole-feature-timer',
  'chunked-timer',
  'chunked-message-channel',
]);
const arm = params.get('arm');
const CHUNK_SIZE = 256;
const READY_TIMEOUT_MS = 20_000;
const PNG_MAX_CHARS = 750_000;
const FIXED_TIME = '2025-01-01T00:00:00.000Z';
const report = {
  schema: 'gev-import-geometry-wake-sample/v1',
  status: 'running',
  applicationCommit: __GEV_APP_COMMIT__,
  harnessCommit: __GEV_APP_COMMIT__,
  arm,
  chunkSize: arm?.startsWith('chunked-') ? CHUNK_SIZE : 0,
  fixture: 's59-50k-line-polygon/v1',
  phases: [],
  renderErrors: [],
};
let viewer;
let layer;
let wakeScheduler;
let removeRenderErrorListener;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function ring(count, radius) {
  const points = Array.from({ length: count - 1 }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return [-97 + Math.cos(angle) * radius, 30 + Math.sin(angle) * radius, 25];
  });
  return [...points, [...points[0]]];
}

function fixture(type) {
  const coordinates =
    type === 'LineString'
      ? ring(50_000, 0.1)
      : [ring(25_000, 0.1), ring(25_000, 0.02)];
  return {
    input: [
      {
        id: 'large-geometry',
        kind: 'geojson',
        attribution: 'Generated local S59 geometry fixture',
        records: [
          {
            id: type,
            properties: { name: `S59 50k ${type}` },
            geometry: { type, coordinates },
          },
        ],
      },
    ],
    target:
      type === 'LineString'
        ? coordinates[Math.floor(coordinates.length / 4)]
        : [
            -97 + Math.cos(Math.PI / 4) * 0.06,
            30 + Math.sin(Math.PI / 4) * 0.06,
          ],
  };
}

function createTimerScheduler() {
  const pending = new Set();
  return {
    schedule(callback) {
      const handle = { timer: null, active: true };
      pending.add(handle);
      handle.timer = setTimeout(() => {
        if (!handle.active) return;
        handle.active = false;
        pending.delete(handle);
        callback();
      }, 0);
      return handle;
    },
    cancel(handle) {
      if (!handle?.active) return;
      handle.active = false;
      pending.delete(handle);
      clearTimeout(handle.timer);
    },
    dispose() {
      for (const handle of [...pending]) this.cancel(handle);
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

function createScheduler() {
  return arm === 'chunked-message-channel'
    ? createMessageChannelWakeScheduler()
    : createTimerScheduler();
}

function renderSettings() {
  const gl = getSceneGl();
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    fixedTime: FIXED_TIME,
    clockCurrentTime: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
    clockShouldAnimate: viewer.clock.shouldAnimate,
    sceneMode: viewer.scene.mode,
    requestRenderMode: viewer.scene.requestRenderMode,
    globeShow: viewer.scene.globe.show,
    terrainProvider: viewer.terrainProvider?.constructor?.name ?? null,
    imageryLayerCount: viewer.imageryLayers.length,
    canvasWidth: viewer.scene.canvas.width,
    canvasHeight: viewer.scene.canvas.height,
    cameraPosition: [
      viewer.camera.positionWC.x,
      viewer.camera.positionWC.y,
      viewer.camera.positionWC.z,
    ],
    cameraDirection: [
      viewer.camera.directionWC.x,
      viewer.camera.directionWC.y,
      viewer.camera.directionWC.z,
    ],
    renderer: gl
      ? String(
          gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        ).slice(0, 240)
      : null,
    vendor: gl
      ? String(
          gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
        ).slice(0, 160)
      : null,
    cesiumVersion: Cesium.VERSION,
    contextLost: gl?.isContextLost?.() ?? null,
    sceneMsaaSamples: viewer.scene.msaaSamples,
    resolutionScale: viewer.resolutionScale,
    webglContextAttributes: gl?.getContextAttributes?.() ?? null,
  };
}

function getSceneGl() {
  const canvas = viewer.scene.canvas;
  return canvas.getContext('webgl2') || canvas.getContext('webgl');
}

function geometryPositions(entity, type) {
  if (type === 'LineString') return [entity.polyline.positions.getValue()];
  const hierarchy = entity.polygon.hierarchy.getValue();
  return [
    hierarchy.positions,
    ...hierarchy.holes.map((hole) => hole.positions),
  ];
}

async function geometryFingerprint(entity, type) {
  const groups = geometryPositions(entity, type);
  const digestInput = [];
  let positionCount = 0;
  for (const positions of groups) {
    positionCount += positions.length;
    digestInput.push(`${positions.length}:`);
    const values = new Float64Array(positions.length * 3);
    positions.forEach((value, index) =>
      values.set([value.x, value.y, value.z], index * 3),
    );
    digestInput.push(new Uint8Array(values.buffer));
  }
  const size = digestInput.reduce(
    (sum, value) =>
      sum + (typeof value === 'string' ? value.length : value.length),
    0,
  );
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const value of digestInput) {
    if (typeof value === 'string') {
      const encoded = new TextEncoder().encode(value);
      bytes.set(encoded, offset);
      offset += encoded.length;
    } else {
      bytes.set(value, offset);
      offset += value.length;
    }
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {
    positionCount,
    ringLengths: groups.map((positions) => positions.length),
    geometrySha256: [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  };
}

function screenPoint(target) {
  const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    Cesium.Cartesian3.fromDegrees(target[0], target[1], target[2] ?? 0),
  );
  const canvas = viewer.scene.canvas;
  return {
    screen,
    onCanvas: Boolean(
      screen &&
      Number.isFinite(screen.x) &&
      Number.isFinite(screen.y) &&
      screen.x >= 0 &&
      screen.y >= 0 &&
      screen.x < canvas.clientWidth &&
      screen.y < canvas.clientHeight,
    ),
  };
}

async function waitForNativePick(target, expectedId) {
  const startedAt = performance.now();
  const deadline = startedAt + READY_TIMEOUT_MS;
  let attempts = 0;
  let last = null;
  while (performance.now() < deadline) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await new Promise((resolve, reject) => {
      let done = false;
      const remove = viewer.scene.postRender.addEventListener(() => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        remove();
        resolve();
      });
      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        remove();
        reject(
          new Error('No completed scene frame during geometry readiness.'),
        );
      }, remaining);
      try {
        viewer.scene.requestRender();
      } catch (error) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        remove();
        reject(error);
      }
    });
    attempts++;
    const { screen, onCanvas } = screenPoint(target);
    const picked = onCanvas
      ? viewer.scene.pick(new Cesium.Cartesian2(screen.x, screen.y))
      : null;
    last = {
      target: [...target],
      screen: screen ? [screen.x, screen.y] : null,
      onCanvas,
      pickedEntityId: typeof picked?.id?.id === 'string' ? picked.id.id : null,
    };
    if (
      last.onCanvas &&
      last.pickedEntityId === expectedId &&
      performance.now() - startedAt <= READY_TIMEOUT_MS
    )
      return {
        status: 'passed',
        timeoutMs: READY_TIMEOUT_MS,
        elapsedMs: performance.now() - startedAt,
        attempts,
        ...last,
      };
  }
  throw new Error(
    `Native ${expectedId} pick not ready in ${READY_TIMEOUT_MS}ms: ${JSON.stringify(last)}`,
  );
}

async function capture(type) {
  const { input, target } = fixture(type);
  const source = input[0];
  const expectedId = `gev-import:geometry-wake:${source.id}:${source.records[0].id}`;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(FIXED_TIME));
  viewer.clock.shouldAnimate = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97, 30, 120_000),
  });

  const spans = [];
  let scheduledCount = 0;
  let initialActiveSpanMs = 0;
  const layerForSample = createImportedGeometryLayer({
    viewer,
    coordinatePreparationChunkSize: report.chunkSize,
    batchOptions: {
      now: () => performance.now(),
      schedule(callback) {
        scheduledCount++;
        const scheduledAt = performance.now();
        return wakeScheduler.schedule(() => {
          const callbackStartedAt = performance.now();
          try {
            callback();
          } finally {
            spans.push({
              scheduledToWakeMs: callbackStartedAt - scheduledAt,
              activeMs: performance.now() - callbackStartedAt,
            });
          }
        });
      },
      cancel: (handle) => wakeScheduler.cancel(handle),
    },
  });
  layer = layerForSample;
  const startedAt = performance.now();
  const pending = layer.loadAsync(input, { workspaceId: 'geometry-wake' });
  initialActiveSpanMs = performance.now() - startedAt;
  await pending;
  const completedAt = performance.now();
  const loadElapsedMs = completedAt - startedAt;
  const entity = viewer.entities.getById(expectedId);
  check(entity, `Loaded Entity ${expectedId} was not published.`);
  check(layer.getState().featureCount === 1, 'Feature count changed.');
  const geometry = await geometryFingerprint(entity, type);
  check(
    geometry.positionCount === 50_000,
    `Expected 50,000 positions, received ${geometry.positionCount}.`,
  );
  const pick = await waitForNativePick(target, expectedId);
  const copied = await captureFreshCesiumFrame(viewer);
  check(copied, 'A fresh captured frame is required.');
  const canvas = document.createElement('canvas');
  canvas.width = copied.width;
  canvas.height = copied.height;
  let capture;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(copied, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    check(
      pixels.some((value, index) => index % 4 !== 3 && value > 20),
      `${type} capture is blank.`,
    );
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const pngDataUrl = canvas.toDataURL('image/png');
    check(pngDataUrl.length <= PNG_MAX_CHARS, 'PNG witness exceeded limit.');
    capture = {
      width: canvas.width,
      height: canvas.height,
      pixelSha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      pngDataUrl,
    };
  } finally {
    copied.width = copied.height = 0;
    canvas.width = canvas.height = 0;
  }

  const activeSpans = [
    initialActiveSpanMs,
    ...spans.map((span) => span.activeMs),
  ];
  const sample = {
    type,
    entityId: entity.id,
    positionCount: geometry.positionCount,
    ringLengths: geometry.ringLengths,
    geometrySha256: geometry.geometrySha256,
    loadElapsedMs,
    initialActiveSpanMs,
    callbackCount: spans.length,
    scheduleCount: scheduledCount,
    wakeMs: spans.map((span) => span.scheduledToWakeMs),
    activeCallbackMs: spans.map((span) => span.activeMs),
    maximumActiveSpanMs: Math.max(...activeSpans),
    totalActiveSpanMs: activeSpans.reduce((sum, value) => sum + value, 0),
    activeSpansOver4ms: activeSpans.filter((value) => value > 4).length,
    readiness: pick,
    capture,
    renderSettings: renderSettings(),
  };

  layer.clear();
  await waitForCompletedFrame(viewer);
  sample.cleanup = {
    featureCount: layer.getState().featureCount,
    pendingJobs: layer.getState().pendingJobs,
    sceneEntityCount: viewer.entities.values.length,
    contextRecordCount: getContextStore().entities.size,
    schedulerPendingCount: wakeScheduler.pendingCount,
  };
  check(
    sample.cleanup.featureCount === 0 &&
      sample.cleanup.pendingJobs === 0 &&
      sample.cleanup.contextRecordCount === 0 &&
      sample.cleanup.schedulerPendingCount === 0,
    'Geometry layer cleanup retained ownership or scheduler work.',
  );
  layer.destroy();
  layer = null;
  return sample;
}

function waitForCompletedFrame(targetViewer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const remove = targetViewer.scene.postRender.addEventListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      remove();
      resolve();
    });
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      remove();
      reject(new Error('Cleanup render was not completed.'));
    }, READY_TIMEOUT_MS);
    try {
      targetViewer.scene.requestRender();
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      remove();
      reject(error);
    }
  });
}

async function cancellationControl(type) {
  const { input } = fixture(type);
  const cancellationScheduler = createScheduler();
  let logicalNow = 0;
  let budgetClockCalls = 0;
  const cancellationLayer = createImportedGeometryLayer({
    viewer,
    coordinatePreparationChunkSize: report.chunkSize,
    batchOptions: {
      now: () => {
        budgetClockCalls++;
        const value = logicalNow;
        logicalNow += 5;
        return value;
      },
      schedule: (callback) => cancellationScheduler.schedule(callback),
      cancel: (handle) => cancellationScheduler.cancel(handle),
    },
  });
  const pending = cancellationLayer.loadAsync(input, {
    workspaceId: `cancel-${type}`,
  });
  const pendingSchedulerTasksBeforeClear = cancellationScheduler.pendingCount;
  const entitiesBeforeClear = viewer.entities.values.length;
  cancellationLayer.clear();
  let outcome = 'resolved';
  try {
    await pending;
  } catch (error) {
    outcome = error.name;
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  const state = {
    outcome,
    scope: 'synthetic-budget-clock-queued-wake-cancel-before-dispatch',
    budgetClockCalls,
    entitiesBeforeClear,
    pendingSchedulerTasksBeforeClear,
    featureCountAfter: cancellationLayer.getState().featureCount,
    pendingJobsAfter: cancellationLayer.getState().pendingJobs,
    entitiesAfter: viewer.entities.values.length,
    contextRecordCountAfter: getContextStore().entities.size,
    pendingSchedulerTasksAfter: cancellationScheduler.pendingCount,
  };
  cancellationLayer.destroy();
  cancellationScheduler.dispose();
  check(state.outcome === 'AbortError', 'Cancellation did not abort.');
  check(
    state.pendingSchedulerTasksBeforeClear === 1 && state.budgetClockCalls >= 2,
    'Cancellation did not exercise an owned queued scheduler task.',
  );
  check(state.featureCountAfter === 0 && state.pendingJobsAfter === 0);
  check(state.entitiesAfter === 0 && state.contextRecordCountAfter === 0);
  check(state.pendingSchedulerTasksAfter === 0);
  return state;
}

async function run() {
  check(arms.has(arm), 'Unknown geometry-wake arm.');
  report.schedulerKind = arm.endsWith('message-channel')
    ? 'MessageChannel'
    : 'setTimeout';
  wakeScheduler = createScheduler();
  viewer = createApplicationViewer({
    container: document.querySelector('#viewer'),
    creditContainer: document.querySelector('#credits'),
    preserveDrawingBuffer: true,
  });
  viewer.targetFrameRate = 60;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(FIXED_TIME));
  viewer.clock.shouldAnimate = false;
  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  viewer.imageryLayers.removeAll(true);
  viewer.scene.globe.show = true;
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97, 30, 120_000),
  });
  const onRenderError = (_scene, error) => {
    report.renderErrors.push(String(error?.message || error).slice(0, 400));
    if (report.renderErrors.length > 8) report.renderErrors.shift();
  };
  removeRenderErrorListener =
    viewer.scene.renderError.addEventListener(onRenderError);
  report.environment = {
    userAgent: navigator.userAgent.slice(0, 240),
    canvas: {
      cssWidth: viewer.scene.canvas.clientWidth,
      cssHeight: viewer.scene.canvas.clientHeight,
      drawingBufferWidth: viewer.scene.canvas.width,
      drawingBufferHeight: viewer.scene.canvas.height,
    },
    sceneMode: viewer.scene.mode,
    renderLoop: viewer.useDefaultRenderLoop,
    requestRenderMode: viewer.scene.requestRenderMode,
    globeShow: viewer.scene.globe.show,
    terrainProvider: viewer.terrainProvider?.constructor?.name ?? null,
    imageryLayerCount: viewer.imageryLayers.length,
    clockCurrentTime: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
    clockShouldAnimate: viewer.clock.shouldAnimate,
    cameraPosition: [
      viewer.camera.positionWC.x,
      viewer.camera.positionWC.y,
      viewer.camera.positionWC.z,
    ],
    cameraDirection: [
      viewer.camera.directionWC.x,
      viewer.camera.directionWC.y,
      viewer.camera.directionWC.z,
    ],
    drawingBufferWidth: viewer.scene.canvas.width,
    drawingBufferHeight: viewer.scene.canvas.height,
    msaa: viewer.scene.context?.msaa ?? null,
    webglContextAttributes: getSceneGl()?.getContextAttributes?.() ?? null,
  };
  report.samples = [];
  for (const type of ['LineString', 'Polygon'])
    report.samples.push(await capture(type));
  report.cancellation = {
    LineString: await cancellationControl('LineString'),
    Polygon: await cancellationControl('Polygon'),
  };
  const finalSettings = renderSettings();
  Object.assign(report.environment, {
    renderer: finalSettings.renderer,
    vendor: finalSettings.vendor,
    cesiumVersion: finalSettings.cesiumVersion,
    contextLost: finalSettings.contextLost,
    sceneMsaaSamples: finalSettings.sceneMsaaSamples,
    resolutionScale: finalSettings.resolutionScale,
  });
  check(wakeScheduler.pendingCount === 0, 'Scheduler retained pending work.');
  report.status = 'passed';
}

try {
  if (!arms.has(arm)) throw new Error('Unknown geometry-wake arm.');
  await run();
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.message || error).slice(0, 1000);
  report.stack = String(error?.stack || '').slice(0, 3000);
} finally {
  try {
    removeRenderErrorListener?.();
  } catch (error) {
    report.cleanupError ||= String(error?.message || error).slice(0, 300);
  }
  try {
    layer?.destroy();
  } catch (error) {
    report.cleanupError = String(error?.message || error).slice(0, 300);
  }
  try {
    wakeScheduler?.dispose();
  } catch (error) {
    report.cleanupError ||= String(error?.message || error).slice(0, 300);
  }
  try {
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
  } catch (error) {
    report.cleanupError ||= String(error?.message || error).slice(0, 300);
  }
  if (report.cleanupError) report.status = 'failed';
  resultElement.textContent = JSON.stringify(report);
}
