import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalibration } from './calibration.js';
import { DEFAULT_CAMERA_CALIBRATION } from './policy.js';

function createCalibrationFixture() {
  const requests = [];
  const geometryWrites = [];
  let groundResolutions = 0;
  const context = {
    state: {},
    services: {
      render: {
        governorRequestRender(reason) {
          requests.push(reason);
        },
      },
    },
    parts: {},
    source: {},
  };
  context.parts.model = {
    safeNumber(value, fallback = Number.NaN) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    },
    clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    },
    quantize(value, step = 0.1) {
      return Math.round(value / step) * step;
    },
    ensureCameraPose(camera) {
      camera.poseUpdated = true;
    },
  };
  context.parts.ground = {
    groundAltFor: () => 100,
    resolveFootprintGround() {
      groundResolutions++;
      return Promise.resolve();
    },
    resolveCommittedGroundAnchor() {},
  };
  context.parts.geometry = {
    applyFrustumGeometry(record, altitude) {
      geometryWrites.push({ record, altitude });
    },
  };
  context.parts.presentation = {
    notifyListenersThrottled() {},
    notifyListeners() {},
  };
  context.parts.frames = { refreshProjectionImage() {} };
  context.parts.rendering = { refreshCoverageStyles() {} };
  context.parts.calibration = createCalibration(context);
  const record = {
    camera: {
      id: 'render-demand-camera',
      lat: 30,
      lon: -97,
      headingDeg: 0,
      pitchDeg: -17,
      fovDeg: 70,
      rangeM: 700,
      mountHeightM: 22,
      calibration: { ...DEFAULT_CAMERA_CALIBRATION },
    },
  };
  return {
    calibration: context.parts.calibration,
    record,
    requests,
    geometryWrites,
    get groundResolutions() {
      return groundResolutions;
    },
  };
}

test('accepted transient and committed calibration patches request their visible frame', async () => {
  const fixture = createCalibrationFixture();
  assert.equal(
    fixture.calibration.applyCalibrationPatch(
      fixture.record,
      { headingDeg: 3 },
      { transient: true },
    ),
    true,
  );
  assert.equal(fixture.record.camera.poseUpdated, true);
  assert.deepEqual(fixture.requests, ['cctv-calibration-drag']);
  assert.equal(fixture.geometryWrites.length, 1);
  assert.equal(fixture.groundResolutions, 0);

  assert.equal(
    fixture.calibration.applyCalibrationPatch(fixture.record, {
      offsetEastM: 2,
    }),
    true,
  );
  assert.deepEqual(fixture.requests, [
    'cctv-calibration-drag',
    'cctv-calibration-patch',
  ]);
  assert.equal(fixture.groundResolutions, 1);
  assert.equal(
    fixture.geometryWrites.length,
    1,
    'anchor movement is resolved by the committed-ground owner',
  );
});

test('manual range ownership cancels a deferred activation obstruction probe', () => {
  const fixture = createCalibrationFixture();
  Object.assign(fixture.record, {
    probeClampRangeM: null,
    probeClampSource: null,
    probeClampPendingSource: { id: 'old-owner' },
    probeClampPendingMapSwitch: true,
  });

  assert.equal(
    fixture.calibration.applyCalibrationPatch(fixture.record, {
      rangeScale: 1.2,
    }),
    true,
  );
  assert.equal(fixture.record.probeClampRangeM, null);
  assert.equal(fixture.record.probeClampSource, null);
  assert.equal(fixture.record.probeClampPendingSource, null);
  assert.equal(fixture.record.probeClampPendingMapSwitch, false);
});
