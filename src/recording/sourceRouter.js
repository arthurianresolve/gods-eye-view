/** Switch the aircraft layer between its live provider and a chosen local recording. */
export function createAircraftSourceRouter({ live, recorded } = {}) {
  if (typeof live?.getSnapshot !== 'function')
    throw new TypeError('A live aircraft source is required');
  if (typeof recorded?.getSnapshot !== 'function')
    throw new TypeError('A recorded aircraft source is required');
  let mode = 'live';
  let generation = 0;
  let destroyed = false;
  let capabilityBinding = null;
  let capabilityHandle = null;
  const listeners = new Set();

  const state = () =>
    Object.freeze({
      mode,
      ...recorded.getState(),
    });
  const publish = () => {
    const snapshot = state();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A consumer cannot block source ownership changes.
      }
    }
    return snapshot;
  };

  function syncCapability(registry, readLive, layerId) {
    capabilityHandle?.remove?.();
    capabilityHandle = null;
    if (!registry || destroyed) return;
    if (mode === 'recorded') {
      capabilityHandle = recorded.attachCapabilities(registry, { layerId });
      return;
    }
    capabilityHandle = {
      remove: registry.register({
        id: layerId,
        mode: 'live',
        label: live.label || 'Live aircraft feed',
        readLive,
      }),
    };
  }

  return Object.freeze({
    get label() {
      return mode === 'live' ? live.label || 'Aircraft' : recorded.label;
    },
    getState: state,
    getTimeline: () => recorded.getTimeline(),
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Listener must be a function');
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    async getSnapshot(query, options) {
      if (destroyed)
        throw new Error('Aircraft source router has been destroyed');
      const requestGeneration = generation;
      const snapshot = await (mode === 'live'
        ? live.getSnapshot(query, options)
        : recorded.getSnapshot(query, options));
      if (options?.signal?.aborted || requestGeneration !== generation)
        throw new DOMException('Aircraft source mode changed', 'AbortError');
      return snapshot;
    },
    async selectRecording(id) {
      if (destroyed) return { status: 'destroyed' };
      const result = await recorded.selectRecording(id);
      if (result.status === 'selected' || result.status === 'empty-recording') {
        generation++;
        mode = 'recorded';
        if (capabilityBinding)
          syncCapability(
            capabilityBinding.registry,
            capabilityBinding.readLive,
            capabilityBinding.layerId,
          );
        publish();
      }
      return result;
    },
    setTime(value) {
      if (destroyed)
        throw new Error('Aircraft source router has been destroyed');
      const selectedTime = recorded.setTime(value);
      generation++;
      publish();
      return selectedTime;
    },
    returnLive() {
      if (destroyed) return state();
      generation++;
      mode = 'live';
      recorded.clear();
      if (capabilityBinding)
        syncCapability(
          capabilityBinding.registry,
          capabilityBinding.readLive,
          capabilityBinding.layerId,
        );
      return publish();
    },
    attachCapabilities(
      registry,
      { layerId = 'flights', readLive = null } = {},
    ) {
      if (!registry?.register)
        throw new TypeError('A temporal capability registry is required');
      if (typeof readLive !== 'function')
        throw new TypeError('The live feed reader is required');
      const binding = { registry, readLive, layerId };
      capabilityBinding = binding;
      syncCapability(registry, readLive, layerId);
      return () => {
        if (capabilityBinding !== binding) return;
        capabilityHandle?.remove?.();
        capabilityHandle = null;
        capabilityBinding = null;
      };
    },
    destroy() {
      if (destroyed) return;
      generation++;
      destroyed = true;
      capabilityHandle?.remove?.();
      capabilityHandle = null;
      capabilityBinding = null;
      recorded.clear();
      listeners.clear();
    },
  });
}
