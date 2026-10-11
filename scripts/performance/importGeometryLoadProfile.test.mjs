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
const traceInput = {
  events: [
    { kind: 'marker', name: anchor.name, tsUs: 500_000, pid: 1, tid: 2 },
  ],
  relevantCount: 1,
  omittedCount: 0,
  flowEventCount: 0,
  flowPhaseCounts: {},
  omissionReasons: {},
  bufferUsagePeak: 0.1,
  stopError: null,
};
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
      pixelSha256: hash,
      capture: { completed: true },
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
      traceInput,
      traceInputSha256: hashJson(traceInput),
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
      relevantCount: 5,
      omittedCount: 0,
      flowEventCount: 0,
      stopError: null,
      bufferUsagePeak: 0.2,
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
      relevantCount: 2,
      omittedCount: 1,
      flowEventCount: 0,
      stopError: null,
      bufferUsagePeak: 0.2,
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
