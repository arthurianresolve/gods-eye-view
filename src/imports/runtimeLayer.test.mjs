import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createImportedGeometryLayer } from './runtimeLayer.js';
import {
  getContextStore,
  getSelectedEntityContext,
} from '../data/contextStore.js';

function fixture(
  t,
  {
    advancePreparationClock = false,
    pointRepresentation = 'entity',
    manageWindow = true,
  } = {},
) {
  const previous = globalThis.window;
  if (manageWindow) globalThis.window = { dispatchEvent() {} };
  let clock = 0,
    handlers = 0,
    renders = 0;
  const timers = new Map();
  let timerId = 0;
  const entities = new Cesium.EntityCollection();
  const primitives = new Cesium.PrimitiveCollection();
  const inputActions = new Map();
  const originalAdd = entities.add.bind(entities);
  entities.add = (entity) => {
    clock += 2;
    return originalAdd(entity);
  };
  const viewer = {
    entities,
    scene: {
      canvas: {},
      primitives,
      pick: () => null,
      requestRender() {
        renders++;
      },
    },
  };
  const layer = createImportedGeometryLayer({
    viewer,
    pointRepresentation,
    now: () => 1000,
    batchOptions: {
      now: () => (advancePreparationClock ? (clock += 2) : clock),
      schedule(fn) {
        timers.set(++timerId, fn);
        return timerId;
      },
      cancel(id) {
        timers.delete(id);
      },
    },
    screenSpaceEventHandlerFactory() {
      handlers++;
      return {
        setInputAction(callback, type) {
          inputActions.set(type, callback);
        },
        destroy() {
          handlers--;
        },
      };
    },
  });
  t.after(() => {
    layer.destroy();
    if (!primitives.isDestroyed()) primitives.destroy();
    if (manageWindow) {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });
  const flush = () => {
    while (timers.size) {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    }
  };
  return {
    layer,
    entities,
    primitives,
    viewer,
    timers,
    inputActions,
    flush,
    handlers: () => handlers,
    renders: () => renders,
  };
}
const records = (count) => [
  {
    id: 'fixture',
    kind: 'geojson',
    attribution: 'Field survey',
    records: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      properties: { name: `Site ${i}` },
      geometry: { type: 'Point', coordinates: [10 + i * 0.001, 40] },
    })),
  },
];

test('primitive point mode preserves Entity metadata, exact style, and native pick identity', (t) => {
  const env = fixture(t, { pointRepresentation: 'primitive-collection' });
  env.layer.load(records(3), { workspaceId: 'points' });

  assert.equal(env.entities.values.length, 0);
  assert.equal(env.layer.getState().featureCount, 3);
  assert.equal(env.layer.getPerformanceDiagnostics().pointPrimitiveCount, 3);
  const snapshot = env.layer.getPointRendererSnapshot();
  assert.equal(snapshot.pointCount, 3);
  assert.deepEqual(
    snapshot.entityRows.map(
      ({ id, name, pixelSize, color, outlineColor, outlineWidth }) => ({
        id,
        name,
        pixelSize,
        color,
        outlineColor,
        outlineWidth,
      }),
    ),
    [0, 1, 2].map((index) => ({
      id: `gev-import:points:fixture:${index}`,
      name: `Site ${index}`,
      pixelSize: 9,
      color: [0, 1, 1, 1],
      outlineColor: [0, 0, 0, 1],
      outlineWidth: 1,
    })),
  );
  const collection = env.primitives.get(0);
  assert.ok(collection instanceof Cesium.PointPrimitiveCollection);
  assert.equal(
    collection.blendOption,
    Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT,
  );
  assert.equal(collection.length, 3);
  const pickedEntity = snapshot.entityRows[1];
  const contextEntity = getContextStore().entities.get(pickedEntity.id).entity;
  assert.ok(contextEntity instanceof Cesium.Entity);
  assert.equal(
    contextEntity.position.getValue().x,
    collection.get(1).position.x,
  );
  assert.equal(collection.get(1).id, contextEntity);
  assert.equal(contextEntity.point.pixelSize.getValue(), 9);
  env.viewer.scene.pick = () => ({ id: collection.get(1).id });
  env.inputActions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
    position: { x: 1, y: 1 },
  });
  assert.equal(getSelectedEntityContext()?.entity, contextEntity);
  assert.equal(getSelectedEntityContext()?.evidence.entityRef.id, '1');
});

test('primitive point mode leaves non-point graphics on viewer.entities and preserves external primitives on clear', (t) => {
  const env = fixture(t, { pointRepresentation: 'primitive-collection' });
  const outside = env.primitives.add(new Cesium.PointPrimitiveCollection());
  const input = [
    {
      id: 'mixed',
      kind: 'geojson',
      attribution: 'Survey',
      records: [
        { id: 'point', geometry: { type: 'Point', coordinates: [10, 40] } },
        {
          id: 'line',
          geometry: {
            type: 'LineString',
            coordinates: [
              [10, 40],
              [11, 41],
            ],
          },
        },
        {
          id: 'polygon',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [10, 40],
                [11, 40],
                [11, 41],
                [10, 40],
              ],
            ],
          },
        },
      ],
    },
  ];
  env.layer.load(input, { workspaceId: 'mixed' });
  assert.deepEqual(
    env.entities.values.map((entity) => entity.id),
    ['gev-import:mixed:mixed:line', 'gev-import:mixed:mixed:polygon'],
  );
  assert.equal(env.layer.getPointRendererSnapshot().pointCount, 1);
  assert.equal(env.layer.getState().featureCount, 3);
  assert.equal(getContextStore().entities.size, 3);

  env.layer.clear();
  assert.equal(env.entities.values.length, 0);
  assert.equal(env.primitives.length, 1);
  assert.equal(env.primitives.get(0), outside);
  assert.equal(outside.isDestroyed(), false);
  assert.equal(env.layer.getPointRendererSnapshot().pointCount, 0);
  assert.equal(getContextStore().entities.size, 0);
});

test('primitive point mode keeps mixed geometry parity and point selection beside line and polygon Entities', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  const input = [
    {
      id: 'mixed-parity',
      kind: 'geojson',
      attribution: 'Survey',
      records: [
        {
          id: 'point',
          properties: { name: 'Marker' },
          geometry: { type: 'Point', coordinates: [10, 40] },
        },
        {
          id: 'line',
          geometry: {
            type: 'LineString',
            coordinates: [
              [10, 40],
              [11, 41],
            ],
          },
        },
        {
          id: 'polygon',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [10, 40],
                [11, 40],
                [11, 41],
                [10, 40],
              ],
            ],
          },
        },
      ],
    },
  ];
  const summarize = (entities) =>
    entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      position: entity.position?.getValue()?.toString(),
      point: entity.point
        ? {
            pixelSize: entity.point.pixelSize.getValue(),
            color: entity.point.color.getValue().toString(),
            outlineColor: entity.point.outlineColor.getValue().toString(),
            outlineWidth: entity.point.outlineWidth.getValue(),
          }
        : null,
      line: entity.polyline
        ? entity.polyline.positions
            .getValue()
            .map((value) => [value.x, value.y, value.z])
        : null,
      polygon: entity.polygon ? entity.polygon.hierarchy.getValue() : null,
    }));

  const baseline = fixture(t, { manageWindow: false });
  baseline.layer.load(input, { workspaceId: 'mixed-parity' });
  const expected = summarize(baseline.entities.values);
  assert.deepEqual(
    expected.map(({ id }) => id),
    [
      'gev-import:mixed-parity:mixed-parity:point',
      'gev-import:mixed-parity:mixed-parity:line',
      'gev-import:mixed-parity:mixed-parity:polygon',
    ],
  );
  baseline.layer.clear();

  const candidate = fixture(t, {
    pointRepresentation: 'primitive-collection',
    manageWindow: false,
  });
  candidate.layer.load(input, { workspaceId: 'mixed-parity' });
  const candidatePoint =
    candidate.layer.getPointRendererSnapshot().entityRows[0];
  const candidateRows = [
    {
      id: candidatePoint.id,
      name: candidatePoint.name,
      position: new Cesium.Cartesian3(...candidatePoint.position).toString(),
      point: {
        pixelSize: candidatePoint.pixelSize,
        color: new Cesium.Color(...candidatePoint.color).toString(),
        outlineColor: new Cesium.Color(
          ...candidatePoint.outlineColor,
        ).toString(),
        outlineWidth: candidatePoint.outlineWidth,
      },
      line: null,
      polygon: null,
    },
    ...summarize(candidate.entities.values),
  ];
  assert.deepEqual(candidateRows, expected);
  assert.deepEqual(
    candidate.entities.values.map((entity) => entity.id),
    [
      'gev-import:mixed-parity:mixed-parity:line',
      'gev-import:mixed-parity:mixed-parity:polygon',
    ],
  );

  const primitive = candidate.primitives.get(0).get(0);
  candidate.viewer.scene.pick = () => ({ id: primitive.id });
  candidate.inputActions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
    position: { x: 1, y: 1 },
  });
  assert.equal(getSelectedEntityContext()?.entity.id, candidatePoint.id);
  assert.equal(getSelectedEntityContext()?.evidence.entityRef.id, 'point');
  candidate.layer.destroy();
  baseline.layer.destroy();
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
});

test('primitive point mode cancellation and replacement cannot repopulate a released collection', async (t) => {
  const env = fixture(t, {
    pointRepresentation: 'primitive-collection',
    advancePreparationClock: true,
  });
  const previous = env.layer.loadAsync(records(20), { workspaceId: 'old' });
  const previousResult = assert.rejects(previous, { name: 'AbortError' });
  const late = [...env.timers.values()][0];
  const replacement = env.layer.loadAsync(records(2), { workspaceId: 'new' });
  const replacementCollection = env.primitives.get(0);
  late();
  env.flush();
  await previousResult;
  assert.equal((await replacement).drawn, 2);
  assert.equal(env.layer.getPointRendererSnapshot().pointCount, 2);
  assert.equal(env.primitives.length, 1);
  assert.equal(env.primitives.get(0), replacementCollection);
  assert.deepEqual(
    env.layer.getPointRendererSnapshot().entityRows.map((row) => row.id),
    ['gev-import:new:fixture:0', 'gev-import:new:fixture:1'],
  );
});

test('primitive point mode destroys its collection on clear and destroy', (t) => {
  const env = fixture(t, { pointRepresentation: 'primitive-collection' });
  env.layer.load(records(2));
  const collection = env.primitives.get(0);
  env.layer.clear();
  assert.equal(collection.isDestroyed(), true);
  assert.equal(env.primitives.length, 0);

  env.layer.load(records(1));
  const replacement = env.primitives.get(0);
  env.layer.destroy();
  assert.equal(replacement.isDestroyed(), true);
  assert.equal(env.primitives.length, 0);
  assert.equal(env.layer.getState().destroyed, true);
});

test('primitive point mode rolls back collection-add failure and preserves a conflicting external Entity', (t) => {
  const env = fixture(t, { pointRepresentation: 'primitive-collection' });
  let allocated;
  env.primitives.add = (collection) => {
    allocated = collection;
    throw new Error('controlled primitive add failure');
  };
  assert.throws(
    () => env.layer.load(records(1), { workspaceId: 'failed-add' }),
    /controlled primitive add failure/,
  );
  assert.ok(allocated);
  assert.equal(allocated.isDestroyed(), true);
  assert.equal(env.primitives.length, 0);
  assert.equal(env.layer.getState().featureCount, 0);
  assert.equal(getContextStore().entities.size, 0);

  const external = env.entities.add({
    id: 'gev-import:conflict:fixture:0',
    name: 'External entity',
  });
  assert.throws(
    () => env.layer.load(records(1), { workspaceId: 'conflict' }),
    /Duplicate imported feature id/,
  );
  assert.equal(env.entities.getById(external.id), external);
  assert.equal(env.primitives.length, 0);
  assert.equal(env.layer.getState().featureCount, 0);
});

test('cooperative imports yield after four ms and preserve complete entity and evidence identity', async (t) => {
  const env = fixture(t);
  const input = records(7);
  env.layer.load(input, { workspaceId: 'w' });
  assert.equal(
    env.layer.getPerformanceDiagnostics().pointRepresentation,
    'entity',
  );
  assert.equal(env.layer.getPointRendererSnapshot(), null);
  assert.equal(env.primitives.length, 0);
  const expected = env.entities.values.map((e) => [e.id, e.name]);
  const pending = env.layer.loadAsync(input, { workspaceId: 'w' });
  assert.equal(env.entities.values.length, 2);
  assert.equal(env.timers.size, 1);
  assert.equal(env.layer.getState().pendingJobs, 1);
  env.flush();
  assert.deepEqual(await pending, { drawn: 7, omitted: 0 });
  assert.deepEqual(
    env.entities.values.map((e) => [e.id, e.name]),
    expected,
  );
  assert.equal(getContextStore().entities.size, 7);
  for (const record of getContextStore().entities.values()) {
    assert.equal(record.evidence.licenseRef, 'Field survey');
    assert.equal(record.evidence.entityRef.id, record.importedFeature.id);
  }
  assert.equal(env.layer.getState().pendingJobs, 0);
  assert.equal(env.timers.size, 0);
});

test('superseded imports cannot remove or repopulate the replacement workspace', async (t) => {
  const env = fixture(t);
  const old = env.layer.loadAsync(records(20), { workspaceId: 'old' });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  const late = [...env.timers.values()][0];
  const current = env.layer.loadAsync(records(3), { workspaceId: 'new' });
  late();
  env.flush();
  await rejected;
  assert.equal((await current).drawn, 3);
  assert.ok(
    env.entities.values.every((e) => e.id.startsWith('gev-import:new:')),
  );
  assert.equal(getContextStore().entities.size, 3);
  assert.equal(env.timers.size, 0);
});

for (const operation of ['clear', 'destroy', 'abort']) {
  test(`${operation} removes partial imports and releases queued work`, async (t) => {
    const env = fixture(t);
    const controller = new AbortController();
    const pending = env.layer.loadAsync(records(20), {
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    const late = [...env.timers.values()][0];
    if (operation === 'abort') controller.abort();
    else env.layer[operation]();
    await rejected;
    late();
    assert.equal(env.entities.values.length, 0);
    assert.equal(getContextStore().entities.size, 0);
    assert.equal(env.layer.getState().pendingJobs, 0);
    assert.equal(env.timers.size, 0);
    if (operation === 'destroy') assert.equal(env.handlers(), 0);
  });
}

test('already aborted, malformed and empty loads leave no orphaned task or geometry', async (t) => {
  const env = fixture(t);
  await assert.rejects(
    env.layer.loadAsync(records(2), { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
  const bad = records(1);
  bad[0].records[0].geometry.coordinates = null;
  await assert.rejects(env.layer.loadAsync(bad));
  assert.deepEqual(await env.layer.loadAsync([]), { drawn: 0, omitted: 0 });
  assert.equal(env.entities.values.length, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.layer.getState().pendingJobs, 0);
});

const coordinateRing = (count, radius = 0.1) => {
  const points = Array.from({ length: count - 1 }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return [-97 + Math.cos(angle) * radius, 30 + Math.sin(angle) * radius, 25];
  });
  return [...points, [...points[0]]];
};

for (const type of ['LineString', 'Polygon']) {
  test(`${type} 256-coordinate chunks preserve complete geometry and identity`, async (t) => {
    const env = fixture(t, { advancePreparationClock: true });
    const coordinates =
      type === 'LineString'
        ? coordinateRing(513)
        : [coordinateRing(513), coordinateRing(257, 0.02)];
    const input = [
      {
        id: 'chunked',
        kind: 'geojson',
        records: [{ id: 'shape', geometry: { type, coordinates } }],
      },
    ];
    env.layer.load(input, { workspaceId: 'same' });
    const expectedEntity = env.entities.values[0];
    const expected =
      type === 'LineString'
        ? expectedEntity.polyline.positions
            .getValue()
            .map((point) => [point.x, point.y, point.z])
        : expectedEntity.polygon.hierarchy.getValue();

    const pending = env.layer.loadAsync(input, { workspaceId: 'same' });
    assert.equal(env.entities.values.length, 0);
    assert.equal(env.timers.size, 1, 'coordinate work yielded mid-feature');
    env.flush();
    assert.deepEqual(await pending, { drawn: 1, omitted: 0 });
    const actualEntity = env.entities.values[0];
    assert.equal(actualEntity.id, expectedEntity.id);
    if (type === 'LineString') {
      assert.deepEqual(
        actualEntity.polyline.positions
          .getValue()
          .map((point) => [point.x, point.y, point.z]),
        expected,
      );
    } else {
      assert.deepEqual(actualEntity.polygon.hierarchy.getValue(), expected);
    }
    assert.equal(env.timers.size, 0);
    assert.equal(env.layer.getState().pendingJobs, 0);
  });
}

test('cancellation during one large feature never publishes partial geometry', async (t) => {
  const env = fixture(t, { advancePreparationClock: true });
  const input = [
    {
      id: 'chunked',
      kind: 'geojson',
      records: [
        {
          id: 'cancelled',
          geometry: { type: 'LineString', coordinates: coordinateRing(513) },
        },
      ],
    },
  ];
  const pending = env.layer.loadAsync(input, { workspaceId: 'old' });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  assert.equal(env.entities.values.length, 0);
  assert.equal(env.timers.size, 1);
  const lateTimer = [...env.timers.values()][0];
  const replacement = env.layer.loadAsync(records(1), { workspaceId: 'new' });
  lateTimer();
  env.flush();
  await rejected;
  await replacement;
  assert.deepEqual(
    env.entities.values.map((entity) => entity.id),
    ['gev-import:new:fixture:0'],
  );
  assert.equal(getContextStore().entities.size, 1);
  assert.equal(env.layer.getState().pendingJobs, 0);
  assert.equal(env.timers.size, 0);
});

test('fully owned imports clear one-by-one in their original order', (t) => {
  const env = fixture(t);
  env.layer.load(records(4));
  const expectedRemoved = env.entities.values.map((entity) => entity.id);
  const changes = [];
  env.entities.collectionChanged.addEventListener(
    (_collection, added, removed, changed) =>
      changes.push({ added, removed, changed }),
  );
  const removeAll = env.entities.removeAll.bind(env.entities);
  let removeAllCalls = 0;
  env.entities.removeAll = () => {
    removeAllCalls += 1;
    return removeAll();
  };

  env.layer.clear();

  assert.equal(removeAllCalls, 0);
  assert.equal(changes.length, expectedRemoved.length);
  assert.deepEqual(
    changes.map((change) => change.removed.map((entity) => entity.id)),
    expectedRemoved.map((id) => [id]),
  );
  assert.deepEqual(
    changes.flatMap((change) => change.removed.map((entity) => entity.id)),
    expectedRemoved,
  );
  assert.deepEqual(env.entities.values, []);
  assert.equal(getContextStore().entities.size, 0);
  assert.equal(env.layer.getState().featureCount, 0);
});

test('mixed imports preserve outside entities and respect external suspension', (t) => {
  const env = fixture(t);
  env.layer.load(records(4));
  const expectedRemoved = env.entities.values.map((entity) => entity.id);
  const outside = env.entities.add({ id: 'outside:kept' });
  const changes = [];
  env.entities.collectionChanged.addEventListener(
    (_collection, added, removed, changed) =>
      changes.push({ added, removed, changed }),
  );
  let removeAllCalls = 0;
  const removeAll = env.entities.removeAll.bind(env.entities);
  env.entities.removeAll = () => {
    removeAllCalls += 1;
    return removeAll();
  };

  env.entities.suspendEvents();
  env.layer.clear();
  assert.equal(removeAllCalls, 0);
  assert.deepEqual(changes, []);
  assert.equal(env.entities.getById(outside.id), outside);
  env.entities.resumeEvents();

  assert.equal(changes.length, 1);
  assert.deepEqual(
    changes[0].removed.map((entity) => entity.id),
    expectedRemoved,
  );
  assert.equal(env.entities.getById(outside.id), outside);
  assert.equal(getContextStore().entities.size, 0);
});

test('clear preserves an external replacement that reuses an imported ID', (t) => {
  const env = fixture(t);
  const replacementId = 'gev-import:active:fixture:0';
  const stillOwnedId = 'gev-import:active:fixture:1';
  env.layer.load(records(2));
  const imported = env.entities.getById(replacementId);
  assert.ok(imported);
  env.entities.remove(imported);
  const replacement = env.entities.add({
    id: replacementId,
    name: 'Outside replacement',
  });
  const changes = [];
  env.entities.collectionChanged.addEventListener(
    (_collection, added, removed, changed) =>
      changes.push({ added, removed, changed }),
  );
  let removeAllCalls = 0;
  const removeAll = env.entities.removeAll.bind(env.entities);
  env.entities.removeAll = () => {
    removeAllCalls += 1;
    return removeAll();
  };

  env.layer.clear();

  assert.equal(removeAllCalls, 0);
  assert.equal(env.entities.getById(replacementId), replacement);
  assert.notEqual(replacement, imported);
  assert.equal(env.entities.getById(stillOwnedId), undefined);
  assert.equal(changes.length, 1);
  assert.deepEqual(
    changes[0].removed.map((entity) => entity.id),
    [stillOwnedId],
  );
});

test('partial clear errors leave later collection events live', (t) => {
  const env = fixture(t);
  env.layer.load(records(3));
  env.entities.add({ id: 'outside:kept' });
  const changes = [];
  env.entities.collectionChanged.addEventListener(
    (_collection, added, removed) => changes.push({ added, removed }),
  );
  const removeById = env.entities.removeById.bind(env.entities);
  let removals = 0;
  env.entities.removeById = (id) => {
    removals += 1;
    if (removals === 2) throw new Error('controlled remove failure');
    return removeById(id);
  };

  assert.throws(() => env.layer.clear(), /controlled remove failure/);
  assert.equal(changes.length, 1);
  env.entities.add({ id: 'outside:after-failure' });
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes[1].added.map((entity) => entity.id),
    ['outside:after-failure'],
  );
});
