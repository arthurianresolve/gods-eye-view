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
  { signal, timeoutMs = 400, copy = false } = {},
) {
  const scene = viewer?.scene;
  if (
    !scene?.postRender?.addEventListener ||
    destroyed(viewer) ||
    hidden() ||
    signal?.aborted
  )
    return null;
  const result = await new Promise((resolve) => {
    let settled = false,
      timer = null,
      remove = null,
      canvas = null;
    const doc = globalThis.document;
    const owners = pending.get(viewer) || new Set();
    pending.set(viewer, owners);
    const finish = (value = null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      remove?.();
      signal?.removeEventListener('abort', cancel);
      doc?.removeEventListener?.('visibilitychange', visibility);
      owners.delete(cancel);
      if (!owners.size) pending.delete(viewer);
      if (!value && canvas) canvas.width = canvas.height = 0;
      resolve(value);
    };
    const cancel = () => finish();
    const visibility = () => {
      if (hidden()) cancel();
    };
    const onRender = () => {
      if (settled) return;
      try {
        if (hidden() || destroyed(viewer) || signal?.aborted) return finish();
        if (!copy) return finish(true);
        const source = scene.canvas;
        if (!source?.width || !source?.height) return finish();
        canvas = doc.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        if (!context) return finish();
        // Copy synchronously inside postRender, before WebGL buffer disposal.
        context.drawImage(source, 0, 0);
        finish(canvas);
      } catch {
        finish();
      }
    };
    owners.add(cancel);
    try {
      signal?.addEventListener('abort', cancel, { once: true });
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
      timer = setTimeout(cancel, delay);
      if (signal?.aborted || hidden() || destroyed(viewer)) cancel();
      else scene.requestRender?.();
    } catch {
      finish();
    }
  });
  if (hidden() || destroyed(viewer) || signal?.aborted) {
    if (copy && result) result.width = result.height = 0;
    return null;
  }
  return result;
}

/** Fresh copied pixels, owned by the caller; null for any incomplete capture. */
export function captureFreshCesiumFrame(viewer, options = {}) {
  return completedFrame(viewer, { ...options, copy: true });
}

/** A completed visible frame without allocating or reading pixels. */
export async function renderFreshCesiumFrame(viewer, options = {}) {
  return Boolean(await completedFrame(viewer, options));
}
