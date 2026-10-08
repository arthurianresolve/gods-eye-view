/** Evaluate a frame-time ceiling against moving-scene samples only. */
export function evaluateMotionFrameBudget(captures, maxP95Ms) {
  const configured = Number.isFinite(maxP95Ms) && maxP95Ms > 0;
  if (!configured)
    return Object.freeze({
      maxP95FrameMs: null,
      status: 'not-configured',
      failures: Object.freeze([]),
    });

  const motionSamples = captures.filter(
    (sample) => sample.scenario === 'scripted-motion',
  );
  const failures = motionSamples.flatMap((sample) => {
    const p95FrameMs = sample.frameIntervalMs?.p95;
    if (!Number.isFinite(p95FrameMs))
      return [{ run: sample.run, p95FrameMs: null, reason: 'metric-unavailable' }];
    if (p95FrameMs > maxP95Ms)
      return [{ run: sample.run, p95FrameMs, reason: 'budget-exceeded' }];
    return [];
  });
  const unavailable = failures.some(
    (failure) => failure.reason === 'metric-unavailable',
  );
  const exceeded = failures.some(
    (failure) => failure.reason === 'budget-exceeded',
  );

  return Object.freeze({
    maxP95FrameMs: maxP95Ms,
    status:
      !motionSamples.length || unavailable
        ? 'incomplete'
        : exceeded
          ? 'failed'
          : 'passed',
    failures: Object.freeze(failures),
  });
}
