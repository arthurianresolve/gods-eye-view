import assert from 'node:assert/strict';

export const SETTLED_IDLE_SCHEMA = 'gev-settled-idle-observation/v1';
export const SETTLED_IDLE_POLICY = Object.freeze({
  id: 'settled-static-completed-frames-v1',
  windowMs: 10_000,
  maximumFrames: 2,
  minimumDurationMs: 60_000,
  minimumSettledBeforeMs: 2_000,
});

/**
 * Assess the S51 idle requirement independently of frame-interval statistics.
 * A zero-frame scene has no interval percentile, but can pass a frame-count
 * requirement. Missing historical settlement evidence remains unavailable.
 * The enclosing paired-report validator owns source, fixture and eligibility.
 */
export function assessSettledIdleSample(sample) {
  const observation = sample?.settledIdleObservation;
  const renderedFrames = Number.isSafeInteger(sample?.renderedFrameCount)
    ? sample.renderedFrameCount
    : null;
  if (!observation)
    return {
      status: 'unavailable',
      reason: 'settlement-and-completed-frame-observation-missing',
      renderedFrames,
      maximumFramesInWindow: null,
    };
  assert.equal(observation.schema, SETTLED_IDLE_SCHEMA);
  assert.equal(sample.scenario, 'idle');
  assert.equal(
    observation.diagnosticOnly,
    false,
    'Diagnostic idle evidence cannot qualify',
  );
  assert.equal(
    observation.cleanupConfirmed,
    true,
    'Idle observer cleanup missing',
  );
  assert.ok(Number.isSafeInteger(renderedFrames) && renderedFrames >= 0);
  assert.ok(
    Number.isFinite(observation.durationMs) &&
      observation.durationMs >= SETTLED_IDLE_POLICY.minimumDurationMs &&
      observation.durationMs <= sample.durationMs,
    'Idle observation window is incomplete',
  );
  assert.equal(
    observation.framesOmitted,
    0,
    'Completed idle frame trace truncated',
  );
  const times = observation.completedFrameOffsetsMs;
  assert.ok(Array.isArray(times) && times.length <= 2048);
  assert.equal(
    times.length,
    renderedFrames,
    'Completed frame count differs from trace',
  );
  for (const [index, time] of times.entries())
    assert.ok(
      Number.isFinite(time) &&
        time >= 0 &&
        time < observation.durationMs &&
        (index === 0 || time >= times[index - 1]),
      'Idle completed-frame time is invalid',
    );
  const settlement = observation.settlement;
  assert.ok(settlement && typeof settlement === 'object');
  assert.equal(
    settlement.tileProgressObserved,
    true,
    'Tile settlement observer missing',
  );
  assert.ok(
    Number.isFinite(settlement.settledBeforeMs) &&
      settlement.settledBeforeMs >= 0,
  );
  for (const field of [
    'initialTilesLoaded',
    'finalTilesLoaded',
    'tilesLoadedThroughout',
    'requestRenderModeThroughout',
    'cameraUnchanged',
  ])
    assert.equal(
      typeof settlement[field],
      'boolean',
      `Idle ${field} is unavailable`,
    );
  assert.ok(
    Number.isSafeInteger(settlement.nonzeroTileProgressEvents) &&
      settlement.nonzeroTileProgressEvents >= 0,
  );

  // Count half-open rolling windows [t, t + 10s), including bursts that straddle
  // fixed bucket boundaries. Never divide a burst by the full minute duration.
  let maximumFramesInWindow = 0;
  let left = 0;
  for (let right = 0; right < times.length; right++) {
    while (times[right] - times[left] >= SETTLED_IDLE_POLICY.windowMs) left++;
    maximumFramesInWindow = Math.max(maximumFramesInWindow, right - left + 1);
  }
  const settled =
    settlement.settledBeforeMs >= SETTLED_IDLE_POLICY.minimumSettledBeforeMs &&
    settlement.initialTilesLoaded &&
    settlement.finalTilesLoaded &&
    settlement.tilesLoadedThroughout &&
    settlement.requestRenderModeThroughout &&
    settlement.cameraUnchanged &&
    settlement.nonzeroTileProgressEvents === 0;
  return {
    status: !settled
      ? 'unavailable'
      : maximumFramesInWindow <= SETTLED_IDLE_POLICY.maximumFrames
        ? 'passed'
        : 'failed',
    reason: !settled
      ? 'scene-did-not-remain-settled-static'
      : maximumFramesInWindow > SETTLED_IDLE_POLICY.maximumFrames
        ? 'completed-frame-budget-exceeded'
        : null,
    renderedFrames,
    maximumFramesInWindow,
    durationMs: observation.durationMs,
  };
}

/** All five samples on each side must be settled and meet the original limit. */
export function assessSettledIdlePair(baseline, candidate) {
  assert.equal(baseline.length, 5);
  assert.equal(candidate.length, 5);
  for (const samples of [baseline, candidate])
    assert.deepEqual(
      samples.map((sample) => sample.run).sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
      'Five distinct idle observations are required',
    );
  const samples = Object.fromEntries(
    Object.entries({ baseline, candidate }).map(([side, captures]) => [
      side,
      captures.map((sample) => ({
        run: sample.run,
        ...assessSettledIdleSample(sample),
      })),
    ]),
  );
  const all = [...samples.baseline, ...samples.candidate];
  return {
    policy: SETTLED_IDLE_POLICY,
    status: all.some((sample) => sample.status === 'failed')
      ? 'failed'
      : all.every((sample) => sample.status === 'passed')
        ? 'passed'
        : 'unavailable',
    frameIntervalComparisonRequired: false,
    samples,
  };
}
