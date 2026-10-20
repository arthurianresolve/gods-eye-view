/**
 * Give a published user transition a rendering opportunity before layer work.
 * The RAF runs before paint; the following task runs after that rendering
 * update, so layer work does not resume in the RAF callback's microtask.
 * This does not measure or guarantee physical presentation. The calling
 * visibility intent owns both callbacks through its AbortSignal.
 */
export function waitForVisibilityPaint({ signal, documentRef = null } = {}) {
  const view = documentRef?.defaultView;
  if (
    signal?.aborted ||
    !documentRef ||
    documentRef.hidden ||
    typeof documentRef.addEventListener !== 'function' ||
    typeof documentRef.removeEventListener !== 'function' ||
    typeof view?.requestAnimationFrame !== 'function' ||
    typeof view?.cancelAnimationFrame !== 'function' ||
    typeof view?.setTimeout !== 'function' ||
    typeof view?.clearTimeout !== 'function'
  )
    return Promise.resolve();

  return new Promise((resolve) => {
    let frame = null;
    let task = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      if (task !== null) view.clearTimeout(task);
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
    try {
      frame = view.requestAnimationFrame(() => {
        frame = null;
        if (finished) return;
        if (signal?.aborted || documentRef.hidden) {
          finish();
          return;
        }
        try {
          task = view.setTimeout(() => {
            task = null;
            finish();
          }, 0);
        } catch {
          // Missing scheduling capability should never strand a visibility
          // intent. Resume lifecycle work without claiming a paint occurred.
          finish();
        }
      });
    } catch {
      // A transient scheduling failure must not leave the intent queue blocked.
      finish();
    }
  });
}
