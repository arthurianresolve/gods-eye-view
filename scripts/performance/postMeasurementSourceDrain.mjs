export const AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS = 250;

/**
 * Let viewport-change debounce work start after the timed sample has ended.
 * The completed-render boundary that follows remains responsible for proving
 * that the resulting source load and render have finished.
 */
export async function waitForPostMeasurementSourceDrain({
  minimumMs = AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS,
  now = () => performance.now(),
  wait = (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
} = {}) {
  if (!Number.isFinite(minimumMs) || minimumMs < 1 || minimumMs > 2000)
    throw new TypeError(
      'Post-measurement source drain must be between 1 and 2000 ms.',
    );
  const startedAt = now();
  let elapsedMs = 0;
  let waitAttempts = 0;
  while (elapsedMs < minimumMs && waitAttempts < 4) {
    await wait(Math.max(1, Math.ceil(minimumMs - elapsedMs)));
    waitAttempts += 1;
    elapsedMs = now() - startedAt;
    if (!Number.isFinite(elapsedMs)) break;
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < minimumMs)
    throw new Error(
      `Post-measurement source drain ended before its bound after ${waitAttempts} waits (${elapsedMs} ms).`,
    );
  return {
    schema: 'gev-post-measurement-source-drain/v1',
    minimumMs,
    elapsedMs,
    waitAttempts,
    scope:
      'host wait after the timed sample and before completed-render/source-readiness validation',
  };
}
