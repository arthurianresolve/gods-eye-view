export const WIND_FRAME_PROBE_ATTEMPTS = 3;
export const WIND_FRAME_PROBE_SPACING_MS = 20;
export const WIND_FRAME_PROBE_TIMEOUT_MS = 400;

const errorMessage = (error) =>
  String(error?.message || error || 'Unknown capture failure').slice(0, 300);

/**
 * Run one selected capture path without retrying a missing frame. Frame copy,
 * pixel extraction and hashing are timed as separate observable phases.
 */
export async function runWindFrameProbe({
  captureMode,
  waitForFrame,
  readPixels = null,
  hashPixels = null,
  releaseFrame = null,
  snapshot = () => null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = WIND_FRAME_PROBE_ATTEMPTS,
  spacingMs = WIND_FRAME_PROBE_SPACING_MS,
  timeoutMs = WIND_FRAME_PROBE_TIMEOUT_MS,
}) {
  if (!['no-copy', 'copy'].includes(captureMode))
    throw new TypeError('Capture mode must be no-copy or copy.');
  if (typeof waitForFrame !== 'function')
    throw new TypeError('A bounded frame waiter is required.');
  if (
    !Number.isSafeInteger(attempts) ||
    attempts !== WIND_FRAME_PROBE_ATTEMPTS ||
    spacingMs !== WIND_FRAME_PROBE_SPACING_MS ||
    timeoutMs !== WIND_FRAME_PROBE_TIMEOUT_MS
  )
    throw new RangeError('Wind frame probe bounds are fixed by the fixture.');
  if (
    captureMode === 'copy' &&
    (typeof readPixels !== 'function' ||
      typeof hashPixels !== 'function' ||
      typeof releaseFrame !== 'function')
  )
    throw new TypeError(
      'Copy mode requires pixel extraction, hashing and frame cleanup.',
    );

  const report = {
    captureMode,
    requestedAttempts: attempts,
    spacingMs,
    timeoutMs,
    attempts: [],
    status: 'failed',
  };

  let previousAttemptEndedAt = null;
  for (let index = 0; index < attempts; index++) {
    let actualSpacingMs = null;
    let frame = null;
    if (index > 0) {
      const spacingStartedAt = now();
      await wait(spacingMs);
      actualSpacingMs = Math.max(0, now() - previousAttemptEndedAt);
      if (!Number.isFinite(actualSpacingMs))
        actualSpacingMs = Math.max(0, now() - spacingStartedAt);
    }
    const item = {
      index,
      declaredSpacingBeforeMs: index === 0 ? null : spacingMs,
      actualSpacingBeforeMs: actualSpacingMs,
      before: snapshot(),
      frameWaitMs: null,
      frameWaitAndCopyMs: null,
      frameCompleted: false,
      copyRequested: captureMode === 'copy',
      copied: false,
      getImageDataMs: null,
      hashMs: null,
      pixelHash: null,
      after: null,
      status: 'failed',
    };
    report.attempts.push(item);

    let currentPhase = 'frame-wait';
    try {
      const startedAt = now();
      frame = await waitForFrame({ captureMode, timeoutMs });
      const frameOperationMs = Math.max(0, now() - startedAt);
      if (captureMode === 'copy') item.frameWaitAndCopyMs = frameOperationMs;
      else item.frameWaitMs = frameOperationMs;
      item.frameCompleted =
        captureMode === 'copy' ? Boolean(frame) : frame === true;
      if (!item.frameCompleted) {
        item.failurePhase = 'frame-wait';
        item.error = 'Fresh-frame operation returned no result.';
        item.after = snapshot();
        break;
      }

      if (captureMode === 'copy') {
        item.copied = true;
        currentPhase = 'getImageData';
        let pixels;
        const readStartedAt = now();
        pixels = await readPixels(frame);
        item.getImageDataMs = Math.max(0, now() - readStartedAt);
        currentPhase = 'hash';
        const hashStartedAt = now();
        item.pixelHash = await hashPixels(pixels);
        item.hashMs = Math.max(0, now() - hashStartedAt);
        if (
          typeof item.pixelHash !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(item.pixelHash)
        )
          throw new Error('Pixel hash was unavailable.');
      }
      currentPhase = 'snapshot-after';
      item.after = snapshot();
      item.status = 'passed';
    } catch (error) {
      item.failurePhase ||= currentPhase;
      item.error = errorMessage(error);
      try {
        item.after = snapshot();
      } catch {
        item.after = null;
      }
      break;
    } finally {
      if (captureMode === 'copy' && frame) {
        try {
          releaseFrame?.(frame);
        } catch (error) {
          item.releaseError = errorMessage(error);
          item.failurePhase ||= 'releaseFrame';
          item.error ||= item.releaseError;
          item.status = 'failed';
        }
      }
      previousAttemptEndedAt = now();
    }
    if (item.status !== 'passed') break;
  }

  report.completedAttempts = report.attempts.filter(
    (attempt) => attempt.status === 'passed',
  ).length;
  report.status =
    report.attempts.length === attempts &&
    report.completedAttempts === attempts &&
    report.attempts.every((attempt) => attempt.status === 'passed')
      ? 'complete'
      : 'failed';
  return report;
}
