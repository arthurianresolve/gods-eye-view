/**
 * Browser-serializable terminal observations for disposable capture documents.
 * Read the requested state first, then retire the public viewer render loop in
 * the same page task so teardown never races later unrelated frames.
 */
export function observeTerminalViewerState(kind, layerIds = []) {
  const app = globalThis.window?.__godsEyeView;
  const viewer = app?.viewer;
  if (!viewer) throw new Error('Terminal viewer observation is unavailable.');

  let observation;
  if (kind === 'layer-population') {
    if (!Array.isArray(layerIds) || layerIds.length > 16)
      throw new TypeError('Terminal layer population request is invalid.');
    const layers = app.dataManager?.getAll?.() || [];
    observation = Object.fromEntries(
      layerIds.map((id) => {
        const layer = layers.find((entry) => entry.id === id);
        return [
          id,
          {
            enabled: layer?.enabled ?? null,
            count: layer?.stats?.count ?? null,
          },
        ];
      }),
    );
  } else if (kind === 'startup-details') {
    observation = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      drawingBuffer: {
        width: viewer.scene.canvas.width,
        height: viewer.scene.canvas.height,
      },
      focused: document.hasFocus(),
      visible: !document.hidden,
      navigationMs:
        performance.getEntriesByType('navigation')[0]?.duration ?? null,
      memory: performance.memory
        ? { usedJsHeapBytes: performance.memory.usedJSHeapSize, reason: null }
        : {
            usedJsHeapBytes: null,
            reason: 'performance.memory is unavailable in this browser',
          },
    };
  } else {
    throw new TypeError('Terminal viewer observation kind is unsupported.');
  }

  const startedAt = globalThis.performance?.now?.();
  const renderLoopRetirement = {
    requested: true,
    status: 'not-attempted',
    before: null,
    after: null,
    confirmed: false,
    elapsedMs: null,
  };
  try {
    if (typeof viewer.useDefaultRenderLoop !== 'boolean') {
      renderLoopRetirement.status = 'viewer-render-loop-unavailable';
    } else {
      renderLoopRetirement.before = viewer.useDefaultRenderLoop;
      if (renderLoopRetirement.before) viewer.useDefaultRenderLoop = false;
      renderLoopRetirement.after = viewer.useDefaultRenderLoop;
      renderLoopRetirement.confirmed =
        renderLoopRetirement.before === true &&
        renderLoopRetirement.after === false;
      renderLoopRetirement.status = renderLoopRetirement.confirmed
        ? 'retired-with-final-observation'
        : renderLoopRetirement.before === false
          ? 'already-disabled-before-final-observation'
          : 'viewer-render-loop-not-disabled';
    }
  } catch {
    renderLoopRetirement.status = 'viewer-render-loop-set-failed';
  }
  const finishedAt = globalThis.performance?.now?.();
  renderLoopRetirement.elapsedMs =
    Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : null;
  return { observation, renderLoopRetirement };
}
