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

test('candidate alone must meet the budget while both sides remain complete and settled', () => {
  const runs = () =>
    Array.from({ length: 5 }, (_, index) => ({ ...sample(), run: index + 1 }));
  const baselineBurst = runs();
  baselineBurst[0] = { ...sample([1, 2, 3]), run: 1 };
  const candidatePass = assessSettledIdlePair(baselineBurst, runs());
  assert.equal(candidatePass.status, 'passed');
  assert.equal(candidatePass.baselineStatus, 'failed');
  assert.equal(candidatePass.candidateStatus, 'passed');
  assert.equal(candidatePass.samples.baseline[0].maximumFramesInWindow, 3);
  assert.equal(candidatePass.samples.candidate.length, 5);

  const candidateBurst = runs();
  candidateBurst[0] = { ...sample([1, 2, 3]), run: 1 };
  const candidateFailure = assessSettledIdlePair(runs(), candidateBurst);
  assert.equal(candidateFailure.status, 'failed');
  assert.equal(candidateFailure.baselineStatus, 'passed');
  assert.equal(candidateFailure.candidateStatus, 'failed');

  const missingCandidate = runs();
  delete missingCandidate[0].settledIdleObservation;
  const candidateUnavailable = assessSettledIdlePair(runs(), missingCandidate);
  assert.equal(candidateUnavailable.status, 'unavailable');
  assert.equal(candidateUnavailable.candidateStatus, 'unavailable');

  const missingBaseline = runs();
  delete missingBaseline[0].settledIdleObservation;
  const baselineUnavailable = assessSettledIdlePair(missingBaseline, runs());
  assert.equal(baselineUnavailable.status, 'unavailable');
  assert.equal(baselineUnavailable.baselineStatus, 'unavailable');
  assert.equal(baselineUnavailable.baselineComplete, false);

  const failedAndMissingCandidate = runs();
  failedAndMissingCandidate[0] = { ...sample([1, 2, 3]), run: 1 };
  delete failedAndMissingCandidate[1].settledIdleObservation;
  const knownCandidateFailure = assessSettledIdlePair(
    runs(),
    failedAndMissingCandidate,
  );
  assert.equal(knownCandidateFailure.status, 'failed');
  assert.equal(knownCandidateFailure.candidateStatus, 'failed');
  assert.equal(knownCandidateFailure.candidateComplete, false);

  const failedCandidateMissingBaseline = runs();
  failedCandidateMissingBaseline[0] = { ...sample([1, 2, 3]), run: 1 };
  const unavailableBaseline = runs();
  delete unavailableBaseline[0].settledIdleObservation;
  const preservedFailure = assessSettledIdlePair(
    unavailableBaseline,
    failedCandidateMissingBaseline,
  );
  assert.equal(preservedFailure.status, 'failed');
  assert.equal(preservedFailure.baselineStatus, 'unavailable');
  assert.equal(preservedFailure.baselineComplete, false);

  const failedAndMissingBaseline = runs();
  failedAndMissingBaseline[0] = { ...sample([1, 2, 3]), run: 1 };
  delete failedAndMissingBaseline[1].settledIdleObservation;
  const mixedBaseline = assessSettledIdlePair(failedAndMissingBaseline, runs());
  assert.equal(mixedBaseline.status, 'unavailable');
  assert.equal(mixedBaseline.baselineStatus, 'failed');
  assert.equal(mixedBaseline.baselineComplete, false);
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
