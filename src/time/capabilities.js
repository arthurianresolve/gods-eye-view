const MODES = new Set([
  'live',
  'recorded',
  'provider-history',
  'forecast',
  'static',
]);

function epoch(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function coverageContains(coverage, timeMs) {
  if (!coverage) return false;
  const from = epoch(coverage.from);
  const to = epoch(coverage.to);
  return from !== null && to !== null && from <= timeMs && timeMs <= to;
}

/**
 * Registry for layer-owned temporal adapters. The registry never substitutes a
 * latest sample for an unsupported historical request and never installs data;
 * callers own the generation check immediately before installation.
 */
export function createLayerCapabilityRegistry() {
  const entries = new Map();
  const listeners = new Set();
  let generation = 0;
  let requestGeneration = 0;
  let activeController = null;
  let destroyed = false;

  const publish = () => {
    generation++;
    requestGeneration++;
    activeController?.abort();
    activeController = null;
    const state = api.snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Registry observers are advisory.
      }
    }
  };

  const api = {
    snapshot() {
      return Object.freeze({
        generation,
        layers: Object.freeze(
          [...entries.values()].map(({ id, mode, coverage, label }) =>
            Object.freeze({ id, mode, coverage, label }),
          ),
        ),
      });
    },
    register({
      id,
      mode,
      coverage = null,
      label = id,
      selectAt = null,
      readLive = null,
    }) {
      const key = String(id || '').trim();
      if (destroyed) throw new Error('Capability registry has been destroyed');
      if (!key || !MODES.has(mode))
        throw new TypeError('Invalid layer capability');
      if (entries.has(key))
        throw new Error(`Duplicate temporal capability: ${key}`);
      if (
        coverage &&
        (epoch(coverage.from) === null ||
          epoch(coverage.to) === null ||
          epoch(coverage.from) > epoch(coverage.to))
      )
        throw new TypeError(`Invalid temporal coverage: ${key}`);
      if (selectAt !== null && typeof selectAt !== 'function')
        throw new TypeError('selectAt must be a function');
      if (readLive !== null && typeof readLive !== 'function')
        throw new TypeError('readLive must be a function');
      const entry = Object.freeze({
        id: key,
        mode,
        coverage: coverage ? Object.freeze({ ...coverage }) : null,
        label: String(label),
        selectAt,
        readLive,
      });
      entries.set(key, entry);
      publish();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (entries.get(key) === entry) {
          entries.delete(key);
          publish();
        }
      };
    },
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Expected a listener');
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(api.snapshot());
      return () => listeners.delete(listener);
    },
    async resolveAt(id, target, { signal } = {}) {
      if (destroyed) return { status: 'cancelled' };
      const entry = entries.get(String(id));
      if (!entry)
        return { status: 'unsupported', reason: 'unregistered-layer' };
      if (signal?.aborted) return { status: 'cancelled' };
      const targetMs =
        target === null || target === undefined ? null : epoch(target);
      if (target !== null && target !== undefined && targetMs === null)
        return { status: 'invalid-time' };
      if (entry.mode === 'live') {
        if (targetMs !== null)
          return {
            status: 'unsupported',
            reason: 'live-only',
            layerId: entry.id,
          };
        if (!entry.readLive)
          return {
            status: 'available',
            layerId: entry.id,
            mode: 'live',
            sampleTimeMs: null,
          };
        const value = await entry.readLive({ signal });
        if (signal?.aborted) return { status: 'cancelled' };
        return value == null
          ? {
              status: 'unavailable',
              reason: 'no-live-sample',
              layerId: entry.id,
            }
          : { ...value, status: 'available', layerId: entry.id, mode: 'live' };
      }
      if (entry.mode === 'static')
        return {
          status: 'available',
          layerId: entry.id,
          mode: 'static',
          sampleTimeMs: null,
          vintage: entry.coverage?.vintage ?? null,
        };
      if (targetMs === null)
        return {
          status: 'unsupported',
          reason: 'target-time-required',
          layerId: entry.id,
        };
      if (!coverageContains(entry.coverage, targetMs))
        return { status: 'no-coverage', layerId: entry.id, targetMs };
      if (!entry.selectAt)
        return {
          status: 'unsupported',
          reason: 'selector-unavailable',
          layerId: entry.id,
        };
      const selection = await entry.selectAt({ targetMs, signal });
      if (signal?.aborted) return { status: 'cancelled' };
      if (!selection)
        return { status: 'no-sample', layerId: entry.id, targetMs };
      const sampleTimeMs = epoch(selection.sampleTimeMs);
      if (sampleTimeMs === null || sampleTimeMs > targetMs)
        return { status: 'invalid-sample-time', layerId: entry.id, targetMs };
      return {
        ...selection,
        status: 'available',
        layerId: entry.id,
        mode: entry.mode,
        targetMs,
        sampleTimeMs,
      };
    },
    async resolveAllAt(target, { signal } = {}) {
      if (destroyed) return { status: 'cancelled', generation };
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const owner = ++requestGeneration;
      const registryGeneration = generation;
      const relayAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener('abort', relayAbort, { once: true });
      let onAbort;
      try {
        const cancelled = new Promise((resolve) => {
          onAbort = () => resolve({ status: 'cancelled', generation: owner });
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const work = Promise.all(
          [...entries.keys()].map(async (id) => [
            id,
            await api.resolveAt(id, target, { signal: controller.signal }),
          ]),
        ).then((results) => {
          if (
            controller.signal.aborted ||
            destroyed ||
            owner !== requestGeneration ||
            registryGeneration !== generation
          )
            return { status: 'cancelled', generation: owner };
          return {
            status: 'resolved',
            generation: owner,
            registryGeneration,
            results: Object.fromEntries(results),
          };
        });
        return await Promise.race([work, cancelled]);
      } finally {
        signal?.removeEventListener('abort', relayAbort);
        controller.signal.removeEventListener('abort', onAbort);
        if (activeController === controller) activeController = null;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeController?.abort();
      activeController = null;
      entries.clear();
      listeners.clear();
      generation++;
    },
  };

  return Object.freeze(api);
}
