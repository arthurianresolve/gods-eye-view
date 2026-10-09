import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometry } from './geometry.js';
import { createModel } from './model.js';
import { poseHash, SUPPORT_KEYS } from '../../data/cctvFootprint.js';

function fixture() {
  const state = {};
  const services = { focus: {}, ground: {}, mesh: {} };
  let writes = 0,
    placements = 0;
  const parts = {
    ground: { currentSurfaceRegime: () => 'globe' },
    projection: {
      updatePlanePlacement() {
        placements++;
      },
    },
  };
  parts.model = createModel({ state, services, parts, source: {} });
  const geometry = createGeometry({ state, services, parts, source: {} });
  const record = {
    camera: {
      id: 'camera-one',
      lat: 40.7,
      lon: -73.9,
      headingDeg: 90,
      pitchDeg: -17,
      fovDeg: 74,
      rangeM: 700,
      mountHeightM: 24,
    },
    coverageEntities: Array.from({ length: 5 }, () => {
      let value;
      return {
        polyline: {
          get positions() {
            return value;
          },
          set positions(next) {
            writes++;
            value = next;
          },
        },
      };
    }),
  };
  return {
    record,
    geometry,
    writes: () => writes,
    placements: () => placements,
  };
}

test('unchanged camera activation and source metadata preserve materialized wire geometry', () => {
  const env = fixture();
  env.geometry.applyFrustumGeometry(env.record, 12);
  const geometry = env.record.frustumGeometry;
  const positions = env.record.frustumPositions;
  const wires = env.record.coverageEntities.map(
    (entity) => entity.polyline.positions,
  );
  for (let i = 0; i < 30; i++) {
    env.record.camera = {
      ...env.record.camera,
      name: `Updated source name ${i}`,
      lastSuccessAt: i,
    };
    env.geometry.applyFrustumGeometry(env.record, 12);
  }
  assert.equal(env.writes(), 5, 'No duplicate Cesium positions assignments');
  assert.equal(env.placements(), 1);
  assert.equal(env.record.frustumGeometry, geometry);
  assert.equal(env.record.frustumPositions, positions);
  env.record.coverageEntities.forEach((entity, index) =>
    assert.equal(entity.polyline.positions, wires[index]),
  );
});

for (const [field, value] of Object.entries({
  lat: 40.71,
  lon: -73.91,
  headingDeg: 110,
  pitchDeg: -10,
  fovDeg: 90,
  rangeM: 600,
  mountHeightM: 30,
})) {
  test(`camera ${field} revisions rebuild once and retain subsequent identical results`, () => {
    const env = fixture();
    env.geometry.applyFrustumGeometry(env.record, 12);
    const previous = env.record.frustumPositions;
    env.record.camera[field] = value;
    env.geometry.applyFrustumGeometry(env.record, 12);
    assert.notEqual(env.record.frustumPositions, previous);
    assert.equal(env.writes(), 10);
    env.geometry.applyFrustumGeometry(env.record, 12);
    assert.equal(env.writes(), 10);
    assert.equal(env.placements(), 2);
  });
}

test('terrain, probe-clamp and footprint revisions invalidate only their changed geometry', () => {
  const env = fixture();
  env.geometry.applyFrustumGeometry(env.record, 12);
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 10);
  env.record.probeClampRangeM = 400;
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 15);
  const pose = env.geometry.footprintPose(env.record);
  env.record.footprintGround = {
    poseHash: poseHash(pose),
    supports: Object.fromEntries(SUPPORT_KEYS.map((key) => [key, 50])),
  };
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 20);
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 20);
  assert.equal(env.record.frustumGeometry.footprintMeasured, true);
});
