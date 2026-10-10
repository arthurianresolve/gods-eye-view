import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import {
  createCaptureFailureReport,
  MAX_CAPTURE_FAILURE_REPORT_BYTES,
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
