import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { twoline2satrec } from 'satellite.js';
import { createOrbits } from '../../src/layers/satellites/orbits.js';
import { createAustinOperatingWorkloadFixture } from './austinOperatingWorkloadFixture.mjs';
import {
  deriveAustinSatelliteSampledEpoch,
  loadAustinSatelliteEpochReference,
  validateAustinSatelliteSampledEpoch,
  validateAustinSatelliteEpochCaptureReport,
} from './austinSatelliteSampledEpoch.mjs';

const fixture = createAustinOperatingWorkloadFixture();
const reference = loadAustinSatelliteEpochReference(fixture);
const orbits = createOrbits({ state: {}, services: {}, parts: {}, source: {} });
const boundaryEpochMs = fixture.fixedTimeMs + 30_000;
const document = { role: 'provider-sample-1', id: 'sample-doc-1' };

function recordsAt(epochMs) {
  return [...reference.catalog.values()].map((entry) => {
    const satrec = twoline2satrec(entry.line1, entry.line2);
    const position = orbits.propagatePosition(satrec, new Date(epochMs));
    return {
      id: entry.id,
      longitude: position.longitude,
      latitude: position.latitude,
      altitudeM: position.altitude,
    };
  });
}

function derive(records, epochMs = boundaryEpochMs) {
  return deriveAustinSatelliteSampledEpoch({
    reference,
    records,
    boundaryEpochMs: epochMs,
    boundary: 'warmup-held',
    documentRole: document.role,
    documentId: document.id,
    runOrdinal: 1,
  });
}

test('derives one cached fleet epoch and verifies every pinned satellite record', () => {
  const records = recordsAt(boundaryEpochMs);
  const evidence = derive(records);
  assert.equal(evidence.recordCount, 828);
  assert.equal(evidence.ageMs, 0);
  assert.equal(evidence.derivedEpochMs, boundaryEpochMs);
  assert.equal(evidence.performanceAcceptanceEligible, true);
  assert.equal(
    evidence.numericalBoundStatus,
    'exact-boundary-and-node-recomputed',
  );
  assert.ok(evidence.maximumResidualMeters <= 0.001);
  assert.equal(evidence.records.length, 828);
  assert.equal(evidence.documentRole, document.role);
  assert.equal(evidence.documentId, document.id);
  const digest = (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex');
  assert.equal(
    evidence.identitySha256,
    digest(
      records
        .map((row) => String(row.id))
        .sort()
        .join('\n'),
    ),
  );
  assert.equal(
    evidence.positionSha256,
    digest(
      records
        .map(
          (row) =>
            `${row.id}|${row.latitude}|${row.longitude}|${row.altitudeM}`,
        )
        .sort()
        .join('\n'),
    ),
  );
});

test('rejects missing, duplicate, wrong-identity, stale, mixed-epoch and changed positions', () => {
  const records = recordsAt(boundaryEpochMs);
  assert.throws(() => derive(records.slice(1)), /828/);
  assert.throws(() => derive([...records, records[0]]), /828/);
  assert.throws(
    () => derive([records[0], ...records.slice(1, -1), records[0]]),
    /duplicate/,
  );
  const extraField = records.map((row) => ({ ...row }));
  extraField[0].label = 'unexpected payload';
  assert.throws(() => derive(extraField), /public cached-position fields/);
  const wrongIdentity = records.map((row) => ({ ...row }));
  wrongIdentity[0].id = 999_999;
  assert.throws(() => derive(wrongIdentity), /identity|NORAD|pinned TLE/i);
  assert.throws(
    () => derive(recordsAt(boundaryEpochMs - 1001)),
    /unique epoch|one-second/i,
  );
  assert.throws(
    () => derive(recordsAt(boundaryEpochMs + 1)),
    /unique epoch|one-second/i,
  );
  const mixedEpoch = records.map((row) => ({ ...row }));
  const mixedPosition = recordsAt(boundaryEpochMs - 900).find(
    (row) => row.id === mixedEpoch[0].id,
  );
  Object.assign(mixedEpoch[0], mixedPosition);
  assert.throws(
    () => derive(mixedEpoch),
    /does not match|unique epoch|declared fixture boundary/i,
  );
  const changed = records.map((row) => ({ ...row }));
  changed[0].latitude += 0.00001;
  assert.throws(() => derive(changed), /does not match|unique epoch/i);
});

test('rejects fixture metadata that no longer binds the exact acquired TLE bytes', () => {
  const missingGroup = structuredClone(fixture);
  missingGroup.acquisition.tle.rows.pop();
  assert.throws(() => loadAustinSatelliteEpochReference(missingGroup));

  const duplicateGroup = structuredClone(fixture);
  duplicateGroup.acquisition.tle.rows[5] = structuredClone(
    duplicateGroup.acquisition.tle.rows[0],
  );
  assert.throws(() => loadAustinSatelliteEpochReference(duplicateGroup));

  const changedFixture = structuredClone(fixture);
  changedFixture.acquisition.tle.rows[0].sha256 = 'f'.repeat(64);
  changedFixture.assets.find((asset) => asset.id === 'tle-stations').sha256 =
    'f'.repeat(64);
  assert.throws(
    () => loadAustinSatelliteEpochReference(changedFixture),
    /TLE|SHA|hash|byte/i,
  );
});

test('historical v1 sampled epochs remain verifiable but ineligible', () => {
  const legacyEpochMs = boundaryEpochMs - 768;
  const exactAtLegacyEpoch = deriveAustinSatelliteSampledEpoch({
    reference,
    records: recordsAt(legacyEpochMs),
    boundaryEpochMs: legacyEpochMs,
    boundary: 'warmup-held',
    documentRole: document.role,
    documentId: document.id,
    runOrdinal: 1,
  });
  const legacy = {
    ...exactAtLegacyEpoch,
    schema: 'gev-austin-satellite-sampled-epoch/v1',
    numericalBoundStatus: 'provisional-not-cross-engine-validated',
    performanceAcceptanceEligible: false,
    boundaryEpochMs,
    derivedEpochMs: legacyEpochMs,
    ageMs: boundaryEpochMs - legacyEpochMs,
  };
  assert.equal(
    validateAustinSatelliteSampledEpoch({
      fixture,
      reference,
      evidence: legacy,
      expectedBoundary: 'warmup-held',
      expectedBoundaryEpochMs: boundaryEpochMs,
      expectedDocumentRole: document.role,
      expectedDocumentId: document.id,
      expectedRunOrdinal: 1,
    }),
    true,
  );
});

test('capture report validation binds both raw boundaries to the owning sample document', () => {
  const documentId = document.id;
  const warmupEvidence = derive(recordsAt(boundaryEpochMs));
  const measurementEpochMs = boundaryEpochMs + 60_000;
  const measurementEvidence = deriveAustinSatelliteSampledEpoch({
    reference,
    records: recordsAt(measurementEpochMs),
    boundaryEpochMs: measurementEpochMs,
    boundary: 'measurement-complete',
    documentRole: document.role,
    documentId,
    runOrdinal: 1,
  });
  const captures = [
    {
      documentRole: document.role,
      documentId,
      austinOperatingClock: {
        runOrdinal: 1,
        satelliteSampledEpochs: {
          warmupHeld: warmupEvidence,
          measurementComplete: measurementEvidence,
        },
      },
    },
  ];
  const args = {
    fixture,
    warmupMs: 30_000,
    durationPerSampleMs: 60_000,
    captures,
  };
  assert.equal(validateAustinSatelliteEpochCaptureReport(args), true);

  const changedRows = structuredClone(captures);
  changedRows[0].austinOperatingClock.satelliteSampledEpochs.warmupHeld.records[0].longitude += 0.01;
  assert.throws(
    () =>
      validateAustinSatelliteEpochCaptureReport({
        ...args,
        captures: changedRows,
      }),
    /does not match|unique epoch/i,
  );
  const swappedDocument = structuredClone(captures);
  swappedDocument[0].documentId = 'different-document';
  assert.throws(
    () =>
      validateAustinSatelliteEpochCaptureReport({
        ...args,
        captures: swappedDocument,
      }),
    /document/i,
  );
});
