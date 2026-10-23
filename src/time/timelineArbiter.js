/**
 * Require an explicit handoff when Director, launch playback, or investigation
 * time compete for the shared scene timeline.
 */
export function createTimelineArbiter() {
  const listeners = new Set();
  const handoffHandlers = new Map();
  let owner = null;
  let generation = 0;
  let operation = 0;
  let destroyed = false;

  const snapshot = () => Object.freeze({ owner, generation });
  const notify = () => {
    const state = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A listener cannot claim or release another owner's timeline.
      }
    }
    return state;
  };

  return Object.freeze({
    getState: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Expected a listener');
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    register(nextOwner, stop) {
      const requested = String(nextOwner || '').trim();
      if (!requested || typeof stop !== 'function')
        throw new TypeError('A timeline owner and stop handler are required');
      handoffHandlers.set(requested, stop);
      return () => {
        if (handoffHandlers.get(requested) === stop)
          handoffHandlers.delete(requested);
      };
    },
    async claim(nextOwner, { onConflict } = {}) {
      const requested = String(nextOwner || '').trim();
      if (destroyed) return false;
      if (!requested) throw new TypeError('Timeline owner is required');
      if (owner === requested) return true;
      const previous = owner;
      const request = ++operation;
      if (previous !== null) {
        if (typeof onConflict !== 'function') return false;
        const handedOff = await onConflict({ from: previous, to: requested });
        if (!handedOff || destroyed || request !== operation) return false;
        if (owner !== previous && owner !== null) return false;
        const stop = handoffHandlers.get(previous);
        if (stop) {
          const stopped = await stop({ from: previous, to: requested });
          if (stopped === false || destroyed || request !== operation)
            return false;
          if (owner !== previous && owner !== null) return false;
        }
      }
      if (destroyed || request !== operation) return false;
      owner = requested;
      generation++;
      notify();
      return true;
    },
    release(requestedOwner) {
      if (destroyed || owner !== requestedOwner) return false;
      owner = null;
      generation++;
      notify();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      owner = null;
      generation++;
      operation++;
      handoffHandlers.clear();
      listeners.clear();
    },
  });
}
