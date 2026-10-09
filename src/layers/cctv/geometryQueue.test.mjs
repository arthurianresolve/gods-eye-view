import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryQueue } from './geometryQueue.js';

function fixture(t, visit = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const state = {
    _enabled: true,
    _viewer: {},
    _geoQueue: [],
    _geoQueueCursor: { index: 0 },
    _records: [],
  };
  const seen = [];
  const queue = createGeometryQueue({
    state,
    parts: {
      selection: { getActiveRecord: () => null },
      presentation: { notifyListeners() {} },
      geometry: {
        updateRecordGeometry(record) {
          seen.push([record.id, record.revision]);
          clock += 4;
          visit(record, queue, state);
        },
      },
    },
  });
  t.after(() => queue.stopGeometryLoadQueue());
  return { state, queue, seen };
}

test('refreshes coalesce pending revisions but allow a consumed record to refresh again', (t) => {
  const { state, queue, seen } = fixture(t);
  const a = { id: 'a', revision: 1 },
    b = { id: 'b', revision: 1 };
  queue.enqueueGeometryRefresh([a, b, a]);
  t.mock.timers.tick(0);
  assert.deepEqual(seen, [['a', 1]]);
  a.revision = 2;
  queue.enqueueGeometryRefresh([a, a]);
  a.revision = 3;
  t.mock.timers.tick(120);
  t.mock.timers.tick(120);
  assert.deepEqual(seen, [
    ['a', 1],
    ['b', 1],
    ['a', 3],
  ]);
  assert.deepEqual(state._geoQueue, []);
  assert.equal(state._geoQueueTimer, 0);
});

test('a refresh during a build is not lost at completion or given a second timer', (t) => {
  const { queue, seen, state } = fixture(t, (record, q) => {
    if (record.revision === 1) {
      record.revision = 2;
      q.enqueueGeometryRefresh([record]);
    }
  });
  queue.enqueueGeometryRefresh([{ id: 'a', revision: 1 }]);
  t.mock.timers.tick(0);
  assert.deepEqual(seen, [['a', 1]]);
  t.mock.timers.tick(120);
  assert.deepEqual(seen, [
    ['a', 1],
    ['a', 2],
  ]);
  assert.equal(state._geoQueueTimer, 0);
});

test('cancelled and disabled queues cannot resurrect scene geometry', (t) => {
  const { queue, seen, state } = fixture(t, (_, q, s) => {
    s._enabled = false;
    q.stopGeometryLoadQueue();
  });
  queue.enqueueGeometryRefresh([{ id: 'a' }, { id: 'b' }]);
  t.mock.timers.tick(0);
  queue.enqueueGeometryRefresh([{ id: 'late' }]);
  t.mock.timers.tick(1000);
  assert.deepEqual(seen, [['a', undefined]]);
  assert.deepEqual(state._geoQueue, []);
  assert.equal(state._geoQueueTimer, 0);
});

test('prioritizing the active pending camera preserves the consumed cursor', (t) => {
  const { queue } = fixture(t);
  const a = {},
    b = {},
    c = {};
  const records = [a, b, a, c];
  const cursor = { index: 1 };
  assert.equal(
    queue.prioritizeActiveCctvGeometryRecord(records, a, cursor),
    true,
  );
  assert.equal(cursor.index, 1);
  assert.equal(records[0], a);
  assert.equal(records[1], a);
  assert.equal(records.length, 4);
});

test('preparation yields after four milliseconds while retaining all remaining data', (t) => {
  const { queue } = fixture(t);
  const records = [1, 2, 3, 4],
    cursor = { index: 0 },
    seen = [];
  let clock = 0;
  assert.equal(
    queue.processCctvGeometryQueueBatch({
      queue: records,
      cursor,
      batchSize: 100,
      budgetMs: 4,
      now: () => clock,
      visit(record) {
        seen.push(record);
        clock += 3;
      },
    }),
    true,
  );
  assert.deepEqual(seen, [1, 2]);
  assert.equal(cursor.index, 2);
  assert.equal(records.length, 4);
});
