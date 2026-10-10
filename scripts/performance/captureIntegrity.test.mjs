import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCaptureIntegrity } from './captureIntegrity.mjs';

const commit = 'a'.repeat(40);
const options = {
  expectedCommit: commit,
  qualityMode: 'manual',
  expectedCounts: { flights: 2500 },
};
function sample(scenario = 'scripted-motion', run = 1) {
  const point = {
    settings: {
      qualityMode: 'manual',
      densityPct: 75,
      msaaSamples: 4,
      bloom: false,
      resolutionScale: 1,
      antialias: false,
      fxaa: true,
      visualState: {
        style: 'normal',
        styleParams: {},
        detection: { density: 75 },
      },
    },
    environment: {
      appCommit: commit,
      renderer: 'Intel UHD 620',
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
      layers: [{ id: 'flights', enabled: true, count: 2500 }],
    },
    focused: true,
    visible: true,
  };
  return {
    scenario,
    run,
    conditions: {
      before: structuredClone(point),
      after: structuredClone(point),
    },
    foregroundThroughout: true,
    cameraPath: {
      id: scenario,
      start: {
        position: { x: 1, y: 2, z: 3 },
        direction: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      elapsedDurationMs: 60_000,
      motionDistanceM: scenario === 'idle' ? 0 : 19200,
    },
  };
}

test('matched samples pass and independent scenarios keep their own camera paths', () => {
  assert.equal(
    assertCaptureIntegrity(
      [sample(), sample('scripted-motion', 2), sample('idle')],
      options,
    ).status,
    'passed',
  );
});

test('wrong builds, missing populations, changed settings and background samples are rejected', () => {
  const changes = [
    (s) => {
      s.conditions.after.environment.appCommit = 'b'.repeat(40);
    },
    (s) => {
      s.conditions.before.environment.layers[0].count = 0;
    },
    (s) => {
      s.conditions.before.environment.layers[0].enabled = false;
    },
    (s) => {
      s.conditions.after.settings.densityPct = 50;
    },
    (s) => {
      s.conditions.after.settings.msaaSamples = 1;
    },
    (s) => {
      s.conditions.after.settings.bloom = true;
    },
    (s) => {
      s.conditions.after.environment.drawingBuffer.width = 720;
    },
    (s) => {
      s.conditions.after.environment.renderer = null;
    },
    (s) => {
      s.conditions.before.visible = false;
    },
    (s) => {
      s.foregroundThroughout = false;
    },
    (s) => {
      delete s.conditions;
    },
    (s) => {
      s.conditions.after.settings.visualState = null;
    },
    (s) => {
      s.conditions.after.settings.antialias = null;
    },
  ];
  for (const change of changes) {
    const value = sample();
    change(value);
    assert.throws(() => assertCaptureIntegrity([value], options));
  }
});

test('repeat runs tolerate only bounded camera pose roundoff', () => {
  const first = sample('scripted-motion', 1);
  const second = sample('scripted-motion', 2);
  second.cameraPath.start.position.x += 5e-7;
  second.cameraPath.start.direction.x += 5e-13;
  second.cameraPath.start.transform[0] += 5e-13;
  second.cameraPath.start.transform[12] += 5e-7;
  assert.equal(
    assertCaptureIntegrity([first, second], options).status,
    'passed',
  );
  assert.equal(second.cameraPath.start.position.x, 1 + 5e-7);
});

test('repeat runs reject meaningful pose, duration, and route changes', () => {
  const mutations = [
    (route) => {
      route.start.position.x += 4;
    },
    (route) => {
      route.start.direction.x += 5e-7;
    },
    (route) => {
      route.start.transform[12] += 4;
    },
    (route) => {
      route.start.transform[0] += 5e-7;
    },
    (route) => {
      route.elapsedDurationMs += 1;
    },
    (route) => {
      route.motionDistanceM += 0.01;
    },
    (route) => {
      route.start.position.x = Number.NaN;
    },
  ];
  let routeFailure;
  for (const mutate of mutations) {
    const first = sample('scripted-motion', 1);
    const second = sample('scripted-motion', 2);
    mutate(second.cameraPath);
    assert.throws(
      () => assertCaptureIntegrity([first, second], options),
      (error) => {
        routeFailure ||= error;
        assert.match(error.message, /repeated workload route changed/);
        return true;
      },
    );
  }
  assert.equal(routeFailure.operator, 'routePoseEquivalent');
  assert.equal(routeFailure.actual.start.position.x, 5);
  assert.equal(routeFailure.expected.start.position.x, 1);
});

test('repeat runs with different settings or route endpoints cannot pass', () => {
  const second = sample('scripted-motion', 2);
  second.cameraPath.motionDistanceM -= 8;
  assert.throws(
    () => assertCaptureIntegrity([sample(), second], options),
    /repeated workload route changed/,
  );
  second.cameraPath = sample().cameraPath;
  second.conditions.before.settings.densityPct = 50;
  second.conditions.after.settings.densityPct = 50;
  assert.throws(
    () =>
      assertCaptureIntegrity([second], { ...options, expectedDensityPct: 75 }),
    /wrong density/,
  );
  assert.throws(
    () => assertCaptureIntegrity([sample(), second], options),
    /repeated workload changed/,
  );
});

test('opt-in Auto captures permit density adaptation but still reject other visual changes', () => {
  const value = sample();
  value.conditions.before.settings.qualityMode = 'auto';
  value.conditions.after.settings.qualityMode = 'auto';
  value.conditions.after.settings.densityPct = 25;
  value.conditions.after.settings.visualState.detection.density = 25;
  const auto = { ...options, qualityMode: 'auto' };
  assert.equal(assertCaptureIntegrity([value], auto).status, 'passed');
  value.conditions.after.settings.msaaSamples = 1;
  assert.throws(
    () => assertCaptureIntegrity([value], auto),
    /conditions changed/,
  );
});
