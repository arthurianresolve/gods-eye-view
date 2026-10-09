const MAX_SAMPLES = 120;
const MAX_RESOURCE_OWNERS = 32;
const OWNER_RESOURCE_FIELDS = Object.freeze([
  'listeners',
  'timers',
  'pendingJobs',
  'primitives',
  'dataSources',
  'cacheEntries',
]);

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** Bounded, local-only performance diagnostics for reproducible captures. */
export class PerformanceSnapshot {
  constructor({
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.now = now;
    this.startedAt = this.now();
    this.samples = [];
    this.counters = new Map();
  }

  record(name, durationMs, metadata = null) {
    const duration = finite(durationMs);
    if (!name || duration === null || duration < 0) return false;
    this.samples.push({
      name: String(name),
      durationMs: duration,
      metadata: clone(metadata),
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return true;
  }

  count(name, amount = 1) {
    if (!name || !Number.isFinite(amount)) return;
    this.counters.set(
      String(name),
      (this.counters.get(String(name)) || 0) + amount,
    );
  }

  snapshot({
    identity = {},
    resources = {},
    settings = {},
    scene = {},
    timings = {},
  } = {}) {
    return {
      schema: 'gev-performance-snapshot/v1',
      capturedAt: new Date().toISOString(),
      elapsedMs: Math.max(0, this.now() - this.startedAt),
      identity: clone(identity) || {},
      settings: clone(settings) || {},
      scene: clone(scene) || {},
      resources: clone(resources) || {},
      timings: clone(timings) || {},
      counters: Object.fromEntries(this.counters),
      samples: this.samples.map((sample) => ({ ...sample })),
    };
  }
}

function readResourceCounts({
  viewer = null,
  dataManager = null,
  diagnostics = null,
  ownership = null,
} = {}) {
  const scene = viewer?.scene;
  const count = (value) => (Number.isFinite(value) ? value : null);
  return {
    dataSources: count(viewer?.dataSources?.length),
    primitives: count(scene?.primitives?.length),
    groundPrimitives: count(scene?.groundPrimitives?.length),
    imageryLayers: count(viewer?.imageryLayers?.length),
    dataLayers: count(dataManager?.getAll?.()?.length),
    renderHolds: count(diagnostics?.holds?.length),
    scheduledUpdates: count(diagnostics?.scheduledUpdates?.length),
    ownerResources: readOwnerResources(ownership),
  };
}

/**
 * Keep ownership diagnostics numeric, bounded and local. Providers must pass
 * counts rather than object references, URLs, payloads or Cesium instances.
 */
function readOwnerResources(value) {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value).slice(0, MAX_RESOURCE_OWNERS);
  const result = {};
  for (const [rawOwner, rawCounts] of entries) {
    const owner = String(rawOwner).trim().slice(0, 64);
    if (!owner || !rawCounts || typeof rawCounts !== 'object') continue;
    const counts = {};
    for (const field of OWNER_RESOURCE_FIELDS) {
      const amount = rawCounts[field];
      if (Number.isFinite(amount) && amount >= 0)
        counts[field] = Math.floor(amount);
    }
    if (Object.keys(counts).length) result[owner] = counts;
  }
  return Object.keys(result).length ? result : null;
}

/**
 * Observe completed scene frames without changing render demand. The monitor
 * keeps a bounded local history and removes its listener on teardown.
 */
export function createPerformanceMonitor({
  viewer = null,
  dataManager = null,
  enabled = true,
  readSettings = () => ({}),
  readTimings = () => ({}),
  readDiagnostics = () => null,
  readOwnership = () => null,
  appCommit = null,
  harnessCommit = null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const snapshot = new PerformanceSnapshot({ now });
  const scene = viewer?.scene;
  let frameCount = 0;
  let previousFrameAt = null;
  const onPostRender = () => {
    const current = now();
    if (previousFrameAt !== null)
      snapshot.record('frameInterval', current - previousFrameAt);
    previousFrameAt = current;
    frameCount += 1;
    snapshot.count('renderedFrames');
  };
  const removeListener = enabled
    ? scene?.postRender?.addEventListener?.(onPostRender)
    : null;

  return {
    getSnapshot(extra = {}) {
      const environment = readPerformanceEnvironment({
        viewer,
        dataManager,
        appCommit,
        harnessCommit,
      });
      return snapshot.snapshot({
        identity: environment,
        settings: enabled ? clone(readSettings()) || {} : {},
        scene: {
          renderedFrameCount: frameCount,
          ...(clone(extra.scene) || {}),
        },
        resources: {
          ...(enabled
            ? readResourceCounts({
                viewer,
                dataManager,
                diagnostics: readDiagnostics(),
                ownership: readOwnership(),
              })
            : {}),
          ...(clone(extra.resources) || {}),
        },
        timings: {
          ...(enabled ? clone(readTimings()) || {} : {}),
          ...(clone(extra.timings) || {}),
        },
      });
    },
    destroy() {
      if (typeof removeListener === 'function') removeListener();
      else scene?.postRender?.removeEventListener?.(onPostRender);
    },
  };
}

export function readPerformanceEnvironment({
  viewer = null,
  dataManager = null,
  appCommit = null,
  harnessCommit = null,
} = {}) {
  const canvas = viewer?.scene?.canvas;
  const gl = viewer?.scene?.context?._gl || null;
  let renderer = null;
  let vendor = null;
  try {
    const extension = gl?.getExtension?.('WEBGL_debug_renderer_info');
    renderer =
      gl?.getParameter?.(extension?.UNMASKED_RENDERER_WEBGL || gl?.RENDERER) ||
      null;
    vendor =
      gl?.getParameter?.(extension?.UNMASKED_VENDOR_WEBGL || gl?.VENDOR) ||
      null;
  } catch {
    // Renderer strings are optional and must never break the application.
  }
  const layers = dataManager?.getAll?.() || [];
  return {
    appCommit: appCommit || null,
    harnessCommit: harnessCommit || null,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    renderer,
    vendor,
    viewport: {
      width: typeof innerWidth === 'number' ? innerWidth : null,
      height: typeof innerHeight === 'number' ? innerHeight : null,
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
    },
    drawingBuffer: {
      width: canvas?.width || null,
      height: canvas?.height || null,
    },
    layers: layers.map((layer) => ({
      id: layer.id,
      enabled: Boolean(layer.enabled),
      count: finite(layer.stats?.count),
    })),
  };
}
