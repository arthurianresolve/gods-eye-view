/**
 * Give a published user transition an intervening rendering opportunity.
 * The lifecycle publishes control presentation synchronously. A RAF queues
 * the following owned task so layer work stays outside that rendering
 * update's callbacks and microtasks, without waiting for a second update.
 * This does not measure or guarantee physical presentation. The calling
 * visibility intent owns the RAF and the task through its AbortSignal.
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
    const onFrame = () => {
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
    };
    try {
      frame = view.requestAnimationFrame(onFrame);
    } catch {
      // A transient scheduling failure must not leave the intent queue blocked.
      finish();
    }
  });
}
