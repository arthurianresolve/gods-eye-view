/** Resolve a native pick to a visible surface owned by this layer and renderer. */
export function resolveInfrastructureNativePickOwner({
  picked,
  kind,
  requestedEntity,
  rowsByEntity,
  primitivesByEntity,
  layerId,
  mode,
  Cesium,
}) {
  if (
    !['point', 'stem'].includes(kind) ||
    !['entities', 'primitive-collections'].includes(mode) ||
    !['local-dams', 'local-datacenters'].includes(layerId) ||
    !(rowsByEntity instanceof Map) ||
    (mode === 'primitive-collections' && !(primitivesByEntity instanceof Map))
  )
    return null;
  const row = rowsByEntity.get(picked?.id);
  if (
    !row ||
    row.entity !== picked.id ||
    row.entityId !== String(row.entity?.id ?? '') ||
    row.layerId !== layerId ||
    !row.sourceRecordId ||
    (layerId !== 'local-datacenters' && row.entity !== requestedEntity) ||
    !row.entityShow ||
    !(kind === 'point' ? row.point?.show : row.stem?.show)
  )
    return null;

  if (mode === 'primitive-collections') {
    const expected = primitivesByEntity.get(row.entity)?.[kind];
    if (!expected || picked.primitive !== expected) return null;
  } else if (kind === 'point') {
    if (!(picked.primitive instanceof Cesium.PointPrimitive)) return null;
  } else {
    const primitive = picked.primitive;
    const defaultStemPrimitive =
      primitive instanceof Cesium.GroundPolylinePrimitive ||
      (primitive instanceof Cesium.Primitive &&
        (primitive.appearance instanceof Cesium.PolylineColorAppearance ||
          primitive.appearance instanceof Cesium.PolylineMaterialAppearance));
    if (!defaultStemPrimitive) return null;
  }

  return {
    row,
    primitiveType: picked.primitive?.constructor?.name || null,
    appearanceType: picked.primitive?.appearance?.constructor?.name || null,
  };
}
