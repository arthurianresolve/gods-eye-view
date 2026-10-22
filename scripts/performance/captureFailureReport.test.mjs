import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compactCaptureCliFailure } from '../qa-performance-build-smoke.mjs';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import {
  createCaptureFailureReport,
  MAX_CAPTURE_FAILURE_REPORT_BYTES,
  writeCaptureFailureReportFile,
} from './captureFailureReport.mjs';

const source = {
  harnessCommit: 'a'.repeat(40),
  harnessDirtyWorktree: false,
  appCommit: 'b'.repeat(40),
  appWorktreeState: 'clean',
  provenanceStatus: 'verified',
  buildProvenance: {
    schema: 'gev-capture-build-provenance/v1',
    status: 'before-verified',
    receiptSha256: 'c'.repeat(64),
    appCommit: 'b'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    before: { status: 'served-assets-match', assetCount: 42 },
    after: null,
  },
};

test('failure artifact preserves bounded current and completed sample evidence without eligibility', () => {
  const report = createCaptureFailureReport({
    capturedAt: '2026-10-10T12:00:00.000Z',
    source,
    fixture: {
      id: 'dense-fixture-v1',
      count: 2500,
      fixedTime: '2026-10-10T12:00:00.000Z',
      sha256: 'd'.repeat(64),
      byteLength: 123456,
      body: 'must-not-be-copied',
    },
    workload: { warmupMs: 30_000, durationPerSampleMs: 60_000 },
    phase: 'sample-observation',
    scenario: 'selected-aircraft-tracking',
    run: 2,
    error: new Error('Tracking sample failed.'),
    errorOperator: 'deepStrictEqual',
    errorActual: {
      layers: Array.from({ length: 40 }, (_, index) => ({ id: index })),
    },
    errorExpected: {
      layers: Array.from({ length: 40 }, (_, index) => ({ id: index })),
    },
    current: {
      phase: 'sample-observation',
      before: { camera: { position: { x: 1, y: 2, z: 3 } } },
      measurement: { frameCount: 12 },
      after: null,
    },
    startupSamples: [{ run: 1, renderer: 'software renderer' }],
    completedSamples: [{ scenario: 'idle', run: 1, frameCount: 0 }],
  });

  assert.equal(report.schema, 'gev-performance-capture-failure/v1');
  assert.equal(report.status, 'failed');
  assert.equal(report.comparisonEligible, false);
  assert.equal(report.failure.phase, 'sample-observation');
  assert.equal(report.failure.scenario, 'selected-aircraft-tracking');
  assert.equal(report.failure.run, 2);
  assert.equal(report.failure.operator, 'deepStrictEqual');
  assert.equal(report.failure.actual.layers.length, 40);
  assert.equal(report.progress.completedSampleCount, 1);
  assert.equal(report.progress.completedSamples[0].scenario, 'idle');
  assert.equal(report.progress.current.before.camera.position.x, 1);
  assert.equal(report.fixture.sha256, 'd'.repeat(64));
  assert.equal('body' in report.fixture, false);
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline: report,
        candidate: report,
        expectedAppCommits: {
          baseline: 'b'.repeat(40),
          candidate: 'e'.repeat(40),
        },
      }),
    /unsupported capture report schema/,
  );
});

test('failure projection retains the bounded Austin source-readiness layer snapshot', () => {
  const report = createCaptureFailureReport({
    source,
    fixture: { id: 'austin-operating-composed-v1', sha256: 'd'.repeat(64) },
    workload: { austinOperatingReadinessFailures: [] },
    phase: 'configure-austin-operating-sample-document',
    current: {
      austinReadinessFailure: {
        phase: 'source-readiness-wait',
        documentRole: 'provider-sample-1',
        documentId: 'sample-document-1',
        status: 'completed',
        snapshot: {
          schema: 'gev-austin-readiness-failure/v1',
          selectedLayerCount: 2,
          layers: [
            {
              id: 'satellites',
              enabled: true,
              count: 828,
              loading: false,
              status: null,
              error: null,
            },
            {
              id: 'wind',
              enabled: true,
              count: 65160,
              loading: true,
              status: 'loading',
              error: 'Failed at [url]',
            },
          ],
        },
      },
    },
    error: new Error('existing source readiness timeout'),
  });
  const layers = report.progress.current.austinReadinessFailure.snapshot.layers;
  assert.deepEqual(layers, [
    {
      id: 'satellites',
      enabled: true,
      count: 828,
      loading: false,
      status: null,
      error: null,
    },
    {
      id: 'wind',
      enabled: true,
      count: 65160,
      loading: true,
      status: 'loading',
      error: 'Failed at [url]',
    },
  ]);
  assert.equal(report.failure.message, 'existing source readiness timeout');
  assert.equal(report.comparisonEligible, false);

  const outer = compactCaptureCliFailure(report);
  assert.deepEqual(
    outer.rawReport.progress.current.austinReadinessFailure.snapshot.layers,
    layers,
  );
  assert.equal(
    outer.rawReport.failure.message,
    'existing source readiness timeout',
  );
});

test('failure projection retains flattened Austin readiness history through outer smoke compaction', () => {
  const snapshotJson = JSON.stringify({
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: 2,
    layers: [
      ['satellites', true, 828, false, 828, 828, 'ready', null, 0, 0, 2, 0],
      ['cctv', true, 250, true, 17, 250, 'geometry-loading', null, 0, 3, 2, 0],
    ],
  });
  const report = createCaptureFailureReport({
    source,
    fixture: { id: 'austin-operating-composed-v1', sha256: 'd'.repeat(64) },
    workload: {
      austinOperatingReadinessHistory: {
        enabled: true,
        schema: 'gev-austin-operating-readiness-history/v1',
        intervalMs: 1000,
        entryLimit: 16,
        omittedCount: 0,
        documents: [
          {
            documentRole: 'provider-sample',
            documentId: 'sample-1',
            phase: 'source-readiness-wait',
            status: 'stalled',
            intervalMs: 1000,
            omittedCount: 0,
            session: { detachStatus: 'confirmed' },
          },
        ],
        samples: [
          {
            documentRole: 'provider-sample',
            documentId: 'sample-1',
            phase: 'source-readiness-wait',
            status: 'observed',
            hostStartedAtMs: 12,
            hostCompletedAtMs: 15,
            snapshotEncoding: 'austin-layer-tuples-v1',
            snapshotJson,
          },
        ],
      },
    },
    phase: 'configure-austin-operating-sample-document',
    error: new Error('existing source readiness timeout'),
  });
  assert.equal(report.status, 'failed');
  const history = report.workload.austinOperatingReadinessHistory;
  assert.equal(history.samples.length, 1);
  assert.equal(history.samples[0].documentId, 'sample-1');
  assert.equal(history.samples[0].snapshotJson, snapshotJson);
  assert.deepEqual(JSON.parse(history.samples[0].snapshotJson).layers[1], [
    'cctv',
    true,
    250,
    true,
    17,
    250,
    'geometry-loading',
    null,
    0,
    3,
    2,
    0,
  ]);

  const outer = compactCaptureCliFailure(report);
  const outerHistory = outer.rawReport.workload.austinOperatingReadinessHistory;
  assert.equal(outerHistory.samples[0].snapshotJson, snapshotJson);
  assert.equal(outerHistory.documents[0].documentRole, 'provider-sample');
  assert.equal(
    outer.rawReport.failure.message,
    'existing source readiness timeout',
  );
});

test('post-cleanup failure refresh is atomic and preserves the initial artifact on rejection', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'capture-failure-refresh-'),
  );
  const filePath = path.join(directory, 'report.json');
  try {
    await writeCaptureFailureReportFile(filePath, '{"state":"initial"}\n');
    await assert.rejects(
      writeCaptureFailureReportFile(
        filePath,
        'x'.repeat(MAX_CAPTURE_FAILURE_REPORT_BYTES + 1),
        { refresh: true },
      ),
      /hard limit/,
    );
    assert.equal(await readFile(filePath, 'utf8'), '{"state":"initial"}\n');
    await writeCaptureFailureReportFile(filePath, '{"state":"late"}\n', {
      refresh: true,
    });
    assert.equal(await readFile(filePath, 'utf8'), '{"state":"late"}\n');
    assert.deepEqual(await readdir(directory), ['report.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failure artifact redacts secrets and stays within its hard byte cap', () => {
  const report = createCaptureFailureReport({
    source,
    phase: 'capture',
    error: new Error(
      'Fetch failed at https://user:password@example.invalid/path?token=private',
    ),
    errorActual: { value: 'https://secret.invalid/a?key=value' },
    errorExpected: { value: 'different' },
    current: { before: { diagnostic: 'https://secret.invalid/a?key=value' } },
    completedSamples: Array.from({ length: 30 }, (_, index) => ({
      scenario: 'scripted-motion',
      run: index + 1,
      diagnostics: 'x'.repeat(80_000),
    })),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );
  assert.equal(report.status, 'failed');
  assert.equal(report.comparisonEligible, false);
  assert.equal(report.evidenceTruncated, true);
  assert.equal(serialized.includes('user:password'), false);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('secret.invalid'), false);
});

test('failure artifact retains allowlisted foreground cause after size pruning', () => {
  const error = new Error('owned window activation failed');
  error.foregroundActivation = {
    schema: 'gev-windows-owned-browser-foreground-diagnostic/v1',
    category: 'timeout',
    runnerExited: false,
    runnerTimedOut: true,
    runnerKilled: true,
    runnerSignal: 'SIGTERM',
    runnerErrorCode: 'ETIMEDOUT',
    browserPid: 77,
    privateToken: 'should-not-be-copied',
    stderr: 'secret command output',
  };
  const report = createCaptureFailureReport({
    source,
    phase: 'activate-sample-foreground',
    error,
    errorActual: { huge: 'x'.repeat(100_000) },
    errorExpected: { huge: 'y'.repeat(100_000) },
    workload: { huge: 'z'.repeat(100_000) },
    completedSamples: Array.from({ length: 30 }, () => ({
      sample: 'x'.repeat(80_000),
    })),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );
  assert.equal(report.failure.foregroundActivation.category, 'timeout');
  assert.equal(report.failure.foregroundActivation.runnerExited, false);
  assert.equal(report.failure.foregroundActivation.runnerKilled, true);
  assert.equal(
    report.failure.foregroundActivation.runnerErrorCode,
    'ETIMEDOUT',
  );
  assert.equal('privateToken' in report.failure.foregroundActivation, false);
  assert.equal('stderr' in report.failure.foregroundActivation, false);
});

test('oversized workload and delivery evidence fall back to bounded summaries', () => {
  const rows = Array.from({ length: 256 }, (_, index) => ({
    index,
    text: 'x'.repeat(1024),
    nested: Array.from({ length: 32 }, () => 'y'.repeat(1024)),
  }));
  const report = createCaptureFailureReport({
    source,
    phase: 'prepare-fresh-provider-document',
    scenario: 'scripted-motion',
    run: 5,
    error: new Error('original capture failure'),
    workload: {
      providerFixture: 'austin-operating-v1',
      warmupMs: 30_000,
      scenarios: ['idle', 'scripted-motion'],
      fixtureDocuments: rows,
      readinessHistory: rows,
    },
    fixtureDelivery: {
      schema: 'gev-austin-operating-delivery/v1',
      status: 'observed',
      fixtureId: 'austin-operating-composed-v1',
      deliveredAssets: rows,
      sourcePopulationIds: rows,
    },
    completedSamples: rows,
  });

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );
  assert.equal(report.failure.message, 'original capture failure');
  assert.equal(report.failure.scenario, 'scripted-motion');
  assert.equal(report.failure.run, 5);
  assert.equal(report.workload.providerFixture, 'austin-operating-v1');
  assert.match(report.workload.evidenceOmittedReason, /workload-exceeded/);
  assert.equal(report.fixtureDelivery.status, 'observed');
  assert.match(
    report.fixtureDelivery.evidenceOmittedReason,
    /fixture-delivery-exceeded/,
  );
  assert.equal(report.evidenceTruncated, true);
});
