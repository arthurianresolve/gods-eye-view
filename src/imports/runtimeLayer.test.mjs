import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createImportedGeometryLayer } from './runtimeLayer.js';
import { getContextStore } from '../data/contextStore.js';

function fixture(t, { timedPreparation = false } = {}) {
  const previous = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  let clock = 0,
    handlers = 0,
    renders = 0;
  const timers = new Map();
  let timerId = 0;
  const entities = new Cesium.EntityCollection();
  const originalAdd = entities.add.bind(entities);
  entities.add = (entity) => {
    clock += 2;
    return originalAdd(entity);
  };
  const layer = createImportedGeometryLayer({
    viewer: {
      entities,
      scene: {
        canvas: {},
        requestRender() {
          renders++;
        },
      },
    },
    now: () => 1000,
    batchOptions: {
      now: () => (timedPreparation ? (clock += 2) : clock),
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
        setInputAction() {},
        destroy() {
          handlers--;
        },
      };
    },
  });
  t.after(() => {
    layer.destroy();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
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
    timers,
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

test('cooperative imports yield after four ms and preserve complete entity and evidence identity', async (t) => {
  const env = fixture(t);
  const input = records(7);
  env.layer.load(input, { workspaceId: 'w' });
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

const ring = (count, radius = 0.1) => {
  const points = Array.from({ length: count - 1 }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return [-97 + Math.cos(angle) * radius, 30 + Math.sin(angle) * radius, 25];
  });
  return [...points, [...points[0]]];
};

for (const type of ['LineString', 'Polygon']) {
  test(`${type} preparation yields within one feature and retains every coordinate`, async (t) => {
    const env = fixture(t, { timedPreparation: true });
    const coordinates =
      type === 'Polygon' ? [ring(512), ring(256, 0.02)] : ring(768);
    const input = [
      {
        id: 'complex',
        kind: 'geojson',
        records: [{ id: 'shape', geometry: { type, coordinates } }],
      },
    ];
    env.layer.load(input);
    const old = env.entities.values[0];
    const expected =
      type === 'Polygon'
        ? old.polygon.hierarchy.getValue()
        : old.polyline.positions.getValue();
    const pending = env.layer.loadAsync(input);
    assert.equal(
      env.entities.values.length,
      0,
      'incomplete geometry is not published',
    );
    assert.equal(getContextStore().entities.size, 0);
    assert.equal(env.timers.size, 1, 'a single-feature import can yield');
    env.flush();
    assert.deepEqual(await pending, { drawn: 1, omitted: 0 });
    const current = env.entities.values[0];
    const actual =
      type === 'Polygon'
        ? current.polygon.hierarchy.getValue()
        : current.polyline.positions.getValue();
    assert.deepEqual(actual, expected);
    assert.equal(current.id, old.id);
    assert.equal(env.timers.size, 0);
  });
}

test('cancelling mid-feature never publishes old geometry after a replacement', async (t) => {
  const env = fixture(t, { timedPreparation: true });
  const input = [
    {
      id: 'complex',
      records: [
        { id: 'old', geometry: { type: 'Polygon', coordinates: [ring(512)] } },
      ],
    },
  ];
  const old = env.layer.loadAsync(input, { workspaceId: 'old' });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  assert.equal(env.entities.values.length, 0);
  const late = [...env.timers.values()][0];
  const current = env.layer.loadAsync(records(1), { workspaceId: 'new' });
  late();
  env.flush();
  await rejected;
  await current;
  assert.deepEqual(
    env.entities.values.map((e) => e.id),
    ['gev-import:new:fixture:0'],
  );
  assert.equal(getContextStore().entities.size, 1);
  assert.equal(env.layer.getState().pendingJobs, 0);
  assert.equal(env.timers.size, 0);
});
