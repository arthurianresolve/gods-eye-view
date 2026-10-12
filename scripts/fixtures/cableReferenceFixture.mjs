import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createBundledCableSource } from '../../src/layers/submarineCables/bundledSource.js';
import { featureReference } from '../../src/layers/submarineCables/geometry.js';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import { createCableCameraSweepGate } from './cableCameraSweep.mjs';
import {
  appendCableFailureDiagnostics,
  attachCableReadinessFailure,
  cableFailureDiagnostics,
  appendLegacyCableReadinessObservation,
  createCableReadinessTrace,
  normalizeCableReadinessOptions,
} from './cableFailureDiagnostics.mjs';
import { readScenePrimitiveReadiness } from './scenePrimitiveReadiness.mjs';
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

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertSha(value, label) {
  assert(/^[a-f0-9]{64}$/.test(value || ''), `${label} is not SHA-256.`);
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function shaJson(value) {
  return sha256(new TextEncoder().encode(JSON.stringify(value)));
}

export async function readBundledJson(file) {
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

export function normalizedSourceId(feature, kind, index) {
  return String(feature?.properties?.id || feature?.id || `${kind}-${index}`);
}

export function makeSourceRecords(cables, landings) {
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

export function parseReferenceEntityId(id) {
  const match = /^(cable|landing-point)-reference-(\d+)-(.+)$/.exec(id || '');
  if (!match) return null;
  return {
    kind: match[1],
    sourceOrdinal: Number(match[2]),
    sourceRecordId: match[3],
  };
}

export function propertyValue(property, time) {
  return typeof property?.getValue === 'function'
    ? property.getValue(time)
    : property;
}

export function xyz(value) {
  if (!value) return null;
  return [value.x, value.y, value.z];
}

export function positions(value, time) {
  const resolved = propertyValue(value, time);
  return Array.isArray(resolved) ? resolved.map(xyz) : null;
}

export function rgbaBytes(color) {
  const resolved = propertyValue(color);
  if (!resolved) return null;
  return [...resolved.toBytes()];
}

export function enumName(enumObject, value) {
  return (
    Object.entries(enumObject).find(
      ([, candidate]) => candidate === value,
    )?.[0] || String(value)
  );
}

export function dataSource(viewer, name) {
  const matches = viewer.dataSources.getByName(name);
  assert(matches.length === 1, `Expected one ${name} DataSource.`);
  return matches[0];
}

export function findReferenceCollections(viewer, entityIds) {
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

export function readReferenceItems(viewer, layer, mode, sourceRecords) {
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

export function readSourceGeometry(cableSource, landingSource, time) {
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

export function sceneSignature(viewer, layer, mode, sourceRecords) {
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

export function cameraVector(viewer) {
  return {
    position: xyz(viewer.camera.positionWC),
    direction: xyz(viewer.camera.directionWC),
    up: xyz(viewer.camera.upWC),
  };
}

export function sameCameraPose(left, right) {
  if (!left || !right) return false;
  for (const key of ['position', 'direction', 'up']) {
    const a = left[key];
    const b = right[key];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3) return false;
    const tolerance = key === 'position' ? 1e-6 : 1e-12;
    for (let index = 0; index < 3; index += 1) {
      if (!Number.isFinite(a[index]) || !Number.isFinite(b[index]))
        return false;
      if (Math.abs(a[index] - b[index]) > tolerance) return false;
    }
  }
  return true;
}

export function waitForPostRender(viewer, timeoutMs = 1000) {
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

export async function waitForPopulation(viewer, layer, sourceRecords) {
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

export async function waitForStableScene(
  viewer,
  layer,
  mode,
  sourceRecords,
  deadline = performance.now() + STABLE_TIMEOUT_MS,
  options = {},
) {
  const normalizedOptions = normalizeCableReadinessOptions(options);
  const { stage, trace, legacyObservations } = normalizedOptions;
  const startedAt = performance.now();
  let previous = null;
  let stableFrames = 0;
  const observe = (primitiveReadiness = null, result = null) => {
    const diagnostics = cableFailureDiagnostics(viewer, layer);
    const frameNumber = diagnostics.scene.frameNumber.available
      ? diagnostics.scene.frameNumber.value
      : null;
    const dataSourceDisplayReady =
      diagnostics.scene.dataSourceDisplayReady.available &&
      diagnostics.scene.dataSourceDisplayReady.value === true;
    const globeTilesLoaded =
      diagnostics.scene.globeTilesLoaded.available &&
      diagnostics.scene.globeTilesLoaded.value === true;
    const remainingMs = Math.max(0, deadline - performance.now());
    if (legacyObservations)
      appendLegacyCableReadinessObservation(legacyObservations, {
        remainingMs,
        frameNumber,
        dataSourceDisplayReady,
        primitiveReadiness,
      });
    trace.record({
      elapsedMs: Math.max(0, performance.now() - startedAt),
      remainingMs,
      frameNumber,
      dataSourceDisplayReady,
      globeTilesLoaded,
      primitiveReadiness: primitiveReadiness
        ? { available: true, value: primitiveReadiness }
        : {
            available: false,
            error: result?.primitiveReadinessError || 'not-observed',
          },
      stableFrames,
      signatureStable: result?.signatureStable ?? false,
    });
  };
  try {
    while (performance.now() < deadline) {
      const remainingMs = deadline - performance.now();
      try {
        await waitForPostRender(viewer, Math.min(1000, remainingMs));
      } catch (error) {
        if (performance.now() < deadline) throw error;
        break;
      }
      let primitiveReadiness;
      try {
        primitiveReadiness = readScenePrimitiveReadiness(viewer.scene, Cesium);
      } catch (error) {
        observe(null, {
          primitiveReadinessError: String(error?.message || error).slice(
            0,
            300,
          ),
        });
        throw error;
      }
      const ready =
        viewer.dataSourceDisplay.ready === true &&
        viewer.scene.globe.tilesLoaded === true &&
        primitiveReadiness.ready;
      if (!ready) {
        previous = null;
        stableFrames = 0;
        observe(primitiveReadiness);
        continue;
      }
      const next = sceneSignature(viewer, layer, mode, sourceRecords);
      const signatureStable = next === previous;
      if (signatureStable) stableFrames += 1;
      else stableFrames = 0;
      previous = next;
      observe(primitiveReadiness, { signatureStable });
      if (stableFrames >= 3) return stableFrames + 1;
    }
    throw new Error('Cable scene did not reach three stable completed frames.');
  } catch (error) {
    attachCableReadinessFailure(error, trace, viewer, layer, { stage });
    throw error;
  }
}

export function setMapStack(viewer, mapEvents, activeId) {
  viewer.scene.globe.show = activeId !== 'photoreal';
  mapEvents.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId } }),
  );
}

export function resetView(viewer, target, rangeMeters) {
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(0, -Math.PI / 3, rangeMeters),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

export async function flyToCameraCase(viewer, target, rangeMeters) {
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

export function worldToScreen(viewer, position) {
  const result = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    position,
  );
  if (!result) return null;
  // SceneTransforms uses the drawing canvas viewport origin (0, 0), and
  // scene.pick expects the same canvas-relative coordinates.
  return [result.x, result.y];
}

export function pickedEntity(picked) {
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

export function probePick(viewer, screen, referencesById, kind, trace = null) {
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
    const primitiveType = picked?.primitive?.constructor?.name || null;
    const appearanceType =
      picked?.primitive?.appearance?.constructor?.name || null;
    if (trace) {
      trace.scenePickCount += 1;
      if (trace.observations.length < 12)
        trace.observations.push({
          screen: [x, y],
          primitiveType,
          appearanceType,
          entityId: typeof entity?.id === 'string' ? entity.id : null,
          ownerVerified: Boolean(owner && owner.entity === entity),
        });
    }
    if (!owner || owner.entity !== entity) continue;
    const verifiedPrimitiveType = primitiveType || 'unknown';
    if (kind === 'point' && verifiedPrimitiveType !== 'PointPrimitive')
      continue;
    if (
      kind === 'stem' &&
      verifiedPrimitiveType !== 'Polyline' &&
      verifiedPrimitiveType !== 'PolylineCollection' &&
      !(
        verifiedPrimitiveType === 'Primitive' &&
        appearanceType === 'PolylineColorAppearance'
      )
    )
      continue;
    return {
      owner,
      screen: [x, y],
      primitiveType: verifiedPrimitiveType,
      appearanceType,
      ownerVerified: true,
      picked,
    };
  }
  return null;
}

export function nativeTargets(
  viewer,
  layer,
  mode,
  sourceRecords,
  expected = null,
) {
  const references = readReferenceItems(viewer, layer, mode, sourceRecords);
  const width = viewer.scene.canvas.clientWidth;
  const height = viewer.scene.canvas.clientHeight;
  const referencesById = new Map(
    references.items.map((item) => [item.entityId, item]),
  );
  const diagnostics = {
    mode,
    visibleReferences: references.items.filter((item) => item.visible).length,
    onCanvasPointCandidates: 0,
    onCanvasStemCandidates: 0,
    pointProbeCount: 0,
    stemProbeCount: 0,
    pointScenePickCount: 0,
    stemScenePickCount: 0,
    pointCandidates: [],
    stemCandidates: [],
    pointOutcomes: [],
    stemOutcomes: [],
  };
  const onCanvas = (screen) =>
    screen &&
    screen[0] >= FIXTURE_PIXEL_MARGIN &&
    screen[0] < width - FIXTURE_PIXEL_MARGIN &&
    screen[1] >= FIXTURE_PIXEL_MARGIN &&
    screen[1] < height - FIXTURE_PIXEL_MARGIN;
  let point = null;
  for (const item of references.items) {
    if (!item.visible || !item.pointPosition || !item.stemPositions?.length)
      continue;
    const pointScreen = worldToScreen(viewer, item.pointPosition);
    if (!onCanvas(pointScreen)) continue;
    diagnostics.onCanvasPointCandidates += 1;
    if (diagnostics.pointCandidates.length < 8)
      diagnostics.pointCandidates.push({
        entityId: item.entityId,
        sourceKind: item.sourceKind,
        sourceRecordId: item.sourceRecordId,
        screen: pointScreen,
      });
    const pointTrace = { scenePickCount: 0, observations: [] };
    const pointHit = probePick(
      viewer,
      pointScreen,
      referencesById,
      'point',
      pointTrace,
    );
    diagnostics.pointProbeCount += 1;
    diagnostics.pointScenePickCount += pointTrace.scenePickCount;
    if (diagnostics.pointOutcomes.length < 8)
      diagnostics.pointOutcomes.push({
        entityId: item.entityId,
        sourceKind: item.sourceKind,
        screen: pointScreen,
        observations: pointTrace.observations,
        hit: pointHit
          ? {
              entityId: pointHit.owner.entityId,
              sourceKind: pointHit.owner.sourceKind,
              sourceRecordId: pointHit.owner.sourceRecordId,
              primitiveType: pointHit.primitiveType,
              appearanceType: pointHit.appearanceType,
            }
          : null,
      });
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
      if (!onCanvas(stemScreen)) continue;
      diagnostics.onCanvasStemCandidates += 1;
      if (diagnostics.stemCandidates.length < 8)
        diagnostics.stemCandidates.push({
          entityId: item.entityId,
          sourceKind: item.sourceKind,
          sourceRecordId: item.sourceRecordId,
          fraction,
          screen: stemScreen,
        });
      const stemTrace = { scenePickCount: 0, observations: [] };
      const stemHit = probePick(
        viewer,
        stemScreen,
        referencesById,
        'stem',
        stemTrace,
      );
      diagnostics.stemProbeCount += 1;
      diagnostics.stemScenePickCount += stemTrace.scenePickCount;
      if (diagnostics.stemOutcomes.length < 8)
        diagnostics.stemOutcomes.push({
          entityId: item.entityId,
          sourceKind: item.sourceKind,
          fraction,
          screen: stemScreen,
          observations: stemTrace.observations,
          hit: stemHit
            ? {
                entityId: stemHit.owner.entityId,
                sourceKind: stemHit.owner.sourceKind,
                sourceRecordId: stemHit.owner.sourceRecordId,
                primitiveType: stemHit.primitiveType,
                appearanceType: stemHit.appearanceType,
              }
            : null,
        });
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
  return {
    pointOwner: point?.owner || null,
    stemOwner: stem?.owner || null,
    point: point ? { ...point, kind: 'point' } : null,
    stem: stem ? { ...stem, kind: 'stem' } : null,
    diagnostics,
  };
}

export function cleanPick(pick, source) {
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

export function cameraContract(viewer, target, caseId, rangeMeters) {
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

export function sourceClassification(dataSource, time) {
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

export async function capturePixels(viewer) {
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

export function sourceGeometryEvidence(viewer, mode, layer, sourceRecords) {
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

export function createOverlayHost() {
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

export function viewerSettings(viewer) {
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

export function makeReport() {
  return {
    schema: CABLE_REFERENCE_RENDER_SCHEMA,
    samplingContract: 'owned-primitives-ready/v1',
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

export async function sourceDigests(cables, landings, cableHash, landingHash) {
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

export function setFixedViewerClock(viewer) {
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(FIXED_ISO);
  viewer.clock.shouldAnimate = false;
}

export function createFixtureViewer(
  target,
  {
    container = document.querySelector('#viewer'),
    creditContainer = document.querySelector('#credits'),
  } = {},
) {
  const viewer = createApplicationViewer({
    container,
    creditContainer,
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

export async function mapStackWitness(viewer, mapEvents, layer) {
  const cableSource = dataSource(viewer, 'TeleGeography Submarine Cables');
  const waitForMapStage = async (activeId, stage) => {
    const trace = createCableReadinessTrace(stage);
    try {
      setMapStack(viewer, mapEvents, activeId);
      await waitForPostRender(viewer);
      const diagnostics = cableFailureDiagnostics(viewer, layer);
      let primitiveReadiness;
      try {
        primitiveReadiness = readScenePrimitiveReadiness(viewer.scene, Cesium);
      } catch (error) {
        trace.record({
          phase: 'first-post-render',
          frameNumber: diagnostics.scene.frameNumber,
          dataSourceDisplayReady: diagnostics.scene.dataSourceDisplayReady,
          globeTilesLoaded: diagnostics.scene.globeTilesLoaded,
          primitiveReadiness: {
            available: false,
            error: String(error?.message || error).slice(0, 300),
          },
        });
        throw error;
      }
      trace.record({
        phase: 'first-post-render',
        frameNumber: diagnostics.scene.frameNumber,
        dataSourceDisplayReady: diagnostics.scene.dataSourceDisplayReady,
        globeTilesLoaded: diagnostics.scene.globeTilesLoaded,
        primitiveReadiness: { available: true, value: primitiveReadiness },
      });
      await waitForStableScene(
        viewer,
        layer,
        layer.__fixtureMode,
        layer.__fixtureRecords,
        undefined,
        { stage, trace },
      );
    } catch (error) {
      attachCableReadinessFailure(error, trace, viewer, layer, {
        stage,
        activeId,
      });
      throw error;
    }
  };
  await waitForMapStage('photoreal', 'map-stack-photoreal');
  const photoreal = sourceClassification(cableSource, viewer.clock.currentTime);
  await waitForMapStage('osm', 'map-stack-terrain-restore');
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
