/** Bounded loading-window summary of Chrome trace markers and V8 GC. */
export const IMPORT_TRACE_ATTRIBUTION_SCHEMA =
  'gev-import-trace-attribution/v2';
export const IMPORT_TRACE_CATEGORIES =
  'devtools.timeline,disabled-by-default-v8.gc';
// Chromium DevTools represents flow arrows with phases s/t/f. They have an id
// but no duration; retain them separately from GC slices.
// Source: https://chromium.googlesource.com/devtools/devtools-frontend/+/b88894b14f63f84c460f66cff8918b2b4d079eae/front_end/models/trace/types/TraceEvents.ts
// Explicit headroom for full-fixture diagnostics.
export const IMPORT_TRACE_EVENT_LIMIT = 8192;
export const IMPORT_TRACE_FLOW_EVENT_LIMIT = 8192;
export const MAX_IMPORT_SLOW_STEPS_PER_WINDOW = 128;

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

function boundedFlowIdentity(event) {
  const identity = {};
  let valid = false;
  let invalid = false;
  const addScalar = (target, key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[key] = value;
      valid = true;
    } else if (typeof value === 'string' && value.length <= 128) {
      target[key] = value;
      valid = true;
    } else if (value !== undefined) {
      target[`${key}Status`] = 'invalid';
      invalid = true;
    }
  };
  addScalar(identity, 'id', event.id);
  addScalar(identity, 'bindId', event.bind_id);
  if (event.id2 && typeof event.id2 === 'object' && !Array.isArray(event.id2)) {
    const id2 = {};
    addScalar(id2, 'local', event.id2.local);
    addScalar(id2, 'global', event.id2.global);
    if (
      Object.keys(event.id2).some((key) => !['local', 'global'].includes(key))
    )
      invalid = true;
    if (Object.keys(id2).length) identity.id2 = id2;
  } else if (event.id2 !== undefined) {
    identity.id2Status = 'invalid';
    invalid = true;
  }
  if (typeof event.scope === 'string' && event.scope.length <= 128)
    identity.scope = event.scope;
  else if (event.scope !== undefined) {
    identity.scopeStatus = 'invalid';
    invalid = true;
  }
  return {
    identity,
    status: invalid ? 'invalid' : valid ? 'present' : 'missing',
  };
}

const FLOW_IDENTITY_KEYS = new Set([
  'id',
  'bindId',
  'id2',
  'scope',
  'idStatus',
  'bindIdStatus',
  'id2Status',
  'scopeStatus',
]);
const FLOW_ID2_KEYS = new Set([
  'local',
  'global',
  'localStatus',
  'globalStatus',
]);
const FLOW_EVENT_KEYS = new Set([
  'kind',
  'phase',
  'name',
  'nameStatus',
  'category',
  'categoryStatus',
  'tsUs',
  'pid',
  'tid',
  'identity',
  'identityStatus',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validIdentityScalar(value) {
  return (
    (typeof value === 'string' && value.length <= 128) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function validIdentityObject(identity) {
  if (
    !plainObject(identity) ||
    Object.keys(identity).some((key) => !FLOW_IDENTITY_KEYS.has(key))
  )
    return false;
  for (const key of ['id', 'bindId']) {
    if (Object.hasOwn(identity, key) && !validIdentityScalar(identity[key]))
      return false;
  }
  if (
    Object.hasOwn(identity, 'scope') &&
    (typeof identity.scope !== 'string' || identity.scope.length > 128)
  )
    return false;
  for (const key of ['idStatus', 'bindIdStatus', 'id2Status', 'scopeStatus']) {
    if (Object.hasOwn(identity, key) && identity[key] !== 'invalid')
      return false;
  }
  if (Object.hasOwn(identity, 'id2')) {
    const id2 = identity.id2;
    if (
      !plainObject(id2) ||
      Object.keys(id2).some((key) => !FLOW_ID2_KEYS.has(key)) ||
      ['local', 'global'].some(
        (key) => Object.hasOwn(id2, key) && !validIdentityScalar(id2[key]),
      ) ||
      ['localStatus', 'globalStatus'].some(
        (key) => Object.hasOwn(id2, key) && id2[key] !== 'invalid',
      ) ||
      Object.keys(id2).some((key) => key.endsWith('Status'))
    )
      return false;
  }
  const hasValue =
    ['id', 'bindId'].some((key) => Object.hasOwn(identity, key)) ||
    (identity.id2 &&
      ['local', 'global'].some((key) => Object.hasOwn(identity.id2, key)));
  const hasInvalidField = Object.keys(identity).some((key) =>
    key.endsWith('Status'),
  );
  if (hasInvalidField) return false;
  return hasValue;
}

export function isValidImportTraceFlowEvent(event) {
  return (
    plainObject(event) &&
    Object.keys(event).every((key) => FLOW_EVENT_KEYS.has(key)) &&
    event.kind === 'gc-flow' &&
    ['s', 't', 'f'].includes(event.phase) &&
    typeof event.name === 'string' &&
    event.nameStatus === 'valid' &&
    event.name.length <= 128 &&
    /^V8\.(?:GC|MinorGC)/.test(event.name) &&
    typeof event.category === 'string' &&
    event.categoryStatus === 'valid' &&
    event.category.length <= 128 &&
    event.category.split(',').some((category) => category.includes('v8.gc')) &&
    finite(event.tsUs) &&
    event.tsUs >= 0 &&
    Number.isInteger(event.pid) &&
    event.pid >= 0 &&
    Number.isInteger(event.tid) &&
    event.tid >= 0 &&
    event.identityStatus === 'present' &&
    validIdentityObject(event.identity)
  );
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

function summarizeFlowSequences(flowEvents) {
  const sequences = new Map();
  for (const event of flowEvents) {
    if (event.identityStatus !== 'present') continue;
    const key = `${event.pid}\u0000${event.category}\u0000${event.name}\u0000${JSON.stringify(event.identity)}`;
    const records = sequences.get(key) || [];
    records.push(event);
    sequences.set(key, records);
  }
  let unmatchedStarts = 0;
  let unmatchedSteps = 0;
  let unmatchedEnds = 0;
  for (const records of sequences.values()) {
    records.sort((left, right) => left.tsUs - right.tsUs);
    let openStarts = 0;
    for (const event of records) {
      if (event.phase === 's') openStarts += 1;
      else if (event.phase === 't') {
        if (openStarts === 0) unmatchedSteps += 1;
      } else if (event.phase === 'f') {
        if (openStarts === 0) unmatchedEnds += 1;
        else openStarts -= 1;
      }
    }
    unmatchedStarts += openStarts;
  }
  return {
    unmatchedStarts,
    unmatchedSteps,
    unmatchedEnds,
    crossProcessLinksNotReconstructed: true,
  };
}

/**
 * Retain bounded markers, V8 GC duration events, and non-duration GC markers.
 * B/E pairs are joined across dataCollected chunks. No trace args, URLs, source
 * payloads, or unrelated event records are returned.
 */
export function createImportTraceEventCollector(
  maxEvents = IMPORT_TRACE_EVENT_LIMIT,
  maxFlowEvents = IMPORT_TRACE_FLOW_EVENT_LIMIT,
) {
  if (
    !Number.isInteger(maxEvents) ||
    maxEvents < 1 ||
    !Number.isInteger(maxFlowEvents) ||
    maxFlowEvents < 1 ||
    maxFlowEvents > IMPORT_TRACE_FLOW_EVENT_LIMIT
  )
    throw new TypeError('Invalid trace event input');
  const retained = [];
  const pendingBegins = new Map();
  let relevantCount = 0;
  let omittedCount = 0;
  let pendingCount = 0;
  const flowPhaseCounts = { s: 0, t: 0, f: 0 };
  const flowEvents = [];
  let flowOmittedCount = 0;
  let invalidFlowIdentityCount = 0;
  let invalidFlowRecordCount = 0;
  let finished = false;
  const omissionReasons = {};
  const noteOmission = (reason) => {
    omittedCount += 1;
    omissionReasons[reason] = (omissionReasons[reason] || 0) + 1;
  };
  const retain = (event) => {
    relevantCount += 1;
    if (retained.length + pendingCount < maxEvents) retained.push(event);
    else noteOmission('event-limit');
  };
  const omit = (reason) => {
    relevantCount += 1;
    noteOmission(reason);
  };
  const retainFlow = (event) => {
    relevantCount += 1;
    flowPhaseCounts[event.ph] += 1;
    if (flowEvents.length >= maxFlowEvents) {
      flowOmittedCount += 1;
      omissionReasons.flowEventLimit =
        (omissionReasons.flowEventLimit || 0) + 1;
      return;
    }
    const { identity, status } = boundedFlowIdentity(event);
    const nameValid = event.name.length <= 128;
    const categoryValid = event.cat.length <= 128;
    if (status !== 'present') invalidFlowIdentityCount += 1;
    if (!nameValid || !categoryValid) invalidFlowRecordCount += 1;
    flowEvents.push({
      kind: 'gc-flow',
      phase: event.ph,
      name: event.name.slice(0, 128),
      nameStatus: nameValid ? 'valid' : 'invalid',
      category: event.cat.slice(0, 128),
      categoryStatus: categoryValid ? 'valid' : 'invalid',
      tsUs: event.ts,
      pid: event.pid,
      tid: event.tid,
      identity,
      identityStatus: status,
    });
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
          if (!validBase) omit('invalid-marker-clock-or-thread');
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
          omit('invalid-gc-clock-or-thread');
          continue;
        }
        if (event.ph === 's' || event.ph === 't' || event.ph === 'f') {
          // Chromium flow edges are retained as observations, never durations.
          retainFlow(event);
          continue;
        }
        if (event.ph === 'X') {
          if (!finite(event.dur) || event.dur < 0) omit('invalid-gc-duration');
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
            omit('event-limit');
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
            omit('unmatched-gc-end');
            continue;
          }
          begins.pop();
          pendingCount -= 1;
          if (begins.length === 0) pendingBegins.delete(key);
          if (event.ts < begin.tsUs) {
            omit('reversed-gc-interval');
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
        // Keep only a bounded single-character phase classification, never
        // trace arguments or provider data, to explain unsupported records.
        omit(
          typeof event.ph === 'string' && /^[A-Za-z]$/.test(event.ph)
            ? `unsupported-gc-phase-${event.ph}`
            : 'invalid-gc-phase',
        );
      }
    },
    finish() {
      if (!finished) {
        finished = true;
        for (const begins of pendingBegins.values())
          for (const _begin of begins) {
            omit('unmatched-gc-begin');
            pendingCount -= 1;
          }
        pendingBegins.clear();
      }
      return {
        events: retained,
        flowEvents,
        relevantCount,
        omittedCount,
        flowEventCount:
          flowPhaseCounts.s + flowPhaseCounts.t + flowPhaseCounts.f,
        flowPhaseCounts: { ...flowPhaseCounts },
        flowOmittedCount,
        invalidFlowIdentityCount,
        invalidFlowRecordCount,
        omissionReasons: { ...omissionReasons },
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
  preparation = null,
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
  if (
    anchors.length > 6 * (MAX_IMPORT_SLOW_STEPS_PER_WINDOW + 1) ||
    loadingWindows.length > 6
  )
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
  const flowEvents = Array.isArray(trace.flowEvents) ? trace.flowEvents : [];
  if (!Array.isArray(trace.flowEvents)) errors.push('missing-flow-records');
  const invalidFlowRecords = flowEvents.filter(
    (event) => !isValidImportTraceFlowEvent(event),
  ).length;
  if (invalidFlowRecords) errors.push('invalid-flow-event');
  const flowCounts = trace.flowPhaseCounts;
  const flowOmitted = trace.flowOmittedCount;
  const invalidIdentityCount = trace.invalidFlowIdentityCount;
  const invalidRecordCount = trace.invalidFlowRecordCount;
  const flowAccountingComplete =
    Array.isArray(trace.flowEvents) &&
    Number.isInteger(trace.flowEventCount) &&
    Number.isInteger(flowOmitted) &&
    flowOmitted >= 0 &&
    trace.flowEventCount === flowEvents.length + flowOmitted &&
    flowCounts &&
    ['s', 't', 'f'].every(
      (phase) => Number.isInteger(flowCounts[phase]) && flowCounts[phase] >= 0,
    ) &&
    flowCounts.s + flowCounts.t + flowCounts.f === trace.flowEventCount &&
    (flowOmitted > 0 ||
      ['s', 't', 'f'].every(
        (phase) =>
          flowCounts[phase] ===
          flowEvents.filter((event) => event.phase === phase).length,
      )) &&
    Number.isInteger(invalidIdentityCount) &&
    invalidIdentityCount ===
      flowEvents.filter((event) => event.identityStatus !== 'present').length &&
    invalidIdentityCount === 0 &&
    Number.isInteger(invalidRecordCount) &&
    invalidRecordCount ===
      flowEvents.filter(
        (event) =>
          event.nameStatus !== 'valid' || event.categoryStatus !== 'valid',
      ).length &&
    invalidRecordCount === 0 &&
    flowOmitted === 0 &&
    invalidFlowRecords === 0;
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
      window.slowSteps.length <= MAX_IMPORT_SLOW_STEPS_PER_WINDOW &&
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
    preparation:
      preparation &&
      typeof preparation.name === 'string' &&
      preparation.name === `${MARKER_PREFIX}preparation` &&
      finite(preparation.callDurationMs) &&
      preparation.callDurationMs >= 0 &&
      finite(preparation.uncertaintyMs) &&
      preparation.uncertaintyMs >= 0 &&
      finite(preparation.pageNowMs) &&
      preparation.pageNowMs >= 0
        ? {
            name: preparation.name,
            callDurationMs: preparation.callDurationMs,
            uncertaintyMs: preparation.uncertaintyMs,
          }
        : null,
    traceEventAccounting:
      'Counts markers, complete GC X/B-E intervals, instant observations, and retained s/t/f GC flow observations separately. Flow phases are links, not durations. Their bounded records and unmatched phase counts are reported without inferring causal completion. Unsupported or omitted duration/flow observations fail completeness.',
    traceRelevantEvents: trace.relevantCount,
    retainedTraceEvents: trace.events.length,
    flowEventCount: trace.flowEventCount ?? 0,
    retainedFlowEvents: flowEvents.length,
    flowEvents,
    invalidFlowRecords,
    flowOmittedCount: trace.flowOmittedCount ?? null,
    invalidFlowIdentityCount: trace.invalidFlowIdentityCount ?? null,
    invalidFlowRecordCount: trace.invalidFlowRecordCount ?? null,
    flowPhaseCounts: trace.flowPhaseCounts ?? { s: 0, t: 0, f: 0 },
    unmatchedFlow: summarizeFlowSequences(flowEvents),
    omittedTraceEvents: trace.omittedCount,
    traceOmissionReasons: trace.omissionReasons ?? null,
    observedMarkers: [...traceMarkerByName.keys()].sort(),
    bufferUsagePeak: trace.bufferUsagePeak,
    errors,
    complete:
      errors.length === 0 &&
      windows.length > 0 &&
      trace.relevantCount ===
        trace.events.length +
          flowEvents.length +
          trace.omittedCount +
          (trace.flowOmittedCount ?? 0) &&
      trace.flowEventCount ===
        flowEvents.length + (trace.flowOmittedCount ?? 0) &&
      trace.flowPhaseCounts &&
      ['s', 't', 'f'].every(
        (phase) =>
          Number.isInteger(trace.flowPhaseCounts[phase]) &&
          trace.flowPhaseCounts[phase] >= 0,
      ) &&
      trace.flowPhaseCounts.s +
        trace.flowPhaseCounts.t +
        trace.flowPhaseCounts.f ===
        trace.flowEventCount &&
      invalidFlowRecords === 0 &&
      flowAccountingComplete &&
      trace.invalidFlowIdentityCount === 0 &&
      trace.invalidFlowRecordCount === 0 &&
      trace.flowOmittedCount === 0 &&
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
