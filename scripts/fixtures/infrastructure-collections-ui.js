import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { localGeoJsonServices } from '../../src/app/localGeojsonServices.js';
import { createInfrastructureLayers } from '../../src/data/infrastructure.js';
import { INFRASTRUCTURE_DATA_URLS } from '../../src/sources/infrastructureData.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  compareInfrastructureSurfaceSamples,
  createInfrastructurePrimitiveCollections,
  INFRASTRUCTURE_COLLECTION_CASES,
  INFRASTRUCTURE_COLLECTION_PAIRS,
  INFRASTRUCTURE_COLLECTION_SCHEMA,
  matchesInfrastructureCollectionPick,
  readInfrastructurePrimitiveSurfaces,
  snapshotInfrastructureSurfaces,
  validateInfrastructureCollectionReport,
} from '../performance/infrastructureCollectionExperiment.mjs';

const FRAME_TIMEOUT_MS = 400;
const MAX_RECORDS = 2000;
const MAX_MISMATCH_PNG_BYTES = 2 * 1024 * 1024;
const run = document.querySelector('#run');
const download = document.querySelector('#download');
const status = document.querySelector('#status');
const output = document.querySelector('#result');
const container = document.querySelector('#viewer');
let report = null;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sourceDigest() {
  const response = await fetch(INFRASTRUCTURE_DATA_URLS['local-dams']);
  check(response.ok, `Bundled dams payload returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  check(
    bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024,
    'Bundled dams source exceeded the fixture byte bound.',
  );
  const lines = new TextDecoder()
    .decode(bytes)
    .split('\n')
    .filter((line) => line.trim());
  const geometryKinds = {};
  for (const line of lines) {
    const feature = JSON.parse(line);
    const kind = feature?.geometry?.type || 'unknown';
    geometryKinds[kind] = (geometryKinds[kind] || 0) + 1;
  }
  return {
    payloadSha256: await sha256(bytes),
    payloadBytes: bytes.byteLength,
    featureCount: lines.length,
    geometryKinds,
  };
}

function instrumentWebGl(gl) {
  const methods = ['bufferData', 'bufferSubData'];
  const originals = new Map();
  const totals = {
    bufferDataCalls: 0,
    bufferSubDataCalls: 0,
    submittedBytes: 0,
  };
  let enabled = false;
  for (const method of methods) {
    const original = gl[method];
    const descriptor = Object.getOwnPropertyDescriptor(gl, method);
    originals.set(method, { original, descriptor });
    gl[method] = function (...args) {
      if (enabled) {
        totals[`${method}Calls`]++;
        const data = args[method === 'bufferData' ? 1 : 2];
        const offset = Number.isFinite(args[3]) ? args[3] : 0;
        const length = Number.isFinite(args[4]) ? args[4] : 0;
        const elementBytes = data?.BYTES_PER_ELEMENT || 1;
        totals.submittedBytes +=
          typeof data === 'number'
            ? data
            : length > 0
              ? length * elementBytes
              : Math.max(0, (data?.byteLength || 0) - offset * elementBytes);
      }
      return original.apply(this, args);
    };
  }
  return {
    totals,
    set enabled(value) {
      enabled = value;
    },
    reset() {
      totals.bufferDataCalls = 0;
      totals.bufferSubDataCalls = 0;
      totals.submittedBytes = 0;
    },
    dispose() {
      enabled = false;
      for (const [method, { descriptor }] of originals) {
        if (descriptor) Object.defineProperty(gl, method, descriptor);
        else delete gl[method];
      }
    },
  };
}

function instrumentFunction(owner, key) {
  if (typeof owner?.[key] !== 'function') return null;
  const original = owner[key];
  const metric = { calls: 0, totalMs: 0, maxMs: 0 };
  owner[key] = function (...args) {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      const durationMs = performance.now() - started;
      metric.calls++;
      metric.totalMs += durationMs;
      metric.maxMs = Math.max(metric.maxMs, durationMs);
    }
  };
  return {
    metric,
    restore() {
      owner[key] = original;
    },
    reset() {
      metric.calls = 0;
      metric.totalMs = 0;
      metric.maxMs = 0;
    },
  };
}

function instrumentCollectionUpdates(collections) {
  return [
    instrumentFunction(collections.points, 'update'),
    instrumentFunction(collections.stems, 'update'),
  ];
}

function setEntitySurfaceVisibility(surfaces, visible, originalVisibility) {
  for (const surface of surfaces) {
    // Keep these public graphics and the production layer's preRender update
    // path alive; only switch their rendering visibility for this comparison.
    const saved = originalVisibility.get(surface.entityId);
    surface.entity.point.show = visible ? saved?.point === true : false;
    surface.entity.polyline.show = visible ? saved?.stem === true : false;
  }
}

function setCollectionVisibility(collections, visible) {
  collections.points.show = visible;
  collections.stems.show = visible;
}

function setFocusedEntityStyle(surface, focused) {
  if (!surface) return;
  const pointColor = new Cesium.Color(...surface.pointStyle.color);
  const outlineColor = new Cesium.Color(...surface.pointStyle.outlineColor);
  const stemColor = new Cesium.Color(...surface.lineStyle.color);
  if (focused) {
    pointColor.alpha = 0.55;
    Cesium.Color.clone(Cesium.Color.YELLOW, outlineColor);
    stemColor.alpha = 0.55;
  }
  surface.entity.point.color = pointColor;
  surface.entity.point.outlineColor = outlineColor;
  surface.entity.polyline.material = new Cesium.ColorMaterialProperty(
    stemColor,
  );
}

function setFocusedCollectionStyle(collections, surface, focused) {
  if (!surface) return;
  const index = collections.indexByEntityId.get(surface.entityId);
  const point = collections.points.get(index);
  const stem = collections.stems.get(index);
  if (!point || !stem)
    throw new Error('Focused surface collection entry is missing.');
  const originalPoint = new Cesium.Color(...surface.pointStyle.color);
  const originalOutline = new Cesium.Color(...surface.pointStyle.outlineColor);
  const originalStem = new Cesium.Color(...surface.lineStyle.color);
  if (focused) {
    originalPoint.alpha = 0.55;
    Cesium.Color.clone(Cesium.Color.YELLOW, originalOutline);
    originalStem.alpha = 0.55;
  }
  point.color = originalPoint;
  point.outlineColor = originalOutline;
  stem.material = Cesium.Material.fromType('Color', { color: originalStem });
}

async function snapshotPixels(
  viewer,
  glObserver,
  displayObserver,
  collectionObservers,
) {
  glObserver.reset();
  displayObserver?.reset();
  collectionObservers.forEach((observer) => observer?.reset());
  glObserver.enabled = true;
  const started = performance.now();
  let canvas;
  try {
    canvas = await captureFreshCesiumFrame(viewer, {
      timeoutMs: FRAME_TIMEOUT_MS,
    });
  } finally {
    glObserver.enabled = false;
  }
  check(canvas, 'A completed native scene frame was unavailable.');
  try {
    // Freeze counters immediately after postRender before readback, hashing,
    // picks, or other asynchronous work can contaminate this frame's scope.
    const frameElapsedMs = performance.now() - started;
    const displayUpdate = displayObserver
      ? { ...displayObserver.metric }
      : null;
    const collectionUpdates = collectionObservers.map((observer) =>
      observer ? { ...observer.metric } : null,
    );
    const webglSubmissions = { ...glObserver.totals };
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const bytes = imageData.data.slice();
    let pixelsDifferentFromCorner = 0;
    for (let offset = 4; offset < bytes.length; offset += 4) {
      if (
        bytes[offset] !== bytes[0] ||
        bytes[offset + 1] !== bytes[1] ||
        bytes[offset + 2] !== bytes[2] ||
        bytes[offset + 3] !== bytes[3]
      )
        pixelsDifferentFromCorner++;
    }
    return {
      canvas,
      bytes,
      width: canvas.width,
      height: canvas.height,
      pixelsDifferentFromCorner,
      frameElapsedMs,
      dataSourceDisplayUpdate: displayUpdate,
      collectionUpdates,
      webglSubmissions,
    };
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
}

async function warmPixels(
  viewer,
  glObserver,
  displayObserver,
  collectionObservers,
  count = 2,
) {
  const hashes = [];
  for (let index = 0; index < count; index++) {
    const frame = await snapshotPixels(
      viewer,
      glObserver,
      displayObserver,
      collectionObservers,
    );
    try {
      hashes.push(await sha256(frame.bytes));
    } finally {
      frame.canvas.width = frame.canvas.height = 0;
    }
  }
  return hashes;
}

function pixelDifferenceCount(left, right) {
  if (left.length !== right.length) return Number.MAX_SAFE_INTEGER;
  let count = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    if (
      left[offset] !== right[offset] ||
      left[offset + 1] !== right[offset + 1] ||
      left[offset + 2] !== right[offset + 2] ||
      left[offset + 3] !== right[offset + 3]
    )
      count++;
  }
  return count;
}

function capturePick(viewer, surface, kind, mode, collections) {
  const cartesian =
    kind === 'point'
      ? surface.position
      : Cesium.Cartesian3.midpoint(
          surface.positions[0],
          surface.positions[1],
          new Cesium.Cartesian3(),
        );
  const windowPosition = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    cartesian,
  );
  if (!windowPosition) return null;
  const picked = viewer.scene.pick(
    new Cesium.Cartesian2(windowPosition.x, windowPosition.y),
  );
  const renderedPrimitive = picked?.primitive;
  if (mode === 'entity') {
    const expectedPrimitive =
      kind === 'point'
        ? renderedPrimitive instanceof Cesium.PointPrimitive
        : (renderedPrimitive instanceof Cesium.GroundPolylinePrimitive ||
            renderedPrimitive instanceof Cesium.Primitive) &&
          (renderedPrimitive.appearance instanceof
            Cesium.PolylineColorAppearance ||
            renderedPrimitive.appearance instanceof
              Cesium.PolylineMaterialAppearance);
    if (!expectedPrimitive) return null;
    return picked?.id === surface.entity
      ? {
          sourceRecordId: surface.sourceRecordId,
          entityId: surface.entityId,
          kind,
          screen: [windowPosition.x, windowPosition.y],
        }
      : null;
  }
  const id = picked?.id;
  if (
    !matchesInfrastructureCollectionPick(
      picked,
      collections,
      surface.entityId,
      kind,
    )
  )
    return null;
  return id?.layerId === surface.layerId &&
    id?.sourceRecordId === surface.sourceRecordId &&
    id?.entityId === surface.entityId &&
    id?.kind === kind
    ? {
        sourceRecordId: id.sourceRecordId,
        entityId: id.entityId,
        kind: id.kind,
        screen: [windowPosition.x, windowPosition.y],
      }
    : null;
}

function findEntityPickTarget(viewer, surfaces) {
  for (const surface of surfaces) {
    if (
      !surface.entityShow ||
      !surface.pointStyle.show ||
      !surface.lineStyle.show
    )
      continue;
    const pointPick = capturePick(viewer, surface, 'point', 'entity', null);
    if (!pointPick) continue;
    const stemPick = capturePick(viewer, surface, 'stem', 'entity', null);
    if (stemPick) {
      const deltaX = pointPick.screen[0] - stemPick.screen[0];
      const deltaY = pointPick.screen[1] - stemPick.screen[1];
      const projectedGapPx = Math.hypot(deltaX, deltaY);
      if (projectedGapPx > 8)
        return { surface, pointPick, stemPick, projectedGapPx };
    }
  }
  throw new Error(
    'The rendered source exposes no verified point/stem pick target.',
  );
}

function fingerprint(surfaces, field) {
  return JSON.stringify(
    surfaces.map((surface) => ({
      id: surface.entityId,
      value: surface[field],
    })),
  );
}

function sampleCounts(dataSource, surfaces, sourceFeatureCount, geometryKinds) {
  const entities = dataSource.entities.values;
  const kindCounts = { point: 0, polyline: 0, polygon: 0, other: 0 };
  for (const entity of entities) {
    if (entity.polygon) kindCounts.polygon++;
    else if (entity.point && entity.polyline) kindCounts.point++;
    else if (entity.polyline) kindCounts.polyline++;
    else kindCounts.other++;
  }
  return {
    sourceFeatureCount,
    renderEntityCount: entities.length,
    canonicalAnalystRecordCount: new Set(
      surfaces.map((surface) => surface.sourceRecordId),
    ).size,
    surfaceCount: surfaces.length,
    pointCount: surfaces.length,
    stemCount: surfaces.length,
    sourceGeometryKinds: geometryKinds,
    renderEntityKinds: kindCounts,
    visiblePointCount: surfaces.filter(
      (surface) => surface.entityShow && surface.pointStyle.show,
    ).length,
    visibleStemCount: surfaces.filter(
      (surface) => surface.entityShow && surface.lineStyle.show,
    ).length,
    lineOnlyEntityCount: kindCounts.polyline,
    polygonEntityCount: kindCounts.polygon,
  };
}

function addCollections(parent, collections) {
  if (!collections || collections.attached) return;
  parent.add(collections.points);
  parent.add(collections.stems);
  collections.attached = true;
}

function removeCollections(parent, collections) {
  if (!collections || !collections.attached) return;
  parent.remove(collections.points);
  parent.remove(collections.stems);
  collections.attached = false;
}

function observedSurfaces(mode, dataSource, layer, collections, time) {
  const entities = snapshotInfrastructureSurfaces({
    entities: dataSource.entities.values,
    analystRecords: layer.getAnalystRecords(MAX_RECORDS),
    layerId: 'local-dams',
    time,
  });
  if (mode === 'entity') return entities;
  const entityById = new Map(
    entities.map((surface) => [surface.entityId, surface]),
  );
  return readInfrastructurePrimitiveSurfaces(collections).map((row) => {
    const source = entityById.get(row.entityId);
    check(source, `Primitive ${row.entityId} has no source Entity.`);
    return {
      ...source,
      sourceRecordId: row.sourceRecordId,
      pointStyle: {
        ...source.pointStyle,
        pixelSize: row.point.pixelSize,
        color: row.point.color,
        outlineColor: row.point.outlineColor,
        outlineWidth: row.point.outlineWidth,
        disableDepthTestDistance: row.point.disableDepthTestDistance,
        show: row.point.show,
      },
      lineStyle: {
        ...source.lineStyle,
        width: row.stem.width,
        color: row.stem.color,
        show: row.stem.show,
      },
      entityShow: source.entityShow,
      position: row.point.position,
      positions: row.stem.positions,
      positionFingerprint: JSON.stringify({
        point: row.point.position,
        stem: row.stem.positions,
      }),
      styleFingerprint: JSON.stringify({
        point: {
          pixelSize: row.point.pixelSize,
          color: row.point.color,
          outlineColor: row.point.outlineColor,
          outlineWidth: row.point.outlineWidth,
          disableDepthTestDistance: row.point.disableDepthTestDistance,
          show: row.point.show,
        },
        line: {
          width: row.stem.width,
          color: row.stem.color,
          show: row.stem.show,
        },
      }),
    };
  });
}

async function surfaceHashes(surfaces) {
  const identity = surfaces.map((surface) => ({
    layerId: surface.layerId,
    entityId: surface.entityId,
    sourceRecordId: surface.sourceRecordId,
    analystId: surface.analystId,
  }));
  const positions = surfaces.map((surface) => ({
    entityId: surface.entityId,
    point: surface.positionFingerprint
      ? JSON.parse(surface.positionFingerprint).point
      : surface.position,
    stem: surface.positionFingerprint
      ? JSON.parse(surface.positionFingerprint).stem
      : surface.positions,
  }));
  const styles = surfaces.map((surface) => ({
    entityId: surface.entityId,
    entityShow: surface.entityShow,
    point: {
      ...surface.pointStyle,
      show: surface.entityShow && surface.pointStyle.show,
    },
    stem: {
      ...surface.lineStyle,
      show: surface.entityShow && surface.lineStyle.show,
    },
  }));
  const hash = async (value) =>
    sha256(new TextEncoder().encode(JSON.stringify(value)));
  return {
    identitySha256: await hash(identity),
    positionSha256: await hash(positions),
    styleSha256: await hash(styles),
  };
}

async function geometryKindHashes(dataSource, sourceIdentity) {
  const renderKinds = { pointStem: 0, lineOnly: 0, polygon: 0, other: 0 };
  for (const entity of dataSource.entities.values) {
    if (entity.polygon) renderKinds.polygon++;
    else if (entity.point && entity.polyline) renderKinds.pointStem++;
    else if (entity.polyline) renderKinds.lineOnly++;
    else renderKinds.other++;
  }
  return {
    sourceGeometryKindsSha256: await sha256(
      new TextEncoder().encode(JSON.stringify(sourceIdentity.geometryKinds)),
    ),
    renderEntityKindsSha256: await sha256(
      new TextEncoder().encode(JSON.stringify(renderKinds)),
    ),
    renderKinds,
  };
}

async function waitForCameraMaterialization(
  viewer,
  dataSource,
  layer,
  previousPositionSha,
) {
  const deadline = performance.now() + 5000;
  let currentSurfaces = [];
  let previousSignature = null;
  let stableChangedFrames = 0;
  let observedChange = false;
  while (performance.now() < deadline) {
    const canvas = await captureFreshCesiumFrame(viewer, {
      timeoutMs: Math.min(
        FRAME_TIMEOUT_MS,
        Math.max(0, deadline - performance.now()),
      ),
    });
    if (!canvas)
      throw new Error('Camera update produced no completed scene frame.');
    canvas.width = canvas.height = 0;
    currentSurfaces = snapshotInfrastructureSurfaces({
      entities: dataSource.entities.values,
      analystRecords: layer.getAnalystRecords(MAX_RECORDS),
      layerId: 'local-dams',
      time: Cesium.JulianDate.now(),
    });
    const positionSignature = fingerprint(
      currentSurfaces,
      'positionFingerprint',
    );
    observedChange ||= positionSignature !== previousPositionSha;
    const signature = JSON.stringify(
      currentSurfaces.map((surface) => [
        surface.entityId,
        surface.positionFingerprint,
        surface.styleFingerprint,
        surface.entityShow,
      ]),
    );
    stableChangedFrames =
      observedChange && signature === previousSignature
        ? stableChangedFrames + 1
        : observedChange
          ? 1
          : 0;
    previousSignature = signature;
    if (
      observedChange &&
      stableChangedFrames >= 3 &&
      viewer.dataSourceDisplay?.ready === true &&
      dataSource.isLoading !== true
    )
      return currentSurfaces;
    viewer.scene.requestRender();
  }
  throw new Error(
    'Camera change did not materialize stable changed Entity geometry within 5 seconds.',
  );
}

function makeCheck(name, passed, details = {}) {
  return { name, passed: passed === true, ...details };
}

async function runDiagnostic() {
  report = {
    schema: INFRASTRUCTURE_COLLECTION_SCHEMA,
    fixture: 'bundled-local-dams-entity-vs-primitive-surfaces/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    status: 'running',
    scope: {
      type: 'fixture-only representation comparison',
      retained: [
        'production DataSource and polygon graphics',
        'Entity objects and point/polyline graphics hidden only while collections render',
        'production local-infrastructure preRender update loop',
      ],
      limitations: [
        'Does not measure total Entity or metadata memory removed.',
        'Does not change or validate the production layer representation.',
        'CPU counters measure observed JavaScript calls; WebGL byte counters are submitted API data, not GPU time or physical bus traffic.',
        'Fixture-level pick identity is checked; application click-handler integration is not claimed.',
      ],
    },
    caseCount: INFRASTRUCTURE_COLLECTION_CASES.length,
    pairsPerCase: INFRASTRUCTURE_COLLECTION_PAIRS,
    source: null,
    environment: null,
    cameraUpdate: null,
    checks: [],
    samples: [],
    visualMismatch: null,
    cleanup: {
      viewerDestroyed: false,
      layersDestroyed: false,
      pointCollectionDestroyed: false,
      polylineCollectionDestroyed: false,
      collectionParentDestroyed: false,
      glInstrumentationRestored: false,
      instrumentationRestored: false,
      entityVisibilityRestored: false,
    },
    failedPhase: null,
    error: null,
  };
  let phase = 'identity';
  let viewer = null;
  let layers = [];
  let glObserver = null;
  let displayObserver = null;
  let collectionObservers = [];
  let collections = null;
  let collectionParent = null;
  let currentSurfaces = [];
  let target = null;
  const liveCanvases = new Set();
  const originalEntityVisibility = new Map();
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit),
      'An exact app commit is required.',
    );
    phase = 'source-identity';
    const sourceIdentity = await sourceDigest();
    viewer = createApplicationViewer({
      container,
      creditContainer: document.querySelector('#credits'),
      preserveDrawingBuffer: true,
    });
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    viewer.scene.globe.show = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyBox.show = false;
    viewer.scene.skyAtmosphere.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    layers = createInfrastructureLayers(localGeoJsonServices);
    const damsLayer = layers.find((layer) => layer.id === 'local-dams');
    check(damsLayer, 'Production local-dams layer was not constructed.');
    await damsLayer.init(viewer);

    phase = 'load-layer';
    await damsLayer.enable(viewer);
    const dataSource = viewer.dataSources.getByName('Dams')?.[0];
    check(
      dataSource && dataSource.isLoading !== true,
      'Dams DataSource did not finish loading.',
    );
    const analystRecords = damsLayer.getAnalystRecords(MAX_RECORDS);
    check(
      analystRecords.length > 0,
      'Production layer returned no analyst records.',
    );
    currentSurfaces = snapshotInfrastructureSurfaces({
      entities: dataSource.entities.values,
      analystRecords,
      layerId: 'local-dams',
      time: Cesium.JulianDate.now(),
    });
    for (const surface of currentSurfaces) {
      originalEntityVisibility.set(surface.entityId, {
        point: surface.pointStyle.show,
        stem: surface.lineStyle.show,
      });
    }

    phase = 'camera-and-readiness';
    const initial = currentSurfaces[0];
    const cartographic = Cesium.Cartographic.fromCartesian(initial.position);
    check(
      cartographic,
      'Source camera anchor is not a valid Cartesian position.',
    );
    let cameraHeightM = 140000;
    const setFixtureCamera = (height) => {
      cameraHeightM = height;
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          height,
        ),
        orientation: { heading: 0, pitch: -Math.PI / 3, roll: 0 },
      });
      viewer.scene.requestRender();
    };
    setFixtureCamera(cameraHeightM);
    let completedFrames = 0;
    let stableReadinessFrames = 0;
    let previousReadinessSignature = null;
    const readyDeadline = performance.now() + 8000;
    while (performance.now() < readyDeadline && completedFrames < 64) {
      const canvas = await captureFreshCesiumFrame(viewer, {
        timeoutMs: FRAME_TIMEOUT_MS,
      });
      check(
        canvas,
        'Loaded Entity visualizers did not complete a native render.',
      );
      canvas.width = canvas.height = 0;
      completedFrames++;
      check(
        dataSource.isLoading !== true,
        'DataSource started loading again during setup.',
      );
      currentSurfaces = snapshotInfrastructureSurfaces({
        entities: dataSource.entities.values,
        analystRecords: damsLayer.getAnalystRecords(MAX_RECORDS),
        layerId: 'local-dams',
        time: Cesium.JulianDate.now(),
      });
      const signature = JSON.stringify(
        currentSurfaces.map((surface) => [
          surface.entityId,
          surface.positionFingerprint,
          surface.styleFingerprint,
          surface.entityShow,
        ]),
      );
      stableReadinessFrames =
        signature === previousReadinessSignature
          ? stableReadinessFrames + 1
          : 1;
      previousReadinessSignature = signature;
      if (
        completedFrames >= 4 &&
        stableReadinessFrames >= 3 &&
        viewer.dataSourceDisplay?.ready === true
      )
        break;
    }
    check(
      completedFrames >= 4 &&
        stableReadinessFrames >= 3 &&
        viewer.dataSourceDisplay?.ready === true,
      'Entity visualizer readiness did not settle within the setup deadline.',
    );
    check(
      currentSurfaces.length > 0,
      'No public Entity point/stem surfaces were materialized.',
    );
    report.source = {
      id: 'local-dams',
      payloadSha256: sourceIdentity.payloadSha256,
      payloadBytes: sourceIdentity.payloadBytes,
      bundledFeatureCount: sourceIdentity.featureCount,
      geometryKinds: sourceIdentity.geometryKinds,
      ...sampleCounts(
        dataSource,
        currentSurfaces,
        sourceIdentity.featureCount,
        sourceIdentity.geometryKinds,
      ),
      cameraAnchorEntityId: currentSurfaces[0].entityId,
      terrain:
        'Cesium default Ellipsoid terrain provider; no live terrain or imagery requests enabled.',
    };
    report.environment = {
      ...readPerformanceEnvironment({
        viewer,
        appCommit: report.applicationCommit,
        harnessCommit: report.harnessCommit,
      }),
      viewport: { width: viewer.canvas.width, height: viewer.canvas.height },
      rendererScope:
        'observed viewer renderer; no hardware/performance eligibility claim',
      materializedEntityFrames: completedFrames,
      stableReadinessFrames,
      sceneGlobeVisible: viewer.scene.globe.show,
      sceneRequestRenderMode: viewer.scene.requestRenderMode,
    };
    check(
      Number.isSafeInteger(report.environment.viewport.width) &&
        report.environment.viewport.width > 0 &&
        Number.isSafeInteger(report.environment.viewport.height) &&
        report.environment.viewport.height > 0,
      'The observed framebuffer dimensions are unavailable.',
    );
    report.environment.framebufferScope =
      'observed drawing-buffer dimensions; CSS viewport may differ.';
    report.checks.push(
      makeCheck('production-layer-loaded', true, {
        sourceFeatureCount: report.source.sourceFeatureCount,
        canonicalAnalystRecordCount: report.source.canonicalAnalystRecordCount,
        pointStemSurfaceCount: report.source.surfaceCount,
      }),
    );
    report.checks.push(
      makeCheck('entity-visualizers-materialized', completedFrames >= 3),
    );

    phase = 'pick-target';
    target = findEntityPickTarget(viewer, currentSurfaces);
    report.checks.push(
      makeCheck('entity-point-and-stem-picking', true, {
        sourceRecordId: target.surface.sourceRecordId,
        entityId: target.surface.entityId,
      }),
    );
    collectionParent = new Cesium.PrimitiveCollection({
      destroyPrimitives: false,
    });
    viewer.scene.primitives.add(collectionParent);
    collections = createInfrastructurePrimitiveCollections(
      Cesium,
      currentSurfaces,
    );
    addCollections(collectionParent, collections);
    collectionObservers = instrumentCollectionUpdates(collections);
    report.collectionConstructionMs = collections.constructionMs;
    glObserver = instrumentWebGl(viewer.scene.context._gl);
    displayObserver = instrumentFunction(viewer.dataSourceDisplay, 'update');
    check(
      displayObserver,
      'DataSourceDisplay update instrumentation is unavailable.',
    );

    phase = 'representation-warmup';
    removeCollections(collectionParent, collections);
    setCollectionVisibility(collections, false);
    setEntitySurfaceVisibility(currentSurfaces, true, originalEntityVisibility);
    const entityWarmupFrames = await warmPixels(
      viewer,
      glObserver,
      displayObserver,
      collectionObservers,
    );
    check(
      entityWarmupFrames[0] === entityWarmupFrames[1],
      'Repeated Entity warmup frames differ before representation comparison.',
    );
    setEntitySurfaceVisibility(
      currentSurfaces,
      false,
      originalEntityVisibility,
    );
    setCollectionVisibility(collections, true);
    addCollections(collectionParent, collections);
    viewer.scene.requestRender();
    const collectionWarmupFrames = await warmPixels(
      viewer,
      glObserver,
      displayObserver,
      collectionObservers,
    );
    check(
      collectionWarmupFrames[0] === collectionWarmupFrames[1],
      'Repeated candidate collection warmup frames differ before A/B samples.',
    );
    removeCollections(collectionParent, collections);
    setCollectionVisibility(collections, false);
    setEntitySurfaceVisibility(currentSurfaces, true, originalEntityVisibility);
    viewer.scene.requestRender();
    report.checks.push(
      makeCheck('entity-repeat-frame-control', true, {
        pixelSha256: entityWarmupFrames[0],
        frames: entityWarmupFrames.length,
      }),
    );
    report.checks.push(
      makeCheck('both-representations-warmed', true, {
        entityFrames: 2,
        collectionFrames: collectionWarmupFrames.length,
        collectionWarmupPixelHashes: collectionWarmupFrames,
        collectionConstructionMs: collections.constructionMs,
        scope:
          'cold construction and activation are reported separately; sample update timers exclude these warmups.',
      }),
    );

    phase = 'paired-samples';
    for (const [
      caseIndex,
      caseId,
    ] of INFRASTRUCTURE_COLLECTION_CASES.entries()) {
      if (caseId === 'focused-alpha-style') {
        const previousPositionSha = fingerprint(
          currentSurfaces,
          'positionFingerprint',
        );
        removeCollections(collectionParent, collections);
        setCollectionVisibility(collections, false);
        setEntitySurfaceVisibility(
          currentSurfaces,
          true,
          originalEntityVisibility,
        );
        setFixtureCamera(cameraHeightM + 30000);
        currentSurfaces = await waitForCameraMaterialization(
          viewer,
          dataSource,
          damsLayer,
          previousPositionSha,
        );
        target = {
          ...findEntityPickTarget(viewer, currentSurfaces),
        };
        for (const surface of currentSurfaces) {
          originalEntityVisibility.set(surface.entityId, {
            point: surface.pointStyle.show,
            stem: surface.lineStyle.show,
          });
        }
        removeCollections(collectionParent, collections);
        collectionObservers.forEach((observer) => observer?.restore());
        collections.destroy();
        collections = createInfrastructurePrimitiveCollections(
          Cesium,
          currentSurfaces,
          {
            focusedEntityId: target.surface.entityId,
          },
        );
        addCollections(collectionParent, collections);
        collectionObservers = instrumentCollectionUpdates(collections);
        report.cameraUpdate = {
          observed: true,
          requestedCameraHeightM: cameraHeightM,
          sourcePositionSha256: await sha256(
            new TextEncoder().encode(
              fingerprint(currentSurfaces, 'positionFingerprint'),
            ),
          ),
          changedEntityStemPositions: true,
          semantics:
            'native camera setView; production layer preRender path updated source Entity positions; collection re-seeded from those public values at the checkpoint.',
        };
        report.checks.push(
          makeCheck('production-camera-update-materialized', true),
        );
      }
      const focusedSurface =
        caseId === 'focused-alpha-style' ? target.surface : null;
      if (focusedSurface) setFocusedEntityStyle(focusedSurface, true);
      for (const [surfaceId, surface] of currentSurfaces.entries()) {
        if (!originalEntityVisibility.has(surface.entityId)) {
          originalEntityVisibility.set(surface.entityId, {
            point: surface.pointStyle.show,
            stem: surface.lineStyle.show,
          });
        }
        if (
          caseId === 'focused-alpha-style' &&
          surface.entityId === focusedSurface.entityId
        )
          setFocusedCollectionStyle(collections, surface, true);
      }
      if (focusedSurface) {
        removeCollections(collectionParent, collections);
        setCollectionVisibility(collections, false);
        setEntitySurfaceVisibility(
          currentSurfaces,
          true,
          originalEntityVisibility,
        );
        viewer.scene.requestRender();
        const focusedEntityWarmup = await warmPixels(
          viewer,
          glObserver,
          displayObserver,
          collectionObservers,
        );
        setEntitySurfaceVisibility(
          currentSurfaces,
          false,
          originalEntityVisibility,
        );
        setCollectionVisibility(collections, true);
        addCollections(collectionParent, collections);
        viewer.scene.requestRender();
        const focusedCollectionWarmup = await warmPixels(
          viewer,
          glObserver,
          displayObserver,
          collectionObservers,
        );
        check(
          focusedEntityWarmup.every(
            (value) => value === focusedEntityWarmup[0],
          ) &&
            focusedCollectionWarmup.every(
              (value) => value === focusedCollectionWarmup[0],
            ),
          'Focused style did not settle to repeatable Entity and collection frames.',
        );
        removeCollections(collectionParent, collections);
        setCollectionVisibility(collections, false);
        setEntitySurfaceVisibility(
          currentSurfaces,
          true,
          originalEntityVisibility,
        );
        report.checks.push(
          makeCheck('focused-style-warmup-stable', true, {
            entityPixelSha256: focusedEntityWarmup[0],
            collectionPixelSha256: focusedCollectionWarmup[0],
          }),
        );
      }
      for (let pair = 0; pair < INFRASTRUCTURE_COLLECTION_PAIRS; pair++) {
        const order =
          (pair + caseIndex) % 2 === 0
            ? ['entity', 'collection']
            : ['collection', 'entity'];
        const side = new Map();
        for (const mode of order) {
          phase = `sample:${caseId}:${pair}:${mode}`;
          if (mode === 'entity') {
            removeCollections(collectionParent, collections);
            setCollectionVisibility(collections, false);
            setEntitySurfaceVisibility(
              currentSurfaces,
              true,
              originalEntityVisibility,
            );
          } else {
            setEntitySurfaceVisibility(
              currentSurfaces,
              false,
              originalEntityVisibility,
            );
            setCollectionVisibility(collections, true);
            addCollections(collectionParent, collections);
          }
          viewer.scene.requestRender();
          glObserver.reset();
          displayObserver.reset();
          const captured = await snapshotPixels(
            viewer,
            glObserver,
            displayObserver,
            collectionObservers,
          );
          liveCanvases.add(captured.canvas);
          try {
            const actualSurfaces = observedSurfaces(
              mode,
              dataSource,
              damsLayer,
              collections,
              Cesium.JulianDate.now(),
            );
            const actualCounts = sampleCounts(
              dataSource,
              actualSurfaces,
              sourceIdentity.featureCount,
              sourceIdentity.geometryKinds,
            );
            const actualKindHashes = await geometryKindHashes(
              dataSource,
              sourceIdentity,
            );
            const hashes = await surfaceHashes(actualSurfaces);
            const pointPick = capturePick(
              viewer,
              target.surface,
              'point',
              mode,
              collections,
            );
            const stemPick = capturePick(
              viewer,
              target.surface,
              'stem',
              mode,
              collections,
            );
            check(
              captured.pixelsDifferentFromCorner > 100,
              `${mode} frame did not contain enough visible scene pixels.`,
            );
            const row = {
              caseId,
              pair,
              mode,
              ...actualCounts,
              ...hashes,
              sourceGeometryKindsSha256:
                actualKindHashes.sourceGeometryKindsSha256,
              renderEntityKindsSha256: actualKindHashes.renderEntityKindsSha256,
              pixelSha256: await sha256(captured.bytes),
              pixelDifferenceCount: null,
              pointPick,
              stemPick,
              frame: {
                width: captured.width,
                height: captured.height,
                pixelsDifferentFromCorner: captured.pixelsDifferentFromCorner,
                elapsedMs: captured.frameElapsedMs,
              },
              updateCpu: {
                scope:
                  'JavaScript call duration for instrumented update methods during the completed frame only.',
                dataSourceDisplay: { ...captured.dataSourceDisplayUpdate },
                collectionPrimitive: {
                  point: captured.collectionUpdates[0],
                  stem: captured.collectionUpdates[1],
                },
              },
              webglSubmissionApi: captured.webglSubmissions,
              cleanup: null,
            };
            side.set(mode, { row, captured });
            report.samples.push(row);
            check(
              pointPick,
              `${mode} point pick did not resolve to the source feature.`,
            );
            check(
              stemPick,
              `${mode} stem pick did not resolve to the source feature.`,
            );
          } catch (error) {
            captured.canvas.width = captured.canvas.height = 0;
            liveCanvases.delete(captured.canvas);
            throw error;
          }
        }
        const entitySide = side.get('entity');
        const collectionSide = side.get('collection');
        const differences = pixelDifferenceCount(
          entitySide.captured.bytes,
          collectionSide.captured.bytes,
        );
        entitySide.row.pixelDifferenceCount = differences;
        collectionSide.row.pixelDifferenceCount = differences;
        if (differences > 0 && !report.visualMismatch) {
          const entityPng = entitySide.captured.canvas.toDataURL('image/png');
          const collectionPng =
            collectionSide.captured.canvas.toDataURL('image/png');
          const entityBase64 = entityPng.split(',')[1] || '';
          const collectionBase64 = collectionPng.split(',')[1] || '';
          if (
            entityBase64.length <= MAX_MISMATCH_PNG_BYTES * 1.4 &&
            collectionBase64.length <= MAX_MISMATCH_PNG_BYTES * 1.4
          )
            report.visualMismatch = {
              caseId,
              pair,
              entityPngBase64: entityBase64,
              collectionPngBase64: collectionBase64,
            };
          else
            report.visualMismatch = {
              caseId,
              pair,
              pngOmitted:
                'One or both mismatch PNGs exceeded the bounded artifact size.',
            };
        }
        try {
          const matched = compareInfrastructureSurfaceSamples(
            entitySide.row,
            collectionSide.row,
          );
          report.checks.push(
            makeCheck(`${caseId}-pair-${pair + 1}-exact-match`, matched, {
              pixelDifferenceCount: differences,
            }),
          );
        } finally {
          entitySide.captured.canvas.width =
            entitySide.captured.canvas.height = 0;
          collectionSide.captured.canvas.width =
            collectionSide.captured.canvas.height = 0;
          liveCanvases.delete(entitySide.captured.canvas);
          liveCanvases.delete(collectionSide.captured.canvas);
        }
      }
      if (focusedSurface) setFocusedEntityStyle(focusedSurface, false);
    }
  } catch (error) {
    report.status = 'failed';
    report.failedPhase = phase;
    report.error = String(error?.message || error).slice(0, 1000);
  } finally {
    phase = report.failedPhase || 'cleanup';
    try {
      glObserver?.dispose();
      report.cleanup.glInstrumentationRestored = true;
    } catch (error) {
      report.cleanup.glInstrumentationRestored = false;
      report.cleanup.error = String(error?.message || error).slice(0, 400);
    }
    let instrumentationRestored = true;
    for (const observer of [displayObserver, ...collectionObservers]) {
      try {
        observer?.restore();
      } catch (error) {
        instrumentationRestored = false;
        report.cleanup.instrumentationRestored = false;
        report.cleanup.error ||= String(error?.message || error).slice(0, 400);
      }
    }
    report.cleanup.instrumentationRestored = instrumentationRestored;
    for (const canvas of liveCanvases) {
      try {
        canvas.width = canvas.height = 0;
      } catch {}
    }
    liveCanvases.clear();
    try {
      if (collections && viewer && !viewer.isDestroyed()) {
        removeCollections(collectionParent, collections);
        report.cleanup.pointCollectionDestroyed = collections.destroy();
        report.cleanup.polylineCollectionDestroyed = collections.isDestroyed();
      }
    } catch (error) {
      report.cleanup.collectionCleanupError = String(
        error?.message || error,
      ).slice(0, 400);
    }
    try {
      if (collectionParent && viewer && !viewer.isDestroyed()) {
        if (!collectionParent.isDestroyed())
          viewer.scene.primitives.remove(collectionParent);
        report.cleanup.collectionParentDestroyed =
          collectionParent.isDestroyed();
      }
    } catch (error) {
      report.cleanup.collectionParentCleanupError = String(
        error?.message || error,
      ).slice(0, 400);
    }
    try {
      if (viewer && !viewer.isDestroyed()) {
        for (const surface of currentSurfaces) {
          const original = originalEntityVisibility.get(surface.entityId);
          if (!original) continue;
          surface.entity.point.show = original.point;
          surface.entity.polyline.show = original.stem;
        }
      }
      report.cleanup.entityVisibilityRestored = true;
    } catch (error) {
      report.cleanup.entityVisibilityRestoreError = String(
        error?.message || error,
      ).slice(0, 400);
    }
    let layersDestroyed = true;
    for (const layer of layers) {
      try {
        await layer.destroy(viewer);
      } catch (error) {
        layersDestroyed = false;
        report.cleanup.layerCleanupError ||= String(
          error?.message || error,
        ).slice(0, 400);
      }
    }
    report.cleanup.layersDestroyed = layersDestroyed;
    try {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      report.cleanup.viewerDestroyed = Boolean(viewer?.isDestroyed?.());
    } catch (error) {
      report.cleanup.viewerDestroyed = false;
      report.cleanup.viewerCleanupError = String(error?.message || error).slice(
        0,
        400,
      );
    }
    if (
      report.cleanup.viewerDestroyed !== true ||
      report.cleanup.layersDestroyed !== true ||
      report.cleanup.pointCollectionDestroyed !== true ||
      report.cleanup.polylineCollectionDestroyed !== true ||
      report.cleanup.collectionParentDestroyed !== true ||
      report.cleanup.glInstrumentationRestored !== true ||
      report.cleanup.instrumentationRestored !== true ||
      report.cleanup.entityVisibilityRestored !== true
    ) {
      report.status = 'failed';
      report.failedPhase ||= phase;
      report.error ||= 'Fixture-owned resources did not all release cleanly.';
    }
  }
  if (report.status === 'running' && !report.error) {
    phase = 'validate-report';
    try {
      report.status = 'passed';
      validateInfrastructureCollectionReport(report, {
        expectedCommit: report.applicationCommit,
      });
    } catch (error) {
      report.status = 'failed';
      report.failedPhase = phase;
      report.error = String(error?.message || error).slice(0, 1000);
    }
  }
  return report;
}

run.addEventListener('click', async () => {
  run.disabled = true;
  download.disabled = true;
  status.textContent = 'Running native Entity/collection comparisons…';
  try {
    report = await runDiagnostic();
  } catch (error) {
    report = {
      schema: INFRASTRUCTURE_COLLECTION_SCHEMA,
      applicationCommit: __GEV_APP_COMMIT__,
      harnessCommit: __GEV_APP_COMMIT__,
      status: 'failed',
      failedPhase: 'outer-fixture',
      error: String(error?.message || error).slice(0, 1000),
      samples: [],
    };
  }
  status.textContent = `${report.status}: ${report.samples?.length || 0} samples`;
  output.textContent = JSON.stringify(report, null, 2);
  run.disabled = false;
  download.disabled = false;
});

download.addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `infrastructure-collections-${report.applicationCommit.slice(0, 7)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
