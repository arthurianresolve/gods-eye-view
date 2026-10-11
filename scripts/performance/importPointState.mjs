const CESIUM_VERSION = '1.138.0';

function unavailable(reason, version = null) {
  return { available: false, reason, version };
}

function finiteVector(value) {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.z)
  )
    return null;
  return [value.x, value.y, value.z];
}

function finiteColor(value) {
  if (
    !value ||
    !Number.isFinite(value.red) ||
    !Number.isFinite(value.green) ||
    !Number.isFinite(value.blue) ||
    !Number.isFinite(value.alpha)
  )
    return null;
  return [value.red, value.green, value.blue, value.alpha];
}

/**
 * Return the owned default Entity point count through the pinned Cesium
 * PointVisualizer/EntityCluster adapter. This is a bounded resource census,
 * not a general traversal of arbitrary private engine objects.
 */
export function inspectDefaultEntityPointPrimitiveCount(
  viewer,
  { Cesium, workspaceId, expectedCount },
) {
  const version = Cesium?.VERSION ?? null;
  if (version !== CESIUM_VERSION)
    return unavailable('unsupported-cesium-version', version);
  if (
    typeof workspaceId !== 'string' ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0
  )
    return unavailable('invalid-request', version);

  const entities = viewer?.entities?.values;
  const visualizers =
    viewer?.dataSourceDisplay?.defaultDataSource?._visualizers;
  if (!Array.isArray(entities) || !Array.isArray(visualizers))
    return unavailable('default-entity-visualizer-unavailable', version);
  const candidates = visualizers.filter(
    (visualizer) =>
      visualizer instanceof Cesium.PointVisualizer &&
      visualizer?._entityCollection === viewer.entities &&
      visualizer._items?.values &&
      typeof visualizer._items.get === 'function' &&
      visualizer._cluster?._pointCollection instanceof
        Cesium.PointPrimitiveCollection &&
      visualizer._cluster?._collectionIndicesByEntity,
  );
  if (candidates.length !== 1)
    return unavailable('point-visualizer-shape-mismatch', version);

  const prefix = `gev-import:${workspaceId}:`;
  const imported = entities.filter(
    (entity) => typeof entity?.id === 'string' && entity.id.startsWith(prefix),
  );
  const visualizer = candidates[0];
  const cluster = visualizer._cluster;
  const collection = cluster._pointCollection;
  const items = visualizer._items.values;
  if (
    imported.length !== expectedCount ||
    items.length !== expectedCount ||
    collection.length !== expectedCount ||
    typeof collection.get !== 'function'
  )
    return unavailable('point-population-count-mismatch', version);

  const importedById = new Map(imported.map((entity) => [entity.id, entity]));
  if (importedById.size !== expectedCount)
    return unavailable('duplicate-or-missing-point-identity', version);
  for (const entity of imported) {
    const item = visualizer._items.get(entity.id);
    const index = cluster._collectionIndicesByEntity[entity.id]?.pointIndex;
    const point = Number.isInteger(index) ? collection.get(index) : null;
    if (
      !item ||
      item.entity !== entity ||
      item.pointPrimitive !== point ||
      point?.id !== entity
    )
      return unavailable('point-visualizer-entity-ownership-mismatch', version);
  }
  for (let index = 0; index < collection.length; index++) {
    const point = collection.get(index);
    const entity = point?.id;
    if (
      !entity ||
      importedById.get(entity.id) !== entity ||
      cluster._collectionIndicesByEntity[entity.id]?.pointIndex !== index
    )
      return unavailable('point-collection-order-mismatch', version);
  }
  return { available: true, version, pointCount: collection.length };
}

/**
 * Read a version-pinned snapshot of the default Entity point visualizer.
 * Cesium's visualizer and EntityCluster fields are private; any version or
 * shape change returns unavailable rather than a misleading partial pass.
 */
export function inspectImportedPointState(
  viewer,
  { Cesium, workspaceId, expectedCount, pointRepresentation = 'entity', layer },
) {
  const version = Cesium?.VERSION ?? null;
  if (version !== CESIUM_VERSION)
    return unavailable('unsupported-cesium-version', version);
  if (
    typeof workspaceId !== 'string' ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0
  )
    return unavailable('invalid-request', version);

  if (pointRepresentation === 'primitive-collection') {
    if (typeof layer?.getPointRendererSnapshot !== 'function')
      return unavailable('point-collection-snapshot-unavailable', version);
    const snapshot = layer.getPointRendererSnapshot();
    if (
      !snapshot ||
      snapshot.pointCount !== expectedCount ||
      snapshot.blendOption !== Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT ||
      !Array.isArray(snapshot.entityRows) ||
      snapshot.entityRows.length !== expectedCount ||
      !Array.isArray(snapshot.primitiveRows) ||
      snapshot.primitiveRows.length !== expectedCount
    )
      return unavailable('point-collection-population-mismatch', version);
    const prefix = `gev-import:${workspaceId}:`;
    const ids = new Set();
    for (let index = 0; index < expectedCount; index++) {
      const entity = snapshot.entityRows[index];
      const primitive = snapshot.primitiveRows[index];
      if (
        typeof entity?.id !== 'string' ||
        !entity.id.startsWith(prefix) ||
        ids.has(entity.id) ||
        entity.id !== primitive?.id ||
        !finiteTriple(entity.position) ||
        !finiteTriple(primitive.position) ||
        !sameTriple(entity.position, primitive.position) ||
        !Array.isArray(entity.color) ||
        !Array.isArray(entity.outlineColor) ||
        !Array.isArray(primitive.color) ||
        !Array.isArray(primitive.outlineColor) ||
        !finiteQuad(entity.color) ||
        !finiteQuad(entity.outlineColor) ||
        !sameArray(entity.color, primitive.color) ||
        !sameArray(entity.outlineColor, primitive.outlineColor) ||
        entity.pixelSize !== primitive.pixelSize ||
        entity.outlineWidth !== primitive.outlineWidth ||
        entity.pixelSize !== 9 ||
        entity.outlineWidth !== 1 ||
        !sameArray(entity.color, [0, 1, 1, 1]) ||
        !sameArray(entity.outlineColor, [0, 0, 0, 1]) ||
        primitive.disableDepthTestDistance !== 0 ||
        primitive.splitDirection !== Cesium.SplitDirection.NONE ||
        primitive.scaleByDistance !== null ||
        primitive.translucencyByDistance !== null ||
        primitive.distanceDisplayCondition !== null ||
        primitive.show !== true
      )
        return unavailable(
          'point-collection-identity-or-state-mismatch',
          version,
        );
      ids.add(entity.id);
    }
    return {
      available: true,
      version,
      expectedCount,
      renderer: 'primitive-collection',
      entityCount: expectedCount,
      visualizerItemCount: 0,
      primitiveCount: snapshot.pointCount,
      blendOption: snapshot.blendOption,
      entityRows: snapshot.entityRows,
      drawAssignmentRows: snapshot.entityRows.map((row, primitiveIndex) => ({
        id: row.id,
        primitiveIndex,
      })),
      primitiveRows: snapshot.primitiveRows,
    };
  }
  if (pointRepresentation !== 'entity')
    return unavailable('unknown-point-representation', version);

  const entities = viewer?.entities?.values;
  const visualizers =
    viewer?.dataSourceDisplay?.defaultDataSource?._visualizers;
  if (!Array.isArray(entities) || !Array.isArray(visualizers))
    return unavailable('default-entity-visualizer-unavailable', version);

  const candidates = visualizers.filter(
    (visualizer) =>
      visualizer instanceof Cesium.PointVisualizer &&
      visualizer?._entityCollection === viewer.entities &&
      visualizer._items?.values &&
      typeof visualizer._items.get === 'function' &&
      visualizer._cluster?._pointCollection instanceof
        Cesium.PointPrimitiveCollection &&
      visualizer._cluster?._collectionIndicesByEntity,
  );
  if (candidates.length !== 1)
    return unavailable('point-visualizer-shape-mismatch', version);

  const prefix = `gev-import:${workspaceId}:`;
  const imported = entities.filter(
    (entity) => typeof entity?.id === 'string' && entity.id.startsWith(prefix),
  );
  const visualizer = candidates[0];
  const items = visualizer._items.values;
  const cluster = visualizer._cluster;
  const collection = cluster._pointCollection;
  if (
    imported.length !== expectedCount ||
    items.length !== expectedCount ||
    !Number.isSafeInteger(collection.length) ||
    collection.length !== expectedCount ||
    typeof collection.get !== 'function'
  )
    return unavailable('point-population-count-mismatch', version);

  const importedById = new Map(imported.map((entity) => [entity.id, entity]));
  const itemById = new Map(items.map((item) => [item?.entity?.id, item]));
  if (importedById.size !== expectedCount || itemById.size !== expectedCount)
    return unavailable('duplicate-or-missing-point-identity', version);

  const entityRows = [];
  const drawAssignmentRows = [];
  for (const entity of imported) {
    const item = itemById.get(entity.id);
    const index = cluster._collectionIndicesByEntity[entity.id]?.pointIndex;
    const point = Number.isInteger(index) ? collection.get(index) : null;
    const position = entity.position?.getValue(viewer.clock.currentTime);
    const pointGraphics = entity.point;
    const pointPosition = finiteVector(point?.position);
    const entityPosition = finiteVector(position);
    const color = finiteColor(point?.color);
    const outlineColor = finiteColor(point?.outlineColor);
    if (
      !item ||
      item.entity !== entity ||
      item.pointPrimitive !== point ||
      point?.id !== entity ||
      point?.show !== true ||
      !pointPosition ||
      !entityPosition ||
      !color ||
      !outlineColor ||
      !Number.isFinite(point.pixelSize) ||
      point.pixelSize !==
        pointGraphics?.pixelSize?.getValue(viewer.clock.currentTime)
    )
      return unavailable('point-visualizer-entity-ownership-mismatch', version);
    entityRows.push({
      id: entity.id,
      name: entity.name,
      position: entityPosition,
      pixelSize: pointGraphics.pixelSize.getValue(viewer.clock.currentTime),
      color: finiteColor(
        pointGraphics.color.getValue(viewer.clock.currentTime),
      ),
      outlineColor: finiteColor(
        pointGraphics.outlineColor.getValue(viewer.clock.currentTime),
      ),
      outlineWidth: pointGraphics.outlineWidth.getValue(
        viewer.clock.currentTime,
      ),
    });
    drawAssignmentRows.push({ id: entity.id, primitiveIndex: index });
  }

  const primitiveRows = [];
  for (let index = 0; index < collection.length; index++) {
    const point = collection.get(index);
    const entity = point?.id;
    if (
      !entity ||
      importedById.get(entity.id) !== entity ||
      cluster._collectionIndicesByEntity[entity.id]?.pointIndex !== index
    )
      return unavailable('point-collection-order-mismatch', version);
    primitiveRows.push({
      id: entity.id,
      position: finiteVector(point.position),
      color: finiteColor(point.color),
      outlineColor: finiteColor(point.outlineColor),
      outlineWidth: point.outlineWidth,
      pixelSize: point.pixelSize,
      disableDepthTestDistance: point.disableDepthTestDistance,
      splitDirection: point.splitDirection,
      scaleByDistance: nearFar(point.scaleByDistance),
      translucencyByDistance: nearFar(point.translucencyByDistance),
      distanceDisplayCondition: point.distanceDisplayCondition
        ? [
            point.distanceDisplayCondition.near,
            point.distanceDisplayCondition.far,
          ]
        : null,
      show: point.show,
    });
  }

  return {
    available: true,
    version,
    renderer: 'entity',
    expectedCount,
    entityCount: imported.length,
    visualizerItemCount: items.length,
    primitiveCount: collection.length,
    blendOption: collection.blendOption,
    entityRows,
    drawAssignmentRows,
    primitiveRows,
  };
}

function finiteTriple(value) {
  return (
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  );
}

function sameTriple(left, right) {
  return left.every((value, index) => Object.is(value, right[index]));
}

function finiteQuad(value) {
  return (
    Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
  );
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  );
}

function nearFar(value) {
  return value
    ? [value.near, value.nearValue, value.far, value.farValue]
    : null;
}
