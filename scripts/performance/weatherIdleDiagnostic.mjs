export const WEATHER_IDLE_DIAGNOSTIC_SCHEMA =
  'gev-weather-idle-render-demand-diagnostic/v1';
export const WEATHER_IDLE_DIAGNOSTIC_INELIGIBLE_REASON =
  'weather-idle-render-demand-diagnostic-is-diagnostic-only';

export const WEATHER_IDLE_DIAGNOSTIC_MAX_FRAME_EVENTS = 512;
export const WEATHER_IDLE_DIAGNOSTIC_MAX_GOVERNOR_SAMPLES = 300;
export const WEATHER_IDLE_DIAGNOSTIC_MAX_GAP_REPORTS = 128;

const WEATHER_WORKLOAD_ID = 'austin-weather-effects-phased-v2';
const PHASE_IDS = new Set([
  'early-history',
  'middle-history',
  'latest-history',
]);

export function resolveWeatherIdleDiagnosticContract({
  enabled = false,
  workloadId,
  warmupMs,
  seconds,
  runs,
  otherWeatherDiagnostic = false,
} = {}) {
  if (!enabled) return null;
  if (workloadId !== WEATHER_WORKLOAD_ID)
    throw new TypeError(
      '--weather-idle-diagnostic requires the phased weather/effects fixture.',
    );
  if (otherWeatherDiagnostic)
    throw new TypeError(
      '--weather-idle-diagnostic cannot be combined with another weather diagnostic or qualification mode.',
    );
  if (warmupMs !== 30_000 || seconds !== 60 || runs !== 1)
    throw new TypeError(
      '--weather-idle-diagnostic requires exactly 30s warmup, 60s measurement and one run.',
    );
  return Object.freeze({
    mode: 'idle-render-demand-diagnostic',
    scenarios: Object.freeze(['idle']),
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    ineligibleReason: WEATHER_IDLE_DIAGNOSTIC_INELIGIBLE_REASON,
  });
}

/** Wrap only phase-selection evaluations and preserve the page API. */
export function observeWeatherPhaseRequests(
  page,
  { now = () => performance.now(), onEvent = () => {} } = {},
) {
  if (!page || typeof page.evaluate !== 'function')
    throw new TypeError('A Puppeteer page with evaluate() is required.');
  if (typeof now !== 'function' || typeof onEvent !== 'function')
    throw new TypeError('Phase observation callbacks are invalid.');

  const events = [];
  const observedPage = new Proxy(page, {
    get(target, property) {
      if (property === 'evaluate')
        return (...args) => {
          const payload = args[1];
          const phaseId = payload?.phase?.id;
          if (
            typeof phaseId !== 'string' ||
            !PHASE_IDS.has(phaseId) ||
            !/^[a-f0-9]{64}$/i.test(payload?.fixtureSha256 || '')
          )
            return Reflect.apply(target.evaluate, target, args);

          const event = {
            phaseId,
            fixtureSha256: payload.fixtureSha256,
            requestHostPerformanceNowMs: now(),
            completionHostPerformanceNowMs: null,
            status: 'pending',
            pageObservedAtElapsedMs: null,
          };
          events.push(event);
          onEvent({ ...event });
          let result;
          try {
            result = Reflect.apply(target.evaluate, target, args);
          } catch (error) {
            event.status = 'rejected';
            event.completionHostPerformanceNowMs = now();
            event.errorName = String(error?.name || 'Error').slice(0, 64);
            onEvent({ ...event });
            throw error;
          }
          return Promise.resolve(result).then(
            (value) => {
              event.status = 'fulfilled';
              event.completionHostPerformanceNowMs = now();
              event.pageObservedAtElapsedMs = Number.isFinite(
                value?.observedAtElapsedMs,
              )
                ? value.observedAtElapsedMs
                : null;
              onEvent({ ...event });
              return value;
            },
            (error) => {
              event.status = 'rejected';
              event.completionHostPerformanceNowMs = now();
              event.errorName = String(error?.name || 'Error').slice(0, 64);
              onEvent({ ...event });
              throw error;
            },
          );
        };

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { page: observedPage, events };
}

function normalizeGovernorState(state) {
  const safeLabel = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9:_./-]{1,96}$/.test(value)
      ? value
      : '[redacted]';
  const mode = state?.mode;
  const holds = Array.isArray(state?.holds)
    ? state.holds
        .filter((value) => typeof value === 'string')
        .slice(0, 32)
        .map(safeLabel)
    : null;
  const scheduledUpdates = Array.isArray(state?.scheduledUpdates)
    ? state.scheduledUpdates
        .filter((value) => typeof value === 'string')
        .slice(0, 32)
        .map(safeLabel)
    : null;
  const recentRequests = Array.isArray(state?.recentRequests)
    ? state.recentRequests.slice(-4).map((request) => ({
        reason: safeLabel(request?.reason),
        atEpochMs: Number.isFinite(request?.at) ? request.at : null,
      }))
    : null;
  return {
    mode: mode === 'idle' || mode === 'continuous' ? mode : null,
    holds,
    scheduledUpdates,
    recentRequests,
  };
}

function hasContinuousDemand(state) {
  if (!state || state.mode == null || !Array.isArray(state.holds)) return null;
  return state.mode === 'continuous' || state.holds.length > 0;
}

function stateSignature(state) {
  const normalized = normalizeGovernorState(state);
  return JSON.stringify({
    mode: normalized.mode,
    holds: normalized.holds,
    scheduledUpdates: normalized.scheduledUpdates,
  });
}

/** Add bounded owner-change and >1s gap summaries without classifying a pass. */
export function summarizeWeatherIdleDiagnostic({
  raw,
  phaseObservations,
  phaseRequestEvents = [],
} = {}) {
  if (!raw || typeof raw !== 'object')
    throw new TypeError('Weather idle raw diagnostic is required.');
  const frameEvents = Array.isArray(raw.frameEvents) ? raw.frameEvents : [];
  const governorSamples = Array.isArray(raw.governorSamples)
    ? raw.governorSamples
    : [];
  const validFrames = frameEvents
    .filter((frame) => Number.isFinite(frame?.atMs))
    .slice(0, WEATHER_IDLE_DIAGNOSTIC_MAX_FRAME_EVENTS);
  const validSamples = governorSamples
    .filter((sample) => Number.isFinite(sample?.atMs))
    .slice(0, WEATHER_IDLE_DIAGNOSTIC_MAX_GOVERNOR_SAMPLES);
  const ownerChanges = [];
  let previousSignature = null;
  for (const sample of validSamples) {
    const signature = stateSignature(sample.governor);
    if (previousSignature !== null && signature !== previousSignature)
      ownerChanges.push({
        atMs: sample.atMs,
        governor: normalizeGovernorState(sample.governor),
      });
    previousSignature = signature;
  }

  const gapsOverOneSecond = [];
  let omittedGapCount = 0;
  for (let index = 1; index < validFrames.length; index += 1) {
    const before = validFrames[index - 1];
    const after = validFrames[index];
    const intervalMs = after.atMs - before.atMs;
    if (intervalMs <= 1_000) continue;
    const states = [before.governor, after.governor];
    for (const sample of validSamples)
      if (sample.atMs >= before.atMs && sample.atMs <= after.atMs)
        states.push(sample.governor);
    const demand = states
      .map(hasContinuousDemand)
      .filter((value) => value !== null);
    const continuousDemandDuringGap =
      demand.length !== states.length
        ? 'partially-observed'
        : demand.some(Boolean)
          ? 'observed-present'
          : 'observed-absent';
    if (gapsOverOneSecond.length < WEATHER_IDLE_DIAGNOSTIC_MAX_GAP_REPORTS)
      gapsOverOneSecond.push({
        startAtMs: before.atMs,
        endAtMs: after.atMs,
        intervalMs,
        continuousDemandDuringGap,
        observedGovernorStateCount: states.length,
        observedModes: [...new Set(states.map((state) => state?.mode ?? null))],
        observedHolds: [
          ...new Set(states.flatMap((state) => state?.holds ?? [])),
        ].slice(0, 32),
        observedScheduledUpdates: [
          ...new Set(states.flatMap((state) => state?.scheduledUpdates ?? [])),
        ].slice(0, 32),
        observedRequestReasons: [
          ...new Set(
            states.flatMap((state) =>
              (state?.recentRequests ?? []).map((request) => request.reason),
            ),
          ),
        ].slice(0, 16),
      });
    else omittedGapCount += 1;
  }

  const phases = Array.isArray(phaseObservations?.phases)
    ? phaseObservations.phases
        .filter((phase) => PHASE_IDS.has(phase?.id))
        .slice(0, 3)
        .map((phase) => ({
          id: phase.id,
          scheduledTargetElapsedMs: Number.isFinite(phase.scheduledAtMs)
            ? phase.scheduledAtMs
            : null,
          pageObservedCompletionElapsedMs: Number.isFinite(
            phase.observedAtElapsedMs,
          )
            ? phase.observedAtElapsedMs
            : null,
          sourceObservationTimes: Array.isArray(phase.sourceObservationTimes)
            ? phase.sourceObservationTimes
                .slice(0, 3)
                .map((value) =>
                  typeof value === 'string' &&
                  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)
                    ? value
                    : null,
                )
            : [],
        }))
    : [];
  const phaseRequests = phaseRequestEvents
    .filter((event) => PHASE_IDS.has(event?.phaseId))
    .slice(0, 3)
    .map((event) => ({
      phaseId: event.phaseId,
      requestHostPerformanceNowMs: Number.isFinite(
        event.requestHostPerformanceNowMs,
      )
        ? event.requestHostPerformanceNowMs
        : null,
      completionHostPerformanceNowMs: Number.isFinite(
        event.completionHostPerformanceNowMs,
      )
        ? event.completionHostPerformanceNowMs
        : null,
      status: ['pending', 'fulfilled', 'rejected'].includes(event.status)
        ? event.status
        : 'unknown',
      pageObservedCompletionElapsedMs: Number.isFinite(
        event.pageObservedAtElapsedMs,
      )
        ? event.pageObservedAtElapsedMs
        : null,
      errorName:
        typeof event.errorName === 'string'
          ? event.errorName.slice(0, 64)
          : null,
    }));

  return {
    schema: WEATHER_IDLE_DIAGNOSTIC_SCHEMA,
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    ineligibleReason: WEATHER_IDLE_DIAGNOSTIC_INELIGIBLE_REASON,
    timingSemantics: {
      pageTimesUse: 'performance.now() relative to measurement start',
      phaseRequestTimesUse: 'host performance.now(); separate clock origin',
      phaseCompletionTimesUse:
        'host promise-settlement time plus page observation time',
      noCrossClockOrderingClaim: true,
    },
    instrumentation: {
      samplePeriodMs: raw.samplePeriodMs ?? 250,
      maximumFrameEvents: WEATHER_IDLE_DIAGNOSTIC_MAX_FRAME_EVENTS,
      maximumGovernorSamples: WEATHER_IDLE_DIAGNOSTIC_MAX_GOVERNOR_SAMPLES,
      frameEventsObserved: raw.frameEventsObserved ?? validFrames.length,
      frameEventsRecorded: validFrames.length,
      frameEventsOmitted: Math.max(
        0,
        Number(raw.frameEventsOmitted) || 0,
        (raw.frameEventsObserved ?? validFrames.length) - validFrames.length,
      ),
      governorSamplesObserved:
        raw.governorSamplesObserved ?? validSamples.length,
      governorSamplesRecorded: validSamples.length,
      governorSamplesOmitted: Math.max(
        0,
        Number(raw.governorSamplesOmitted) || 0,
        (raw.governorSamplesObserved ?? validSamples.length) -
          validSamples.length,
      ),
      samplingMaxGapMs: Number.isFinite(raw.samplingMaxGapMs)
        ? raw.samplingMaxGapMs
        : null,
      snapshotReadCount: raw.snapshotReadCount ?? 0,
      snapshotReadFailureCount: raw.snapshotReadFailureCount ?? 0,
      snapshotReadTotalDurationMs: Number.isFinite(
        raw.snapshotReadTotalDurationMs,
      )
        ? raw.snapshotReadTotalDurationMs
        : null,
      snapshotReadMaxDurationMs: Number.isFinite(raw.snapshotReadMaxDurationMs)
        ? raw.snapshotReadMaxDurationMs
        : null,
      phaseRequestEventsOmitted: Math.max(
        0,
        phaseRequestEvents.length - phaseRequests.length,
      ),
      gapsOverOneSecondOmitted: omittedGapCount,
    },
    frameEvents: validFrames.map((frame) => ({
      atMs: frame.atMs,
      intervalMs: Number.isFinite(frame.intervalMs) ? frame.intervalMs : null,
      governor: normalizeGovernorState(frame.governor),
    })),
    governorSamples: validSamples.map((sample) => ({
      atMs: sample.atMs,
      governor: normalizeGovernorState(sample.governor),
    })),
    ownerChanges,
    gapsOverOneSecond,
    phaseRequests,
    phases,
  };
}
