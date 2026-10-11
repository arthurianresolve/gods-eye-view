import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMPORT_TRACE_ATTRIBUTION_SCHEMA,
  IMPORT_TRACE_EVENT_LIMIT,
  MAX_IMPORT_SLOW_STEPS_PER_WINDOW,
  createImportTraceEventCollector,
  retainImportTraceEvents,
  summarizeImportTraceAttribution,
} from './importTraceAttribution.mjs';

const anchor = 'gev-import-step:sample:0:cooperative';
test('fixture-exported slow-step bound rejects an oversized loading window', () => {
  const count = MAX_IMPORT_SLOW_STEPS_PER_WINDOW + 1;
  const summary = summarizeImportTraceAttribution({
    trace: {
      events: [],
      relevantCount: 0,
      omittedCount: 0,
      bufferUsagePeak: 0,
    },
    anchors: [],
    loadingWindows: [
      {
        pair: 0,
        mode: 'cooperative',
        markerName: anchor,
        startMs: 0,
        endMs: 1000,
        overBudgetSteps: count,
        omittedSlowSteps: 0,
        slowSteps: Array(count).fill({}),
      },
    ],
  });
  assert.equal(summary.complete, false);
  assert.ok(summary.errors.includes('invalid-loading-window'));
});
const stepAnchor = 'gev-import-step:step:sample:0:cooperative:entity:1';
const window = {
  pair: 0,
  mode: 'cooperative',
  markerName: anchor,
  startMs: 50,
  endMs: 80,
  overBudgetSteps: 2,
  omittedSlowSteps: 0,
  slowSteps: [
    {
      stage: 'entity',
      startMs: 52,
      endMs: 60,
      durationMs: 8,
      markerName: stepAnchor,
    },
    {
      stage: 'entity',
      startMs: 62,
      endMs: 66,
      durationMs: 4,
      markerName: 'gev-import-step:step:sample:0:cooperative:entity:2',
    },
  ],
};

test('aligns timed iterator steps with same-thread V8 GC slices', () => {
  const trace = retainImportTraceEvents([
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 100_000,
      pid: 11,
      tid: 22,
      args: { data: { message: anchor } },
    },
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 110_000,
      pid: 11,
      tid: 22,
      args: { data: { message: stepAnchor } },
    },
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 116_000,
      pid: 11,
      tid: 22,
      args: {
        data: {
          message: 'gev-import-step:step:sample:0:cooperative:entity:2',
        },
      },
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: 104_000,
      pid: 11,
      tid: 22,
      dur: 4_000,
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: 105_000,
      pid: 11,
      tid: 22,
      dur: 2_000,
    },
    {
      name: 'V8.GCFinalizeMC',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: 120_000,
      pid: 11,
      tid: 22,
      dur: 4_000,
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: 103_000,
      pid: 33,
      tid: 44,
      dur: 5_000,
    },
    { name: 'FunctionCall', cat: 'devtools.timeline', ts: 105_000, dur: 9000 },
  ]);
  const result = summarizeImportTraceAttribution({
    trace: { ...trace, bufferUsagePeak: 0.2 },
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepAnchor, pageNowMs: 60, uncertaintyMs: 0.05 },
      {
        name: 'gev-import-step:step:sample:0:cooperative:entity:2',
        pageNowMs: 66,
        uncertaintyMs: 0.05,
      },
    ],
    loadingWindows: [window],
  });
  assert.equal(result.schema, IMPORT_TRACE_ATTRIBUTION_SCHEMA);
  assert.equal(result.complete, true);
  assert.equal(result.loadingWindows[0].aligned, true);
  assert.equal(result.loadingWindows[0].overBudgetSteps, 2);
  assert.equal(result.loadingWindows[0].v8GcSlicesOverlappingLoad, 3);
  assert.equal(
    result.loadingWindows[0].v8GcSlicesOtherThreadsOverlappingLoad,
    1,
  );
  assert.equal(result.loadingWindows[0].otherThreadGcOverlapMs, 5);
  assert.equal(result.loadingWindows[0].v8GcSlicesOverlappingSlowSteps, 2);
  assert.equal(result.loadingWindows[0].steps[0].gcOverlapMs, 4);
  assert.equal(result.loadingWindows[0].steps[0].otherThreadGcOverlapMs, 5);
  assert.equal(result.loadingWindows[0].steps[1].gcOverlapMs, 0);
  assert.equal(result.loadingWindows[0].steps[0].aligned, true);
  assert.equal(result.performanceAcceptanceEligible, false);
});

test('retains only bounded marker and GC timing fields, omitting trace payloads', () => {
  const events = Array.from(
    { length: IMPORT_TRACE_EVENT_LIMIT + 1 },
    (_, i) => ({
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: i * 1000,
      pid: 1,
      tid: 2,
      dur: 100,
      args: { secret: 'must not be retained' },
    }),
  );
  const retained = retainImportTraceEvents(events);
  assert.equal(retained.events.length, IMPORT_TRACE_EVENT_LIMIT);
  assert.equal(retained.relevantCount, IMPORT_TRACE_EVENT_LIMIT + 1);
  assert.equal(retained.omittedCount, 1);
  assert.equal(Object.hasOwn(retained.events[0], 'args'), false);
});

test('accounts s/t/f as bounded non-duration flow counters, not GC pauses', () => {
  const trace = retainImportTraceEvents([
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ph: 'I',
      ts: 100_000,
      pid: 1,
      tid: 2,
      args: { data: { message: anchor } },
    },
    ...['s', 't', 'f'].map((ph, index) => ({
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph,
      ts: 101_000 + index * 1000,
      pid: 1,
      tid: 2,
      id: `flow-${index}`,
      args: { secret: 'not retained' },
    })),
  ]);
  assert.deepEqual(trace.flowPhaseCounts, { s: 1, t: 1, f: 1 });
  assert.equal(trace.flowEventCount, 3);
  assert.equal(trace.events.length, 1);
  assert.equal(trace.relevantCount, 4);
  assert.equal(trace.omittedCount, 0);
  assert.equal(Object.hasOwn(trace.events[0], 'args'), false);

  const summary = summarizeImportTraceAttribution({
    trace: { ...trace, bufferUsagePeak: 0.1 },
    anchors: [{ name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 }],
    loadingWindows: [
      {
        pair: 0,
        mode: 'cooperative',
        markerName: anchor,
        startMs: 50,
        endMs: 60,
        overBudgetSteps: 0,
        omittedSlowSteps: 0,
        slowSteps: [],
      },
    ],
  });
  assert.equal(summary.complete, true);
  assert.equal(summary.gcSlices.length, 0);
  assert.equal(summary.flowEventCount, 3);
  assert.deepEqual(summary.flowPhaseCounts, { s: 1, t: 1, f: 1 });
});

test('bounded retention covers the observed full-fixture mix without dropping GC intervals', () => {
  const events = [
    ...Array.from({ length: 4102 }, (_, index) => ({
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: index * 1000,
      dur: 100,
      pid: 1,
      tid: 2,
    })),
    ...Array.from({ length: 516 }, (_, index) => ({
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 's',
      ts: 5_000_000 + index * 1000,
      pid: 1,
      tid: 2,
    })),
    ...Array.from({ length: 516 }, (_, index) => ({
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'f',
      ts: 6_000_000 + index * 1000,
      pid: 1,
      tid: 2,
    })),
  ];
  const retained = retainImportTraceEvents(events);
  assert.equal(retained.events.length, 4102);
  assert.equal(retained.flowEventCount, 1032);
  assert.equal(retained.relevantCount, 5134);
  assert.equal(retained.omittedCount, 0);
  assert.equal(retained.flowPhaseCounts.s, 516);
  assert.equal(retained.flowPhaseCounts.f, 516);
});

test('records one-time timestamp preparation separately from measured anchors', () => {
  const preparation = {
    name: 'gev-import-step:preparation',
    pageNowMs: 10,
    uncertaintyMs: 5.85,
    callDurationMs: 11.7,
  };
  const trace = retainImportTraceEvents([
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 20_000,
      pid: 1,
      tid: 2,
      args: { data: { message: anchor } },
    },
  ]);
  const summary = summarizeImportTraceAttribution({
    trace: { ...trace, bufferUsagePeak: 0.1 },
    anchors: [{ name: anchor, pageNowMs: 20, uncertaintyMs: 0.1 }],
    preparation,
    loadingWindows: [
      {
        pair: 0,
        mode: 'cooperative',
        markerName: anchor,
        startMs: 20,
        endMs: 25,
        overBudgetSteps: 0,
        omittedSlowSteps: 0,
        slowSteps: [],
      },
    ],
  });
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.preparation, {
    name: preparation.name,
    callDurationMs: 11.7,
    uncertaintyMs: 5.85,
  });
  assert.equal(summary.loadingWindows[0].anchorUncertaintyMs, 0.1);
});

test('unsupported GC duration phases remain omissions and fail completeness', () => {
  const trace = retainImportTraceEvents([
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'P',
      ts: 101_000,
      pid: 1,
      tid: 2,
      dur: 1000,
    },
  ]);
  assert.equal(trace.omittedCount, 1);
  assert.equal(trace.flowEventCount, 0);
  assert.equal(trace.omissionReasons['unsupported-gc-phase-P'], 1);
  const summary = summarizeImportTraceAttribution({
    trace: { ...trace, bufferUsagePeak: 0.1 },
    anchors: [],
    loadingWindows: [],
  });
  assert.equal(summary.complete, false);
});

test('reports missing trace anchors as incomplete rather than inventing alignment', () => {
  const result = summarizeImportTraceAttribution({
    trace: {
      events: [],
      relevantCount: 0,
      omittedCount: 0,
      bufferUsagePeak: 0.1,
    },
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepAnchor, pageNowMs: 60, uncertaintyMs: 0.05 },
      {
        name: 'gev-import-step:step:sample:0:cooperative:entity:2',
        pageNowMs: 66,
        uncertaintyMs: 0.05,
      },
    ],
    loadingWindows: [window],
  });
  assert.equal(result.complete, false);
  assert.equal(result.loadingWindows[0].aligned, false);
  assert.equal(result.loadingWindows[0].gcOverlappingSlowSteps, null);
  assert.ok(result.errors.includes(`missing-trace-anchor:${anchor}`));
});

test('rejects malformed stages, timestamps, and unbounded intervals', () => {
  for (const mutate of [
    (bad) => (bad.loadingWindows[0].slowSteps[0].stage = 'payload'),
    (bad) => (bad.loadingWindows[0].startMs = -1),
    (bad) => (bad.loadingWindows[0].slowSteps[0].endMs = 100),
    (bad) => (bad.loadingWindows[0].slowSteps[0].durationMs = 9),
    (bad) => (bad.loadingWindows[0].overBudgetSteps += 1),
    (bad) => (bad.loadingWindows[0].omittedSlowSteps += 1),
    (bad) => (bad.trace.events[1].durationUs = -1),
  ]) {
    const input = {
      trace: {
        events: [
          { kind: 'marker', name: anchor, tsUs: 100_000, pid: 1, tid: 2 },
          {
            kind: 'gc',
            name: 'V8.GCScavenger',
            tsUs: 104_000,
            durationUs: 3000,
            pid: 1,
            tid: 2,
          },
        ],
        relevantCount: 2,
        omittedCount: 0,
        bufferUsagePeak: 0.1,
      },
      anchors: [
        { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
        { name: stepAnchor, pageNowMs: 60, uncertaintyMs: 0.05 },
        {
          name: 'gev-import-step:step:sample:0:cooperative:entity:2',
          pageNowMs: 66,
          uncertaintyMs: 0.05,
        },
      ],
      loadingWindows: [structuredClone(window)],
    };
    mutate(input);
    assert.equal(summarizeImportTraceAttribution(input).complete, false);
  }
});

test('requires a same-trace marker for every over-budget step', () => {
  const result = summarizeImportTraceAttribution({
    trace: {
      events: [{ kind: 'marker', name: anchor, tsUs: 100_000, pid: 1, tid: 2 }],
      relevantCount: 1,
      omittedCount: 0,
      bufferUsagePeak: 0.1,
    },
    anchors: [{ name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 }],
    loadingWindows: [window],
  });
  assert.equal(result.complete, false);
  assert.ok(
    result.errors.some((error) =>
      error.startsWith('missing-step-trace-anchor:'),
    ),
  );
  assert.equal(result.loadingWindows[0].steps[0].aligned, false);
});

test('marks trace stop failures incomplete and bounds attribution windows', () => {
  const input = {
    trace: {
      events: [],
      relevantCount: 0,
      omittedCount: 0,
      bufferUsagePeak: 0.1,
      stopError: 'trace completion timeout',
    },
    anchors: [],
    loadingWindows: [],
  };
  assert.equal(summarizeImportTraceAttribution(input).complete, false);
  assert.throws(
    () =>
      summarizeImportTraceAttribution({
        ...input,
        anchors: Array.from({ length: 775 }, (_, index) => ({
          name: `gev-import-step:${index}`,
          pageNowMs: index,
          uncertaintyMs: 0,
        })),
      }),
    RangeError,
  );
});

test('marks unsupported incomplete GC events instead of assuming zero duration', () => {
  const stepMarker = window.slowSteps[0].markerName;
  const events = [
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 100_000,
      pid: 1,
      tid: 2,
      args: { data: { message: anchor } },
    },
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ts: 110_000,
      pid: 1,
      tid: 2,
      args: { data: { message: stepMarker } },
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'B',
      ts: 104_000,
      pid: 1,
      tid: 2,
    },
    {
      name: 'V8.GCFinalizeMC',
      cat: 'disabled-by-default-v8.gc',
      ph: 'X',
      ts: 105_000,
      pid: 1,
      tid: 2,
    },
  ];
  const retained = retainImportTraceEvents(events);
  const result = summarizeImportTraceAttribution({
    trace: { ...retained, bufferUsagePeak: 0.1 },
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepMarker, pageNowMs: 60, uncertaintyMs: 0.05 },
    ],
    loadingWindows: [
      {
        ...window,
        overBudgetSteps: 1,
        slowSteps: [window.slowSteps[0]],
      },
    ],
  });
  assert.equal(retained.omittedCount, 2);
  assert.equal(retained.relevantCount, 4);
  assert.equal(result.complete, false);
  assert.equal(result.omittedTraceEvents, 2);
});

test('pairs begin/end GC slices across streamed trace chunks', () => {
  const collector = createImportTraceEventCollector(8);
  collector.add([
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'B',
      ts: 104_000,
      pid: 1,
      tid: 2,
    },
  ]);
  collector.add([
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'E',
      ts: 109_000,
      pid: 1,
      tid: 2,
    },
  ]);
  const result = collector.finish();
  assert.deepEqual(result.events, [
    {
      kind: 'gc',
      name: 'V8.GCScavenger',
      tsUs: 104_000,
      durationUs: 5_000,
      pid: 1,
      tid: 2,
    },
  ]);
  assert.equal(result.relevantCount, 1);
  assert.equal(result.omittedCount, 0);
});

test('releases malformed reversed B/E state without corrupting the next pair', () => {
  const retained = retainImportTraceEvents([
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'B',
      ts: 10_000,
      pid: 1,
      tid: 2,
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'E',
      ts: 9_000,
      pid: 1,
      tid: 2,
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'B',
      ts: 11_000,
      pid: 1,
      tid: 2,
    },
    {
      name: 'V8.GCScavenger',
      cat: 'disabled-by-default-v8.gc',
      ph: 'E',
      ts: 13_000,
      pid: 1,
      tid: 2,
    },
  ]);
  assert.equal(retained.relevantCount, 2);
  assert.equal(retained.omittedCount, 1);
  assert.deepEqual(retained.events, [
    {
      kind: 'gc',
      name: 'V8.GCScavenger',
      tsUs: 11_000,
      durationUs: 2_000,
      pid: 1,
      tid: 2,
    },
  ]);
});

test('retains instant GC observations without treating them as pauses', () => {
  const retained = retainImportTraceEvents([
    {
      name: 'V8.GCCompactor',
      cat: 'disabled-by-default-v8.gc',
      ph: 'I',
      ts: 104_000,
      pid: 1,
      tid: 2,
    },
  ]);
  const result = summarizeImportTraceAttribution({
    trace: { ...retained, bufferUsagePeak: 0.1 },
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepAnchor, pageNowMs: 60, uncertaintyMs: 0.05 },
    ],
    loadingWindows: [
      {
        ...window,
        overBudgetSteps: 1,
        slowSteps: [window.slowSteps[0]],
      },
    ],
  });
  assert.equal(result.complete, false, 'fixture markers are absent');
  assert.equal(result.gcSlices.length, 0);
  assert.deepEqual(result.gcInstantObservations, []);
  const valid = summarizeImportTraceAttribution({
    trace: {
      events: [
        { kind: 'marker', name: anchor, tsUs: 100_000, pid: 1, tid: 2 },
        { kind: 'marker', name: stepAnchor, tsUs: 110_000, pid: 1, tid: 2 },
        ...retained.events,
      ],
      relevantCount: 3,
      omittedCount: 0,
      bufferUsagePeak: 0.1,
    },
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepAnchor, pageNowMs: 60, uncertaintyMs: 0.05 },
    ],
    loadingWindows: [
      {
        ...window,
        overBudgetSteps: 1,
        slowSteps: [window.slowSteps[0]],
      },
    ],
  });
  assert.equal(valid.complete, true);
  assert.equal(valid.gcSlices.length, 0);
  assert.equal(valid.gcInstantObservations.length, 1);
  assert.equal(valid.loadingWindows[0].v8GcSlicesOverlappingSlowSteps, 0);
});

test('does not attribute GC from a different trace thread to the loading step', () => {
  const stepMarker = window.slowSteps[0].markerName;
  const trace = {
    events: [
      { kind: 'marker', name: anchor, tsUs: 100_000, pid: 1, tid: 2 },
      { kind: 'marker', name: stepMarker, tsUs: 110_000, pid: 1, tid: 3 },
      {
        kind: 'gc',
        name: 'V8.GCScavenger',
        tsUs: 104_000,
        durationUs: 4_000,
        pid: 1,
        tid: 2,
      },
    ],
    relevantCount: 3,
    omittedCount: 0,
    bufferUsagePeak: 0.1,
  };
  const result = summarizeImportTraceAttribution({
    trace,
    anchors: [
      { name: anchor, pageNowMs: 50, uncertaintyMs: 0.05 },
      { name: stepMarker, pageNowMs: 60, uncertaintyMs: 0.05 },
    ],
    loadingWindows: [
      {
        ...window,
        overBudgetSteps: 1,
        slowSteps: [window.slowSteps[0]],
      },
    ],
  });
  assert.equal(result.complete, false);
  assert.ok(
    result.errors.includes(`step-marker-thread-mismatch:${stepMarker}`),
  );
  assert.equal(result.loadingWindows[0].steps[0].aligned, false);
});
