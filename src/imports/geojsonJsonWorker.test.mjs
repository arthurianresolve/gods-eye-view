import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonInWorker } from './geojsonJsonWorker.js';
import { previewGeoJSON } from './geojsonCsv.js';

function fakeWorkerClass(onPostMessage = () => {}) {
  const workers = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.terminateCount = 0;
      workers.push(this);
    }

    postMessage(message) {
      onPostMessage.call(this, message);
    }

    terminate() {
      this.terminateCount++;
    }
  }
  return { FakeWorker, workers };
}

async function withGlobalWorker(Worker, callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: Worker,
  });
  try {
    return await callback();
  } finally {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else delete globalThis.Worker;
  }
}

function reply(worker, request, ok = true) {
  queueMicrotask(() =>
    worker.onmessage?.({
      data: ok
        ? {
            type: 'geojson-json-result',
            requestId: request.requestId,
            ok: true,
            value: JSON.parse(request.text),
          }
        : {
            type: 'geojson-json-result',
            requestId: request.requestId,
            ok: false,
            code: 'invalid-json',
          },
    }),
  );
}

test('worker JSON parser returns a structured value and retires its one-shot worker', async () => {
  const { FakeWorker, workers } = fakeWorkerClass(function (request) {
    reply(this, request);
  });
  const value = await parseJsonInWorker('{"features":[]}', {
    WorkerConstructor: FakeWorker,
  });
  assert.deepEqual(value, { features: [] });
  assert.equal(workers.length, 1);
  assert.equal(workers[0].options.type, 'module');
  assert.match(workers[0].url.href, /geojsonJson\.worker\.js$/);
  assert.equal(workers[0].terminateCount, 1);
  assert.equal(workers[0].onmessage, null);
  assert.equal(workers[0].onerror, null);
  assert.equal(workers[0].onmessageerror, null);
});

test('opt-in GeoJSON worker parsing preserves the validated preview path', async () => {
  const input = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'station-1',
        properties: { name: 'Station' },
        geometry: { type: 'Point', coordinates: [-97.7, 30.2] },
      },
    ],
  });
  const { FakeWorker, workers } = fakeWorkerClass(function (request) {
    reply(this, request);
  });
  const preview = await withGlobalWorker(FakeWorker, () =>
    previewGeoJSON(input, { workerParsing: true }),
  );
  assert.equal(preview.accepted, 1);
  assert.equal(preview.records[0].id, 'station-1');
  assert.deepEqual(preview.records[0].geometry.coordinates, [-97.7, 30.2, 0]);
  assert.equal(workers[0].terminateCount, 1);
});

test('worker JSON parse errors retain the ordinary invalid-json contract', async () => {
  const { FakeWorker, workers } = fakeWorkerClass(function (request) {
    reply(this, request, false);
  });
  await withGlobalWorker(FakeWorker, () =>
    assert.rejects(previewGeoJSON('{', { workerParsing: true }), {
      code: 'invalid-json',
      message: 'GeoJSON is not valid JSON.',
    }),
  );
  assert.equal(workers[0].terminateCount, 1);
});

test('worker abort and timeout terminate once and discard late replies', async () => {
  let worker;
  class PendingWorker {
    constructor() {
      worker = this;
      this.terminateCount = 0;
    }

    postMessage() {}

    terminate() {
      this.terminateCount++;
    }
  }
  const controller = new AbortController();
  const pending = parseJsonInWorker('{}', {
    signal: controller.signal,
    WorkerConstructor: PendingWorker,
  });
  const lateMessage = worker.onmessage;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  lateMessage({
    data: { type: 'geojson-json-result', requestId: 1, ok: true, value: {} },
  });
  assert.equal(worker.terminateCount, 1);

  class SilentWorker extends PendingWorker {}
  await assert.rejects(
    parseJsonInWorker('{}', { WorkerConstructor: SilentWorker, timeoutMs: 5 }),
    { code: 'worker-timeout' },
  );
});

test('worker startup, runtime and protocol failures reject with bounded codes', async () => {
  assert.throws(
    () => parseJsonInWorker('{}', { WorkerConstructor: undefined }),
    { code: 'worker-unavailable' },
  );
  class ConstructorFailure {
    constructor() {
      throw new Error('private constructor detail');
    }
  }
  await assert.rejects(
    parseJsonInWorker('{}', { WorkerConstructor: ConstructorFailure }),
    {
      code: 'worker-start-failed',
      message: 'The JSON parser worker could not start.',
    },
  );

  const { FakeWorker, workers } = fakeWorkerClass(function () {
    this.onmessageerror?.();
  });
  await assert.rejects(
    parseJsonInWorker('{}', { WorkerConstructor: FakeWorker }),
    { code: 'worker-message-error' },
  );
  assert.equal(workers[0].terminateCount, 1);

  let failedWorker;
  class RuntimeFailure extends FakeWorker {
    constructor() {
      super();
      failedWorker = this;
    }

    postMessage() {
      this.onerror?.({ preventDefault() {} });
    }
  }
  await assert.rejects(
    parseJsonInWorker('{}', { WorkerConstructor: RuntimeFailure }),
    { code: 'worker-error' },
  );
  assert.equal(failedWorker.terminateCount, 1);

  let malformed;
  class MalformedWorker extends FakeWorker {
    constructor() {
      super();
      malformed = this;
    }

    postMessage() {
      this.onmessage?.({
        data: { requestId: 1, value: 'not a protocol reply' },
      });
    }
  }
  await assert.rejects(
    parseJsonInWorker('{}', { WorkerConstructor: MalformedWorker }),
    { code: 'worker-protocol-error' },
  );
  assert.equal(malformed.terminateCount, 1);
});

test('aborted or oversized input never starts the opt-in worker', async () => {
  const { FakeWorker, workers } = fakeWorkerClass();
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  assert.throws(
    () =>
      parseJsonInWorker('{}', {
        signal: controller.signal,
        WorkerConstructor: FakeWorker,
      }),
    { name: 'AbortError' },
  );
  await withGlobalWorker(FakeWorker, () =>
    assert.rejects(
      previewGeoJSON(' '.repeat(8 * 1024 * 1024 + 1), { workerParsing: true }),
      { code: 'file-too-large' },
    ),
  );
  assert.equal(workers.length, 0);
});
