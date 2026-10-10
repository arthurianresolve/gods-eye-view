import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkloads,
  createDecodeWorker,
  decodePreview,
  measured,
  stablePreviewHash,
  summarizePreview,
} from './s59DocumentDecodeComparison.mjs';

function controlledRehydrationScheduler() {
  const callbacks = new Map();
  let nextId = 0;
  let firstScheduledResolve;
  const firstScheduled = new Promise((resolve) => {
    firstScheduledResolve = resolve;
  });
  let cancelled = 0;
  const scheduleTimer = (callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    firstScheduledResolve?.();
    firstScheduledResolve = null;
    return id;
  };
  scheduleTimer.cancel = (id) => {
    if (callbacks.delete(id)) cancelled++;
  };
  return {
    scheduleTimer,
    firstScheduled,
    get pendingCallbacks() {
      return callbacks.size;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test('diagnostic fixtures preserve requested vertex and row populations', () => {
  const workloads = buildWorkloads(40, 35);
  assert.deepEqual(
    workloads.map(({ id }) => id),
    [
      'geojson-line-50k-vertices',
      'geojson-polygon-hole-50k-vertices',
      'csv-50k-rows',
      'kml-line-50k-vertices',
    ],
  );
  assert.deepEqual(
    workloads.map(({ expected }) => expected.vertexCount ?? null),
    [40, 40, null, 40],
  );
  assert.equal(workloads[1].expected.ringCount, 2);
  assert.equal(workloads[2].expected.accepted, 35);
  assert.equal(workloads[2].expected.lastId, 'row-35');
  assert.ok(workloads.every(({ inputBytes }) => inputBytes > 0));
  assert.throws(() => buildWorkloads(50_001, 1), /bounded to 50,000 vertices/);
  assert.throws(() => buildWorkloads(40, 50_001), /bounded to 50,000 rows/);
});

test('same public GeoJSON, CSV and KML previews match in diagnostic worker', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  for (const workload of buildWorkloads(40, 35)) {
    const main = await decodePreview(
      workload.kind,
      workload.input,
      workload.options,
    );
    const offThread = await worker.run(
      workload.kind,
      workload.input,
      workload.options,
    );
    const transferred = await worker.run(
      workload.kind,
      workload.input,
      workload.options,
      { transport: 'transfer' },
    );
    assert.equal(stablePreviewHash(offThread.preview), stablePreviewHash(main));
    assert.equal(
      stablePreviewHash(transferred.preview),
      stablePreviewHash(main),
    );
    assert.deepEqual(
      summarizePreview(offThread.preview),
      summarizePreview(main),
    );
    assert.equal(offThread.preview.accepted, workload.expected.accepted);
    assert.equal(offThread.preview.rejected, workload.expected.rejected);
  }
  assert.equal(worker.pendingCount, 0);
});

test('module-ready handshake is cached when readiness is awaited late or twice', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all([worker.ready(), worker.ready()]);
  const result = await worker.run('geojson', buildWorkloads(40, 1)[0].input);
  assert.equal(result.preview.accepted, 1);
});

test('worker reports malformed-document errors without publishing partial output', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  await assert.rejects(
    worker.run('geojson', '{ invalid json'),
    (error) => error.code === 'invalid-json',
  );
  await assert.rejects(
    worker.run('kml', '<kml><Placemark>'),
    (error) => error.code === 'invalid-xml',
  );
  assert.equal(worker.pendingCount, 0);
});

test('synchronous KML work canceled before its reply is not published', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const workload = buildWorkloads(50_000, 1).find(({ kind }) => kind === 'kml');
  const controller = new AbortController();
  const pending = worker.run(
    workload.kind,
    workload.input,
    {},
    {
      signal: controller.signal,
    },
  );
  const abortTimer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(pending, { name: 'AbortError' });
  } finally {
    clearTimeout(abortTimer);
  }
  assert.equal(worker.pendingCount, 0);
  const next = await worker.run('geojson', buildWorkloads(40, 1)[0].input);
  assert.equal(next.preview.accepted, 1);
});

test('worker cancellation rejects without publishing and leaves no pending request', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const workload = buildWorkloads(10_000, 5)[0];
  const controller = new AbortController();
  const pending = worker.run(
    workload.kind,
    workload.input,
    {},
    {
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.pendingCount, 0);
  // The worker remains usable after cancellation and the next complete result
  // proves there was no partial preview published for the cancelled request.
  const small = buildWorkloads(40, 5)[0];
  const next = await worker.run(small.kind, small.input);
  assert.equal(next.preview.accepted, 1);
  assert.equal(worker.pendingCount, 0);
});

test('transfer cancellation during main-thread rehydration releases worker ownership', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const workload = buildWorkloads(10_000, 1)[0];
  const controller = new AbortController();
  const pending = worker.run(workload.kind, workload.input, workload.options, {
    transport: 'transfer',
    signal: controller.signal,
    onRehydrationStart: () => controller.abort(),
  });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.pendingCount, 0);
  const next = await worker.run('geojson', buildWorkloads(40, 1)[0].input);
  assert.equal(next.preview.accepted, 1);
});

test('worker disposal during transfer rehydration cancels its owned wake', async () => {
  const worker = createDecodeWorker();
  await worker.ready();
  const scheduler = controlledRehydrationScheduler();
  const workload = buildWorkloads(40, 1)[0];
  const pending = worker.run(workload.kind, workload.input, workload.options, {
    transport: 'transfer',
    rehydrationScheduleTimer: scheduler.scheduleTimer,
  });
  await scheduler.firstScheduled;
  assert.equal(worker.pendingCount, 1);
  const rejection = assert.rejects(pending, /disposed/);
  await worker.dispose();
  await rejection;
  assert.equal(worker.pendingCount, 0);
  assert.equal(scheduler.pendingCallbacks, 0);
  assert.equal(scheduler.cancelled, 1);
});

test('worker task timeout during transfer rehydration cancels and does not publish', async () => {
  const worker = createDecodeWorker();
  await worker.ready();
  const scheduler = controlledRehydrationScheduler();
  const workload = buildWorkloads(40, 1)[0];
  let published = false;
  const pending = worker
    .run(workload.kind, workload.input, workload.options, {
      transport: 'transfer',
      timeoutMs: 1_000,
      rehydrationScheduleTimer: scheduler.scheduleTimer,
    })
    .then((value) => {
      published = true;
      return value;
    });
  await scheduler.firstScheduled;
  await assert.rejects(pending, /timed out/);
  assert.equal(published, false);
  assert.equal(worker.pendingCount, 0);
  assert.equal(scheduler.pendingCallbacks, 0);
  assert.equal(scheduler.cancelled, 1);
  await worker.dispose();
});

test('worker owns at most one task and a task timeout terminates it', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const small = buildWorkloads(40, 5)[0];
  const first = worker.run(small.kind, small.input);
  await assert.rejects(
    worker.run(small.kind, small.input),
    /one owned task at a time/,
  );
  await first;

  const large = buildWorkloads(10_000, 5)[0];
  await assert.rejects(
    worker.run(large.kind, large.input, {}, { timeoutMs: 1 }),
    /timed out/,
  );
  assert.equal(worker.pendingCount, 0);
  await assert.rejects(worker.run(small.kind, small.input), /timed out/);
});

test('postMessage clone errors release task ownership immediately', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const workload = buildWorkloads(40, 2)[0];
  await assert.rejects(
    worker.run(workload.kind, workload.input, { uncloneable() {} }),
    { name: 'DataCloneError' },
  );
  assert.equal(worker.pendingCount, 0);
  assert.equal(
    (await worker.run(workload.kind, workload.input)).preview.accepted,
    1,
  );
});

test('unexpected worker exit rejects owned work and disposal is safe', async () => {
  const worker = createDecodeWorker();
  await worker.ready();
  const workload = buildWorkloads(10_000, 5)[0];
  const pending = worker.run(workload.kind, workload.input);
  worker.crashForTest();
  await assert.rejects(pending, /exited with code 73/);
  assert.equal(worker.pendingCount, 0);
  await worker.dispose();
  await worker.dispose();
  await assert.rejects(worker.run('geojson', '{}'), /exited with code 73/);
});

test('unexpected zero-code worker exit rejects pending work', async () => {
  const worker = createDecodeWorker();
  await worker.ready();
  const workload = buildWorkloads(10_000, 5)[0];
  const pending = worker.run(workload.kind, workload.input);
  worker.exitForTest();
  await assert.rejects(pending, /exited with code 0/);
  assert.equal(worker.pendingCount, 0);
  await worker.dispose();
});

test('unexpected idle zero-code exit is remembered before the next task', async () => {
  const worker = createDecodeWorker();
  await worker.ready();
  await worker.exitForTest();
  await assert.rejects(
    worker.run('geojson', buildWorkloads(40, 1)[0].input),
    /exited with code 0/,
  );
  await assert.rejects(worker.ready(), /exited with code 0/);
  await worker.dispose();
});

test('event-loop timer-gap probe observes a synchronous blocked segment', async () => {
  const observation = await measured(() => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < 25) {}
    return 'complete';
  });
  assert.equal(observation.value, 'complete');
  assert.ok(observation.totalCompletionMs >= 20);
  assert.ok(observation.maxMainThreadGapMs >= 15);
});

test('worker timer-gap probe observes a synchronous decode-like segment', async (t) => {
  const worker = createDecodeWorker();
  t.after(() => worker.dispose());
  await worker.ready();
  const observation = await worker.run('diagnostic-busy', '', {
    durationMs: 25,
  });
  assert.ok(observation.workerDurationMs >= 20);
  assert.ok(observation.workerMaxEventLoopGapMs >= 15);
});
