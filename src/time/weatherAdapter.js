function epoch(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/** Bind observed weather frames to investigation time without frame-rate refetches. */
export function createInvestigationWeatherAdapter({
  weatherClock,
  investigationTime,
  capabilities = null,
} = {}) {
  if (
    !weatherClock?.getState ||
    !weatherClock?.setTarget ||
    !weatherClock?.latest
  )
    throw new TypeError('A weather clock is required');
  if (!investigationTime?.subscribe)
    throw new TypeError('An investigation clock is required');
  if (capabilities && typeof capabilities.register !== 'function')
    throw new TypeError('A temporal capability registry is required');

  let destroyed = false;
  const handles = new Map();

  function syncCapabilities() {
    if (!capabilities || destroyed) return;
    const products = weatherClock.getState().products || [];
    const activeIds = new Set(products.map(({ id }) => id));
    for (const [id, handle] of handles) {
      if (activeIds.has(id)) continue;
      handle.remove();
      handles.delete(id);
    }
    for (const { id } of products) {
      const times = weatherClock.getProductTimes?.(id) || [];
      const signature = JSON.stringify(times);
      if (handles.get(id)?.signature === signature) continue;
      handles.get(id)?.remove();
      handles.delete(id);
      if (!times.length) continue;
      const coverage = { from: epoch(times[0]), to: epoch(times.at(-1)) };
      if (coverage.from === null || coverage.to === null) continue;
      const remove = capabilities.register({
        id,
        mode: 'provider-history',
        label: 'Observed weather imagery',
        coverage,
        selectAt: async ({ targetMs }) => {
          const frame = weatherClock.selectFor(
            id,
            new Date(targetMs).toISOString(),
          );
          if (!frame) return null;
          return {
            sampleTimeMs: epoch(frame),
            selectedTimeMs: targetMs,
            productId: id,
            frameTime: frame,
            timeBasis: 'observed-frame',
          };
        },
      });
      handles.set(id, { signature, remove });
    }
  }

  function syncInvestigationTime(clockState) {
    if (destroyed) return;
    const weatherState = weatherClock.getState();
    if (clockState.mode === 'live' || clockState.timeMs == null) {
      if (weatherState.mode !== 'latest') void weatherClock.latest();
      return;
    }
    const targetMs = epoch(clockState.timeMs);
    if (targetMs === null) return;
    const target = new Date(targetMs).toISOString();
    const products = weatherState.products || [];
    if (!products.length) return;
    const changed = products.some(
      ({ id, selected }) => weatherClock.selectFor(id, target) !== selected,
    );
    if (!changed && weatherState.mode === 'history') return;
    weatherClock.pause?.();
    void weatherClock.setTarget(target);
  }

  const removeWeatherListener =
    weatherClock.subscribe?.(syncCapabilities) || (() => {});
  const removeInvestigationListener = investigationTime.subscribe(
    syncInvestigationTime,
  );
  syncCapabilities();

  return Object.freeze({
    refresh: syncCapabilities,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeWeatherListener();
      removeInvestigationListener();
      for (const handle of handles.values()) handle.remove();
      handles.clear();
    },
  });
}
