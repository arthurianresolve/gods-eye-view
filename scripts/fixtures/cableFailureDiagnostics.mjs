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
