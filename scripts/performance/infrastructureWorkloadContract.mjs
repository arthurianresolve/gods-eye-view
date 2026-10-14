import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Kept separate from the fixture producer so CLI argument validation and
// contract checks do not eagerly load Cesium's full module barrel.
export const INFRASTRUCTURE_WORKLOAD_IDS = Object.freeze([
  'infrastructure-datacenters',
  'infrastructure-dams',
  'infrastructure-cables',
  'infrastructure',
]);

const FIXED_TIME = '2026-10-08T12:00:00.000Z';
const FIXTURE_IDENTITIES = Object.freeze({
  'infrastructure-datacenters': Object.freeze({
    id: 'bundled-datacenters-static-v1',
    sha256: '44ee5e37da85bba7fb2b720a1c0e77303f28ad1ae138084a319ac7332f664454',
    clock: Object.freeze({ dayNumber: 2461322, secondsOfDay: 37 }),
  }),
  'infrastructure-dams': Object.freeze({
    id: 'bundled-dams-static-v1',
    sha256: 'bccfa5195affabf2a146e0c03fe2f42c9990710eeb8198edc958b7fd05d042a4',
    clock: Object.freeze({ dayNumber: 2461322, secondsOfDay: 37 }),
  }),
  'infrastructure-cables': Object.freeze({
    id: 'bundled-submarine-cables-static-v1',
    sha256: '2d6bb7fe71135eff86592237046b0047aeb4ea0ded39647635f4a472b166abef',
    clock: Object.freeze({ dayNumber: 2461322, secondsOfDay: 37 }),
  }),
  infrastructure: Object.freeze({
    id: 'bundled-infrastructure-static-v1',
    sha256: '16ff35f20ac6405efcd860c8f5057bef12516aedc29a65b8351ad48651d4cba6',
    clock: Object.freeze({ dayNumber: 2461322, secondsOfDay: 37 }),
  }),
});

export function assertInfrastructureFixtureIdentity(
  fixture,
  label = 'fixture',
) {
  const identity = FIXTURE_IDENTITIES[fixture?.workloadId];
  assert.ok(identity, `${label} uses an unregistered infrastructure workload`);
  assert.equal(fixture.schema, 'gev-infrastructure-fixture-manifest/v1');
  assert.equal(fixture.id, identity.id);
  assert.equal(fixture.sha256, identity.sha256);
  assert.equal(fixture.fixedTime, FIXED_TIME);
  assert.equal(fixture.fixedTimeMs, Date.parse(FIXED_TIME));
  assert.deepEqual(fixture.clock, identity.clock);
  assert.deepEqual(fixture.camera, {
    id: 'world-infrastructure-overview-v1',
    longitudeDeg: 0,
    latitudeDeg: 0,
    altitudeM: 15_000_000,
    headingDeg: 0,
    pitchDeg: -90,
  });
  const manifest = {
    schema: fixture.schema,
    id: fixture.id,
    workloadId: fixture.workloadId,
    fixedTime: fixture.fixedTime,
    assets: fixture.assets?.map(
      ({ id, path, sha256, byteLength, sourceFeatureCount }) => ({
        id,
        path,
        sha256,
        byteLength,
        sourceFeatureCount,
      }),
    ),
    expectedLayerCounts: fixture.expectedLayerCounts,
    camera: fixture.camera,
  };
  const actualManifestHash = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
  assert.equal(
    actualManifestHash,
    identity.sha256,
    `${label} manifest differs`,
  );
  return true;
}

export function assertInfrastructureClockObservation(clock, fixture, label) {
  assert.deepEqual(
    clock,
    {
      currentTime: fixture.clock,
      shouldAnimate: false,
      multiplier: 0,
    },
    `${label} Cesium clock differs from the fixed fixture time`,
  );
  return true;
}
