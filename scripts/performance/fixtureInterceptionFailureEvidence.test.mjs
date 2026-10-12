import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import {
  createFixtureInterceptionErrorRecorder,
  interceptFixtureSession,
} from './fixtureInterception.mjs';
import { compactCaptureCliFailure } from '../qa-performance-build-smoke.mjs';

class FakeClient {
  listeners = new Map();
  commands = [];

  on(name, listener) {
    this.listeners.set(name, listener);
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
    return this.listeners.get('Fetch.requestPaused')(event);
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
