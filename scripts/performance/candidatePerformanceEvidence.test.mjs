import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyRecordedRenderer,
  evaluateManifestPerformanceEvidence,
} from './candidatePerformanceEvidence.mjs';
import { readValidationManifest } from '../qa-candidate.mjs';
import {
  baselineCommit,
  candidateCommit,
  makeReport,
} from './pairedReportTestFixtures.mjs';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function setupManifest({ comparisons = [], retention = [] } = {}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-performance-evidence-'),
  );
  const writeArtifact = async (name, value) => {
    const filename = `${name}.json`;
    const bytes = Buffer.from(JSON.stringify(value));
    await writeFile(path.join(directory, filename), bytes);
    return {
      path: filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const evidence = { comparisons, retention };
  const manifestPath = path.join(directory, 'manifest.json');
  return { directory, manifestPath, evidence, writeArtifact };
}

function makeRetentionReport(overrides = {}) {
  const checkpoints = [0, 30, 40, 50, 60].map((minutes) => ({
    elapsedMs: minutes * 60_000,
    metrics: {
      JSHeapUsedSize: 100_000_000,
      JSEventListeners: 42,
      garbageCollection: {
        status: 'completed',
        method: 'HeapProfiler.collectGarbage',
      },
      application: {
        workers: { instrumented: true, overflow: false, workers: [] },
        resources: {
          ownerResources: { app: { listeners: 2, primitives: 4 } },
          listeners: 2,
          primitives: 4,
        },
      },
    },
  }));
  return {
    scope: 'rendered-application-fixtures',
    durationMs: 60 * 60_000,
    fullSoak: true,
    candidateCommit,
    applicationCommit: candidateCommit,
    harnessCommit: candidateCommit,
    sourceDirtyAtStart: false,
    sourceChangedDuringRun: false,
    harnessDirtyAtStart: false,
    harnessChangedDuringRun: false,
    operationStatus: 'passed',
    renderer: 'Intel UHD 620',
    graphics: { featureStatus: { webgl: 'enabled', webgl2: 'enabled' } },
    environment: {
      platform: 'win32',
      architecture: 'x64',
      osRelease: 'Windows 11',
      cpu: 'Intel Core i7',
      memoryBytes: 16 * 1024 ** 3,
      hosted: false,
    },
    iterations: 30,
    sourceToggles: 120,
    replaySeeks: 30,
    imports: 30,
    workspaceReloads: 60,
    archiveFailures: 30,
    cameraRecoveries: 30,
    checkpoints,
    stability: { status: 'failed', failures: ['untrusted cached status'] },
    ...overrides,
  };
}

async function createComparison(
  setup,
  {
    environmentId = 'windows-uhd620',
    workloadId = 'dense-investigation',
    patch,
  } = {},
) {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(
    candidateCommit,
    [30, 31, 29, 30, 32],
    [35, 36, 34, 35, 37],
  );
  for (const report of [baseline, candidate]) {
    report.comparisonContract.workloadId = workloadId;
    report.graphics = {
      featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
      devices: [{ vendor: 'Intel', device: 'UHD 620', driver: '31.0' }],
    };
    report.hostEnvironment = {
      platform: 'win32',
      architecture: 'x64',
      osRelease: '10.0.26200',
      cpu: 'Intel Core i7',
      memoryBytes: 16 * 1024 ** 3,
      hosted: false,
      runnerImage: null,
      runnerImageVersion: null,
    };
  }
  patch?.(baseline, candidate);
  const role = `${environmentId}-${workloadId}`.replace(/[^a-z0-9-]/gi, '-');
  return {
    environmentId,
    baselineCommit,
    baseline: await setup.writeArtifact(`${role}-baseline`, baseline),
    candidate: await setup.writeArtifact(`${role}-candidate`, candidate),
  };
}

test('v2 paired evidence is digest-bound, recomputed, and remains pending for uncovered workloads', async () => {
  const setup = await setupManifest();
  setup.evidence.comparisons.push(await createComparison(setup));
  const evaluated = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(evaluated.comparisons[0].validation.status, 'comparable');
  assert.equal(evaluated.comparisons[0].candidateArtifact.sha256.length, 64);
  assert.equal(evaluated.comparison.status, 'pending');
  assert.ok(evaluated.comparison.missingWorkloads.includes('operating-view'));
  assert.equal(evaluated.comparisons[0].renderer.kind, 'native-gpu');
  assert.equal(evaluated.comparisons[0].renderer.physicalDesktopCoverage, true);
});

test('digest tampering, missing files, duplicate roles and wrong app commits fail closed', async () => {
  const setup = await setupManifest();
  const row = await createComparison(setup);
  setup.evidence.comparisons.push(row);
  row.candidate.sha256 = '0'.repeat(64);
  assert.throws(
    () =>
      evaluateManifestPerformanceEvidence(setup.evidence, {
        manifestPath: setup.manifestPath,
        candidateCommit,
      }),
    /SHA-256 does not match/,
  );

  row.candidate.sha256 = createHash('sha256')
    .update(await readFile(path.join(setup.directory, row.candidate.path)))
    .digest('hex');
  setup.evidence.comparisons.push({ ...row });
  assert.throws(
    () =>
      evaluateManifestPerformanceEvidence(setup.evidence, {
        manifestPath: setup.manifestPath,
        candidateCommit,
      }),
    /Duplicate comparison role/,
  );

  setup.evidence.comparisons = [row];
  row.baselineCommit = 'f'.repeat(40);
  const wrongBuild = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(wrongBuild.comparison.status, 'failed');
  assert.match(wrongBuild.comparisons[0].error, /wrong application build/);

  row.baseline.path = 'missing.json';
  assert.throws(() =>
    evaluateManifestPerformanceEvidence(setup.evidence, {
      manifestPath: setup.manifestPath,
      candidateCommit,
    }),
  );
});

test('dense objectives and regressions are assessed from paired raw reports', async () => {
  const setup = await setupManifest();
  setup.evidence.comparisons.push(
    await createComparison(setup, {
      patch: (_baseline, candidate) => {
        for (const capture of candidate.captures) {
          if (capture.scenario !== 'idle') {
            const p95 = capture.scenario === 'scripted-motion' ? 40 : 50;
            capture.frameIntervalMs = { p50: p95, p95, max: p95, samples: 100 };
          }
        }
      },
    }),
  );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.comparison.status, 'failed');
  assert.ok(
    result.comparison.failures.some((message) => /20% objective/.test(message)),
  );
});

test('raw retention is recomputed and requires source, duration, sorted checkpoints and GC provenance', async () => {
  const setup = await setupManifest();
  const raw = makeRetentionReport();
  const report = await setup.writeArtifact('soak', raw);
  setup.evidence.retention.push({ environmentId: 'windows-primary', report });
  const passed = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(passed.retentionOutcome.status, 'passed');
  assert.equal(passed.retention[0].stability.status, 'passed');
  assert.equal(passed.retention[0].renderer.kind, 'native-gpu');

  const noGc = await setup.writeArtifact(
    'soak-no-gc',
    makeRetentionReport({
      checkpoints: makeRetentionReport().checkpoints.map((point) => ({
        ...point,
        metrics: { ...point.metrics, garbageCollection: undefined },
      })),
    }),
  );
  const pending = evaluateManifestPerformanceEvidence(
    { retention: [{ environmentId: 'old-host', report: noGc }] },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
  assert.equal(pending.retentionOutcome.status, 'pending');
  assert.ok(
    pending.retentionOutcome.pending.some((message) => /Post-GC/.test(message)),
  );

  const unordered = await setup.writeArtifact(
    'soak-unordered',
    makeRetentionReport({
      durationMs: -1,
      checkpoints: [
        ...makeRetentionReport().checkpoints.slice(0, 2),
        makeRetentionReport().checkpoints[1],
      ],
    }),
  );
  const failed = evaluateManifestPerformanceEvidence(
    { retention: [{ environmentId: 'bad-host', report: unordered }] },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
  assert.equal(failed.retentionOutcome.status, 'failed');
  assert.ok(
    failed.retentionOutcome.failures.some((message) =>
      /duration/.test(message),
    ),
  );
});

test('complete primary Windows evidence passes with supplemental software rows', async () => {
  const setup = await setupManifest();
  for (const workloadId of [
    'dense-investigation',
    'operating-view',
    'infrastructure-only',
    'weather-effects',
    'lifecycle-stress',
    'map-streaming',
  ]) {
    setup.evidence.comparisons.push(
      await createComparison(setup, { workloadId }),
    );
  }
  setup.evidence.comparisons.push(
    await createComparison(setup, {
      environmentId: 'hosted-swiftshader',
      workloadId: 'operating-view',
      patch: (baseline, candidate) => {
        for (const report of [baseline, candidate]) {
          report.environment.renderer = 'SwiftShader Device (Subzero)';
          report.hostEnvironment.hosted = true;
          for (const capture of report.captures) {
            capture.conditions.before.environment.renderer =
              'SwiftShader Device (Subzero)';
            capture.conditions.after.environment.renderer =
              'SwiftShader Device (Subzero)';
          }
        }
      },
    }),
  );
  const primaryRetention = await setup.writeArtifact(
    'primary-soak',
    makeRetentionReport(),
  );
  const softwareRetention = await setup.writeArtifact(
    'software-soak',
    makeRetentionReport({
      renderer: 'SwiftShader Device (Subzero)',
      environment: { ...makeRetentionReport().environment, hosted: true },
    }),
  );
  setup.evidence.retention.push(
    { environmentId: 'windows-primary', report: primaryRetention },
    { environmentId: 'hosted-swiftshader', report: softwareRetention },
  );

  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(
    result.comparison.status,
    'passed',
    JSON.stringify(result.comparison, null, 2),
  );
  assert.equal(result.comparison.environments.at(-1).status, 'supplemental');
  assert.equal(result.retentionOutcome.status, 'passed');
  assert.equal(result.retentionOutcome.environments[0].status, 'passed');
  assert.equal(result.retentionOutcome.environments[1].status, 'supplemental');
  await writeFile(
    setup.manifestPath,
    JSON.stringify({
      schemaVersion: 2,
      phase: 'pre-release',
      candidateCommit,
      checks: [],
      performanceEvidence: setup.evidence,
    }),
  );
  const manifest = readValidationManifest(setup.manifestPath, {
    candidateCommit,
  });
  assert.equal(manifest.performanceEvidence.comparison.status, 'passed');
  assert.equal(manifest.performanceEvidence.retentionOutcome.status, 'passed');
});

test('partial Windows environments cannot combine workloads into one primary', async () => {
  const setup = await setupManifest();
  setup.evidence.comparisons.push(
    await createComparison(setup, { workloadId: 'dense-investigation' }),
    await createComparison(setup, {
      environmentId: 'windows-second-gpu',
      workloadId: 'operating-view',
    }),
  );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.comparison.status, 'pending');
  assert.ok(
    result.comparison.pending.some((message) =>
      /Multiple physical Windows/.test(message),
    ),
  );
  assert.ok(result.comparison.missingWorkloads.includes('infrastructure'));
});

test('retention needs positive operation totals and a final checkpoint within one second', async () => {
  const setup = await setupManifest();
  const report = makeRetentionReport({
    imports: 0,
    checkpoints: makeRetentionReport().checkpoints.map((point) => ({
      ...point,
      elapsedMs:
        point.elapsedMs === 60 * 60_000 ? 60 * 60_000 - 5000 : point.elapsedMs,
    })),
  });
  const artifact = await setup.writeArtifact('incomplete-final', report);
  setup.evidence.retention.push({
    environmentId: 'windows-primary',
    report: artifact,
  });
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.retentionOutcome.status, 'failed');
  assert.ok(
    result.retentionOutcome.failures.some((message) =>
      /imports count/.test(message),
    ),
  );
  assert.ok(
    result.retention[0].pending.some((message) =>
      /within one second/.test(message),
    ),
  );
});

test('software-only retention remains supplemental and cannot satisfy the Windows gate', async () => {
  const setup = await setupManifest();
  const artifact = await setup.writeArtifact(
    'software-only-soak',
    makeRetentionReport({
      renderer: 'SwiftShader Device (Subzero)',
      environment: { ...makeRetentionReport().environment, hosted: true },
    }),
  );
  setup.evidence.retention.push({
    environmentId: 'hosted-swiftshader',
    report: artifact,
  });
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.retentionOutcome.status, 'pending');
  assert.ok(
    result.retentionOutcome.pending.some((message) =>
      /physical Windows native-GPU/.test(message),
    ),
  );
  assert.equal(result.retentionOutcome.environments[0].status, 'supplemental');
});

test('invalid supplemental retention cannot disappear behind a valid primary run', async () => {
  const setup = await setupManifest();
  const primary = await setup.writeArtifact(
    'valid-primary',
    makeRetentionReport(),
  );
  const invalidSupplemental = await setup.writeArtifact(
    'invalid-supplemental',
    makeRetentionReport({
      candidateCommit: baselineCommit,
      renderer: 'SwiftShader Device (Subzero)',
      environment: { ...makeRetentionReport().environment, hosted: true },
    }),
  );
  setup.evidence.retention.push(
    { environmentId: 'windows-primary', report: primary },
    { environmentId: 'software-supplemental', report: invalidSupplemental },
  );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.retentionOutcome.status, 'failed');
  assert.ok(
    result.retentionOutcome.failures.some((message) =>
      /candidateCommit/.test(message),
    ),
  );
  assert.equal(result.retentionOutcome.environments[1].status, 'failed');
  assert.ok(result.retentionOutcome.environments[1].errors.length > 0);
});

test('renderer classification uses recorded host data, never the ingestion process', () => {
  const software = classifyRecordedRenderer({
    renderer: 'llvmpipe (LLVM 18.1.0)',
    graphics: { featureStatus: { webgl: 'enabled' } },
    environment: { hosted: false },
  });
  assert.equal(software.kind, 'software');
  assert.equal(software.physicalDesktopCoverage, false);
  const paravirtual = classifyRecordedRenderer({
    renderer: 'ANGLE Metal Renderer: Apple Paravirtual device',
    graphics: { featureStatus: { webgl: 'enabled' } },
    environment: { hosted: true },
  });
  assert.equal(paravirtual.kind, 'apple-paravirtual-metal');
  assert.equal(paravirtual.accelerationVerified, true);
  assert.equal(paravirtual.physicalDesktopCoverage, false);
  const unrecorded = classifyRecordedRenderer({ renderer: 'Intel UHD 620' });
  assert.equal(unrecorded.physicalDesktopCoverage, null);
  const incompleteHost = classifyRecordedRenderer({
    renderer: 'Intel UHD 620',
    graphics: { featureStatus: { webgl: 'enabled' } },
    hostEnvironment: { hosted: false, platform: 'win32' },
  });
  assert.equal(incompleteHost.accelerationVerified, true);
  assert.equal(incompleteHost.physicalDesktopCoverage, false);
});
