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

    const candidatePath = matrixReportPath(plan, row, 'candidate');
    const tampered = JSON.parse(await fs.promises.readFile(candidatePath));
    tampered.workload.expectedDensityPct = 50;
    await fs.promises.writeFile(candidatePath, JSON.stringify(tampered));
    assert.throws(
      () => readReusableMatrixReport(plan, row, 'candidate'),
      /50 !== 75/,
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
