export const FRAMEBUFFER_PRESERVATION_DIAGNOSTIC_ID =
  'gev-framebuffer-preservation-diagnostic/v1';

/** Install before navigation so Cesium sees the requested diagnostic option. */
export async function installFramebufferPreservationDiagnostic(page) {
  if (!page?.evaluateOnNewDocument)
    throw new TypeError('A page with evaluateOnNewDocument is required.');
  await page.evaluateOnNewDocument(() => {
    const canvasPrototype = globalThis.HTMLCanvasElement?.prototype;
    if (!canvasPrototype || typeof canvasPrototype.getContext !== 'function')
      throw new Error('Canvas getContext is unavailable.');
    if (canvasPrototype.__gevFramebufferPreservationDiagnosticV1) return;
    const originalGetContext = canvasPrototype.getContext;
    const state = {
      schema: 'gev-framebuffer-preservation-diagnostic/v1',
      requests: 0,
      webglRequests: 0,
      actual: null,
    };
    Object.defineProperty(
      globalThis,
      '__gevFramebufferPreservationDiagnostic',
      {
        configurable: false,
        enumerable: false,
        writable: false,
        value: state,
      },
    );
    Object.defineProperty(
      canvasPrototype,
      '__gevFramebufferPreservationDiagnosticV1',
      {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true,
      },
    );
    canvasPrototype.getContext = function getContext(type, attributes) {
      const isWebgl =
        type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl';
      if (!isWebgl) return originalGetContext.call(this, type, attributes);
      const nextAttributes =
        attributes && typeof attributes === 'object' ? { ...attributes } : {};
      nextAttributes.preserveDrawingBuffer = false;
      const context = originalGetContext.call(this, type, nextAttributes);
      state.requests += 1;
      state.webglRequests += 1;
      state.actual = context?.getContextAttributes?.() || null;
      return context;
    };
  });
}

export async function readFramebufferPreservationDiagnostic(page) {
  if (!page?.evaluate) throw new TypeError('A page with evaluate is required.');
  return page.evaluate(() => {
    const app = globalThis.__godsEyeView;
    const gl = app?.viewer?.scene?.context?._gl;
    const state = globalThis.__gevFramebufferPreservationDiagnostic;
    const safeBoolean = (value) => (typeof value === 'boolean' ? value : null);
    const safeString = (value) =>
      typeof value === 'string' && value.length <= 32 ? value : null;
    const contextLost =
      typeof gl?.isContextLost === 'function' ? gl.isContextLost() : null;
    const liveAttributes =
      contextLost === true ? null : gl?.getContextAttributes?.() || null;
    return {
      schema: state?.schema || null,
      requests: Number.isSafeInteger(state?.requests) ? state.requests : null,
      webglRequests: Number.isSafeInteger(state?.webglRequests)
        ? state.webglRequests
        : null,
      contextLost,
      actual: liveAttributes
        ? {
            preserveDrawingBuffer: safeBoolean(
              liveAttributes.preserveDrawingBuffer,
            ),
            alpha: safeBoolean(liveAttributes.alpha),
            antialias: safeBoolean(liveAttributes.antialias),
            depth: safeBoolean(liveAttributes.depth),
            stencil: safeBoolean(liveAttributes.stencil),
            premultipliedAlpha: safeBoolean(liveAttributes.premultipliedAlpha),
            powerPreference: safeString(liveAttributes.powerPreference),
            failIfMajorPerformanceCaveat: safeBoolean(
              liveAttributes.failIfMajorPerformanceCaveat,
            ),
            desynchronized: safeBoolean(liveAttributes.desynchronized),
          }
        : null,
    };
  });
}

export function assertFramebufferPreservationDiagnostic(observation) {
  if (
    observation?.schema !== FRAMEBUFFER_PRESERVATION_DIAGNOSTIC_ID ||
    !Number.isSafeInteger(observation.requests) ||
    observation.requests < 1 ||
    !Number.isSafeInteger(observation.webglRequests) ||
    observation.webglRequests < 1 ||
    observation.contextLost !== false ||
    observation.actual?.preserveDrawingBuffer !== false
  )
    throw new Error(
      'Framebuffer preservation diagnostic did not observe an active WebGL context with preserveDrawingBuffer=false.',
    );
  return observation;
}

export function assertFramebufferPreservationUnchanged(before, after) {
  assertFramebufferPreservationDiagnostic(before);
  assertFramebufferPreservationDiagnostic(after);
  if (JSON.stringify(before.actual) !== JSON.stringify(after.actual))
    throw new Error(
      'Framebuffer preservation diagnostic context attributes changed during the sample.',
    );
  return after;
}
