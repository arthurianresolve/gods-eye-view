import assert from 'node:assert/strict';

// Kept separate from the fixture producer so CLI argument validation and
// contract checks do not eagerly load Cesium's full module barrel.
export const INFRASTRUCTURE_WORKLOAD_IDS = Object.freeze([
  'infrastructure-datacenters',
  'infrastructure-dams',
  'infrastructure-cables',
  'infrastructure',
]);

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
