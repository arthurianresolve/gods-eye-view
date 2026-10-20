/**
 * Give a published user transition a rendering opportunity before layer work.
 * A single RAF runs before paint; the nested RAF leaves the transition intact
 * across the preceding rendering update. This does not measure physical paint.
 * The calling visibility intent owns both callbacks through its AbortSignal.
 */
export function waitForVisibilityPaint({
  signal,
  documentRef = null,
} = {}) {
  const view = documentRef?.defaultView;
  if (
    signal?.aborted ||
    !documentRef ||
    documentRef.hidden ||
    typeof documentRef.addEventListener !== 'function' ||
    typeof documentRef.removeEventListener !== 'function' ||
    typeof view?.requestAnimationFrame !== 'function' ||
    typeof view?.cancelAnimationFrame !== 'function'
  )
    return Promise.resolve();

  return new Promise((resolve) => {
    let frame = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const onVisibilityChange = () => {
      // Background documents may suspend RAF indefinitely. There is no visible
      // acknowledgment to preserve there; continue the ordinary lifecycle.
      if (documentRef.hidden) finish();
    };
    documentRef.addEventListener('visibilitychange', onVisibilityChange);
    signal?.addEventListener('abort', finish, { once: true });
    frame = view.requestAnimationFrame(() => {
      frame = null;
      if (signal?.aborted || documentRef.hidden) finish();
      else frame = view.requestAnimationFrame(finish);
    });
  });
}
