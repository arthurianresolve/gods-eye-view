import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStartupProviderFixtureDocument,
  STARTUP_PROVIDER_URL_PATTERNS,
  summarizeStartupProviderFixtureDiagnostic,
} from './startupProviderFixtureDiagnostic.mjs';

test('startup diagnostic scope contains only the five native map provider origins', () => {
  assert.deepEqual(STARTUP_PROVIDER_URL_PATTERNS, [
    'https://services.arcgisonline.com/*',
    'https://terrain.reearth.land/*',
    'https://tile.openstreetmap.org/*',
    'https://tile.googleapis.com/*',
    'https://assets.ion.cesium.com/*',
  ]);
  assert.equal(Object.isFrozen(STARTUP_PROVIDER_URL_PATTERNS), true);
});

function makeOwner(overrides = {}) {
  const owner = {
    documentRole: 'startup-page',
    documentId: 'startup-1',
    sessionOrdinal: 3,
    disposed: true,
    error: null,
    unmatchedExternal: {
      count: 0,
      byProvider: {},
      examples: [],
      omittedExamples: 0,
    },
    finalEvidence: {
      cleanupConfirmed: true,
      requestedCount: 2,
      fulfilledAckCount: 2,
      cancelledCount: 0,
      pendingCount: 0,
      errorObservationCount: 0,
      omittedErrorObservationCount: 0,
      omittedErrorKindCount: 0,
      unexpectedFulfillmentCount: 0,
      assets: [
        {
          path: 'imagery/2/1/1.png',
          sha256: 'a'.repeat(64),
          byteLength: 512,
          requests: 2,
          fulfilledAckCount: 2,
        },
      ],
    },
    ...overrides,
  };
  return owner;
}

const matchingRelease = {
  documentRole: 'startup-page',
  documentId: 'startup-1',
  sessionOrdinal: 3,
  confirmed: true,
};

test('provider fixture coverage requires acknowledged payloads and one confirmed release', () => {
  const owner = makeOwner();
  const document = classifyStartupProviderFixtureDocument(owner, [
    matchingRelease,
  ]);
  assert.equal(document.status, 'completed');
  assert.equal(document.delivery.fulfilledAckCount, 2);
  assert.equal(document.delivery.assets[0].sha256, 'a'.repeat(64));
  assert.equal(document.release.confirmed, true);
});

test('unmatched external providers and absent ACKs remain incomplete', () => {
  const unmatchedOwner = makeOwner({
    unmatchedExternal: {
      count: 1,
      byProvider: { arcgis: 1 },
      examples: [{ provider: 'arcgis', method: 'GET', resourceType: 'image' }],
      omittedExamples: 0,
    },
  });
  assert.equal(
    classifyStartupProviderFixtureDocument(unmatchedOwner, [matchingRelease])
      .status,
    'incomplete',
  );

  const noAckOwner = makeOwner({
    finalEvidence: {
      ...makeOwner().finalEvidence,
      requestedCount: 0,
      fulfilledAckCount: 0,
      assets: [],
    },
  });
  assert.equal(
    classifyStartupProviderFixtureDocument(noAckOwner, [matchingRelease])
      .status,
    'incomplete',
  );
});

test('missing or duplicate release evidence is failed', () => {
  const owner = makeOwner();
  assert.equal(
    classifyStartupProviderFixtureDocument(owner, []).status,
    'failed',
  );
  assert.equal(
    classifyStartupProviderFixtureDocument(owner, [
      matchingRelease,
      { ...matchingRelease },
    ]).status,
    'failed',
  );
});

test('malformed payload hashes and inconsistent acknowledgments fail', () => {
  for (const patch of [
    { sha256: 'not-a-digest' },
    { fulfilledAckCount: 1 },
    { byteLength: -1 },
  ]) {
    const owner = makeOwner();
    Object.assign(owner.finalEvidence.assets[0], patch);
    assert.equal(
      classifyStartupProviderFixtureDocument(owner, [matchingRelease]).status,
      'failed',
    );
  }
});

test('pending delivery, errors and evidence overflow are failed', () => {
  const base = makeOwner();
  for (const patch of [
    { pendingCount: 1 },
    { errorObservationCount: 1 },
    { omittedErrorObservationCount: 1 },
    { omittedErrorKindCount: 1 },
  ]) {
    const owner = makeOwner({
      finalEvidence: { ...base.finalEvidence, ...patch },
    });
    assert.equal(
      classifyStartupProviderFixtureDocument(owner, [matchingRelease]).status,
      'failed',
    );
  }
  const overflowOwner = makeOwner({
    unmatchedExternal: {
      count: 9,
      byProvider: { arcgis: 9 },
      examples: Array.from({ length: 8 }, () => ({ provider: 'arcgis' })),
      omittedExamples: 1,
    },
  });
  assert.equal(
    classifyStartupProviderFixtureDocument(overflowOwner, [matchingRelease])
      .status,
    'failed',
  );
});

test('disposal and diagnostic-summary errors are contained as failed evidence', () => {
  const disposalFailure = makeOwner({
    disposed: false,
    error: new Error('dispose failed'),
  });
  assert.equal(
    classifyStartupProviderFixtureDocument(disposalFailure, [matchingRelease])
      .status,
    'failed',
  );

  const summaryFailure = makeOwner({
    finalEvidence: null,
    delivery: {
      summary() {
        throw new Error('summary failed');
      },
    },
  });
  assert.doesNotThrow(() =>
    classifyStartupProviderFixtureDocument(summaryFailure, [matchingRelease]),
  );
  assert.equal(
    classifyStartupProviderFixtureDocument(summaryFailure, [matchingRelease])
      .status,
    'failed',
  );
});

test('top-level diagnostic remains noneligible and publication does not throw', () => {
  assert.doesNotThrow(() =>
    summarizeStartupProviderFixtureDiagnostic({
      fixture: null,
      owners: [
        {
          get finalEvidence() {
            throw new Error('broken owner');
          },
        },
      ],
      releases: [],
      ineligibleReason: 'diagnostic only',
    }),
  );
  const result = summarizeStartupProviderFixtureDiagnostic({
    fixture: { manifestSha256: 'b'.repeat(64) },
    owners: [makeOwner()],
    releases: [matchingRelease],
    ineligibleReason: 'diagnostic only',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.acceptanceEligible, false);
  assert.equal(result.documents.length, 1);
});
