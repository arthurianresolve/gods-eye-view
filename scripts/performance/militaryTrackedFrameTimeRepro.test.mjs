import assert from 'node:assert/strict';
import test from 'node:test';
import { runMilitaryTrackedFrameTimeReproduction } from './militaryTrackedFrameTimeRepro.mjs';

test('military tracked callbacks share pose time and keep invalid frames fresh', () => {
  const report = runMilitaryTrackedFrameTimeReproduction();
  const cases = report.cases;
  assert.equal(report.classification, 'diagnostic-only-synthetic-clock');

  assert.equal(cases.positionFirst.authoritativeTimeSamples, 1);
  assert.equal(cases.trailFirst.authoritativeTimeSamples, 1);
  assert.deepEqual(
    cases.positionFirst.sampledTimesSeconds,
    cases.trailFirst.sampledTimesSeconds,
  );
  assert.equal(cases.positionFirst.trailReturnedSegment, false);
  assert.equal(cases.trailFirst.trailReturnedSegment, false);
  assert.ok(
    Math.hypot(
      ...cases.positionFirst.positionEcefM.map(
        (coordinate, index) =>
          coordinate - cases.trailFirst.positionEcefM[index],
      ),
    ) < 1e-6,
  );
  assert.equal(cases.positionFirst.courseDeg, cases.trailFirst.courseDeg);
  assert.equal(cases.positionFirst.speedMps, cases.trailFirst.speedMps);
  assert.equal(cases.positionFirst.focusPublications, 1);
  assert.equal(cases.trailFirst.focusPublications, 1);

  assert.equal(cases.laterFrameObserver.authoritativeTimeSamples, 1);
  assert.equal(
    cases.laterFrameObserver.trailSuppressedForCachedWarmupPose,
    true,
  );
  assert.equal(cases.laterFrameObserver.focusWritesFromObserver, 0);
  assert.equal(cases.laterFrameObserver.cachedPoseRemainsSame, true);
  assert.equal(cases.modelOwnedEndpoint.authoritativeTimeSamples, 1);
  assert.equal(cases.modelOwnedEndpoint.trailReturnedSegment, true);
  assert.ok(cases.modelOwnedEndpoint.modelOwnedEndpointDeltaM < 1e-6);

  assert.equal(cases.invalidFrame.paired.authoritativeTimeSamples, 1);
  assert.equal(cases.invalidFrame.paired.trailReturnedSegment, true);
  assert.equal(
    cases.invalidFrame.paired.invalidFrameDidNotEnterPoseCache,
    true,
  );
  assert.equal(
    cases.invalidFrame.paired.poseTimeAssociatedWithoutFrameNumber,
    true,
  );
  assert.equal(cases.invalidFrame.observer.authoritativeTimeSamples, 1);
  assert.equal(
    cases.invalidFrame.observer.trailSuppressedForCachedPoseTime,
    true,
  );
  assert.equal(cases.invalidFrame.observer.framePoseWasNotCached, true);
  assert.equal(cases.invalidFrame.standalone.authoritativeTimeSamples, 2);
  assert.deepEqual(cases.invalidFrame.standalone.decisions, [true, false]);
  assert.equal(cases.invalidFrame.standalone.noInvalidFrameTimeCache, true);
  assert.equal(cases.invalidFrame.negative.authoritativeTimeSamples, 2);
  assert.equal(
    cases.invalidFrame.negative.invalidFrameDidNotCachePosition,
    true,
  );

  assert.equal(cases.resetAndUntrackedFreshness.authoritativeTimeSamples, 3);
  assert.equal(
    cases.resetAndUntrackedFreshness.untrackedUsedIndependentTime,
    true,
  );
  assert.equal(cases.resetAndUntrackedFreshness.trackedTimeWasNotMutated, true);
  assert.equal(
    cases.resetAndUntrackedFreshness.resetResampledTrackedTime,
    true,
  );
  assert.equal(cases.resetAndUntrackedFreshness.resetClearedTimeIdentity, true);
  assert.equal(cases.resetAndUntrackedFreshness.targetChangedForNextPose, true);

  assert.equal(cases.interpolationAndExtrapolation.authoritativeTimeSamples, 2);
  assert.equal(
    cases.interpolationAndExtrapolation.interpolationMatchesFixBracket,
    true,
  );
  assert.equal(cases.interpolationAndExtrapolation.nextFrameAdvanced, true);
  assert.equal(
    cases.interpolationAndExtrapolation.extrapolatedBeyondNewestFix,
    true,
  );
  assert.equal(cases.interpolationAndExtrapolation.focusPublications, 2);
});
