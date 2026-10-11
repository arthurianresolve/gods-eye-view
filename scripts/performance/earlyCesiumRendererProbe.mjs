import { withHostTimeout } from './startupDiagnostics.mjs';

const STATE_KEY = '__gevRecoveryEarlyRendererProbe';

/** Install an opt-in, one-shot hook on Cesium's real widget canvas only. */
export async function installEarlyCesiumRendererProbe(
  page,
  { captureVendor = false } = {},
) {
  const handle = await page.evaluateOnNewDocument((captureVendor) => {
    const key = '__gevRecoveryEarlyRendererProbe';
    const prototype = HTMLCanvasElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
    const nativeGetContext = descriptor?.value;
    if (typeof nativeGetContext !== 'function') {
      window[key] = { error: 'native getContext unavailable' };
      return;
    }

    const state = (window[key] = {
      captured: false,
      contextLost: false,
      contextRestored: false,
      renderer: null,
      vendor: null,
      vendorCaptured: false,
      queryDurationMs: null,
      error: null,
      canvas: null,
      context: null,
      listeners: [],
    });
    let active = true;
    function restore() {
      if (!active) return;
      active = false;
      Object.defineProperty(prototype, 'getContext', descriptor);
    }
    state.restore = restore;
    Object.defineProperty(prototype, 'getContext', {
      ...descriptor,
      value: function (...args) {
        const context = Reflect.apply(nativeGetContext, this, args);
        if (
          active &&
          context &&
          this instanceof HTMLCanvasElement &&
          this.closest('.cesium-widget') &&
          /^(webgl2?|experimental-webgl)$/i.test(String(args[0]))
        ) {
          restore();
          state.captured = true;
          state.canvas = this;
          state.context = context;
          const onLost = (event) => {
            state.contextLost = true;
          };
          const onRestored = () => {
            state.contextRestored = true;
          };
          try {
            state.listeners.push(['webglcontextlost', onLost]);
            this.addEventListener('webglcontextlost', onLost);
            state.listeners.push(['webglcontextrestored', onRestored]);
            this.addEventListener('webglcontextrestored', onRestored);
          } catch (error) {
            state.error = String(error?.message || error).slice(0, 240);
          }
          try {
            const started = performance.now();
            const extension = context.getExtension('WEBGL_debug_renderer_info');
            state.renderer = context.getParameter(
              extension?.UNMASKED_RENDERER_WEBGL || context.RENDERER,
            );
            if (captureVendor) {
              state.vendor = context.getParameter(
                extension?.UNMASKED_VENDOR_WEBGL || context.VENDOR,
              );
              state.vendorCaptured = true;
            }
            state.queryDurationMs = performance.now() - started;
          } catch (error) {
            state.error = String(error?.message || error).slice(0, 240);
          }
        }
        return context;
      },
    });
  }, captureVendor);
  return handle?.identifier || null;
}

/** Verify early evidence against Cesium's live scene without querying GL again. */
export async function readEarlyCesiumRendererProbe(page, timeoutMs = 5_000) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate((key) => {
        const state = window[key];
        const scene = window.__godsEyeView?.viewer?.scene;
        if (!state?.captured || !state.canvas || !state.context)
          throw new Error('early renderer context was not captured');
        if (state.error)
          throw new Error('early renderer query failed: ' + state.error);
        if (state.contextLost || state.contextRestored)
          throw new Error('early renderer context was lost or restored');
        if (state.canvas !== scene?.canvas)
          throw new Error('early renderer canvas does not match Cesium scene');
        const cesiumContext = scene?.context;
        const original = cesiumContext?._originalGLContext;
        if (!original)
          throw new Error('Cesium original WebGL context identity unavailable');
        if (state.context !== original)
          throw new Error('early renderer context does not match Cesium scene');
        if (
          !Number.isFinite(state.queryDurationMs) ||
          state.queryDurationMs < 0
        )
          throw new Error('early renderer query duration is invalid');
        return {
          renderer: String(state.renderer || ''),
          queryDurationMs: state.queryDurationMs,
          canvasMatchesScene: true,
          contextMatchesScene: true,
          contextLost: state.contextLost,
          contextRestored: state.contextRestored,
        };
      }, STATE_KEY),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('early renderer verification timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Remove the document hook and listeners with host-side bounds. */
export async function cleanupEarlyCesiumRendererProbe(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
) {
  // Document scripts, prototype hooks and listeners belong to this target.
  // Once its owner confirms destruction, no protocol call can remove them:
  // the execution context and its registrations have already been released.
  if (page.isClosed()) return true;
  const removed = await withHostTimeout(async () => {
    if (!page.isClosed())
      await page.evaluate((key) => {
        const state = window[key];
        state?.restore?.();
        for (const [event, listener] of state?.listeners || [])
          state.canvas?.removeEventListener(event, listener);
        if (state) state.listeners = [];
        delete window[key];
      }, STATE_KEY);
    if (scriptIdentifier)
      await page.removeScriptToEvaluateOnNewDocument(scriptIdentifier);
    return true;
  }, timeoutMs);
  return removed === true;
}

/** Dispose a completed fixture document before auditing its released probe. */
export async function closeEarlyRendererProbeDocument(
  page,
  closeDocument = () => page.close(),
  timeoutMs = 5_000,
) {
  if (!page.isClosed()) {
    const closed = await withHostTimeout(async () => {
      await closeDocument();
      return page.isClosed();
    }, timeoutMs);
    if (closed !== true)
      throw new Error('Early renderer probe document did not close.');
  }
  return { cleanupKind: 'document-destroyed', closed: true };
}
