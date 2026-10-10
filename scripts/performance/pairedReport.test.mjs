import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import { evaluateMotionFrameBudget } from './motionBudget.mjs';

const baselineCommit = 'a'.repeat(40);
const candidateCommit = 'b'.repeat(40);
const harnessCommit = 'c'.repeat(40);
const fixtureHash = 'd'.repeat(64);
const scenarios = ['idle', 'scripted-motion', 'selected-aircraft-tracking'];
const startPose = {
  position: { x: 1, y: 2, z: 3 },
  direction: { x: 0, y: 1, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};
const routes = {
  idle: {
    id: 'parked-v1',
    start: startPose,
    elapsedDurationMs: 60_000,
    motionDistanceM: 0,
  },
  'scripted-motion': {
    id: 'elapsed-move-right-v1',
    start: startPose,
    elapsedDurationMs: 60_000,
    motionDistanceM: 19200,
  },
  'selected-aircraft-tracking': {
    id: 'tracked-aircraft-v1',
    start: startPose,
    elapsedDurationMs: 60_000,
    motionDistanceM: 0,
    selectedIdentity: 'flights:000001',
    trajectoryId: 'synthetic-aircraft-ring-v1:000001',
  },
};
const populations = [
  { id: 'flights', enabled: true, count: 2500 },
  { id: 'local-datacenters', enabled: true, count: 4362 },
  { id: 'local-dams', enabled: true, count: 716 },
];

function makeReport(
  commit,
  motionP95 = [40, 42, 39, 41, 43],
  trackingP95 = [50, 48, 52, 49, 51],
) {
  const point = () => ({
    settings: {
      qualityMode: 'manual',
      densityPct: 75,
      detectionMode: 'DENSE',
      resolutionScale: 1,
      msaaSamples: 4,
      antialias: false,
      fxaa: true,
      visualState: {
        style: 'normal',
        styleParams: {},
        detection: { density: 75 },
      },
    },
    environment: {
      appCommit: commit,
      renderer: 'Intel UHD 620',
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
      layers: structuredClone(populations),
    },
    focused: true,
    visible: true,
  });
  const captures = [];
  for (const scenario of scenarios) {
    for (let run = 1; run <= 5; run += 1) {
      const p95 =
        scenario === 'idle'
          ? null
          : scenario === 'scripted-motion'
            ? motionP95[run - 1]
            : trackingP95[run - 1];
      const frameCount = p95 == null ? 0 : 100;
      captures.push({
        scenario,
        run,
        durationMs: 60_005,
        frameCount,
        frameIntervalMs: { p50: p95, p95, max: p95, samples: frameCount },
        conditions: { before: point(), after: point() },
        foregroundThroughout: true,
        cameraPath: structuredClone(routes[scenario]),
      });
    }
  }
  return {
    schema: 'gev-performance-capture/v1',
    url: 'http://localhost:4173/austin',
    source: {
      appCommit: commit,
      appWorktreeState: 'clean',
      harnessCommit,
      harnessDirtyWorktree: false,
      reason: null,
      buildProvenance: {
        schema: 'gev-capture-build-provenance/v1',
        status: 'verified-local-build-and-served-assets-before-and-after',
        scope:
          'unsigned local build and served-byte checks; browser response bytes are not independently attested',
        receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
        appCommit: commit,
        harnessCommit,
        buildRecipe: {
          nodeVersion: 'v24.0.0',
          npmVersion: '11.0.0',
          dependencyInstall: 'npm ci --no-audit --no-fund',
          buildInvocation:
            'npm run build -- --outDir <new-empty-task-owned-directory>',
          packageJsonSha256: '3'.repeat(64),
          packageLockSha256: '4'.repeat(64),
          buildScriptSha256: '5'.repeat(64),
        },
        before: {
          schema: 'gev-served-assets-verification/v1',
          status: 'served-assets-match',
          receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
          assetCount: 10,
          totalAssetBytes: 1_000_000,
        },
        after: {
          schema: 'gev-served-assets-verification/v1',
          status: 'served-assets-match',
          receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
          assetCount: 10,
          totalAssetBytes: 1_000_000,
        },
        pageAssetAudit: {
          scriptRequestCount: 1,
          loadedAssetPaths: ['assets/app.js'],
          unexpectedAssetPaths: [],
        },
      },
    },
    comparisonContract: {
      schema: 'gev-performance-comparison-contract/v1',
      workloadId: 'dense-investigation',
      fixture: {
        id: 'synthetic-aircraft-ring-v1',
        sha256: fixtureHash,
        fixedTime: '2026-10-08T12:00:00.000Z',
      },
      routes: structuredClone(routes),
      browser: { name: 'Chrome', version: '152.0' },
      populations: structuredClone(populations),
      visual: { qualityMode: 'manual', detectionMode: 'DENSE', densityPct: 75 },
      objectiveScenarios: ['scripted-motion', 'selected-aircraft-tracking'],
    },
    comparisonEligible: true,
    fixtureDelivery: {
      schema: 'gev-fixture-delivery-observation/v1',
      status: 'observed',
      method: 'controlled-provider-boundary-v1',
      fixtureSha256: fixtureHash,
      fixedTime: '2026-10-08T12:00:00.000Z',
    },
    environment: {
      appCommit: commit,
      userAgent: 'Mozilla/5.0 Chrome/152.0.7977.75',
      platform: 'Win32',
      renderer: 'Intel UHD 620',
      vendor: 'Intel',
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
      layers: structuredClone(populations),
    },
    workload: {
      warmupMs: 30_000,
      durationPerSampleMs: 60_000,
      runsPerScenario: 5,
      scenarios: [...scenarios],
      fixture: {
        id: 'synthetic-aircraft-ring-v1',
        sha256: fixtureHash,
        fixedTime: '2026-10-08T12:00:00.000Z',
        count: 2500,
        seed: 1,
      },
      mixedLayers: ['local-datacenters', 'local-dams'],
      qualityMode: 'manual',
      expectedDensityPct: 75,
      detectionMode: 'DENSE',
      injectedDelayMs: 0,
      populationStableAcrossSamples: true,
      cameraPathStableAcrossSamples: true,
      cameraPath:
        'elapsed-move-right-v1 for scripted motion; parked-v1 for idle/tracking',
    },
    captures,
  };
}

function validate(
  baseline = makeReport(baselineCommit),
  candidate = makeReport(
    candidateCommit,
    [30, 31, 29, 30, 32],
    [35, 36, 34, 35, 37],
  ),
) {
  return validatePairedPerformanceReports({
    baseline,
    candidate,
    expectedAppCommits: {
      baseline: baselineCommit,
      candidate: candidateCommit,
    },
  });
}

test('valid paired reports calculate scenario medians, objective and regressions separately', () => {
  const result = validate();
  assert.equal(result.status, 'comparable');
  assert.equal(
    result.evidenceScope,
    'report-integrity-only; hardware provenance requires independent verification',
  );
  assert.equal(result.scenarios['scripted-motion'].baselineMedianP95Ms, 41);
  assert.equal(result.scenarios['scripted-motion'].candidateMedianP95Ms, 30);
  assert.equal(result.denseTrackingObjective.status, 'assessed');
  assert.equal(result.denseTrackingObjective.achieved, true);
  assert.deepEqual(result.regressionsOver10Pct, []);

  const modest = makeReport(
    candidateCommit,
    [37, 38, 36, 37, 39],
    [46, 47, 45, 46, 48],
  );
  const modestResult = validate(makeReport(baselineCommit), modest);
  assert.equal(modestResult.status, 'comparable');
  assert.equal(modestResult.denseTrackingObjective.achieved, false);
  assert.deepEqual(modestResult.regressionsOver10Pct, []);

  const regressed = makeReport(
    candidateCommit,
    [47, 48, 49, 50, 51],
    [35, 36, 34, 35, 37],
  );
  const regressedResult = validate(makeReport(baselineCommit), regressed);
  assert.deepEqual(regressedResult.regressionsOver10Pct, ['scripted-motion']);
});

test('paired reports reject absent, mismatched or drifting build provenance', () => {
  const base = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  delete candidate.source.buildProvenance;
  assert.throws(() => validate(base, candidate), /verified build provenance/);

  const wrongHarness = makeReport(candidateCommit);
  wrongHarness.source.buildProvenance.harnessCommit = 'd'.repeat(40);
  assert.throws(
    () => validate(base, wrongHarness),
    /receipt harness SHA mismatch/,
  );

  const changedAssets = makeReport(candidateCommit);
  changedAssets.source.buildProvenance.after.totalAssetBytes += 1;
  assert.throws(
    () => validate(base, changedAssets),
    /served build changed during capture/,
  );

  const changedToolchain = makeReport(candidateCommit);
  changedToolchain.source.buildProvenance.buildRecipe.npmVersion = '10.0.0';
  assert.throws(
    () => validate(base, changedToolchain),
    /Build toolchain differs/,
  );
});

test('paired reports reject a caller-only fixture descriptor without observed delivery', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  delete candidate.fixtureDelivery;
  assert.throws(
    () => validate(baseline, candidate),
    /observed fixture delivery/,
  );

  const mismatch = makeReport(candidateCommit);
  mismatch.fixtureDelivery.fixtureSha256 = 'e'.repeat(64);
  assert.throws(
    () => validate(baseline, mismatch),
    /observed fixture hash mismatch/,
  );

  const markedIneligible = makeReport(candidateCommit);
  markedIneligible.comparisonEligible = false;
  assert.throws(
    () => validate(baseline, markedIneligible),
    /not marked comparison-eligible/,
  );
});

test('an unreported required tracking workload does not create a global objective claim', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  for (const report of [baseline, candidate]) {
    report.workload.scenarios = ['idle', 'scripted-motion'];
    report.comparisonContract.routes = {
      idle: routes.idle,
      'scripted-motion': routes['scripted-motion'],
    };
    report.captures = report.captures.filter(
      (sample) => sample.scenario !== 'selected-aircraft-tracking',
    );
  }
  const result = validate(baseline, candidate);
  assert.equal(result.denseTrackingObjective.status, 'not-assessed');
  assert.equal(result.denseTrackingObjective.achieved, null);
  assert.equal(
    result.denseTrackingObjective.scenarios['selected-aircraft-tracking'],
    null,
  );
});

test('infrastructure-only workloads remain comparable without aircraft populations', () => {
  const reports = [makeReport(baselineCommit), makeReport(candidateCommit)];
  for (const report of reports) {
    report.comparisonContract.workloadId = 'infrastructure-only';
    report.comparisonContract.objectiveScenarios = ['scripted-motion'];
    report.comparisonContract.fixture = {
      id: 'fixed-infrastructure-fixture-v1',
      sha256: 'e'.repeat(64),
      fixedTime: '2026-10-08T12:00:00.000Z',
    };
    report.fixtureDelivery.fixtureSha256 = 'e'.repeat(64);
    report.fixtureDelivery.fixedTime = '2026-10-08T12:00:00.000Z';
    report.comparisonContract.populations = [
      { id: 'local-datacenters', enabled: true, count: 4362 },
      { id: 'local-dams', enabled: true, count: 716 },
    ];
    delete report.comparisonContract.routes['selected-aircraft-tracking'];
    report.environment.layers = structuredClone(
      report.comparisonContract.populations,
    );
    report.workload.fixture = {
      ...report.comparisonContract.fixture,
      count: 5078,
      seed: 1,
    };
    report.workload.scenarios = ['idle', 'scripted-motion'];
    report.captures = report.captures.filter(
      (sample) => sample.scenario !== 'selected-aircraft-tracking',
    );
    for (const sample of report.captures)
      for (const point of [sample.conditions.before, sample.conditions.after])
        point.environment.layers = structuredClone(
          report.comparisonContract.populations,
        );
  }
  const [baseline, candidate] = reports;
  const result = validate(baseline, candidate);
  assert.equal(result.status, 'comparable');
  assert.equal(result.workloadObjective.status, 'assessed');
  assert.equal(result.denseTrackingObjective.status, 'not-assessed');
});

test('malformed or incomplete evidence is rejected instead of treating unknown metrics as zero', () => {
  const mutations = [
    (report) => {
      delete report.comparisonContract;
    },
    (report) => {
      report.source.appWorktreeState = 'dirty';
    },
    (report) => {
      report.source.harnessDirtyWorktree = true;
    },
    (report) => {
      report.workload.warmupMs = 0;
    },
    (report) => {
      report.environment.appCommit = 'e'.repeat(40);
    },
    (report) => {
      report.captures.pop();
    },
    (report) => {
      report.captures[1].run = report.captures[0].run;
    },
    (report) => {
      report.captures.find(
        (sample) => sample.scenario === 'scripted-motion',
      ).frameCount = 0;
    },
    (report) => {
      report.captures.find(
        (sample) => sample.scenario === 'scripted-motion',
      ).frameIntervalMs.p95 = null;
    },
    (report) => {
      report.captures.find(
        (sample) => sample.scenario === 'idle',
      ).frameIntervalMs.p95 = 0;
    },
    (report) => {
      report.environment.viewport.width = Infinity;
    },
    (report) => {
      report.captures[5].conditions.before.settings.resolutionScale = Infinity;
    },
    (report) => {
      report.captures[5].conditions.before.settings.msaaSamples = -1;
    },
    (report) => {
      report.captures[5].frameIntervalMs.p95 = NaN;
    },
    (report) => {
      report.captures[5].frameIntervalMs.p95 = -1;
    },
    (report) => {
      report.workload.injectedDelayMs = 100;
    },
    (report) => {
      report.comparisonContract.fixture.sha256 = 'invalid';
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const candidate = makeReport(candidateCommit);
    mutate(candidate);
    assert.throws(
      () => validate(makeReport(baselineCommit), candidate),
      `mutation ${index}`,
    );
  }
});

test('browser, fixture, route, populations and visual condition changes cannot be paired', () => {
  const mutations = [
    (report) => {
      report.environment.userAgent = 'Mozilla/5.0 Chrome/151.0';
    },
    (report) => {
      report.comparisonContract.fixture.sha256 = 'e'.repeat(64);
      report.workload.fixture.sha256 = 'e'.repeat(64);
    },
    (report) => {
      report.comparisonContract.routes['scripted-motion'].motionDistanceM += 1;
      const route = report.comparisonContract.routes['scripted-motion'];
      for (const sample of report.captures.filter(
        (row) => row.scenario === 'scripted-motion',
      ))
        sample.cameraPath = structuredClone(route);
    },
    (report) => {
      delete report.comparisonContract.routes['scripted-motion'].start;
    },
    (report) => {
      report.comparisonContract.routes['scripted-motion'].start.position.x =
        Infinity;
    },
    (report) => {
      report.comparisonContract.populations[0].count = 2501;
      report.environment.layers[0].count = 2501;
      for (const sample of report.captures)
        for (const point of [sample.conditions.before, sample.conditions.after])
          point.environment.layers[0].count = 2501;
    },
    (report) => {
      report.captures[5].conditions.before.settings.msaaSamples = 1;
    },
  ];
  for (const mutate of mutations) {
    const candidate = makeReport(candidateCommit);
    mutate(candidate);
    assert.throws(() => validate(makeReport(baselineCommit), candidate));
  }
});

test('dense-investigation cannot omit selected tracking from its objective contract', () => {
  const candidate = makeReport(candidateCommit);
  candidate.comparisonContract.objectiveScenarios = ['scripted-motion'];
  assert.throws(
    () => validate(makeReport(baselineCommit), candidate),
    /requires selected-aircraft-tracking objective/,
  );
  assert.throws(
    () => validate(makeReport('f'.repeat(40)), makeReport(candidateCommit)),
    /wrong application build/,
  );
});

test('synthetic delayed samples fail the existing motion frame budget', () => {
  const delayed = makeReport(candidateCommit, [120, 122, 119, 121, 123]);
  const result = evaluateMotionFrameBudget(delayed.captures, 50);
  assert.equal(result.status, 'failed');
  assert.equal(result.failures.length, 5);
  assert.ok(
    result.failures.every((failure) => failure.reason === 'budget-exceeded'),
  );
});

test('idle zero-frame windows remain explicitly unavailable', () => {
  const result = validate();
  assert.deepEqual(result.scenarios.idle, {
    status: 'unavailable',
    baselineMedianP95Ms: null,
    candidateMedianP95Ms: null,
    changePct: null,
    regressionOver10Pct: false,
  });
});
