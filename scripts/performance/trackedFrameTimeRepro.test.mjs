import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrackedFrameTimeReproduction } from './trackedFrameTimeRepro.mjs';

test('tracked flight callbacks share the rendered pose time without caching invalid frames', () => {
  const report = runTrackedFrameTimeReproduction();
  const cases = report.cases;

  assert.equal(report.classification, 'diagnostic-only-synthetic-clock');
  assert.equal(cases.positionFirst.authoritativeTimeSamples, 1);
  assert.equal(cases.positionFirst.trailCallbackReturnedSegment, false);
  assert.equal(
    cases.positionFirst.expectedPoseTimeFromFirstSampleSeconds,
    cases.trailFirst.expectedPoseTimeFromFirstSampleSeconds,
  );
  assert.equal(cases.trailFirst.authoritativeTimeSamples, 1);
  assert.equal(cases.trailFirst.trailCallbackSuppressed, true);
  assert.equal(
    cases.positionFirst.trackedCourseDeg,
    cases.trailFirst.trackedCourseDeg,
  );
  assert.equal(
    cases.positionFirst.trackedSpeedMps,
    cases.trailFirst.trackedSpeedMps,
  );
  assert.ok(
    Math.hypot(
      ...cases.positionFirst.trackedPoseEcefM.map(
        (coordinate, index) =>
          coordinate - cases.trailFirst.trackedPoseEcefM[index],
      ),
    ) < 1e-6,
  );

  assert.equal(cases.invalidFrameTrailFirstPairing.authoritativeTimeSamples, 1);
  assert.equal(
    cases.invalidFrameTrailFirstPairing.sameCallRenderTimePassedToPose,
    true,
  );
  assert.equal(cases.invalidFrameTrailFirstPairing.frameTimeWasNotCached, true);
  assert.equal(cases.invalidFrameWarmupFreshness.authoritativeTimeSamples, 2);
  assert.deepEqual(cases.invalidFrameWarmupFreshness.decisions, [true, false]);
  assert.equal(
    cases.invalidFrameWarmupFreshness.secondCheckUsesFreshSample,
    true,
  );
  assert.equal(cases.invalidFrameCachedPose.authoritativeTimeSamples, 1);
  assert.equal(cases.invalidFrameCachedPose.cachedPoseTimeReusedByTrail, true);
  assert.equal(cases.invalidFrameCachedPose.frameTimeWasNotCached, true);
  assert.equal(cases.invalidFrameCachedPose.trailPoseMatchesRenderedPose, true);

  assert.equal(cases.laterPostRenderCache.observerReusesRenderedPose, true);
  assert.equal(
    cases.laterPostRenderCache.laterTrailCallbackUsesRenderedPose,
    true,
  );
  assert.equal(
    cases.laterPostRenderCache.cacheOnlyObserversAddedTimeSamples,
    0,
  );
  assert.equal(
    cases.laterPostRenderCache.cacheOnlyObserversAddedFocusWrites,
    0,
  );

  assert.equal(
    cases.interpolationAndExtrapolation.interpolationPathObserved,
    true,
  );
  assert.equal(
    cases.interpolationAndExtrapolation.coastingExtrapolationPathObserved,
    true,
  );
  assert.equal(cases.targetReset.targetChanged, true);
  assert.equal(cases.targetReset.authoritativeTimeSamples, 2);
  assert.equal(
    cases.untrackedScratchOwnership.untrackedCallOverwroteSharedRenderScratch,
    true,
  );
  assert.equal(cases.untrackedScratchOwnership.trackedTimeRemainedOwned, true);
  assert.equal(cases.missingFrameNumber.authoritativeTimeSamples, 2);
  assert.ok(cases.missingFrameNumber.freshRawPoseDistanceM > 0);
  assert.equal(cases.negativeFrameNumber.authoritativeTimeSamples, 2);
  assert.ok(cases.negativeFrameNumber.freshRawPoseDistanceM > 0);
  assert.equal(cases.insufficientTrailBody.authoritativeTimeSamples, 0);
  assert.equal(
    cases.insufficientTrailBody.callbackSuppressedWithoutSampling,
    true,
  );
  assert.equal(cases.untrackedQuery.authoritativeTimeSamples, 2);
  assert.ok(cases.untrackedQuery.freshPositionDistanceM > 0);
});
