import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { localGeoJsonServices } from '../../src/app/localGeojsonServices.js';
import { createInfrastructureLayers } from '../../src/data/infrastructure.js';
import { INFRASTRUCTURE_DATA_URLS } from '../../src/sources/infrastructureData.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import { countInfrastructureGraphics } from '../performance/infrastructureRuntimeComparison.mjs';
import {
  assertInfrastructureSourceInventory,
  DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID,
  infrastructureFixtureLayer,
} from './infrastructureFixtureLayer.mjs';
import { setInfrastructureFixtureCamera } from './infrastructureFixtureCamera.mjs';
import { resolveInfrastructureNativePickOwner } from './infrastructureNativePickOwnership.mjs';

const FRAME_TIMEOUT_MS = 12_000;
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const fixtureLayer = infrastructureFixtureLayer(
  params.get('layerId') || DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID,
);
if (fixtureLayer.layerId !== DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID)
  throw new Error('The benefit fixture supports datacenters only.');
const statusNode = document.querySelector('#status');
const outputNode = document.querySelector('#result');
const container = document.querySelector('#viewer');
const acceptedModes = new Set(['entities', 'primitive-collections']);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function readSourceIdentity(layer) {
  const response = await fetch(INFRASTRUCTURE_DATA_URLS[layer.layerId]);
  check(
    response.ok,
    `${layer.layerName} payload returned HTTP ${response.status}.`,
  );
  const bytes = await response.arrayBuffer();
  check(
    bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024,
    'Payload exceeded its bound.',
  );
  const text = new TextDecoder().decode(bytes);
  const features = text.split('\n').filter((line) => line.trim());
  const kinds = {};
  for (const line of features) {
    const type = JSON.parse(line)?.geometry?.type || 'unknown';
    kinds[type] = (kinds[type] || 0) + 1;
  }
  const source = {
    layerId: layer.layerId,
    payloadSha256: await sha256(bytes),
    payloadBytes: bytes.byteLength,
    featureCount: features.length,
    geometryKinds: kinds,
  };
  assertInfrastructureSourceInventory(source, layer);
  return source;
}

function finitePosition(value) {
  const position = [value?.x, value?.y, value?.z];
  return position.every(Number.isFinite) ? position : null;
}

function primitiveCollections(viewer, layerId) {
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const owner = viewer.scene.primitives.get(index);
    if (owner?.__gevLocalInfrastructureLayerId === layerId) {
      return { owner, points: owner.get(0), stems: owner.get(1) };
    }
  }
  return null;
}

function pointAndStem(row, collections, time, collectionByEntity) {
  if (collections) {
    const pair = collectionByEntity?.get(row);
    if (pair)
      return {
        point: pair.point.position,
        positions: pair.stem.positions,
        pointShow: pair.point.show !== false,
        stemShow: pair.stem.show !== false,
      };
  }
  if (row.point && row.polyline) {
    const value = (property) =>
      typeof property?.getValue === 'function'
        ? property.getValue(time)
        : property;
    return {
      point: value(row.position),
      positions: value(row.polyline.positions),
      pointShow: value(row.point.show) !== false,
      stemShow: value(row.polyline.show) !== false,
    };
  }
  return null;
}

function createNativeOwnershipRows(rows, analystRecords, time, layerId) {
  const recordsBySourceId = new Map();
  for (const record of analystRecords) {
    const sourceId = String(record?.evidence?.entityRef?.id ?? '');
    if (!sourceId) continue;
    const records = recordsBySourceId.get(sourceId) || [];
    records.push(record);
    recordsBySourceId.set(sourceId, records);
  }
  const ownershipRows = new Map();
  for (const entity of rows) {
    const properties =
      (typeof entity.properties?.getValue === 'function'
        ? entity.properties.getValue(time)
        : entity.properties) || {};
    const sourceId = String(properties.osm_id ?? properties.id ?? entity.id);
    const analyst = recordsBySourceId.get(sourceId)?.[0];
    if (analyst?.evidence?.entityRef?.layerKey !== layerId) continue;
    ownershipRows.set(entity, {
      entity,
      layerId,
      entityId: String(entity.id),
      sourceRecordId: String(
        analyst.sourceRecordId || analyst.evidence.entityRef.id,
      ),
      entityShow: entity.show !== false,
      point: { show: true },
      stem: { show: true },
    });
  }
  check(
    ownershipRows.size === rows.length,
    'Native pick ownership index does not cover every layer surface.',
  );
  return ownershipRows;
}

function pickTarget(
  viewer,
  rows,
  collections,
  time,
  collectionByEntity,
  ownershipRows,
  layerId,
) {
  const canvasWidth = viewer.scene.canvas.clientWidth;
  const canvasHeight = viewer.scene.canvas.clientHeight;
  const pickOwner = (picked, kind, requestedRow) => {
    const indexedRow = ownershipRows.get(picked?.id);
    const currentSurfaces = indexedRow
      ? pointAndStem(indexedRow.entity, collections, time, collectionByEntity)
      : null;
    if (indexedRow) {
      indexedRow.entityShow = indexedRow.entity.show !== false;
      indexedRow.point.show = currentSurfaces?.pointShow === true;
      indexedRow.stem.show = currentSurfaces?.stemShow === true;
    }
    const owner = resolveInfrastructureNativePickOwner({
      picked,
      kind,
      requestedEntity: requestedRow,
      rowsByEntity: ownershipRows,
      primitivesByEntity: collectionByEntity,
      layerId,
      mode: collections ? 'primitive-collections' : 'entities',
      Cesium,
    });
    return owner
      ? {
          row: owner.row.entity,
          sourceRecordId: owner.row.sourceRecordId,
          primitiveType: owner.primitiveType,
          appearanceType: owner.appearanceType,
        }
      : null;
  };
  for (const row of rows) {
    if (!row.show) continue;
    const surfaces = pointAndStem(row, collections, time, collectionByEntity);
    if (
      !surfaces?.pointShow ||
      !surfaces.stemShow ||
      !Array.isArray(surfaces.positions) ||
      surfaces.positions.length < 2
    )
      continue;
    const pointScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      surfaces.point,
    );
    const middle = Cesium.Cartesian3.midpoint(
      surfaces.positions[0],
      surfaces.positions[1],
      new Cesium.Cartesian3(),
    );
    const stemScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      middle,
    );
    if (!pointScreen || !stemScreen) continue;
    if (
      [pointScreen.x, pointScreen.y, stemScreen.x, stemScreen.y].some(
        (value) => !Number.isFinite(value),
      ) ||
      pointScreen.x < 0 ||
      pointScreen.y < 0 ||
      stemScreen.x < 0 ||
      stemScreen.y < 0 ||
      pointScreen.x >= canvasWidth ||
      stemScreen.x >= canvasWidth ||
      pointScreen.y >= canvasHeight ||
      stemScreen.y >= canvasHeight ||
      Math.hypot(pointScreen.x - stemScreen.x, pointScreen.y - stemScreen.y) <=
        8
    )
      continue;
    const pointPick = viewer.scene.pick(
      new Cesium.Cartesian2(pointScreen.x, pointScreen.y),
    );
    const stemPick = viewer.scene.pick(
      new Cesium.Cartesian2(stemScreen.x, stemScreen.y),
    );
    const pointOwner = pickOwner(pointPick, 'point', row);
    const stemOwner = pickOwner(stemPick, 'stem', row);
    if (!pointOwner || !stemOwner) continue;
    const pointScreenPosition = [pointScreen.x, pointScreen.y];
    const stemScreenPosition = [stemScreen.x, stemScreen.y];
    if (layerId !== 'local-datacenters')
      return {
        entityId: String(row.id),
        pointScreen: pointScreenPosition,
        stemScreen: stemScreenPosition,
      };
    const makePick = (kind, owner, screen) => ({
      kind,
      layerId,
      ownerVerified: true,
      entityId: String(owner.row.id),
      sourceRecordId: owner.sourceRecordId,
      primitiveType: owner.primitiveType,
      appearanceType: owner.appearanceType,
      screen,
    });
    return {
      entityId: String(stemOwner.row.id),
      layerId,
      pointScreen: pointScreenPosition,
      stemScreen: stemScreenPosition,
      point: makePick('point', pointOwner, pointScreenPosition),
      stem: makePick('stem', stemOwner, stemScreenPosition),
    };
  }
  return null;
}

function snapshotPixels(viewer) {
  const source = viewer.scene.canvas;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  try {
    const context = copy.getContext('2d', { willReadFrequently: true });
    check(context, 'Could not copy the completed WebGL frame.');
    context.drawImage(source, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    const corner = [data[0], data[1], data[2], data[3]];
    let changed = 0;
    for (let offset = 4; offset < data.length; offset += 4) {
      if (
        data[offset] !== corner[0] ||
        data[offset + 1] !== corner[1] ||
        data[offset + 2] !== corner[2] ||
        data[offset + 3] !== corner[3]
      )
        changed++;
    }
    const bytes = data.slice().buffer;
    const dimensions = { width: copy.width, height: copy.height };
    return { bytes, changedPixels: changed, ...dimensions };
  } finally {
    copy.width = copy.height = 0;
  }
}

function pngDataUrl(bytes, width, height) {
  check(bytes instanceof ArrayBuffer, 'Captured RGBA bytes are unavailable.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    check(context, 'Could not create PNG artifact canvas.');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(bytes), width, height),
      0,
      0,
    );
    return canvas.toDataURL('image/png');
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function createFrameGate(viewer) {
  let waiter = null;
  let closed = false;
  const onPostRender = () => {
    if (!waiter || closed) return;
    const current = waiter;
    waiter = null;
    try {
      current.resolve({
        frameNumber: viewer.scene.frameState.frameNumber,
        capturedAt: performance.now(),
        pixels: snapshotPixels(viewer),
      });
    } catch (error) {
      current.resolve({ error: String(error?.message || error) });
    }
  };
  const remove = viewer.scene.postRender.addEventListener(onPostRender);
  return {
    next() {
      check(!closed && !waiter, 'Invalid or overlapping completed-frame wait.');
      return new Promise((resolve, reject) => {
        const current = { resolve: null };
        waiter = current;
        const timer = setTimeout(() => {
          if (waiter !== current) return;
          waiter = null;
          reject(new Error('No completed frame arrived before the deadline.'));
        }, FRAME_TIMEOUT_MS);
        current.resolve = (value) => {
          clearTimeout(timer);
          resolve(value);
        };
      });
    },
    close() {
      if (closed) return;
      closed = true;
      remove?.();
      if (waiter) {
        const current = waiter;
        waiter = null;
        current.resolve({ error: 'Frame gate closed.' });
      }
    },
  };
}

async function warmDataSourceDisplay(viewer) {
  const before = viewer.dataSources.length;
  const temporary = new Cesium.CustomDataSource('s54-display-warmup');
  await viewer.dataSources.add(temporary);
  viewer.scene.requestRender();
  await renderFrame(viewer);
  const removed = await viewer.dataSources.remove(temporary, true);
  viewer.scene.requestRender();
  await renderFrame(viewer);
  check(
    removed && viewer.dataSources.length === before,
    'Display warmup leaked its temporary data source.',
  );
}

async function renderFrame(viewer) {
  const gate = createFrameGate(viewer);
  try {
    viewer.scene.requestRender();
    const frame = await gate.next();
    check(!frame.error, frame.error || 'Fresh frame failed.');
    frame.pixels.bytes = null;
  } finally {
    gate.close();
  }
}

function sceneResourceCounts(viewer, dataSource) {
  const owners = [];
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.__gevLocalInfrastructureLayerId === fixtureLayer.layerId)
      owners.push(primitive);
  }
  const graphics =
    dataSource?.entities.values.filter(
      (entity) => entity.point && entity.polyline,
    ).length || 0;
  const surfaceEntities =
    mode === 'entities'
      ? (dataSource?.entities.values || []).filter(
          (entity) => entity.point && entity.polyline,
        )
      : [...(collectionByEntityRef?.keys() || [])];
  const inventory = countInfrastructureGraphics(
    dataSource?.entities.values || [],
    surfaceEntities,
  );
  const diagnostics = layerRef?.getPerformanceDiagnostics?.() || null;
  return {
    entityCount: dataSource?.entities.values.length ?? 0,
    surfaceGraphics: graphics,
    preservedGraphics: inventory.preservedGraphics,
    owners: owners.length,
    collectionPoints: diagnostics?.surfacePoints ?? 0,
    collectionStems: diagnostics?.surfaceStems ?? 0,
    dataSources: viewer.dataSources.length,
    normalPrimitives: viewer.scene.primitives.length,
    groundPrimitives: viewer.scene.groundPrimitives.length,
  };
}

let viewerRef = null;
let layersRef = [];
let layerRef = null;
let gateRef = null;
let collectionByEntityRef = null;
let state = null;
let lifecyclePromise = null;
let teardownPromise = null;
let destroyViewerPromise = null;
let phaseResolve = null;
let disposed = false;
let renderTimeRef = null;
let firstUsablePixelsRef = null;
let settledPixelsRef = null;

function publish(phase, patch = {}) {
  Object.assign(state, patch, { phase });
  statusNode.textContent = phase;
  window.__s54InfrastructureBenefitState = JSON.parse(JSON.stringify(state));
}

async function runActivation() {
  check(state && state.phase === 'ready', 'Measurement is not ready to start.');
  const viewer = viewerRef;
  const layer = layerRef;
  const startedAt = performance.now();
  publish('starting', { activationStartedAt: startedAt });
  const initStartedAt = performance.now();
  await layer.init(viewer);
  const initCompletedAt = performance.now();
  state.initDurationMs = initCompletedAt - initStartedAt;
  try {
    await layer.enable(viewer);
  } catch (error) {
    publish('activation-error', { error: String(error?.stack || error) });
    throw error;
  }
  const sourceReadyAt = performance.now();
  const stats = layer.getStats();
  const diagnostics = layer.getPerformanceDiagnostics();
  const dataSource = viewer.dataSources.getByName(fixtureLayer.layerName)?.[0];
  check(
    dataSource && stats.count > 0 && diagnostics.pendingJobs === 0,
    'Layer enable returned before the source was ready.',
  );
  check(
    dataSource.entities.values.length === fixtureLayer.entityCount &&
      stats.count === fixtureLayer.entityCount,
    `${fixtureLayer.layerName} Entity inventory is incomplete.`,
  );
  const analystRecords = layer.getAnalystRecords(
    dataSource.entities.values.length,
  );
  check(
    analystRecords.length === fixtureLayer.surfaceCount,
    `${fixtureLayer.layerName} analyst surface inventory is incomplete.`,
  );
  const collections = primitiveCollections(viewer, fixtureLayer.layerId);
  const pickRows = dataSource.entities.values.filter(
    (entity) =>
      entity.point || entity.polyline || mode === 'primitive-collections',
  );
  check(
    pickRows.length === fixtureLayer.entityCount,
    'Native pick inventory was unexpectedly truncated.',
  );
  const ownershipRows = createNativeOwnershipRows(
    pickRows,
    analystRecords,
    renderTimeRef,
    fixtureLayer.layerId,
  );
  collectionByEntityRef = null;
  if (collections) {
    const byPoint = new Map();
    for (let index = 0; index < collections.points.length; index++) {
      const point = collections.points.get(index);
      const stem = collections.stems.get(index);
      if (point?.id && point.id === stem?.id)
        byPoint.set(point.id, { point, stem });
    }
    check(
      byPoint.size === fixtureLayer.surfaceCount,
      'Candidate primitive index does not cover every source Entity.',
    );
    collectionByEntityRef = byPoint;
  }
  state.sourceReadyAt = sourceReadyAt;
  state.sourceReadyElapsedMs = sourceReadyAt - startedAt;
  state.sourceReady = {
    count: stats.count,
    entityCount: dataSource.entities.values.length,
    performanceDiagnostics: diagnostics,
  };

  const firstEntity = dataSource.entities.values.find((entity) => {
    const position = entity.position?.getValue(renderTimeRef);
    return position && finitePosition(position);
  });
  check(firstEntity, 'Source has no point position for the fixed camera.');
  const firstPosition = firstEntity.position.getValue(renderTimeRef);
  const anchor = Cesium.Cartographic.fromCartesian(firstPosition);
  check(anchor, 'First source coordinate is not cartographic.');
  state.cameraContract = setInfrastructureFixtureCamera(
    viewer,
    anchor,
    140_000,
    fixtureLayer.layerId,
  );
  publish('awaiting-first-usable-frame');

  const deadline = performance.now() + FRAME_TIMEOUT_MS;
  let usable = null;
  while (!usable && performance.now() < deadline) {
    const framePromise = gateRef.next();
    viewer.scene.requestRender();
    const frame = await framePromise;
    check(!frame.error, frame.error || 'Frame capture failed.');
    const bytes = new Uint8Array(frame.pixels.bytes);
    const frameHash = await sha256(bytes);
    const target = pickTarget(
      viewer,
      pickRows,
      collections,
      renderTimeRef,
      collectionByEntityRef,
      ownershipRows,
      fixtureLayer.layerId,
    );
    const lod = layer.getLodDiagnostics();
    const cameraPosition = [
      viewer.camera.positionWC.x,
      viewer.camera.positionWC.y,
      viewer.camera.positionWC.z,
    ];
    const consumedCameraPosition = lod.cameraPosition;
    const cameraRevisionReady =
      lod.computed === true &&
      lod.geometryDirty === false &&
      Array.isArray(consumedCameraPosition) &&
      consumedCameraPosition.length === 3 &&
      consumedCameraPosition.every(Number.isFinite) &&
      cameraPosition.every(Number.isFinite) &&
      Math.hypot(
        ...cameraPosition.map(
          (value, index) => value - consumedCameraPosition[index],
        ),
      ) <= 1e-6;
    if (
      frame.pixels.changedPixels > 100 &&
      target &&
      lod.computed &&
      lod.active > 0 &&
      cameraRevisionReady &&
      viewer.dataSourceDisplay.ready === true &&
      viewer.scene.globe.tilesLoaded === true
    ) {
      usable = {
        frameNumber: frame.frameNumber,
        completedAt: frame.capturedAt,
        elapsedFromStartMs: frame.capturedAt - startedAt,
        elapsedFromSourceReadyMs: frame.capturedAt - sourceReadyAt,
        pixelSha256: frameHash,
        changedPixels: frame.pixels.changedPixels,
        width: frame.pixels.width,
        height: frame.pixels.height,
        activeLod: lod.active,
        geometryDirty: lod.geometryDirty,
        cameraRevisionReady,
        cameraPosition,
        dataSourcesReady: viewer.dataSourceDisplay.ready,
        globeTilesLoaded: viewer.scene.globe.tilesLoaded,
        target,
      };
      firstUsablePixelsRef = frame.pixels.bytes;
    }
    if (!usable) frame.pixels.bytes = null;
  }
  check(usable, 'No completed frame had visible native point and stem picks.');
  state.firstUsable = usable;
  const resources = sceneResourceCounts(viewer, dataSource);
  state.surfacePopulation = {
    layerId: fixtureLayer.layerId,
    mode,
    statsCount: stats.count,
    entityCount: dataSource.entities.values.length,
    surfaceCount:
      mode === 'entities'
        ? resources.surfaceGraphics
        : resources.collectionPoints,
    resources,
    preservedGraphics: resources.preservedGraphics,
    identitySha256: await sha256(
      new TextEncoder().encode(
        JSON.stringify(
          analystRecords.map((row) => ({
            id: row.sourceRecordId,
            ref: row.evidence?.entityRef?.id,
          })),
        ),
      ),
    ),
  };
  viewer.selectedEntity = dataSource.entities.getById(usable.target.entityId);
  if (fixtureLayer.layerId === 'local-datacenters') {
    usable.selectedEntityIdentity = String(viewer.selectedEntity?.id || '');
    check(
      usable.selectedEntityIdentity === usable.target.stem.entityId,
      'Final datacenter selection did not retain the native stem-hit Entity.',
    );
  }
  await settleVisibleFrame(viewer);
  state.enabledSettledResources = sceneResourceCounts(viewer, dataSource);
  collectionByEntityRef = null;
  publish('enabled-settled');
}

async function settleVisibleFrame(viewer) {
  const hashes = [];
  for (let index = 0; index < 3; index++) {
    const framePromise = gateRef.next();
    viewer.scene.requestRender();
    const frame = await framePromise;
    check(
      !frame.error,
      frame.error || 'Could not settle the enabled renderer.',
    );
    hashes.push(await sha256(new Uint8Array(frame.pixels.bytes)));
    if (index === 2) settledPixelsRef = frame.pixels.bytes;
    else frame.pixels.bytes = null;
  }
  check(
    hashes[1] === hashes[2],
    'Enabled renderer did not reach stable frame pixels.',
  );
  state.settledPixelSha256 = hashes[2];
  state.settledFrameCount = 3;
}

async function destroyLayer() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    if (!viewerRef || disposed) return;
    publish('destroying-layer');
    for (const layer of layersRef) layer.destroy(viewerRef);
    layersRef = [];
    layerRef = null;
    collectionByEntityRef = null;
    const framePromise = gateRef.next();
    viewerRef.scene.requestRender();
    const frame = await framePromise;
    check(!frame.error, frame.error || 'No completed cleanup frame.');
    frame.pixels.bytes = null;
    const resources = sceneResourceCounts(viewerRef, null);
    check(
      resources.dataSources === state.warmup.dataSources &&
        resources.owners === 0 &&
        resources.normalPrimitives === state.warmup.normalPrimitives &&
        resources.groundPrimitives === state.warmup.groundPrimitives,
      'Layer destroy left a data source, primitive, or collection owner attached.',
    );
    state.afterDestroyResources = resources;
    publish('layer-destroyed');
  })();
  return teardownPromise;
}

function releaseLayerReferences() {
  check(
    state?.phase === 'layer-destroyed',
    'Layer references can only be released after layer teardown.',
  );
  layersRef = [];
  layerRef = null;
  collectionByEntityRef = null;
  lifecyclePromise = null;
  teardownPromise = null;
  return { ok: true, released: true };
}

async function destroyViewer() {
  if (destroyViewerPromise) return destroyViewerPromise;
  destroyViewerPromise = (async () => {
    if (state?.phase !== 'layer-destroyed') await destroyLayer();
    gateRef?.close();
    if (viewerRef && !viewerRef.isDestroyed()) viewerRef.destroy();
    viewerRef = null;
    disposed = true;
    publish('viewer-destroyed');
    const finalState = JSON.parse(JSON.stringify(state));
    gateRef = null;
    renderTimeRef = null;
    lifecyclePromise = null;
    teardownPromise = null;
    destroyViewerPromise = null;
    phaseResolve = null;
    state = null;
    window.__s54InfrastructureBenefitState = finalState;
    window.__s54InfrastructureBenefit = null;
    return finalState;
  })();
  return destroyViewerPromise;
}

function effectiveRenderSettings(viewer) {
  const attributes = viewer.scene.context?._gl?.getContextAttributes?.();
  check(attributes, 'WebGL context attributes are unavailable.');
  const contextAttributes = Object.fromEntries(
    [
      'alpha',
      'antialias',
      'depth',
      'premultipliedAlpha',
      'preserveDrawingBuffer',
      'stencil',
    ].map((key) => [key, attributes[key]]),
  );
  check(
    Object.values(contextAttributes).every(
      (value) => typeof value === 'boolean',
    ),
    'WebGL context attributes are incomplete.',
  );
  const settings = {
    width: innerWidth,
    height: innerHeight,
    canvasCssWidth: viewer.scene.canvas.clientWidth,
    canvasCssHeight: viewer.scene.canvas.clientHeight,
    devicePixelRatio,
    resolutionScale: viewer.resolutionScale,
    drawingBufferWidth: viewer.scene.canvas.width,
    drawingBufferHeight: viewer.scene.canvas.height,
    requestRenderMode: viewer.scene.requestRenderMode,
    maximumRenderTimeChange: String(viewer.scene.maximumRenderTimeChange),
    msaaSamples: viewer.scene.msaaSamples,
    contextAttributes,
    globeLighting: viewer.scene.globe.enableLighting,
  };
  check(
    [
      settings.canvasCssWidth,
      settings.canvasCssHeight,
      settings.drawingBufferWidth,
      settings.drawingBufferHeight,
      settings.resolutionScale,
    ].every((value) => Number.isFinite(value) && value > 0) &&
      Number.isSafeInteger(settings.msaaSamples) &&
      settings.msaaSamples >= 0,
    'Effective render dimensions or sample count are invalid.',
  );
  check(
    settings.contextAttributes.preserveDrawingBuffer,
    'WebGL did not enable the requested preserved drawing buffer.',
  );
  return settings;
}

async function prepare() {
  check(
    acceptedModes.has(mode),
    'Select mode=entities or mode=primitive-collections.',
  );
  check(
    /^[a-f0-9]{40}$/.test(__GEV_APP_COMMIT__),
    'Exact app commit is missing.',
  );
  const source = await readSourceIdentity(fixtureLayer);
  const renderTime = params.has('epoch')
    ? Cesium.JulianDate.fromIso8601(params.get('epoch'))
    : Cesium.JulianDate.now();
  renderTimeRef = Cesium.JulianDate.clone(renderTime);
  viewerRef = createApplicationViewer({
    container,
    creditContainer: document.querySelector('#credits'),
    preserveDrawingBuffer: true,
  });
  const viewer = viewerRef;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  viewer.scene.globe.show = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.skyBox.show = false;
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.clone(renderTime);
  await warmDataSourceDisplay(viewer);
  gateRef = createFrameGate(viewer);
  layersRef = createInfrastructureLayers({
    ...localGeoJsonServices,
    ...(mode === 'primitive-collections'
      ? { datacenterSurfaceRenderer: mode }
      : {}),
  });
  layerRef = layersRef.find((layer) => layer.id === fixtureLayer.layerId);
  check(
    layerRef,
    `Production ${fixtureLayer.layerName} layer was not constructed.`,
  );
  state = {
    schema: 'gev-infrastructure-benefit-trial/v1',
    status: 'ready',
    phase: 'ready',
    applicationCommit: __GEV_APP_COMMIT__,
    mode,
    layerId: fixtureLayer.layerId,
    source,
    renderTime: {
      iso: Cesium.JulianDate.toIso8601(renderTime, 3),
      dayNumber: renderTime.dayNumber,
      secondsOfDay: renderTime.secondsOfDay,
      shouldAnimate: viewer.clock.shouldAnimate,
    },
    settings: effectiveRenderSettings(viewer),
    environment: {
      ...(await readPerformanceEnvironment({
        viewer,
        appCommit: __GEV_APP_COMMIT__,
        harnessCommit: __GEV_APP_COMMIT__,
      })),
      cesiumVersion: Cesium.VERSION,
    },
    warmup: {
      normalPrimitives: viewer.scene.primitives.length,
      groundPrimitives: viewer.scene.groundPrimitives.length,
      dataSources: viewer.dataSources.length,
    },
  };
  window.__s54InfrastructureBenefit = {
    start() {
      if (!lifecyclePromise)
        lifecyclePromise = runActivation().catch((error) => {
          if (!disposed)
            publish('activation-error', {
              error: String(error?.stack || error),
            });
          throw error;
        });
      return true;
    },
    async destroyLayer() {
      try {
        await destroyLayer();
        return { ok: true, state: JSON.parse(JSON.stringify(state)) };
      } catch (error) {
        publish('destroy-error', { error: String(error?.stack || error) });
        throw error;
      }
    },
    releaseLayerReferences() {
      try {
        return releaseLayerReferences();
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
    exportImageArtifacts() {
      check(
        state?.phase === 'enabled-settled',
        'Image artifacts are available after activation settles.',
      );
      check(
        firstUsablePixelsRef && settledPixelsRef,
        'First-usable or settled-frame pixels were not retained.',
      );
      const dimensions = {
        width: state.firstUsable.width,
        height: state.firstUsable.height,
      };
      try {
        return {
          firstUsablePng: pngDataUrl(
            firstUsablePixelsRef,
            dimensions.width,
            dimensions.height,
          ),
          settledPng: pngDataUrl(
            settledPixelsRef,
            dimensions.width,
            dimensions.height,
          ),
          ...dimensions,
          buffersReleased: true,
        };
      } finally {
        firstUsablePixelsRef = null;
        settledPixelsRef = null;
      }
    },
    async destroyViewer() {
      try {
        const finalState = await destroyViewer();
        return {
          ok: true,
          state: finalState,
          referencesReleased: true,
        };
      } catch (error) {
        publish('viewer-destroy-error', {
          error: String(error?.stack || error),
        });
        throw error;
      }
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
  };
  publish('ready');
}

try {
  await prepare();
} catch (error) {
  const failure = {
    schema: 'gev-infrastructure-benefit-trial/v1',
    status: 'failed',
    phase: 'prepare',
    applicationCommit: __GEV_APP_COMMIT__,
    mode,
    error: String(error?.stack || error),
  };
  outputNode.textContent = JSON.stringify(failure);
  statusNode.textContent = 'failed';
  window.__s54InfrastructureBenefitState = failure;
}
