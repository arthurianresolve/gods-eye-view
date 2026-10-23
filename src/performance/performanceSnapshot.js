const MAX_SAMPLES = 120;
const MAX_RESOURCE_OWNERS = 32;
const OWNER_RESOURCE_FIELDS = Object.freeze([
  'listeners',
  'timers',
  'pendingJobs',
  'primitives',
  'entities',
  'dataSources',
  'cacheEntries',
  'imageryLayers',
  'estimatedTileBytes',
  'providerLoadsStarted',
  'providerCacheReuses',
  'providerLoadFailures',
]);
const POINT_REPRESENTATIONS = new Set(['entity', 'primitive-collection']);
// Match runtimeLayer's MAX_RENDERED_IMPORT_FEATURES bound without importing its Cesium-facing module.
const POINT_PRIMITIVE_COUNT_MAX = 5_000;
const POINT_PRIMITIVE_COUNT_UNIT = 'instances';
const POINT_PRIMITIVE_COVERAGE = 'owned-import-point-collection';
const RENDERER_CACHE = new WeakMap();

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

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

function framePercentiles(samples) {
  const values = samples
    .filter(
      (sample) =>
        sample.name === 'frameInterval' &&
        sample.metadata?.mayIncludeIntentionalIdle === false,
    )
    .map((sample) => sample.durationMs);
  return {
    eligibleFrameCount: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  };
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
    const samples = this.samples.map((sample) => ({ ...sample }));
    return {
      schema: 'gev-performance-snapshot/v1',
      capturedAt: new Date().toISOString(),
      elapsedMs: Math.max(0, this.now() - this.startedAt),
      identity: clone(identity) || {},
      settings: clone(settings) || {},
      scene: clone(scene) || {},
      resources: clone(resources) || {},
      timings: clone(timings) || {},
      framePercentiles: framePercentiles(samples),
      counters: Object.fromEntries(this.counters),
      samples,
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
    entities: count(viewer?.entities?.values?.length),
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
      else if (amount === null) counts[field] = null;
    }
    if (POINT_REPRESENTATIONS.has(rawCounts.pointRepresentation))
      counts.pointRepresentation = rawCounts.pointRepresentation;
    const pointPrimitiveCount = rawCounts.pointPrimitiveCount;
    if (
      pointPrimitiveCount === null ||
      (Number.isSafeInteger(pointPrimitiveCount) &&
        pointPrimitiveCount >= 0 &&
        pointPrimitiveCount <= POINT_PRIMITIVE_COUNT_MAX)
    )
      counts.pointPrimitiveCount = pointPrimitiveCount;
    if (rawCounts.pointPrimitiveCountUnit === POINT_PRIMITIVE_COUNT_UNIT)
      counts.pointPrimitiveCountUnit = POINT_PRIMITIVE_COUNT_UNIT;
    if (rawCounts.pointPrimitiveCoverage === POINT_PRIMITIVE_COVERAGE)
      counts.pointPrimitiveCoverage = POINT_PRIMITIVE_COVERAGE;
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
  observeLongTasks = false,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let snapshot = null;
  let scene = null;
  let frameCount = 0;
  let previousFrameAt = null;
  let previousWasDemand = false;
  let active = false;
  let destroyed = false;
  let removeListener = null;
  let longTaskObserver = null;
  let observerGeneration = 0;
  let removeContextListeners = null;
  let removeTileListener = null;
  let removeVisibilityListener = null;
  let tileLoadBacklog = null;
  let longTaskStatus = observeLongTasks ? 'unavailable' : 'disabled';
  const onPostRender = () => {
    if (!active) return;
    const current = now();
    if (previousFrameAt !== null)
      snapshot.record('frameInterval', current - previousFrameAt, {
        renderMode: scene.requestRenderMode ? 'demand' : 'continuous',
        mayIncludeIntentionalIdle:
          previousWasDemand || Boolean(scene.requestRenderMode),
      });
    previousFrameAt = current;
    previousWasDemand = Boolean(scene.requestRenderMode);
    frameCount += 1;
    snapshot.count('renderedFrames');
  };
  function setEnabled(value) {
    const nextEnabled = Boolean(value);
    if (destroyed || active === nextEnabled) return;
    if (removeListener) removeListener();
    removeListener = null;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    observerGeneration += 1;
    removeContextListeners?.();
    removeContextListeners = null;
    removeTileListener?.();
    removeTileListener = null;
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    longTaskStatus = observeLongTasks ? 'unavailable' : 'disabled';
    tileLoadBacklog = null;
    active = nextEnabled;
    enabled = active;
    previousFrameAt = null;
    if (!active) {
      scene = null;
      return;
    }
    if (!snapshot) snapshot = new PerformanceSnapshot({ now });
    scene = viewer?.scene;
    invalidatePerformanceEnvironmentCache(scene?.context?._gl);
    if (scene?.postRender?.addEventListener) {
      const unsubscribe = scene.postRender.addEventListener(onPostRender);
      removeListener =
        typeof unsubscribe === 'function'
          ? unsubscribe
          : () => scene.postRender.removeEventListener?.(onPostRender);
    }
    const generation = observerGeneration;
    if (
      observeLongTasks &&
      typeof PerformanceObserver === 'function' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ) {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          if (!active || destroyed || generation !== observerGeneration) return;
          for (const entry of list.getEntries())
            snapshot.record('longTask', entry.duration, {
              startTime: entry.startTime,
            });
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
        longTaskStatus = 'observing';
      } catch {
        longTaskObserver?.disconnect();
        longTaskObserver = null;
      }
    }
    const progress = scene?.globe?.tileLoadProgressEvent;
    if (progress?.addEventListener) {
      const onProgress = (count) => {
        if (
          active &&
          generation === observerGeneration &&
          Number.isSafeInteger(count) &&
          count >= 0
        )
          tileLoadBacklog = count;
      };
      removeTileListener =
        progress.addEventListener(onProgress) ||
        (() => progress.removeEventListener?.(onProgress));
    }
    const documentRef = globalThis.document;
    if (documentRef?.addEventListener) {
      const visibility = () => {
        previousFrameAt = null;
      };
      documentRef.addEventListener('visibilitychange', visibility);
      removeVisibilityListener = () =>
        documentRef.removeEventListener('visibilitychange', visibility);
    }
    const canvas = scene?.canvas;
    if (canvas?.addEventListener) {
      const invalidate = () =>
        invalidatePerformanceEnvironmentCache(scene?.context?._gl);
      canvas.addEventListener('webglcontextlost', invalidate);
      canvas.addEventListener('webglcontextrestored', invalidate);
      removeContextListeners = () => {
        canvas.removeEventListener('webglcontextlost', invalidate);
        canvas.removeEventListener('webglcontextrestored', invalidate);
      };
    }
  }
  if (enabled) setEnabled(true);

  function unavailableSnapshot() {
    return {
      schema: 'gev-performance-snapshot/v1',
      available: false,
      historyScope: 'retained-samples-only',
      retainedHistory: snapshot !== null,
      capturedAt: null,
      elapsedMs: null,
      identity: {
        appCommit: appCommit || null,
        harnessCommit: harnessCommit || null,
        userAgent: null,
        renderer: null,
        vendor: null,
        viewport: { width: null, height: null, dpr: null },
        drawingBuffer: { width: null, height: null },
        layers: null,
      },
      settings: null,
      scene: { renderedFrameCount: null },
      retainedRenderedFrameCount: snapshot ? frameCount : null,
      resources: null,
      timings: null,
      framePercentiles: {
        eligibleFrameCount: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
      },
      counters: snapshot ? Object.fromEntries(snapshot.counters) : {},
      samples: snapshot
        ? snapshot.samples.map((sample) => ({ ...sample }))
        : [],
    };
  }

  return {
    setEnabled,
    getSnapshot(extra = {}) {
      if (!active || !snapshot) return unavailableSnapshot();
      const environment = readPerformanceEnvironment({
        viewer,
        dataManager,
        appCommit,
        harnessCommit,
      });
      const diagnostics = readDiagnostics();
      return {
        ...snapshot.snapshot({
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
                  diagnostics,
                  ownership: readOwnership(),
                })
              : {}),
            tileLoadBacklog,
            drawCalls: null,
            ...(clone(extra.resources) || {}),
          },
          timings: {
            ...(enabled
              ? {
                  gpuExecutionMs: null,
                  frameIntervalScope: 'completed-frame-wall-time',
                  longTaskStatus,
                }
              : {}),
            ...(enabled ? clone(readTimings()) || {} : {}),
            ...(clone(extra.timings) || {}),
          },
        }),
        available: true,
        historyScope: 'since-first-enable',
        renderDemand: {
          mode: diagnostics?.mode ?? null,
          holds: Array.isArray(diagnostics?.holds)
            ? diagnostics.holds
                .slice(0, MAX_RESOURCE_OWNERS)
                .map((owner) => String(owner).slice(0, 64))
            : null,
        },
      };
    },
    destroy() {
      if (destroyed) return;
      setEnabled(false);
      longTaskObserver?.disconnect();
      longTaskObserver = null;
      destroyed = true;
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
  if (gl) {
    const cached = RENDERER_CACHE.get(gl);
    if (cached) ({ renderer, vendor } = cached);
    else {
      try {
        const extension = gl.getExtension?.('WEBGL_debug_renderer_info');
        renderer =
          gl.getParameter?.(
            extension?.UNMASKED_RENDERER_WEBGL || gl.RENDERER,
          ) || null;
        vendor =
          gl.getParameter?.(extension?.UNMASKED_VENDOR_WEBGL || gl.VENDOR) ||
          null;
      } catch {
        // Renderer strings are optional and must never break the application.
      }
      RENDERER_CACHE.set(gl, { renderer, vendor });
    }
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

/** Invalidate cached renderer identity after an explicit WebGL context restore. */
export function invalidatePerformanceEnvironmentCache(gl) {
  if (gl && typeof gl === 'object') RENDERER_CACHE.delete(gl);
}
