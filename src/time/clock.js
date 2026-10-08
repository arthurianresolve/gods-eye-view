const MIN_RATE = -16;
const MAX_RATE = 16;
const DEFAULT_TICK_MS = 250;

function toEpochMs(value) {
  const epoch = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(epoch)) throw new TypeError('Expected a valid time');
  return epoch;
}

function playbackRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate === 0)
    throw new RangeError('Playback rate must be a finite nonzero number');
  return Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
}

/**
 * Own an investigation timeline without changing wall-clock deadlines,
 * Cesium's clock, weather playback, or Director shot timing.
 *
 * `live` always reads the supplied wall clock. `paused` and `replay` carry an
 * explicit target timestamp. Each state transition increments `generation`,
 * which async consumers can capture to reject stale work.
 */
export function createInvestigationClock({
  now = Date.now,
  monotonicNow = () => globalThis.performance?.now?.() ?? now(),
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
  tickMs = DEFAULT_TICK_MS,
} = {}) {
  if (
    typeof now !== 'function' ||
    typeof monotonicNow !== 'function' ||
    typeof schedule !== 'function' ||
    typeof cancel !== 'function'
  )
    throw new TypeError('Clock dependencies must be functions');

  const cadence = Math.max(
    50,
    Math.min(1000, Number(tickMs) || DEFAULT_TICK_MS),
  );
  const listeners = new Set();
  let timer = null;
  let destroyed = false;
  let lastWallAt = 0;
  let temporalSource = 'live';
  let temporalRecordingId = null;
  let state = Object.freeze({
    mode: 'live',
    targetMs: null,
    rate: 1,
    generation: 0,
  });

  const snapshot = () =>
    Object.freeze({
      ...state,
      timeMs: state.mode === 'live' ? now() : state.targetMs,
    });

  function publish(next) {
    if (destroyed) return snapshot();
    state = Object.freeze({ ...next, generation: state.generation + 1 });
    const value = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch {
        // A subscriber cannot prevent a timeline transition.
      }
    }
    return value;
  }

  function stopTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function tick() {
    timer = null;
    if (destroyed || state.mode !== 'replay') return;
    const tickAt = monotonicNow();
    const elapsed = Math.max(0, tickAt - lastWallAt);
    lastWallAt = tickAt;
    publish({
      ...state,
      targetMs: state.targetMs + elapsed * state.rate,
    });
    timer = schedule(tick, cadence);
  }

  function startTimer() {
    stopTimer();
    lastWallAt = monotonicNow();
    if (!destroyed && state.mode === 'replay') timer = schedule(tick, cadence);
  }

  const api = {
    getState: snapshot,
    getTemporalContext() {
      return Object.freeze({
        source: temporalSource,
        targetMs: state.mode === 'live' ? null : state.targetMs,
        recordingId: temporalRecordingId,
      });
    },
    now: () => (state.mode === 'live' ? now() : state.targetMs),
    wallNow: () => now(),
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Expected a listener');
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    seek(value) {
      const targetMs = toEpochMs(value);
      if (temporalSource === 'live') temporalSource = 'provider-history';
      const mode = state.mode === 'replay' ? 'replay' : 'paused';
      publish({ ...state, mode, targetMs });
      if (mode === 'replay') startTimer();
      else stopTimer();
      return snapshot();
    },
    setTemporalSource(source, recordingId = null) {
      if (!['live', 'provider-history', 'recording'].includes(source))
        throw new RangeError('Unknown investigation-time source');
      if (source === 'recording') {
        const id = String(recordingId ?? '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
          throw new TypeError('A valid local recording reference is required');
        temporalRecordingId = id;
      } else {
        if (recordingId != null)
          throw new TypeError(
            'Only recording time accepts a recording reference',
          );
        temporalRecordingId = null;
      }
      if (source === 'live' && state.mode !== 'live')
        throw new Error('Return the investigation clock to Live first');
      temporalSource = source;
      return api.getTemporalContext();
    },
    pause() {
      const targetMs = state.mode === 'live' ? now() : state.targetMs;
      stopTimer();
      return publish({ ...state, mode: 'paused', targetMs });
    },
    play(rate = state.rate) {
      const nextRate = playbackRate(rate);
      const targetMs = state.mode === 'live' ? now() : state.targetMs;
      publish({ ...state, mode: 'replay', targetMs, rate: nextRate });
      startTimer();
      return snapshot();
    },
    setRate(rate) {
      const nextRate = playbackRate(rate);
      const value = publish({ ...state, rate: nextRate });
      if (state.mode === 'replay') startTimer();
      return value;
    },
    returnLive() {
      stopTimer();
      temporalSource = 'live';
      temporalRecordingId = null;
      return publish({ ...state, mode: 'live', targetMs: null, rate: 1 });
    },
    destroy() {
      if (destroyed) return;
      stopTimer();
      destroyed = true;
      listeners.clear();
      state = Object.freeze({ ...state, generation: state.generation + 1 });
    },
  };

  return Object.freeze(api);
}

export { DEFAULT_TICK_MS as INVESTIGATION_CLOCK_TICK_MS };
