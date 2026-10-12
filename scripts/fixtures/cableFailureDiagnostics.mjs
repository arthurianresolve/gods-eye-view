function safeRead(read) {
  try {
    return { available: true, value: read() };
  } catch (error) {
    return {
      available: false,
      error: String(error?.message || error).slice(0, 500),
    };
  }
}

function safeLayerMethod(layer, methodName) {
  try {
    const method = layer?.[methodName];
    if (typeof method !== 'function')
      return { available: false, reason: 'not-present' };
    return { available: true, value: method.call(layer) };
  } catch (error) {
    return {
      available: false,
      error: String(error?.message || error).slice(0, 500),
    };
  }
}

export const MAX_CABLE_READINESS_OBSERVATIONS = 8;

/** Keep a small first-and-latest window for a readiness failure. */
export function createCableReadinessTrace(stage) {
  if (typeof stage !== 'string' || !stage.trim())
    throw new TypeError('A readiness stage label is required.');
  const observations = [];
  let totalObservations = 0;
  return {
    stage,
    record(observation) {
      totalObservations += 1;
      if (observations.length < MAX_CABLE_READINESS_OBSERVATIONS) {
        observations.push(observation);
      } else {
        // Retain the first two frames and the six most recent frames.
        observations.splice(2, 1);
        observations.push(observation);
      }
    },
    snapshot() {
      return {
        stage,
        observationCount: totalObservations,
        truncated: totalObservations > observations.length,
        observations: observations.map((row) => ({ ...row })),
      };
    },
    get size() {
      return totalObservations;
    },
  };
}

/** Adapt the older successful-case observation-array argument without changing its schema. */
export function normalizeCableReadinessOptions(options) {
  if (Array.isArray(options))
    return {
      stage: 'scene-stability',
      trace: createCableReadinessTrace('scene-stability'),
      legacyObservations: options,
    };
  const stage = options?.stage || 'scene-stability';
  return {
    stage,
    trace: options?.trace || createCableReadinessTrace(stage),
    legacyObservations: Array.isArray(options?.legacyObservations)
      ? options.legacyObservations
      : null,
  };
}

export function appendLegacyCableReadinessObservation(target, observation) {
  if (!Array.isArray(target)) return;
  if (target.length >= 32) target.splice(1, 1);
  target.push(observation);
}

/** Capture optional diagnostics without masking the caller's primary failure. */
export function cableFailureDiagnostics(viewer, layer) {
  return {
    scene: {
      dataSourceDisplayReady: safeRead(
        () => viewer.dataSourceDisplay.ready === true,
      ),
      globeTilesLoaded: safeRead(() => viewer.scene.globe.tilesLoaded === true),
      frameNumber: safeRead(() => viewer.scene.frameState?.frameNumber ?? null),
    },
    layer: {
      performance: safeLayerMethod(layer, 'getPerformanceDiagnostics'),
      stats: safeLayerMethod(layer, 'getStats'),
    },
  };
}

/** Attach optional diagnostic data after the primary failure is published. */
export function appendCableFailureDiagnostics(failure, viewer, layer) {
  Object.assign(failure, cableFailureDiagnostics(viewer, layer));
  return failure;
}

/** Preserve readiness evidence without replacing the original exception. */
export function attachCableReadinessFailure(
  error,
  trace,
  viewer,
  layer,
  extra = {},
) {
  if (trace?.size === 0) {
    const diagnostics = cableFailureDiagnostics(viewer, layer);
    trace.record({
      phase: 'failure',
      reason: String(error?.message || error).slice(0, 300),
      frameNumber: diagnostics.scene.frameNumber,
      dataSourceDisplayReady: diagnostics.scene.dataSourceDisplayReady,
      globeTilesLoaded: diagnostics.scene.globeTilesLoaded,
      primitiveReadiness: { available: false, error: 'not-observed' },
    });
  }
  const failure = {
    ...(trace ? { stage: extra.stage || trace.stage } : {}),
    ...extra,
    ...(trace ? { readiness: trace.snapshot() } : {}),
    ...cableFailureDiagnostics(viewer, layer),
  };
  try {
    if (error && (typeof error === 'object' || typeof error === 'function'))
      Object.assign(error, { cableReadinessFailure: failure });
  } catch {
    // Diagnostic attachment must never mask the primary failure.
  }
  return failure;
}
