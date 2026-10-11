import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createBundledCableSource } from '../../src/layers/submarineCables/bundledSource.js';
import { featureReference } from '../../src/layers/submarineCables/geometry.js';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  CABLE_REFERENCE_RENDER_CASES,
  CABLE_REFERENCE_RENDER_POPULATION,
  CABLE_REFERENCE_RENDER_SAMPLES,
  CABLE_REFERENCE_RENDER_SCHEMA,
} from './cable-reference-collections-contract.mjs';

const EXPECTED_COMMIT = __GEV_APP_COMMIT__;
const FIXED_ISO = '2026-10-11T12:34:56.000Z';
const READINESS_TIMEOUT_MS = 180_000;
const STABLE_TIMEOUT_MS = 12_000;
const SAMPLE_TIMEOUT_MS = 3_000;
const CASES = Object.freeze({
  'default-style': { targetKind: 'landing-point', rangeMeters: 120_000 },
  'camera-change': { targetKind: 'cable', rangeMeters: 180_000 },
});
const FIXTURE_PIXEL_MARGIN = 10;
const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const outputNode = document.querySelector('#result');
const viewerContainer = document.querySelector('#viewer');
const creditsContainer = document.querySelector('#credits');
let lastReport = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSha(value, label) {
  assert(/^[a-f0-9]{64}$/.test(value || ''), `${label} is not SHA-256.`);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function shaJson(value) {
  return sha256(new TextEncoder().encode(JSON.stringify(value)));
}

async function readBundledJson(file) {
  const url = new URL(
    `../../src/data/local_data/telegeography_submarine_cables/${file}`,
    import.meta.url,
  );
  const response = await fetch(url, { cache: 'force-cache' });
  assert(response.ok, `Bundled ${file} returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  assert(
    bytes.byteLength > 0 && bytes.byteLength < 20_000_000,
    `${file} is empty or oversized.`,
  );
  return {
    json: JSON.parse(new TextDecoder().decode(bytes)),
    sha256: await sha256(bytes),
    byteLength: bytes.byteLength,
  };
}

function normalizedSourceId(feature, kind, index) {
  return String(feature?.properties?.id || feature?.id || `${kind}-${index}`);
}

function makeSourceRecords(cables, landings) {
  return [
    ...cables.features.map((feature, index) => ({
      kind: 'cable',
      id: normalizedSourceId(feature, 'cable', index),
      feature,
    })),
    ...landings.features.map((feature, index) => ({
      kind: 'landing-point',
      id: normalizedSourceId(feature, 'landing', index),
      feature,
    })),
  ];
}

function parseReferenceEntityId(id) {
  const match = /^(cable|landing-point)-reference-(\d+)-(.+)$/.exec(id || '');
  if (!match) return null;
  return {
    kind: match[1],
    sourceOrdinal: Number(match[2]),
    sourceRecordId: match[3],
  };
}

function propertyValue(property, time) {
  return typeof property?.getValue === 'function'
    ? property.getValue(time)
    : property;
}

function xyz(value) {
  if (!value) return null;
  return [value.x, value.y, value.z];
}

function positions(value, time) {
  const resolved = propertyValue(value, time);
  return Array.isArray(resolved) ? resolved.map(xyz) : null;
}

function rgbaBytes(color) {
  const resolved = propertyValue(color);
  if (!resolved) return null;
  return [...resolved.toBytes()];
}

function enumName(enumObject, value) {
  return (
    Object.entries(enumObject).find(
      ([, candidate]) => candidate === value,
    )?.[0] || String(value)
  );
}

function dataSource(viewer, name) {
  const matches = viewer.dataSources.getByName(name);
  assert(matches.length === 1, `Expected one ${name} DataSource.`);
  return matches[0];
}

function findReferenceCollections(viewer, entityIds) {
  const expectedIds = new Set(entityIds);
  let points = null;
  let stems = null;
  for (let index = 0; index < viewer.scene.primitives.length; index += 1) {
    const primitive = viewer.scene.primitives.get(index);
    const isPoints = primitive instanceof Cesium.PointPrimitiveCollection;
    const isStems = primitive instanceof Cesium.PolylineCollection;
    if ((!isPoints && !isStems) || primitive.length !== expectedIds.size)
      continue;
    const ids = new Set();
    for (let itemIndex = 0; itemIndex < primitive.length; itemIndex += 1) {
      const entityId = primitive.get(itemIndex)?.id?.id;
      if (!expectedIds.has(entityId) || ids.has(entityId)) break;
      ids.add(entityId);
    }
    if (ids.size !== expectedIds.size) continue;
    if (isPoints) {
      assert(
        points === null,
        'More than one cable reference point collection exists.',
      );
      points = primitive;
    } else {
      assert(
        stems === null,
        'More than one cable reference stem collection exists.',
      );
      stems = primitive;
    }
  }
  return { points, stems };
}

function readReferenceItems(viewer, layer, mode, sourceRecords) {
  const referenceSource = dataSource(viewer, 'TeleGeography Cable References');
  const entities = referenceSource.entities.values;
  assert(
    entities.length === CABLE_REFERENCE_RENDER_POPULATION.referenceRecords,
    'Reference metadata Entity population changed.',
  );
  const collections =
    mode === 'collections'
      ? layer.__fixtureCollections ||
        findReferenceCollections(
          viewer,
          entities.map((entity) => entity.id),
        )
      : { points: null, stems: null };
  if (mode === 'collections')
    assert(
      collections.points && collections.stems,
      'Owned reference collections are missing.',
    );
  const pointById = new Map();
  const stemById = new Map();
  if (collections.points) {
    for (let index = 0; index < collections.points.length; index += 1) {
      const primitive = collections.points.get(index);
      assert(
        primitive?.id?.id,
        'A collection point lost its metadata Entity ID.',
      );
      pointById.set(primitive.id.id, primitive);
    }
  }
  if (collections.stems) {
    for (let index = 0; index < collections.stems.length; index += 1) {
      const primitive = collections.stems.get(index);
      assert(
        primitive?.id?.id,
        'A collection stem lost its metadata Entity ID.',
      );
      stemById.set(primitive.id.id, primitive);
    }
  }
  const items = entities.map((entity, index) => {
    const identity = parseReferenceEntityId(entity.id);
    assert(identity, `Malformed reference Entity ID ${entity.id}.`);
    const expected = sourceRecords[identity.sourceOrdinal];
    assert(expected, `Reference Entity ${entity.id} has no source ordinal.`);
    assert(
      identity.kind === expected.kind &&
        identity.sourceRecordId === expected.id,
      `Reference Entity ${entity.id} does not map to its source record.`,
    );
    const point = collections.points ? pointById.get(entity.id) : entity.point;
    const stem = collections.stems ? stemById.get(entity.id) : entity.polyline;
    assert(
      point && stem,
      `Reference ${entity.id} is missing point or stem ownership.`,
    );
    const currentTime = viewer.clock.currentTime;
    const pointPosition = collections.points
      ? point.position
      : propertyValue(entity.position, currentTime);
    const stemPositions = collections.stems
      ? stem.positions.map(xyz)
      : positions(stem.positions, currentTime);
    const pointColor = collections.points
      ? point.color
      : propertyValue(point.color, currentTime);
    const outlineColor = collections.points
      ? point.outlineColor
      : propertyValue(point.outlineColor, currentTime);
    const stemMaterial = collections.stems
      ? stem.material?.uniforms?.color
      : propertyValue(stem.material, currentTime)?.color;
    const rendererShown = collections.points
      ? collections.points.show && collections.stems.show
      : referenceSource.show;
    const pointShow = Boolean(
      rendererShown &&
      entity.show &&
      propertyValue(point.show, currentTime) !== false,
    );
    const stemShow = Boolean(
      rendererShown &&
      entity.show &&
      propertyValue(stem.show, currentTime) !== false,
    );
    return {
      entity,
      entityId: entity.id,
      sourceOrdinal: identity.sourceOrdinal,
      sourceKind: identity.kind,
      sourceRecordId: identity.sourceRecordId,
      pointObject: point,
      stemObject: stem,
      pointPosition,
      stemPositions,
      visible: pointShow && stemShow,
      pointStyle: {
        pixelSize: propertyValue(point.pixelSize, currentTime),
        colorBytes: rgbaBytes(pointColor),
        outlineColorBytes: rgbaBytes(outlineColor),
        outlineWidth: propertyValue(point.outlineWidth, currentTime),
        disableDepthTestDistance: propertyValue(
          point.disableDepthTestDistance,
          currentTime,
        ),
        show: pointShow,
      },
      stemStyle: {
        width: propertyValue(stem.width, currentTime),
        colorBytes: rgbaBytes(stemMaterial),
        show: stemShow,
      },
      index,
    };
  });
  assert(
    pointById.size === (collections.points ? entities.length : 0) &&
      stemById.size === (collections.stems ? entities.length : 0),
    'Collection ownership does not cover every reference Entity exactly once.',
  );
  return { source: referenceSource, entities, items, collections };
}

function readSourceGeometry(cableSource, landingSource, time) {
  const cableRows = cableSource.entities.values.map((entity) => ({
    id: entity.id,
    show: entity.show,
    positions: positions(entity.polyline?.positions, time),
    classification: entity.polyline
      ? enumName(
          Cesium.ClassificationType,
          propertyValue(entity.polyline.classificationType, time),
        )
      : null,
    width: propertyValue(entity.polyline?.width, time),
    colorBytes: rgbaBytes(
      propertyValue(entity.polyline?.material, time)?.color,
    ),
    clampToGround: propertyValue(entity.polyline?.clampToGround, time),
  }));
  const landingRows = landingSource.entities.values.map((entity) => ({
    id: entity.id,
    show: entity.show,
    position: xyz(propertyValue(entity.position, time)),
    billboard: entity.billboard
      ? {
          show: propertyValue(entity.billboard.show, time),
          colorBytes: rgbaBytes(entity.billboard.color),
          heightReference: enumName(
            Cesium.HeightReference,
            propertyValue(entity.billboard.heightReference, time),
          ),
          pixelSize: propertyValue(entity.billboard.pixelSize, time),
          scale: propertyValue(entity.billboard.scale, time),
        }
      : null,
  }));
  return { cableRows, landingRows };
}

function sceneSignature(viewer, layer, mode, sourceRecords) {
  const cableSource = dataSource(viewer, 'TeleGeography Submarine Cables');
  const landingSource = dataSource(viewer, 'TeleGeography Landing Points');
  const refs = readReferenceItems(viewer, layer, mode, sourceRecords);
  const geometry = readSourceGeometry(
    cableSource,
    landingSource,
    viewer.clock.currentTime,
  );
  return JSON.stringify({
    camera: cameraVector(viewer),
    refs: refs.items.map((item) => ({
      id: item.entityId,
      show: item.visible,
      point: xyz(item.pointPosition),
      stem: item.stemPositions,
    })),
    geometry,
    overlay: layer.__fixtureOverlay.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      priority: entry.priority,
      position: xyz(entry.position),
    })),
  });
}

function cameraVector(viewer) {
  return {
    position: xyz(viewer.camera.positionWC),
    direction: xyz(viewer.camera.directionWC),
    up: xyz(viewer.camera.upWC),
  };
}

function waitForPostRender(viewer, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    let timer;
    let remove;
    const onRender = () => {
      clearTimeout(timer);
      remove?.();
      resolve();
    };
    try {
      const unsubscribe = viewer.scene.postRender.addEventListener(onRender);
      remove =
        typeof unsubscribe === 'function'
          ? unsubscribe
          : () => viewer.scene.postRender.removeEventListener(onRender);
      timer = setTimeout(() => {
        remove?.();
        reject(
          new Error('Timed out waiting for a completed cable scene frame.'),
        );
      }, timeoutMs);
      viewer.scene.requestRender();
    } catch (error) {
      clearTimeout(timer);
      remove?.();
      reject(error);
    }
  });
}

async function waitForPopulation(viewer, layer, sourceRecords) {
  const deadline = performance.now() + READINESS_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await waitForPostRender(viewer, 1000);
    const stats = layer.getStats();
    const diagnostics = layer.getPerformanceDiagnostics();
    if (
      !stats.loading &&
      stats.error === null &&
      stats.count ===
        CABLE_REFERENCE_RENDER_POPULATION.cableFeatures +
          CABLE_REFERENCE_RENDER_POPULATION.landingFeatures &&
      viewer.dataSources.getByName('TeleGeography Submarine Cables').length ===
        1 &&
      viewer.dataSources.getByName('TeleGeography Landing Points').length ===
        1 &&
      viewer.dataSources.getByName('TeleGeography Cable References').length ===
        1 &&
      diagnostics.referencePointPrimitives +
        (diagnostics.referenceRenderer === 'entities'
          ? CABLE_REFERENCE_RENDER_POPULATION.referenceRecords
          : 0) ===
        CABLE_REFERENCE_RENDER_POPULATION.referenceRecords &&
      sourceRecords.length ===
        CABLE_REFERENCE_RENDER_POPULATION.referenceRecords &&
      viewer.dataSourceDisplay.ready === true &&
      viewer.scene.globe.tilesLoaded === true
    )
      return;
  }
  throw new Error('Bundled cable population/readiness deadline expired.');
}

async function waitForStableScene(viewer, layer, mode, sourceRecords) {
  const deadline = performance.now() + STABLE_TIMEOUT_MS;
  let previous = null;
  let stableFrames = 0;
  while (performance.now() < deadline) {
    await waitForPostRender(viewer, 1000);
    if (
      viewer.dataSourceDisplay.ready !== true ||
      viewer.scene.globe.tilesLoaded !== true
    ) {
      previous = null;
      stableFrames = 0;
      continue;
    }
    const next = sceneSignature(viewer, layer, mode, sourceRecords);
    if (next === previous) stableFrames += 1;
    else stableFrames = 0;
    previous = next;
    if (stableFrames >= 3) return stableFrames + 1;
  }
  throw new Error('Cable scene did not reach three stable completed frames.');
}

function setMapStack(viewer, mapEvents, activeId) {
  viewer.scene.globe.show = activeId !== 'photoreal';
  mapEvents.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId } }),
  );
}

function resetView(viewer, target, rangeMeters) {
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(0, -Math.PI / 3, rangeMeters),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

async function flyToCameraCase(viewer, target, rangeMeters) {
  const start = {
    destination: Cesium.Cartesian3.clone(viewer.camera.positionWC),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    },
  };
  resetView(viewer, target, rangeMeters);
  const destination = Cesium.Cartesian3.clone(viewer.camera.positionWC);
  const orientation = {
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
    roll: viewer.camera.roll,
  };
  viewer.camera.setView(start);
  await new Promise((resolve, reject) => {
    viewer.camera.flyTo({
      destination,
      orientation,
      duration: 0.65,
      complete: resolve,
      cancel: () => reject(new Error('Camera change flight was cancelled.')),
    });
  });
}

function worldToScreen(viewer, position) {
  const result = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    position,
  );
  if (!result) return null;
  // SceneTransforms uses the drawing canvas viewport origin (0, 0), and
  // scene.pick expects the same canvas-relative coordinates.
  return [result.x, result.y];
}

function pickedEntity(picked) {
  if (
    picked?.id &&
    typeof picked.id === 'object' &&
    typeof picked.id.id === 'string'
  )
    return picked.id;
  const primitiveId = picked?.primitive?.id;
  if (
    primitiveId &&
    typeof primitiveId === 'object' &&
    typeof primitiveId.id === 'string'
  )
    return primitiveId;
  return null;
}

function probePick(viewer, screen, referencesById, kind) {
  const offsets =
    kind === 'point'
      ? [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ]
      : [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
  for (const [dx, dy] of offsets) {
    const x = screen[0] + dx;
    const y = screen[1] + dy;
    const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
    const entity = pickedEntity(picked);
    const owner = entity && referencesById.get(entity.id);
    if (!owner || owner.entity !== entity) continue;
    const primitiveType = picked.primitive?.constructor?.name || 'unknown';
    const appearanceType =
      picked.primitive?.appearance?.constructor?.name || null;
    if (kind === 'point' && primitiveType !== 'PointPrimitive') continue;
    if (
      kind === 'stem' &&
      primitiveType !== 'Polyline' &&
      primitiveType !== 'PolylineCollection' &&
      !(
        primitiveType === 'Primitive' &&
        appearanceType === 'PolylineColorAppearance'
      )
    )
      continue;
    return {
      owner,
      screen: [x, y],
      primitiveType,
      appearanceType,
      ownerVerified: true,
      picked,
    };
  }
  return null;
}

function nativeTargets(viewer, layer, mode, sourceRecords, expected = null) {
  const references = readReferenceItems(viewer, layer, mode, sourceRecords);
  const width = viewer.scene.canvas.clientWidth;
  const height = viewer.scene.canvas.clientHeight;
  const referencesById = new Map(
    references.items.map((item) => [item.entityId, item]),
  );
  let point = null;
  for (const item of references.items) {
    if (!item.visible || !item.pointPosition || !item.stemPositions?.length)
      continue;
    const pointScreen = worldToScreen(viewer, item.pointPosition);
    if (
      !pointScreen ||
      pointScreen[0] < FIXTURE_PIXEL_MARGIN ||
      pointScreen[0] >= width - FIXTURE_PIXEL_MARGIN ||
      pointScreen[1] < FIXTURE_PIXEL_MARGIN ||
      pointScreen[1] >= height - FIXTURE_PIXEL_MARGIN
    )
      continue;
    const pointHit = probePick(viewer, pointScreen, referencesById, 'point');
    if (
      pointHit &&
      (!expected || pointHit.owner.entityId === expected.point.entityId)
    ) {
      point = pointHit;
      break;
    }
  }
  let stem = null;
  for (const item of references.items) {
    if (!item.visible || !item.pointPosition || !item.stemPositions?.length)
      continue;
    const [base, tip] = item.stemPositions;
    for (const fraction of [0.35, 0.55, 0.75]) {
      const sample = Cesium.Cartesian3.lerp(
        new Cesium.Cartesian3(...base),
        new Cesium.Cartesian3(...tip),
        fraction,
        new Cesium.Cartesian3(),
      );
      const stemScreen = worldToScreen(viewer, sample);
      if (!stemScreen) continue;
      const stemHit = probePick(viewer, stemScreen, referencesById, 'stem');
      if (
        stemHit &&
        (!expected || stemHit.owner.entityId === expected.stem.entityId)
      ) {
        stem = stemHit;
        break;
      }
    }
    if (stem) break;
  }
  if (!point || !stem) return null;
  return {
    pointOwner: point.owner,
    stemOwner: stem.owner,
    point: { ...point, kind: 'point' },
    stem: { ...stem, kind: 'stem' },
  };
}

function cleanPick(pick, source) {
  return {
    kind: pick.kind,
    sourceKind: source.sourceKind,
    entityId: source.entityId,
    sourceRecordId: source.sourceRecordId,
    sourceOrdinal: source.sourceOrdinal,
    primitiveType: pick.primitiveType,
    appearanceType: pick.appearanceType,
    screen: pick.screen,
    ownerVerified: pick.ownerVerified,
  };
}

function cameraContract(viewer, target, caseId, rangeMeters) {
  const cartographic = Cesium.Cartographic.fromCartesian(target);
  return {
    caseId,
    targetCartographic: [
      cartographic.longitude,
      cartographic.latitude,
      cartographic.height,
    ],
    rangeMeters,
    headingRadians: 0,
    pitchRadians: -Math.PI / 3,
    restoredTransform: 'IDENTITY',
    actualCamera: cameraVector(viewer),
  };
}

function sourceClassification(dataSource, time) {
  const values = dataSource.entities.values
    .filter((entity) => entity.polyline)
    .map((entity) =>
      enumName(
        Cesium.ClassificationType,
        propertyValue(entity.polyline.classificationType, time),
      ),
    );
  return [...new Set(values)].sort();
}

async function capturePixels(viewer) {
  const canvas = await captureFreshCesiumFrame(viewer, {
    timeoutMs: SAMPLE_TIMEOUT_MS,
  });
  assert(canvas, 'A fresh copied cable frame could not be captured.');
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    assert(context, 'Copied frame does not expose a readback context.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgba = new Uint8Array(pixels);
    const pixelSha256 = await sha256(rgba);
    const pngBase64 = canvas.toDataURL('image/png').split(',')[1] || '';
    assert(
      pngBase64.length > 0 && pngBase64.length <= 4_000_000,
      'PNG output is empty or oversized.',
    );
    return {
      rgba,
      pixelSha256,
      pngBase64,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function sourceGeometryEvidence(viewer, mode, layer, sourceRecords) {
  const cableSource = dataSource(viewer, 'TeleGeography Submarine Cables');
  const landingSource = dataSource(viewer, 'TeleGeography Landing Points');
  const referenceData = readReferenceItems(viewer, layer, mode, sourceRecords);
  const sourceGeometry = readSourceGeometry(
    cableSource,
    landingSource,
    viewer.clock.currentTime,
  );
  const referenceGeometry = referenceData.items.map((item) => ({
    sourceOrdinal: item.sourceOrdinal,
    sourceKind: item.sourceKind,
    sourceRecordId: item.sourceRecordId,
    entityId: item.entityId,
    pointPosition: xyz(item.pointPosition),
    stemPositions: item.stemPositions,
    effectiveVisible: item.visible,
  }));
  const referenceStyles = referenceData.items.map((item) => ({
    entityId: item.entityId,
    sourceOrdinal: item.sourceOrdinal,
    sourceKind: item.sourceKind,
    point: item.pointStyle,
    stem: item.stemStyle,
  }));
  const sourceIds = {
    cableEntities: cableSource.entities.values.map((entity) => entity.id),
    landingEntities: landingSource.entities.values.map((entity) => entity.id),
    referenceEntities: referenceData.entities.map((entity) => entity.id),
  };
  return {
    sourceGeometry,
    referenceGeometry,
    referenceStyles,
    sourceIds,
    referenceData,
  };
}

function createOverlayHost() {
  return {
    entries: [],
    sourceId: null,
    visible: false,
    clearSource(sourceId) {
      this.sourceId = sourceId;
      this.entries = [];
      this.visible = false;
    },
    setEntries(sourceId, entries) {
      this.sourceId = sourceId;
      this.entries = entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        priority: entry.priority,
        position: xyz(entry.position),
        variant: entry.variant,
        collisionGroup: entry.collisionGroup,
        interactive: entry.interactive,
      }));
    },
    setVisible(sourceId, visible) {
      this.sourceId = sourceId;
      this.visible = Boolean(visible);
    },
  };
}

function viewerSettings(viewer) {
  const gl = viewer.scene.context?._gl;
  const attributes = gl?.getContextAttributes?.() || null;
  return {
    sceneMode: enumName(Cesium.SceneMode, viewer.scene.mode),
    globeShown: viewer.scene.globe.show,
    terrainProvider: viewer.terrainProvider?.constructor?.name || null,
    requestRenderMode: viewer.scene.requestRenderMode,
    resolutionScale: viewer.resolutionScale,
    msaaSamples:
      viewer.scene.context?.msaaSamples ?? viewer.scene.msaaSamples ?? null,
    preserveDrawingBuffer: attributes?.preserveDrawingBuffer ?? null,
    antialias: attributes?.antialias ?? null,
    webglVersion: gl?.getParameter?.(gl.VERSION) || null,
  };
}

function makeReport() {
  return {
    schema: CABLE_REFERENCE_RENDER_SCHEMA,
    applicationCommit: EXPECTED_COMMIT,
    harnessCommit: EXPECTED_COMMIT,
    status: 'pending',
    failedPhase: null,
    error: null,
    source: null,
    renderClock: {
      iso: FIXED_ISO,
      shouldAnimate: false,
    },
    viewer: null,
    settings: null,
    environment: null,
    lifetimes: [],
    comparisons: [],
  };
}

async function sourceDigests(cables, landings, cableHash, landingHash) {
  const records = makeSourceRecords(cables, landings);
  assert(
    records.length === CABLE_REFERENCE_RENDER_POPULATION.referenceRecords,
    'Bundled feature identities do not match the complete source population.',
  );
  assert(
    cables.features.length === CABLE_REFERENCE_RENDER_POPULATION.cableFeatures,
    'Cable feature count changed.',
  );
  assert(
    landings.features.length ===
      CABLE_REFERENCE_RENDER_POPULATION.landingFeatures,
    'Landing feature count changed.',
  );
  const identitySha256 = await shaJson(
    records.map(({ kind, id }, sourceOrdinal) => ({
      kind,
      id,
      sourceOrdinal,
    })),
  );
  return {
    records,
    identitySha256,
    report: {
      population: { ...CABLE_REFERENCE_RENDER_POPULATION },
      cableGeoSha256: cableHash,
      landingGeoSha256: landingHash,
      identitySha256,
    },
  };
}

function setFixedViewerClock(viewer) {
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(FIXED_ISO);
  viewer.clock.shouldAnimate = false;
}

function createFixtureViewer(target) {
  const viewer = createApplicationViewer({
    container: viewerContainer,
    creditContainer: creditsContainer,
    preserveDrawingBuffer: true,
  });
  viewer.resize();
  viewer.scene.globe.show = true;
  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  viewer.scene.requestRenderMode = false;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  setFixedViewerClock(viewer);
  resetView(viewer, target, CASES['default-style'].rangeMeters);
  viewer.targetFrameRate = 60;
  viewer.scene.requestRender();
  return viewer;
}

async function mapStackWitness(viewer, mapEvents, layer) {
  const cableSource = dataSource(viewer, 'TeleGeography Submarine Cables');
  setMapStack(viewer, mapEvents, 'photoreal');
  await waitForPostRender(viewer);
  await waitForStableScene(
    viewer,
    layer,
    layer.__fixtureMode,
    layer.__fixtureRecords,
  );
  const photoreal = sourceClassification(cableSource, viewer.clock.currentTime);
  setMapStack(viewer, mapEvents, 'osm');
  await waitForPostRender(viewer);
  await waitForStableScene(
    viewer,
    layer,
    layer.__fixtureMode,
    layer.__fixtureRecords,
  );
  const terrain = sourceClassification(cableSource, viewer.clock.currentTime);
  assert(
    photoreal.length === 1 && photoreal[0] === 'CESIUM_3D_TILE',
    'Photoreal map-stack classification was not applied.',
  );
  assert(
    terrain.length === 1 && terrain[0] === 'TERRAIN',
    'Globe map-stack classification was not restored.',
  );
  return { photoreal: photoreal[0], afterRestore: terrain[0] };
}

async function runLifetime({
  viewer,
  mode,
  activationOrder,
  sourceRecords,
  sourceManifestSha256,
  targets,
  report,
}) {
  const overlay = createOverlayHost();
  const mapEvents = new EventTarget();
  const source = createBundledCableSource();
  const baselineDataSources = viewer.dataSources.length;
  const layer = createSubmarineCableLayer({
    source,
    overlayHost: overlay,
    mapStackEventTarget: mapEvents,
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    sweepClock: () => performance.now(),
    referenceRenderer: mode === 'collections' ? 'collections' : 'entities',
  });
  layer.__fixtureMode = mode;
  layer.__fixtureRecords = sourceRecords;
  layer.__fixtureOverlay = overlay;
  const lifetime = {
    mode,
    activationOrder,
    status: 'running',
    population: null,
    sourceIdentitySha256: null,
    sourceManifestSha256,
    viewerSettingsSha256: null,
    viewerEnvironmentSha256: null,
    geometrySha256: null,
    styleSha256: null,
    overlaySha256: null,
    ownership: null,
    teardown: null,
    samples: [],
  };
  const ownedCollectionLifetimes = [];
  report.lifetimes.push(lifetime);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await waitForPopulation(viewer, layer, sourceRecords);
    const data = {
      cable: dataSource(viewer, 'TeleGeography Submarine Cables'),
      landing: dataSource(viewer, 'TeleGeography Landing Points'),
      reference: dataSource(viewer, 'TeleGeography Cable References'),
    };
    const refs = readReferenceItems(viewer, layer, mode, sourceRecords);
    if (mode === 'collections') {
      layer.__fixtureCollections = findReferenceCollections(
        viewer,
        refs.entities.map((entity) => entity.id),
      );
      ownedCollectionLifetimes.push(layer.__fixtureCollections);
    }
    const cableSegments = data.cable.entities.values.filter((entity) =>
      Boolean(entity.polyline),
    ).length;
    const landingBillboards = data.landing.entities.values.filter((entity) =>
      Boolean(entity.billboard),
    ).length;
    assert(
      cableSegments === CABLE_REFERENCE_RENDER_POPULATION.cableSegments,
      'Ground cable segment population changed.',
    );
    assert(
      landingBillboards === CABLE_REFERENCE_RENDER_POPULATION.landingBillboards,
      'Clamped landing billboard population changed.',
    );
    assert(
      refs.items.every((item, index) => item.sourceOrdinal === index),
      'Reference source order/identity mapping changed.',
    );
    if (mode === 'entities') {
      assert(
        refs.items.every((item) => item.entity.point && item.entity.polyline),
        'Default Entity reference graphics are missing.',
      );
    } else {
      assert(
        refs.items.every((item) => !item.entity.point && !item.entity.polyline),
        'Collection mode retained duplicate reference Graphics.',
      );
    }
    const diagnostic = layer.getPerformanceDiagnostics();
    assert(
      diagnostic.referenceRecords === undefined ||
        diagnostic.referenceRecords === 2629,
      'Reference diagnostic record count is invalid.',
    );
    lifetime.population = {
      ...CABLE_REFERENCE_RENDER_POPULATION,
      cableSegments,
      landingBillboards,
    };
    lifetime.ownership = {
      baselineDataSources,
      activeDataSources: viewer.dataSources.length,
      referenceGraphics: mode === 'entities' ? 2629 * 2 : 0,
      referenceCollections: diagnostic.referenceCollections,
      referencePoints: diagnostic.referencePointPrimitives,
      referenceStems: diagnostic.referenceStemPrimitives,
    };
    assert(
      lifetime.ownership.activeDataSources === baselineDataSources + 3,
      'Cable layer did not own exactly three DataSources.',
    );

    const sourceGeometryHash = async () => {
      const view = sourceGeometryEvidence(viewer, mode, layer, sourceRecords);
      return {
        view,
        geometrySha256: await shaJson({
          sourceGeometry: view.sourceGeometry,
          referenceGeometry: view.referenceGeometry,
        }),
        styleSha256: await shaJson({
          cableRows: view.sourceGeometry.cableRows.map((row) => ({
            id: row.id,
            show: row.show,
            classification: row.classification,
            width: row.width,
            colorBytes: row.colorBytes,
            clampToGround: row.clampToGround,
          })),
          landingRows: view.sourceGeometry.landingRows,
          referenceStyles: view.referenceStyles,
        }),
        sourceIdentitySha256: await shaJson({
          sourceRecords: sourceRecords.map(({ kind, id }, sourceOrdinal) => ({
            kind,
            id,
            sourceOrdinal,
          })),
          surfaceEntityIds: view.sourceIds,
          referenceEntityIds: view.referenceGeometry.map((row) => ({
            sourceOrdinal: row.sourceOrdinal,
            sourceKind: row.sourceKind,
            sourceRecordId: row.sourceRecordId,
            entityId: row.entityId,
          })),
        }),
        overlaySha256: await shaJson(overlay.entries),
      };
    };

    // Warm the lazy EntityCluster collections and exercise both real map-stack
    // classifications before capturing the common terrain-visible state.
    const mapClassification = await mapStackWitness(viewer, mapEvents, layer);
    await waitForStableScene(viewer, layer, mode, sourceRecords);

    const hashes = await sourceGeometryHash();
    lifetime.sourceIdentitySha256 = hashes.sourceIdentitySha256;
    lifetime.geometrySha256 = hashes.geometrySha256;
    lifetime.styleSha256 = hashes.styleSha256;
    lifetime.overlaySha256 = hashes.overlaySha256;
    const startingCamera = cameraVector(viewer);
    const caseTargets = {
      'default-style': targets.default,
      'camera-change': targets.cameraChange,
    };
    const cameraContracts = {};
    for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
      const targetCase = caseTargets[caseId];
      if (caseId === 'default-style') {
        resetView(viewer, targetCase.cartesian, CASES[caseId].rangeMeters);
        viewer.scene.requestRender();
      } else {
        viewer.camera.setView({
          destination: new Cesium.Cartesian3(...startingCamera.position),
          orientation: {
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
          },
        });
        await flyToCameraCase(
          viewer,
          targetCase.cartesian,
          CASES[caseId].rangeMeters,
        );
      }
      await waitForStableScene(viewer, layer, mode, sourceRecords);
      cameraContracts[caseId] = cameraContract(
        viewer,
        targetCase.cartesian,
        caseId,
        CASES[caseId].rangeMeters,
      );
      const baselineTarget = report.__nativeTargets?.[caseId] || null;
      const selected = nativeTargets(
        viewer,
        layer,
        mode,
        sourceRecords,
        mode === 'entities' ? null : baselineTarget,
      );
      assert(
        selected,
        `${mode} could not obtain native point and stem picks for ${caseId}.`,
      );
      if (mode === 'entities') {
        report.__nativeTargets ||= {};
        report.__nativeTargets[caseId] = {
          point: {
            entityId: selected.pointOwner.entityId,
            sourceKind: selected.pointOwner.sourceKind,
            sourceRecordId: selected.pointOwner.sourceRecordId,
            sourceOrdinal: selected.pointOwner.sourceOrdinal,
          },
          stem: {
            entityId: selected.stemOwner.entityId,
            sourceKind: selected.stemOwner.sourceKind,
            sourceRecordId: selected.stemOwner.sourceRecordId,
            sourceOrdinal: selected.stemOwner.sourceOrdinal,
          },
        };
      } else {
        assert(
          selected.pointOwner.entityId === baselineTarget?.point?.entityId &&
            selected.stemOwner.entityId === baselineTarget?.stem?.entityId,
          `${caseId} collection native picks resolved different owners.`,
        );
      }
      const classification = await mapStackWitness(viewer, mapEvents, layer);
      for (
        let sample = 0;
        sample < CABLE_REFERENCE_RENDER_SAMPLES;
        sample += 1
      ) {
        const stableFrames = await waitForStableScene(
          viewer,
          layer,
          mode,
          sourceRecords,
        );
        const frame = await capturePixels(viewer);
        const freshHashes = await sourceGeometryHash();
        const nowRefs = freshHashes.view.referenceData.items;
        const visibleReferences = nowRefs.filter((item) => item.visible).length;
        const sampleReport = {
          mode,
          caseId,
          sample,
          status: 'settled',
          stableFrames,
          clock: {
            iso: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
            shouldAnimate: viewer.clock.shouldAnimate,
          },
          sourceCounts: { ...CABLE_REFERENCE_RENDER_POPULATION },
          sourceIdentitySha256: freshHashes.sourceIdentitySha256,
          sourceManifestSha256,
          geometrySha256: freshHashes.geometrySha256,
          styleSha256: freshHashes.styleSha256,
          overlaySha256: freshHashes.overlaySha256,
          cameraSha256: await shaJson(cameraContracts[caseId]),
          frame: { width: frame.width, height: frame.height },
          pixelSha256: frame.pixelSha256,
          pngBase64: frame.pngBase64,
          camera: cameraContracts[caseId],
          classification: {
            ...classification,
            terrain: sourceClassification(
              data.cable,
              viewer.clock.currentTime,
            )[0],
          },
          visibility: {
            visibleReferences,
            hiddenReferences: nowRefs.length - visibleReferences,
          },
          ownership: {
            referenceCollections: diagnostic.referenceCollections,
            referencePoints: diagnostic.referencePointPrimitives,
            referenceStems: diagnostic.referenceStemPrimitives,
          },
          pointPick: cleanPick(selected.point, selected.pointOwner),
          stemPick: cleanPick(selected.stem, selected.stemOwner),
        };
        Object.defineProperty(sampleReport, '__rgba', {
          value: frame.rgba,
          enumerable: false,
          configurable: true,
        });
        lifetime.samples.push(sampleReport);
      }
      // Each natural point/stem pick is bound to the same owner in both
      // renderer lifetimes, even when overlapping geometry makes them differ.
    }

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const priorSources = viewer.dataSources.length;
      layer.disable();
      assert(
        overlay.visible === false && overlay.entries.length === 0,
        'Disable left cable overlay entries visible.',
      );
      assert(
        layer.getPerformanceDiagnostics().referenceCollections === 0,
        'Disable retained reference collections.',
      );
      if (mode === 'collections') {
        for (const collection of Object.values(layer.__fixtureCollections))
          assert(
            collection.isDestroyed(),
            'Disable retained a reference collection object.',
          );
        layer.__fixtureCollections = null;
      }
      await waitForPostRender(viewer);
      assert(
        viewer.dataSources.length === baselineDataSources,
        'Disable left cable DataSources attached.',
      );
      layer.enable(viewer);
      await waitForPopulation(viewer, layer, sourceRecords);
      if (mode === 'collections') {
        const source = dataSource(viewer, 'TeleGeography Cable References');
        layer.__fixtureCollections = findReferenceCollections(
          viewer,
          source.entities.values.map((entity) => entity.id),
        );
        ownedCollectionLifetimes.push(layer.__fixtureCollections);
      }
      await waitForStableScene(viewer, layer, mode, sourceRecords);
      assert(
        viewer.dataSources.length === priorSources,
        'Re-enable did not rebuild the same DataSource population.',
      );
      assert(
        layer.getStats().count ===
          CABLE_REFERENCE_RENDER_POPULATION.referenceRecords,
        'Re-enable lost source records.',
      );
    }
    layer.destroy(viewer);
    await waitForPostRender(viewer);
    const afterDestroy = layer.getPerformanceDiagnostics();
    const collectionsDestroyed = ownedCollectionLifetimes.every((owner) =>
      Object.values(owner).every((collection) => collection.isDestroyed()),
    );
    const collectionsDetached = ownedCollectionLifetimes.every((owner) =>
      Object.values(owner).every(
        (collection) => !viewer.scene.primitives.contains(collection),
      ),
    );
    lifetime.teardown = {
      disabled: true,
      reEnabled: true,
      dataSourcesRemoved: 3,
      collectionsRemoved:
        mode === 'collections' && collectionsDestroyed && collectionsDetached
          ? ownedCollectionLifetimes.length * 2
          : 0,
      overlayHidden: overlay.visible === false && overlay.entries.length === 0,
      destroyed: true,
      listenersAfterDestroy: afterDestroy.listeners,
      remainingDataSources: viewer.dataSources.length,
      remainingCollections: collectionsDestroyed && collectionsDetached ? 0 : 2,
    };
    assert(
      lifetime.teardown.listenersAfterDestroy === 0,
      'Destroy retained cable event listeners.',
    );
    assert(
      lifetime.teardown.remainingDataSources === baselineDataSources,
      'Destroy retained cable DataSources.',
    );
    assert(
      lifetime.teardown.remainingCollections === 0,
      'Destroy retained cable collections.',
    );
    lifetime.status = 'passed';
    return lifetime;
  } catch (error) {
    lifetime.status = 'failed';
    lifetime.error = String(error?.stack || error?.message || error).slice(
      0,
      4000,
    );
    throw error;
  } finally {
    const remaining = layer.getPerformanceDiagnostics();
    if (
      remaining.listeners > 0 ||
      remaining.dataSources > 0 ||
      remaining.referenceCollections > 0 ||
      viewer.dataSources.length !== baselineDataSources ||
      overlay.visible ||
      overlay.entries.length > 0
    ) {
      try {
        layer.destroy(viewer);
      } catch (error) {
        lifetime.cleanupError = String(
          error?.stack || error?.message || error,
        ).slice(0, 2000);
        if (lifetime.status === 'passed') {
          lifetime.status = 'failed';
          lifetime.error = lifetime.cleanupError;
        }
      }
    }
  }
}

async function runComparison() {
  const report = makeReport();
  let viewer = null;
  try {
    report.failedPhase = 'source-provenance';
    const [cableAsset, landingAsset] = await Promise.all([
      readBundledJson('cable-geo.json'),
      readBundledJson('landing-point-geo.json'),
    ]);
    const sourceData = await sourceDigests(
      cableAsset.json,
      landingAsset.json,
      cableAsset.sha256,
      landingAsset.sha256,
    );
    report.source = sourceData.report;
    const firstLanding = sourceData.records.find(
      (record) => record.kind === 'landing-point',
    );
    const firstCable = sourceData.records.find(
      (record) => record.kind === 'cable',
    );
    const targets = {
      default: {
        cartesian: Cesium.Cartesian3.fromDegrees(
          ...Object.values(featureReference(firstLanding.feature)),
          0,
        ),
      },
      cameraChange: {
        cartesian: Cesium.Cartesian3.fromDegrees(
          ...Object.values(featureReference(firstCable.feature)),
          0,
        ),
      },
    };
    assert(
      targets.default.cartesian && targets.cameraChange.cartesian,
      'Bundled source camera anchors are unavailable.',
    );
    report.renderClock.iso = FIXED_ISO;
    const modes = ['entities', 'collections'];
    for (let index = 0; index < modes.length; index += 1) {
      const mode = modes[index];
      report.failedPhase = `${mode}-viewer-init`;
      viewer = createFixtureViewer(targets.default.cartesian);
      const settings = viewerSettings(viewer);
      const environment = readPerformanceEnvironment({
        viewer,
        appCommit: EXPECTED_COMMIT,
        harnessCommit: EXPECTED_COMMIT,
      });
      assert(settings.sceneMode === 'SCENE3D', 'Fixture is not in 3D mode.');
      assert(settings.globeShown === true, 'Fixture globe is hidden.');
      assert(
        settings.terrainProvider === 'EllipsoidTerrainProvider',
        'Fixture terrain provider changed.',
      );
      assert(
        settings.resolutionScale === 1,
        'Viewer resolution scale is not 1.',
      );
      assert(settings.msaaSamples === 4, 'Viewer MSAA setting is not 4.');
      assert(
        settings.preserveDrawingBuffer === true,
        'Framebuffer preservation is unavailable.',
      );
      assert(
        settings.antialias === true,
        'WebGL context antialiasing is unavailable.',
      );
      assert(
        viewer.dataSources.length === 0,
        'Fixture viewer did not start without DataSources.',
      );
      assert(
        environment.viewport.width === 1200 &&
          environment.viewport.height === 1000 &&
          environment.viewport.dpr === 1,
        'Fixture CSS viewport changed.',
      );
      assert(
        environment.drawingBuffer.width === 960 &&
          environment.drawingBuffer.height === 640,
        'Fixture drawing buffer changed.',
      );
      if (index === 0) {
        report.settings = settings;
        report.environment = environment;
        report.viewer = {
          baselineDataSources: viewer.dataSources.length,
          sceneMode: settings.sceneMode,
          globeShown: settings.globeShown,
          terrainProvider: settings.terrainProvider,
          lifetimeCount: 2,
        };
      } else {
        assert(
          JSON.stringify(settings) === JSON.stringify(report.settings),
          'Fresh viewer settings differ between renderer lifetimes.',
        );
        assert(
          JSON.stringify(environment) === JSON.stringify(report.environment),
          'Fresh viewer environment differs between renderer lifetimes.',
        );
      }
      report.failedPhase = `${mode}-fixed-clock`;
      assert(
        Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3) === FIXED_ISO,
        'Cesium clock differs from the fixed fixture time.',
      );
      assert(
        !viewer.clock.shouldAnimate,
        'Cesium clock is advancing during captures.',
      );
      report.failedPhase = `${mode}-lifetime`;
      const lifetime = await runLifetime({
        viewer,
        mode,
        activationOrder: index,
        sourceRecords: sourceData.records,
        sourceManifestSha256: sourceData.report.identitySha256,
        targets,
        report,
      });
      lifetime.viewerSettingsSha256 = await shaJson(settings);
      lifetime.viewerEnvironmentSha256 = await shaJson(environment);
      viewer.destroy();
      viewer = null;
    }
    delete report.__nativeTargets;
    report.failedPhase = 'cross-mode-comparison';
    let comparisonIndex = 0;
    for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
      for (
        let sample = 0;
        sample < CABLE_REFERENCE_RENDER_SAMPLES;
        sample += 1
      ) {
        const entity = report.lifetimes[0].samples.find(
          (row) => row.caseId === caseId && row.sample === sample,
        );
        const candidate = report.lifetimes[1].samples.find(
          (row) => row.caseId === caseId && row.sample === sample,
        );
        assert(
          entity && candidate,
          `Missing matched ${caseId} sample ${sample + 1}.`,
        );
        let pixelDifferenceCount = 0;
        assert(
          entity.__rgba.length === candidate.__rgba.length,
          'Entity/collection screenshot buffer length differs.',
        );
        for (let index = 0; index < entity.__rgba.length; index += 4) {
          if (
            entity.__rgba[index] !== candidate.__rgba[index] ||
            entity.__rgba[index + 1] !== candidate.__rgba[index + 1] ||
            entity.__rgba[index + 2] !== candidate.__rgba[index + 2] ||
            entity.__rgba[index + 3] !== candidate.__rgba[index + 3]
          )
            pixelDifferenceCount += 1;
        }
        const exactPixels =
          pixelDifferenceCount === 0 &&
          entity.pixelSha256 === candidate.pixelSha256;
        const sameGeometry = entity.geometrySha256 === candidate.geometrySha256;
        const sameStyle = entity.styleSha256 === candidate.styleSha256;
        const sameSourceIdentities =
          entity.sourceIdentitySha256 === candidate.sourceIdentitySha256;
        const samePick = (left, right) =>
          JSON.stringify([
            left.kind,
            left.sourceKind,
            left.entityId,
            left.sourceRecordId,
            left.sourceOrdinal,
            left.screen,
          ]) ===
          JSON.stringify([
            right.kind,
            right.sourceKind,
            right.entityId,
            right.sourceRecordId,
            right.sourceOrdinal,
            right.screen,
          ]);
        const samePointPick = samePick(entity.pointPick, candidate.pointPick);
        const sameStemPick = samePick(entity.stemPick, candidate.stemPick);
        report.comparisons.push({
          caseId,
          sample,
          pixelDifferenceCount,
          pixelSha256: entity.pixelSha256,
          exactPixels,
          sameGeometry,
          sameStyle,
          sameSourceIdentities,
          samePointPick,
          sameStemPick,
        });
        delete entity.__rgba;
        delete candidate.__rgba;
        assert(
          exactPixels,
          `${caseId} sample ${sample + 1} has pixel differences.`,
        );
        assert(
          sameGeometry && sameStyle && sameSourceIdentities,
          `${caseId} sample ${sample + 1} geometry/style/source identity differs.`,
        );
        assert(
          samePointPick && sameStemPick,
          `${caseId} sample ${sample + 1} native picks differ.`,
        );
        comparisonIndex += 1;
      }
    }
    assert(
      comparisonIndex === 10,
      'Expected ten complete matched renderer snapshots.',
    );
    report.failedPhase = null;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.stack || error?.message || error).slice(
      0,
      5000,
    );
  } finally {
    if (viewer) {
      try {
        if (viewer.isDestroyed() === false) viewer.destroy();
      } catch (error) {
        report.cleanup = {
          error: String(error?.message || error).slice(0, 500),
        };
        report.status = 'failed';
      }
    }
  }
  return report;
}

function downloadReport(value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: 'application/json',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `cable-reference-render-${value.applicationCommit.slice(0, 7)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  downloadButton.disabled = true;
  statusNode.textContent = 'Running complete cable reference comparison…';
  outputNode.textContent = '';
  lastReport = await runComparison();
  outputNode.textContent = JSON.stringify(lastReport, null, 2);
  statusNode.textContent =
    lastReport.status === 'passed'
      ? 'Cable reference comparison passed.'
      : `Cable reference comparison failed at ${lastReport.failedPhase || 'unknown phase'}.`;
  downloadButton.disabled = false;
  runButton.disabled = false;
  window.__cableReferenceCollectionsResult = lastReport;
});

downloadButton.addEventListener('click', () => {
  if (lastReport) downloadReport(lastReport);
});
