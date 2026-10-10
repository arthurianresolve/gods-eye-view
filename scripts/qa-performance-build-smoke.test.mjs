import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compactCaptureCliFailure,
  parseSmokeArguments,
  runBoundedChild,
  validateCaptureCliReport,
} from './qa-performance-build-smoke.mjs';
import { MAX_CAPTURE_FAILURE_REPORT_BYTES } from './performance/captureFailureReport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('smoke CLI parser preserves the candidate SHA and output path', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(
    parseSmokeArguments(['--candidate-sha', sha, '--out', 'smoke.json']),
    { candidateSha: sha, out: 'smoke.json' },
  );
  assert.throws(
    () => parseSmokeArguments(['--candidate-sha', sha, '--unknown', 'x']),
    /Unknown option/,
  );
});

function validCaptureCliReport() {
  const scenarios = ['idle', 'scripted-motion', 'selected-aircraft-tracking'];
  const fixtureSha256 = 'a'.repeat(64);
  return {
    schema: 'gev-performance-capture/v1',
    comparisonEligible: false,
    integrity: { status: 'passed', sampleCount: 6 },
    source: {
      appCommit: 'b'.repeat(40),
      harnessCommit: 'c'.repeat(40),
      provenanceStatus:
        'verified-local-build-and-served-assets-before-and-after',
      buildProvenance: {
        receiptSha256: 'd'.repeat(64),
        pageAssetAudit: {
          scriptRequestCount: 12,
          loadedAssetPaths: ['assets/index.js'],
          unexpectedAssetPaths: [],
          cesiumWorkerBlobAudits: Array.from({ length: 6 }, () => ({
            status: 'receipt-derived-worker-blobs-validated',
          })),
        },
      },
    },
    workload: {
      warmupMs: 1000,
      durationPerSampleMs: 1000,
      runsPerScenario: 2,
      startupRuns: 1,
      scenarios,
    },
    environment: {
      renderer: 'ANGLE (Google, Vulkan 1.3, SwiftShader device)',
      hardwareEligible: false,
      startup: {
        runCount: 1,
        measurement: 'cache-disabled fresh browser contexts',
      },
    },
    fixtureDelivery: {
      status: 'observed',
      fixtureSha256,
      observedFlightsCount: 2500,
      fulfilledResponseCount: 1,
    },
    captures: scenarios.flatMap((scenario) =>
      [1, 2].map((run) => ({
        scenario,
        run,
        fixtureClock: {
          freshBrowserContext: true,
          start: { startCount: 1 },
          sourceFreshness: 'current',
          actualWarmupElapsedMs: 1000,
          measuredWindowElapsedMs: 1000,
          ageAtMeasurementStartMs: 1000,
          ageAtEndMs: 2000,
        },
        fixtureDelivery: {
          status: 'observed',
          fixtureSha256,
          observedFlightsCount: 2500,
          fulfilledResponseCount: 1,
        },
        layers: [
          { id: 'flights', enabled: true, count: 2500 },
          { id: 'local-datacenters', enabled: true, count: 4362 },
          { id: 'local-dams', enabled: true, count: 716 },
        ],
        conditions: {
          before: { visible: true, focused: true },
          after: { visible: true, focused: true },
        },
        foregroundThroughout: true,
        renderedFrameCount: 61,
        frameCount: 60,
        frameIntervalMs: { p50: 16, p95: 18, max: 20, samples: 60 },
        ...(scenario === 'selected-aircraft-tracking'
          ? { trackedAircraftId: 'flights:000001' }
          : {}),
        settings: {
          before: {
            qualityMode: 'manual',
            densityPct: 75,
            detectionMode: 'DENSE',
          },
          after: {
            qualityMode: 'manual',
            densityPct: 75,
            detectionMode: 'DENSE',
          },
        },
      })),
    ),
  };
}

test('capture CLI validator accepts only the complete six-sample hosted smoke contract', () => {
  const result = validateCaptureCliReport(validCaptureCliReport(), {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: 'a'.repeat(64),
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.captureCount, 6);
  assert.equal(result.rawReport.schema, 'gev-performance-capture/v1');
  assert.throws(
    () =>
      validateCaptureCliReport(validCaptureCliReport(), {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: 'e'.repeat(64),
      }),
    /Expected values to be strictly equal/,
  );
  const stale = validCaptureCliReport();
  stale.captures[0].fixtureClock.freshBrowserContext = false;
  assert.throws(
    () =>
      validateCaptureCliReport(stale, {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: 'a'.repeat(64),
      }),
    /false !== true/,
  );
  const incomplete = validCaptureCliReport();
  incomplete.integrity.sampleCount = 5;
  assert.throws(
    () =>
      validateCaptureCliReport(incomplete, {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: 'a'.repeat(64),
      }),
    /sampleCount/,
  );
});

test('capture CLI requires usable frame-interval evidence for moving and tracking samples', () => {
  const invalidCases = [
    [
      'empty',
      (sample) => {
        sample.renderedFrameCount = 0;
        sample.frameCount = 0;
        sample.frameIntervalMs = { p95: null, samples: 0 };
      },
    ],
    [
      'one rendered frame',
      (sample) => {
        sample.renderedFrameCount = 1;
        sample.frameCount = 0;
        sample.frameIntervalMs = { p95: null, samples: 0 };
      },
    ],
    [
      'missing p95',
      (sample) => {
        sample.frameIntervalMs.p95 = null;
      },
    ],
    [
      'non-finite p95',
      (sample) => {
        sample.frameIntervalMs.p95 = Number.NaN;
      },
    ],
    [
      'interval count mismatch',
      (sample) => {
        sample.frameIntervalMs.samples -= 1;
      },
    ],
  ];
  for (const scenario of ['scripted-motion', 'selected-aircraft-tracking']) {
    for (const [label, corrupt] of invalidCases) {
      const report = validCaptureCliReport();
      corrupt(report.captures.find((sample) => sample.scenario === scenario));
      assert.throws(
        () =>
          validateCaptureCliReport(report, {
            appSha: 'b'.repeat(40),
            harnessSha: 'c'.repeat(40),
            receiptSha256: 'd'.repeat(64),
            fixtureSha256: 'a'.repeat(64),
          }),
        new RegExp(`${scenario} run 1`),
        `${scenario} should reject ${label} frame evidence`,
      );
    }
  }
});

test('capture CLI preserves legitimately unavailable zero-frame idle timing', () => {
  const report = validCaptureCliReport();
  for (const sample of report.captures.filter(
    (entry) => entry.scenario === 'idle',
  )) {
    sample.renderedFrameCount = 0;
    sample.frameCount = 0;
    sample.frameIntervalMs = { p50: null, p95: null, max: null, samples: 0 };
  }
  const validated = validateCaptureCliReport(report, {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: 'a'.repeat(64),
  });
  assert.equal(validated.captureCount, 6);
});

test('smoke compaction preserves the complete bounded capture failure report and mismatch evidence', () => {
  const rawReport = {
    schema: 'gev-performance-capture-failure/v1',
    status: 'failed',
    comparisonEligible: false,
    source: { appCommit: 'b'.repeat(40), harnessCommit: 'c'.repeat(40) },
    fixtureDelivery: { status: 'observed', fulfilledResponseCount: 3 },
    failure: {
      phase: 'repeated-workload-check',
      scenario: 'idle',
      run: 2,
      message: 'Repeated workload changed.',
      operator: 'deepStrictEqual',
      actual: { camera: { x: 4 } },
      expected: { camera: { x: 3 } },
    },
    progress: {
      completedSampleCount: 2,
      completedSamplesRetained: 2,
      completedSamples: [
        { scenario: 'idle', run: 1, frameCount: 60 },
        { scenario: 'scripted-motion', run: 1, frameCount: 60 },
      ],
    },
    evidenceTruncated: false,
  };
  const serialized = `${JSON.stringify(rawReport, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );

  const compacted = compactCaptureCliFailure(rawReport);
  assert.equal(compacted.schema, 'gev-smoke-capture-cli-failure/v1');
  assert.deepEqual(compacted.rawReport, rawReport);
  assert.equal(compacted.summary.failure.phase, 'repeated-workload-check');
  assert.equal(compacted.summary.failure.operator, 'deepStrictEqual');
  assert.deepEqual(compacted.summary.failure.actual, { camera: { x: 4 } });
  assert.deepEqual(compacted.summary.failure.expected, { camera: { x: 3 } });
  assert.equal(compacted.summary.completedSampleCount, 2);
  assert.equal(compacted.summary.completedSamplesRetained, 2);
  assert.equal(compacted.summary.evidenceTruncated, false);
});

test('smoke compaction does not label an unbounded or unrecognized report as raw failure evidence', () => {
  const compacted = compactCaptureCliFailure({
    schema: 'legacy-capture-report',
    status: 'failed',
    failure: { message: 'legacy failure' },
    progress: { completedSampleCount: 1, completedSamples: [{ run: 1 }] },
  });
  assert.equal(compacted.rawReport, undefined);
  assert.match(compacted.rawReportUnavailable, /bounded failure schema/);
  assert.equal(compacted.summary.completedSampleCount, 1);
});

test('bounded child runner stops an owned process on timeout', async () => {
  const started = Date.now();
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 150,
      maxOutputBytes: 2048,
    }),
    /timed out; .*cleanup confirmed/,
  );
  assert.ok(Date.now() - started < 5000);
});

test('bounded child runner stops an owned process when output exceeds its cap', async () => {
  await assert.rejects(
    runBoundedChild(
      process.execPath,
      [
        '-e',
        'process.stdout.write("x".repeat(8192)); setInterval(() => {}, 1000)',
      ],
      { timeoutMs: 3000, maxOutputBytes: 2048 },
    ),
    /output limit exceeded; .*cleanup confirmed/,
  );
});

test('bounded child runner stops a separately owned browser process', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-owned-child-test-'),
  );
  const pidPath = path.join(tempRoot, 'browser.pid');
  let ownedPid = null;
  t.after(async () => {
    if (ownedPid) {
      try {
        process.kill(ownedPid, 'SIGKILL');
      } catch {
        // It may already be gone.
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  });
  const code = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', code], {
      timeoutMs: 200,
      maxOutputBytes: 2048,
      ownedPidFile: pidPath,
    }),
    /timed out; .*cleanup confirmed/,
  );
  ownedPid = Number((await readFile(pidPath, 'utf8')).trim());
  if (process.platform !== 'win32')
    assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
});

test('bounded child runner cleans the owned browser when the CLI exits with failure', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-failed-child-test-'),
  );
  const pidPath = path.join(tempRoot, 'browser.pid');
  let ownedPid = null;
  t.after(async () => {
    if (ownedPid) {
      try {
        process.kill(ownedPid, 'SIGKILL');
      } catch {
        // It may already be gone.
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  });
  const code = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    'setTimeout(() => process.exit(17), 50);',
  ].join('\n');
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', code], {
      timeoutMs: 3000,
      maxOutputBytes: 2048,
      ownedPidFile: pidPath,
    }),
    /exited 17; .*cleanup confirmed/,
  );
  ownedPid = Number((await readFile(pidPath, 'utf8')).trim());
  if (process.platform !== 'win32')
    assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
});

test('bounded child failure keeps sanitized stderr and the latest capture progress', async () => {
  await assert.rejects(
    runBoundedChild(
      process.execPath,
      [
        '-e',
        'console.log("[performance] startup 1/1"); console.error("fixture failed at https://secret.invalid/token"); process.exit(2)',
      ],
      { timeoutMs: 3000, maxOutputBytes: 2048 },
    ),
    (error) => {
      assert.match(error.message, /fixture failed at \[url\]/);
      assert.doesNotMatch(error.message, /secret\.invalid/);
      assert.deepEqual(error.childDiagnostics.progressLines, [
        '[performance] startup 1 of 1',
      ]);
      return true;
    },
  );
});

test('invalid smoke input writes a bounded failure artifact without launching a browser', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-cli-test-'),
  );
  t.after(async () => {
    const canonical = await realpath(tempRoot);
    assert.equal(path.dirname(canonical), parent);
    assert.ok(path.basename(canonical).startsWith('gev-build-smoke-cli-test-'));
    await rm(canonical, { recursive: true, force: false });
  });
  const reportPath = path.join(tempRoot, 'smoke.json');
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'qa-performance-build-smoke.mjs'),
      '--candidate-sha',
      'invalid',
      '--out',
      reportPath,
    ],
    { encoding: 'utf8', timeout: 5000, windowsHide: true },
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.schema, 'gev-performance-build-smoke/v1');
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.phase, 'setup');
  assert.match(report.failure.message, /full lowercase Git SHA/);
});
