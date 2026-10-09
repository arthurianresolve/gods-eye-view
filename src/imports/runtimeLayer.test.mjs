import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createImportedGeometryLayer } from './runtimeLayer.js';
import { getContextStore } from '../data/contextStore.js';

function fixture(t) {
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
      now: () => clock,
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
