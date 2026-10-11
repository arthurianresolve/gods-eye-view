/** Bounded loading-window summary of Chrome trace markers and V8 GC. */
export const IMPORT_TRACE_ATTRIBUTION_SCHEMA =
  'gev-import-trace-attribution/v1';
export const IMPORT_TRACE_CATEGORIES =
  'devtools.timeline,disabled-by-default-v8.gc';
export const IMPORT_TRACE_EVENT_LIMIT = 4096;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const MARKER_PREFIX = 'gev-import-step:';
const STAGE_NAMES = new Set([
  'entity',
  'coordinate-chunk',
  'unsupported-feature',
  'completed',
  'other',
]);

function markerName(event) {
  if (event?.name !== 'TimeStamp') return null;
  const message = event.args?.data?.message;
  return typeof message === 'string' && message.startsWith(MARKER_PREFIX)
    ? message
    : null;
}

function isV8Gc(event) {
  const categories = typeof event?.cat === 'string' ? event.cat.split(',') : [];
  return (
    categories.some((category) => category.includes('v8.gc')) &&
    typeof event.name === 'string' &&
    /^V8\.(?:GC|MinorGC)/.test(event.name)
  );
}

function hasThread(event) {
  return (
    Number.isInteger(event?.pid) &&
    event.pid >= 0 &&
    Number.isInteger(event?.tid) &&
    event.tid >= 0
  );
}

function eventKey(event) {
  return `${event.pid}\u0000${event.tid}\u0000${event.cat}\u0000${event.name}`;
}

function overlaps(event, startUs, endUs) {
  return event.tsUs < endUs && event.tsUs + event.durationUs > startUs;
}

function unionOverlapUs(events, startUs, endUs) {
  const intervals = events
    .filter((event) => overlaps(event, startUs, endUs))
    .map((event) => [
      Math.max(startUs, event.tsUs),
      Math.min(endUs, event.tsUs + event.durationUs),
    ])
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let start = null;
  let end = null;
  for (const [nextStart, nextEnd] of intervals) {
    if (start === null) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return start === null ? total : total + end - start;
}

/**
 * Retain bounded markers, V8 GC duration events, and non-duration GC markers.
 * B/E pairs are joined across dataCollected chunks. No trace args, URLs, source
 * payloads, or unrelated event records are returned.
 */
export function createImportTraceEventCollector(
  maxEvents = IMPORT_TRACE_EVENT_LIMIT,
) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1)
    throw new TypeError('Invalid trace event input');
  const retained = [];
  const pendingBegins = new Map();
  let relevantCount = 0;
  let omittedCount = 0;
  let pendingCount = 0;
  let finished = false;
  const retain = (event) => {
    relevantCount += 1;
    if (retained.length + pendingCount < maxEvents) retained.push(event);
    else omittedCount += 1;
  };
  const omit = () => {
    relevantCount += 1;
    omittedCount += 1;
  };
  return {
    add(events) {
      if (finished) throw new Error('Import trace collector is finished');
      if (!Array.isArray(events))
        throw new TypeError('Trace chunk must be an array');
      for (const event of events) {
        const marker = markerName(event);
        const gc = isV8Gc(event);
        if (!marker && !gc) continue;
        const validBase = finite(event.ts) && event.ts >= 0 && hasThread(event);
        if (marker) {
          if (!validBase) omit();
          else
            retain({
              kind: 'marker',
              name: marker,
              tsUs: event.ts,
              pid: event.pid,
              tid: event.tid,
            });
          continue;
        }
        if (!validBase) {
          omit();
          continue;
        }
        if (event.ph === 'X') {
          if (!finite(event.dur) || event.dur < 0) omit();
          else
            retain({
              kind: 'gc',
              name: event.name,
              tsUs: event.ts,
              durationUs: event.dur,
              pid: event.pid,
              tid: event.tid,
            });
          continue;
        }
        if (event.ph === 'B') {
          const key = eventKey(event);
          const begins = pendingBegins.get(key) || [];
          if (retained.length + pendingCount >= maxEvents) {
            omit();
            continue;
          }
          begins.push({ tsUs: event.ts, pid: event.pid, tid: event.tid });
          pendingBegins.set(key, begins);
          pendingCount += 1;
          continue;
        }
        if (event.ph === 'E') {
          const key = eventKey(event);
          const begins = pendingBegins.get(key);
          const begin = begins?.at(-1);
          if (!begin) {
            omit();
            continue;
          }
          begins.pop();
          pendingCount -= 1;
          if (begins.length === 0) pendingBegins.delete(key);
          if (event.ts < begin.tsUs) {
            omit();
            continue;
          }
          retain({
            kind: 'gc',
            name: event.name,
            tsUs: begin.tsUs,
            durationUs: event.ts - begin.tsUs,
            pid: event.pid,
            tid: event.tid,
          });
          continue;
        }
        if (event.ph === 'I' || event.ph === 'i') {
          retain({
            kind: 'gc-instant',
            name: event.name,
            tsUs: event.ts,
            pid: event.pid,
            tid: event.tid,
          });
          continue;
        }
        omit();
      }
    },
    finish() {
      if (!finished) {
        finished = true;
        for (const begins of pendingBegins.values())
          for (const _begin of begins) {
            omit();
            pendingCount -= 1;
          }
        pendingBegins.clear();
      }
      return {
        events: retained,
        relevantCount,
        omittedCount,
      };
    },
  };
}

export function retainImportTraceEvents(
  events,
  maxEvents = IMPORT_TRACE_EVENT_LIMIT,
) {
  const collector = createImportTraceEventCollector(maxEvents);
  collector.add(events);
  return collector.finish();
}

/**
 * Align fixture performance.now() intervals to same-trace TimeStamp anchors,
 * then report temporal overlap with recorded V8 GC slices. Overlap is not proof
 * that GC caused a slow iterator step.
 */
export function summarizeImportTraceAttribution({
  trace,
  anchors,
  loadingWindows,
}) {
  const errors = [];
  if (trace?.stopError) errors.push('trace-stop-failed');
  if (
    !trace ||
    !Array.isArray(trace.events) ||
    !Array.isArray(anchors) ||
    !Array.isArray(loadingWindows)
  )
    throw new TypeError('Invalid import trace attribution input');
  if (anchors.length > 774 || loadingWindows.length > 6)
    throw new RangeError('Import trace attribution input exceeds its bound');

  const anchorByName = new Map();
  for (const anchor of anchors) {
    if (
      !anchor ||
      typeof anchor.name !== 'string' ||
      !anchor.name.startsWith(MARKER_PREFIX) ||
      !finite(anchor.pageNowMs) ||
      anchor.pageNowMs < 0 ||
      !finite(anchor.uncertaintyMs) ||
      anchor.uncertaintyMs < 0 ||
      anchor.uncertaintyMs > 2
    ) {
      errors.push('invalid-page-anchor');
      continue;
    }
    if (anchorByName.has(anchor.name)) errors.push('duplicate-page-anchor');
    anchorByName.set(anchor.name, anchor);
  }

  const traceMarkerByName = new Map();
  const gcEvents = [];
  const gcInstantObservations = [];
  for (const event of trace.events) {
    if (
      !event ||
      !finite(event.tsUs) ||
      event.tsUs < 0 ||
      (event.kind !== 'marker' &&
        event.kind !== 'gc' &&
        event.kind !== 'gc-instant')
    ) {
      errors.push('invalid-retained-trace-event');
      continue;
    }
    if (event.kind === 'marker') {
      if (
        typeof event.name !== 'string' ||
        !event.name.startsWith(MARKER_PREFIX)
      ) {
        errors.push('invalid-trace-marker');
        continue;
      }
      if (
        !Number.isInteger(event.pid) ||
        event.pid < 0 ||
        !Number.isInteger(event.tid) ||
        event.tid < 0
      ) {
        errors.push('invalid-trace-marker-thread');
        continue;
      }
      if (traceMarkerByName.has(event.name))
        errors.push('duplicate-trace-marker');
      traceMarkerByName.set(event.name, {
        tsUs: event.tsUs,
        pid: event.pid,
        tid: event.tid,
      });
    } else if (event.kind === 'gc') {
      if (
        typeof event.name !== 'string' ||
        !/^V8\.(?:GC|MinorGC)/.test(event.name) ||
        !finite(event.durationUs) ||
        event.durationUs < 0 ||
        !Number.isInteger(event.pid) ||
        event.pid < 0 ||
        !Number.isInteger(event.tid) ||
        event.tid < 0
      ) {
        errors.push('invalid-gc-event');
        continue;
      }
      gcEvents.push(event);
    } else {
      if (
        typeof event.name !== 'string' ||
        !/^V8\.(?:GC|MinorGC)/.test(event.name) ||
        !Number.isInteger(event.pid) ||
        event.pid < 0 ||
        !Number.isInteger(event.tid) ||
        event.tid < 0
      ) {
        errors.push('invalid-gc-instant');
        continue;
      }
      gcInstantObservations.push(event);
    }
  }

  const loadingTraceBounds = [];
  const windows = loadingWindows.map((window) => {
    const valid =
      window &&
      Number.isInteger(window.pair) &&
      (window.mode === 'cooperative' ||
        window.mode === 'geometry-cooperative') &&
      typeof window.markerName === 'string' &&
      finite(window.startMs) &&
      finite(window.endMs) &&
      window.endMs >= window.startMs &&
      Number.isInteger(window.overBudgetSteps) &&
      window.overBudgetSteps >= 0 &&
      Array.isArray(window.slowSteps) &&
      window.slowSteps.length <= 128 &&
      Number.isInteger(window.omittedSlowSteps) &&
      window.omittedSlowSteps >= 0 &&
      window.slowSteps.length + window.omittedSlowSteps ===
        window.overBudgetSteps;
    if (!valid) {
      errors.push('invalid-loading-window');
      return null;
    }
    const pageAnchor = anchorByName.get(window.markerName);
    const traceAnchor = traceMarkerByName.get(window.markerName);
    if (!pageAnchor || !traceAnchor || !finite(traceAnchor.tsUs)) {
      errors.push(`missing-trace-anchor:${window.markerName}`);
      return {
        pair: window.pair,
        mode: window.mode,
        aligned: false,
        overBudgetSteps: window.overBudgetSteps,
        recordedSlowSteps: window.slowSteps.length,
        omittedSlowSteps: window.omittedSlowSteps,
        anchorUncertaintyMs: pageAnchor?.uncertaintyMs ?? null,
        gcOverlappingSlowSteps: null,
        gcOverlapMs: null,
      };
    }
    const traceAnchorUs = traceAnchor.tsUs;
    const traceStartUs =
      traceAnchorUs + (window.startMs - pageAnchor.pageNowMs) * 1000;
    const traceEndUs =
      traceAnchorUs + (window.endMs - pageAnchor.pageNowMs) * 1000;
    loadingTraceBounds.push({ startUs: traceStartUs, endUs: traceEndUs });
    let overlappingGcSlices = 0;
    let gcOverlapUs = 0;
    const slowStepRows = window.slowSteps.map((step) => {
      const stepValid =
        step &&
        STAGE_NAMES.has(step.stage) &&
        typeof step.markerName === 'string' &&
        finite(step.startMs) &&
        finite(step.endMs) &&
        step.endMs >= step.startMs &&
        finite(step.durationMs) &&
        step.durationMs >= 0 &&
        Math.abs(step.durationMs - (step.endMs - step.startMs)) <= 0.001 &&
        step.startMs >= window.startMs - 1 &&
        step.endMs <= window.endMs + 1;
      if (!stepValid) {
        errors.push('invalid-slow-step-window');
        return null;
      }
      const stepAnchor =
        typeof step.markerName === 'string'
          ? anchorByName.get(step.markerName)
          : null;
      const stepTraceAnchorUs =
        typeof step.markerName === 'string'
          ? traceMarkerByName.get(step.markerName)?.tsUs
          : null;
      const stepTraceAnchor =
        typeof step.markerName === 'string'
          ? traceMarkerByName.get(step.markerName)
          : null;
      if (!stepAnchor || !finite(stepTraceAnchorUs)) {
        errors.push(`missing-step-trace-anchor:${step.markerName}`);
        return {
          stage: step.stage,
          durationMs: step.durationMs,
          markerName: step.markerName ?? null,
          aligned: false,
          overlappingGcSlices: null,
          gcOverlapMs: null,
        };
      }
      if (
        stepTraceAnchor.pid !== traceAnchor.pid ||
        stepTraceAnchor.tid !== traceAnchor.tid
      ) {
        errors.push(`step-marker-thread-mismatch:${step.markerName}`);
        return {
          stage: step.stage,
          durationMs: step.durationMs,
          markerName: step.markerName,
          aligned: false,
          overlappingGcSlices: null,
          gcOverlapMs: null,
          otherThreadGcSlices: null,
          otherThreadGcOverlapMs: null,
        };
      }
      const stepStartUs =
        stepTraceAnchorUs + (step.startMs - stepAnchor.pageNowMs) * 1000;
      const stepEndUs =
        stepTraceAnchorUs + (step.endMs - stepAnchor.pageNowMs) * 1000;
      let stepOverlapUs = 0;
      let overlappingSlices = 0;
      let otherThreadOverlapUs = 0;
      let otherThreadSlices = 0;
      const sameThreadGc = [];
      const otherThreadGc = [];
      for (const gc of gcEvents) {
        if (!overlaps(gc, stepStartUs, stepEndUs)) continue;
        if (gc.pid === stepTraceAnchor.pid && gc.tid === stepTraceAnchor.tid) {
          overlappingSlices += 1;
          sameThreadGc.push(gc);
        } else {
          otherThreadSlices += 1;
          otherThreadGc.push(gc);
        }
      }
      stepOverlapUs = unionOverlapUs(sameThreadGc, stepStartUs, stepEndUs);
      otherThreadOverlapUs = unionOverlapUs(
        otherThreadGc,
        stepStartUs,
        stepEndUs,
      );
      if (overlappingSlices > 0) overlappingGcSlices += overlappingSlices;
      gcOverlapUs += stepOverlapUs;
      return {
        stage: step.stage,
        durationMs: step.durationMs,
        markerName: step.markerName,
        aligned: true,
        overlappingGcSlices: overlappingSlices,
        gcOverlapMs: stepOverlapUs / 1000,
        otherThreadGcSlices: otherThreadSlices,
        otherThreadGcOverlapMs: otherThreadOverlapUs / 1000,
      };
    });
    const loadingGc = gcEvents.filter((gc) =>
      overlaps(gc, traceStartUs, traceEndUs),
    );
    const loadSameThreadGc = loadingGc.filter(
      (gc) => gc.pid === traceAnchor.pid && gc.tid === traceAnchor.tid,
    );
    const loadOtherThreadGc = loadingGc.filter(
      (gc) => gc.pid !== traceAnchor.pid || gc.tid !== traceAnchor.tid,
    );
    return {
      pair: window.pair,
      mode: window.mode,
      aligned: true,
      loadingWindowMs: window.endMs - window.startMs,
      anchorUncertaintyMs: pageAnchor.uncertaintyMs,
      traceProcessId: traceAnchor.pid,
      traceThreadId: traceAnchor.tid,
      overBudgetSteps: window.overBudgetSteps,
      recordedSlowSteps: window.slowSteps.length,
      omittedSlowSteps: window.omittedSlowSteps,
      v8GcSlicesOverlappingLoad: loadSameThreadGc.length,
      v8GcSlicesOtherThreadsOverlappingLoad: loadOtherThreadGc.length,
      sameThreadGcOverlapMs:
        unionOverlapUs(loadSameThreadGc, traceStartUs, traceEndUs) / 1000,
      otherThreadGcOverlapMs:
        unionOverlapUs(loadOtherThreadGc, traceStartUs, traceEndUs) / 1000,
      v8GcSlicesOverlappingSlowSteps: overlappingGcSlices,
      slowStepGcOverlapMs: gcOverlapUs / 1000,
      steps: slowStepRows,
    };
  });
  return {
    schema: IMPORT_TRACE_ATTRIBUTION_SCHEMA,
    scope:
      'Chrome trace capture spans the entire diagnostic fixture, including setup and teardown; attribution is restricted to the six measured loading windows and their slow iterator steps. Per-step overlap uses same-process/thread TimeStamp markers. Nested GC overlap uses interval union. Instant GC events are retained only as non-duration observations and are never counted as pauses. Temporal overlap is correlational, not proof of cause; no GC slice does not exclude engine stalls, OS preemption, or untraced GC.',
    performanceAcceptanceEligible: false,
    categories: IMPORT_TRACE_CATEGORIES,
    traceEventAccounting:
      'Counts normalized markers, complete GC X slices, paired B/E GC slices, and instant observations. Unmatched/malformed GC records are omitted and make the summary incomplete.',
    traceRelevantEvents: trace.relevantCount,
    retainedTraceEvents: trace.events.length,
    omittedTraceEvents: trace.omittedCount,
    observedMarkers: [...traceMarkerByName.keys()].sort(),
    bufferUsagePeak: trace.bufferUsagePeak,
    errors,
    complete:
      errors.length === 0 &&
      windows.length > 0 &&
      trace.relevantCount === trace.events.length + trace.omittedCount &&
      trace.omittedCount === 0 &&
      !trace.stopError &&
      finite(trace.bufferUsagePeak) &&
      trace.bufferUsagePeak < 0.95 &&
      windows.every(
        (window) =>
          window?.aligned === true &&
          window.omittedSlowSteps === 0 &&
          Array.isArray(window.steps) &&
          window.steps.every((step) => step?.aligned === true),
      ),
    loadingWindows: windows,
    gcSlices: gcEvents
      .filter((event) =>
        loadingTraceBounds.some(
          (window) =>
            event.tsUs < window.endUs &&
            event.tsUs + event.durationUs > window.startUs,
        ),
      )
      .map((event) => ({
        name: event.name,
        tsUs: event.tsUs,
        durationUs: event.durationUs,
        pid: event.pid,
        tid: event.tid,
      })),
    gcInstantObservations: gcInstantObservations
      .filter((event) =>
        loadingTraceBounds.some(
          (window) =>
            event.tsUs >= window.startUs && event.tsUs <= window.endUs,
        ),
      )
      .map((event) => ({
        name: event.name,
        tsUs: event.tsUs,
        pid: event.pid,
        tid: event.tid,
      })),
  };
}
