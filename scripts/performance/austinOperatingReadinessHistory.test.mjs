import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { CDPSessionEvent } from 'puppeteer';
import {
  createAustinOperatingReadinessHistory,
  encodeAustinOperatingReadinessSnapshot,
  waitForAustinOperatingReadiness,
} from './austinOperatingReadinessHistory.mjs';

const ids = ['satellites', 'cctv'];
const observerSource = `function observe(ids) {
  return { schema: 'gev-austin-readiness-failure/v1', selectedLayerCount: ids.length,
    layers: ids.map((id) => ({ id, enabled: true, count: id === 'cctv' ? 250 : 828,
      loading: id === 'cctv', loadingLoaded: 17, loadingTotal: 250,
      ownership: { timers: 0, pendingJobs: 3, primitives: 2, dataSources: 0 },
      status: 'loading', error: null })) };
}`;

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

class ControlledTimers {
  #next = 1;
  timeouts = new Map();
  intervals = new Map();

  setTimeout = (callback, delay) => {
    const id = this.#next++;
    this.timeouts.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => this.timeouts.delete(id);

  setInterval = (callback, delay) => {
    const id = this.#next++;
    this.intervals.set(id, { callback, delay });
    return id;
  };

  clearInterval = (id) => this.intervals.delete(id);

  fireTimeout(delay) {
    const entry = [...this.timeouts].find(([, value]) => value.delay === delay);
    assert.ok(entry, `expected timeout with delay ${delay}`);
    this.timeouts.delete(entry[0]);
    entry[1].callback();
  }

  tickIntervals() {
    for (const { callback } of this.intervals.values()) callback();
  }
}

function makeSnapshot() {
  return {
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: ids.length,
    layers: ids.map((id) => ({
      id,
      enabled: true,
      count: id === 'cctv' ? 250 : 828,
      loading: id === 'cctv',
      loadingLoaded: 17,
      loadingTotal: 250,
      ownership: { timers: 0, pendingJobs: 3, primitives: 2, dataSources: 0 },
      status: 'loading',
      error: null,
    })),
  };
}

test('compact readiness snapshot keeps full ownership counters within its byte cap', () => {
  const selectedLayerIds = [
    'satellites',
    'cctv',
    'alpr',
    'installations',
    'radio',
    'wind',
    'weather-radar',
    'weather-clouds',
  ];
  const snapshot = {
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: selectedLayerIds.length,
    layers: selectedLayerIds.map((id) => ({
      id,
      enabled: true,
      count: 1_000_000,
      loading: true,
      loadingLoaded: 12_345,
      loadingTotal: 1_000_000,
      status: 'geometry-still-loading',
      error: `source failure ${String.fromCodePoint(0x1f600).repeat(300)}`,
      ownership: {
        timers: 1_000_000,
        pendingJobs: 1_000_000,
        primitives: 1_000_000,
        dataSources: 1_000_000,
      },
    })),
  };
  const encoded = encodeAustinOperatingReadinessSnapshot(snapshot);
  assert.equal(typeof encoded, 'string');
  assert.ok(Buffer.byteLength(encoded, 'utf8') <= 1024);
  const decoded = JSON.parse(encoded);
  assert.equal(decoded.layers.length, selectedLayerIds.length);
  assert.ok(decoded.layers.every((layer) => layer.length === 12));
  assert.deepEqual(
    decoded.layers.map((layer) => layer[0]),
    selectedLayerIds,
  );
  assert.deepEqual(
    decoded.layers[1].slice(8),
    [1_000_000, 1_000_000, 1_000_000, 1_000_000],
  );
  assert.ok(decoded.layers[1][7].length <= 32);

  assert.equal(
    encodeAustinOperatingReadinessSnapshot({
      ...snapshot,
      selectedLayerCount: 9,
      layers: [...snapshot.layers, snapshot.layers[0]],
    }),
    null,
  );
  assert.equal(
    encodeAustinOperatingReadinessSnapshot({ ...snapshot, layers: null }),
    null,
  );
});

function makeSession({ send } = {}) {
  const events = new EventEmitter();
  return Object.assign(events, {
    sends: [],
    detachCount: 0,
    send(method, params) {
      this.sends.push({ method, params });
      return send
        ? send(method, params, this)
        : Promise.resolve({ result: { value: makeSnapshot() } });
    },
    async detach() {
      this.detachCount += 1;
    },
  });
}

function makeHistory(page, timers = new ControlledTimers(), options = {}) {
  return {
    timers,
    controller: createAustinOperatingReadinessHistory(page, {
      observerSource,
      selectedLayerIds: ids,
      documentRole: 'provider-sample',
      documentId: 'sample-1',
      timers,
      now: () => 123.5,
      disconnectedEvent: CDPSessionEvent.Disconnected,
      ...options,
    }),
  };
}

test('readiness history retains bounded native layer checkpoints and stops on success', async () => {
  const timers = new ControlledTimers();
  const session = makeSession();
  const page = {
    async createCDPSession() {
      return session;
    },
  };
  const { controller } = makeHistory(page, timers);
  await flush();
  await flush();
  assert.equal(session.sends.length, 1);
  assert.equal(session.sends[0].method, 'Runtime.evaluate');
  assert.equal(session.sends[0].params.returnByValue, true);
  assert.equal(session.sends[0].params.awaitPromise, false);
  assert.match(session.sends[0].params.expression, /cctv/);

  const readinessResult = { handle: 'ready' };
  const wrapped = await waitForAustinOperatingReadiness(
    async () => readinessResult,
    controller,
  );
  assert.equal(wrapped.value, readinessResult);
  assert.equal(wrapped.status, 'ready');
  assert.equal(wrapped.history.samples.length, 1);
  assert.equal(wrapped.history.samples[0].snapshot.layers[1].loadingLoaded, 17);
  assert.equal(wrapped.history.documentRole, 'provider-sample');
  assert.equal(wrapped.history.session.detachStatus, 'confirmed');
  assert.equal(wrapped.history.session.disconnectListenerRemoval, 'confirmed');
  assert.equal(session.listenerCount(CDPSessionEvent.Disconnected), 0);
  assert.equal(session.detachCount, 1);
});

test('stalled evaluation stops polling, never overlaps, and discards its late result', async () => {
  const timers = new ControlledTimers();
  let resolveCommand;
  const session = makeSession({
    send: () =>
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
  });
  const { controller } = makeHistory(
    {
      async createCDPSession() {
        return session;
      },
    },
    timers,
  );
  await flush();
  assert.equal(session.sends.length, 1);
  timers.tickIntervals();
  timers.tickIntervals();
  assert.equal(session.sends.length, 1);

  timers.fireTimeout(1500);
  await flush();
  assert.equal(controller.snapshot().status, 'stalled');
  assert.equal(timers.intervals.size, 0);
  resolveCommand({ result: { value: makeSnapshot() } });
  await flush();
  const history = await controller.stop('readiness-wait-failed');
  assert.equal(history.samples.length, 1);
  assert.equal(history.samples[0].status, 'command-timeout');
  assert.equal(history.samples[0].snapshot, null);
  assert.equal(history.session.detachStatus, 'confirmed');
  assert.equal(session.detachCount, 1);
});

test('readiness cancellation detaches the owned session and ignores a late command', async () => {
  const timers = new ControlledTimers();
  let resolveCommand;
  const session = makeSession({
    send: () =>
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
  });
  const { controller } = makeHistory(
    {
      async createCDPSession() {
        return session;
      },
    },
    timers,
  );
  await flush();
  assert.equal(session.sends.length, 1);
  const history = await controller.stop('readiness-cancelled');
  resolveCommand({ result: { value: makeSnapshot() } });
  await flush();
  assert.equal(history.stopReason, 'readiness-cancelled');
  assert.equal(history.samples.length, 0);
  assert.equal(controller.snapshot().samples.length, 0);
  assert.equal(timers.intervals.size, 0);
  assert.equal(session.listenerCount(CDPSessionEvent.Disconnected), 0);
  assert.equal(session.detachCount, 1);
});

test('entry history remains capped at sixteen while reporting omitted observations', async () => {
  const timers = new ControlledTimers();
  const session = makeSession();
  const { controller } = makeHistory(
    {
      async createCDPSession() {
        return session;
      },
    },
    timers,
  );
  await flush();
  for (let index = 0; index < 20; index += 1) {
    await flush();
    timers.tickIntervals();
    await flush();
  }
  const history = await controller.stop('readiness-wait-failed');
  assert.equal(history.samples.length, 16);
  assert.equal(history.omittedCount, 5);
  assert.deepEqual(
    history.samples.map((row) => row.sequence),
    Array.from({ length: 16 }, (_, index) => index + 6),
  );
});

test('Puppeteer disconnect symbol invalidates an in-flight result and retires sampling', async () => {
  const timers = new ControlledTimers();
  let resolveCommand;
  const session = makeSession({
    send: () =>
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
  });
  const { controller } = makeHistory(
    {
      async createCDPSession() {
        return session;
      },
    },
    timers,
  );
  await flush();
  assert.equal(session.sends.length, 1);
  session.emit(CDPSessionEvent.Disconnected);
  resolveCommand({ result: { value: makeSnapshot() } });
  await flush();
  const history = controller.snapshot();
  assert.equal(history.status, 'disconnected');
  assert.equal(history.samples.at(-1).status, 'disconnected');
  assert.equal(
    history.samples.some((row) => row.status === 'observed'),
    false,
  );
  assert.equal(timers.intervals.size, 0);
  assert.equal(session.listenerCount(CDPSessionEvent.Disconnected), 0);
  assert.equal(history.session.detachStatus, 'confirmed-disconnected');
});

test('late session creation is explicitly bounded and detached after timeout', async () => {
  const timers = new ControlledTimers();
  let resolveSession;
  const page = {
    createCDPSession() {
      return new Promise((resolve) => {
        resolveSession = resolve;
      });
    },
  };
  const { controller } = makeHistory(page, timers);
  await flush();
  timers.fireTimeout(1000);
  assert.equal(controller.snapshot().status, 'unavailable');
  let stopped = false;
  const stopPromise = controller.stop('readiness-wait-failed').then((value) => {
    stopped = true;
    return value;
  });
  await flush();
  assert.equal(stopped, false);
  const lateSession = makeSession();
  resolveSession(lateSession);
  const history = await stopPromise;
  assert.equal(history.status, 'unavailable');
  assert.equal(history.session.lateAttachCleanupStatus, 'confirmed');
  assert.equal(lateSession.detachCount, 1);
});

test('readiness failure identity is preserved while sampler cleanup is bounded', async () => {
  const timers = new ControlledTimers();
  const session = makeSession();
  const { controller } = makeHistory(
    {
      async createCDPSession() {
        return session;
      },
    },
    timers,
  );
  await flush();
  const original = Object.assign(new Error('native readiness timeout'), {
    code: 'ERR_READY',
  });
  const result = await waitForAustinOperatingReadiness(async () => {
    throw original;
  }, controller);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, original);
  assert.equal(result.history.stopReason, 'readiness-wait-failed');
  assert.equal(result.history.session.detachStatus, 'confirmed');
  assert.equal(session.detachCount, 1);
});

test('missing sampler session support does not change the supplied readiness wait', async () => {
  const timers = new ControlledTimers();
  const { controller } = makeHistory({}, timers);
  await flush();
  const sentinel = { exact: 'wait-result' };
  const result = await waitForAustinOperatingReadiness(
    async () => sentinel,
    controller,
  );
  assert.equal(result.value, sentinel);
  assert.equal(result.error, null);
  assert.equal(result.history.status, 'unavailable');
  assert.equal(result.history.samples.at(-1).status, 'session-create-failed');
});
