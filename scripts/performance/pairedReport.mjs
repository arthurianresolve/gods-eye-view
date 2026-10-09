import assert from 'node:assert/strict';
import { assertCaptureIntegrity } from './captureIntegrity.mjs';

const CAPTURE_SCHEMA = 'gev-performance-capture/v1';
const COMPARISON_SCHEMA = 'gev-performance-comparison-contract/v1';
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};
const equal = (left, right, message) =>
  assert.deepEqual(canonical(left), canonical(right), message);
const requireText = (value, label) =>
  assert.ok(typeof value === 'string' && value.trim(), `${label} is required`);
const finitePositive = (value, label) =>
  assert.ok(
    Number.isFinite(value) && value > 0,
    `${label} must be finite and positive`,
  );
const finiteNonNegative = (value, label) =>
  assert.ok(
    Number.isFinite(value) && value >= 0,
    `${label} must be finite and non-negative`,
  );
const validCount = (value, label) =>
  assert.ok(
    Number.isInteger(value) && value >= 0,
    `${label} must be a non-negative integer`,
  );

function validateContract(report, label) {
  const contract = report.comparisonContract;
  assert.equal(
    contract?.schema,
    COMPARISON_SCHEMA,
    `${label}: missing or unsupported comparison contract`,
  );
  assert.ok(contract.fixture, `${label}: fixture identity is required`);
  requireText(contract.fixture.id, `${label}: fixture id`);
  assert.match(
    contract.fixture.sha256 || '',
    SHA256,
    `${label}: fixture SHA-256 is required`,
  );
  requireText(contract.fixture.fixedTime, `${label}: fixed fixture time`);
  assert.ok(
    Number.isFinite(Date.parse(contract.fixture.fixedTime)),
    `${label}: fixed fixture time must be a valid timestamp`,
  );
  requireText(contract.workloadId, `${label}: workload identity`);
  assert.ok(
    contract.routes && typeof contract.routes === 'object',
    `${label}: route descriptors are required`,
  );
  assert.ok(
    Array.isArray(contract.populations) && contract.populations.length,
    `${label}: exact populations are required`,
  );
  assert.ok(
    Array.isArray(contract.objectiveScenarios),
    `${label}: objective scenarios are required`,
  );
  assert.ok(
    contract.objectiveScenarios.length,
    `${label}: objective scenarios must be declared`,
  );
  assert.equal(
    new Set(contract.objectiveScenarios).size,
    contract.objectiveScenarios.length,
    `${label}: duplicate objective scenario`,
  );
  for (const scenario of contract.objectiveScenarios)
    requireText(scenario, `${label}: objective scenario`);
  if (contract.workloadId === 'dense-investigation') {
    assert.ok(
      contract.objectiveScenarios.includes('scripted-motion'),
      `${label}: dense-investigation requires scripted-motion objective`,
    );
    assert.ok(
      contract.objectiveScenarios.includes('selected-aircraft-tracking'),
      `${label}: dense-investigation requires selected-aircraft-tracking objective`,
    );
  }
  assert.equal(
    contract.visual?.qualityMode,
    'manual',
    `${label}: comparison requires Manual quality`,
  );
  assert.equal(
    contract.visual?.detectionMode,
    'DENSE',
    `${label}: comparison requires Dense detection`,
  );
  assert.equal(
    contract.visual?.densityPct,
    75,
    `${label}: comparison requires 75% density`,
  );

  const populations = contract.populations;
  const ids = populations.map((row) => row?.id);
  assert.ok(
    ids.every((id) => typeof id === 'string' && id),
    `${label}: population ids are required`,
  );
  assert.equal(
    new Set(ids).size,
    ids.length,
    `${label}: duplicate population id`,
  );
  for (const row of populations) {
    assert.equal(
      typeof row.enabled,
      'boolean',
      `${label}: population ${row.id} enabled flag is required`,
    );
    assert.equal(
      row.enabled,
      true,
      `${label}: required population ${row.id} must be enabled`,
    );
    validCount(row.count, `${label}: population ${row.id} count`);
  }
  if (contract.workloadId === 'dense-investigation') {
    const denseCounts = {
      flights: 2500,
      'local-datacenters': 4362,
      'local-dams': 716,
    };
    for (const [id, count] of Object.entries(denseCounts)) {
      const population = populations.find((row) => row.id === id);
      assert.ok(population, `${label}: dense-investigation is missing ${id}`);
      assert.equal(
        population.count,
        count,
        `${label}: dense-investigation has the wrong ${id} population`,
      );
    }
  }

  const browser = contract.browser;
  requireText(browser?.name, `${label}: browser name`);
  requireText(browser?.version, `${label}: browser version`);
  return contract;
}

function layerSignature(layers, label) {
  assert.ok(Array.isArray(layers), `${label}: layer populations are missing`);
  const enabled = layers.filter((layer) => layer?.enabled === true);
  return enabled
    .map((layer) => {
      requireText(layer.id, `${label}: enabled population id`);
      validCount(layer.count, `${label}: population ${layer.id} count`);
      return { id: layer.id, enabled: true, count: layer.count };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
function validateRoute(route, scenario, durationMs, label) {
  requireText(route?.id, `${label}: route id`);
  const start = route?.start;
  assert.ok(
    start && typeof start === 'object',
    `${label}: route start pose is required`,
  );
  for (const vectorName of ['position', 'direction', 'up']) {
    const vector = start[vectorName];
    assert.ok(
      vector && typeof vector === 'object',
      `${label}: route start ${vectorName} is required`,
    );
    for (const axis of ['x', 'y', 'z'])
      assert.ok(
        Number.isFinite(vector[axis]),
        `${label}: route start ${vectorName}.${axis} must be finite`,
      );
  }
  assert.ok(
    Array.isArray(start.transform) && start.transform.length === 16,
    `${label}: route start transform must contain 16 values`,
  );
  assert.ok(
    start.transform.every(Number.isFinite),
    `${label}: route start transform must be finite`,
  );
  assert.equal(
    route.elapsedDurationMs,
    durationMs,
    `${label}: route elapsed duration must match the measurement window`,
  );
  finiteNonNegative(route.motionDistanceM, `${label}: route motion distance`);
  if (scenario === 'scripted-motion')
    finitePositive(
      route.motionDistanceM,
      `${label}: scripted route motion distance`,
    );
  if (scenario === 'idle')
    assert.equal(
      route.motionDistanceM,
      0,
      `${label}: idle route must remain parked`,
    );
  if (scenario === 'selected-aircraft-tracking') {
    requireText(route.selectedIdentity, `${label}: tracked identity`);
    requireText(route.trajectoryId, `${label}: tracked trajectory identity`);
  }
}
const populationSignature = (populations) =>
  [...populations]
    .map((row) => ({ id: row.id, enabled: row.enabled, count: row.count }))
    .sort((a, b) => a.id.localeCompare(b.id));

function validateReport(report, side, expectedAppCommit) {
  assert.equal(
    report?.schema,
    CAPTURE_SCHEMA,
    `${side}: unsupported capture report schema`,
  );
  assert.match(
    expectedAppCommit || '',
    SHA1,
    `${side}: explicit full application SHA is required`,
  );
  assert.match(
    report.source?.appCommit || '',
    SHA1,
    `${side}: report application SHA is missing`,
  );
  assert.equal(
    report.source.appCommit,
    expectedAppCommit,
    `${side}: wrong application build`,
  );
  assert.equal(
    report.source.appWorktreeState,
    'clean',
    `${side}: application worktree must be clean`,
  );
  assert.match(
    report.source.harnessCommit || '',
    SHA1,
    `${side}: harness SHA is missing`,
  );
  assert.equal(
    report.source.harnessDirtyWorktree,
    false,
    `${side}: harness worktree must be clean`,
  );
  assert.equal(
    report.source.reason,
    null,
    `${side}: source revision is not verifiable`,
  );

  const contract = validateContract(report, side);
  const { workload, environment, captures } = report;
  assert.equal(
    workload?.warmupMs,
    30_000,
    `${side}: warmup must be 30 seconds`,
  );
  assert.equal(
    workload?.durationPerSampleMs,
    60_000,
    `${side}: configured measurement must be 60 seconds`,
  );
  assert.equal(
    workload?.runsPerScenario,
    5,
    `${side}: exactly five runs are required`,
  );
  assert.equal(
    workload?.qualityMode,
    'manual',
    `${side}: workload must use Manual quality`,
  );
  assert.equal(
    workload?.expectedDensityPct,
    75,
    `${side}: workload density must be 75%`,
  );
  assert.equal(
    workload?.detectionMode,
    'DENSE',
    `${side}: workload must use Dense detection`,
  );
  assert.equal(
    workload?.injectedDelayMs,
    0,
    `${side}: injected-delay controls cannot qualify as evidence`,
  );
  assert.equal(
    workload?.populationStableAcrossSamples,
    true,
    `${side}: populations changed during repeated runs`,
  );
  assert.equal(
    workload?.cameraPathStableAcrossSamples,
    true,
    `${side}: routes changed during repeated runs`,
  );
  assert.equal(
    workload?.fixture?.id,
    contract.fixture.id,
    `${side}: fixture identity does not match comparison contract`,
  );
  assert.equal(
    workload?.fixture?.sha256,
    contract.fixture.sha256,
    `${side}: fixture hash does not match comparison contract`,
  );
  assert.equal(
    workload?.fixture?.fixedTime,
    contract.fixture.fixedTime,
    `${side}: fixed fixture time does not match comparison contract`,
  );
  assert.ok(
    Array.isArray(workload.scenarios) && workload.scenarios.length,
    `${side}: declared scenarios are required`,
  );
  assert.equal(
    new Set(workload.scenarios).size,
    workload.scenarios.length,
    `${side}: duplicate declared scenario`,
  );
  assert.ok(
    workload.scenarios.includes('scripted-motion'),
    `${side}: scripted-motion scenario is required`,
  );
  assert.deepEqual(
    Object.keys(contract.routes).sort(),
    [...workload.scenarios].sort(),
    `${side}: each declared scenario needs exactly one route`,
  );
  assert.ok(Array.isArray(captures), `${side}: captures are missing`);

  assert.ok(environment, `${side}: environment identity is missing`);
  requireText(environment.userAgent, `${side}: browser user agent`);
  requireText(environment.platform, `${side}: platform`);
  requireText(environment.renderer, `${side}: renderer`);
  finitePositive(environment.viewport?.width, `${side}: viewport width`);
  finitePositive(environment.viewport?.height, `${side}: viewport height`);
  finitePositive(environment.viewport?.dpr, `${side}: viewport DPR`);
  finitePositive(
    environment.drawingBuffer?.width,
    `${side}: drawing buffer width`,
  );
  finitePositive(
    environment.drawingBuffer?.height,
    `${side}: drawing buffer height`,
  );
  assert.ok(
    environment.userAgent.includes(contract.browser.version),
    `${side}: browser version does not match user agent`,
  );
  assert.ok(
    environment.userAgent
      .toLowerCase()
      .includes(contract.browser.name.toLowerCase()),
    `${side}: browser name does not match user agent`,
  );
  assert.equal(
    environment.appCommit,
    expectedAppCommit,
    `${side}: report environment has the wrong application build`,
  );
  const actualPopulations = layerSignature(
    environment.layers,
    `${side} environment`,
  );
  equal(
    actualPopulations,
    populationSignature(contract.populations),
    `${side}: comparison contract populations do not match capture environment`,
  );
  for (const [scenario, route] of Object.entries(contract.routes))
    validateRoute(
      route,
      scenario,
      workload.durationPerSampleMs,
      `${side}: route ${scenario}`,
    );

  const counts = Object.fromEntries(
    contract.populations.map((row) => [row.id, row.count]),
  );
  assertCaptureIntegrity(captures, {
    expectedCommit: expectedAppCommit,
    qualityMode: 'manual',
    expectedDensityPct: 75,
    expectedCounts: counts,
  });

  const byScenario = new Map(
    workload.scenarios.map((scenario) => [scenario, []]),
  );
  for (const sample of captures) {
    const label = `${side} ${sample?.scenario} run ${sample?.run}`;
    assert.ok(
      byScenario.has(sample?.scenario),
      `${label}: undeclared scenario`,
    );
    assert.ok(
      Number.isInteger(sample.run) && sample.run >= 1 && sample.run <= 5,
      `${label}: invalid run id`,
    );
    assert.ok(
      sample.durationMs >= 60_000 && Number.isFinite(sample.durationMs),
      `${label}: actual measurement was shorter than 60 seconds`,
    );
    assert.equal(
      sample.foregroundThroughout,
      true,
      `${label}: foreground continuity failed`,
    );
    equal(
      sample.cameraPath,
      contract.routes[sample.scenario],
      `${label}: full route descriptor mismatch`,
    );
    assert.equal(
      sample.conditions?.before?.focused,
      true,
      `${label}: measurement did not start focused`,
    );
    assert.equal(
      sample.conditions?.before?.visible,
      true,
      `${label}: measurement did not start visible`,
    );
    assert.equal(
      sample.conditions?.after?.focused,
      true,
      `${label}: measurement did not end focused`,
    );
    assert.equal(
      sample.conditions?.after?.visible,
      true,
      `${label}: measurement did not end visible`,
    );
    for (const point of [sample.conditions.before, sample.conditions.after]) {
      assert.equal(
        point.settings?.qualityMode,
        'manual',
        `${label}: wrong quality mode`,
      );
      assert.equal(point.settings?.densityPct, 75, `${label}: wrong density`);
      assert.equal(
        point.settings?.detectionMode,
        'DENSE',
        `${label}: wrong detection mode`,
      );
      assert.equal(
        point.settings?.visualState?.detection?.density,
        75,
        `${label}: visual state density is unavailable or wrong`,
      );
      finitePositive(
        point.settings?.resolutionScale,
        `${label}: resolution scale`,
      );
      finiteNonNegative(point.settings?.msaaSamples, `${label}: MSAA samples`);
      equal(
        layerSignature(point.environment?.layers, label),
        populationSignature(contract.populations),
        `${label}: sample populations do not match contract`,
      );
      assert.equal(
        point.environment?.renderer,
        environment.renderer,
        `${label}: renderer differs from report environment`,
      );
      equal(
        point.environment?.viewport,
        environment.viewport,
        `${label}: viewport differs from report environment`,
      );
      equal(
        point.environment?.drawingBuffer,
        environment.drawingBuffer,
        `${label}: drawing buffer differs from report environment`,
      );
    }
    const metrics = sample.frameIntervalMs;
    assert.ok(
      Number.isInteger(sample.frameCount) && sample.frameCount >= 0,
      `${label}: frame count is missing or invalid`,
    );
    assert.ok(
      Number.isInteger(metrics?.samples) && metrics.samples >= 0,
      `${label}: frame interval sample count is missing or invalid`,
    );
    assert.equal(
      metrics.samples,
      sample.frameCount,
      `${label}: frame and interval counts disagree`,
    );
    if (sample.scenario === 'idle') {
      if (!sample.frameCount)
        assert.equal(
          metrics.p95,
          null,
          `${label}: empty idle timing must remain unavailable`,
        );
      else
        assert.ok(
          Number.isFinite(metrics.p95) && metrics.p95 > 0,
          `${label}: idle p95 is missing or invalid`,
        );
    } else {
      assert.ok(
        sample.frameCount > 0,
        `${label}: moving/tracking workload produced no frames`,
      );
      assert.ok(
        Number.isFinite(metrics.p95) && metrics.p95 > 0,
        `${label}: moving/tracking p95 is missing or invalid`,
      );
    }
    byScenario.get(sample.scenario).push(sample);
  }

  for (const [scenario, runs] of byScenario) {
    assert.equal(
      runs.length,
      5,
      `${side}: ${scenario} must have exactly five runs`,
    );
    const ids = runs.map((sample) => sample.run);
    assert.equal(
      new Set(ids).size,
      5,
      `${side}: ${scenario} has duplicate run ids`,
    );
    equal(
      ids.sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
      `${side}: ${scenario} run ids must be 1 through 5`,
    );
  }
  return { contract, byScenario };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Validate paired five-run evidence and report measured p95 deltas without making a hardware acceptance claim. */
export function validatePairedPerformanceReports({
  baseline,
  candidate,
  expectedAppCommits,
} = {}) {
  assert.ok(
    expectedAppCommits,
    'Explicit baseline and candidate application SHAs are required',
  );
  assert.match(
    expectedAppCommits.baseline || '',
    SHA1,
    'Explicit full baseline application SHA is required',
  );
  assert.match(
    expectedAppCommits.candidate || '',
    SHA1,
    'Explicit full candidate application SHA is required',
  );
  assert.notEqual(
    expectedAppCommits.baseline,
    expectedAppCommits.candidate,
    'Baseline and candidate application SHAs must differ',
  );

  const base = validateReport(
    baseline,
    'baseline',
    expectedAppCommits.baseline,
  );
  const next = validateReport(
    candidate,
    'candidate',
    expectedAppCommits.candidate,
  );
  assert.equal(
    baseline.source.harnessCommit,
    candidate.source.harnessCommit,
    'Harness revisions must match',
  );
  equal(
    base.contract,
    next.contract,
    'Baseline and candidate comparison contracts differ',
  );
  equal(
    baseline.workload.scenarios,
    candidate.workload.scenarios,
    'Declared workload scenarios differ',
  );
  equal(
    baseline.workload.fixture,
    candidate.workload.fixture,
    'Fixture descriptors differ',
  );
  equal(
    baseline.workload.mixedLayers,
    candidate.workload.mixedLayers,
    'Mixed-layer workload differs',
  );
  equal(
    baseline.workload.cameraPath,
    candidate.workload.cameraPath,
    'Workload route recipe differs',
  );
  equal(
    baseline.environment.userAgent,
    candidate.environment.userAgent,
    'Browser identity differs',
  );
  equal(
    baseline.environment.platform,
    candidate.environment.platform,
    'Platform differs',
  );
  equal(
    baseline.environment.renderer,
    candidate.environment.renderer,
    'Renderer differs',
  );
  equal(
    baseline.environment.vendor,
    candidate.environment.vendor,
    'Renderer vendor differs',
  );
  equal(
    baseline.environment.viewport,
    candidate.environment.viewport,
    'Viewport or DPR differs',
  );
  equal(
    baseline.environment.drawingBuffer,
    candidate.environment.drawingBuffer,
    'Drawing buffer dimensions differ',
  );

  // Application revision is the sole condition that may vary. Run metrics are
  // deliberately omitted because they are the measured outputs of this pair.
  for (const scenario of baseline.workload.scenarios) {
    const baseRuns = base.byScenario.get(scenario);
    const candidateRuns = next.byScenario.get(scenario);
    for (const baseRun of baseRuns) {
      const candidateRun = candidateRuns.find((run) => run.run === baseRun.run);
      const pairedConditions = (sample) => {
        const conditions = structuredClone(sample.conditions);
        for (const point of [conditions.before, conditions.after])
          delete point.environment.appCommit;
        return { conditions, cameraPath: sample.cameraPath };
      };
      equal(
        pairedConditions(baseRun),
        pairedConditions(candidateRun),
        `${scenario} run ${baseRun.run}: baseline and candidate conditions differ`,
      );
    }
  }

  const scenarios = {};
  for (const scenario of baseline.workload.scenarios) {
    const baseRuns = base.byScenario.get(scenario);
    const candidateRuns = next.byScenario.get(scenario);
    const p95 = (runs) => runs.map((sample) => sample.frameIntervalMs.p95);
    const available =
      p95(baseRuns).every(Number.isFinite) &&
      p95(candidateRuns).every(Number.isFinite);
    if (!available) {
      scenarios[scenario] = {
        status: 'unavailable',
        baselineMedianP95Ms: null,
        candidateMedianP95Ms: null,
        changePct: null,
        regressionOver10Pct: false,
      };
      continue;
    }
    const baselineMedianP95Ms = median(p95(baseRuns));
    const candidateMedianP95Ms = median(p95(candidateRuns));
    const changePct =
      ((candidateMedianP95Ms - baselineMedianP95Ms) / baselineMedianP95Ms) *
      100;
    assert.ok(
      baselineMedianP95Ms > 0 && Number.isFinite(changePct),
      `${scenario}: invalid median p95 change`,
    );
    scenarios[scenario] = {
      status: 'measured',
      baselineMedianP95Ms,
      candidateMedianP95Ms,
      changePct,
      regressionOver10Pct: changePct > 10,
    };
  }

  const workloadObjectiveScenarios =
    baseline.comparisonContract.objectiveScenarios;
  const workloadObjectiveAssessed = workloadObjectiveScenarios.every(
    (scenario) => scenarios[scenario]?.status === 'measured',
  );
  const workloadObjectiveResults = Object.fromEntries(
    workloadObjectiveScenarios.map((scenario) => {
      const result = scenarios[scenario];
      return [
        scenario,
        result?.status === 'measured' ? result.changePct <= -20 : null,
      ];
    }),
  );
  const denseObjectiveScenarios = [
    'scripted-motion',
    'selected-aircraft-tracking',
  ];
  const denseObjectiveInScope =
    baseline.comparisonContract.workloadId === 'dense-investigation';
  const denseObjectiveAssessed =
    denseObjectiveInScope &&
    denseObjectiveScenarios.every(
      (scenario) => scenarios[scenario]?.status === 'measured',
    );
  const denseObjectiveResults = Object.fromEntries(
    denseObjectiveScenarios.map((scenario) => {
      const result = scenarios[scenario];
      return [
        scenario,
        result?.status === 'measured' ? result.changePct <= -20 : null,
      ];
    }),
  );
  return {
    status: 'comparable',
    evidenceScope:
      'report-integrity-only; hardware provenance requires independent verification',
    workloadObjective: {
      status: workloadObjectiveAssessed ? 'assessed' : 'not-assessed',
      achieved: workloadObjectiveAssessed
        ? Object.values(workloadObjectiveResults).every(Boolean)
        : null,
      targetImprovementPct: 20,
      scenarios: workloadObjectiveResults,
    },
    denseTrackingObjective: {
      status: denseObjectiveAssessed ? 'assessed' : 'not-assessed',
      achieved: denseObjectiveAssessed
        ? Object.values(denseObjectiveResults).every(Boolean)
        : null,
      targetImprovementPct: 20,
      scenarios: denseObjectiveResults,
    },
    scenarios,
    regressionsOver10Pct: Object.keys(scenarios).filter(
      (scenario) => scenarios[scenario].regressionOver10Pct,
    ),
  };
}
