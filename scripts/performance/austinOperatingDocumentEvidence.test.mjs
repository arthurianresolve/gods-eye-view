import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAustinOperatingDocumentEvidence } from './austinOperatingDocumentEvidence.mjs';
import {
  interceptFixtureSession,
  closeTargetBeforeFixtureInterceptionRelease,
} from './fixtureInterception.mjs';

const delivery = {
  schema: 'gev-austin-operating-delivery/v1',
  status: 'observed',
  fixtureSha256: 'a'.repeat(64),
  fulfilledResponseCount: 12,
};

function release(overrides = {}) {
  const drain = {
    schema: 'gev-fixture-interception-drain/v1',
    confirmed: true,
    listenerRemovalConfirmed: true,
    pendingAtStop: 2,
    pendingCommandsAfterDrain: 0,
    pendingPreparationsAfterDrain: 0,
    pendingAbortSubscriptionsAfterDrain: 0,
    rejectedDrainOperations: 0,
    drainCommandFailures: 0,
    unexpectedLateRequestCount: 0,
  };
  return {
    schema: 'gev-flight-fixture-session-release/v1',
    sessionOrdinal: 7,
    documentRole: 'provider-sample-1',
    documentId: 'provider-document-1',
    confirmed: true,
    targetClosed: true,
    stop: structuredClone(drain),
    interception: {
      schema: 'gev-fixture-interception-release/v1',
      confirmed: true,
      interception: structuredClone(drain),
      fetchDisable: 'target-closed',
      detach: 'target-closed',
    },
    ...overrides,
  };
}

function evidence(records = [release()], overrides = {}) {
  return createAustinOperatingDocumentEvidence({
    documentRole: 'provider-sample-1',
    documentId: 'provider-document-1',
    sessionOrdinal: 7,
    delivery,
    releaseRecords: records,
    disposed: true,
    disposeReason: 'provider-document-retired-after-interception-release',
    ...overrides,
  });
}

test('Austin document evidence binds delivery and confirmed interception release by identity', () => {
  const result = evidence();
  assert.equal(result.schema, 'gev-austin-operating-document-evidence/v1');
  assert.equal(result.cleanup.status, 'confirmed');
  assert.equal(result.cleanup.matchingReleaseCount, 1);
  assert.deepEqual(result.delivery, delivery);
  assert.equal(result.interceptionRelease.documentId, 'provider-document-1');
  assert.equal(result.interceptionRelease.stop.pendingAtStop, 2);
});

test('Austin document evidence fails closed for missing, duplicate, mismatched or unsuccessful release', () => {
  for (const records of [
    [],
    [release(), release()],
    [release({ documentId: 'provider-document-2' })],
    [release({ confirmed: false })],
    [release({ targetClosed: false })],
    [release({ stop: { confirmed: false } })],
    [release({ interception: { confirmed: false } })],
  ]) {
    const result = evidence(records);
    assert.equal(result.cleanup.status, 'incomplete');
    assert.equal(result.cleanup.confirmed, false);
  }
  assert.equal(
    evidence([release()], { disposed: false }).cleanup.confirmed,
    false,
  );
});

test('Austin document evidence is bounded and serializable when cleanup fails', () => {
  const result = evidence([release({ confirmed: false })], {
    error: { name: 'Error', message: 'x'.repeat(1000) },
  });
  assert.equal(result.error.message.length, 240);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('Austin document evidence requires a valid identity and fully drained release', () => {
  for (const overrides of [
    { documentRole: '' },
    { documentId: '' },
    { sessionOrdinal: 0 },
    { sessionOrdinal: -1 },
    { sessionOrdinal: 1.5 },
  ]) {
    assert.equal(evidence([release()], overrides).cleanup.confirmed, false);
  }
  for (const key of [
    'pendingCommandsAfterDrain',
    'pendingPreparationsAfterDrain',
    'pendingAbortSubscriptionsAfterDrain',
    'rejectedDrainOperations',
    'drainCommandFailures',
    'unexpectedLateRequestCount',
  ])
    for (const value of [undefined, 1, -1, NaN]) {
      for (const target of ['stop', 'final']) {
        const changed = release();
        const drain =
          target === 'stop' ? changed.stop : changed.interception.interception;
        drain[key] = value;
        assert.equal(
          evidence([changed]).cleanup.confirmed,
          false,
          `${target}.${key}`,
        );
      }
    }
  const legacy = release();
  legacy.stop = { confirmed: true, pendingAfterDrain: 0 };
  assert.equal(evidence([legacy]).cleanup.confirmed, false);
});

test('Austin evidence consumes the real interception producer after target closure', async () => {
  const client = new EventEmitter();
  const commands = [];
  client.send = async (method) => {
    commands.push(method);
    return {};
  };
  const interception = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    () => ({ status: 200, contentType: 'application/json', body: '{}' }),
    (error) => {
      throw error;
    },
  );
  await Promise.all(
    client.listeners('Fetch.requestPaused').map((listener) =>
      listener({
        requestId: 'owned-request',
        request: { url: 'http://127.0.0.1:4173/api/test', method: 'GET' },
      }),
    ),
  );
  const stop = await interception.stopAndDrain();
  let closed = false;
  const page = {
    isClosed: () => closed,
    close: async () => {
      closed = true;
    },
  };
  const targetRelease = await closeTargetBeforeFixtureInterceptionRelease(
    page,
    interception,
  );
  assert.equal(targetRelease.confirmed, true);
  assert.equal(client.listenerCount('Fetch.requestPaused'), 0);
  assert.equal('pendingAfterDrain' in stop, false);
  const record = release({ stop, interception: targetRelease.release });
  assert.equal(evidence([record]).cleanup.confirmed, true);
  assert.ok(commands.includes('Fetch.fulfillRequest'));
});
