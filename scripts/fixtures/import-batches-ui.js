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
import {
  inspectDefaultEntityPointPrimitiveCount,
  inspectImportedPointState,
} from '../performance/importPointState.mjs';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';
import {
  createImportFrameDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
const frameProbe = document.querySelector('#frame-probe');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runOptions = new URLSearchParams(window.location.search);
const requestedWorkload = runOptions.get('workload');
const requestedPointRepresentation =
  runOptions.get('point-renderer') || 'entity';
const requestedPointComparison = runOptions.has('point-renderer');
const requestedMixedParity = runOptions.get('mixed-parity') === '1';
const requestedPointBenefitDiagnostics =
  runOptions.get('point-benefit') === '1';
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
function sha256Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return crypto.subtle
    .digest('SHA-256', bytes)
    .then((digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    );
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
const unavailableBatchAttribution = Object.freeze({
  available: false,
  reason:
    'The production cooperative loader exposes no batch-completion observer; no batch duration or wake values are inferred.',
});
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
const mixedGeometryImports = [
  {
    id: 'mixed-parity',
    kind: 'synthetic-demo',
    attribution: 'Generated local fixture',
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
            [0.045, 0.03],
            [0.055, 0.03],
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
              [-0.06, -0.01],
              [-0.05, -0.01],
              [-0.05, 0.01],
              [-0.06, 0.01],
              [-0.06, -0.01],
            ],
          ],
        },
      },
    ],
  },
];
const MIXED_GEOMETRY_READY_TIMEOUT_MS = 10_000;
let report;
function resources(viewer, layer) {
  const collections = [];
  let pointPrimitiveCount = 0;
  let entityPointCensus = null;
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
  const pointRepresentation =
    layer?.getPerformanceDiagnostics?.().pointRepresentation ?? null;
  if (pointRepresentation === 'entity') {
    entityPointCensus = inspectDefaultEntityPointPrimitiveCount(viewer, {
      Cesium,
      workspaceId: 'fixture',
      expectedCount: layer.getState().featureCount,
    });
    pointPrimitiveCount = entityPointCensus.available
      ? entityPointCensus.pointCount
      : null;
    if (entityPointCensus.available)
      collections.push({
        type: 'EntityClusterPointPrimitiveCollection',
        count: entityPointCensus.pointCount,
        ownership: 'Cesium-1.138.0-PointVisualizer-EntityCluster-adapter',
      });
  }
  return {
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
    heapScope: 'Unforced heap sample; not retained-memory acceptance',
    importedFeatureCount: layer?.getState?.().featureCount ?? null,
    entities: viewer.entities.values.length,
    pointPrimitiveCount,
    entityPointCensus,
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
function settledFrame(viewer, timeoutMs = 10_000) {
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
    }, timeoutMs);
    viewer.scene.requestRender();
  });
}
function nativePointPickWitness(viewer, entityRows) {
  const canvas = viewer.scene.canvas;
  const ids = new Set(entityRows.map((row) => row.id));
  const indices = [0, 1, 49, 50, 499, 500, 2499, 2500, 4999];
  const rows = [];
  for (const index of indices) {
    const row = entityRows[index];
    if (!row) continue;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      new Cesium.Cartesian3(...row.position),
    );
    const onCanvas = Boolean(
      screen &&
      Number.isFinite(screen.x) &&
      Number.isFinite(screen.y) &&
      screen.x >= 0 &&
      screen.y >= 0 &&
      screen.x < canvas.clientWidth &&
      screen.y < canvas.clientHeight,
    );
    const picked = onCanvas
      ? viewer.scene.pick(new Cesium.Cartesian2(screen.x, screen.y))
      : null;
    const pickedEntityId = picked?.id?.id;
    rows.push({
      targetId: row.id,
      screen: screen ? [screen.x, screen.y] : null,
      onCanvas,
      pickedEntityId:
        typeof pickedEntityId === 'string' ? pickedEntityId : null,
    });
  }
  return {
    scope:
      'Post-capture natural scene.pick samples at fixed imported point projections; overlapping points may resolve to another imported point.',
    candidates: indices.length,
    tested: rows.length,
    importedHits: rows.filter(
      (row) => row.onCanvas && ids.has(row.pickedEntityId),
    ).length,
    rows,
  };
}
async function pointStateWitness(viewer, layer) {
  const snapshot = inspectImportedPointState(viewer, {
    Cesium,
    workspaceId: 'fixture',
    expectedCount: 5000,
    pointRepresentation: requestedPointRepresentation,
    layer,
  });
  if (!snapshot.available) return snapshot;
  const nativePickWitness = nativePointPickWitness(viewer, snapshot.entityRows);
  check(
    nativePickWitness.tested > 0 && nativePickWitness.importedHits > 0,
    'Native scene.pick did not resolve an imported point.',
  );
  return {
    available: true,
    version: snapshot.version,
    renderer: snapshot.renderer,
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
    nativePickWitness,
    firstEntity: snapshot.entityRows[0] ?? null,
    lastEntity: snapshot.entityRows.at(-1) ?? null,
    firstPrimitive: snapshot.primitiveRows[0] ?? null,
    lastPrimitive: snapshot.primitiveRows.at(-1) ?? null,
  };
}
function probeMixedGeometryNativePicks(viewer) {
  const targets = [
    { shape: 'point', coordinate: [0, 0] },
    { shape: 'line', coordinate: [0.05, 0.03] },
    { shape: 'polygon', coordinate: [-0.055, 0] },
  ];
  return targets.map(({ shape, coordinate }) => {
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      Cesium.Cartesian3.fromDegrees(...coordinate),
    );
    const onCanvas = Boolean(
      screen &&
      Number.isFinite(screen.x) &&
      Number.isFinite(screen.y) &&
      screen.x >= 0 &&
      screen.y >= 0 &&
      screen.x < viewer.scene.canvas.clientWidth &&
      screen.y < viewer.scene.canvas.clientHeight,
    );
    const picked = onCanvas
      ? viewer.scene.pick(new Cesium.Cartesian2(screen.x, screen.y))
      : null;
    return {
      shape,
      screen: screen ? [screen.x, screen.y] : null,
      onCanvas,
      expectedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
      pickedEntityId: typeof picked?.id?.id === 'string' ? picked.id.id : null,
    };
  });
}
async function waitForMixedGeometryNativePicks(viewer) {
  const startedAtMs = performance.now();
  const deadlineAtMs = startedAtMs + MIXED_GEOMETRY_READY_TIMEOUT_MS;
  let attempts = 0;
  let lastNativePicks = [];
  let frameWaitError = null;
  const observations = [];
  while (performance.now() < deadlineAtMs) {
    const remainingMs = deadlineAtMs - performance.now();
    if (remainingMs <= 0) break;
    try {
      await settledFrame(viewer, remainingMs);
    } catch (error) {
      frameWaitError = String(error?.message || error).slice(0, 240);
      break;
    }
    attempts++;
    lastNativePicks = probeMixedGeometryNativePicks(viewer);
    const ready = lastNativePicks.every(
      (row) => row.onCanvas && row.pickedEntityId === row.expectedEntityId,
    );
    const elapsedMs = performance.now() - startedAtMs;
    observations.push({ atMs: elapsedMs, ready, nativePicks: lastNativePicks });
    if (observations.length > 8) observations.shift();
    if (ready && elapsedMs <= MIXED_GEOMETRY_READY_TIMEOUT_MS)
      return {
        status: 'passed',
        timeoutMs: MIXED_GEOMETRY_READY_TIMEOUT_MS,
        elapsedMs,
        attempts,
        nativePicks: lastNativePicks,
        observations,
      };
  }
  return {
    status: 'failed',
    timeoutMs: MIXED_GEOMETRY_READY_TIMEOUT_MS,
    elapsedMs: performance.now() - startedAtMs,
    attempts,
    nativePicks: lastNativePicks,
    observations,
    frameWaitError,
  };
}
async function mixedGeometrySnapshot(viewer, layer, readiness) {
  const prefix = 'gev-import:mixed-parity:mixed-parity:';
  const entities = [...getContextStore().entities.values()]
    .map((entry) => entry.entity)
    .filter((entity) => String(entity.id).startsWith(prefix))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const candidatePointRows =
    requestedPointRepresentation === 'primitive-collection'
      ? new Map(
          (layer.getPointRendererSnapshot()?.primitiveRows ?? []).map((row) => [
            row.id,
            row,
          ]),
        )
      : null;
  const vector = (value) => (value ? [value.x, value.y, value.z] : null);
  const color = (value) =>
    value ? [value.red, value.green, value.blue, value.alpha] : null;
  const rows = entities.map((entity) => {
    const pointPosition = entity.position?.getValue(viewer.clock.currentTime);
    const collectionPoint = candidatePointRows?.get(entity.id);
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
    return {
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
        : collectionPoint
          ? {
              pixelSize: collectionPoint.pixelSize,
              color: collectionPoint.color,
              outlineColor: collectionPoint.outlineColor,
              outlineWidth: collectionPoint.outlineWidth,
            }
          : null,
      linePositions,
      polygonRings,
    };
  });
  const ids = rows.map((row) => row.id);
  check(
    JSON.stringify(ids) ===
      JSON.stringify([`${prefix}line`, `${prefix}point`, `${prefix}polygon`]),
    'Mixed fixture did not retain exact point, line, and polygon Entity identities.',
  );
  if (requestedPointRepresentation === 'primitive-collection') {
    const snapshot = layer.getPointRendererSnapshot();
    check(
      snapshot?.pointCount === 1 &&
        snapshot.primitiveRows[0]?.id === `${prefix}point`,
      'Mixed fixture point primitive ownership is incomplete.',
    );
  } else {
    check(
      layer.getPointRendererSnapshot() === null &&
        viewer.entities.getById(`${prefix}point`) ===
          getContextStore().entities.get(`${prefix}point`)?.entity,
      'Mixed fixture default point Entity ownership changed.',
    );
  }
  check(
    readiness.nativePicks.every(
      (row) => row.pickedEntityId === row.expectedEntityId,
    ),
    'Mixed geometry native scene.pick did not resolve each intended Entity.',
  );
  return {
    schema: 'gev-import-mixed-geometry-parity/v1',
    status: 'passed',
    renderer: requestedPointRepresentation,
    readiness,
    entityIds: ids,
    rows,
    rowsSha256: await sha256Json(rows),
    nativePicks: readiness.nativePicks,
    nativePicksSha256: await sha256Json(readiness.nativePicks),
  };
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
  const captureElapsedMs = performance.now() - started;
  sample.capture = {
    elapsedMs: captureElapsedMs,
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

run.addEventListener('click', async () => {
  run.disabled = download.disabled = frameProbe.disabled = true;
  result.textContent = '';
  const workload = ['initial-load', 'steady-population'].includes(
    requestedWorkload,
  )
    ? requestedWorkload
    : document.querySelector('#workload').value;
  const diagnosticRun =
    runOptions.get('diag') === '1' ||
    ['initial-load', 'steady-population'].includes(workload) ||
    requestedViewer === 'cesium';
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
    featureLimit: 5000,
    mixedGeometryParityRequested: requestedMixedParity,
    pointBenefitDiagnosticsRequested: requestedPointBenefitDiagnostics,
    workload,
    viewerConstruction: requestedViewer,
    diagnosticsEnabled: diagnosticRun,
    ...(diagnosticRun
      ? {
          diagnosticClassification:
            'opt-in browser scheduling diagnosis only; not performance acceptance',
        }
      : {}),
    preserveDrawingBuffer,
    captureMode: document.querySelector('#capture-mode').value,
    renderDemand: document.querySelector('#render-demand').checked,
    observeCommands: document.querySelector('#observe-commands').checked,
    commandObservationScope:
      'Optional flushed WebGL fence: prior submitted commands only, not GPU timing or a normal latency comparison',
    scope:
      'isolated import correctness and event-loop responsiveness; no full-application or GPU speedup claim',
    ...(requestedPointBenefitDiagnostics
      ? {
          performanceAcceptanceEligible: false,
          pointBenefitMeasurementScope:
            'Separate fresh-page comparison; load, synchronous clear, reset/drain, capture, heartbeat, and live resources are distinct. The production loader exposes no batch-completion observer, so batch timing is unavailable. No forced GC, GPU timing, or physical-desktop claim.',
        }
      : {}),
    checks: [],
    samples: [],
    renderErrors: [],
    status: 'running',
  };
  let viewer, layer;
  let backgrounded = document.visibilityState !== 'visible';
  const visibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'Exact source revision required.',
    );
    check(
      ['entity', 'primitive-collection'].includes(requestedPointRepresentation),
      'Unknown imported point renderer.',
    );
    check(
      !requestedPointComparison || report.captureMode === 'pixels',
      'Point renderer comparison requires pixel capture mode.',
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
    });
    status.textContent = diagnosticRun
      ? 'Diagnostic only: warming the complete 5,000-point population'
      : 'Warming the complete point population';
    const coldAt = performance.now();
    await layer.loadAsync(imports, { workspaceId: 'fixture' });
    await settledFrame(viewer);
    report.coldActivationMs = performance.now() - coldAt;
    report.warmedResources = resources(viewer, layer);
    let expectedPixels = null;
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
          const clearStartedAtMs = performance.now();
          layer.clear();
          const clearCallCompletedAtMs = performance.now();
          const drainStartedAtMs = performance.now();
          await wait(150);
          if (requestedPointBenefitDiagnostics) await settledFrame(viewer);
          const drainCompletedAtMs = performance.now();
          const resourcesAfterClear = requestedPointBenefitDiagnostics
            ? resources(viewer, layer)
            : null;
          let previous = performance.now();
          const gaps = [];
          const timer = setInterval(() => {
            const time = performance.now();
            gaps.push(time - previous);
            previous = time;
          }, 5);
          const started = performance.now();
          let elapsedMs;
          try {
            await (mode === 'synchronous'
              ? layer.load(imports, { workspaceId: 'fixture' })
              : layer.loadAsync(imports, { workspaceId: 'fixture' }));
            elapsedMs = performance.now() - started;
            await wait(20);
          } finally {
            clearInterval(timer);
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
            ...(requestedPointBenefitDiagnostics
              ? {
                  clearCallElapsedMs: clearCallCompletedAtMs - clearStartedAtMs,
                  resetDrainElapsedMs: drainCompletedAtMs - drainStartedAtMs,
                  clearAndDrainElapsedMs: drainCompletedAtMs - clearStartedAtMs,
                  resourcesAfterClear,
                  cooperativeBatchMetrics:
                    mode === 'cooperative' ? unavailableBatchAttribution : null,
                }
              : {}),
          };
          report.samples.push(sample);
          // The capture operation owns its completed-frame wait. Request it from
          // the import task, rather than immediately chaining two postRender waits.
          const captured = await pixels(viewer, sample, {
            preserveBytes: requestedPointComparison || requestedMixedParity,
          });
          const hash =
            captured && typeof captured === 'object'
              ? captured.pixelSha256
              : captured;
          sample.pixelSha256 = hash;
          if (captured && typeof captured === 'object') {
            sample.pixelPngDataUrl = encodePixelWitness(captured);
            sample.pointVisualState = await pointStateWitness(viewer, layer);
            captured.rgba = null;
          }
          sample.resources = resources(viewer, layer);
          if (requestedPointBenefitDiagnostics)
            sample.captureElapsedMs = sample.capture?.elapsedMs;
          if (expectedPixels === null) expectedPixels = hash;
          check(
            hash === expectedPixels,
            'Final pixels differ across equivalent imports.',
          );
        }
      }
      report.checks.push({
        id:
          report.captureMode === 'pixels'
            ? 'same-population-evidence-and-pixels'
            : 'diagnostic-population-and-fresh-frames-without-pixel-equivalence',
        status: 'passed',
      });
      if (requestedPointComparison)
        report.checks.push({
          id: 'point-renderer-identity-order-style-and-native-picks',
          status: 'passed',
        });
    }
    if (requestedMixedParity) {
      check(
        report.captureMode === 'pixels',
        'Mixed geometry parity requires pixel capture mode.',
      );
      layer.clear();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(0, 0, 85_000),
      });
      const priorGlobeShow = viewer.scene.globe.show;
      viewer.scene.globe.show = true;
      const mixedSettings = {
        priorGlobeShow,
        globeShow: viewer.scene.globe.show,
        terrainProvider: viewer.terrainProvider?.constructor?.name ?? null,
        imageryLayerCount: viewer.imageryLayers?.length ?? null,
        baseLayer: false,
      };
      check(
        viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider &&
          viewer.imageryLayers.length === 0,
        'Mixed geometry readiness requires the local ellipsoid with no imagery layers.',
      );
      try {
        const mixedLoad = layer.load(mixedGeometryImports, {
          workspaceId: 'mixed-parity',
        });
        report.mixedGeometryParity = {
          schema: 'gev-import-mixed-geometry-parity/v1',
          status: 'pending',
          renderer: requestedPointRepresentation,
          renderSettings: mixedSettings,
          load: { drawn: mixedLoad.drawn, omitted: mixedLoad.omitted },
        };
        check(
          mixedLoad.drawn === 3 && mixedLoad.omitted === 0,
          'Mixed fixture did not load point, line, and polygon features.',
        );
        const readiness = await waitForMixedGeometryNativePicks(viewer);
        report.mixedGeometryParity.readiness = readiness;
        check(
          readiness.status === 'passed' &&
            readiness.elapsedMs <= MIXED_GEOMETRY_READY_TIMEOUT_MS,
          'Mixed point, line, and polygon native picks did not become ready within 10 seconds.',
        );
        const mixed = await mixedGeometrySnapshot(viewer, layer, readiness);
        const capture = await pixels(
          viewer,
          { mode: 'mixed-parity' },
          { preserveBytes: true },
        );
        check(
          capture && typeof capture === 'object' && capture.rgba,
          'Mixed parity pixel capture is missing.',
        );
        mixed.renderSettings = mixedSettings;
        mixed.load = { drawn: mixedLoad.drawn, omitted: mixedLoad.omitted };
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
      } finally {
        layer.clear();
        viewer.scene.globe.show = priorGlobeShow;
      }
      check(
        layer.getState().featureCount === 0 &&
          layer.getPerformanceDiagnostics().pointPrimitiveCount === 0 &&
          getContextStore().entities.size === 0,
        'Mixed geometry parity retained owned render resources after clear.',
      );
    }
    if (!['initial-load', 'steady-population'].includes(workload))
      status.textContent = 'Checking cancellation and repeated teardown';
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
      abortErrors: ['initial-load', 'steady-population'].includes(workload)
        ? 0
        : 12,
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
    layer?.destroy();
    if (viewer) uninstallRenderGovernor(viewer);
    viewer?.destroy();
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
