import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalPerformanceWorkloadId,
  classifyRecordedRenderer,
  evaluateManifestPerformanceEvidence,
  PERFORMANCE_ACCEPTANCE_POLICY_ID,
  PERFORMANCE_WORKLOAD_VALIDATION_MODES,
  REQUIRED_PERFORMANCE_WORKLOADS,
} from './candidatePerformanceEvidence.mjs';
import { readValidationManifest } from '../qa-candidate.mjs';
import { AUSTIN_OPERATING_WORKLOAD_ID } from './austinOperatingWorkloadContract.mjs';
import { INFRASTRUCTURE_WORKLOAD_IDS } from './infrastructureWorkloadContract.mjs';
import { MAP_STREAMING_WORKLOAD_ID } from './mapStreamingWorkloadContract.mjs';
import {
  baselineCommit,
  candidateCommit,
  makeInfrastructureReport,
  makeMapReport,
  makeReport,
  makeWeatherReport,
} from './pairedReportTestFixtures.mjs';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const EVIDENCE_TEMP_PREFIX = 'gev-performance-evidence-';
const ownedEvidenceDirectories = new Set();

test('candidate workload mapping recognizes the Austin producer identity', () => {
  assert.equal(AUSTIN_OPERATING_WORKLOAD_ID, 'austin-operating-v1');
  assert.equal(
    canonicalPerformanceWorkloadId(AUSTIN_OPERATING_WORKLOAD_ID),
    'operating-view',
  );
  for (const workloadId of INFRASTRUCTURE_WORKLOAD_IDS)
    assert.equal(canonicalPerformanceWorkloadId(workloadId), 'infrastructure');
  assert.equal(
    canonicalPerformanceWorkloadId('infrastructure-only'),
    'infrastructure-only',
  );
  assert.equal(
    canonicalPerformanceWorkloadId(MAP_STREAMING_WORKLOAD_ID),
    'map-streaming',
  );
});

after(async () => {
  for (const directory of ownedEvidenceDirectories) {
    const basename = path.basename(directory);
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(basename.startsWith(EVIDENCE_TEMP_PREFIX));
    assert.equal(basename.length, EVIDENCE_TEMP_PREFIX.length + 6);
    await rm(directory, { recursive: true, force: false });
  }
});

async function setupManifest({ comparisons = [], retention = [] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), EVIDENCE_TEMP_PREFIX));
  ownedEvidenceDirectories.add(directory);
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
  const reportFactory = INFRASTRUCTURE_WORKLOAD_IDS.includes(workloadId)
    ? (commit) => makeInfrastructureReport(commit, workloadId)
    : workloadId === MAP_STREAMING_WORKLOAD_ID
      ? (commit) => makeMapReport(commit, commit === candidateCommit ? 15 : 20)
      : workloadId === 'weather-effects'
        ? makeWeatherReport
        : makeReport;
  const baseline = reportFactory(baselineCommit);
  const candidate = INFRASTRUCTURE_WORKLOAD_IDS.includes(workloadId)
    ? reportFactory(candidateCommit)
    : reportFactory(
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

function makeHostedRetentionEnvelope() {
  const environment = {
    platform: 'darwin',
    architecture: 'arm64',
    osRelease: '25.6.0',
    cpu: 'Apple M1 (Virtual)',
    memoryBytes: 7 * 1024 ** 3,
    hosted: true,
  };
  return {
    schema: 'gev-hosted-native-renderer/v1',
    status: 'passed',
    commit: candidateCommit,
    harnessCommit: candidateCommit,
    sourceDirtyAtStart: false,
    harnessDirtyAtStart: false,
    sourceChangedDuringRun: false,
    harnessChangedDuringRun: false,
    platform: 'darwin',
    environment: { ...environment },
    browserClose: { closeCompleted: true, forcedProcessTermination: false },
    probeBrowserClose: {
      closeCompleted: true,
      forcedProcessTermination: false,
    },
    soak: makeRetentionReport({
      renderer: {
        renderer:
          'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)',
      },
      environment: { ...environment },
    }),
  };
}

async function evaluateRetentionArtifact(setup, value, name = 'hosted-soak') {
  const artifact = await setup.writeArtifact(name, value);
  return evaluateManifestPerformanceEvidence(
    { retention: [{ environmentId: name, report: artifact }] },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
}

test('hosted soak envelope is consumed intact as supplemental evidence', async () => {
  const setup = await setupManifest();
  const envelope = makeHostedRetentionEnvelope();
  const result = await evaluateRetentionArtifact(setup, envelope);
  const row = result.retention[0];
  assert.equal(row.status, 'passed', JSON.stringify(row));
  assert.equal(row.artifactFormat, 'hosted-envelope');
  assert.equal(row.artifact.sha256, digest(envelope));
  assert.notEqual(row.artifact.sha256, digest(envelope.soak));
  assert.equal(row.stability.status, 'passed');
  assert.equal(row.renderer.kind, 'apple-paravirtual-metal');
  assert.equal(row.renderer.accelerationVerified, true);
  assert.equal(row.primaryEligible, false);
  assert.equal(result.retentionOutcome.environments[0].status, 'supplemental');
  assert.equal(result.retentionOutcome.status, 'pending');
});

test('failed hosted envelope or cleanup cannot be hidden by a passing inner soak', async (t) => {
  for (const [name, patch, error] of [
    [
      'failed-run',
      (value) => {
        value.status = 'failed';
      },
      /failed run/,
    ],
    [
      'cleanup-error',
      (value) => {
        value.cleanupError = 'close failed';
      },
      /incomplete browser cleanup/,
    ],
    [
      'forced-close',
      (value) => {
        value.browserClose.forcedProcessTermination = true;
      },
      /incomplete browser cleanup/,
    ],
    [
      'incomplete-close',
      (value) => {
        value.browserClose.closeCompleted = false;
      },
      /incomplete browser cleanup/,
    ],
    [
      'forced-probe-close',
      (value) => {
        value.probeBrowserClose.forcedProcessTermination = true;
      },
      /incomplete browser cleanup/,
    ],
  ]) {
    await t.test(name, async () => {
      const setup = await setupManifest();
      const envelope = makeHostedRetentionEnvelope();
      patch(envelope);
      const result = await evaluateRetentionArtifact(setup, envelope, name);
      assert.equal(result.retention[0].stability.status, 'passed');
      assert.equal(result.retentionOutcome.status, 'failed');
      assert.ok(
        result.retention[0].errors.some((message) => error.test(message)),
      );
    });
  }
});

test('hosted envelope rejects contradictory commits, source provenance and environments', async (t) => {
  const cases = [
    [
      'outer-commit',
      (value) => {
        value.commit = baselineCommit;
      },
      /does not match the candidate/,
    ],
    [
      'outer-harnessCommit',
      (value) => {
        value.harnessCommit = baselineCommit;
      },
      /harnessCommit disagree/,
    ],
    ...['candidateCommit', 'applicationCommit'].map((field) => [
      `inner-${field}`,
      (value) => {
        value.soak[field] = baselineCommit;
      },
      /does not match the candidate/,
    ]),
    [
      'inner-harnessCommit',
      (value) => {
        value.soak.harnessCommit = baselineCommit;
      },
      /harnessCommit disagree/,
    ],
    ...[
      'sourceDirtyAtStart',
      'harnessDirtyAtStart',
      'sourceChangedDuringRun',
      'harnessChangedDuringRun',
    ].flatMap((field) => [
      [
        `outer-${field}`,
        (value) => {
          value[field] = true;
        },
        /dirty|disagree/,
      ],
      [
        `inner-${field}`,
        (value) => {
          value.soak[field] = true;
        },
        /dirty|disagree/,
      ],
    ]),
    [
      'platform-mismatch',
      (value) => {
        value.soak.environment.platform = 'win32';
      },
      /platforms disagree/,
    ],
    [
      'outer-platform-mismatch',
      (value) => {
        value.platform = 'linux';
      },
      /platforms disagree/,
    ],
    [
      'hosted-mismatch',
      (value) => {
        value.soak.environment.hosted = false;
      },
      /physical desktop/,
    ],
  ];
  for (const [name, patch, error] of cases) {
    await t.test(name, async () => {
      const setup = await setupManifest();
      const envelope = makeHostedRetentionEnvelope();
      patch(envelope);
      const result = await evaluateRetentionArtifact(setup, envelope, name);
      assert.equal(result.retentionOutcome.status, 'failed');
      assert.ok(
        result.retention[0].errors.some((message) => error.test(message)),
      );
      assert.equal(result.retention[0].primaryEligible, false);
    });
  }
});

test('missing hosted provenance stays pending without filling from the other level', async (t) => {
  const cases = [
    [
      'outer-commit',
      (value) => {
        delete value.commit;
      },
      /envelope commit/,
    ],
    [
      'outer-harness',
      (value) => {
        delete value.harnessCommit;
      },
      /envelope harnessCommit/,
    ],
    [
      'inner-harness',
      (value) => {
        delete value.soak.harnessCommit;
      },
      /Raw soak harnessCommit/,
    ],
    [
      'outer-cleanliness',
      (value) => {
        delete value.sourceDirtyAtStart;
      },
      /envelope sourceDirtyAtStart/,
    ],
    [
      'inner-cleanliness',
      (value) => {
        delete value.soak.sourceDirtyAtStart;
      },
      /Raw soak source cleanliness/,
    ],
    [
      'cleanup',
      (value) => {
        delete value.browserClose;
      },
      /cleanup evidence/,
    ],
    [
      'probe-cleanup',
      (value) => {
        delete value.probeBrowserClose;
      },
      /cleanup evidence/,
    ],
    [
      'unknown-force-status',
      (value) => {
        delete value.browserClose.forcedProcessTermination;
      },
      /cleanup evidence/,
    ],
    [
      'hosted',
      (value) => {
        delete value.environment.hosted;
      },
      /environment provenance/,
    ],
    [
      'platform',
      (value) => {
        delete value.soak.environment.platform;
      },
      /platform identity/,
    ],
    [
      'unfinished',
      (value) => {
        value.status = 'running';
      },
      /completed status/,
    ],
  ];
  for (const [name, patch, pending] of cases) {
    await t.test(name, async () => {
      const setup = await setupManifest();
      const envelope = makeHostedRetentionEnvelope();
      patch(envelope);
      const result = await evaluateRetentionArtifact(setup, envelope, name);
      assert.equal(result.retention[0].status, 'pending');
      assert.ok(
        result.retention[0].pending.some((message) => pending.test(message)),
      );
      assert.equal(result.retentionOutcome.status, 'pending');
      assert.equal(result.retentionOutcome.environments[0].status, 'pending');
      assert.equal(result.retention[0].artifact.sha256, digest(envelope));
    });
  }
});

test('hosted report without a soak fails rather than becoming retention evidence', async () => {
  const setup = await setupManifest();
  const envelope = makeHostedRetentionEnvelope();
  delete envelope.soak;
  const result = await evaluateRetentionArtifact(setup, envelope);
  assert.equal(result.retentionOutcome.status, 'failed');
  assert.ok(
    result.retention[0].errors.includes('Raw soak checkpoints are malformed.'),
  );
});

test('changing only the hosted wrapper invalidates the manifest digest', async () => {
  const setup = await setupManifest();
  const envelope = makeHostedRetentionEnvelope();
  const report = await setup.writeArtifact('hosted-soak', envelope);
  envelope.status = 'failed';
  await writeFile(
    path.join(setup.directory, report.path),
    JSON.stringify(envelope),
  );
  assert.throws(
    () =>
      evaluateManifestPerformanceEvidence(
        { retention: [{ environmentId: 'hosted', report }] },
        { manifestPath: setup.manifestPath, candidateCommit },
      ),
    /SHA-256 does not match/,
  );
});

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

test('20% objective misses are reported without failing the regression gate', async () => {
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
  assert.equal(result.comparison.status, 'pending');
  assert.deepEqual(result.comparison.failures, []);
  assert.equal(
    result.comparison.acceptancePolicyId,
    PERFORMANCE_ACCEPTANCE_POLICY_ID,
  );
  assert.deepEqual(
    result.comparison.performanceObjectives.map(
      (objective) => objective.status,
    ),
    ['missed', 'missed'],
  );
  assert.ok(
    result.comparison.performanceObjectives.every((objective) =>
      Number.isFinite(objective.actualImprovementPct),
    ),
  );
  assert.ok(
    result.comparison.workloadIds.includes('selected-aircraft-tracking'),
  );

  const regression = await createComparison(setup, {
    patch: (_baseline, candidate) => {
      for (const capture of candidate.captures) {
        if (capture.scenario === 'scripted-motion') {
          capture.frameIntervalMs = {
            p50: 50,
            p95: 50,
            max: 50,
            samples: 100,
          };
        }
      }
    },
  });
  const regressed = evaluateManifestPerformanceEvidence(
    { comparisons: [regression], retention: [] },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
  assert.equal(regressed.comparison.status, 'failed');
  assert.ok(
    regressed.comparison.failures.some((message) =>
      /regression over 10%/.test(message),
    ),
  );
});

test('achieved objective percentages remain visible from validated measurements', async () => {
  const setup = await setupManifest();
  setup.evidence.comparisons.push(await createComparison(setup));
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.deepEqual(
    result.comparison.performanceObjectives.map(
      (objective) => objective.status,
    ),
    ['achieved', 'achieved'],
  );
  assert.ok(
    result.comparison.performanceObjectives.every(
      (objective) => objective.actualImprovementPct >= 20,
    ),
  );
  assert.ok(
    result.comparison.workloadIds.includes('selected-aircraft-tracking'),
  );
});

test('missing dense and tracking measurements stay pending and do not imply coverage', async () => {
  const setup = await setupManifest();
  for (const workloadId of [
    'operating-view',
    INFRASTRUCTURE_WORKLOAD_IDS[0],
    'weather-effects',
  ])
    setup.evidence.comparisons.push(
      await createComparison(setup, { workloadId }),
    );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.comparison.status, 'pending');
  assert.deepEqual(
    result.comparison.performanceObjectives.map(
      (objective) => objective.status,
    ),
    ['unassessed', 'unassessed'],
  );
  assert.ok(result.comparison.missingWorkloads.includes('dense-investigation'));
  assert.deepEqual(result.comparison.infrastructureVariantCoverage, {
    requiredVariants: [...INFRASTRUCTURE_WORKLOAD_IDS],
    observedVariants: [INFRASTRUCTURE_WORKLOAD_IDS[0]],
    missingVariants: INFRASTRUCTURE_WORKLOAD_IDS.slice(1),
  });
  assert.ok(
    result.comparison.pending.some((message) =>
      INFRASTRUCTURE_WORKLOAD_IDS.slice(1).every((id) => message.includes(id)),
    ),
  );
  assert.ok(
    result.comparison.missingWorkloads.includes('selected-aircraft-tracking'),
  );
});

test('infrastructure evaluator coverage rejects a tampered producer asset identity', async () => {
  const setup = await setupManifest();
  setup.evidence.comparisons.push(
    await createComparison(setup, {
      workloadId: INFRASTRUCTURE_WORKLOAD_IDS[0],
      patch: (_baseline, candidate) => {
        candidate.fixtureDelivery.assets[0].sha256 = 'f'.repeat(64);
      },
    }),
  );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.comparison.status, 'failed');
  assert.ok(
    result.comparison.failures.some((message) =>
      /infrastructure-datacenters/.test(message),
    ),
  );
  assert.deepEqual(result.comparison.infrastructureVariantCoverage, {
    requiredVariants: [...INFRASTRUCTURE_WORKLOAD_IDS],
    observedVariants: [],
    missingVariants: [...INFRASTRUCTURE_WORKLOAD_IDS],
  });
});

test('lifecycle stress is a retention mode and cannot fill timed workload coverage', async () => {
  assert.equal(
    PERFORMANCE_ACCEPTANCE_POLICY_ID,
    'gev-cesium-acceptance/2026-10-15',
  );
  assert.equal(
    PERFORMANCE_WORKLOAD_VALIDATION_MODES['lifecycle-stress'],
    'full-soak-retention',
  );
  assert.deepEqual(Object.keys(PERFORMANCE_WORKLOAD_VALIDATION_MODES).sort(), [
    'dense-investigation',
    'infrastructure',
    'lifecycle-stress',
    'map-streaming',
    'operating-view',
    'selected-aircraft-tracking',
    'weather-effects',
  ]);
  assert.ok(!REQUIRED_PERFORMANCE_WORKLOADS.includes('lifecycle-stress'));

  const setup = await setupManifest();
  setup.evidence.comparisons.push(await createComparison(setup));
  setup.evidence.retention.push({
    environmentId: 'windows-primary',
    report: await setup.writeArtifact('primary-soak', makeRetentionReport()),
  });
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.retentionOutcome.status, 'passed');
  assert.equal(result.comparison.status, 'pending');
  assert.deepEqual(
    result.comparison.workloadValidationModes,
    PERFORMANCE_WORKLOAD_VALIDATION_MODES,
  );
  assert.ok(result.comparison.missingWorkloads.includes('map-streaming'));
  assert.ok(result.comparison.missingWorkloads.includes('infrastructure'));
  assert.ok(!result.comparison.workloadIds.includes('lifecycle-stress'));

  const lifecyclePair = await createComparison(setup, {
    workloadId: 'lifecycle-stress',
  });
  const pairedSoakOnly = evaluateManifestPerformanceEvidence(
    {
      comparisons: [lifecyclePair],
      retention: setup.evidence.retention,
    },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
  assert.equal(pairedSoakOnly.retentionOutcome.status, 'passed');
  assert.equal(pairedSoakOnly.comparison.status, 'failed');
  assert.ok(
    pairedSoakOnly.comparison.failures.some((message) =>
      /only by the standalone full-soak retention report/.test(message),
    ),
  );
  assert.ok(
    !pairedSoakOnly.comparison.workloadIds.includes('lifecycle-stress'),
  );
});

test('software-only comparisons cannot satisfy primary objective coverage', async () => {
  const setup = await setupManifest();
  for (const workloadId of [
    'dense-investigation',
    'operating-view',
    ...INFRASTRUCTURE_WORKLOAD_IDS,
    'weather-effects',
  ]) {
    setup.evidence.comparisons.push(
      await createComparison(setup, {
        environmentId: 'hosted-swiftshader',
        workloadId,
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
  }
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.comparison.status, 'pending');
  assert.deepEqual(result.comparison.workloadIds, []);
  assert.deepEqual(
    result.comparison.performanceObjectives.map(
      (objective) => objective.status,
    ),
    ['unassessed', 'unassessed'],
  );
  assert.ok(
    result.comparison.pending.some((message) =>
      /physical Windows/.test(message),
    ),
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
  assert.equal(passed.retention[0].artifactFormat, 'standalone-soak');

  const separateHarness = baselineCommit;
  const harnessArtifact = await setup.writeArtifact(
    'soak-separate-harness',
    makeRetentionReport({ harnessCommit: separateHarness }),
  );
  const harnessValidated = evaluateManifestPerformanceEvidence(
    {
      retention: [
        { environmentId: 'windows-separate-harness', report: harnessArtifact },
      ],
    },
    { manifestPath: setup.manifestPath, candidateCommit },
  );
  assert.equal(harnessValidated.retentionOutcome.status, 'passed');
  assert.equal(harnessValidated.retention[0].harnessCommit, separateHarness);

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

test('complete available primary evidence covers every timed family', async () => {
  const setup = await setupManifest();
  for (const workloadId of [
    'dense-investigation',
    'operating-view',
    ...INFRASTRUCTURE_WORKLOAD_IDS,
    'weather-effects',
    MAP_STREAMING_WORKLOAD_ID,
  ]) {
    setup.evidence.comparisons.push(
      await createComparison(setup, {
        workloadId,
        patch:
          workloadId === 'dense-investigation'
            ? (_baseline, candidate) => {
                for (const capture of candidate.captures) {
                  if (capture.scenario === 'scripted-motion') {
                    capture.frameIntervalMs = {
                      p50: 40,
                      p95: 40,
                      max: 40,
                      samples: 100,
                    };
                  } else if (
                    capture.scenario === 'selected-aircraft-tracking'
                  ) {
                    capture.frameIntervalMs = {
                      p50: 45,
                      p95: 45,
                      max: 45,
                      samples: 100,
                    };
                  }
                }
              }
            : undefined,
      }),
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
  assert.deepEqual(result.comparison.missingWorkloads, []);
  assert.equal(
    result.comparison.acceptancePolicyId,
    PERFORMANCE_ACCEPTANCE_POLICY_ID,
  );
  assert.deepEqual(
    result.comparison.performanceObjectives.map(
      (objective) => objective.status,
    ),
    ['missed', 'missed'],
  );
  assert.equal(result.comparison.environments.at(-1).status, 'supplemental');
  assert.deepEqual(result.comparison.infrastructureVariantCoverage, {
    requiredVariants: [...INFRASTRUCTURE_WORKLOAD_IDS],
    observedVariants: [...INFRASTRUCTURE_WORKLOAD_IDS].sort(),
    missingVariants: [],
  });
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

test('missing supplemental cleanup remains pending beside a valid primary run', async () => {
  const setup = await setupManifest();
  const hosted = makeHostedRetentionEnvelope();
  delete hosted.probeBrowserClose;
  setup.evidence.retention.push(
    {
      environmentId: 'windows-primary',
      report: await setup.writeArtifact('primary', makeRetentionReport()),
    },
    {
      environmentId: 'hosted',
      report: await setup.writeArtifact('hosted', hosted),
    },
  );
  const result = evaluateManifestPerformanceEvidence(setup.evidence, {
    manifestPath: setup.manifestPath,
    candidateCommit,
  });
  assert.equal(result.retentionOutcome.status, 'pending');
  assert.equal(result.retentionOutcome.environments[1].status, 'pending');
  assert.ok(
    result.retentionOutcome.pending.some((message) =>
      /hosted: Hosted probe browser cleanup/.test(message),
    ),
  );
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
