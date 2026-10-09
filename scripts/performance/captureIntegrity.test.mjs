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

test('repeat runs with different settings or route endpoints cannot pass', () => {
  const second = sample('scripted-motion', 2);
  second.cameraPath.motionDistanceM -= 8;
  assert.throws(
    () => assertCaptureIntegrity([sample(), second], options),
    /repeated workload changed/,
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
