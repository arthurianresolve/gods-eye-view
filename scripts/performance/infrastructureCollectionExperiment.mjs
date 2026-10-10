export const INFRASTRUCTURE_COLLECTION_SCHEMA =
  'gev-infrastructure-collections-diagnostic/v1';
export const INFRASTRUCTURE_COLLECTION_CASES = Object.freeze([
  'default-style',
  'focused-alpha-style',
]);
export const INFRASTRUCTURE_COLLECTION_PAIRS = 5;

function propertyValue(property, time) {
  return typeof property?.getValue === 'function'
    ? property.getValue(time)
    : property;
}

function finiteColor(color, label) {
  const value = [color?.red, color?.green, color?.blue, color?.alpha];
  if (!value.every(Number.isFinite))
    throw new Error(`${label} is not a finite Cesium color.`);
  return value;
}

function finitePosition(position, label) {
  const value = [position?.x, position?.y, position?.z];
  if (!value.every(Number.isFinite))
    throw new Error(`${label} is not a finite Cartesian3.`);
  return value;
}

function normalizedDepthDistance(value) {
  if (value === Number.POSITIVE_INFINITY) return 'infinity';
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Point depth-test distance is invalid.');
  return value;
}

function cesiumColor(Cesium, rgba) {
  return new Cesium.Color(rgba[0], rgba[1], rgba[2], rgba[3]);
}

/** Build fixture-owned primitive surfaces from the actual loaded Entity values. */
export function createInfrastructurePrimitiveCollections(
  Cesium,
  surfaces,
  { focusedEntityId = null } = {},
) {
  if (!Cesium?.PointPrimitiveCollection || !Cesium?.PolylineCollection)
    throw new TypeError('Cesium point and polyline collections are required.');
  if (!Array.isArray(surfaces) || surfaces.length === 0)
    throw new TypeError('Loaded Entity surfaces are required.');
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  let points = null;
  let stems = null;
  const pointIds = new Map();
  const stemIds = new Map();
  const indexByEntityId = new Map();
  try {
    points = new Cesium.PointPrimitiveCollection();
    stems = new Cesium.PolylineCollection();
    for (const surface of surfaces) {
      const index = indexByEntityId.size;
      const focused = surface.entityId === focusedEntityId;
      const pointColor = cesiumColor(Cesium, surface.pointStyle.color);
      const pointOutlineColor = cesiumColor(
        Cesium,
        surface.pointStyle.outlineColor,
      );
      const stemColor = cesiumColor(Cesium, surface.lineStyle.color);
      if (focused) {
        pointColor.alpha = 0.55;
        Cesium.Color.clone(Cesium.Color.YELLOW, pointOutlineColor);
        stemColor.alpha = 0.55;
      }
      const pointId = {
        layerId: surface.layerId,
        sourceRecordId: surface.sourceRecordId,
        entityId: surface.entityId,
        kind: 'point',
      };
      const stemId = {
        layerId: surface.layerId,
        sourceRecordId: surface.sourceRecordId,
        entityId: surface.entityId,
        kind: 'stem',
      };
      points.add({
        id: pointId,
        position: surface.position,
        pixelSize: surface.pointStyle.pixelSize,
        color: pointColor,
        outlineColor: pointOutlineColor,
        outlineWidth: surface.pointStyle.outlineWidth,
        disableDepthTestDistance:
          surface.pointStyle.disableDepthTestDistance === 'infinity'
            ? Number.POSITIVE_INFINITY
            : surface.pointStyle.disableDepthTestDistance,
        show: surface.pointStyle.show && surface.entityShow,
      });
      stems.add({
        id: stemId,
        positions: surface.positions,
        width: surface.lineStyle.width,
        material: Cesium.Material.fromType('Color', { color: stemColor }),
        show: surface.lineStyle.show && surface.entityShow,
      });
      pointIds.set(surface.entityId, pointId);
      stemIds.set(surface.entityId, stemId);
      indexByEntityId.set(surface.entityId, index);
    }
  } catch (error) {
    if (points && !points.isDestroyed()) points.destroy();
    if (stems && !stems.isDestroyed()) stems.destroy();
    throw error;
  }
  return {
    points,
    stems,
    pointIds,
    stemIds,
    indexByEntityId,
    constructionMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
    isDestroyed() {
      return points.isDestroyed() && stems.isDestroyed();
    },
    destroy() {
      if (!points.isDestroyed()) points.destroy();
      if (!stems.isDestroyed()) stems.destroy();
      return this.isDestroyed();
    },
  };
}

/** Read the public values of each fixture-owned primitive surface. */
export function readInfrastructurePrimitiveSurfaces(collections) {
  if (!collections?.points || !collections?.stems)
    throw new TypeError('Primitive collections are required.');
  const rows = [];
  for (let index = 0; index < collections.points.length; index++) {
    const point = collections.points.get(index);
    const stem = collections.stems.get(index);
    if (!point || !stem || point.id?.entityId !== stem.id?.entityId)
      throw new Error('Point/stem collection identities are not aligned.');
    rows.push({
      layerId: point.id.layerId,
      entityId: point.id.entityId,
      sourceRecordId: point.id.sourceRecordId,
      point: {
        position: finitePosition(point.position, 'Collection point position'),
        pixelSize: point.pixelSize,
        color: finiteColor(point.color, 'Collection point color'),
        outlineColor: finiteColor(
          point.outlineColor,
          'Collection outline color',
        ),
        outlineWidth: point.outlineWidth,
        disableDepthTestDistance: normalizedDepthDistance(
          point.disableDepthTestDistance,
        ),
        show: point.show,
      },
      stem: {
        positions: stem.positions.map((position) =>
          finitePosition(position, 'Collection stem position'),
        ),
        width: stem.width,
        color: finiteColor(
          stem.material?.uniforms?.color,
          'Collection stem color',
        ),
        show: stem.show,
      },
    });
  }
  if (collections.stems.length !== rows.length)
    throw new Error('Point and stem collection populations differ.');
  return rows;
}

/** Validate the public pick payload produced by an actual collection item. */
export function matchesInfrastructureCollectionPick(
  picked,
  collections,
  entityId,
  kind,
) {
  if (kind !== 'point' && kind !== 'stem') return false;
  const index = collections?.indexByEntityId?.get(entityId);
  if (!Number.isSafeInteger(index)) return false;
  const collection = kind === 'point' ? collections.points : collections.stems;
  const expectedItem = collection?.get(index);
  const pickId = picked?.id;
  return Boolean(
    expectedItem &&
    picked?.primitive === expectedItem &&
    picked?.collection === collection &&
    pickId?.entityId === entityId &&
    pickId?.kind === kind,
  );
}

/**
 * Snapshot public Entity graphics and reconcile their source-owned identity.
 * The returned Cesium references are for a short-lived fixture run only.
 */
export function snapshotInfrastructureSurfaces({
  entities,
  analystRecords,
  layerId,
  time,
}) {
  if (!Array.isArray(entities) || !Array.isArray(analystRecords))
    throw new TypeError('Entity and analyst record arrays are required.');
  if (!layerId)
    throw new TypeError('A local infrastructure layer id is required.');

  const recordsBySourceId = new Map();
  for (const record of analystRecords) {
    const sourceId = String(record?.evidence?.entityRef?.id ?? '');
    if (!sourceId) throw new Error('Analyst source identity is missing.');
    const records = recordsBySourceId.get(sourceId) || [];
    if (
      records.some(
        (existing) =>
          existing.id !== record.id ||
          existing.sourceRecordId !== record.sourceRecordId ||
          existing.evidence?.entityRef?.layerKey !==
            record.evidence?.entityRef?.layerKey,
      )
    )
      throw new Error(
        'Rendered parts resolve to contradictory analyst records.',
      );
    records.push(record);
    recordsBySourceId.set(sourceId, records);
  }

  const surfaces = [];
  for (const entity of entities) {
    if (!entity?.point || !entity?.polyline) continue;
    const entityId = String(entity.id ?? '');
    const properties = propertyValue(entity.properties, time) || {};
    const sourceId = String(properties.osm_id ?? properties.id ?? entityId);
    const analystRecord = recordsBySourceId.get(sourceId)?.[0];
    if (!entityId || !analystRecord)
      throw new Error(
        `Entity ${entityId || '(missing id)'} has no canonical analyst record.`,
      );
    if (analystRecord.evidence?.entityRef?.layerKey !== layerId)
      throw new Error(`Entity ${entityId} resolves to the wrong source layer.`);

    const position = propertyValue(entity.position, time);
    const positions = propertyValue(entity.polyline.positions, time);
    if (!Array.isArray(positions) || positions.length !== 2)
      throw new Error(`Entity ${entityId} has no two-point stem geometry.`);
    const lineColor = propertyValue(entity.polyline.material?.color, time);
    const pointStyle = {
      pixelSize: propertyValue(entity.point.pixelSize, time),
      color: finiteColor(
        propertyValue(entity.point.color, time),
        'Point color',
      ),
      outlineColor: finiteColor(
        propertyValue(entity.point.outlineColor, time),
        'Point outline color',
      ),
      outlineWidth: propertyValue(entity.point.outlineWidth, time),
      disableDepthTestDistance: normalizedDepthDistance(
        propertyValue(entity.point.disableDepthTestDistance, time),
      ),
      show: propertyValue(entity.point.show, time) !== false,
    };
    const lineStyle = {
      width: propertyValue(entity.polyline.width, time),
      color: finiteColor(lineColor, 'Stem color'),
      show: propertyValue(entity.polyline.show, time) !== false,
    };
    if (
      !Number.isFinite(pointStyle.pixelSize) ||
      !Number.isFinite(pointStyle.outlineWidth) ||
      !Number.isFinite(lineStyle.width)
    )
      throw new Error(`Entity ${entityId} has an invalid point or stem style.`);

    surfaces.push({
      layerId,
      entityId,
      sourceRecordId: String(
        analystRecord.sourceRecordId || analystRecord.evidence.entityRef.id,
      ),
      analystId: String(analystRecord.id),
      entity,
      position,
      positions,
      entityShow: entity.show !== false,
      pointStyle,
      lineStyle,
      positionFingerprint: JSON.stringify({
        point: finitePosition(position, 'Entity point position'),
        stem: positions.map((value) => finitePosition(value, 'Stem position')),
      }),
      styleFingerprint: JSON.stringify({ point: pointStyle, line: lineStyle }),
    });
  }

  if (surfaces.length === 0)
    throw new Error('The actual source produced no point/stem surfaces.');
  const entityIds = surfaces.map(({ entityId }) => entityId);
  if (new Set(entityIds).size !== entityIds.length)
    throw new Error('Rendered Entity identities are duplicated.');
  return surfaces;
}

/** Compare a matched entity/collection sample without numeric pixel tolerance. */
export function compareInfrastructureSurfaceSamples(entity, collection) {
  if (entity?.mode !== 'entity' || collection?.mode !== 'collection')
    throw new Error('A matched entity/collection sample pair is required.');
  for (const field of [
    'sourceFeatureCount',
    'renderEntityCount',
    'surfaceCount',
    'pointCount',
    'stemCount',
    'visiblePointCount',
    'visibleStemCount',
    'lineOnlyEntityCount',
    'polygonEntityCount',
    'identitySha256',
    'positionSha256',
    'styleSha256',
    'sourceGeometryKindsSha256',
    'renderEntityKindsSha256',
    'pixelSha256',
  ]) {
    if (entity[field] === undefined || collection[field] === undefined)
      throw new Error(`Entity/collection ${field} is missing.`);
    if (entity[field] !== collection[field])
      throw new Error(`Entity/collection ${field} differs.`);
  }
  if (
    entity.pointPick?.sourceRecordId !== collection.pointPick?.sourceRecordId ||
    entity.pointPick?.entityId !== collection.pointPick?.entityId ||
    JSON.stringify(entity.pointPick?.screen) !==
      JSON.stringify(collection.pointPick?.screen)
  )
    throw new Error('Entity/collection point pick identity differs.');
  if (
    entity.stemPick?.sourceRecordId !== collection.stemPick?.sourceRecordId ||
    entity.stemPick?.entityId !== collection.stemPick?.entityId ||
    JSON.stringify(entity.stemPick?.screen) !==
      JSON.stringify(collection.stemPick?.screen)
  )
    throw new Error('Entity/collection stem pick identity differs.');
  if (
    entity.pointPick?.kind !== 'point' ||
    collection.pointPick?.kind !== 'point'
  )
    throw new Error('A point pick did not resolve to a point surface.');
  if (entity.stemPick?.kind !== 'stem' || collection.stemPick?.kind !== 'stem')
    throw new Error('A stem pick did not resolve to a stem surface.');
  if (
    entity.pixelDifferenceCount !== 0 ||
    collection.pixelDifferenceCount !== 0
  )
    throw new Error('Exact full-frame pixel comparison failed.');
  if (
    entity.frame?.width !== collection.frame?.width ||
    entity.frame?.height !== collection.frame?.height
  )
    throw new Error('Entity/collection framebuffer dimensions differ.');
  return true;
}

/** Strict validator used by the hosted fixture and its Node contract tests. */
export function validateInfrastructureCollectionReport(
  report,
  { expectedCommit, expectedCases = INFRASTRUCTURE_COLLECTION_CASES } = {},
) {
  if (report?.schema !== INFRASTRUCTURE_COLLECTION_SCHEMA)
    throw new Error('Infrastructure collection report schema is invalid.');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || ''))
    throw new Error('An exact application commit is required.');
  if (
    report.applicationCommit !== expectedCommit ||
    report.harnessCommit !== expectedCommit
  )
    throw new Error('Infrastructure collection source identity changed.');
  if (report.status !== 'passed' || report.error || report.failedPhase)
    throw new Error('Infrastructure collection diagnostic did not pass.');
  if (
    report.caseCount !== expectedCases.length ||
    report.pairsPerCase !== INFRASTRUCTURE_COLLECTION_PAIRS ||
    report.samples?.length !==
      expectedCases.length * INFRASTRUCTURE_COLLECTION_PAIRS * 2
  )
    throw new Error(
      'Infrastructure collection sample inventory is incomplete.',
    );
  if (
    !Array.isArray(report.checks) ||
    report.checks.some(({ passed }) => passed !== true)
  )
    throw new Error(
      'Infrastructure collection checks are incomplete or failed.',
    );
  if (report.checks.length === 0)
    throw new Error('Infrastructure collection checks are missing.');

  const seenPairs = new Set();
  for (const caseId of expectedCases) {
    const caseSamples = report.samples.filter(
      (sample) => sample.caseId === caseId,
    );
    if (caseSamples.length !== INFRASTRUCTURE_COLLECTION_PAIRS * 2)
      throw new Error(`${caseId} sample inventory is incomplete.`);
    for (let pair = 0; pair < INFRASTRUCTURE_COLLECTION_PAIRS; pair++) {
      const pairKey = `${caseId}:${pair}`;
      if (seenPairs.has(pairKey)) throw new Error(`${pairKey} is duplicated.`);
      seenPairs.add(pairKey);
      const entity = caseSamples.find(
        (sample) => sample.pair === pair && sample.mode === 'entity',
      );
      const collection = caseSamples.find(
        (sample) => sample.pair === pair && sample.mode === 'collection',
      );
      if (!entity || !collection)
        throw new Error(`${caseId} pair ${pair + 1} is incomplete.`);
      for (const sample of [entity, collection]) {
        if (
          !Number.isSafeInteger(sample.sourceFeatureCount) ||
          sample.sourceFeatureCount <= 0 ||
          !Number.isSafeInteger(sample.surfaceCount) ||
          sample.surfaceCount <= 0 ||
          sample.pointCount !== sample.surfaceCount ||
          sample.stemCount !== sample.surfaceCount ||
          !Number.isSafeInteger(sample.renderEntityCount) ||
          sample.renderEntityCount < sample.surfaceCount ||
          !Number.isSafeInteger(sample.visiblePointCount) ||
          sample.visiblePointCount < 0 ||
          sample.visiblePointCount > sample.pointCount ||
          !Number.isSafeInteger(sample.visibleStemCount) ||
          sample.visibleStemCount < 0 ||
          sample.visibleStemCount > sample.stemCount ||
          !Number.isSafeInteger(sample.lineOnlyEntityCount) ||
          sample.lineOnlyEntityCount < 0 ||
          !Number.isSafeInteger(sample.polygonEntityCount) ||
          sample.polygonEntityCount < 0 ||
          !Number.isSafeInteger(sample.frame?.pixelsDifferentFromCorner) ||
          sample.frame.pixelsDifferentFromCorner <= 100 ||
          !Number.isSafeInteger(sample.frame?.width) ||
          sample.frame.width <= 0 ||
          !Number.isSafeInteger(sample.frame?.height) ||
          sample.frame.height <= 0 ||
          !Number.isFinite(sample.frame?.elapsedMs) ||
          sample.frame.elapsedMs <= 0 ||
          !/^[a-f0-9]{64}$/.test(sample.identitySha256) ||
          !/^[a-f0-9]{64}$/.test(sample.positionSha256) ||
          !/^[a-f0-9]{64}$/.test(sample.styleSha256) ||
          !/^[a-f0-9]{64}$/.test(sample.sourceGeometryKindsSha256) ||
          !/^[a-f0-9]{64}$/.test(sample.renderEntityKindsSha256) ||
          !/^[a-f0-9]{64}$/.test(sample.pixelSha256)
        )
          throw new Error(
            `${caseId} pair ${pair + 1} contains invalid evidence.`,
          );
        for (const [pickName, expectedKind] of [
          ['pointPick', 'point'],
          ['stemPick', 'stem'],
        ]) {
          const pick = sample[pickName];
          if (
            pick?.kind !== expectedKind ||
            typeof pick.sourceRecordId !== 'string' ||
            pick.sourceRecordId.length === 0 ||
            typeof pick.entityId !== 'string' ||
            pick.entityId.length === 0 ||
            !Array.isArray(pick.screen) ||
            pick.screen.length !== 2 ||
            !pick.screen.every(Number.isFinite)
          )
            throw new Error(
              `${caseId} pair ${pair + 1} contains an invalid ${pickName}.`,
            );
        }
      }
      compareInfrastructureSurfaceSamples(entity, collection);
    }
  }
  if (
    report.cleanup?.viewerDestroyed !== true ||
    report.cleanup?.layersDestroyed !== true ||
    report.cleanup?.pointCollectionDestroyed !== true ||
    report.cleanup?.polylineCollectionDestroyed !== true ||
    report.cleanup?.collectionParentDestroyed !== true ||
    report.cleanup?.glInstrumentationRestored !== true ||
    report.cleanup?.instrumentationRestored !== true ||
    report.cleanup?.entityVisibilityRestored !== true
  )
    throw new Error('Fixture-owned viewer or data layers were not released.');
  return true;
}
