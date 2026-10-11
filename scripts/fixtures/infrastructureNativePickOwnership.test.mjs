import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInfrastructureNativePickOwner } from './infrastructureNativePickOwnership.mjs';

class PointPrimitive {}
class GroundPolylinePrimitive {}
class Primitive {}
class Polyline {}
class PolylineColorAppearance {}
class PolylineMaterialAppearance {}

const Cesium = {
  PointPrimitive,
  GroundPolylinePrimitive,
  Primitive,
  PolylineColorAppearance,
  PolylineMaterialAppearance,
};

function rows() {
  const pointEntity = { id: 'point-owner' };
  const stemEntity = { id: 'stem-owner' };
  const requestedEntity = { id: 'projected-anchor' };
  const pointRow = {
    entity: pointEntity,
    entityId: pointEntity.id,
    sourceRecordId: 'point-source',
    layerId: 'local-datacenters',
    entityShow: true,
    point: { show: true },
    stem: { show: true },
  };
  const stemRow = {
    entity: stemEntity,
    entityId: stemEntity.id,
    sourceRecordId: 'stem-source',
    layerId: 'local-datacenters',
    entityShow: true,
    point: { show: true },
    stem: { show: true },
  };
  return {
    pointEntity,
    stemEntity,
    requestedEntity,
    rowsByEntity: new Map([
      [pointEntity, pointRow],
      [stemEntity, stemRow],
    ]),
    primitivesByEntity: new Map(),
  };
}

function resolve(context, options = {}) {
  const entity = options.entity || context.pointEntity;
  const primitive = options.primitive || new PointPrimitive();
  return resolveInfrastructureNativePickOwner({
    picked: { id: entity, primitive },
    kind: options.kind || 'point',
    requestedEntity: options.requestedEntity || context.requestedEntity,
    rowsByEntity: options.rowsByEntity || context.rowsByEntity,
    primitivesByEntity:
      options.primitivesByEntity || context.primitivesByEntity,
    layerId: options.layerId || 'local-datacenters',
    mode: options.mode || 'entities',
    Cesium,
  });
}

test('a native overlapping hit resolves to its actual datacenter owner', () => {
  const context = rows();
  const result = resolve(context);
  assert.equal(result.row.entity, context.pointEntity);
  assert.equal(result.row.sourceRecordId, 'point-source');
  assert.equal(result.primitiveType, 'PointPrimitive');
});

test('default Entity picks accept the baseline null collection-index shape', () => {
  const context = rows();
  const result = resolveInfrastructureNativePickOwner({
    picked: {
      id: context.pointEntity,
      primitive: new PointPrimitive(),
    },
    kind: 'point',
    requestedEntity: context.requestedEntity,
    rowsByEntity: context.rowsByEntity,
    primitivesByEntity: null,
    layerId: 'local-datacenters',
    mode: 'entities',
    Cesium,
  });
  assert.equal(result.row.entity, context.pointEntity);
});

test('foreign and wrong-layer Entities are rejected even with valid primitive types', () => {
  const context = rows();
  assert.equal(resolve(context, { entity: { id: 'foreign' } }), null);
  const wrongLayer = new Map(context.rowsByEntity);
  wrongLayer.get(context.pointEntity).layerId = 'local-dams';
  assert.equal(resolve(context, { rowsByEntity: wrongLayer }), null);
});

test('native picks reject a primitive of the wrong surface kind', () => {
  const context = rows();
  assert.equal(
    resolve(context, { primitive: new GroundPolylinePrimitive() }),
    null,
  );
  assert.equal(
    resolve(context, { kind: 'stem', primitive: new PointPrimitive() }),
    null,
  );
  const validStem = resolve(context, {
    entity: context.stemEntity,
    kind: 'stem',
    primitive: Object.assign(new Primitive(), {
      appearance: new PolylineColorAppearance(),
    }),
  });
  assert.equal(validStem.row.entity, context.stemEntity);
  assert.equal(validStem.appearanceType, 'PolylineColorAppearance');
});

test('collection picks must be the exact primitive attached to the picked Entity', () => {
  const context = rows();
  const point = new PointPrimitive();
  const stem = new Polyline();
  context.primitivesByEntity.set(context.pointEntity, { point, stem });
  assert.equal(
    resolve(context, {
      mode: 'primitive-collections',
      primitive: new PointPrimitive(),
    }),
    null,
  );
  assert.equal(
    resolve(context, { mode: 'primitive-collections', primitive: point }).row
      .entity,
    context.pointEntity,
  );
  assert.equal(
    resolve(context, {
      entity: context.stemEntity,
      kind: 'stem',
      mode: 'primitive-collections',
      primitive: stem,
    }),
    null,
  );
});

test('non-DCS layers retain the exact requested-row ownership contract', () => {
  const context = rows();
  for (const row of context.rowsByEntity.values()) row.layerId = 'local-dams';
  assert.equal(
    resolve(context, {
      requestedEntity: context.stemEntity,
      layerId: 'local-dams',
    }),
    null,
  );
  assert.equal(
    resolve(context, {
      entity: context.stemEntity,
      requestedEntity: context.stemEntity,
      layerId: 'local-dams',
    }).row.entity,
    context.stemEntity,
  );
  assert.equal(resolve(context, { kind: 'other' }), null);
  assert.equal(resolve(context, { mode: 'unknown' }), null);
});
