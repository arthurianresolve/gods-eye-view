import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import {
  captureFreshCesiumFrame,
  renderFreshCesiumFrame,
} from '../../src/freshFrame.js';
import { getContextStore } from '../../src/data/contextStore.js';
import { createImportedGeometryLayer } from '../../src/imports/runtimeLayer.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const result = document.querySelector('#result');
const status = document.querySelector('#status');
const run = document.querySelector('#run');
const COUNT = 50_000;
const MAX_READY_MS = 15_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function makeLine() {
  return Array.from({ length: COUNT }, (_, index) => {
    const t = index / (COUNT - 1);
    const longitude = -0.045 + t * 0.09;
    const latitude = 0.012 * Math.sin(t * Math.PI * 32);
    return [longitude, latitude, 0];
  });
}

function makePolygon() {
  const coordinates = Array.from({ length: COUNT }, (_, index) => {
    const t = index / (COUNT - 1);
    const angle = t * 2 * Math.PI;
    return [0.035 * Math.cos(angle), 0.035 * Math.sin(angle), 0];
  });
  coordinates[COUNT - 1] = [...coordinates[0]];
  return coordinates;
}

const lineCoordinates = makeLine();
const polygonCoordinates = makePolygon();
const sourceImports = {
  line: [
    {
      id: 'kernel-fixture',
      kind: 'synthetic-demo',
      attribution: 'Generated locally',
      records: [
        {
          id: 'kernel-line',
          properties: { name: 'Kernel line' },
          geometry: { type: 'LineString', coordinates: lineCoordinates },
        },
      ],
    },
  ],
  polygon: [
    {
      id: 'kernel-fixture',
      kind: 'synthetic-demo',
      attribution: 'Generated locally',
      records: [
        {
          id: 'kernel-polygon',
          properties: { name: 'Kernel polygon' },
          geometry: { type: 'Polygon', coordinates: [polygonCoordinates] },
        },
      ],
    },
  ],
};

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function digestPixels(imageData) {
  const hash = await crypto.subtle.digest('SHA-256', imageData.data);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function renderSettings(viewer) {
  const scene = viewer.scene;
  const gl =
    scene.canvas.getContext('webgl2') || scene.canvas.getContext('webgl');
  return {
    sceneMode:
      scene.mode === Cesium.SceneMode.SCENE3D ? 'SCENE3D' : String(scene.mode),
    globeShow: scene.globe.show,
    clockEpoch: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
    shouldAnimate: viewer.clock.shouldAnimate,
    terrainProvider: viewer.terrainProvider?.constructor?.name ?? null,
    imageryLayerCount: viewer.imageryLayers.length,
    resolutionScale: viewer.resolutionScale,
    requestRenderMode: scene.requestRenderMode,
    targetFrameRate: viewer.targetFrameRate,
    preserveDrawingBuffer: true,
    width: scene.canvas.width,
    height: scene.canvas.height,
    cssWidth: scene.canvas.clientWidth,
    cssHeight: scene.canvas.clientHeight,
    msaaSamplesRequested: 4,
    msaaSupported: scene.context?.msaa ?? null,
    antialias: scene.context?.antialias ?? null,
    contextLost: gl?.isContextLost() ?? null,
    cameraPosition: [
      scene.camera.positionWC.x,
      scene.camera.positionWC.y,
      scene.camera.positionWC.z,
    ],
    cameraDirection: [
      scene.camera.directionWC.x,
      scene.camera.directionWC.y,
      scene.camera.directionWC.z,
    ],
  };
}

function sourceFeature(shape) {
  const id = `kernel-${shape}`;
  return (
    sourceImports[shape][0].records[0] && {
      ...sourceImports[shape][0],
      records: [{ ...sourceImports[shape][0].records[0], id }],
    }
  );
}

function positionsFor(entity, shape, time) {
  if (shape === 'line') return entity.polyline.positions.getValue(time);
  const hierarchy = entity.polygon.hierarchy.getValue(time);
  return [
    hierarchy.positions,
    ...hierarchy.holes.map((hole) => hole.positions),
  ];
}

function rgba(color) {
  return [color.red, color.green, color.blue, color.alpha];
}

function styleFor(entity, shape, time) {
  if (shape === 'line') {
    const line = entity.polyline;
    return {
      geometryType: 'LineString',
      width: line.width.getValue(time),
      color: rgba(line.material.color.getValue(time)),
      clampToGround: line.clampToGround.getValue(time),
    };
  }
  const polygon = entity.polygon;
  return {
    geometryType: 'Polygon',
    color: rgba(polygon.material.color.getValue(time)),
    outline: polygon.outline.getValue(time),
    outlineColor: rgba(polygon.outlineColor.getValue(time)),
    perPositionHeight: polygon.perPositionHeight.getValue(time),
  };
}

function screenPoint(viewer, shape, entity) {
  let target;
  if (shape === 'line') {
    const positions = entity.polyline.positions.getValue(
      viewer.clock.currentTime,
    );
    target = positions[Math.floor(positions.length / 2)];
  } else {
    target = Cesium.Cartesian3.fromDegrees(0, 0, 0);
  }
  const point = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    target,
  );
  if (!point) return null;
  // worldToWindowCoordinates already returns canvas-relative coordinates.
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  return x >= 0 &&
    y >= 0 &&
    x < viewer.scene.canvas.clientWidth &&
    y < viewer.scene.canvas.clientHeight
    ? { x, y }
    : null;
}

async function waitForNativePick(viewer, shape, entity) {
  const started = performance.now();
  const deadline = started + MAX_READY_MS;
  let observations = 0;
  while (performance.now() <= deadline) {
    assert(
      await renderFreshCesiumFrame(viewer),
      'No completed visible frame while waiting for geometry.',
    );
    observations++;
    const screen = screenPoint(viewer, shape, entity);
    const picked = screen
      ? viewer.scene.pick(new Cesium.Cartesian2(screen.x, screen.y))
      : null;
    const pickedEntity = picked?.id;
    if (screen && pickedEntity?.id === entity.id)
      return {
        elapsedMs: performance.now() - started,
        observations,
        screen,
        featureId: pickedEntity.id,
      };
    await wait(20);
  }
  throw new Error(
    `${shape} native geometry did not become pickable within ${MAX_READY_MS}ms`,
  );
}

async function runArm(kernel, onUpdate) {
  const viewer = createApplicationViewer({
    container: document.querySelector('#viewer'),
    creditContainer: document.querySelector('#credits'),
    preserveDrawingBuffer: true,
  });
  const resultArm = {
    coordinateKernel: kernel,
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    environment: readPerformanceEnvironment({
      viewer,
      appCommit: __GEV_APP_COMMIT__,
      harnessCommit: __GEV_APP_COMMIT__,
    }),
    renderSettings: null,
    batchAttribution: {
      available: false,
      reason: 'The production cooperative loader has no batch timing observer.',
    },
    shapes: {},
    clear: null,
    renderErrors: [],
  };
  let layer;
  try {
    viewer.scene.renderError.addEventListener((_scene, error) => {
      resultArm.renderErrors.push(
        String(error?.message || error).slice(0, 300),
      );
      if (resultArm.renderErrors.length > 4) resultArm.renderErrors.shift();
    });
    for (const item of ['skyBox', 'skyAtmosphere', 'sun', 'moon'])
      viewer.scene[item].show = false;
    viewer.scene.globe.show = true;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
      '2025-01-01T00:00:00Z',
    );
    viewer.clock.shouldAnimate = false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 180_000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender();
    layer = createImportedGeometryLayer({ viewer, coordinateKernel: kernel });
    resultArm.renderSettings = renderSettings(viewer);
    for (const shape of ['line', 'polygon']) {
      const feature = sourceFeature(shape);
      const coordinates =
        shape === 'line' ? lineCoordinates : polygonCoordinates;
      const sourceCoordinatesSha256 = await digest(coordinates);
      const loadStarted = performance.now();
      const loaded = await layer.loadAsync([feature], {
        workspaceId: 'kernel-fixture',
      });
      const loadAsyncElapsedMs = performance.now() - loadStarted;
      assert(
        loaded.drawn === 1 && loaded.omitted === 0,
        `${shape} import was incomplete.`,
      );
      const entityId = `gev-import:kernel-fixture:kernel-fixture:kernel-${shape}`;
      const entity = viewer.entities.getById(entityId);
      assert(entity, `${shape} Entity identity is missing.`);
      const ready = await waitForNativePick(viewer, shape, entity);
      const firstUsableElapsedMs = performance.now() - loadStarted;
      const time = viewer.clock.currentTime;
      const outputPositions = positionsFor(entity, shape, time).map((ring) =>
        Array.isArray(ring)
          ? ring.map(({ x, y, z }) => [x, y, z])
          : [ring.x, ring.y, ring.z],
      );
      const cartesianPositionsSha256 = await digest(outputPositions);
      const styleSha256 = await digest(styleFor(entity, shape, time));
      const captureStarted = performance.now();
      const copied = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
      assert(copied, `${shape} fresh frame capture failed.`);
      const captureFrameWaitMs = performance.now() - captureStarted;
      const pixelReadbackStarted = performance.now();
      const context = copied.getContext('2d');
      const image = context.getImageData(0, 0, copied.width, copied.height);
      const pixelSha256 = await digestPixels(image);
      const pngDataUrl = copied.toDataURL('image/png');
      copied.width = copied.height = 0;
      assert(
        pngDataUrl.length <= 1_500_000,
        `${shape} PNG witness exceeded the evidence bound.`,
      );
      resultArm.shapes[shape] = {
        featureId: `kernel-${shape}`,
        coordinateCount: coordinates.length,
        sourceCoordinatesSha256,
        cartesianPositionsSha256,
        styleSha256,
        loadAsyncElapsedMs,
        renderReadyElapsedMs: ready.elapsedMs,
        firstUsableElapsedMs,
        readinessObservations: ready.observations,
        captureElapsedMs: captureFrameWaitMs,
        pixelReadbackElapsedMs: performance.now() - pixelReadbackStarted,
        pixelSha256,
        width: image.width,
        height: image.height,
        pngDataUrl,
        nativePick: {
          recordId: `kernel-${shape}`,
          expectedEntityId: entityId,
          pickedEntityId: ready.featureId,
          screen: [ready.screen.x, ready.screen.y],
          onCanvas: true,
        },
      };
      onUpdate?.({ ...resultArm, shapes: { ...resultArm.shapes } });
      layer.clear();
      await renderFreshCesiumFrame(viewer);
      const diagnostics = layer.getPerformanceDiagnostics();
      resultArm.clear = {
        featureCountAfter: layer.getState().featureCount,
        contextEntityCountAfter: getContextStore().entities.size,
        pendingJobsAfter: diagnostics.pendingJobs,
        cacheEntriesAfter: diagnostics.cacheEntries,
      };
      assert(
        resultArm.clear.featureCountAfter === 0 &&
          resultArm.clear.contextEntityCountAfter === 0 &&
          resultArm.clear.pendingJobsAfter === 0 &&
          resultArm.clear.cacheEntriesAfter === 0,
        `${shape} clear retained resources.`,
      );
      onUpdate?.({ ...resultArm, shapes: { ...resultArm.shapes } });
    }
    assert(
      resultArm.renderErrors.length === 0,
      'Cesium reported a scene render error.',
    );
    resultArm.status = 'passed';
    onUpdate?.({ ...resultArm, shapes: { ...resultArm.shapes } });
    return resultArm;
  } catch (error) {
    resultArm.status = 'failed';
    resultArm.error = String(error?.message || error).slice(0, 300);
    onUpdate?.({ ...resultArm, shapes: { ...resultArm.shapes } });
    throw error;
  } finally {
    try {
      layer?.destroy();
    } finally {
      viewer.destroy();
      resultArm.viewerDestroyed = viewer.isDestroyed();
      onUpdate?.({ ...resultArm, shapes: { ...resultArm.shapes } });
    }
  }
}

run.addEventListener('click', async () => {
  run.disabled = true;
  const report = {
    schema: 'gev-import-coordinate-kernel/v1',
    status: 'running',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    fixture: {
      lineCoordinateCount: lineCoordinates.length,
      polygonCoordinateCount: polygonCoordinates.length,
      lineSourceSha256: null,
      polygonSourceSha256: null,
      lineGenerator:
        '50,000-point bounded sinusoid near the fixed camera target',
      polygonGenerator:
        '50,000-point closed near-circular ring around the fixed camera target',
    },
    pairs: [],
    scope:
      'Unprofiled hosted browser experiment; loadAsync includes coordinate conversion and Entity publication; frame readiness and capture are separate; no batch timing or GPU timing is inferred.',
    performanceAccepted: false,
    documentVisibilityAtStart: document.visibilityState,
    foregroundUninterrupted: true,
  };
  window.__gevCoordinateKernelReport = report;
  const visibilityChange = () => {
    if (document.visibilityState !== 'visible')
      report.foregroundUninterrupted = false;
  };
  document.addEventListener('visibilitychange', visibilityChange);
  result.textContent = '';
  try {
    assert(
      /^[a-f0-9]{40}$/.test(report.applicationCommit),
      'Exact app commit is required.',
    );
    report.fixture.lineSourceSha256 = await digest(lineCoordinates);
    report.fixture.polygonSourceSha256 = await digest(polygonCoordinates);
    for (let pairIndex = 0; pairIndex < 5; pairIndex++) {
      const order =
        pairIndex % 2 === 0
          ? ['cesium', 'scalar-experiment']
          : ['scalar-experiment', 'cesium'];
      const pair = { pair: pairIndex, order, arms: {} };
      report.pairs.push(pair);
      for (const kernel of order) {
        status.textContent = `Pair ${pairIndex + 1}/5 · ${kernel} · fresh viewer`;
        pair.arms[kernel] = { status: 'running', coordinateKernel: kernel };
        pair.arms[kernel] = await runArm(kernel, (partial) => {
          pair.arms[kernel] = partial;
        });
      }
    }
    assert(
      report.foregroundUninterrupted && document.visibilityState === 'visible',
      'Page visibility changed during the comparison.',
    );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error).slice(0, 500);
  } finally {
    document.removeEventListener('visibilitychange', visibilityChange);
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    run.disabled = false;
  }
});
