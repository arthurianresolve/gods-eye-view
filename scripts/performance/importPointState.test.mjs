import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { inspectImportedPointState } from './importPointState.mjs';

function fixture() {
  const entities = new Cesium.EntityCollection();
  const clock = { currentTime: new Cesium.JulianDate() };
  const cluster = new Cesium.EntityCluster();
  const pointVisualizer = new Cesium.PointVisualizer(cluster, entities);
  const labelVisualizer = new Cesium.LabelVisualizer(cluster, entities);
  const billboardVisualizer = new Cesium.BillboardVisualizer(cluster, entities);
  const sourceEntities = ['one', 'two'].map((name, index) =>
    entities.add({
      id: `gev-import:fixture:${name}`,
      name: `Point ${name}`,
      position: new Cesium.Cartesian3(index + 1, 2, 3),
      point: {
        pixelSize: 9,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
    }),
  );

  for (const entity of sourceEntities) {
    const point = cluster.getPoint(entity);
    point.id = entity;
    point.show = true;
    point.position = entity.position.getValue(clock.currentTime);
    point.pixelSize = entity.point.pixelSize.getValue(clock.currentTime);
    point.color = entity.point.color.getValue(clock.currentTime);
    point.outlineColor = entity.point.outlineColor.getValue(clock.currentTime);
    point.outlineWidth = entity.point.outlineWidth.getValue(clock.currentTime);
    pointVisualizer._items.get(entity.id).pointPrimitive = point;
  }

  const viewer = {
    entities,
    clock,
    dataSourceDisplay: {
      defaultDataSource: {
        _visualizers: [labelVisualizer, billboardVisualizer, pointVisualizer],
      },
    },
  };
  return {
    viewer,
    dispose() {
      pointVisualizer.destroy();
      labelVisualizer.destroy();
      billboardVisualizer.destroy();
      cluster.destroy();
      entities.removeAll();
    },
  };
}

test('point state snapshot binds Entity order to the owned Cesium primitive order', () => {
  const { viewer, dispose } = fixture();
  try {
    const snapshot = inspectImportedPointState(viewer, {
      Cesium,
      workspaceId: 'fixture',
      expectedCount: 2,
    });
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.entityCount, 2);
    assert.deepEqual(
      snapshot.entityRows.map((row) => row.id),
      ['gev-import:fixture:one', 'gev-import:fixture:two'],
    );
    assert.deepEqual(
      snapshot.primitiveRows.map((row) => row.id),
      ['gev-import:fixture:one', 'gev-import:fixture:two'],
    );
    assert.deepEqual(snapshot.entityRows[1].position, [2, 2, 3]);
    assert.equal(snapshot.primitiveRows[1].pixelSize, 9);
    assert.equal(snapshot.drawAssignmentRows[1].primitiveIndex, 1);
  } finally {
    dispose();
  }
});

test('point state ignores sibling Entity visualizers that share the point cluster', () => {
  const { viewer, dispose } = fixture();
  try {
    assert.equal(
      viewer.dataSourceDisplay.defaultDataSource._visualizers.length,
      3,
    );
    const snapshot = inspectImportedPointState(viewer, {
      Cesium,
      workspaceId: 'fixture',
      expectedCount: 2,
    });
    assert.equal(snapshot.available, true);
  } finally {
    dispose();
  }
});

test('point state snapshot fails closed on version, shape, count, or ownership drift', () => {
  const { viewer, dispose } = fixture();
  try {
    assert.deepEqual(
      inspectImportedPointState(viewer, {
        Cesium: { ...Cesium, VERSION: '1.139.0' },
        workspaceId: 'fixture',
        expectedCount: 2,
      }),
      {
        available: false,
        reason: 'unsupported-cesium-version',
        version: '1.139.0',
      },
    );
    assert.equal(
      inspectImportedPointState(viewer, {
        Cesium,
        workspaceId: 'fixture',
        expectedCount: 3,
      }).reason,
      'point-population-count-mismatch',
    );

    const visualizers = viewer.dataSourceDisplay.defaultDataSource._visualizers;
    const pointVisualizer = visualizers.find(
      (visualizer) => visualizer instanceof Cesium.PointVisualizer,
    );
    const originalCollection = pointVisualizer._entityCollection;
    pointVisualizer._entityCollection = new Cesium.EntityCollection();
    assert.equal(
      inspectImportedPointState(viewer, {
        Cesium,
        workspaceId: 'fixture',
        expectedCount: 2,
      }).reason,
      'point-visualizer-shape-mismatch',
    );
    pointVisualizer._entityCollection = originalCollection;

    const originalId = pointVisualizer._cluster._pointCollection.get(1).id;
    pointVisualizer._cluster._pointCollection.get(1).id = {};
    assert.equal(
      inspectImportedPointState(viewer, {
        Cesium,
        workspaceId: 'fixture',
        expectedCount: 2,
      }).reason,
      'point-visualizer-entity-ownership-mismatch',
    );
    pointVisualizer._cluster._pointCollection.get(1).id = originalId;
  } finally {
    dispose();
  }
});
