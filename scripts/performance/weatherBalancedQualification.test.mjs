import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateManifestPerformanceEvidence } from './candidatePerformanceEvidence.mjs';
import { createObservedWeatherEffectsComparisonContract } from './captureComparisonContract.mjs';
import {
  baselineCommit,
  candidateCommit,
  harnessCommit,
  makeWeatherReport,
} from './pairedReportTestFixtures.mjs';
import {
  createWeatherBalancedCaptureInvocation,
  validateWeatherBalancedEnvelope,
  validateWeatherBalancedPlan,
  WEATHER_BALANCED_ENVELOPE_SCHEMA,
  WEATHER_BALANCED_ORDER,
  WEATHER_BALANCED_PLAN_SCHEMA,
} from './weatherBalancedQualification.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const profile = {
  id: 'native-sharpness-v1',
  useBrowserRecommendedResolution: false,
  resolutionScale: 1,
  maximumScreenSpaceError: 1,
  viewport: { width: 1440, height: 900, dpr: 1 },
  drawingBuffer: { width: 1440, height: 900 },
};
const expectedReadinessReasons = [
  'capture-does-not-have-five-runs-per-scenario',
  'weather-balanced-qualification-shard-is-ineligible-standalone',
].sort();

function makePlan(root) {
  return {
    schema: WEATHER_BALANCED_PLAN_SCHEMA,
    planId: '11111111-2222-4333-8444-555555555555',
    predeclaredAt: '2026-10-19T00:00:00.000Z',
    fixedTime: '2026-10-08T12:00:00.000Z',
    workloadId: 'austin-weather-effects-phased-v2',
    fixtureSha256: createWeatherEffectsWorkloadFixture().sha256,
    comparisonProfile: 'native-sharpness-v1',
    warmupMs: 30_000,
    durationPerSampleMs: 60_000,
    pairCount: 5,
    order: [...WEATHER_BALANCED_ORDER],
    outputRoot: root,
    environmentId: 'native-windows155-test',
    browser: {
      name: 'Chrome',
      version: '152.0.7977.75',
      executable: path.join(root, 'chrome.exe'),
      executableSha256: '3'.repeat(64),
    },
    captureHarness: {
      commit: harnessCommit,
      checkout: path.join(root, 'harness'),
    },
    buildHarness: {
      commit: harnessCommit,
      checkout: path.join(root, 'build-harness'),
    },
    control: {
      appCommit: baselineCommit,
      appCheckout: path.join(root, 'control-app'),
      build: {
        receipt: path.join(root, 'control-receipt.json'),
        receiptSha256: '1'.repeat(64),
        root: path.join(root, 'control-build'),
        baseUrl: 'http://127.0.0.1:4173',
      },
    },
    candidate: {
      appCommit: candidateCommit,
      appCheckout: path.join(root, 'candidate-app'),
      build: {
        receipt: path.join(root, 'candidate-receipt.json'),
        receiptSha256: '2'.repeat(64),
        root: path.join(root, 'candidate-build'),
        baseUrl: 'http://127.0.0.1:4174',
      },
    },
  };
}

function makeShard(commit, role) {
  const report = makeWeatherReport(commit);
  report.url =
    role === 'control' ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:4174';
  report.captures = report.captures.filter((capture) => capture.run === 1);
  report.workload.runsPerScenario = 1;
  report.workload.weatherBalancedQualificationShard = true;
  report.workload.weatherEffectsCaptureMode = 'balanced-qualification-shard';
  report.workload.qualificationShard = true;
  report.workload.performanceAcceptanceEligible = false;
  report.comparisonProfile = 'native-sharpness-v1';
  report.environment.hardwareEligible = true;
  report.environment.nativeSharpnessProfile = structuredClone(profile);
  report.hostEnvironment = {
    platform: 'win32',
    architecture: 'x64',
    osRelease: '10.0.26100',
    cpu: 'Intel Core i9',
    logicalCpus: 16,
    memoryBytes: 32 * 1024 ** 3,
    hosted: false,
    runnerImage: null,
    runnerImageVersion: null,
  };
  report.graphics = {
    browserVersion: 'Chrome/152.0.7977.75',
    featureStatus: {
      webgl: 'enabled',
      webgl2: 'enabled',
      gpu_compositing: 'enabled',
      opengl: 'enabled',
    },
    devices: [{ vendor: 'Intel', device: 'UHD', driver: '1.0' }],
  };
  report.source.buildProvenance.buildHarnessCommit = harnessCommit;
  report.source.buildHarnessCommit = harnessCommit;
  for (const capture of report.captures)
    for (const boundary of ['before', 'after'])
      capture.conditions[boundary].environment.nativeSharpnessProfile =
        structuredClone(profile);
  report.comparisonContract = createObservedWeatherEffectsComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
    workload: {
      warmupMs: report.workload.warmupMs,
      durationPerSampleMs: report.workload.durationPerSampleMs,
      runsPerScenario: 1,
    },
    balancedQualificationShard: true,
  });
  report.comparisonEligible = false;
  report.comparisonReadiness = {
    status: 'not-ready',
    reasons: expectedReadinessReasons,
  };
  return report;
}

function createEnvelope(root, mutate = () => {}) {
  const plan = makePlan(root);
  fs.mkdirSync(root, { recursive: true });
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'qualification-plan.json'), planBytes);
  const children = [];
  let time = Date.parse('2026-10-19T00:01:00.000Z');
  for (let index = 0; index < WEATHER_BALANCED_ORDER.length; index += 1) {
    const role = WEATHER_BALANCED_ORDER[index];
    const report = makeShard(
      role === 'control' ? baselineCommit : candidateCommit,
      role,
    );
    mutate(report, index);
    const startedAt = new Date(time).toISOString();
    const completedAt = new Date(time + 180_001).toISOString();
    report.capturedAt = new Date(time + 30_000).toISOString();
    const bytes = Buffer.from(JSON.stringify(report));
    const file = `sample-${index + 1}.json`;
    fs.writeFileSync(path.join(root, file), bytes);
    time += 180_001;
    children.push({
      path: file,
      sha256: digest(bytes),
      sequence: index + 1,
      role,
      pairIndex: Math.floor(index / 2) + 1,
      pairId: `${plan.planId}-pair-${String(Math.floor(index / 2) + 1).padStart(2, '0')}`,
      runId: `${plan.planId}-${role}-${String(Math.floor(index / 2) + 1).padStart(2, '0')}`,
      startedAt,
      completedAt,
    });
    time += 1;
  }
  const envelope = {
    schema: WEATHER_BALANCED_ENVELOPE_SCHEMA,
    status: 'completed',
    diagnosticOnly: false,
    acceptanceEligible: true,
    planId: plan.planId,
    planArtifact: {
      path: 'qualification-plan.json',
      sha256: digest(planBytes),
    },
    order: [...WEATHER_BALANCED_ORDER],
    startedAt: '2026-10-19T00:00:30.000Z',
    completedAt: new Date(time).toISOString(),
    children,
  };
  return { plan, envelope };
}

test('balanced weather plan fixes a fresh full sharpness workload and exact order', () => {
  const root = path.join(os.tmpdir(), 'gev-weather-balanced-plan');
  const plan = validateWeatherBalancedPlan(makePlan(root));
  assert.deepEqual(plan.order, [
    'control',
    'candidate',
    'candidate',
    'control',
    'control',
    'candidate',
    'candidate',
    'control',
    'control',
    'candidate',
  ]);
  const invocation = createWeatherBalancedCaptureInvocation(
    plan,
    'control',
    path.join(root, 'child.json'),
  );
  assert.ok(invocation.args.includes('--weather-balanced-qualification-shard'));
  assert.ok(invocation.args.includes('--hardware-required'));
  assert.equal(
    invocation.env.PUPPETEER_EXECUTABLE_PATH,
    plan.browser.executable,
  );
  assert.equal(invocation.args[invocation.args.indexOf('--runs') + 1], '1');
  assert.ok(!invocation.args.includes('--weather-interleaved-diagnostic'));
  assert.equal(
    invocation.args[invocation.args.indexOf('--warmup-ms') + 1],
    '30000',
  );
  assert.equal(invocation.args[invocation.args.indexOf('--seconds') + 1], '60');
  assert.throws(() =>
    validateWeatherBalancedPlan({ ...plan, order: [...plan.order].reverse() }),
  );
  assert.throws(() =>
    validateWeatherBalancedPlan({ ...plan, durationPerSampleMs: 30_000 }),
  );
  assert.throws(() =>
    validateWeatherBalancedPlan({ ...plan, warmupMs: 1_000 }),
  );
  assert.throws(() =>
    validateWeatherBalancedPlan({ ...plan, outputRoot: 'archive/weather' }),
  );
});

test('balanced weather envelope validates five complete alternating pairs and aggregates the unchanged threshold', () => {
  const root = path.join(os.tmpdir(), `gev-weather-balanced-${Date.now()}`);
  const { plan, envelope } = createEnvelope(root);
  const result = validateWeatherBalancedEnvelope(envelope, { root, plan });
  assert.equal(result.status, 'comparable');
  assert.equal(result.pairCount, 5);
  assert.equal(result.scenarios['scripted-motion'].baselineRuns.length, 5);
  assert.equal(result.scenarios['scripted-motion'].candidateRuns.length, 5);
  assert.equal(result.scenarios['scripted-motion'].regressionOver10Pct, false);
  assert.equal(result.scenarios.idle.status, 'unavailable');
  assert.equal(result.scenarios.idle.changePct, null);
});

test('balanced weather envelope rejects missing, duplicate, reordered and overlapping shards', () => {
  const invalid = [
    (envelope) => envelope.children.pop(),
    (envelope) => {
      envelope.children[1].runId = envelope.children[0].runId;
    },
    (envelope) => {
      envelope.children[1].path = envelope.children[0].path;
    },
    (envelope) => {
      [envelope.children[0].role, envelope.children[1].role] = [
        envelope.children[1].role,
        envelope.children[0].role,
      ];
    },
    (envelope) => {
      envelope.order.reverse();
    },
    (envelope) => {
      envelope.status = 'failed';
    },
    (envelope) => {
      envelope.diagnosticOnly = true;
    },
    (envelope) => {
      envelope.acceptanceEligible = false;
    },
    (envelope) => {
      envelope.children[1].startedAt = envelope.children[0].startedAt;
    },
    (envelope) => {
      envelope.children[0].completedAt = new Date(
        Date.parse(envelope.children[0].startedAt) + 179_999,
      ).toISOString();
    },
  ];
  for (const mutate of invalid) {
    const root = path.join(
      os.tmpdir(),
      `gev-weather-balanced-invalid-${Date.now()}-${Math.random()}`,
    );
    const { plan, envelope } = createEnvelope(root);
    mutate(envelope);
    assert.throws(() =>
      validateWeatherBalancedEnvelope(envelope, { root, plan }),
    );
  }
});

test('balanced weather envelope rejects wrong commits, settings, diagnostic shards and tampered child bytes', () => {
  const wrongCommitRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-commit-${Date.now()}`,
  );
  const wrongCommit = createEnvelope(wrongCommitRoot, (report, index) => {
    if (index === 1) report.source.appCommit = baselineCommit;
  });
  assert.throws(() =>
    validateWeatherBalancedEnvelope(wrongCommit.envelope, {
      root: wrongCommitRoot,
      plan: wrongCommit.plan,
    }),
  );

  const wrongSettingsRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-settings-${Date.now()}`,
  );
  const wrongSettings = createEnvelope(wrongSettingsRoot, (report, index) => {
    if (index === 0)
      report.captures[0].conditions.before.settings.densityPct = 50;
  });
  assert.throws(() =>
    validateWeatherBalancedEnvelope(wrongSettings.envelope, {
      root: wrongSettingsRoot,
      plan: wrongSettings.plan,
    }),
  );

  const missingScenarioRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-scenario-${Date.now()}`,
  );
  const missingScenario = createEnvelope(
    missingScenarioRoot,
    (report, index) => {
      if (index === 0)
        report.captures = report.captures.filter(
          ({ scenario }) => scenario !== 'scripted-motion',
        );
    },
  );
  assert.throws(() =>
    validateWeatherBalancedEnvelope(missingScenario.envelope, {
      root: missingScenarioRoot,
      plan: missingScenario.plan,
    }),
  );

  const diagnosticRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-diagnostic-${Date.now()}`,
  );
  const diagnostic = createEnvelope(diagnosticRoot, (report, index) => {
    if (index === 0) {
      report.workload.weatherBalancedQualificationShard = false;
      report.comparisonContract.qualificationMode = undefined;
    }
  });
  assert.throws(() =>
    validateWeatherBalancedEnvelope(diagnostic.envelope, {
      root: diagnosticRoot,
      plan: diagnostic.plan,
    }),
  );

  const tamperedRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-tampered-${Date.now()}`,
  );
  const tampered = createEnvelope(tamperedRoot);
  fs.appendFileSync(
    path.join(tamperedRoot, tampered.envelope.children[0].path),
    ' ',
  );
  assert.throws(
    () =>
      validateWeatherBalancedEnvelope(tampered.envelope, {
        root: tamperedRoot,
        plan: tampered.plan,
      }),
    /SHA-256/,
  );
});

test('candidate evidence consumes only the hash-bound balanced envelope', () => {
  const root = path.join(
    os.tmpdir(),
    `gev-weather-balanced-consumer-${Date.now()}`,
  );
  const { plan, envelope } = createEnvelope(path.join(root, 'qualification'));
  const envelopePath = path.join(
    plan.outputRoot,
    'qualification-envelope.json',
  );
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  const envelopeBytes = fs.readFileSync(envelopePath);
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, '{}');
  const reviewed = evaluateManifestPerformanceEvidence(
    {
      comparisons: [
        {
          id: 'weather-balanced-qualification',
          environmentId: plan.environmentId,
          workloadId: 'weather-effects',
          baselineCommit,
          weatherBalancedQualification: {
            path: 'qualification/qualification-envelope.json',
            sha256: digest(envelopeBytes),
          },
        },
      ],
    },
    { manifestPath, candidateCommit },
  );
  assert.equal(reviewed.comparisons[0].validation.status, 'comparable');
  assert.equal(reviewed.comparisons[0].error, null);
  assert.equal(reviewed.comparisons[0].renderer.kind, 'native-gpu');
  assert.equal(reviewed.comparisons[0].validation.controlReport, undefined);
});

test('balanced envelope remains portable when archived outside its capture output root', () => {
  const captureRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-capture-${Date.now()}`,
  );
  const { plan, envelope } = createEnvelope(captureRoot);
  const archiveRoot = path.join(
    os.tmpdir(),
    `gev-weather-balanced-archive-${Date.now()}`,
  );
  fs.cpSync(captureRoot, archiveRoot, { recursive: true });
  const archivedPlan = { ...plan, outputRoot: 'C:\\capture\\native\\root' };
  const archivedPlanBytes = Buffer.from(
    `${JSON.stringify(archivedPlan, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(archiveRoot, 'qualification-plan.json'),
    archivedPlanBytes,
  );
  envelope.planArtifact.sha256 = digest(archivedPlanBytes);
  const result = validateWeatherBalancedEnvelope(envelope, {
    root: archiveRoot,
    plan: archivedPlan,
  });
  assert.equal(result.status, 'comparable');
});
