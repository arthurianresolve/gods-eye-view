export const INFRASTRUCTURE_COLLECTION_SCHEMA =
  'gev-infrastructure-collections-diagnostic/v1';
export const INFRASTRUCTURE_COLLECTION_CASES = Object.freeze([
  'default-style',
  'focused-alpha-style',
]);
export const INFRASTRUCTURE_COLLECTION_PAIRS = 5;
export const INFRASTRUCTURE_COLLECTION_COLOR_ENCODINGS = Object.freeze([
  'direct-float-uniform',
  'entity-color-attribute-byte',
]);

export function infrastructureCollectionRepresentationId(encoding) {
  if (!INFRASTRUCTURE_COLLECTION_COLOR_ENCODINGS.includes(encoding))
    throw new TypeError('Infrastructure stem color encoding is unsupported.');
  return `point-polyline-collections/${encoding}/v1`;
}

function propertyValue(property, time) {
  return typeof property?.getValue === 'function'
    ? property.getValue(time)
    : property;
}

function finiteColor(color, label) {
  const value = Array.isArray(color)
    ? color
    : [color?.red, color?.green, color?.blue, color?.alpha];
  if (value.length !== 4 || !value.every(Number.isFinite))
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

/** Match the RGBA8 attribute encoding used by Cesium's static polyline batch. */
export function infrastructureEntityEncodedColor(Cesium, rgba) {
  const color = cesiumColor(Cesium, rgba);
  const bytes = Cesium.ColorGeometryInstanceAttribute.toValue(color);
  return Cesium.Color.fromBytes(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/** Return Cesium's effective RGBA8 channel mapping for a color value. */
export function infrastructureEffectiveColorBytes(Cesium, color) {
  const rgba = finiteColor(color, 'Effective render color');
  return rgba.map((component) => Cesium.Color.floatToByte(component));
}

/** Preserve raw RGBA arrays while separating source, observed, and encoded styles. */
export function infrastructureSurfaceStyleEvidence(
  Cesium,
  surfaces,
  mode,
  stemColorEncoding,
) {
  if (!Array.isArray(surfaces) || !['entity', 'collection'].includes(mode))
    throw new TypeError(
      'Observed infrastructure surfaces and mode are required.',
    );
  const rgba = (value, label) => finiteColor(value, label);
  const styles = surfaces.map((surface) => ({
    entityId: surface.entityId,
    entityShow: surface.entityShow,
    point: {
      ...surface.pointStyle,
      color: rgba(surface.pointStyle.color, 'Observed point color'),
      outlineColor: rgba(
        surface.pointStyle.outlineColor,
        'Observed point outline color',
      ),
      show: surface.entityShow && surface.pointStyle.show,
    },
    stem: {
      ...surface.lineStyle,
      color: rgba(surface.lineStyle.color, 'Observed stem color'),
      show: surface.entityShow && surface.lineStyle.show,
    },
  }));
  const sourceStyles = surfaces.map((surface) => {
    const pointStyle = surface.sourcePointStyle ?? surface.pointStyle;
    const lineStyle = surface.sourceLineStyle ?? surface.lineStyle;
    return {
      entityId: surface.entityId,
      point: {
        pixelSize: pointStyle.pixelSize,
        color: rgba(pointStyle.color, 'Source point color'),
        outlineColor: rgba(
          pointStyle.outlineColor,
          'Source point outline color',
        ),
        outlineWidth: pointStyle.outlineWidth,
        disableDepthTestDistance: pointStyle.disableDepthTestDistance,
      },
      stem: {
        width: lineStyle.width,
        color: rgba(lineStyle.color, 'Source stem color'),
      },
    };
  });
  const effectiveStemColors = surfaces.map((surface) => {
    const raw = rgba(surface.lineStyle.color, 'Observed stem color');
    return mode === 'entity'
      ? finiteColor(
          infrastructureEntityEncodedColor(Cesium, raw),
          'Encoded Entity stem color',
        )
      : raw;
  });
  return {
    styles,
    sourceStyles,
    pointStyles: styles.map(({ entityId, entityShow, point }) => ({
      entityId,
      entityShow,
      point,
    })),
    stemNonColorStyles: styles.map(({ entityId, stem }) => ({
      entityId,
      width: stem.width,
      show: stem.show,
    })),
    effectiveStemColors,
    effectiveStemColorEncoding:
      mode === 'entity'
        ? 'cesium-static-rgba8-attribute'
        : stemColorEncoding === 'entity-color-attribute-byte'
          ? 'rgba8-normalized-material-uniform'
          : 'float-polyline-material',
  };
}

/** Build fixture-owned primitive surfaces from the actual loaded Entity values. */
export function createInfrastructurePrimitiveCollections(
  Cesium,
  surfaces,
  { focusedEntityId = null, stemColorEncoding = 'direct-float-uniform' } = {},
) {
  if (!Cesium?.PointPrimitiveCollection || !Cesium?.PolylineCollection)
    throw new TypeError('Cesium point and polyline collections are required.');
  if (!Array.isArray(surfaces) || surfaces.length === 0)
    throw new TypeError('Loaded Entity surfaces are required.');
  infrastructureCollectionRepresentationId(stemColorEncoding);
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
      const collectionStemColor =
        stemColorEncoding === 'entity-color-attribute-byte'
          ? infrastructureEntityEncodedColor(Cesium, [
              stemColor.red,
              stemColor.green,
              stemColor.blue,
              stemColor.alpha,
            ])
          : stemColor;
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
        material: Cesium.Material.fromType('Color', {
          color: collectionStemColor,
        }),
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

/** Require actual ready surfaces and successful native picks after a mode switch. */
export function infrastructureModeTransitionReady(observation) {
  return Boolean(
    Number.isSafeInteger(observation?.completedFrames) &&
    observation.completedFrames >= 3 &&
    Number.isSafeInteger(observation?.stableFrames) &&
    observation.stableFrames >= 3 &&
    observation.dataSourceReady === true &&
    observation.dataSourceLoading === false &&
    Number.isSafeInteger(observation?.expectedSurfaceCount) &&
    observation.expectedSurfaceCount > 0 &&
    observation.observedSurfaceCount === observation.expectedSurfaceCount &&
    observation.pointPickResolved === true &&
    observation.stemPickResolved === true,
  );
}

/** Resolve a pick location from either Entity Cartesians or collection arrays. */
export function infrastructurePickCartesian(Cesium, surface, kind) {
  const cartesian = (value) => {
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every(Number.isFinite)
    )
      return new Cesium.Cartesian3(value[0], value[1], value[2]);
    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.z)
    )
      return value;
    throw new TypeError('Infrastructure pick coordinates are unavailable.');
  };
  if (kind === 'point') return cartesian(surface?.position);
  if (kind !== 'stem' || !Array.isArray(surface?.positions))
    throw new TypeError('Infrastructure pick kind is invalid.');
  return Cesium.Cartesian3.midpoint(
    cartesian(surface.positions[0]),
    cartesian(surface.positions[1]),
    new Cesium.Cartesian3(),
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
export function compareInfrastructureSurfaceSamples(
  entity,
  collection,
  { stemColorEncoding = 'direct-float-uniform' } = {},
) {
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
    !/^[a-f0-9]{64}$/.test(entity.styleSha256 || '') ||
    !/^[a-f0-9]{64}$/.test(collection.styleSha256 || '')
  )
    throw new Error('Entity/collection styleSha256 is invalid.');
  if (
    entity.sourceStyleSha256 !== undefined ||
    collection.sourceStyleSha256 !== undefined
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(entity.sourceStyleSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(collection.sourceStyleSha256 || '') ||
      entity.sourceStyleSha256 !== collection.sourceStyleSha256
    )
      throw new Error('Entity/collection sourceStyleSha256 differs.');
  }
  if (stemColorEncoding === 'entity-color-attribute-byte') {
    const effectiveEncodingMatches =
      entity.effectiveStemColorEncoding === 'cesium-static-rgba8-attribute' &&
      collection.effectiveStemColorEncoding ===
        'rgba8-normalized-material-uniform';
    if (
      !effectiveEncodingMatches ||
      entity.sourceStyleSha256 === undefined ||
      entity.sourceStyleSha256 !== collection.sourceStyleSha256 ||
      entity.pointStyleSha256 === undefined ||
      entity.pointStyleSha256 !== collection.pointStyleSha256 ||
      entity.stemNonColorStyleSha256 === undefined ||
      entity.stemNonColorStyleSha256 !== collection.stemNonColorStyleSha256 ||
      entity.effectiveStemColorSha256 === undefined ||
      entity.effectiveStemColorSha256 !== collection.effectiveStemColorSha256
    )
      throw new Error('RGBA8 effective stem encoding evidence differs.');
  }
  if (
    entity.styleSha256 !== collection.styleSha256 &&
    stemColorEncoding !== 'entity-color-attribute-byte'
  )
    throw new Error('Entity/collection styleSha256 differs.');
  for (const field of [
    'effectiveStemColorSha256',
    'pointStyleSha256',
    'stemNonColorStyleSha256',
  ])
    for (const sample of [entity, collection])
      if (sample[field] !== undefined && !/^[a-f0-9]{64}$/.test(sample[field]))
        throw new Error(`Entity/collection ${field} is invalid.`);
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
    report.candidateRepresentation != null &&
    (report.candidateRepresentation.id !==
      infrastructureCollectionRepresentationId(
        report.candidateRepresentation.stemColorEncoding,
      ) ||
      !report.candidateRepresentation.styleHash?.includes('RGBA'))
  )
    throw new Error(
      'Infrastructure candidate representation identity is invalid.',
    );
  if (
    report.caseCount !== expectedCases.length ||
    report.pairsPerCase !== INFRASTRUCTURE_COLLECTION_PAIRS ||
    report.samples?.length !==
      expectedCases.length * INFRASTRUCTURE_COLLECTION_PAIRS * 2 ||
    report.modeTransitions?.length !== report.samples?.length
  )
    throw new Error(
      'Infrastructure collection sample inventory is incomplete.',
    );
  if (
    !Array.isArray(report.warmupTransitions) ||
    report.warmupTransitions.length < 2 ||
    !['entity', 'collection'].every((mode) =>
      report.warmupTransitions.some(
        (transition) =>
          transition.mode === mode && transition.status === 'settled',
      ),
    )
  )
    throw new Error('Infrastructure representation warmup is incomplete.');
  for (const transition of report.warmupTransitions) {
    if (
      !Number.isFinite(transition.elapsedMs) ||
      transition.elapsedMs < 0 ||
      transition.elapsedMs > 5000 ||
      !Number.isSafeInteger(transition.completedFrames) ||
      transition.completedFrames < 3 ||
      !Number.isSafeInteger(transition.stableFrames) ||
      transition.stableFrames < 3 ||
      transition.dataSourceReady !== true ||
      transition.dataSourceLoading !== false ||
      !Number.isSafeInteger(transition.expectedSurfaceCount) ||
      transition.expectedSurfaceCount <= 0 ||
      transition.observedSurfaceCount !== transition.expectedSurfaceCount ||
      transition.pointPickResolved !== true ||
      transition.stemPickResolved !== true
    )
      throw new Error('Infrastructure representation warmup is invalid.');
  }
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
        const transition = sample.modeTransition;
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
          transition?.status !== 'settled' ||
          transition.caseId !== caseId ||
          transition.pair !== pair ||
          transition.mode !== sample.mode ||
          !Number.isFinite(transition.elapsedMs) ||
          transition.elapsedMs < 0 ||
          transition.elapsedMs > 5000 ||
          !Number.isSafeInteger(transition.completedFrames) ||
          transition.completedFrames < 3 ||
          !Number.isSafeInteger(transition.stableFrames) ||
          transition.stableFrames < 3 ||
          transition.dataSourceReady !== true ||
          transition.dataSourceLoading !== false ||
          transition.expectedSurfaceCount !== sample.surfaceCount ||
          transition.observedSurfaceCount !== sample.surfaceCount ||
          transition.pointPickResolved !== true ||
          transition.stemPickResolved !== true ||
          !/^[a-f0-9]{64}$/.test(sample.identitySha256) ||
          !/^[a-f0-9]{64}$/.test(sample.positionSha256) ||
          !/^[a-f0-9]{64}$/.test(sample.styleSha256) ||
          (report.candidateRepresentation != null &&
            (!/^[a-f0-9]{64}$/.test(sample.sourceStyleSha256 || '') ||
              !/^[a-f0-9]{64}$/.test(sample.pointStyleSha256 || '') ||
              !/^[a-f0-9]{64}$/.test(sample.stemNonColorStyleSha256 || '') ||
              !/^[a-f0-9]{64}$/.test(sample.effectiveStemColorSha256 || '') ||
              ![
                'cesium-static-rgba8-attribute',
                'rgba8-normalized-material-uniform',
                'float-polyline-material',
              ].includes(sample.effectiveStemColorEncoding))) ||
          (report.candidateRepresentation != null &&
            sample.effectiveStemColorEncoding !==
              (sample.mode === 'entity'
                ? 'cesium-static-rgba8-attribute'
                : report.candidateRepresentation.stemColorEncoding ===
                    'entity-color-attribute-byte'
                  ? 'rgba8-normalized-material-uniform'
                  : 'float-polyline-material')) ||
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
      compareInfrastructureSurfaceSamples(entity, collection, {
        stemColorEncoding:
          report.candidateRepresentation?.stemColorEncoding ||
          'direct-float-uniform',
      });
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
