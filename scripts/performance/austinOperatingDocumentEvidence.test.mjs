import test from 'node:test';
import assert from 'node:assert/strict';
import { createAustinOperatingDocumentEvidence } from './austinOperatingDocumentEvidence.mjs';

const delivery = {
  schema: 'gev-austin-operating-delivery/v1',
  status: 'observed',
  fixtureSha256: 'a'.repeat(64),
  fulfilledResponseCount: 12,
};

function release(overrides = {}) {
  return {
    schema: 'gev-flight-fixture-session-release/v1',
    sessionOrdinal: 7,
    documentRole: 'provider-sample-1',
    documentId: 'provider-document-1',
    confirmed: true,
    targetClosed: true,
    stop: { confirmed: true, pendingAtStop: 2, pendingAfterDrain: 0 },
    interception: {
      confirmed: true,
      fetchDisable: 'acknowledged',
      detach: 'acknowledged',
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
  for (const pendingAfterDrain of [undefined, 1]) {
    const changed = release({
      stop: { confirmed: true, pendingAtStop: 1, pendingAfterDrain },
    });
    assert.equal(evidence([changed]).cleanup.confirmed, false);
  }
});
