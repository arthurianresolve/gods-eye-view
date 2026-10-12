import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { twoline2satrec } from 'satellite.js';
import { decodeTleCatalogNumber, parseTleText } from '../../src/sources/tle.js';
import { CATALOG_GROUPS } from '../../src/layers/satellites/policy.js';
import { createOrbits } from '../../src/layers/satellites/orbits.js';

export const AUSTIN_SATELLITE_EPOCH_SCHEMA =
  'gev-austin-satellite-sampled-epoch/v1';
export const AUSTIN_SATELLITE_SAMPLE_COUNT = 828;
export const AUSTIN_SATELLITE_EPOCH_MAX_AGE_MS = 1000;
export const AUSTIN_SATELLITE_EPOCH_TOLERANCE_METERS = 0.001;

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TLE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_TLE_BYTES = 8 * 1024 * 1024;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const ORBITS = createOrbits({ state: {}, services: {}, parts: {}, source: {} });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashIds = (ids) =>
  sha256(Buffer.from(ids.map(String).sort().join('\n'), 'utf8'));

function assertPlainRecord(row, index) {
  assert.ok(row && typeof row === 'object' && !Array.isArray(row));
  assert.deepEqual(
    Object.keys(row).sort(),
    ['altitudeM', 'id', 'latitude', 'longitude'],
    `satellite position ${index} must contain only the public cached-position fields`,
  );
  assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
  assert.ok(
    Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90,
  );
  assert.ok(
    Number.isFinite(row.longitude) &&
      row.longitude >= -180 &&
      row.longitude <= 180,
  );
  assert.ok(
    Number.isFinite(row.altitudeM) &&
      row.altitudeM >= -1000 &&
      row.altitudeM <= 100_000_000,
  );
}

function canonicalRecords(records) {
  assert.ok(
    Array.isArray(records),
    'cached satellite positions must be an array',
  );
  assert.equal(
    records.length,
    AUSTIN_SATELLITE_SAMPLE_COUNT,
    'cached satellite position sample must contain all 828 core records',
  );
  records.forEach(assertPlainRecord);
  const sorted = records
    .map(({ id, latitude, longitude, altitudeM }) => ({
      id,
      latitude,
      longitude,
      altitudeM,
    }))
    .sort((left, right) => left.id - right.id);
  assert.equal(
    new Set(sorted.map((row) => row.id)).size,
    sorted.length,
    'cached satellite positions contain duplicate NORAD identities',
  );
  return sorted;
}

function positionHash(records) {
  return sha256(
    Buffer.from(
      records
        .map(
          ({ id, latitude, longitude, altitudeM }) =>
            `${id}|${latitude}|${longitude}|${altitudeM}`,
        )
        .sort()
        .join('\n'),
      'utf8',
    ),
  );
}

function toCartesian(row) {
  return Cesium.Cartesian3.fromDegrees(
    row.longitude,
    row.latitude,
    row.altitudeM,
  );
}

function propagateCartesian(entry, epochMs) {
  // satellite.js propagation can update deep-space scratch state. A fresh
  // satrec makes every validation independent of prior boundary calls.
  const satrec = twoline2satrec(entry.line1, entry.line2);
  if (!satrec || satrec.error !== 0) return null;
  const position = ORBITS.propagatePosition(satrec, new Date(epochMs));
  if (!position) return null;
  return Cesium.Cartesian3.fromDegrees(
    position.longitude,
    position.latitude,
    position.altitude,
  );
}

/** Load and verify the exact TLE source catalog pinned by the Austin fixture. */
export function loadAustinSatelliteEpochReference(fixture) {
  assert.equal(fixture?.schema, 'gev-austin-operating-fixture/v1');
  const acquisitionRows = fixture.acquisition?.tle?.rows;
  assert.ok(Array.isArray(acquisitionRows));
  assert.equal(acquisitionRows.length, CATALOG_GROUPS.length);
  const rowsByGroup = new Map(acquisitionRows.map((row) => [row.group, row]));
  assert.equal(rowsByGroup.size, CATALOG_GROUPS.length);
  const assetRows = new Map(
    (fixture.assets || []).map((asset) => [asset.id, asset]),
  );
  const catalog = new Map();
  const tleAssetSha256s = {};
  let totalTleBytes = 0;

  for (const group of CATALOG_GROUPS) {
    const acquisition = rowsByGroup.get(group.path);
    const asset = assetRows.get(`tle-${group.path}`);
    assert.ok(
      acquisition && asset,
      `pinned TLE group ${group.path} is missing`,
    );
    assert.equal(acquisition.filename, `${group.path}.tle`);
    assert.equal(acquisition.status, 200);
    assert.equal(acquisition.accepted, true);
    assert.equal(
      acquisition.url,
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group.path}&FORMAT=tle`,
    );
    assert.match(acquisition.sha256 || '', SHA256);
    assert.match(asset.sha256 || '', SHA256);
    assert.equal(
      asset.sha256,
      acquisition.sha256,
      `pinned TLE asset hash differs for ${asset.id}`,
    );
    assert.ok(Number.isSafeInteger(acquisition.byteLength));
    assert.ok(
      acquisition.byteLength > 0 && acquisition.byteLength <= MAX_TLE_BYTES,
    );
    assert.equal(asset.byteLength, acquisition.byteLength);

    const bytes = readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/tle',
        acquisition.filename,
      ),
    );
    totalTleBytes += bytes.length;
    assert.ok(
      totalTleBytes <= MAX_TOTAL_TLE_BYTES,
      'pinned TLE source set exceeds the aggregate verification bound',
    );
    assert.equal(
      bytes.length,
      acquisition.byteLength,
      `pinned TLE byte length differs for ${asset.id}`,
    );
    assert.equal(
      sha256(bytes),
      acquisition.sha256,
      `pinned TLE bytes differ for ${asset.id}`,
    );
    tleAssetSha256s[asset.id] = asset.sha256;

    const text = bytes.toString('utf8');
    for (const tle of parseTleText(text)) {
      const satrec = twoline2satrec(tle.line1, tle.line2);
      if (!satrec || satrec.error !== 0) continue;
      const id = decodeTleCatalogNumber(satrec.satnum);
      if (id === null || catalog.has(id)) continue;
      catalog.set(id, {
        id,
        name: tle.name,
        group: group.tag,
        line1: tle.line1,
        line2: tle.line2,
      });
    }
  }

  assert.equal(catalog.size, AUSTIN_SATELLITE_SAMPLE_COUNT);
  assert.equal(
    hashIds([...catalog.keys()]),
    fixture.sourcePopulationHashes?.satellites,
    'pinned TLE-derived catalog identities differ from the Austin fixture',
  );
  assert.ok(
    catalog.has(25544),
    'pinned TLE catalog is missing the ISS witness',
  );
  return Object.freeze({
    schema: 'gev-austin-satellite-epoch-reference/v1',
    catalog,
    tleAssetSha256s: Object.freeze(tleAssetSha256s),
    identitySha256: hashIds([...catalog.keys()]),
  });
}

/** Derive a unique cached fleet epoch from public positions and pinned TLEs. */
export function deriveAustinSatelliteSampledEpoch({
  reference,
  records,
  boundaryEpochMs,
  boundary,
  documentRole,
  documentId,
  runOrdinal,
} = {}) {
  assert.equal(reference?.schema, 'gev-austin-satellite-epoch-reference/v1');
  assert.ok(Number.isSafeInteger(boundaryEpochMs) && boundaryEpochMs > 0);
  assert.ok(['warmup-held', 'measurement-complete'].includes(boundary));
  assert.ok(typeof documentRole === 'string' && documentRole.length > 0);
  assert.ok(typeof documentId === 'string' && documentId.length > 0);
  assert.ok(Number.isSafeInteger(runOrdinal) && runOrdinal > 0);
  const canonical = canonicalRecords(records);
  const ids = canonical.map((row) => row.id);
  assert.equal(
    hashIds(ids),
    reference.identitySha256,
    'cached satellite identity digest differs from pinned TLE identities',
  );
  assert.deepEqual(
    ids,
    [...reference.catalog.keys()].sort((a, b) => a - b),
  );

  const witness = canonical.find((row) => row.id === 25544);
  assert.ok(witness, 'public cached ISS position witness is missing');
  const observedWitness = toCartesian(witness);
  const candidates = [];
  for (
    let epochMs = boundaryEpochMs - AUSTIN_SATELLITE_EPOCH_MAX_AGE_MS;
    epochMs <= boundaryEpochMs;
    epochMs += 1
  ) {
    const predicted = propagateCartesian(reference.catalog.get(25544), epochMs);
    if (
      predicted &&
      Cesium.Cartesian3.distance(observedWitness, predicted) <=
        AUSTIN_SATELLITE_EPOCH_TOLERANCE_METERS
    )
      candidates.push(epochMs);
  }
  assert.equal(
    candidates.length,
    1,
    'cached ISS position has no unique epoch within the one-second cadence',
  );
  const derivedEpochMs = candidates[0];
  let maximumResidualMeters = 0;
  for (const row of canonical) {
    const predicted = propagateCartesian(
      reference.catalog.get(row.id),
      derivedEpochMs,
    );
    assert.ok(predicted, `pinned TLE did not propagate NORAD ${row.id}`);
    const residual = Cesium.Cartesian3.distance(toCartesian(row), predicted);
    assert.ok(
      Number.isFinite(residual) &&
        residual <= AUSTIN_SATELLITE_EPOCH_TOLERANCE_METERS,
      `cached NORAD ${row.id} position does not match the unique derived epoch`,
    );
    maximumResidualMeters = Math.max(maximumResidualMeters, residual);
  }

  return {
    schema: AUSTIN_SATELLITE_EPOCH_SCHEMA,
    method:
      'public-cached-iss-position-integer-ms-search-plus-all-record-sgp4-check',
    epochKind: 'derived-from-cached-public-positions',
    numericalBoundStatus: 'provisional-not-cross-engine-validated',
    performanceAcceptanceEligible: false,
    boundary,
    documentRole,
    documentId,
    runOrdinal,
    boundaryEpochMs,
    derivedEpochMs,
    ageMs: boundaryEpochMs - derivedEpochMs,
    toleranceMeters: AUSTIN_SATELLITE_EPOCH_TOLERANCE_METERS,
    recordCount: canonical.length,
    identitySha256: reference.identitySha256,
    positionSha256: positionHash(canonical),
    tleAssetSha256s: { ...reference.tleAssetSha256s },
    maximumResidualMeters,
    records: canonical,
  };
}

/** Independently recompute a serialized boundary record from its raw rows. */
export function validateAustinSatelliteSampledEpoch({
  fixture,
  evidence,
  expectedBoundary,
  expectedBoundaryEpochMs,
  expectedDocumentRole,
  expectedDocumentId,
  expectedRunOrdinal,
  reference = loadAustinSatelliteEpochReference(fixture),
} = {}) {
  assert.equal(evidence?.schema, AUSTIN_SATELLITE_EPOCH_SCHEMA);
  assert.equal(
    evidence.method,
    'public-cached-iss-position-integer-ms-search-plus-all-record-sgp4-check',
  );
  assert.equal(evidence.epochKind, 'derived-from-cached-public-positions');
  assert.equal(
    evidence.numericalBoundStatus,
    'provisional-not-cross-engine-validated',
  );
  assert.equal(evidence.performanceAcceptanceEligible, false);
  assert.equal(evidence.boundary, expectedBoundary);
  assert.equal(evidence.boundaryEpochMs, expectedBoundaryEpochMs);
  assert.equal(evidence.documentRole, expectedDocumentRole);
  assert.equal(evidence.documentId, expectedDocumentId);
  assert.equal(evidence.runOrdinal, expectedRunOrdinal);
  assert.equal(
    evidence.toleranceMeters,
    AUSTIN_SATELLITE_EPOCH_TOLERANCE_METERS,
  );
  assert.deepEqual(evidence.tleAssetSha256s, reference.tleAssetSha256s);
  const recomputed = deriveAustinSatelliteSampledEpoch({
    reference,
    records: evidence.records,
    boundaryEpochMs: expectedBoundaryEpochMs,
    boundary: expectedBoundary,
    documentRole: expectedDocumentRole,
    documentId: expectedDocumentId,
    runOrdinal: expectedRunOrdinal,
  });
  assert.deepEqual(evidence, recomputed);
  return true;
}

/** Recompute every cached-position boundary carried by a captured Austin report. */
export function validateAustinSatelliteEpochCaptureReport({
  fixture,
  warmupMs,
  durationPerSampleMs,
  captures,
} = {}) {
  assert.ok(Number.isSafeInteger(warmupMs) && warmupMs >= 0);
  assert.ok(
    Number.isSafeInteger(durationPerSampleMs) && durationPerSampleMs > 0,
  );
  assert.ok(
    Array.isArray(captures) && captures.length > 0 && captures.length <= 10,
  );
  const reference = loadAustinSatelliteEpochReference(fixture);
  for (const [index, sample] of captures.entries()) {
    const clock = sample?.austinOperatingClock;
    assert.ok(clock && typeof sample.documentRole === 'string');
    assert.ok(
      typeof sample.documentId === 'string' && sample.documentId.length > 0,
    );
    assert.equal(clock.runOrdinal, 1);
    const expectedEpochs = [
      {
        boundary: 'warmup-held',
        epochMs: fixture.fixedTimeMs + warmupMs,
        evidence: clock.satelliteSampledEpochs?.warmupHeld,
      },
      {
        boundary: 'measurement-complete',
        epochMs: fixture.fixedTimeMs + warmupMs + durationPerSampleMs,
        evidence: clock.satelliteSampledEpochs?.measurementComplete,
      },
    ];
    for (const expected of expectedEpochs) {
      validateAustinSatelliteSampledEpoch({
        fixture,
        reference,
        evidence: expected.evidence,
        expectedBoundary: expected.boundary,
        expectedBoundaryEpochMs: expected.epochMs,
        expectedDocumentRole: sample.documentRole,
        expectedDocumentId: sample.documentId,
        expectedRunOrdinal: clock.runOrdinal,
      });
      assert.equal(
        expected.evidence.documentRole,
        sample.documentRole,
        `capture ${index + 1} satellite boundary belongs to another document`,
      );
    }
  }
  return true;
}
