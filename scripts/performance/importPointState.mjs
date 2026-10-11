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
 * Read a version-pinned snapshot of the default Entity point visualizer.
 * Cesium's visualizer and EntityCluster fields are private; any version or
 * shape change returns unavailable rather than a misleading partial pass.
 */
export function inspectImportedPointState(
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
      show: point.show,
    });
  }

  return {
    available: true,
    version,
    expectedCount,
    entityCount: imported.length,
    visualizerItemCount: items.length,
    primitiveCount: collection.length,
    entityRows,
    drawAssignmentRows,
    primitiveRows,
  };
}
