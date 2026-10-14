// The viewer owns bounded frame waits. Neither completed waits nor cancellation
// retains a scene, listener, timer, temporary canvas or abort handler.
const pending = new WeakMap();
const hidden = () => globalThis.document?.hidden === true;
const destroyed = (viewer) =>
  viewer?.isDestroyed?.() === true || viewer?.scene?.isDestroyed?.() === true;

export function cancelPendingFrameCaptures(viewer) {
  for (const cancel of [...(pending.get(viewer) || [])]) cancel();
}

async function completedFrame(
  viewer,
  { signal, timeoutMs = 400, copy = false, onDiagnostic } = {},
) {
  const scene = viewer?.scene;
  let reason = null;
  let postRenderObserved = false;
  const diagnosticStartedAt =
    typeof onDiagnostic === 'function' ? performance.now() : null;
  const unavailableReason = () =>
    !scene?.postRender?.addEventListener
      ? 'unavailable-scene'
      : destroyed(viewer)
        ? 'viewer-destroyed'
        : hidden()
          ? 'hidden-document'
          : signal?.aborted
            ? 'aborted'
            : null;
  const publish = (value) => {
    if (typeof onDiagnostic === 'function') {
      try {
        onDiagnostic({
          schema: 'gev-fresh-frame-outcome/v1',
          status: value ? 'completed' : 'unavailable',
          reason: value ? null : reason,
          elapsedMs: performance.now() - diagnosticStartedAt,
          postRenderObserved,
          copyRequested: copy,
        });
      } catch {
        // Diagnostics must never change capture success or resource ownership.
      }
    }
    onDiagnostic = null;
    return value;
  };
  reason = unavailableReason();
  if (reason) return publish(null);
  const result = await new Promise((resolve) => {
    let settled = false,
      timer = null,
      remove = null,
      canvas = null;
    const doc = globalThis.document;
    const owners = pending.get(viewer) || new Set();
    pending.set(viewer, owners);
    const finish = (value = null, failureReason = 'capture-failed') => {
      if (settled) return;
      settled = true;
      if (!value) reason = failureReason;
      if (timer !== null) clearTimeout(timer);
      remove?.();
      signal?.removeEventListener('abort', abort);
      doc?.removeEventListener?.('visibilitychange', visibility);
      owners.delete(cancel);
      if (!owners.size) pending.delete(viewer);
      if (!value && canvas) canvas.width = canvas.height = 0;
      resolve(value);
    };
    const cancel = () => finish(null, 'owner-cancelled');
    const abort = () => finish(null, 'aborted');
    const visibility = () => {
      if (hidden()) finish(null, 'hidden-document');
    };
    const onRender = () => {
      if (settled) return;
      postRenderObserved = true;
      try {
        const unavailable = unavailableReason();
        if (unavailable) return finish(null, unavailable);
        if (!copy) return finish(true);
        const source = scene.canvas;
        if (!source?.width || !source?.height)
          return finish(null, 'missing-source-canvas');
        canvas = doc.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        if (!context) return finish(null, 'missing-copy-context');
        // Copy synchronously inside postRender, before WebGL buffer disposal.
        context.drawImage(source, 0, 0);
        finish(canvas);
      } catch {
        finish(null, 'copy-failed');
      }
    };
    owners.add(cancel);
    try {
      signal?.addEventListener('abort', abort, { once: true });
      doc?.addEventListener?.('visibilitychange', visibility);
      const unsubscribe = scene.postRender.addEventListener(onRender);
      remove =
        typeof unsubscribe === 'function'
          ? unsubscribe
          : () => scene.postRender.removeEventListener?.(onRender);
      if (settled) {
        remove();
        return;
      }
      const delay = Number.isFinite(timeoutMs)
        ? Math.min(400, Math.max(0, timeoutMs))
        : 400;
      timer = setTimeout(() => finish(null, 'timeout'), delay);
      const unavailable = unavailableReason();
      if (unavailable) finish(null, unavailable);
      else scene.requestRender?.();
    } catch {
      finish(null, 'render-setup-failed');
    }
  });
  const unavailable = unavailableReason();
  if (unavailable) {
    reason = unavailable;
    if (copy && result) result.width = result.height = 0;
    return publish(null);
  }
  return publish(result);
}

/** Fresh copied pixels, owned by the caller; null for any incomplete capture. */
export function captureFreshCesiumFrame(viewer, options = {}) {
  return completedFrame(viewer, { ...options, copy: true });
}

/** A completed visible frame without allocating or reading pixels. */
export async function renderFreshCesiumFrame(viewer, options = {}) {
  return Boolean(await completedFrame(viewer, options));
}
