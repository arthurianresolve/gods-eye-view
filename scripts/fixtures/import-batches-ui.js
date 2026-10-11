import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createImportedGeometryLayer } from '../../src/imports/runtimeLayer.js';
import {
  captureFreshCesiumFrame,
  renderFreshCesiumFrame,
} from '../../src/freshFrame.js';
import { observeSubmittedCommands } from '../performance/glCompletionProbe.mjs';
import { getContextStore } from '../../src/data/contextStore.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';
import {
  createImportFrameDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';
import { summarizeRgbaDifferences } from '../performance/importPixelWitness.mjs';
import { runControlledImportLoadProfile } from '../performance/importLoadProfileControl.mjs';
import { inspectImportedPointState } from '../performance/importPointState.mjs';
import {
  IMPORT_TRACE_ATTRIBUTION_SCHEMA,
  MAX_IMPORT_SLOW_STEPS_PER_WINDOW,
} from '../performance/importTraceAttribution.mjs';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
const frameProbe = document.querySelector('#frame-probe');
const loadProfileStart = document.querySelector('#load-profile-start');
const loadProfileFinish = document.querySelector('#load-profile-finish');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runOptions = new URLSearchParams(window.location.search);
const requestedLoadProfile = runOptions.get('load-profile');
const requestedWorkload = runOptions.get('workload');
const requestedPointRepresentation =
  runOptions.get('point-renderer') || 'entity';
const requestedMixedParity = runOptions.get('mixed-parity') === '1';
const requestedViewer =
  runOptions.get('viewer') === 'cesium' ? 'cesium' : 'application-wrapper';
if (['paired', 'synchronous', 'cooperative'].includes(requestedWorkload))
  document.querySelector('#workload').value = requestedWorkload;
if (['initial-load', 'steady-population'].includes(requestedWorkload))
  status.textContent = 'Diagnostic only: unchanged loaded population';
let frameDiagnostics = null;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const imports = [
  {
    id: 'fixture',
    kind: 'synthetic-demo',
    attribution: 'Generated local fixture',
    records: Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      properties: { name: `Fixture ${i}` },
      geometry: {
        type: 'Point',
        coordinates: [
          (i % 100) * 0.003 - 0.15,
          Math.floor(i / 100) * 0.003 - 0.075,
        ],
      },
    })),
  },
];
const LARGE_GEOMETRY_COORDINATES = 50_000;
const IMPORT_VERTEX_LIMIT = 5_000;
function coordinateRing(count, radius) {
  const points = Array.from({ length: count - 1 }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return [-97 + Math.cos(angle) * radius, 30 + Math.sin(angle) * radius, 25];
  });
  return [...points, [...points[0]]];
}
const largeGeometryImports = [
  {
    id: 'scheduler-probe',
    kind: 'synthetic-demo',
    attribution: 'Generated local scheduler fixture',
    records: [
      {
        id: 'line',
        properties: { name: 'Large line' },
        geometry: {
          type: 'LineString',
          coordinates: coordinateRing(LARGE_GEOMETRY_COORDINATES, 0.1),
        },
      },
      {
        id: 'polygon',
        properties: { name: 'Large polygon with hole' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            coordinateRing(LARGE_GEOMETRY_COORDINATES / 2, 0.1),
            coordinateRing(LARGE_GEOMETRY_COORDINATES / 2, 0.02),
          ],
        },
      },
    ],
  },
];
const mixedGeometryImports = [
  {
    id: 'mixed-parity',
    kind: 'synthetic-demo',
    attribution: 'Generated mixed-geometry parity fixture',
    records: [
      {
        id: 'point',
        properties: { name: 'Mixed point' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        id: 'line',
        properties: { name: 'Mixed line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0.03, 0.03],
            [0.08, 0.03],
          ],
        },
      },
      {
        id: 'polygon',
        properties: { name: 'Mixed polygon' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-0.08, -0.03],
              [-0.03, -0.03],
              [-0.03, 0.03],
              [-0.08, 0.03],
              [-0.08, -0.03],
            ],
          ],
        },
      },
    ],
  },
];
let report;
let activeBatchMetrics = null;
let collectIteratorStepDiagnostics = false;
let collectImportTraceAttribution = false;
let importTraceAnchors = [];
let importTraceWindows = [];
function markImportTrace(name, { retainAnchor = true } = {}) {
  const markerName = `gev-import-step:${name}`;
  const beforeMs = performance.now();
  console.timeStamp(markerName);
  const afterMs = performance.now();
  const anchor = {
    name: markerName,
    pageNowMs: (beforeMs + afterMs) / 2,
    uncertaintyMs: (afterMs - beforeMs) / 2,
    callDurationMs: afterMs - beforeMs,
  };
  if (retainAnchor) importTraceAnchors.push(anchor);
  return anchor;
}
function createIteratorStepMetrics() {
  return {
    totalSteps: 0,
    overBudgetSteps: 0,
    maxStepMs: 0,
    stages: {
      entity: { count: 0, overBudget: 0, maxMs: 0 },
      'coordinate-chunk': { count: 0, overBudget: 0, maxMs: 0 },
      'unsupported-feature': { count: 0, overBudget: 0, maxMs: 0 },
      completed: { count: 0, overBudget: 0, maxMs: 0 },
      other: { count: 0, overBudget: 0, maxMs: 0 },
    },
    ...(collectImportTraceAttribution
      ? { slowStepWindows: [], omittedSlowStepWindows: 0 }
      : {}),
  };
}
function createBatchMetrics() {
  return {
    budgetMs: 4,
    totalBatches: 0,
    yieldedBatches: 0,
    queuedWakeCount: 0,
    maxActiveBatchMs: 0,
    maxEnqueueToWakeMs: null,
    backends: {},
    samples: [],
    truncatedSamples: 0,
    ...(collectIteratorStepDiagnostics
      ? { iteratorSteps: createIteratorStepMetrics() }
      : {}),
  };
}
function recordIteratorStep(activeMs, stageName, interval) {
  const metrics = activeBatchMetrics?.iteratorSteps;
  if (!metrics) return;
  const stage = Object.hasOwn(metrics.stages, stageName) ? stageName : 'other';
  const stageMetrics = metrics.stages[stage];
  metrics.totalSteps += 1;
  metrics.maxStepMs = Math.max(metrics.maxStepMs, activeMs);
  stageMetrics.count += 1;
  stageMetrics.maxMs = Math.max(stageMetrics.maxMs, activeMs);
  if (activeMs > activeBatchMetrics.budgetMs) {
    metrics.overBudgetSteps += 1;
    stageMetrics.overBudget += 1;
    if (collectImportTraceAttribution && activeBatchMetrics.traceLabel) {
      const validInterval =
        Number.isFinite(interval?.startMs) &&
        Number.isFinite(interval?.endMs) &&
        interval.endMs >= interval.startMs;
      if (
        validInterval &&
        metrics.slowStepWindows.length < MAX_IMPORT_SLOW_STEPS_PER_WINDOW
      ) {
        const marker = markImportTrace(
          `step:${activeBatchMetrics.traceLabel}:${stage}:${metrics.overBudgetSteps}`,
        );
        metrics.slowStepWindows.push({
          stage,
          startMs: interval.startMs,
          endMs: interval.endMs,
          durationMs: activeMs,
          markerName: marker.name,
          anchorUncertaintyMs: marker.uncertaintyMs,
        });
      } else metrics.omittedSlowStepWindows += 1;
    }
  }
}
function recordBatch(batch) {
  if (!activeBatchMetrics) return;
  const metrics = activeBatchMetrics;
  metrics.totalBatches++;
  metrics.yieldedBatches += batch.yielded ? 1 : 0;
  metrics.maxActiveBatchMs = Math.max(metrics.maxActiveBatchMs, batch.activeMs);
  if (batch.schedulerBackend)
    metrics.backends[batch.schedulerBackend] =
      (metrics.backends[batch.schedulerBackend] || 0) + 1;
  if (batch.enqueueToWakeMs !== null) {
    metrics.queuedWakeCount++;
    metrics.maxEnqueueToWakeMs =
      metrics.maxEnqueueToWakeMs === null
        ? batch.enqueueToWakeMs
        : Math.max(metrics.maxEnqueueToWakeMs, batch.enqueueToWakeMs);
  }
  const sample = {
    activeMs: batch.activeMs,
    enqueueToWakeMs: batch.enqueueToWakeMs,
    schedulerBackend: batch.schedulerBackend,
    budgetMs: batch.budgetMs,
    yielded: batch.yielded,
  };
  if (metrics.samples.length < 64) metrics.samples.push(sample);
  else metrics.truncatedSamples++;
}
function metricSnapshot(metrics) {
  const snapshot = {
    budgetMs: metrics.budgetMs,
    totalBatches: metrics.totalBatches,
    yieldedBatches: metrics.yieldedBatches,
    queuedWakeCount: metrics.queuedWakeCount,
    maxActiveBatchMs: metrics.maxActiveBatchMs,
    maxEnqueueToWakeMs: metrics.maxEnqueueToWakeMs,
    backends: { ...metrics.backends },
    samples: metrics.samples.map((sample) => ({ ...sample })),
    truncatedSamples: metrics.truncatedSamples,
  };
  if (metrics.iteratorSteps) {
    snapshot.iteratorSteps = {
      totalSteps: metrics.iteratorSteps.totalSteps,
      overBudgetSteps: metrics.iteratorSteps.overBudgetSteps,
      maxStepMs: metrics.iteratorSteps.maxStepMs,
      stages: Object.fromEntries(
        Object.entries(metrics.iteratorSteps.stages).map(([stage, values]) => [
          stage,
          { ...values },
        ]),
      ),
      ...(collectImportTraceAttribution
        ? {
            slowStepWindows: metrics.iteratorSteps.slowStepWindows.map(
              (step) => ({ ...step }),
            ),
            omittedSlowStepWindows:
              metrics.iteratorSteps.omittedSlowStepWindows,
          }
        : {}),
    };
  }
  return snapshot;
}
async function geometrySnapshot(viewer, workspaceId) {
  const prefix = `gev-import:${workspaceId}:scheduler-probe:`;
  const entities = viewer.entities.values
    .filter((entity) => String(entity.id).startsWith(prefix))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const rows = [];
  for (const entity of entities) {
    let groups;
    let geometryType;
    if (entity.polyline) {
      geometryType = 'LineString';
      groups = [entity.polyline.positions.getValue(viewer.clock.currentTime)];
    } else if (entity.polygon) {
      geometryType = 'Polygon';
      const hierarchy = entity.polygon.hierarchy.getValue(
        viewer.clock.currentTime,
      );
      groups = [
        hierarchy.positions,
        ...hierarchy.holes.map((hole) => hole.positions),
      ];
    } else throw new Error(`Unexpected imported shape ${entity.id}`);
    const counts = groups.map((positions) => positions.length);
    const coordinateCount = counts.reduce((sum, count) => sum + count, 0);
    const flattened = new Float64Array(coordinateCount * 3);
    let offset = 0;
    for (const positions of groups)
      for (const position of positions) {
        flattened[offset++] = position.x;
        flattened[offset++] = position.y;
        flattened[offset++] = position.z;
      }
    const digest = await crypto.subtle.digest('SHA-256', flattened);
    rows.push({
      id: entity.id,
      geometryType,
      coordinateCount,
      ringCoordinateCounts: counts,
      geometrySha256: [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
    });
  }
  return rows;
}
async function mixedGeometrySnapshot(viewer, layer) {
  const prefix = 'gev-import:mixed-parity:mixed-parity:';
  const entities = [...getContextStore().entities.values()]
    .map((entry) => entry.entity)
    .filter((entity) => String(entity.id).startsWith(prefix))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const rows = [];
  for (const entity of entities) {
    const pointPosition = entity.position?.getValue(viewer.clock.currentTime);
    const vector = (value) => (value ? [value.x, value.y, value.z] : null);
    const color = (value) =>
      value ? [value.red, value.green, value.blue, value.alpha] : null;
    let linePositions = null;
    let polygonRings = null;
    if (entity.polyline)
      linePositions = entity.polyline.positions
        .getValue(viewer.clock.currentTime)
        .map(vector);
    if (entity.polygon) {
      const hierarchy = entity.polygon.hierarchy.getValue(
        viewer.clock.currentTime,
      );
      polygonRings = [
        hierarchy.positions,
        ...hierarchy.holes.map((hole) => hole.positions),
      ].map((ring) => ring.map(vector));
    }
    rows.push({
      id: entity.id,
      name: entity.name,
      position: vector(pointPosition),
      point: entity.point
        ? {
            pixelSize: entity.point.pixelSize.getValue(
              viewer.clock.currentTime,
            ),
            color: color(entity.point.color.getValue(viewer.clock.currentTime)),
            outlineColor: color(
              entity.point.outlineColor.getValue(viewer.clock.currentTime),
            ),
            outlineWidth: entity.point.outlineWidth.getValue(
              viewer.clock.currentTime,
            ),
          }
        : null,
      linePositions,
      polygonRings,
    });
  }
  const ids = rows.map((row) => row.id);
  check(
    JSON.stringify(ids) ===
      JSON.stringify([`${prefix}line`, `${prefix}point`, `${prefix}polygon`]),
    'Mixed fixture did not retain exact point, line, and polygon Entity identities.',
  );
  const pointSnapshot = layer.getPointRendererSnapshot();
  if (requestedPointRepresentation === 'primitive-collection')
    check(
      pointSnapshot?.pointCount === 1 &&
        pointSnapshot.primitiveRows[0]?.id === `${prefix}point`,
      'Mixed fixture point primitive ownership is incomplete.',
    );
  else
    check(
      pointSnapshot === null &&
        viewer.entities.getById(`${prefix}point`) ===
          getContextStore().entities.get(`${prefix}point`)?.entity,
      'Mixed fixture default point Entity ownership changed.',
    );
  const pickTargets = [
    { shape: 'point', coordinate: [0, 0] },
    { shape: 'line', coordinate: [0.055, 0.03] },
    { shape: 'polygon', coordinate: [-0.055, 0] },
  ];
  const nativePicks = pickTargets.map(({ shape, coordinate }) => {
    const windowPosition = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      Cesium.Cartesian3.fromDegrees(...coordinate),
    );
    check(
      windowPosition &&
        windowPosition.x >= 0 &&
        windowPosition.y >= 0 &&
        windowPosition.x < viewer.scene.canvas.clientWidth &&
        windowPosition.y < viewer.scene.canvas.clientHeight,
      `Mixed ${shape} native-pick target is outside the viewport.`,
    );
    const picked = viewer.scene.pick(
      new Cesium.Cartesian2(windowPosition.x, windowPosition.y),
    );
    return {
      shape,
      screen: [windowPosition.x, windowPosition.y],
      expectedEntityId: `${prefix}${shape}`,
      pickedEntityId: typeof picked?.id?.id === 'string' ? picked.id.id : null,
    };
  });
  check(
    nativePicks.every((row) => row.pickedEntityId === row.expectedEntityId),
    'Mixed geometry native scene.pick did not resolve each intended Entity.',
  );
  return {
    schema: 'gev-import-mixed-geometry-parity/v1',
    status: 'passed',
    scope:
      'one isolated rendered mixed-geometry parity capture; native scene.pick for point, line, and polygon; correctness only, not a performance sample',
    renderer: requestedPointRepresentation,
    entityIds: ids,
    rows,
    rowsSha256: await sha256Json(rows),
    nativePicks,
    nativePicksSha256: await sha256Json(nativePicks),
    capture: null,
  };
}
function resources(viewer, layer) {
  const collections = [];
  let pointPrimitiveCount = 0;
  const visit = (value, depth = 0) => {
    if (!value || depth > 5 || collections.length >= 64) return;
    if (value instanceof Cesium.PointPrimitiveCollection)
      pointPrimitiveCount += value.length;
    collections.push({
      type: value.constructor.name,
      count: value.length ?? null,
    });
    if (value instanceof Cesium.PrimitiveCollection)
      for (let i = 0; i < value.length; i++) visit(value.get(i), depth + 1);
  };
  visit(viewer.scene.primitives);
  return {
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
    heapScope: 'Unforced heap sample; not retained-memory acceptance',
    entities: viewer.entities.values.length,
    pointPrimitiveCount,
    importedFeatureCount: layer?.getState?.().featureCount ?? null,
    pointRepresentation:
      layer?.getPerformanceDiagnostics?.().pointRepresentation ?? null,
    collections,
  };
}
frameProbe.addEventListener('click', async () => {
  run.disabled = download.disabled = frameProbe.disabled = true;
  result.textContent = '';
  status.textContent =
    'Observing ordinary browser callbacks for five seconds, without Cesium';
  let count = 0,
    previous = performance.now(),
    maximumGapMs = 0,
    frame;
  const started = previous;
  const tick = () => {
    const current = performance.now();
    maximumGapMs = Math.max(maximumGapMs, current - previous);
    previous = current;
    count++;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  await wait(5000);
  cancelAnimationFrame(frame);
  result.textContent = JSON.stringify(
    {
      scope:
        'Browser scheduling diagnostic without a Cesium viewer; not acceptance evidence',
      frames: count,
      maximumGapMs: count ? maximumGapMs : null,
      trailingGapMs: performance.now() - previous,
      elapsedMs: performance.now() - started,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
    },
    null,
    2,
  );
  status.textContent = 'Browser scheduling diagnostic complete';
  run.disabled = frameProbe.disabled = false;
});
function settledFrame(viewer) {
  return new Promise((resolve, reject) => {
    const remove = viewer.scene.postRender.addEventListener(() => {
      clearTimeout(timer);
      remove();
      resolve();
    });
    const timer = setTimeout(() => {
      remove();
      reject(
        new Error('Fixture did not complete a render within ten seconds.'),
      );
    }, 10000);
    viewer.scene.requestRender();
  });
}

async function pixels(viewer, sample, { preserveBytes = false } = {}) {
  const started = performance.now();
  const browserStateBefore = report.diagnosticsEnabled
    ? frameDiagnostics.snapshotCanvas(viewer.canvas)
    : null;
  let frames = 0;
  let updates = 0;
  let animationFrames = 0;
  let lastHeartbeat = started;
  let maximumHeartbeatGapMs = 0;
  const heartbeat = setInterval(() => {
    const current = performance.now();
    maximumHeartbeatGapMs = Math.max(
      maximumHeartbeatGapMs,
      current - lastHeartbeat,
    );
    lastHeartbeat = current;
  }, 8);
  let raf;
  const tick = () => {
    animationFrames++;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const removeUpdate = viewer.scene.preUpdate.addEventListener(() => updates++);
  const remove = viewer.scene.postRender.addEventListener(() => frames++);
  const submittedCommands = report.observeCommands
    ? observeSubmittedCommands(viewer.canvas.getContext('webgl2'))
    : null;
  let canvas;
  try {
    canvas = await (report.captureMode === 'render-only'
      ? renderFreshCesiumFrame(viewer)
      : captureFreshCesiumFrame(viewer));
  } finally {
    clearInterval(heartbeat);
    remove();
    removeUpdate();
    cancelAnimationFrame(raf);
    if (submittedCommands)
      sample.submittedCommands = submittedCommands.finish();
  }
  maximumHeartbeatGapMs = Math.max(
    maximumHeartbeatGapMs,
    performance.now() - lastHeartbeat,
  );
  sample.capture = {
    elapsedMs: performance.now() - started,
    renderedFrames: frames,
    updates,
    animationFrames,
    maximumHeartbeatGapMs,
    defaultRenderLoop: viewer.useDefaultRenderLoop,
    targetFrameRate: viewer.targetFrameRate,
    requestRenderMode: viewer.scene.requestRenderMode,
    width: viewer.canvas.width,
    height: viewer.canvas.height,
    contextLost: viewer.canvas.getContext('webgl2')?.isContextLost() ?? null,
    visible: document.visibilityState,
    completed: Boolean(canvas),
    ...(report.diagnosticsEnabled
      ? {
          browserStateBefore,
          browserStateAfter: frameDiagnostics.snapshotCanvas(viewer.canvas),
        }
      : {}),
  };
  if (!canvas && report.diagnosticsEnabled)
    sample.rafHealthWhileViewerAlive = await observeImportFrameHealth();
  check(canvas, 'A fresh capture is required.');
  if (report.captureMode === 'render-only') return null;
  try {
    if (report.captureMode === 'copy-only') return null;
    const data = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    check(
      data.some((channel, i) => i % 4 !== 3 && channel > 30),
      'The fixture did not render visible points.',
    );
    const digest = await crypto.subtle.digest('SHA-256', data);
    const pixelSha256 = [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    return preserveBytes
      ? {
          pixelSha256,
          width: canvas.width,
          height: canvas.height,
          rgba: data,
        }
      : pixelSha256;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function encodePixelWitness(image) {
  check(
    image.width > 0 &&
      image.width <= 1024 &&
      image.height > 0 &&
      image.height <= 1024,
    'Pixel mismatch witness exceeds its bounded image dimensions.',
  );
  const witnessCanvas = document.createElement('canvas');
  witnessCanvas.width = image.width;
  witnessCanvas.height = image.height;
  try {
    const context = witnessCanvas.getContext('2d');
    const imageData = context.createImageData(image.width, image.height);
    imageData.data.set(image.rgba);
    context.putImageData(imageData, 0, 0);
    const dataUrl = witnessCanvas.toDataURL('image/png');
    check(
      dataUrl.length <= 1_500_000,
      'Pixel mismatch witness exceeded its bounded PNG size.',
    );
    return dataUrl;
  } finally {
    witnessCanvas.width = witnessCanvas.height = 0;
  }
}

async function sha256Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return sha256Bytes(bytes);
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function nativePointPickWitness(viewer, entityRows) {
  const canvas = viewer.scene.canvas;
  const ids = new Set(entityRows.map((row) => row.id));
  const indices = [...new Set([0, 1, 49, 50, 499, 500, 2499, 2500, 4999])];
  const picks = [];
  for (const index of indices) {
    const row = entityRows[index];
    if (!row) continue;
    const world = new Cesium.Cartesian3(...row.position);
    const windowPosition = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      world,
    );
    if (
      !windowPosition ||
      !Number.isFinite(windowPosition.x) ||
      !Number.isFinite(windowPosition.y) ||
      windowPosition.x < 0 ||
      windowPosition.y < 0 ||
      windowPosition.x >= canvas.clientWidth ||
      windowPosition.y >= canvas.clientHeight
    )
      continue;
    const picked = viewer.scene.pick(
      new Cesium.Cartesian2(windowPosition.x, windowPosition.y),
    );
    const pickedEntityId = picked?.id?.id;
    picks.push({
      targetId: row.id,
      screen: [windowPosition.x, windowPosition.y],
      pickedEntityId:
        typeof pickedEntityId === 'string' ? pickedEntityId : null,
    });
  }
  return {
    scope:
      'post-capture natural scene.pick samples at fixed fixture point projections; overlapping points may return another imported point, and this does not replace rendered pixel equality',
    candidates: indices.length,
    tested: picks.length,
    importedHits: picks.filter((row) => ids.has(row.pickedEntityId)).length,
    rows: picks,
  };
}

async function pointStateWitness(viewer) {
  const snapshot = inspectImportedPointState(viewer, {
    Cesium,
    workspaceId: 'fixture',
    expectedCount: 5000,
    pointRepresentation: requestedPointRepresentation,
    layer,
  });
  if (!snapshot.available) return snapshot;
  const nativePicks = nativePointPickWitness(viewer, snapshot.entityRows);
  check(
    nativePicks.tested > 0 && nativePicks.importedHits > 0,
    'Native scene.pick did not return an imported point Entity.',
  );
  return {
    available: true,
    version: snapshot.version,
    renderer: snapshot.renderer,
    scope:
      'post-capture diagnostic only; state hashing is outside import and frame-capture timings',
    expectedCount: snapshot.expectedCount,
    entityCount: snapshot.entityCount,
    visualizerItemCount: snapshot.visualizerItemCount,
    primitiveCount: snapshot.primitiveCount,
    blendOption: snapshot.blendOption,
    entityOrderAndStateSha256: await sha256Json(snapshot.entityRows),
    entityToPrimitiveAssignmentSha256: await sha256Json(
      snapshot.drawAssignmentRows,
    ),
    primitiveDrawOrderAndStateSha256: await sha256Json(snapshot.primitiveRows),
    nativePickWitness: nativePicks,
    firstEntity: snapshot.entityRows[0] ?? null,
    lastEntity: snapshot.entityRows.at(-1) ?? null,
    firstPrimitive: snapshot.primitiveRows[0] ?? null,
    lastPrimitive: snapshot.primitiveRows.at(-1) ?? null,
  };
}

async function capturePostMismatchFrames(viewer, maximumFrames = 3) {
  const budgetMs = 1200;
  const started = performance.now();
  const frames = [];
  while (
    frames.length < maximumFrames &&
    performance.now() - started < budgetMs
  ) {
    const remainingMs = budgetMs - (performance.now() - started);
    let canvas;
    try {
      canvas = await captureFreshCesiumFrame(viewer, {
        timeoutMs: Math.min(400, remainingMs),
      });
      if (!canvas) {
        frames.push({ completed: false, pixelSha256: null });
        break;
      }
      const rgba = canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      frames.push({
        completed: true,
        pixelSha256: await sha256Bytes(rgba),
      });
    } catch (error) {
      frames.push({
        completed: false,
        error: String(error?.message || error).slice(0, 240),
      });
      break;
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
    }
  }
  return {
    scope:
      'failure-only diagnostic frames; excluded from the original capture and latency samples',
    budgetMs,
    elapsedMs: performance.now() - started,
    frames,
  };
}

run.addEventListener('click', async () => {
  run.disabled = download.disabled = frameProbe.disabled = true;
  if (requestedLoadProfile) {
    loadProfileStart.hidden = true;
    loadProfileFinish.hidden = true;
    window.__gevImportLoadProfileState = 'setting-up';
  }
  result.textContent = '';
  const runStartedAtMs = performance.now();
  const workload = requestedLoadProfile
    ? 'single-cooperative-load-profile'
    : ['initial-load', 'steady-population'].includes(requestedWorkload)
      ? requestedWorkload
      : document.querySelector('#workload').value;
  const diagnosticRun =
    runOptions.get('diag') === '1' ||
    Boolean(requestedLoadProfile) ||
    ['initial-load', 'steady-population'].includes(workload) ||
    requestedViewer === 'cesium';
  collectImportTraceAttribution = runOptions.get('step-attribution') === '1';
  collectIteratorStepDiagnostics =
    runOptions.get('step-diagnostics') === '1' || collectImportTraceAttribution;
  importTraceAnchors = [];
  importTraceWindows = [];
  frameDiagnostics = diagnosticRun ? createImportFrameDiagnostics() : null;
  const preserveDrawingBuffer = document.querySelector('#preserve').checked;
  report = {
    schema: 'gev-import-batches/v2',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    documentVisibleAtStart: document.visibilityState === 'visible',
    documentFocusedAtStart: document.hasFocus(),
    desktopForegroundVerification: 'unavailable',
    foregroundUninterruptedScope:
      'document visibility only; does not verify desktop foreground or occlusion',
    fixture: 'synthetic-5000-import-points/v1',
    pointRepresentation: requestedPointRepresentation,
    mixedGeometryParityRequested: requestedMixedParity,
    featureLimit: IMPORT_VERTEX_LIMIT,
    workload,
    viewerConstruction: requestedViewer,
    diagnosticsEnabled: diagnosticRun,
    ...(diagnosticRun
      ? {
          diagnosticClassification:
            'opt-in browser scheduling diagnosis only; not performance acceptance',
        }
      : {}),
    ...(requestedLoadProfile
      ? {
          performanceAcceptanceEligible: false,
          importLoadProfileMode: requestedLoadProfile,
          importLoadProfileScope:
            'Profiler window spans browser start/stop control clicks and wait/poll time around one warmed cooperative 5,000-point load; it may include idle stacks and garbage collection. Setup/warmup, fresh-frame capture, and teardown are outside the window. Diagnostic-only, not a latency or performance acceptance sample.',
        }
      : {}),
    preserveDrawingBuffer,
    captureMode: document.querySelector('#capture-mode').value,
    pointVisualStateDiagnosticScope:
      document.querySelector('#capture-mode').value === 'pixels'
        ? 'Version-pinned post-capture Entity/PointPrimitiveCollection state hashes; diagnostic work is outside import and capture elapsedMs and is not a performance sample.'
        : 'Disabled outside pixel captures.',
    renderDemand: document.querySelector('#render-demand').checked,
    observeCommands: document.querySelector('#observe-commands').checked,
    commandObservationScope:
      'Optional flushed WebGL fence: prior submitted commands only, not GPU timing or a normal latency comparison',
    cooperativeScheduler: {
      configuration: 'production-default',
      scheduleOverride: false,
      cancelOverride: false,
      targetBudgetMs: 4,
      batchObserver: requestedLoadProfile
        ? 'disabled for the isolated profiler window to minimize diagnostic observer work'
        : 'onBatch metrics only; does not replace the scheduler',
      stepObserver: collectImportTraceAttribution
        ? 'per-iterator-next timing with bounded V8 GC trace overlap; diagnostic-only'
        : collectIteratorStepDiagnostics
          ? 'per-iterator-next timing, grouped by existing yield stage; diagnostic overhead excluded from acceptance'
          : 'disabled',
      backendCounts: {},
    },
    scope:
      'isolated import correctness and event-loop responsiveness; no full-application or GPU speedup claim',
    ...(collectIteratorStepDiagnostics
      ? {
          performanceAcceptanceEligible: false,
          stepDiagnosticScope:
            'Diagnostic-only per-next perf.now sampling and aggregation. All import/capture latency and heartbeat values from this run are excluded from performance acceptance.',
        }
      : {}),
    ...(collectImportTraceAttribution
      ? {
          performanceAcceptanceEligible: false,
          importTraceAttribution: {
            schema: IMPORT_TRACE_ATTRIBUTION_SCHEMA,
            performanceAcceptanceEligible: false,
            traceAnchors: importTraceAnchors,
            loadingWindows: importTraceWindows,
            preparation: null,
          },
        }
      : {}),
    checks: [],
    samples: [],
    renderErrors: [],
    status: 'running',
  };
  if (collectImportTraceAttribution) {
    // Warm the first-use tracing/timestamp path outside every measured load.
    // Its cost and uncertainty are recorded separately and never substituted
    // for a measured anchor or used to bypass the per-anchor 2ms gate.
    report.importTraceAttribution.preparation = markImportTrace('preparation', {
      retainAnchor: false,
    });
  }
  let viewer, layer;
  let backgrounded = document.visibilityState !== 'visible';
  const visibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  try {
    check(
      requestedLoadProfile === null ||
        requestedLoadProfile === 'cpu' ||
        requestedLoadProfile === 'heap',
      'Unknown loading profile mode.',
    );
    check(
      ['entity', 'primitive-collection'].includes(requestedPointRepresentation),
      'Unknown imported point renderer.',
    );
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'Exact source revision required.',
    );
    const viewerOptions = {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      creditContainer: document.querySelector('#credits'),
      msaaSamples: 4,
      contextOptions: { webgl: { preserveDrawingBuffer } },
    };
    if (requestedViewer === 'cesium') {
      report.scope =
        'diagnostic-only direct Cesium.Viewer comparison with application options; omits application atmosphere workaround and resolution guard; no performance acceptance';
      report.diagnosticClassification =
        'opt-in viewer-construction isolation only; not performance acceptance';
      viewer = new Cesium.Viewer(
        document.querySelector('#viewer'),
        viewerOptions,
      );
      viewer.targetFrameRate = 60;
    } else {
      viewer = createApplicationViewer({
        container: document.querySelector('#viewer'),
        creditContainer: document.querySelector('#credits'),
        preserveDrawingBuffer,
      });
    }
    viewer.scene.renderError.addEventListener((_scene, error) => {
      report.renderErrors.push(String(error?.message || error).slice(0, 400));
      if (report.renderErrors.length > 4) report.renderErrors.shift();
    });
    if (report.renderDemand) installRenderGovernor(viewer);
    for (const item of ['skyBox', 'skyAtmosphere', 'sun', 'moon', 'globe'])
      viewer.scene[item].show = false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 85000),
    });
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: report.applicationCommit,
      harnessCommit: report.harnessCommit,
    });
    report.renderConfiguration = {
      viewerConstruction: requestedViewer,
      pointRepresentation: requestedPointRepresentation,
      preserveDrawingBuffer,
      captureMode: report.captureMode,
      renderDemand: report.renderDemand,
      msaaSamplesRequested: 4,
      antialias: viewer.scene.context?.antialias ?? null,
      msaaSupported: viewer.scene.context?.msaa ?? null,
      webglContextAttributes:
        viewer.scene.context?._gl?.getContextAttributes?.() ?? null,
      requestRenderMode: viewer.scene.requestRenderMode === true,
      sceneMode: viewer.scene.mode,
      canvas: {
        cssWidth: viewer.scene.canvas.clientWidth,
        cssHeight: viewer.scene.canvas.clientHeight,
        drawingBufferWidth: viewer.scene.canvas.width,
        drawingBufferHeight: viewer.scene.canvas.height,
      },
      camera: {
        position: [
          viewer.camera.positionWC.x,
          viewer.camera.positionWC.y,
          viewer.camera.positionWC.z,
        ],
        direction: [
          viewer.camera.directionWC.x,
          viewer.camera.directionWC.y,
          viewer.camera.directionWC.z,
        ],
        up: [viewer.camera.upWC.x, viewer.camera.upWC.y, viewer.camera.upWC.z],
        frustumNear: viewer.camera.frustum.near,
        frustumFar: viewer.camera.frustum.far,
        frustumFov: viewer.camera.frustum.fov ?? null,
      },
    };
    layer = createImportedGeometryLayer({
      viewer,
      pointRepresentation: requestedPointRepresentation,
      batchOptions: {
        ...(requestedLoadProfile ? {} : { onBatch: recordBatch }),
        ...(collectIteratorStepDiagnostics
          ? { onStep: recordIteratorStep }
          : {}),
      },
    });
    status.textContent = diagnosticRun
      ? 'Diagnostic only: warming the complete 5,000-point population'
      : 'Warming the complete point population';
    const coldAt = performance.now();
    const warmupMetrics = requestedLoadProfile ? null : createBatchMetrics();
    activeBatchMetrics = warmupMetrics;
    await layer.loadAsync(imports, { workspaceId: 'fixture' });
    report.warmupBatches = warmupMetrics
      ? metricSnapshot(warmupMetrics)
      : {
          available: false,
          reason: 'batch observer disabled for profiler run',
        };
    for (const [backend, count] of Object.entries(
      report.warmupBatches.backends || {},
    ))
      report.cooperativeScheduler.backendCounts[backend] =
        (report.cooperativeScheduler.backendCounts[backend] || 0) + count;
    activeBatchMetrics = null;
    await settledFrame(viewer);
    report.coldActivationMs = performance.now() - coldAt;
    report.warmedResources = resources(viewer, layer);

    if (requestedLoadProfile) {
      const setupReadyAtMs = performance.now();
      layer.clear();
      await wait(150);
      await settledFrame(viewer);
      check(
        layer.getState().featureCount === 0 &&
          layer.getState().pendingJobs === 0 &&
          getContextStore().entities.size === 0,
        'Profiled load must start from an empty fixture layer.',
      );
      status.textContent = `Setup complete; start the ${requestedLoadProfile} profiler before the single cooperative load.`;
      const readyForProfileAtMs = performance.now();
      const controlledLoad = await runControlledImportLoadProfile({
        startButton: loadProfileStart,
        finishButton: loadProfileFinish,
        publishState: (state) => {
          window.__gevImportLoadProfileState = state;
        },
        load: async () => {
          await layer.loadAsync(imports, { workspaceId: 'fixture' });
        },
      });
      const loadStartMs = controlledLoad.loadStartMs;
      const loadEndMs = controlledLoad.loadEndMs;
      check(
        layer.getState().featureCount === 5000 &&
          layer.getState().pendingJobs === 0 &&
          getContextStore().entities.size === 5000,
        'Profiled cooperative load did not complete the full point population.',
      );
      report.importLoadProfile = {
        mode: requestedLoadProfile,
        phases: {
          setupStartedAtMs: runStartedAtMs,
          setupReadyAtMs,
          profilerGateReadyAtMs: readyForProfileAtMs,
          loadingStartedAtMs: loadStartMs,
          loadingEndedAtMs: loadEndMs,
          loadingDurationMs: loadEndMs - loadStartMs,
          profileStopRequestedBeforeCapture: true,
        },
        workload: {
          mode: 'cooperative',
          features: 5000,
          featureCountAfter: layer.getState().featureCount,
          pendingJobsAfter: layer.getState().pendingJobs,
          batchObserver: 'disabled during profiling',
        },
        scope: report.importLoadProfileScope,
        performanceAcceptanceEligible: false,
      };
      status.textContent =
        'Profiler stopped; capturing a fresh frame before teardown.';

      const sample = {
        pair: null,
        mode: 'single-cooperative-load-profile',
        features: 5000,
        resources: resources(viewer, layer),
      };
      const captureStartMs = performance.now();
      const pixelSha256 = await pixels(viewer, sample);
      const captureEndMs = performance.now();
      sample.pixelSha256 = pixelSha256;
      report.importLoadProfile.phases.captureStartedAtMs = captureStartMs;
      report.importLoadProfile.phases.captureEndedAtMs = captureEndMs;
      report.importLoadProfile.phases.captureDurationMs =
        captureEndMs - captureStartMs;
      report.samples.push(sample);
      check(
        typeof pixelSha256 === 'string' && pixelSha256.length === 64,
        'Profiled import did not produce a fresh-frame pixel digest after profiling stopped.',
      );
      report.checks.push({
        id: 'single-profiled-load-separated-from-capture-and-teardown',
        status: 'passed',
      });
      report.status = 'passed';
      window.__gevImportLoadProfileState = 'complete';
      return;
    }

    let expectedPixels = null;
    let expectedPixelCapture = null;
    if (workload === 'initial-load') {
      const sample = {
        pair: null,
        mode: 'initial-loaded-population',
        elapsedMs: report.coldActivationMs,
        preCaptureDrainMs: 20,
        maxHeartbeatGapMs: null,
        features: 5000,
        resources: resources(viewer, layer),
      };
      report.samples.push(sample);
      await wait(20);
      sample.pixelSha256 = await pixels(viewer, sample);
      check(
        sample.capture?.completed &&
          (report.captureMode !== 'pixels' || Boolean(sample.pixelSha256)),
        'Initial loaded-population diagnostic did not capture the 5,000-point scene.',
      );
      report.checks.push({
        id: 'initial-5000-point-population-diagnostic',
        status: 'passed',
      });
    } else if (workload === 'steady-population') {
      report.diagnosticClassification =
        'opt-in steady-population scheduling diagnosis only; not performance acceptance';
      report.steadyPopulation = {
        features: 5000,
        captures: 10,
        interCaptureWaitMs: 150,
        preCaptureDrainMs: 20,
        sceneMutatedBetweenCaptures: false,
      };
      for (let captureIndex = 0; captureIndex < 10; captureIndex++) {
        status.textContent = `Steady-population capture ${captureIndex + 1}/10`;
        if (captureIndex > 0) await wait(150);
        check(
          layer.getState().featureCount === 5000 &&
            getContextStore().entities.size === 5000,
          'The steady diagnostic population changed between captures.',
        );
        await wait(20);
        const sample = {
          pair: null,
          mode: 'steady-loaded-population',
          captureIndex,
          interCaptureWaitMs: captureIndex > 0 ? 150 : null,
          preCaptureDrainMs: 20,
          features: 5000,
          resources: resources(viewer, layer),
        };
        report.samples.push(sample);
        sample.pixelSha256 = await pixels(viewer, sample);
        if (expectedPixels === null) expectedPixels = sample.pixelSha256;
        check(
          sample.pixelSha256 === expectedPixels,
          'Steady-population pixels changed between captures.',
        );
      }
      report.checks.push({
        id: 'ten-captures-over-unchanged-5000-point-population-diagnostic',
        status: 'passed',
      });
    } else {
      for (let pair = 0; pair < 5; pair++) {
        const modes =
          workload === 'paired'
            ? pair % 2
              ? ['cooperative', 'synchronous']
              : ['synchronous', 'cooperative']
            : [workload, workload];
        for (const mode of modes) {
          status.textContent = `Pair ${pair + 1}/5: ${mode} import`;
          layer.clear();
          await wait(150);
          let previous = performance.now();
          const gaps = [];
          const timer = setInterval(() => {
            const time = performance.now();
            gaps.push(time - previous);
            previous = time;
          }, 5);
          const traceAnchor =
            collectImportTraceAttribution && mode === 'cooperative'
              ? markImportTrace(`sample:${pair}:${mode}`)
              : null;
          const loadStartMs = performance.now();
          const started = performance.now();
          let elapsedMs;
          let loadEndMs = null;
          const batchMetrics =
            mode === 'cooperative' ? createBatchMetrics() : null;
          if (batchMetrics && traceAnchor)
            batchMetrics.traceLabel = `sample:${pair}:${mode}`;
          activeBatchMetrics = batchMetrics;
          try {
            await (mode === 'synchronous'
              ? layer.load(imports, { workspaceId: 'fixture' })
              : layer.loadAsync(imports, { workspaceId: 'fixture' }));
            elapsedMs = performance.now() - started;
            loadEndMs = performance.now();
            await wait(20);
          } finally {
            if (traceAnchor && batchMetrics?.iteratorSteps) {
              const steps = batchMetrics.iteratorSteps;
              importTraceWindows.push({
                pair,
                mode,
                markerName: traceAnchor.name,
                startMs: loadStartMs,
                endMs: loadEndMs ?? performance.now(),
                overBudgetSteps: steps.overBudgetSteps,
                slowSteps: steps.slowStepWindows.map((step) => ({ ...step })),
                omittedSlowSteps: steps.omittedSlowStepWindows,
              });
            }
            clearInterval(timer);
            activeBatchMetrics = null;
          }
          check(
            layer.getState().featureCount === 5000 &&
              getContextStore().entities.size === 5000,
            'Incomplete import or stale evidence context.',
          );
          check(layer.getState().pendingJobs === 0, 'Import task retained.');
          const sample = {
            pair,
            mode,
            elapsedMs,
            maxHeartbeatGapMs: Math.max(...gaps),
            features: 5000,
            resources: resources(viewer, layer),
            batchMetrics: batchMetrics ? metricSnapshot(batchMetrics) : null,
          };
          if (batchMetrics)
            for (const [backend, count] of Object.entries(
              batchMetrics.backends,
            ))
              report.cooperativeScheduler.backendCounts[backend] =
                (report.cooperativeScheduler.backendCounts[backend] || 0) +
                count;
          report.samples.push(sample);
          // The capture operation owns its completed-frame wait. Request it from
          // the import task, rather than immediately chaining two postRender waits.
          const capture = await pixels(viewer, sample, {
            preserveBytes: report.captureMode === 'pixels',
          });
          const hash =
            capture && typeof capture === 'object'
              ? capture.pixelSha256
              : capture;
          sample.pixelSha256 = hash;
          if (requestedMixedParity && capture?.rgba)
            sample.pixelPngDataUrl = encodePixelWitness(capture);
          if (expectedPixels === null) expectedPixels = hash;
          let currentPointState = null;
          if (report.captureMode === 'pixels') {
            try {
              currentPointState = await pointStateWitness(viewer);
            } catch (error) {
              currentPointState = {
                available: false,
                reason: 'snapshot-error',
                error: String(error?.message || error).slice(0, 240),
              };
            }
          }
          if (currentPointState) sample.pointVisualState = currentPointState;
          if (
            report.captureMode === 'pixels' &&
            expectedPixelCapture &&
            capture &&
            hash !== expectedPixels
          ) {
            try {
              const witness = {
                width: capture.width,
                height: capture.height,
                before: {
                  mode: expectedPixelCapture.mode,
                  pixelSha256: expectedPixelCapture.image.pixelSha256,
                },
                after: {
                  mode,
                  pixelSha256: capture.pixelSha256,
                },
              };
              sample.pixelMismatchWitness = witness;
              try {
                witness.before.pngDataUrl = encodePixelWitness(
                  expectedPixelCapture.image,
                );
              } catch (error) {
                witness.before.pngError = String(error?.message || error).slice(
                  0,
                  240,
                );
              }
              try {
                witness.after.pngDataUrl = encodePixelWitness(capture);
              } catch (error) {
                witness.after.pngError = String(error?.message || error).slice(
                  0,
                  240,
                );
              }
              try {
                witness.difference = summarizeRgbaDifferences(
                  expectedPixelCapture.image.rgba,
                  capture.rgba,
                  capture.width,
                  capture.height,
                );
              } catch (error) {
                witness.differenceError = String(error?.message || error).slice(
                  0,
                  240,
                );
              }
              witness.pointVisualState = {
                before: expectedPixelCapture.pointState,
                after: currentPointState,
              };
              try {
                witness.followupFrames =
                  await capturePostMismatchFrames(viewer);
              } catch (error) {
                witness.followupFramesError = String(
                  error?.message || error,
                ).slice(0, 240);
              }
            } catch (witnessError) {
              sample.pixelMismatchWitnessError = String(
                witnessError?.message || witnessError,
              ).slice(0, 300);
            }
          }
          check(
            hash === expectedPixels,
            'Final pixels differ across equivalent imports.',
          );
          if (hash === expectedPixels)
            expectedPixelCapture =
              capture && typeof capture === 'object'
                ? {
                    mode,
                    image: capture,
                    pointState: currentPointState,
                  }
                : null;
        }
      }
      report.checks.push({
        id:
          report.captureMode === 'pixels'
            ? 'same-population-evidence-and-pixels'
            : 'diagnostic-population-and-fresh-frames-without-pixel-equivalence',
        status: 'passed',
      });
    }
    if (!['initial-load', 'steady-population'].includes(workload))
      activeBatchMetrics = null;
    status.textContent = 'Comparing complete single-feature geometry outputs';
    layer.clear();
    const geometryWorkspaceId = 'scheduler-geometry';
    const synchronousGeometryResult = layer.load(largeGeometryImports, {
      workspaceId: geometryWorkspaceId,
    });
    const synchronousGeometry = await geometrySnapshot(
      viewer,
      geometryWorkspaceId,
    );
    layer.clear();
    const geometryBatchMetrics = createBatchMetrics();
    if (collectImportTraceAttribution)
      geometryBatchMetrics.traceLabel = 'geometry:cooperative';
    activeBatchMetrics = geometryBatchMetrics;
    const geometryTraceAnchor = collectImportTraceAttribution
      ? markImportTrace('geometry:cooperative')
      : null;
    const geometryLoadStartMs = performance.now();
    const asynchronousGeometryResult = await layer.loadAsync(
      largeGeometryImports,
      { workspaceId: geometryWorkspaceId },
    );
    const geometryLoadEndMs = performance.now();
    if (geometryTraceAnchor && geometryBatchMetrics.iteratorSteps) {
      const steps = geometryBatchMetrics.iteratorSteps;
      importTraceWindows.push({
        pair: 5,
        mode: 'geometry-cooperative',
        markerName: geometryTraceAnchor.name,
        startMs: geometryLoadStartMs,
        endMs: geometryLoadEndMs,
        overBudgetSteps: steps.overBudgetSteps,
        slowSteps: steps.slowStepWindows.map((step) => ({ ...step })),
        omittedSlowSteps: steps.omittedSlowStepWindows,
      });
    }
    activeBatchMetrics = null;
    const asynchronousGeometry = await geometrySnapshot(
      viewer,
      geometryWorkspaceId,
    );
    const geometryEquivalent =
      JSON.stringify(synchronousGeometry) ===
      JSON.stringify(asynchronousGeometry);
    report.largeGeometry = {
      featureLimit: IMPORT_VERTEX_LIMIT,
      featureCount: 2,
      sourceCoordinateCounts: {
        LineString: LARGE_GEOMETRY_COORDINATES,
        Polygon: LARGE_GEOMETRY_COORDINATES,
      },
      synchronous: {
        drawn: synchronousGeometryResult.drawn,
        omitted: synchronousGeometryResult.omitted,
        rows: synchronousGeometry,
      },
      cooperative: {
        drawn: asynchronousGeometryResult.drawn,
        omitted: asynchronousGeometryResult.omitted,
        rows: asynchronousGeometry,
        batchMetrics: metricSnapshot(geometryBatchMetrics),
      },
      exactOutputParity: geometryEquivalent,
    };
    for (const [backend, count] of Object.entries(
      geometryBatchMetrics.backends,
    ))
      report.cooperativeScheduler.backendCounts[backend] =
        (report.cooperativeScheduler.backendCounts[backend] || 0) + count;
    check(
      synchronousGeometryResult.drawn === 2 &&
        synchronousGeometryResult.omitted === 0 &&
        asynchronousGeometryResult.drawn === 2 &&
        asynchronousGeometryResult.omitted === 0 &&
        synchronousGeometry.length === 2 &&
        asynchronousGeometry.length === 2 &&
        synchronousGeometry.find((row) => row.geometryType === 'LineString')
          ?.coordinateCount === LARGE_GEOMETRY_COORDINATES &&
        synchronousGeometry.find((row) => row.geometryType === 'Polygon')
          ?.coordinateCount === LARGE_GEOMETRY_COORDINATES &&
        geometryEquivalent,
      'Cooperative geometry changed complete line/polygon output or identity.',
    );
    if (requestedMixedParity) {
      check(
        report.captureMode === 'pixels',
        'Mixed geometry parity requires pixel capture mode.',
      );
      layer.clear();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(0, 0, 85000),
      });
      const mixedLoad = layer.load(mixedGeometryImports, {
        workspaceId: 'mixed-parity',
      });
      check(
        mixedLoad.drawn === 3 && mixedLoad.omitted === 0,
        'Mixed geometry fixture did not load all three source shapes.',
      );
      await settledFrame(viewer);
      const mixed = await mixedGeometrySnapshot(viewer, layer);
      const capture = await pixels(
        viewer,
        { mode: 'mixed-parity' },
        { preserveBytes: true },
      );
      check(
        capture && typeof capture === 'object' && capture.rgba,
        'Mixed parity pixel capture is missing.',
      );
      mixed.capture = {
        pixelSha256: capture.pixelSha256,
        width: capture.width,
        height: capture.height,
        pngDataUrl: encodePixelWitness(capture),
      };
      report.mixedGeometryParity = mixed;
      report.checks.push({
        id: 'mixed-point-line-polygon-pixels-and-native-picks',
        status: 'passed',
      });
      layer.clear();
      check(
        layer.getState().featureCount === 0 &&
          layer.getPerformanceDiagnostics().pointPrimitiveCount === 0 &&
          getContextStore().entities.size === 0,
        'Mixed geometry parity capture retained owned render resources.',
      );
    }
    check(
      geometryBatchMetrics.yieldedBatches > 0 &&
        geometryBatchMetrics.queuedWakeCount > 0 &&
        Object.keys(geometryBatchMetrics.backends).some((backend) =>
          ['scheduler.postTask', 'MessageChannel'].includes(backend),
        ),
      'Large geometry did not exercise a production macrotask scheduler wake.',
    );
    report.cooperativeScheduler.observedBackendCount = Object.keys(
      report.cooperativeScheduler.backendCounts,
    ).length;
    report.checks.push({
      id: 'full-linestring-and-polygon-output-and-production-scheduler',
      status: 'passed',
    });
    if (!['initial-load', 'steady-population'].includes(workload))
      status.textContent = 'Checking cancellation and repeated teardown';
    let cancellationAbortErrors = 0;
    for (
      let i = 0;
      !['initial-load', 'steady-population'].includes(workload) && i < 12;
      i++
    ) {
      const pending = layer.loadAsync(imports, { workspaceId: 'cancelled' });
      const observed = pending.then(
        () => 'completed',
        (error) => error.name,
      );
      layer.clear();
      check(
        (await observed) === 'AbortError',
        'Cancelled work did not reject.',
      );
      cancellationAbortErrors++;
      check(
        layer.getState().featureCount === 0 &&
          layer.getState().pendingJobs === 0 &&
          getContextStore().entities.size === 0,
        'Cancelled import retained ownership.',
      );
      await wait(10);
    }
    if (!['initial-load', 'steady-population'].includes(workload))
      report.checks.push({
        id: 'twelve-cancelled-imports-release-ownership',
        status: 'passed',
      });
    report.cancellation = {
      attempted: ['initial-load', 'steady-population'].includes(workload)
        ? 0
        : 12,
      abortErrors: cancellationAbortErrors,
      pendingJobsAfter: layer.getPerformanceDiagnostics().pendingJobs,
      featureCountAfter: layer.getState().featureCount,
      pointPrimitiveCountAfter:
        layer.getPerformanceDiagnostics().pointPrimitiveCount,
      ownershipReleased: layer.getState().featureCount === 0,
    };
    check(
      !backgrounded,
      'Document visibility changed; rerun for valid measurements.',
    );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    if (report.importLoadProfile?.phases)
      report.importLoadProfile.phases.teardownStartedAtMs = performance.now();
    layer?.destroy();
    if (viewer) uninstallRenderGovernor(viewer);
    viewer?.destroy();
    if (report.importLoadProfile?.phases)
      report.importLoadProfile.phases.teardownEndedAtMs = performance.now();
    document.removeEventListener('visibilitychange', visibility);
    report.documentVisibleThroughout = !backgrounded;
    report.documentFocusedAtEnd = document.hasFocus();
    report.foregroundUninterrupted = !backgrounded;
    if (frameDiagnostics) {
      report.browserLifecycleEvents = frameDiagnostics.events();
      frameDiagnostics.dispose();
      frameDiagnostics = null;
    }
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    run.disabled = download.disabled = frameProbe.disabled = false;
  }
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `import-batches-${report.applicationCommit.slice(0, 7)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
