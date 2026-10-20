import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTLED_IDLE_SCHEMA,
  assessSettledIdleSample,
  assessSettledIdlePair,
} from './settledIdleQualification.mjs';

function sample(times = []) {
  return {
    scenario: 'idle',
    run: 1,
    durationMs: 60_010,
    renderedFrameCount: times.length,
    // The interval collector excludes the first completed frame.
    frameCount: Math.max(0, times.length - 1),
    settledIdleObservation: {
      schema: SETTLED_IDLE_SCHEMA,
      diagnosticOnly: false,
      durationMs: 60_000,
      completedFrameOffsetsMs: times,
      framesOmitted: 0,
      cleanupConfirmed: true,
      settlement: {
        tileProgressObserved: true,
        settledBeforeMs: 2_000,
        initialTilesLoaded: true,
        finalTilesLoaded: true,
        tilesLoadedThroughout: true,
        requestRenderModeThroughout: true,
        cameraUnchanged: true,
        nonzeroTileProgressEvents: 0,
      },
    },
  };
}

test('zero-frame settled idle passes independently of undefined interval percentiles', () => {
  assert.equal(assessSettledIdleSample(sample()).status, 'passed');
  const old = sample();
  delete old.settledIdleObservation;
  assert.equal(assessSettledIdleSample(old).status, 'unavailable');
});

test('counts completed frames, catches cross-bucket bursts, and never averages away a burst', () => {
  assert.equal(
    assessSettledIdleSample(sample([9_999, 10_001])).status,
    'passed',
  );
  const burst = assessSettledIdleSample(sample([9_999, 10_001, 10_002]));
  assert.equal(burst.status, 'failed');
  assert.equal(burst.maximumFramesInWindow, 3);
  assert.equal(
    assessSettledIdleSample(sample([0, 1, 10_000, 10_001])).status,
    'passed',
  );
  assert.equal(
    assessSettledIdleSample(sample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).status,
    'failed',
  );
});

test('unsettled loading, render holds, camera movement and short settlement never qualify', () => {
  for (const field of [
    'initialTilesLoaded',
    'finalTilesLoaded',
    'tilesLoadedThroughout',
    'requestRenderModeThroughout',
    'cameraUnchanged',
  ]) {
    const value = sample();
    value.settledIdleObservation.settlement[field] = false;
    assert.equal(assessSettledIdleSample(value).status, 'unavailable', field);
  }
  for (const [field, value] of [
    ['settledBeforeMs', 1999],
    ['nonzeroTileProgressEvents', 1],
  ]) {
    const capture = sample();
    capture.settledIdleObservation.settlement[field] = value;
    assert.equal(assessSettledIdleSample(capture).status, 'unavailable', field);
  }
});

test('rejects diagnostic relabeling, truncation, missing settlement and inconsistent times/counts', () => {
  const mutations = [
    (s) => {
      s.settledIdleObservation.diagnosticOnly = true;
    },
    (s) => {
      s.settledIdleObservation.cleanupConfirmed = false;
    },
    (s) => {
      s.settledIdleObservation.framesOmitted = 1;
    },
    (s) => {
      s.settledIdleObservation.settlement.tileProgressObserved = false;
    },
    (s) => {
      delete s.settledIdleObservation.settlement.cameraUnchanged;
    },
    (s) => {
      s.settledIdleObservation.durationMs = 59_999;
    },
    (s) => {
      s.settledIdleObservation.durationMs = 60_011;
    },
    (s) => {
      s.renderedFrameCount = 0;
    },
    (s) => {
      s.settledIdleObservation.completedFrameOffsetsMs = [-1];
    },
    (s) => {
      s.settledIdleObservation.completedFrameOffsetsMs = [60_000];
    },
    (s) => {
      s.settledIdleObservation.completedFrameOffsetsMs = [NaN];
    },
  ];
  for (const mutate of mutations) {
    const value = sample([1]);
    mutate(value);
    assert.throws(() => assessSettledIdleSample(value));
  }
  assert.throws(() => assessSettledIdleSample(sample([2, 1])));
});

test('every one of five samples per build is required; a single passing pair cannot qualify', () => {
  const runs = () =>
    Array.from({ length: 5 }, (_, index) => ({ ...sample(), run: index + 1 }));
  assert.equal(assessSettledIdlePair(runs(), runs()).status, 'passed');
  const missing = runs();
  delete missing[0].settledIdleObservation;
  assert.equal(assessSettledIdlePair(runs(), missing).status, 'unavailable');
  const failed = runs();
  failed[0] = sample([1, 2, 3]);
  assert.equal(assessSettledIdlePair(runs(), failed).status, 'failed');
  assert.throws(() => assessSettledIdlePair([sample()], [sample()]));
  assert.throws(
    () =>
      assessSettledIdlePair(
        Array.from({ length: 5 }, () => sample()),
        runs(),
      ),
    /distinct idle observations/,
  );
});
