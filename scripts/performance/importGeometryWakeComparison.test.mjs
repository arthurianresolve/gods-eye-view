import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMPORT_GEOMETRY_WAKE_ARMS,
  IMPORT_GEOMETRY_WAKE_PAIR_COUNT,
  IMPORT_GEOMETRY_WAKE_TYPES,
  createImportGeometryWakeRunRecord,
  summarizeImportGeometryWakeReport,
  validateImportGeometryWakeReport,
} from './importGeometryWakeComparison.mjs';

const commit = 'a'.repeat(40);
const sha = 'b'.repeat(64);

function sample(type) {
  const entityId = `gev-import:geometry-wake:large-geometry:${type}`;
  return {
    type,
    entityId,
    positionCount: 50_000,
    ringLengths: type === 'LineString' ? [50_000] : [25_000, 25_000],
    geometrySha256: sha,
    loadElapsedMs: 20,
    initialActiveSpanMs: 3,
    callbackCount: 4,
    scheduleCount: 4,
    wakeMs: [1, 2, 1, 1],
    activeCallbackMs: [2, 3, 1, 2],
    maximumActiveSpanMs: 3,
    totalActiveSpanMs: 11,
    activeSpansOver4ms: 0,
    readiness: {
      status: 'passed',
      pickedEntityId: entityId,
      onCanvas: true,
      elapsedMs: 80,
      timeoutMs: 20_000,
      attempts: 3,
    },
    capture: {
      width: 960,
      height: 640,
      pixelSha256: sha,
      pngDataUrl: 'data:image/png;base64,YQ==',
    },
    renderSettings: {
      fixedTime: '2025-01-01T00:00:00.000Z',
      clockCurrentTime: '2025-01-01T00:00:00.000Z',
      clockShouldAnimate: false,
      sceneMode: 3,
      requestRenderMode: true,
      webglContextAttributes: {
        antialias: true,
        preserveDrawingBuffer: true,
      },
      globeShow: true,
      terrainProvider: 'EllipsoidTerrainProvider',
      imageryLayerCount: 0,
      canvasWidth: 960,
      canvasHeight: 640,
      cameraPosition: [1, 2, 3],
      cameraDirection: [0, 0, -1],
      renderer: 'NVIDIA GeForce RTX 4000',
      vendor: 'NVIDIA Corporation',
      cesiumVersion: '1.138.0',
      contextLost: false,
      sceneMsaaSamples: 4,
      resolutionScale: 1,
    },
    cleanup: {
      featureCount: 0,
      pendingJobs: 0,
      sceneEntityCount: 0,
      contextRecordCount: 0,
      schedulerPendingCount: 0,
    },
  };
}

function cancellation() {
  return {
    outcome: 'AbortError',
    scope: 'synthetic-budget-clock-queued-wake-cancel-before-dispatch',
    budgetClockCalls: 4,
    entitiesBeforeClear: 0,
    pendingSchedulerTasksBeforeClear: 1,
    featureCountAfter: 0,
    pendingJobsAfter: 0,
    entitiesAfter: 0,
    contextRecordCountAfter: 0,
    pendingSchedulerTasksAfter: 0,
  };
}

function validReport() {
  const report = {
    schema: 'gev-import-geometry-wake/v1',
    status: 'passed',
    contextIsolation:
      'fresh-page-and-viewer-per-arm-run;shared-browser-process',
    performanceAccepted: false,
    batchBudgetAcceptance: 'not-evaluated',
    source: {
      applicationCommit: commit,
      harnessCommit: commit,
      runtimeLayerSha256: sha,
      cooperativeSha256: sha,
      fixtureSha256: sha,
      fixtureHtmlSha256: sha,
      schedulerSha256: sha,
      packageLockSha256: sha,
      cesiumEntrySha256: sha,
      cesiumSceneSha256: sha,
      runnerSha256: sha,
      validatorSha256: sha,
      dirtyAtStart: false,
      sourceDirtyAtStart: false,
      harnessDirtyAtStart: false,
      changedDuringRun: false,
    },
    renderingEvidence: { accelerationVerified: true, kind: 'native-gpu' },
    renderer: 'NVIDIA GeForce RTX 4000',
    cesiumVersion: '1.138.0',
    browserCleanup: { closeCompleted: true },
    serverCleanup: { confirmed: true },
    pairCount: IMPORT_GEOMETRY_WAKE_PAIR_COUNT,
    pairs: [],
  };
  for (let index = 0; index < IMPORT_GEOMETRY_WAKE_PAIR_COUNT; index++) {
    const order = IMPORT_GEOMETRY_WAKE_ARMS.map(
      (_, offset) =>
        IMPORT_GEOMETRY_WAKE_ARMS[
          (index + offset) % IMPORT_GEOMETRY_WAKE_ARMS.length
        ],
    );
    const runs = {};
    for (const arm of IMPORT_GEOMETRY_WAKE_ARMS) {
      runs[arm] = {
        schema: 'gev-import-geometry-wake-sample/v1',
        status: 'passed',
        pageErrors: [],
        pageCleanup: { closeCompleted: true, openPageCount: 0 },
        applicationCommit: commit,
        harnessCommit: commit,
        arm,
        pairIndex: index,
        chunkSize: arm.startsWith('chunked-') ? 256 : 0,
        schedulerKind:
          arm === 'chunked-message-channel' ? 'MessageChannel' : 'setTimeout',
        renderErrors: [],
        environment: {
          canvas: {
            cssWidth: 960,
            cssHeight: 640,
            drawingBufferWidth: 960,
            drawingBufferHeight: 640,
          },
          clockCurrentTime: '2025-01-01T00:00:00.000Z',
          clockShouldAnimate: false,
          renderLoop: true,
          msaa: true,
          webglContextAttributes: {
            antialias: true,
            preserveDrawingBuffer: true,
          },
          globeShow: true,
          imageryLayerCount: 0,
          terrainProvider: 'EllipsoidTerrainProvider',
          sceneMode: 3,
          requestRenderMode: true,
          cameraPosition: [1, 2, 3],
          cameraDirection: [0, 0, -1],
          renderer: 'NVIDIA GeForce RTX 4000',
          vendor: 'NVIDIA Corporation',
          cesiumVersion: '1.138.0',
          contextLost: false,
          sceneMsaaSamples: 4,
          resolutionScale: 1,
        },
        samples: IMPORT_GEOMETRY_WAKE_TYPES.map(sample),
        cancellation: Object.fromEntries(
          IMPORT_GEOMETRY_WAKE_TYPES.map((type) => [type, cancellation()]),
        ),
      };
    }
    report.pairs.push({ index, order, runs });
  }
  report.summary = summarizeImportGeometryWakeReport(report);
  return report;
}

test('geometry-wake comparison accepts five rotated, complete arm groups', () => {
  const report = validReport();
  assert.equal(
    validateImportGeometryWakeReport(report, { expectedCommit: commit }),
    report,
  );
});

test('hosted fixture results are normalized to the report schema without a wrapper', () => {
  const fixture = {
    schema: 'gev-import-geometry-wake-sample/v1',
    status: 'passed',
    samples: [sample('LineString'), sample('Polygon')],
    environment: { renderer: 'GPU' },
  };
  const run = createImportGeometryWakeRunRecord(fixture, {
    pairIndex: 3,
    pageErrors: [],
  });
  assert.equal(run.schema, fixture.schema);
  assert.equal(run.samples, fixture.samples);
  assert.equal(run.environment, fixture.environment);
  assert.equal(run.pairIndex, 3);
  assert.deepEqual(run.pageErrors, []);
  assert.equal(Object.hasOwn(run, 'fixture'), false);
});

test('geometry-wake validator rejects changed rendered pixels and geometry', () => {
  const changedPixels = validReport();
  changedPixels.pairs[2].runs['chunked-timer'].samples[0].capture.pixelSha256 =
    'c'.repeat(64);
  assert.throws(
    () =>
      validateImportGeometryWakeReport(changedPixels, {
        expectedCommit: commit,
      }),
    /Rendered LineString output differs/,
  );
  const changedGeometry = validReport();
  changedGeometry.pairs[4].runs[
    'chunked-message-channel'
  ].samples[1].geometrySha256 = 'c'.repeat(64);
  assert.throws(
    () =>
      validateImportGeometryWakeReport(changedGeometry, {
        expectedCommit: commit,
      }),
    /Rendered Polygon output differs/,
  );
});

test('geometry-wake validator rejects incomplete scheduling, cleanup, settings, and cancellation evidence', () => {
  const badTiming = validReport();
  badTiming.pairs[0].runs['chunked-timer'].samples[0].wakeMs.pop();
  assert.throws(
    () =>
      validateImportGeometryWakeReport(badTiming, { expectedCommit: commit }),
    /timings are invalid/,
  );
  const badCleanup = validReport();
  badCleanup.pairs[0].runs[
    'whole-feature-timer'
  ].samples[0].cleanup.pendingJobs = 1;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(badCleanup, { expectedCommit: commit }),
    /cleanup leaked/,
  );
  const badSettings = validReport();
  badSettings.pairs[1].runs['chunked-timer'].environment.clockShouldAnimate =
    true;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(badSettings, { expectedCommit: commit }),
    /render evidence is incomplete/,
  );
  const badCancellation = validReport();
  badCancellation.pairs[3].runs[
    'chunked-message-channel'
  ].cancellation.Polygon.pendingSchedulerTasksAfter = 1;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(badCancellation, {
        expectedCommit: commit,
      }),
    /cancellation leaked/,
  );
});

test('geometry-wake validator rejects wrong source, software renderer, and altered summary', () => {
  const wrongSource = validReport();
  wrongSource.source.applicationCommit = 'c'.repeat(40);
  assert.throws(
    () =>
      validateImportGeometryWakeReport(wrongSource, { expectedCommit: commit }),
    /source provenance/,
  );
  const software = validReport();
  software.renderingEvidence = {
    accelerationVerified: false,
    kind: 'software',
  };
  assert.throws(
    () =>
      validateImportGeometryWakeReport(software, { expectedCommit: commit }),
    /not verified as accelerated/,
  );
  const alteredSummary = validReport();
  alteredSummary.summary['LineString']['chunked-timer'].medianLoadElapsedMs +=
    1;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(alteredSummary, {
        expectedCommit: commit,
      }),
    /summary differs/,
  );
});

test('geometry-wake validator rejects runner-shape commit drift and cleanup failures', () => {
  const nestedCommit = validReport();
  nestedCommit.pairs[2].runs['chunked-timer'].harnessCommit = 'c'.repeat(40);
  assert.throws(
    () =>
      validateImportGeometryWakeReport(nestedCommit, {
        expectedCommit: commit,
      }),
    /render evidence is incomplete/,
  );
  const pageCleanup = validReport();
  pageCleanup.pairs[0].runs['whole-feature-timer'].pageCleanup.openPageCount =
    1;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(pageCleanup, { expectedCommit: commit }),
    /render evidence is incomplete/,
  );
  const sourceState = validReport();
  sourceState.source.harnessDirtyAtStart = null;
  assert.throws(
    () =>
      validateImportGeometryWakeReport(sourceState, { expectedCommit: commit }),
    /source provenance/,
  );
});
