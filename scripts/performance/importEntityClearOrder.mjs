import * as Cesium from 'cesium';

/** Reproduce EntityCluster point-index reuse for two real EntityCollection paths. */
export function reproducePointPrimitiveReuseOrder({
  count = 5000,
  clearMode,
  repeats = 2,
} = {}) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(repeats) ||
    repeats < 1 ||
    !['removeAll', 'removeById'].includes(clearMode)
  )
    throw new TypeError('Invalid EntityCollection reuse-order probe inputs.');

  const entities = new Cesium.EntityCollection();
  const cluster = new Cesium.EntityCluster();
  const visualizer = new Cesium.PointVisualizer(cluster, entities);
  const time = new Cesium.JulianDate();
  const addPopulation = () => {
    for (let index = 0; index < count; index++)
      entities.add({
        id: `gev-import:fixture:fixture:${index}`,
        name: `Fixture ${index}`,
        position: Cesium.Cartesian3.fromDegrees(
          (index % 100) * 0.003 - 0.15,
          Math.floor(index / 100) * 0.003 - 0.075,
        ),
        point: {
          pixelSize: 9,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
        },
      });
  };
  const mapping = () =>
    entities.values.map((entity) => ({
      id: entity.id,
      primitiveIndex:
        cluster._collectionIndicesByEntity[entity.id]?.pointIndex ?? null,
    }));

  try {
    addPopulation();
    visualizer.update(time);
    const original = mapping();
    const passes = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      if (clearMode === 'removeAll') entities.removeAll();
      else
        for (let index = 0; index < count; index++)
          entities.removeById(`gev-import:fixture:fixture:${index}`);
      addPopulation();
      visualizer.update(time);
      const current = mapping();
      const sameIndexCount = current.reduce(
        (sum, row, index) =>
          sum + Number(row.primitiveIndex === original[index]?.primitiveIndex),
        0,
      );
      passes.push({
        sameIndexCount,
        count,
        entityOrderPrefix: current.slice(0, 8),
        primitiveOrderPrefix: Array.from(
          { length: Math.min(count, 8) },
          (_, index) => cluster._pointCollection.get(index)?.id?.id ?? null,
        ),
      });
    }
    return {
      cesiumVersion: Cesium.VERSION,
      clearMode,
      count,
      repeats,
      initialEntityOrderPrefix: original.slice(0, 8),
      passes,
    };
  } finally {
    visualizer.destroy();
    cluster.destroy();
    entities.removeAll();
  }
}
