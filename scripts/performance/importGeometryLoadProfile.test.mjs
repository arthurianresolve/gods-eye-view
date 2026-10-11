import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createImportGeometryPhaseRecorder,
  summarizeGeometryGcOverlap,
  summarizeGeometryLoadProfile,
  validateImportGeometryLoadProfileReport,
} from './importGeometryLoadProfile.mjs';
import { summarizeCpuProfile } from './sampledCpuProfile.mjs';
import { startImportLoadProfile } from './importLoadProfile.mjs';
import {
  captureImportTraceAnchor,
  captureImportPerformanceMarkAnchor,
  createImportTraceEventCollector,
  summarizeImportTraceAttribution,
} from './importTraceAttribution.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const geometryHash =
  '74fccdb194475b32c4b93fead20e5cb7a92f313243a1a1bd0795c7c733de963f';
const hashJson = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashNames = [
  'runtimeLayerSha256',
  'cooperativeSha256',
  'fixtureSha256',
  'fixtureHtmlSha256',
  'viteEntryConfigSha256',
  'viteConfigSha256',
  'runnerSha256',
  'profileHelperSha256',
  'cpuHeapHelperSha256',
  'traceHelperSha256',
  'traceSummarySha256',
  'sampledCpuProfileSha256',
  'rendererEvidenceSha256',
  'pageOwnershipSha256',
  'sourceProvenanceSha256',
  'packageLockSha256',
  'cesiumEntrySha256',
  'cesiumSceneSha256',
];
const anchor = {
  name: 'gev-import-step:geometry-profile:LineString',
  pageNowMs: 100,
  uncertaintyMs: 0.1,
};
test('trace calibration records one complete bracket without retrying slow markers', () => {
  for (const duration of [0.1, 24.6]) {
    const calls = [];
    let nowMs = 100;
    const value = captureImportTraceAnchor(anchor.name, {
      now: () => {
        calls.push('now');
        return nowMs;
      },
      emit: (name) => {
        calls.push(name);
        nowMs += duration;
      },
    });
    assert.deepEqual(calls, ['now', anchor.name, 'now']);
    assert.equal(value.pageNowMs, (100 + nowMs) / 2);
    assert.equal(value.uncertaintyMs, nowMs - 100);
    if (duration > 2)
      assert.throws(
        () =>
          summarizeGeometryGcOverlap({
            trace: { events: [] },
            anchor: value,
            startMs: 200,
            endMs: 220,
          }),
        /Invalid geometry trace attribution input/,
      );
  }
  for (const end of [99, NaN, Infinity]) {
    const clock = [100, end];
    assert.throws(
      () =>
        captureImportTraceAnchor(anchor.name, {
          now: () => clock.shift(),
          emit: () => {},
        }),
      /monotonic clock/,
    );
  }
});
const traceInput = {
  events: [
    { kind: 'marker', name: anchor.name, tsUs: 500_000, pid: 1, tid: 2 },
  ],
  flowEvents: [],
  relevantCount: 1,
  omittedCount: 0,
  flowEventCount: 0,
  flowOmittedCount: 0,
  invalidFlowIdentityCount: 0,
  invalidFlowRecordCount: 0,
  flowPhaseCounts: { s: 0, t: 0, f: 0 },
  omissionReasons: {},
  bufferUsagePeak: 0.1,
  bufferUsageCount: 1,
  bufferUsageStatus: 'observed',
  completionObserved: true,
  dataLossOccurred: false,
  stopError: null,
};
test('explicit-start trace marks retain engine timestamp witnesses despite slow delivery', () => {
  const calls = [];
  let clockMs = 100;
  const clock = {
    now: () => clockMs,
    mark(name, options) {
      calls.push(['mark', name, options]);
      clockMs += 24.6;
      return { name, startTime: options.startTime, entryType: 'mark' };
    },
    clearMarks(name) {
      calls.push(['clear', name]);
    },
  };
  const value = captureImportPerformanceMarkAnchor(anchor.name, clock);
  assert.equal(value.pageNowMs, 100);
  assert.equal(value.uncertaintyMs, 0.001);
  assert.equal(value.callElapsedMs, clockMs - 100);
  assert.deepEqual(calls, [
    ['mark', anchor.name, { startTime: 100 }],
    ['clear', anchor.name],
  ]);
  const collector = createImportTraceEventCollector();
  collector.add([
    {
      cat: 'blink.user_timing',
      name: anchor.name,
      ph: 'I',
      ts: 500000,
      pid: 1,
      tid: 2,
      args: { data: { startTime: 100, detail: 'not retained' } },
    },
  ]);
  const observed = collector.finish();
  assert.deepEqual(observed.events, [
    {
      kind: 'marker',
      name: anchor.name,
      tsUs: 500000,
      pid: 1,
      tid: 2,
      markerType: 'performance-mark',
      recordedStartTimeMs: 100,
    },
  ]);
  const trace = { ...traceInput, ...observed };
  const summary = summarizeGeometryGcOverlap({
    trace,
    anchor: value,
    startMs: 200,
    endMs: 220,
  });
  assert.equal(summary.complete, true);
  for (const change of [
    { recordedStartTimeMs: 101 },
    { markerType: 'console' },
  ]) {
    const invalid = { ...trace, events: [{ ...trace.events[0], ...change }] };
    assert.equal(
      summarizeGeometryGcOverlap({
        trace: invalid,
        anchor: value,
        startMs: 200,
        endMs: 220,
      }).complete,
      false,
    );
  }
  for (const entry of [
    null,
    { name: anchor.name, entryType: 'mark', startTime: 99 },
  ]) {
    let cleared = false;
    assert.throws(
      () =>
        captureImportPerformanceMarkAnchor(anchor.name, {
          now: () => 100,
          mark: () => entry,
          clearMarks: () => {
            cleared = true;
          },
        }),
      /explicit start time/,
    );
    assert.equal(cleared, true);
  }
  const invalid = createImportTraceEventCollector();
  invalid.add([
    {
      cat: 'blink.user_timing',
      name: anchor.name,
      ph: 'I',
      ts: 500000,
      pid: 1,
      tid: 2,
      args: {},
    },
  ]);
  assert.equal(invalid.finish().omittedCount, 1);
});
const loadStartedAtMs = 200;
const loadCompletedAtMs = 220;
const rawCpu = {
  startTime: 1_000,
  endTime: 4_000,
  nodes: [
    {
      id: 1,
      callFrame: {
        functionName: 'loadGeometry',
        scriptId: '1',
        url: 'http://127.0.0.1/src/imports/runtimeLayer.js',
        lineNumber: 1,
        columnNumber: 1,
      },
    },
  ],
  samples: [1, 1],
  timeDeltas: [1_000, 2_000],
};
const cpuSummary = summarizeCpuProfile(rawCpu);

test('CPU delta normalization keeps sample/timestamp pairs and original input intact', () => {
  const raw = {
    startTime: 1000,
    endTime: 1040,
    nodes: [1, 2, 3].map((id) => ({
      id,
      callFrame: {
        functionName: `sample${id}`,
        url: '',
        lineNumber: 0,
        columnNumber: 0,
      },
    })),
    samples: [1, 2, 3],
    timeDeltas: [20, -10, 20],
  };
  const original = structuredClone(raw);
  const summary = summarizeCpuProfile(raw);
  assert.deepEqual(raw, original);
  assert.deepEqual(summary.profile.samples, raw.samples);
  assert.deepEqual(summary.profile.timeDeltas, raw.timeDeltas);
  assert.equal(summary.sampleOrdering.negativeDeltaCount, 1);
  assert.equal(summary.sampleOrdering.reorderedSamples, 2);
  assert.equal(summary.sampleOrdering.unattributedTailUs, 10);
  assert.equal(summary.totalSampleWeightMs, 0.03);
  assert.deepEqual(
    summary.topLocations.map((row) => [row.functionName, row.sampledWeightMs]),
    [
      ['sample2', 0.01],
      ['sample1', 0.01],
      ['sample3', 0.01],
    ],
  );
  assert.deepEqual(summarizeCpuProfile(summary.profile), summary);
  for (const timeDeltas of [
    [-1, 2, 3],
    [20, -21, 5],
    [41, -2, 1],
    [20, NaN, 1],
  ]) {
    assert.throws(
      () => summarizeCpuProfile({ ...raw, timeDeltas }),
      /Invalid CPU profile/,
    );
  }
});

test('invalid CPU samples retain bounded cause evidence after owned session cleanup', async () => {
  for (const [sampleId, weight, reason] of [
    [99, 1000, 'unknown-node'],
    [1, -3, 'out-of-window-timestamp'],
    [1, NaN, 'nonfinite-weight'],
  ]) {
    const calls = [];
    const profile = { ...rawCpu, samples: [sampleId], timeDeltas: [weight] };
    const session = {
      async send(method) {
        calls.push(method);
        return method === 'Profiler.stop' ? { profile } : {};
      },
      async detach() {
        calls.push('detach');
      },
    };
    const owned = await startImportLoadProfile(
      {
        async createCDPSession() {
          return session;
        },
      },
      'cpu',
    );
    await assert.rejects(owned.stop(), (error) => {
      assert.equal(error.profileFailureEvidence.reason, reason);
      assert.equal(error.profileFailureEvidence.index, 0);
      assert.equal(error.profileFailureEvidence.sampleCount, 1);
      assert.equal(error.profileFailureEvidence.knownNode, sampleId === 1);
      assert.equal(
        error.profileFailureEvidence.weightUs,
        Number.isFinite(weight) ? weight : null,
      );
      assert.equal(
        error.profileFailureEvidence.performanceAcceptanceEligible,
        false,
      );
      assert.equal(
        JSON.stringify(error.profileFailureEvidence).includes('runtimeLayer'),
        false,
      );
      return true;
    });
    assert.deepEqual(calls.slice(-3), [
      'Profiler.stop',
      'Profiler.disable',
      'detach',
    ]);
    assert.equal(calls.filter((call) => call === 'Profiler.stop').length, 1);
  }
});
const traceSummary = summarizeGeometryGcOverlap({
  trace: traceInput,
  anchor,
  startMs: loadStartedAtMs,
  endMs: loadCompletedAtMs,
});

function validReport() {
  const phases = Object.fromEntries(
    [
      'record-selection',
      'coordinate-conversion',
      'entity-publication',
      'evidence-envelope',
      'context-registration',
      'overlay-publication',
      'render-request',
      'clear',
    ].map((name) => [
      name,
      {
        count: name === 'coordinate-conversion' ? 2 : 0,
        totalMs: 1,
        maxMs: 1,
        over4Ms: 0,
      },
    ]),
  );
  const retainedTraceInput = structuredClone(traceInput);
  return {
    schema: 'gev-import-geometry-load-profile/v1',
    status: 'passed',
    mode: 'cpu',
    arm: 'whole-feature-timer',
    geometryType: 'LineString',
    source: {
      applicationCommit: commit,
      harnessCommit: commit,
      sourceDirtyAtStart: false,
      harnessDirtyAtStart: false,
      sourceChangedDuringRun: false,
      harnessChangedDuringRun: false,
      hashes: Object.fromEntries(hashNames.map((name) => [name, hash])),
      hashesAtFinish: Object.fromEntries(hashNames.map((name) => [name, hash])),
    },
    fixture: {
      applicationCommit: commit,
      harnessCommit: commit,
      runtimeLayerSha256: hash,
      fixtureSha256: hash,
      runnerSha256: hash,
      packageLockSha256: hash,
      cesiumEngineSha256: hash,
      profileHelperSha256: hash,
      cpuHeapHelperSha256: hash,
      traceHelperSha256: hash,
      traceSummarySha256: hash,
      sampledCpuProfileSha256: hash,
      rendererEvidenceSha256: hash,
      pageOwnershipSha256: hash,
      sourceProvenanceSha256: hash,
      geometry: 's59-50k-line-polygon/v1',
      profileWindow: 'actual-load-async-call-and-runtime-phase-observers',
      captureAfterProfileStop: true,
      positionCount: 50_000,
      geometrySha256: geometryHash,
      profileStartedAtMs: 190,
      loadStartedAtMs,
      loadCompletedAtMs,
      profileStoppedAtMs: 230,
      loadElapsedMs: loadCompletedAtMs - loadStartedAtMs,
      anchor,
      geometryPhaseSummary: {
        schema: 'gev-import-geometry-phase-summary/v1',
        eventCount: 2,
        invalidCount: 0,
        phases,
      },
    },
    sample: {
      entityId: 'sample-entity',
      positionCount: 50_000,
      geometrySha256: geometryHash,
      capture: { completed: true, pixelSha256: hash },
      readiness: { pickedEntityId: 'sample-entity' },
      cleanup: { featureCount: 0, pendingJobs: 0, schedulerPendingCount: 0 },
    },
    profile: {
      mode: 'cpu',
      performanceAcceptanceEligible: false,
      ...cpuSummary,
      topLocations: structuredClone(cpuSummary.topLocations),
      profile: structuredClone(cpuSummary.profile),
      rawInputSha256: hashJson(cpuSummary.profile),
      profileWindowMs: 3,
      trace: traceSummary,
      traceInput: retainedTraceInput,
      traceInputSha256: hashJson(retainedTraceInput),
    },
    environment: {
      host: { hosted: true, logicalCpus: 4 },
      scene: { renderer: 'NVIDIA GeForce RTX', contextLost: false },
      graphics: { featureStatus: { webgl: 'enabled' } },
      rendererClassification: { kind: 'native-gpu' },
    },
    pageCleanup: { closeCompleted: true, openPageCount: 0 },
    browserCleanup: {
      closeCompleted: true,
      forcedProcessTermination: false,
    },
    serverCleanup: { confirmed: true, reason: 'exit-observed' },
  };
}

test('phase recorder keeps fixed-size aggregates and rejects malformed events', () => {
  const recorder = createImportGeometryPhaseRecorder();
  recorder.record({ phase: 'coordinate-conversion', durationMs: 5 });
  recorder.record({ phase: 'coordinate-conversion', durationMs: 1 });
  recorder.record({ phase: 'unknown', durationMs: 2 });
  recorder.record({ phase: 'render-request', durationMs: -1 });
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.eventCount, 4);
  assert.equal(snapshot.invalidCount, 2);
  assert.deepEqual(snapshot.phases['coordinate-conversion'], {
    count: 2,
    totalMs: 6,
    maxMs: 5,
    over4Ms: 1,
  });
  assert.equal(Object.keys(snapshot.phases).length, 8);
});

test('geometry load profile validator accepts complete diagnostic-only evidence', () => {
  const validation = validateImportGeometryLoadProfileReport(validReport(), {
    commit,
    geometrySha256: geometryHash,
  });
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('validator preserves and checks the observed page build identities', () => {
  const mismatch = validReport();
  mismatch.fixture.applicationCommit = 'c'.repeat(40);
  const validation = validateImportGeometryLoadProfileReport(mismatch, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'fixture identity, fidelity or profile separation is invalid',
    ),
  );
});

test('validator reads the pixel digest from the browser capture object', () => {
  const forged = validReport();
  delete forged.sample.capture.pixelSha256;
  forged.sample.pixelSha256 = hash;
  const validation = validateImportGeometryLoadProfileReport(forged, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'post-profile fidelity or cleanup witness is invalid',
    ),
  );
});

test('validator rejects self-matched or incorrect known geometry hashes', () => {
  const mismatch = validReport();
  mismatch.sample.geometrySha256 = 'c'.repeat(64);
  const validation = validateImportGeometryLoadProfileReport(mismatch, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'independent fixture geometry identity does not match',
    ),
  );
});

test('validator recomputes retained raw profiles and trace and requires clean natural close', () => {
  const profileMismatch = validReport();
  profileMismatch.profile.profile.samples[0] = 999;
  profileMismatch.profile.rawInputSha256 = hashJson(
    profileMismatch.profile.profile,
  );
  assert.equal(
    validateImportGeometryLoadProfileReport(profileMismatch, {
      commit,
      geometrySha256: geometryHash,
    }).valid,
    false,
  );

  const cleanupMismatch = validReport();
  cleanupMismatch.browserCleanup.forcedProcessTermination = true;
  cleanupMismatch.serverCleanup.confirmed = false;
  const validation = validateImportGeometryLoadProfileReport(cleanupMismatch, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('page or resource cleanup failed'));
});

test('validator recomputes explicit trace completion and buffer availability', () => {
  const report = validReport();
  report.profile.traceInput.dataLossOccurred = true;
  report.profile.traceInputSha256 = hashJson(report.profile.traceInput);
  const validation = validateImportGeometryLoadProfileReport(report, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'GC overlap summary does not match retained trace input',
    ),
    JSON.stringify(validation.errors),
  );

  const unavailable = validReport();
  unavailable.profile.traceInput.bufferUsagePeak = null;
  unavailable.profile.traceInput.bufferUsageCount = 0;
  unavailable.profile.traceInput.bufferUsageStatus = 'unavailable';
  unavailable.profile.trace.bufferUsagePeak = null;
  unavailable.profile.trace.bufferUsageCount = 0;
  unavailable.profile.trace.bufferUsageStatus = 'unavailable';
  unavailable.profile.traceInputSha256 = hashJson(
    unavailable.profile.traceInput,
  );
  unavailable.profile.trace = summarizeGeometryGcOverlap({
    trace: unavailable.profile.traceInput,
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  const accepted = validateImportGeometryLoadProfileReport(unavailable, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
});

test('validator rejects forged ranked profile locations even with a valid raw-input hash', () => {
  const report = validReport();
  report.profile.topLocations[0].functionName = 'forged-attribution';
  const validation = validateImportGeometryLoadProfileReport(report, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'CPU ranked locations do not match retained raw input',
    ),
    JSON.stringify(validation.errors),
  );
});

test('validator rejects an unconfirmed Vite server shutdown', () => {
  const report = validReport();
  report.serverCleanup = { confirmed: false };
  const validation = validateImportGeometryLoadProfileReport(report, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('page or resource cleanup failed'));
});

test('geometry load profile validator rejects dirty sources, shortened data and capture in profile window', () => {
  const dirty = validReport();
  dirty.source.sourceDirtyAtStart = true;
  dirty.fixture.positionCount = 49_999;
  dirty.fixture.captureAfterProfileStop = false;
  const validation = validateImportGeometryLoadProfileReport(dirty, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes('source provenance is incomplete or dirty'),
  );
  assert.ok(
    validation.errors.includes(
      'fixture identity, fidelity or profile separation is invalid',
    ),
  );
});

test('geometry load profile validator rejects incomplete observer or cleanup evidence', () => {
  const incomplete = validReport();
  incomplete.fixture.geometryPhaseSummary.invalidCount = 1;
  incomplete.sample.cleanup.pendingJobs = 1;
  incomplete.profile.trace.complete = false;
  const validation = validateImportGeometryLoadProfileReport(incomplete, {
    commit,
    geometrySha256: geometryHash,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes('bounded runtime phase summary is incomplete'),
  );
  assert.ok(
    validation.errors.includes(
      'post-profile fidelity or cleanup witness is invalid',
    ),
  );
});

test('geometry GC overlap uses interval unions and separates other threads', () => {
  const summary = summarizeGeometryGcOverlap({
    anchor: {
      name: 'gev-import-step:geometry-profile:LineString',
      pageNowMs: 100,
      uncertaintyMs: 0.2,
    },
    startMs: 100,
    endMs: 120,
    trace: {
      events: [
        {
          kind: 'marker',
          name: 'gev-import-step:geometry-profile:LineString',
          tsUs: 500_000,
          pid: 1,
          tid: 2,
        },
        {
          kind: 'gc',
          name: 'V8.GC',
          tsUs: 500_000,
          durationUs: 10_000,
          pid: 1,
          tid: 2,
        },
        {
          kind: 'gc',
          name: 'V8.MinorGC',
          tsUs: 505_000,
          durationUs: 10_000,
          pid: 1,
          tid: 2,
        },
        {
          kind: 'gc',
          name: 'V8.GC',
          tsUs: 510_000,
          durationUs: 15_000,
          pid: 1,
          tid: 3,
        },
        { kind: 'gc-instant', name: 'V8.GC', tsUs: 512_000, pid: 1, tid: 2 },
      ],
      flowEvents: [],
      relevantCount: 5,
      omittedCount: 0,
      flowOmittedCount: 0,
      invalidFlowIdentityCount: 0,
      invalidFlowRecordCount: 0,
      flowEventCount: 0,
      flowPhaseCounts: { s: 0, t: 0, f: 0 },
      stopError: null,
      bufferUsagePeak: 0.2,
      bufferUsageCount: 1,
      bufferUsageStatus: 'observed',
      completionObserved: true,
      dataLossOccurred: false,
    },
  });
  assert.equal(summary.complete, true);
  assert.equal(summary.sameThreadGcOverlapMs, 15);
  assert.equal(summary.otherThreadGcOverlapMs, 10);
  assert.equal(summary.instantGcObservations, 1);
});

test('geometry GC overlap fails closed on omitted trace events or weak anchors', () => {
  const base = {
    anchor: {
      name: 'gev-import-step:geometry-profile:Polygon',
      pageNowMs: 100,
      uncertaintyMs: 0.1,
    },
    startMs: 100,
    endMs: 101,
    trace: {
      events: [
        {
          kind: 'marker',
          name: 'gev-import-step:geometry-profile:Polygon',
          tsUs: 100_000,
          pid: 1,
          tid: 2,
        },
      ],
      flowEvents: [],
      relevantCount: 2,
      omittedCount: 1,
      flowOmittedCount: 0,
      invalidFlowIdentityCount: 0,
      invalidFlowRecordCount: 0,
      flowEventCount: 0,
      flowPhaseCounts: { s: 0, t: 0, f: 0 },
      stopError: null,
      bufferUsagePeak: 0.2,
      bufferUsageCount: 1,
      bufferUsageStatus: 'observed',
      completionObserved: true,
      dataLossOccurred: false,
    },
  };
  assert.equal(summarizeGeometryGcOverlap(base).complete, false);
  assert.throws(
    () =>
      summarizeGeometryGcOverlap({
        ...base,
        anchor: { ...base.anchor, uncertaintyMs: 2.1 },
      }),
    /Invalid geometry trace attribution input/,
  );
});

test('GC flow links are retained as bounded identity observations, not durations', () => {
  const collector = createImportTraceEventCollector(1, 2);
  collector.add([
    {
      name: 'V8.GC_SCAVENGER',
      cat: 'disabled-by-default-v8.gc',
      ph: 's',
      ts: 10,
      pid: 1,
      tid: 2,
      id: 42,
    },
    {
      name: 'V8.GC_SCAVENGER',
      cat: 'disabled-by-default-v8.gc',
      ph: 't',
      ts: 11,
      pid: 1,
      tid: 2,
      id: 42,
    },
    {
      name: 'V8.GC_SCAVENGER',
      cat: 'disabled-by-default-v8.gc',
      ph: 'f',
      ts: 12,
      pid: 1,
      tid: 2,
      id: 42,
    },
  ]);
  const result = collector.finish();
  assert.equal(result.events.length, 0);
  assert.equal(result.flowEvents.length, 2);
  assert.equal(result.flowEvents[0].identity.id, 42);
  assert.equal(result.flowEvents[0].phase, 's');
  assert.equal(result.flowOmittedCount, 1);
  assert.equal(result.flowEventCount, 3);
  assert.deepEqual(result.flowPhaseCounts, { s: 1, t: 1, f: 1 });
  assert.equal(result.relevantCount, 3);
  const overflowSummary = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      ...result,
      relevantCount: traceInput.events.length + result.relevantCount,
      stopError: null,
      bufferUsagePeak: 0.1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(overflowSummary.complete, false);
});

test('flow links report unpaired phases without making causal completion a gate', () => {
  const flowEvents = [
    {
      kind: 'gc-flow',
      phase: 's',
      name: 'V8.GC',
      nameStatus: 'valid',
      category: 'disabled-by-default-v8.gc',
      categoryStatus: 'valid',
      tsUs: 100_000,
      pid: 1,
      tid: 2,
      identity: { id: 9 },
      identityStatus: 'present',
    },
    {
      kind: 'gc-flow',
      phase: 'f',
      name: 'V8.GC',
      nameStatus: 'valid',
      category: 'disabled-by-default-v8.gc',
      categoryStatus: 'valid',
      tsUs: 110_000,
      pid: 3,
      tid: 2,
      identity: { id: 9 },
      identityStatus: 'present',
    },
  ];
  const trace = {
    ...traceInput,
    flowEvents,
    flowEventCount: 2,
    flowPhaseCounts: { s: 1, t: 0, f: 1 },
    relevantCount: traceInput.events.length + flowEvents.length,
  };
  const summary = summarizeGeometryGcOverlap({
    trace,
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(summary.complete, true);
  assert.equal(summary.sameThreadGcOverlapMs, 0);
  assert.deepEqual(summary.unmatchedFlow, {
    interpretation:
      'observed-records-only; flow completion is not inferred; matches are scoped to one process, so cross-process links are not reconstructed',
    crossProcessLinksNotReconstructed: true,
    unmatchedStarts: 1,
    unmatchedSteps: 0,
    unmatchedEnds: 1,
  });
});

test('trace attribution summary retains flow identities and reports window boundaries', () => {
  const markerName = 'gev-import-step:geometry-profile:LineString';
  const collector = createImportTraceEventCollector();
  collector.add([
    {
      name: 'TimeStamp',
      cat: 'devtools.timeline',
      ph: 'I',
      ts: 500_000,
      pid: 1,
      tid: 2,
      args: { data: { message: markerName } },
    },
    {
      name: 'V8.GC',
      cat: 'disabled-by-default-v8.gc',
      ph: 's',
      ts: 500_100,
      pid: 1,
      tid: 2,
      id: 'flow-x',
    },
  ]);
  const trace = {
    ...collector.finish(),
    stopError: null,
    bufferUsagePeak: null,
    bufferUsageCount: 0,
    bufferUsageStatus: 'unavailable',
    completionObserved: true,
    dataLossOccurred: false,
  };
  const summary = summarizeImportTraceAttribution({
    trace,
    anchors: [{ name: markerName, pageNowMs: 100, uncertaintyMs: 0.1 }],
    loadingWindows: [
      {
        pair: 1,
        mode: 'cooperative',
        markerName,
        startMs: 100,
        endMs: 101,
        overBudgetSteps: 0,
        slowSteps: [],
        omittedSlowSteps: 0,
      },
    ],
  });
  assert.equal(summary.complete, true);
  assert.equal(summary.bufferUsagePeak, null);
  assert.equal(summary.bufferUsageStatus, 'unavailable');
  assert.equal(summary.flowEventCount, 1);
  assert.equal(summary.flowEvents[0].identity.id, 'flow-x');
  assert.equal(summary.unmatchedFlow.unmatchedStarts, 1);
});

test('trace delivery requires explicit completion and no-loss fields; buffer sample is optional only when unavailable', () => {
  const valid = {
    ...traceInput,
    bufferUsagePeak: null,
    bufferUsageCount: 0,
    bufferUsageStatus: 'unavailable',
  };
  assert.equal(
    summarizeGeometryGcOverlap({
      trace: valid,
      anchor,
      startMs: loadStartedAtMs,
      endMs: loadCompletedAtMs,
    }).complete,
    true,
  );

  for (const changed of [
    { completionObserved: false },
    { completionObserved: null },
    { dataLossOccurred: true },
    { dataLossOccurred: null },
    { bufferUsageCount: 1 },
    { bufferUsagePeak: 0 },
    { bufferUsageStatus: 'observed' },
    { bufferUsageStatus: 'unavailable', bufferUsagePeak: 0.1 },
    {
      bufferUsagePeak: 0.95,
      bufferUsageCount: 1,
      bufferUsageStatus: 'observed',
    },
    {
      bufferUsagePeak: 1.01,
      bufferUsageCount: 1,
      bufferUsageStatus: 'observed',
    },
  ]) {
    const trace = { ...valid, ...changed };
    assert.equal(
      summarizeGeometryGcOverlap({
        trace,
        anchor,
        startMs: loadStartedAtMs,
        endMs: loadCompletedAtMs,
      }).complete,
      false,
      JSON.stringify(changed),
    );
  }
});

test('missing, malformed, or overflowed flow observations fail closed', () => {
  const collector = createImportTraceEventCollector();
  collector.add([
    {
      name: 'V8.GC',
      cat: 'disabled-by-default-v8.gc',
      ph: 's',
      ts: 1,
      pid: 1,
      tid: 2,
    },
  ]);
  const missingIdentity = collector.finish();
  assert.equal(missingIdentity.flowEvents[0].identityStatus, 'missing');
  assert.equal(missingIdentity.invalidFlowIdentityCount, 1);
  const withMissingIdentity = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      ...missingIdentity,
      relevantCount: traceInput.events.length + missingIdentity.relevantCount,
      stopError: null,
      bufferUsagePeak: 0.1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(withMissingIdentity.complete, false);

  const oversizedNameCollector = createImportTraceEventCollector();
  oversizedNameCollector.add([
    {
      name: `V8.GC${'x'.repeat(140)}`,
      cat: 'disabled-by-default-v8.gc',
      ph: 's',
      ts: 2,
      pid: 1,
      tid: 2,
      id: 8,
    },
  ]);
  const oversizedName = oversizedNameCollector.finish();
  assert.equal(oversizedName.flowEvents[0].nameStatus, 'invalid');
  assert.equal(oversizedName.invalidFlowRecordCount, 1);
  const oversizedSummary = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      ...oversizedName,
      relevantCount: traceInput.events.length + oversizedName.relevantCount,
      stopError: null,
      bufferUsagePeak: 0.1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(oversizedSummary.complete, false);

  const oversizedCategoryCollector = createImportTraceEventCollector();
  oversizedCategoryCollector.add([
    {
      name: 'V8.GC',
      cat: `disabled-by-default-v8.gc,${'x'.repeat(140)}`,
      ph: 's',
      ts: 3,
      pid: 1,
      tid: 2,
      id: 8,
    },
  ]);
  const oversizedCategory = oversizedCategoryCollector.finish();
  assert.equal(oversizedCategory.flowEvents[0].categoryStatus, 'invalid');
  assert.equal(oversizedCategory.invalidFlowRecordCount, 1);
  const oversizedCategorySummary = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      ...oversizedCategory,
      relevantCount: traceInput.events.length + oversizedCategory.relevantCount,
      stopError: null,
      bufferUsagePeak: 0.1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(oversizedCategorySummary.complete, false);

  const malformed = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      flowEvents: [{ ...missingIdentity.flowEvents[0], phase: 'X' }],
      flowEventCount: 1,
      flowPhaseCounts: { s: 1, t: 0, f: 0 },
      relevantCount: traceInput.events.length + 1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(malformed.complete, false);

  const wrongPhaseCount = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      flowEvents: [
        {
          ...missingIdentity.flowEvents[0],
          identity: { id: 7 },
          identityStatus: 'present',
        },
      ],
      flowEventCount: 1,
      invalidFlowIdentityCount: 0,
      flowPhaseCounts: { s: 0, t: 1, f: 0 },
      relevantCount: traceInput.events.length + 1,
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(wrongPhaseCount.complete, false);

  const absent = summarizeGeometryGcOverlap({
    trace: { ...traceInput, flowEvents: undefined },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(absent.complete, false);

  const oldCounterOnly = summarizeGeometryGcOverlap({
    trace: {
      ...traceInput,
      flowEvents: [],
      relevantCount: traceInput.events.length + 2,
      flowEventCount: 2,
      flowPhaseCounts: { s: 1, t: 0, f: 1 },
    },
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(oldCounterOnly.complete, false);
});

test('flow report validation rejects forged identity values, keys, and bounds', () => {
  const valid = {
    kind: 'gc-flow',
    phase: 's',
    name: 'V8.GC',
    nameStatus: 'valid',
    category: 'disabled-by-default-v8.gc',
    categoryStatus: 'valid',
    tsUs: 1,
    pid: 1,
    tid: 2,
    identity: { id: 'flow-id' },
    identityStatus: 'present',
  };
  const check = (event) =>
    summarizeGeometryGcOverlap({
      trace: {
        ...traceInput,
        flowEvents: [event],
        flowEventCount: 1,
        flowPhaseCounts: { s: 1, t: 0, f: 0 },
        relevantCount: traceInput.events.length + 1,
      },
      anchor,
      startMs: loadStartedAtMs,
      endMs: loadCompletedAtMs,
    }).complete;
  assert.equal(check(valid), true);
  assert.equal(
    check({ ...valid, identity: { id: { value: 'forged' } } }),
    false,
  );
  assert.equal(check({ ...valid, identity: { id: 'x'.repeat(129) } }), false);
  assert.equal(
    check({ ...valid, identity: { id: 'flow-id', extra: 1 } }),
    false,
  );
  assert.equal(
    check({ ...valid, identity: { id2: { local: 4, extra: 1 } } }),
    false,
  );
  assert.equal(check({ ...valid, identity: { id2: {} } }), false);
  assert.equal(
    check({
      ...valid,
      identity: { id2: { global: 'flow-id', localStatus: 'invalid' } },
    }),
    false,
  );
  assert.equal(
    check({ ...valid, identity: { id: 'flow-id', scope: 3 } }),
    false,
  );
  assert.equal(
    check({ ...valid, identity: { id: 'flow-id', scope: 's'.repeat(129) } }),
    false,
  );
  assert.equal(
    check({ ...valid, identity: { id: 'flow-id' }, unreviewed: true }),
    false,
  );
  assert.equal(check({ ...valid, category: 'c'.repeat(129) }), false);
  assert.equal(check({ ...valid, category: 'devtools.timeline' }), false);
});

test('profile validator recomputes retained flow identity and phase accounting', () => {
  const report = validReport();
  const event = {
    kind: 'gc-flow',
    phase: 's',
    name: 'V8.GC',
    nameStatus: 'valid',
    category: 'disabled-by-default-v8.gc',
    categoryStatus: 'valid',
    tsUs: 500_100,
    pid: 1,
    tid: 2,
    identity: { id: 'flow-a' },
    identityStatus: 'present',
  };
  report.profile.traceInput.flowEvents = [event];
  report.profile.traceInput.flowEventCount = 1;
  report.profile.traceInput.flowPhaseCounts = { s: 1, t: 0, f: 0 };
  report.profile.traceInput.relevantCount += 1;
  report.profile.traceInputSha256 = hashJson(report.profile.traceInput);
  report.profile.trace = summarizeGeometryGcOverlap({
    trace: report.profile.traceInput,
    anchor,
    startMs: loadStartedAtMs,
    endMs: loadCompletedAtMs,
  });
  assert.equal(
    validateImportGeometryLoadProfileReport(report, {
      commit,
      geometrySha256: geometryHash,
    }).valid,
    true,
  );
  report.profile.trace.flowPhaseCounts.s = 0;
  assert.equal(
    validateImportGeometryLoadProfileReport(report, {
      commit,
      geometrySha256: geometryHash,
    }).valid,
    false,
  );
});

test('CPU profile summary remains diagnostic and records sampled weights', () => {
  const summary = summarizeGeometryLoadProfile({
    mode: 'cpu',
    profile: {
      nodes: [
        {
          id: 1,
          callFrame: {
            functionName: 'convert',
            url: 'http://127.0.0.1:4191/src/imports/runtimeLayer.js',
            lineNumber: 1,
            columnNumber: 0,
          },
        },
      ],
      samples: [1],
      timeDeltas: [1000],
      startTime: 1,
      endTime: 2001,
    },
  });
  assert.equal(summary.performanceAcceptanceEligible, false);
  assert.equal(summary.profileWindowMs, 2);
  assert.equal(summary.totalSampleWeightMs, 1);
  assert.equal(summary.profile.nodes.length, 1);
  assert.match(summary.rawInputSha256, /^[a-f0-9]{64}$/);
});

test('heap profile summary retains a bounded sanitized tree for recomputation', () => {
  const summary = summarizeGeometryLoadProfile({
    mode: 'heap',
    profile: {
      head: {
        id: 1,
        selfSize: 64,
        callFrame: {
          functionName: 'publishEntity',
          url: 'http://127.0.0.1:4191/src/imports/runtimeLayer.js',
          lineNumber: 12,
          columnNumber: 3,
        },
        children: [],
      },
      samples: [{ size: 64, nodeId: 1, ordinal: 1 }],
    },
  });
  assert.equal(summary.mode, 'heap');
  assert.equal(summary.nodeCount, 1);
  assert.equal(summary.sampledAllocationBytes, 64);
  assert.equal(
    summary.profile.head.callFrame.url,
    '/src/imports/runtimeLayer.js',
  );
  assert.match(summary.rawInputSha256, /^[a-f0-9]{64}$/);
});
