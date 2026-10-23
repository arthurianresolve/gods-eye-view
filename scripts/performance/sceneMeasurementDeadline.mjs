const DEFAULT_HOST_GRACE_MS = 10_000;

function boundedError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(
      error?.message || error || 'Scene measurement failed',
    ).slice(0, 240),
  };
}

function publish(onProgress, observation) {
  if (typeof onProgress === 'function')
    onProgress(structuredClone(observation));
}

/**
 * Own the wall-clock deadline for one long-running page measurement.
 *
 * Puppeteer's protocol timeout is a connection safeguard, not a workload
 * deadline. Keep the page evaluation pending until its target is retired when
 * this deadline wins; the capture's existing failure cleanup owns that target.
 */
export async function runSceneMeasurementWithHostDeadline({
  evaluate,
  measurementMs,
  hostGraceMs = DEFAULT_HOST_GRACE_MS,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onProgress,
}) {
  if (
    typeof evaluate !== 'function' ||
    !Number.isFinite(measurementMs) ||
    measurementMs <= 0 ||
    !Number.isFinite(hostGraceMs) ||
    hostGraceMs < 0
  )
    throw new TypeError('Scene measurement deadline arguments are invalid.');

  const startedAt = now();
  const hostTimeoutMs = measurementMs + hostGraceMs;
  const observation = {
    schema: 'gev-scene-measurement-host-observation/v1',
    status: 'host-dispatch',
    measurementMs,
    hostGraceMs,
    hostTimeoutMs,
    hostElapsedMs: 0,
    pageEvaluationPendingAtDeadline: false,
    latePageSettlementObserved: false,
    pageError: null,
    cleanup: {
      hostTimerCleared: false,
      pageEvaluationRetirement: 'not-required',
    },
  };
  publish(onProgress, observation);

  let settled = false;
  let hostTimedOut = false;
  let timer;
  const pageOutcome = Promise.resolve()
    .then(evaluate)
    .then(
      (value) => ({ kind: 'completed', value }),
      (error) => ({ kind: 'failed', error }),
    )
    .then((outcome) => {
      settled = true;
      if (hostTimedOut) {
        observation.latePageSettlementObserved = true;
        observation.cleanup.pageEvaluationRetirement = 'settled-after-deadline';
        publish(onProgress, observation);
      }
      return outcome;
    });
  const deadline = new Promise((resolve) => {
    timer = setTimer(() => {
      hostTimedOut = true;
      observation.status = 'host-deadline';
      observation.hostElapsedMs = Math.max(0, now() - startedAt);
      observation.pageEvaluationPendingAtDeadline = !settled;
      observation.cleanup.pageEvaluationRetirement = settled
        ? 'not-required'
        : 'pending-target-retirement';
      publish(onProgress, observation);
      resolve({ kind: 'timeout' });
    }, hostTimeoutMs);
  });

  const outcome = await Promise.race([pageOutcome, deadline]);
  clearTimer(timer);
  observation.cleanup.hostTimerCleared = true;
  observation.hostElapsedMs = Math.max(0, now() - startedAt);

  if (outcome.kind === 'completed') {
    observation.status = 'completed';
    observation.cleanup.pageEvaluationRetirement = 'not-required';
    publish(onProgress, observation);
    return outcome.value;
  }
  if (outcome.kind === 'failed') {
    observation.status = 'page-error';
    observation.pageError = boundedError(outcome.error);
    publish(onProgress, observation);
    Object.assign(outcome.error, {
      sceneMeasurementObservation: structuredClone(observation),
    });
    throw outcome.error;
  }

  publish(onProgress, observation);
  const error = Object.assign(
    new Error(
      `Scene measurement host deadline elapsed after ${hostTimeoutMs} ms.`,
    ),
    {
      name: 'TimeoutError',
      sceneMeasurementObservation: structuredClone(observation),
    },
  );
  throw error;
}
