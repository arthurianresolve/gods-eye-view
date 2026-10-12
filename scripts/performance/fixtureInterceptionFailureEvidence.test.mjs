import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import {
  closeTargetBeforeFixtureInterceptionRelease,
  createFixtureInterceptionErrorRecorder,
  interceptFixtureSession,
} from './fixtureInterception.mjs';
import { compactCaptureCliFailure } from '../qa-performance-build-smoke.mjs';

class FakeClient {
  eventListeners = new Map();
  commands = [];

  on(name, listener) {
    const listeners = this.eventListeners.get(name) || [];
    listeners.push(listener);
    this.eventListeners.set(name, listeners);
  }

  off(name, listener) {
    const listeners = this.eventListeners.get(name) || [];
    this.eventListeners.set(
      name,
      listeners.filter((entry) => entry !== listener),
    );
    return this;
  }

  listeners(name) {
    return [...(this.eventListeners.get(name) || [])];
  }

  listenerCount(name, listener) {
    const listeners = this.listeners(name);
    return listener
      ? listeners.filter((entry) => entry === listener).length
      : listeners.length;
  }

  async detach() {
    this.commands.push({ method: 'detach', params: {} });
  }

  async send(method, params) {
    this.commands.push({ method, params });
    if (method === 'Fetch.enable' || method === 'Fetch.continueRequest')
      return {};
    if (method === 'Fetch.failRequest') return {};
    if (method === 'Fetch.fulfillRequest') return {};
    throw new Error(`Unexpected command ${method}`);
  }

  async request(event) {
    await Promise.all(
      this.listeners('Fetch.requestPaused').map((listener) => listener(event)),
    );
  }
}

const event = (url) => ({
  requestId: 'request-1',
  request: { url, method: 'GET' },
});

function contextFor(state) {
  return () => ({
    sessionOrdinal: 3,
    documentRole: 'provider-sample-0',
    documentId: 'doc-3',
    lifecycleStage: state.lifecycleStage,
  });
}

test('interception callback evidence survives failure-report creation and smoke compaction', async () => {
  const client = new FakeClient();
  const state = { lifecycleStage: 'active' };
  const recorder = createFixtureInterceptionErrorRecorder();
  await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => {
      throw new Error(
        'fixture callback failed at https://provider.invalid/path?token=secret',
      );
    },
    recorder.onError,
    { getErrorContext: contextFor(state) },
  );
  await client.request(event('http://127.0.0.1:4173/api/aircraft'));
  const report = createCaptureFailureReport({
    phase: 'fixture-delivery',
    error: new Error('Capture failed.'),
    fixtureInterceptionErrors: recorder.records,
  });
  const compacted = compactCaptureCliFailure(report);
  const observed = compacted.summary.fixtureInterceptionErrors[0];
  assert.equal(observed.phase, 'request-command');
  assert.equal(observed.documentRole, 'provider-sample-0');
  assert.equal(observed.documentId, 'doc-3');
  assert.equal(observed.sessionOrdinal, 3);
  assert.equal(observed.lifecycleStage, 'active');
  assert.match(observed.message, /\[url\]/);
  assert.equal(JSON.stringify(compacted).includes('provider.invalid'), false);
  assert.equal(JSON.stringify(compacted).includes('secret'), false);
  assert.equal(JSON.stringify(compacted).includes('requestId'), false);
});

test('fulfillment callback and command errors retain their bounded phase', async () => {
  const callbackClient = new FakeClient();
  const state = { lifecycleStage: 'releasing' };
  const callbackRecorder = createFixtureInterceptionErrorRecorder();
  await interceptFixtureSession(
    callbackClient,
    'http://127.0.0.1:4173/',
    async () => ({ status: 200, body: 'ok' }),
    callbackRecorder.onError,
    {
      getErrorContext: contextFor(state),
      onFulfilled() {
        throw new Error('fulfillment observer failed');
      },
    },
  );
  await callbackClient.request(event('http://127.0.0.1:4173/api/fixture'));
  assert.equal(callbackRecorder.records[0].phase, 'fulfillment-callback');
  assert.equal(callbackRecorder.records[0].lifecycleStage, 'releasing');

  const commandClient = new FakeClient();
  commandClient.send = async (method) => {
    if (method === 'Fetch.fulfillRequest') throw new Error('command failed');
    return {};
  };
  const commandRecorder = createFixtureInterceptionErrorRecorder();
  await interceptFixtureSession(
    commandClient,
    'http://127.0.0.1:4173/',
    async () => ({ status: 200, body: 'ok' }),
    commandRecorder.onError,
    { getErrorContext: contextFor({ lifecycleStage: 'active' }) },
  );
  await commandClient.request(event('http://127.0.0.1:4173/api/fixture'));
  assert.equal(commandRecorder.records[0].phase, 'command-send');
});

test('release drains issued commands before target closure and preserves unrelated listeners', async () => {
  const client = new FakeClient();
  const unrelatedListener = () => {};
  client.on('Fetch.requestPaused', unrelatedListener);
  let completeContinue;
  client.send = async (method, params) => {
    client.commands.push({ method, params });
    if (method === 'Fetch.enable' || method === 'Fetch.failRequest') return {};
    if (method === 'Fetch.continueRequest')
      return new Promise((resolve) => {
        completeContinue = resolve;
      });
    throw new Error(`Unexpected command ${method}`);
  };
  const recorder = createFixtureInterceptionErrorRecorder();
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => null,
    recorder.onError,
  );

  const request = client.request(event('http://127.0.0.1:4173/data.json'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(completeContinue);
  let pageClosed = false;
  const release = (async () => {
    const stopped = await controller.stopAndDrain();
    assert.equal(stopped.confirmed, true);
    assert.equal(pageClosed, false);
    client.commands.push({ method: 'page.close', params: {} });
    pageClosed = true;
    return controller.releaseSession({ targetClosed: pageClosed });
  })();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.listenerCount('Fetch.requestPaused'), 1);
  assert.equal(
    client.listeners('Fetch.requestPaused').includes(unrelatedListener),
    true,
  );
  assert.equal(
    client.commands.some(({ method }) => method === 'Fetch.disable'),
    false,
  );

  completeContinue({});
  await request;
  const result = await release;
  assert.equal(result.confirmed, true);
  assert.equal(result.interception.pendingAtStop, 1);
  assert.equal(result.interception.pendingPreparationAtStop, 0);
  assert.equal(result.interception.pendingCommandsAfterDrain, 0);
  assert.deepEqual(
    client.commands.map(({ method }) => method),
    ['Fetch.enable', 'Fetch.continueRequest', 'page.close'],
  );
  assert.equal(recorder.records.length, 0);
});

test('a copied stale listener records late work without sending after target closure', async () => {
  const client = new FakeClient();
  const recorder = createFixtureInterceptionErrorRecorder();
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => null,
    recorder.onError,
    { getErrorContext: contextFor({ lifecycleStage: 'releasing' }) },
  );
  const listener = client.listeners('Fetch.requestPaused')[0];
  const stopped = await controller.stopAndDrain();
  assert.equal(stopped.confirmed, true);

  client.commands.push({ method: 'page.close', params: {} });
  listener(event('http://127.0.0.1:4173/late.json'));
  await new Promise((resolve) => setImmediate(resolve));
  const release = await controller.releaseSession({ targetClosed: true });
  assert.equal(release.confirmed, false);
  assert.equal(release.interception.unexpectedLateRequestCount, 1);
  assert.deepEqual(
    client.commands.map(({ method }) => method),
    ['Fetch.enable', 'page.close'],
  );
  assert.equal(recorder.records.length, 1);
  assert.equal(recorder.records[0].lifecycleStage, 'releasing');
  assert.equal(recorder.records[0].phase, 'command-send');
});

test('stop cancels pending response preparation before the caller closes its target', async () => {
  const client = new FakeClient();
  let resolveResponse;
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    () => {},
  );
  const request = client.request(event('http://127.0.0.1:4173/data.json'));
  await Promise.resolve();
  assert.ok(resolveResponse);

  const stopped = await controller.stopAndDrain();
  assert.equal(stopped.confirmed, true);
  client.commands.push({ method: 'page.close', params: {} });
  const release = await controller.releaseSession({ targetClosed: true });
  assert.equal(release.confirmed, true);
  assert.equal(release.interception.pendingPreparationAtStop, 1);
  assert.equal(release.interception.pendingPreparationsAfterDrain, 0);
  assert.equal(release.interception.cancelledPreparationCount, 1);
  assert.equal(release.interception.pendingAbortSubscriptionsAfterDrain, 0);
  assert.deepEqual(
    client.commands.map(({ method }) => method),
    ['Fetch.enable', 'page.close'],
  );

  resolveResponse(null);
  await request;
  assert.deepEqual(
    client.commands.map(({ method }) => method),
    ['Fetch.enable', 'page.close'],
  );
});

test('completed request preparations detach their per-request abort subscriptions', async () => {
  const client = new FakeClient();
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => null,
    () => {},
  );
  for (let index = 0; index < 20; index++)
    await client.request(event(`http://127.0.0.1:4173/data-${index}.json`));
  const stopped = await controller.stopAndDrain();
  assert.equal(stopped.pendingAbortSubscriptionsAtStop, 0);
  assert.equal(stopped.pendingAbortSubscriptionsAfterDrain, 0);
  assert.equal(stopped.pendingAtStop, 0);
  assert.equal(stopped.confirmed, true);
});

test('stop settles every issued command when one command rejects and preserves its failure', async () => {
  const client = new FakeClient();
  const recorder = createFixtureInterceptionErrorRecorder();
  client.send = async (method, params) => {
    client.commands.push({ method, params });
    if (method === 'Fetch.enable') return {};
    if (method === 'Fetch.continueRequest')
      throw new Error('issued command rejected during retirement');
    if (method === 'Fetch.failRequest') return {};
    throw new Error(`Unexpected command ${method}`);
  };
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => null,
    recorder.onError,
    { getErrorContext: contextFor({ lifecycleStage: 'active' }) },
  );
  await client.request(event('http://127.0.0.1:4173/reject.json'));
  const stopped = await controller.stopAndDrain();
  assert.equal(stopped.confirmed, false);
  assert.equal(stopped.drainCommandFailures, 1);
  assert.ok(
    recorder.records.some((record) =>
      record.message.includes('issued command rejected during retirement'),
    ),
  );
  assert.equal(stopped.pendingCommandsAfterDrain, 0);
  assert.equal(client.listenerCount('Fetch.requestPaused'), 0);
});

test('late callback records released owner and error evidence stays capped at eight', async () => {
  const client = new FakeClient();
  const state = { lifecycleStage: 'active' };
  const recorder = createFixtureInterceptionErrorRecorder();
  await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    async () => {
      throw new Error('fixture failure');
    },
    recorder.onError,
    { getErrorContext: contextFor(state) },
  );
  state.lifecycleStage = 'released';
  for (let index = 0; index < 10; index++)
    await client.request(event(`http://127.0.0.1:4173/api/${index}`));
  assert.equal(recorder.records.length, 8);
  assert.ok(
    recorder.records.every((record) => record.lifecycleStage === 'released'),
  );
  assert.ok(recorder.records.every((record) => record.sessionOrdinal === 3));
  const report = createCaptureFailureReport({
    phase: 'fixture-delivery',
    error: new Error('Capture failed.'),
    fixtureInterceptionErrors: recorder.records,
  });
  const compacted = compactCaptureCliFailure(report);
  assert.equal(compacted.summary.fixtureInterceptionErrors.length, 8);
  assert.equal(compacted.rawReport.fixtureInterceptionErrors.length, 8);
});

test('recorder rejects unsafe context values and limits above the global bound', () => {
  assert.throws(
    () => createFixtureInterceptionErrorRecorder({ limit: 9 }),
    /limit must be 0–8/,
  );
  const recorder = createFixtureInterceptionErrorRecorder();
  recorder.onError(new Error('bad'), {
    phase: 'unknown-command',
    documentRole: 'https://secret.invalid',
    documentId: 'C:\\private\\path',
    sessionOrdinal: -1,
    lifecycleStage: 'destroyed',
  });
  assert.deepEqual(recorder.records[0], {
    message: 'bad',
    phase: 'unknown',
    documentRole: null,
    documentId: null,
    sessionOrdinal: null,
    lifecycleStage: 'unknown',
  });

  const sensitive = createFixtureInterceptionErrorRecorder();
  sensitive.onError(
    new Error(
      'Authorization: Bearer abc123 token: "secret-token" Basic Zm9vOmJhcg== at /Users/private/file C:/Users/private/file',
    ),
    contextFor({ lifecycleStage: 'active' })(),
  );
  const serialized = JSON.stringify(sensitive.records);
  for (const value of [
    'abc123',
    'Zm9vOmJhcg==',
    'secret-token',
    '/Users/private',
    'C:/Users/private',
  ])
    assert.equal(serialized.includes(value), false);
});

test('a rejected close acknowledgement stays failed even if the target is closed', async () => {
  let closed = false;
  let releaseCalled = false;
  const closeError = new Error('page.close acknowledgement was rejected');
  const outcome = await closeTargetBeforeFixtureInterceptionRelease(
    {
      isClosed: () => closed,
      async close() {
        closed = true;
        throw closeError;
      },
    },
    {
      async releaseSession({ targetClosed }) {
        assert.equal(targetClosed, true);
        releaseCalled = true;
        return {
          fetchDisable: 'target-closed',
          detach: 'target-closed',
          confirmed: true,
        };
      },
    },
  );
  assert.equal(releaseCalled, true);
  assert.equal(outcome.targetClosed, true);
  assert.equal(outcome.error, closeError);
  assert.equal(outcome.confirmed, false);
  assert.equal(outcome.release.confirmed, true);
});
