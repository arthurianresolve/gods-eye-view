import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  baselineCommit,
  candidateCommit,
  makeReport,
} from './pairedReportTestFixtures.mjs';
import {
  createMatrixCaptureInvocation,
  matrixReportPath,
  PERFORMANCE_MATRIX_FIXED_TIME,
  PERFORMANCE_MATRIX_PLAN_SCHEMA,
  PERFORMANCE_MATRIX_ROWS,
  readReusableMatrixReport,
  validateMatrixPair,
  validateMatrixPairWithNativeEvidence,
  validatePerformanceMatrixPlan,
} from './performanceMatrix.mjs';
import { PERFORMANCE_ACCEPTANCE_POLICY_ID } from './candidatePerformanceEvidence.mjs';

function makePlan(root) {
  const revision = (role, appCommit, port) => ({
    appCommit,
    appCheckout: path.join(root, `${role}-checkout`),
    builds: {
      standard: {
        receipt: path.join(root, `${role}-standard-receipt.json`),
        root: path.join(root, `${role}-standard-build`),
        baseUrl: `http://127.0.0.1:${port}`,
      },
      'austin-map-streaming-v1': {
        receipt: path.join(root, `${role}-map-receipt.json`),
        root: path.join(root, `${role}-map-build`),
        baseUrl: `http://127.0.0.1:${port + 10}`,
      },
    },
  });
  return {
    schema: PERFORMANCE_MATRIX_PLAN_SCHEMA,
    acceptancePolicyId: PERFORMANCE_ACCEPTANCE_POLICY_ID,
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    harnessCommit: 'c'.repeat(40),
    harnessCheckout: path.join(root, 'harness'),
    outputRoot: path.join(root, 'output'),
    baseline: revision('baseline', baselineCommit, 4181),
    candidate: revision('candidate', candidateCommit, 4182),
    rows: PERFORMANCE_MATRIX_ROWS.map((row) => ({
      id: row.id,
      order: [...row.order],
    })),
  };
}

test('matrix plan fixes all eight workload identities and balances block order', () => {
  const root = path.join(os.tmpdir(), 'gev-matrix-plan');
  const plan = validatePerformanceMatrixPlan(makePlan(root));
  assert.equal(plan.rows.length, 8);
  assert.equal(
    plan.rows.filter((row) => row.order[0] === 'baseline').length,
    4,
  );
  assert.equal(
    plan.rows.filter((row) => row.order[0] === 'candidate').length,
    4,
  );
  assert.deepEqual(
    plan.rows.map((row) => row.providerFixture),
    [
      'austin-operating-v1',
      'dense-investigation',
      'infrastructure-datacenters',
      'infrastructure-dams',
      'infrastructure-cables',
      'infrastructure',
      'austin-weather-effects-phased-v2',
      'austin-map-streaming-v1',
    ],
  );
  assert.deepEqual(
    plan.rows.map((row) => row.fixedTime),
    [
      '2026-10-12T18:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
      '2026-10-08T12:00:00.000Z',
    ],
  );
});

test('matrix plan rejects missing, duplicate, reordered, or unbalanced rows', () => {
  const root = path.join(os.tmpdir(), 'gev-matrix-invalid');
  const missing = makePlan(root);
  missing.rows.pop();
  assert.throws(() => validatePerformanceMatrixPlan(missing));

  const duplicate = makePlan(root);
  duplicate.rows[1].id = duplicate.rows[0].id;
  assert.throws(() => validatePerformanceMatrixPlan(duplicate));

  const reordered = makePlan(root);
  [reordered.rows[0], reordered.rows[1]] = [
    reordered.rows[1],
    reordered.rows[0],
  ];
  assert.throws(() => validatePerformanceMatrixPlan(reordered));

  const unbalanced = makePlan(root);
  unbalanced.rows[1].order = ['baseline', 'candidate'];
  assert.throws(() => validatePerformanceMatrixPlan(unbalanced));
});

test('matrix capture invocations use exact acceptance settings and workload modes', () => {
  const root = path.join(os.tmpdir(), 'gev-matrix-command');
  const plan = validatePerformanceMatrixPlan(makePlan(root));
  const byId = Object.fromEntries(plan.rows.map((row) => [row.id, row]));
  const dense = createMatrixCaptureInvocation(
    plan,
    byId['dense-investigation'],
    'candidate',
  );
  assert.ok(dense.args.includes('--mixed-layers'));
  assert.ok(dense.args.includes('--hardware-required'));
  assert.equal(
    dense.args[dense.args.indexOf('--provider-fixture-time') + 1],
    '2026-10-08T12:00:00.000Z',
  );
  assert.equal(dense.args[dense.args.indexOf('--runs') + 1], '5');
  assert.equal(
    dense.args[dense.args.indexOf('--comparison-profile') + 1],
    'legacy',
  );
  assert.equal(dense.args[dense.args.indexOf('--warmup-ms') + 1], '30000');
  assert.equal(dense.args[dense.args.indexOf('--seconds') + 1], '60');
  assert.equal(dense.args[dense.args.indexOf('--expected-density') + 1], '75');
  assert.equal(
    dense.args[dense.args.indexOf('--worker-audit-mode') + 1],
    'receipt-only',
  );

  const map = createMatrixCaptureInvocation(
    plan,
    byId['map-streaming'],
    'baseline',
  );
  assert.equal(
    map.args[map.args.indexOf('--build-profile') + 1],
    'austin-map-streaming-v1',
  );
  assert.equal(
    map.args[map.args.indexOf('--worker-audit-mode') + 1],
    'diagnostic',
  );
  assert.ok(!map.args.includes('--mixed-layers'));

  const operating = createMatrixCaptureInvocation(
    plan,
    byId['operating-view'],
    'baseline',
  );
  assert.equal(
    operating.args[operating.args.indexOf('--provider-fixture-time') + 1],
    '2026-10-12T18:00:00.000Z',
  );
});

test('matrix keeps builder identity distinct and pins the same producer for each pair', () => {
  const root = path.join(os.tmpdir(), 'gev-matrix-distinct-producer');
  const input = makePlan(root);
  const oldHarness = {
    commit: input.harnessCommit,
    checkout: input.harnessCheckout,
  };
  input.buildHarness = oldHarness;
  input.harnessCommit = 'd'.repeat(40);
  input.harnessCheckout = path.join(root, 'corrected-producer');
  input.rows[0].captureHarness = oldHarness;
  const plan = validatePerformanceMatrixPlan(input);
  for (const role of ['baseline', 'candidate']) {
    const old = createMatrixCaptureInvocation(plan, plan.rows[0], role);
    assert.equal(old.cwd, oldHarness.checkout);
    assert.equal(
      old.args[old.args.indexOf('--expected-harness-sha') + 1],
      oldHarness.commit,
    );
    assert.ok(!old.args.includes('--expected-build-harness-sha'));
    const corrected = createMatrixCaptureInvocation(plan, plan.rows[1], role);
    assert.equal(corrected.cwd, input.harnessCheckout);
    assert.equal(
      corrected.args[corrected.args.indexOf('--expected-harness-sha') + 1],
      input.harnessCommit,
    );
    assert.equal(
      corrected.args[
        corrected.args.indexOf('--expected-build-harness-sha') + 1
      ],
      oldHarness.commit,
    );
    assert.equal(
      corrected.args[corrected.args.indexOf('--build-harness-checkout') + 1],
      oldHarness.checkout,
    );
  }
  for (const mutation of [
    (p) => {
      p.buildHarness.commit = 'short';
    },
    (p) => {
      delete p.buildHarness.checkout;
    },
    (p) => {
      p.rows[0].captureHarness.commit = 'short';
    },
    (p) => {
      delete p.rows[0].captureHarness.checkout;
    },
  ]) {
    const invalid = structuredClone(input);
    mutation(invalid);
    assert.throws(() => validatePerformanceMatrixPlan(invalid));
  }
});

test('resume never relabels historical captures as a newer producer or builder', async (t) => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-matrix-producer-'),
  );
  t.after(async () => {
    const absolute = await fs.promises.realpath(root);
    assert.equal(
      path.dirname(absolute).toLowerCase(),
      (await fs.promises.realpath(os.tmpdir())).toLowerCase(),
    );
    assert.ok(path.basename(absolute).startsWith('gev-matrix-producer-'));
    await fs.promises.rm(absolute, { recursive: true, force: true });
  });
  const input = makePlan(root);
  input.buildHarness = {
    commit: 'c'.repeat(40),
    checkout: input.harnessCheckout,
  };
  input.harnessCommit = 'd'.repeat(40);
  input.harnessCheckout = path.join(root, 'new-producer');
  const plan = validatePerformanceMatrixPlan(input);
  const row = plan.rows[1];
  const report = makeReport(candidateCommit);
  report.comparisonReadiness = { status: 'ready', reasons: [] };
  report.workload.providerFixture = row.providerFixture;
  report.environment.hardwareEligible = true;
  report.source.harnessCommit = 'd'.repeat(40);
  report.source.buildProvenance.harnessCommit = 'c'.repeat(40);
  report.source.buildProvenance.captureProducerCommit =
    report.source.harnessCommit;
  report.source.buildHarnessCommit = 'c'.repeat(40);
  await fs.promises.mkdir(plan.outputRoot);
  const target = matrixReportPath(plan, row, 'candidate');
  await fs.promises.writeFile(target, JSON.stringify(report));
  assert.equal(
    readReusableMatrixReport(plan, row, 'candidate').source.harnessCommit,
    report.source.harnessCommit,
  );
  report.source.harnessCommit = 'c'.repeat(40);
  await fs.promises.writeFile(target, JSON.stringify(report));
  assert.throws(
    () => readReusableMatrixReport(plan, row, 'candidate'),
    /Capture producer differs/,
  );
  report.source.harnessCommit = 'd'.repeat(40);
  report.source.buildProvenance.harnessCommit = 'd'.repeat(40);
  await fs.promises.writeFile(target, JSON.stringify(report));
  assert.throws(
    () => readReusableMatrixReport(plan, row, 'candidate'),
    /Build harness differs/,
  );
});

test('resume accepts only exact ready hardware reports and revalidates the pair', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-matrix-reuse-'),
  );
  try {
    const plan = validatePerformanceMatrixPlan(makePlan(root));
    await fs.promises.mkdir(plan.outputRoot, { recursive: true });
    const row = plan.rows.find((entry) => entry.id === 'dense-investigation');
    for (const [role, commit] of [
      ['baseline', baselineCommit],
      ['candidate', candidateCommit],
    ]) {
      const report = makeReport(commit);
      report.source.harnessCommit = plan.harnessCommit;
      report.source.buildProvenance.harnessCommit = plan.harnessCommit;
      report.comparisonReadiness = { status: 'ready', reasons: [] };
      report.workload.providerFixture = row.providerFixture;
      report.environment.hardwareEligible = true;
      await fs.promises.writeFile(
        matrixReportPath(plan, row, role),
        JSON.stringify(report),
      );
      assert.equal(
        readReusableMatrixReport(plan, row, role).source.appCommit,
        commit,
      );
    }
    assert.equal(validateMatrixPair(plan, row).status, 'comparable');
    assert.deepEqual(
      await validateMatrixPairWithNativeEvidence(plan, row),
      validateMatrixPair(plan, row),
    );

    const candidatePath = matrixReportPath(plan, row, 'candidate');
    const tampered = JSON.parse(await fs.promises.readFile(candidatePath));
    tampered.workload.expectedDensityPct = 50;
    await fs.promises.writeFile(candidatePath, JSON.stringify(tampered));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /50 !== 75/,
    );
    await assert.rejects(
      validateMatrixPairWithNativeEvidence(plan, row),
      /50 !== 75/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('native resume reconciles the frozen missing top-level label only from every observed boundary', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-matrix-native-reuse-'),
  );
  try {
    const planInput = makePlan(root);
    planInput.comparisonProfile = 'native-sharpness-v1';
    const plan = validatePerformanceMatrixPlan(planInput);
    await fs.promises.mkdir(plan.outputRoot, { recursive: true });
    const row = plan.rows.find((entry) => entry.id === 'dense-investigation');
    const profile = {
      id: 'native-sharpness-v1',
      useBrowserRecommendedResolution: false,
      resolutionScale: 1,
      maximumScreenSpaceError: 1,
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
    };
    for (const [role, commit] of [
      ['baseline', baselineCommit],
      ['candidate', candidateCommit],
    ]) {
      const report = makeReport(commit);
      report.source.harnessCommit = plan.harnessCommit;
      report.source.buildProvenance.harnessCommit = plan.harnessCommit;
      report.comparisonReadiness = { status: 'ready', reasons: [] };
      report.workload.providerFixture = row.providerFixture;
      report.environment.hardwareEligible = true;
      for (const capture of report.captures)
        for (const phase of ['before', 'after']) {
          capture.settings ||= {};
          capture.settings[phase] ||= {};
          capture.settings[phase].nativeSharpnessProfile = profile;
          capture.conditions[phase].settings.nativeSharpnessProfile = profile;
          capture.conditions[phase].environment = {
            nativeSharpnessProfile: profile,
            viewport: profile.viewport,
            drawingBuffer: profile.drawingBuffer,
          };
        }
      await fs.promises.writeFile(
        matrixReportPath(plan, row, role),
        JSON.stringify(report),
      );
      const rawBefore = await fs.promises.readFile(
        matrixReportPath(plan, row, role),
        'utf8',
      );
      assert.equal(
        readReusableMatrixReport(plan, row, role).comparisonProfile,
        'native-sharpness-v1',
      );
      assert.equal(
        await fs.promises.readFile(matrixReportPath(plan, row, role), 'utf8'),
        rawBefore,
      );
    }
    const candidatePath = matrixReportPath(plan, row, 'candidate');
    const candidate = JSON.parse(await fs.promises.readFile(candidatePath));
    delete candidate.captures[0].conditions.before.settings
      .nativeSharpnessProfile;
    await fs.promises.writeFile(candidatePath, JSON.stringify(candidate));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /missing native sharpness profile/,
    );
    for (const location of [
      ['settings', 'before'],
      ['conditions.settings', 'before'],
      ['conditions.environment', 'before'],
    ]) {
      const candidateAgain = JSON.parse(
        await fs.promises.readFile(candidatePath),
      );
      if (location[0] === 'settings')
        delete candidateAgain.captures[0].settings[location[1]]
          .nativeSharpnessProfile;
      else if (location[0] === 'conditions.settings')
        delete candidateAgain.captures[0].conditions[location[1]].settings
          .nativeSharpnessProfile;
      else
        delete candidateAgain.captures[0].conditions[location[1]].environment
          .nativeSharpnessProfile;
      await fs.promises.writeFile(
        candidatePath,
        JSON.stringify(candidateAgain),
      );
      assert.throws(
        () => readReusableMatrixReport(plan, row, 'candidate'),
        /missing native sharpness profile/,
      );
    }
    candidate.captures[0].conditions.before.settings.nativeSharpnessProfile =
      profile;
    candidate.captures[0].conditions.before.environment.nativeSharpnessProfile =
      profile;
    candidate.captures[0].settings.before.nativeSharpnessProfile = profile;
    candidate.environment.nativeSharpnessProfile = {
      ...profile,
      maximumScreenSpaceError: 2,
    };
    await fs.promises.writeFile(candidatePath, JSON.stringify(candidate));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /globe SSE differs|explicit environment native profile differs/,
    );
    candidate.environment.nativeSharpnessProfile = profile;
    candidate.captures[0].conditions.before.environment.viewport = {
      ...profile.viewport,
      dpr: 1.5,
    };
    await fs.promises.writeFile(candidatePath, JSON.stringify(candidate));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /boundary viewport differs/,
    );
    candidate.captures[0].conditions.before.environment.viewport =
      profile.viewport;
    candidate.comparisonProfile = 'legacy';
    await fs.promises.writeFile(candidatePath, JSON.stringify(candidate));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /comparison profile differs/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('resume accepts the bounded legacy map mode only from exact sample settings', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-matrix-map-mode-'),
  );
  try {
    const plan = validatePerformanceMatrixPlan(makePlan(root));
    await fs.promises.mkdir(plan.outputRoot, { recursive: true });
    const row = plan.rows.find((entry) => entry.id === 'map-streaming');
    const report = makeReport(candidateCommit);
    report.source.harnessCommit = plan.harnessCommit;
    report.source.buildProvenance.harnessCommit = plan.harnessCommit;
    report.comparisonReadiness = { status: 'ready', reasons: [] };
    report.workload.providerFixture = row.providerFixture;
    report.workload.detectionMode = null;
    report.environment.hardwareEligible = true;
    const reportPath = matrixReportPath(plan, row, 'candidate');
    await fs.promises.writeFile(reportPath, JSON.stringify(report));
    assert.equal(
      readReusableMatrixReport(plan, row, 'candidate').workload.detectionMode,
      null,
    );

    report.captures[0].conditions.before.settings.detectionMode = 'SPARSE';
    await fs.promises.writeFile(reportPath, JSON.stringify(report));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /SPARSE.*DENSE/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('report output stays inside the declared root and local URLs reject credentials', () => {
  const root = path.join(os.tmpdir(), 'gev-matrix-paths');
  const raw = makePlan(root);
  raw.baseline.builds.standard.baseUrl = 'http://user:secret@127.0.0.1:4181';
  assert.throws(
    () => validatePerformanceMatrixPlan(raw),
    /must not contain credentials/,
  );
});

test('matrix CLI dry-run records the immutable schedule without launching Chrome', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-matrix-dry-run-'),
  );
  try {
    const rawPlan = makePlan(root);
    const planPath = path.join(root, 'plan.json');
    const resultPath = path.join(rawPlan.outputRoot, 'matrix.json');
    await fs.promises.writeFile(planPath, JSON.stringify(rawPlan));
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('scripts', 'capture-performance-matrix.mjs'),
        '--plan',
        planPath,
        '--out',
        resultPath,
        '--dry-run',
      ],
      { encoding: 'utf8', cwd: path.resolve('.') },
    );
    assert.equal(result.status, 0, result.stderr);
    const artifact = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
    assert.equal(artifact.status, 'planned');
    assert.equal(artifact.rows.length, 8);
    assert.deepEqual(
      artifact.rows.map((row) => row.order[0]),
      [
        'baseline',
        'candidate',
        'baseline',
        'candidate',
        'baseline',
        'candidate',
        'baseline',
        'candidate',
      ],
    );
    assert.ok(
      artifact.rows.every((row) =>
        row.execution.every((entry) => entry.disposition === 'planned'),
      ),
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
