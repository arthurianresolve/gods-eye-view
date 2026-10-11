export const INFRASTRUCTURE_FIXTURE_LAYERS = Object.freeze({
  'local-dams': Object.freeze({
    layerId: 'local-dams',
    layerName: 'Dams',
    schema: 'gev-infrastructure-runtime-renderers/v3',
    benefitSchema: 'gev-infrastructure-benefit-comparison/v2',
    sourceFeatureCount: 704,
    geometryKinds: Object.freeze({
      Point: 5,
      Polygon: 688,
      MultiPolygon: 4,
      LineString: 6,
      MultiLineString: 1,
    }),
    entityCount: 716,
    surfaceCount: 704,
    preservedGraphics: Object.freeze({
      points: 0,
      polylines: 12,
      polygons: 699,
    }),
  }),
  'local-datacenters': Object.freeze({
    layerId: 'local-datacenters',
    layerName: 'Datacenters',
    schema: 'gev-infrastructure-runtime-renderers/v4',
    benefitSchema: 'gev-infrastructure-benefit-comparison/v3',
    sourceFeatureCount: 4351,
    geometryKinds: Object.freeze({
      Point: 834,
      Polygon: 3509,
      MultiPolygon: 8,
    }),
    entityCount: 4362,
    surfaceCount: 4362,
    preservedGraphics: Object.freeze({
      points: 0,
      polylines: 0,
      polygons: 3528,
    }),
  }),
});

export const DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID = 'local-dams';

export function infrastructureFixtureLayer(
  layerId = DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID,
) {
  if (!Object.hasOwn(INFRASTRUCTURE_FIXTURE_LAYERS, layerId))
    throw new Error(`Unsupported infrastructure fixture layer: ${layerId}`);
  return INFRASTRUCTURE_FIXTURE_LAYERS[layerId];
}

export function assertInfrastructureSourceInventory(source, expectedLayer) {
  const expected =
    typeof expectedLayer === 'string'
      ? infrastructureFixtureLayer(expectedLayer)
      : expectedLayer;
  const actualKinds = Object.fromEntries(
    Object.entries(source?.geometryKinds || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const expectedKinds = Object.fromEntries(
    Object.entries(expected.geometryKinds).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  if (
    source?.layerId !== expected.layerId ||
    source.featureCount !== expected.sourceFeatureCount ||
    JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds)
  )
    throw new Error(`${expected.layerId} bundled source inventory changed.`);
  return true;
}
