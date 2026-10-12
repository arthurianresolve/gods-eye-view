import { readScenePrimitiveReadiness } from './scenePrimitiveReadiness.mjs';

const MAX_SAMPLES = 64;
const MAX_RENDER_ERRORS = 8;
const MAX_PENDING_OWNERS = 16;
const SUPPORTED_VIEWER_LOOP_VERSIONS = new Set(['1.138', '1.138.0']);

function sanitizeError(error) {
  const clean = (value, fallback) =>
    typeof value === 'string'
      ? value
          .replace(/https?:\/\/[^\s)]+/gi, '[url]')
          .replace(/(?:[A-Z]:\\|\\\\)[^\s)]+/gi, '[path]')
          .replace(/\/(?:Users|home|private|tmp|var|mnt)\/[^\s)]+/gi, '[path]')
          .slice(0, 160)
      : fallback;
  return {
    name: clean(error?.name, 'Error'),
    message: clean(error?.message, 'Scene render error'),
  };
}

function readTyped(read, accept) {
  try {
    const value = read();
    return accept(value)
      ? { available: true, value }
      : { available: false, reason: 'unsupported-value-shape' };
  } catch (error) {
    return { available: false, error: sanitizeError(error) };
  }
}

function readPrimitiveSnapshot(viewer, Cesium) {
  try {
    const readiness = readScenePrimitiveReadiness(viewer.scene, Cesium);
    const pending = readiness.pending
      .slice(0, MAX_PENDING_OWNERS)
      .map((row) => {
        const owner = readiness.owners.find(
          (candidate) => candidate.path === row.path,
        );
        return {
          path: String(row.path).slice(0, 180),
          type: typeof row.type === 'string' ? row.type.slice(0, 80) : null,
          ready: owner?.ready ?? null,
          show: owner?.show ?? null,
          buildState: owner?.buildState || null,
        };
      });
    return {
      available: true,
      ready: readiness.ready,
      observedOwners: readiness.observedOwners,
      truncated: readiness.truncated,
      pendingCount: readiness.pending.length,
      pending,
      pendingTruncated: readiness.pending.length > pending.length,
      unsupportedOwnerCount: readiness.unsupportedOwners.length,
      unsupportedOwners: readiness.unsupportedOwners.slice(
        0,
        MAX_PENDING_OWNERS,
      ),
    };
  } catch (error) {
    return { available: false, error: sanitizeError(error) };
  }
}

/** Read-only, bounded snapshots around one re-enable lifecycle stage. */
export function startCableReenableObservation({
  viewer,
  Cesium,
  documentTarget = globalThis.document,
  now = () => performance.now(),
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  intervalMs = 250,
}) {
  if (!viewer?.scene || typeof now !== 'function')
    throw new TypeError('A viewer scene and monotonic clock are required.');
  if (!Number.isFinite(intervalMs) || intervalMs < 100 || intervalMs > 1000)
    throw new RangeError('Re-enable observation interval is out of bounds.');

  const startedAtMs = now();
  if (!Number.isFinite(startedAtMs))
    throw new TypeError('Monotonic clock returned an invalid start time.');
  const readMonotonicNow = () => {
    try {
      const value = now();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const samples = [];
  const renderErrors = [];
  const cleanupErrors = [];
  const setupErrors = [];
  let totalSamples = 0;
  let totalRenderErrors = 0;
  let lastReceiptAtMs = null;
  let lastPostRenderAtMs = null;
  let lastPostRenderMonotonicMs = null;
  let disposed = false;
  let contextLostCount = 0;
  let contextRestoredCount = 0;
  let contextIsLost = null;
  const canvas = viewer.scene.canvas;
  const cesiumVersion =
    typeof Cesium?.VERSION === 'string' ? Cesium.VERSION : null;
  let postRenderAttached = false;
  let renderErrorAttached = false;
  let contextLostAttached = false;
  let contextRestoredAttached = false;
  const onPostRender = () => {
    const receivedAtMs = readMonotonicNow();
    if (Number.isFinite(receivedAtMs)) {
      lastPostRenderMonotonicMs = receivedAtMs;
      lastPostRenderAtMs = receivedAtMs - startedAtMs;
    }
  };
  const onRenderError = (_scene, error) => {
    totalRenderErrors += 1;
    if (renderErrors.length < MAX_RENDER_ERRORS) {
      const receivedAtMonotonicMs = readMonotonicNow();
      renderErrors.push({
        receivedAtMonotonicMs,
        receivedAtMs:
          receivedAtMonotonicMs === null
            ? null
            : Math.max(0, receivedAtMonotonicMs - startedAtMs),
        error: sanitizeError(error),
      });
    }
  };

  const attach = (label, action, markAttached) => {
    try {
      action();
      markAttached(true);
    } catch (error) {
      setupErrors.push({ label, error: sanitizeError(error) });
    }
  };
  const addCesiumListener = (event, listener) => {
    if (typeof event?.addEventListener !== 'function')
      throw new Error('Cesium event listener API is unavailable.');
    event.addEventListener(listener);
  };
  const addCanvasListener = (name, listener) => {
    if (typeof canvas?.addEventListener !== 'function')
      throw new Error('Canvas event listener API is unavailable.');
    canvas.addEventListener(name, listener);
  };
  attach(
    'postRender',
    () => addCesiumListener(viewer.scene.postRender, onPostRender),
    (value) => (postRenderAttached = value),
  );
  attach(
    'renderError',
    () => addCesiumListener(viewer.scene.renderError, onRenderError),
    (value) => (renderErrorAttached = value),
  );

  const sample = (snapshotKind = 'timer') => {
    if (disposed) return;
    const clockNow = readMonotonicNow();
    if (!Number.isFinite(clockNow)) return;
    totalSamples += 1;
    const receivedAtMs = Math.max(0, clockNow - startedAtMs);
    const focusObservation =
      typeof documentTarget?.hasFocus === 'function'
        ? readTyped(
            () => documentTarget.hasFocus(),
            (value) => typeof value === 'boolean',
          )
        : { available: false, reason: 'not-supported' };
    const viewerLoopObservation = SUPPORTED_VIEWER_LOOP_VERSIONS.has(
      cesiumVersion,
    )
      ? readTyped(
          () => viewer.useDefaultRenderLoop,
          (value) => typeof value === 'boolean',
        )
      : { available: false, reason: 'unsupported-cesium-version' };
    const sampleRow = {
      sequence: totalSamples,
      snapshotKind,
      receivedAtMonotonicMs: clockNow,
      receivedAtMs,
      receiptGapMs:
        lastReceiptAtMs === null ? null : receivedAtMs - lastReceiptAtMs,
      lastPostRenderAtMs,
      lastPostRenderMonotonicMs,
      postRenderAgeMs:
        lastPostRenderAtMs === null ? null : receivedAtMs - lastPostRenderAtMs,
      page: {
        visibilityState: readTyped(
          () => documentTarget.visibilityState,
          (value) => typeof value === 'string',
        ),
        hasFocus: focusObservation,
      },
      renderLoop: {
        useDefaultRenderLoop: viewerLoopObservation,
        requestRenderMode: readTyped(
          () => viewer.scene.requestRenderMode,
          (value) => typeof value === 'boolean',
        ),
        frameNumber: readTyped(
          () => viewer.scene.frameState?.frameNumber,
          Number.isSafeInteger,
        ),
      },
      context: {
        isLost: contextIsLost,
        lossState: contextIsLost === null ? 'not-observed' : 'observed',
        lostEvents: contextLostCount,
        restoredEvents: contextRestoredCount,
      },
      primitiveReadiness: readPrimitiveSnapshot(viewer, Cesium),
    };
    lastReceiptAtMs = receivedAtMs;
    if (samples.length < MAX_SAMPLES) samples.push(sampleRow);
    else {
      samples.splice(2, 1);
      samples.push(sampleRow);
    }
  };

  const onContextLost = () => {
    contextIsLost = true;
    contextLostCount += 1;
  };
  const onContextRestored = () => {
    contextIsLost = false;
    contextRestoredCount += 1;
  };
  attach(
    'webglcontextlost',
    () => addCanvasListener('webglcontextlost', onContextLost),
    (value) => (contextLostAttached = value),
  );
  attach(
    'webglcontextrestored',
    () => addCanvasListener('webglcontextrestored', onContextRestored),
    (value) => (contextRestoredAttached = value),
  );
  const contextCounts = () => ({
    lostEvents: contextLostCount,
    restoredEvents: contextRestoredCount,
  });
  let timer;
  try {
    timer = setIntervalFn(sample, intervalMs);
  } catch (error) {
    for (const [attached, target, eventName, listener, domEvent] of [
      [
        postRenderAttached,
        viewer.scene.postRender,
        'postRender',
        onPostRender,
        false,
      ],
      [
        renderErrorAttached,
        viewer.scene.renderError,
        'renderError',
        onRenderError,
        false,
      ],
      [contextLostAttached, canvas, 'webglcontextlost', onContextLost, true],
      [
        contextRestoredAttached,
        canvas,
        'webglcontextrestored',
        onContextRestored,
        true,
      ],
    ]) {
      if (!attached) continue;
      try {
        if (domEvent) target?.removeEventListener?.(eventName, listener);
        else target?.removeEventListener?.(listener);
      } catch {
        // Keep the timer setup error as the diagnostic's primary failure.
      }
    }
    throw error;
  }
  sample('start');

  let finishResult = null;
  const finish = (status = 'completed') => {
    if (disposed) return finishResult;
    try {
      sample('finish');
    } catch (error) {
      setupErrors.push({
        label: 'final-snapshot',
        error: sanitizeError(error),
      });
    }
    disposed = true;
    for (const [label, dispose] of [
      ['interval', () => clearIntervalFn(timer)],
      ...(postRenderAttached
        ? [
            [
              'postRender',
              () =>
                viewer.scene.postRender?.removeEventListener?.(onPostRender),
            ],
          ]
        : []),
      ...(renderErrorAttached
        ? [
            [
              'renderError',
              () =>
                viewer.scene.renderError?.removeEventListener?.(onRenderError),
            ],
          ]
        : []),
      ...(contextLostAttached
        ? [
            [
              'contextLost',
              () =>
                canvas?.removeEventListener?.(
                  'webglcontextlost',
                  onContextLost,
                ),
            ],
          ]
        : []),
      ...(contextRestoredAttached
        ? [
            [
              'contextRestored',
              () =>
                canvas?.removeEventListener?.(
                  'webglcontextrestored',
                  onContextRestored,
                ),
            ],
          ]
        : []),
    ]) {
      try {
        dispose();
      } catch (error) {
        cleanupErrors.push({ label, error: sanitizeError(error) });
      }
    }
    finishResult = snapshot(status);
    return finishResult;
  };
  function snapshot(status) {
    const endedAtMs = readMonotonicNow();
    return {
      schema: 'gev-cable-reenable-observation/v1',
      status:
        cleanupErrors.length > 0
          ? 'cleanup-incomplete'
          : setupErrors.length > 0
            ? 'setup-incomplete'
            : status,
      lifecycleStatus: status,
      setupComplete: setupErrors.length === 0,
      cleanupComplete: cleanupErrors.length === 0,
      cesiumVersion,
      viewerLoopPropertyStatus: SUPPORTED_VIEWER_LOOP_VERSIONS.has(
        cesiumVersion,
      )
        ? 'supported'
        : 'unsupported-version',
      intervalMs,
      startedAtMonotonicMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
      endedAtMonotonicMs: Number.isFinite(endedAtMs) ? endedAtMs : null,
      durationMs:
        Number.isFinite(endedAtMs) && Number.isFinite(startedAtMs)
          ? Math.max(0, endedAtMs - startedAtMs)
          : null,
      sampleCount: totalSamples,
      samples: samples.map((row) => ({ ...row })),
      samplesTruncated: totalSamples > samples.length,
      lastPostRenderAtMs,
      lastPostRenderMonotonicMs,
      renderErrorCount: totalRenderErrors,
      renderErrors: renderErrors.map((row) => ({ ...row })),
      renderErrorsTruncated: totalRenderErrors > renderErrors.length,
      setupErrors: setupErrors.map((row) => ({ ...row })),
      contextEvents: contextCounts(),
      cleanupErrors: cleanupErrors.map((row) => ({ ...row })),
    };
  }

  return { sample, finish };
}

/** Preserve the lifecycle error if optional diagnostic finalization fails. */
export function finishCableReenableObservationSafely(
  observer,
  status,
  primaryError = null,
) {
  try {
    return observer?.finish(status) || null;
  } catch (error) {
    return {
      schema: 'gev-cable-reenable-observation/v1',
      status: 'finalization-failed',
      lifecycleStatus: status,
      primaryLifecycleFailurePreserved: primaryError !== null,
      finishError: sanitizeError(error),
    };
  }
}
