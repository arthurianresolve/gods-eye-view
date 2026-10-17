import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import { evaluateMotionFrameBudget } from './motionBudget.mjs';
import { createObservedInfrastructureComparisonContract } from './captureComparisonContract.mjs';

import {
  baselineCommit,
  candidateCommit,
  makeReport,
  makeInfrastructureReport,
  makeMapReport,
  makeWeatherReport,
  routes,
  scenarios,
} from './pairedReportTestFixtures.mjs';
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

test('paired reports normalize only one-sided disabled zero-count layers', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  for (const sample of candidate.captures)
    for (const point of [sample.conditions.before, sample.conditions.after])
      point.environment.layers.push({
        id: 'candidate-only-dormant',
        enabled: false,
        count: 0,
      });

  const result = validate(baseline, candidate);
  assert.equal(result.status, 'comparable');
  assert.deepEqual(result.conditionNormalization, {
    rule: 'ignore-one-sided-disabled-zero-count-layers',
    baselineOnly: [],
    candidateOnly: ['candidate-only-dormant'],
  });

  for (const mutation of [
    { enabled: true, count: 0 },
    { enabled: false, count: 1 },
  ]) {
    const changed = structuredClone(candidate);
    for (const sample of changed.captures)
      for (const point of [sample.conditions.before, sample.conditions.after])
        Object.assign(
          point.environment.layers.find(
            (layer) => layer.id === 'candidate-only-dormant',
          ),
          mutation,
        );
    assert.throws(
      () => validate(baseline, changed),
      /sample populations do not match contract|baseline and candidate conditions differ/,
    );
  }

  const changedSharedPopulation = structuredClone(candidate);
  for (const sample of changedSharedPopulation.captures)
    for (const point of [sample.conditions.before, sample.conditions.after])
      point.environment.layers.find((layer) => layer.id === 'flights').count +=
        1;
  assert.throws(
    () => validate(baseline, changedSharedPopulation),
    /wrong population|sample populations do not match contract|baseline and candidate conditions differ/,
  );
});

test('paired renderer evidence ignores only one-time query duration', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  for (const [report, queryDurationMs] of [
    [baseline, 0.4],
    [candidate, 6.75],
  ]) {
    for (const sample of report.captures)
      for (const point of [sample.conditions.before, sample.conditions.after])
        point.environment.rendererEvidence = {
          source: 'early-cesium-context-creation',
          contextAttributes: { antialias: false, alpha: true },
          parameterQueryCount: 2,
          queryDurationMs,
        };
  }
  assert.equal(validate(baseline, candidate).status, 'comparable');
  assert.equal(
    candidate.captures[0].conditions.before.environment.rendererEvidence
      .queryDurationMs,
    6.75,
    'the observed one-time cost stays available in the captured report',
  );

  const invalidEvidence = structuredClone(candidate);
  for (const point of [
    invalidEvidence.captures[0].conditions.before,
    invalidEvidence.captures[0].conditions.after,
  ])
    point.environment.rendererEvidence.contextAttributes.antialias = true;
  assert.throws(
    () => validate(baseline, invalidEvidence),
    /repeated workload changed/,
  );

  const invalidRenderer = structuredClone(candidate);
  for (const point of [
    invalidRenderer.captures[0].conditions.before,
    invalidRenderer.captures[0].conditions.after,
  ])
    point.environment.renderer = 'Different GPU';
  assert.throws(
    () => validate(baseline, invalidRenderer),
    /repeated workload changed/,
  );

  const invalidSettings = structuredClone(candidate);
  for (const point of [
    invalidSettings.captures[0].conditions.before,
    invalidSettings.captures[0].conditions.after,
  ])
    point.settings.msaaSamples = 1;
  assert.throws(
    () => validate(baseline, invalidSettings),
    /repeated workload changed/,
  );
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

test('map diagnostic identities cannot be promoted without timed journey evidence', () => {
  for (const workloadId of ['map-streaming', 'austin-map-streaming-v1']) {
    const baseline = makeReport(baselineCommit);
    const candidate = makeReport(candidateCommit);
    baseline.comparisonContract.workloadId = workloadId;
    candidate.comparisonContract.workloadId = workloadId;
    assert.throws(
      () => validate(baseline, candidate),
      /map capture evidence is required|unsupported map workload identity/,
    );
  }
});

test('five-run map streaming contracts compare transition readiness and reject incomplete timing', () => {
  const baseline = makeMapReport(baselineCommit, 20);
  const candidate = makeMapReport(candidateCommit, 15);
  const result = validatePairedPerformanceReports({
    baseline,
    candidate,
    expectedAppCommits: {
      baseline: baselineCommit,
      candidate: candidateCommit,
    },
  });
  assert.equal(result.status, 'comparable');
  assert.equal(result.scenarios['map-streaming-route'].baselineMedianP95Ms, 20);
  assert.equal(
    result.scenarios['map-streaming-route'].candidateMedianP95Ms,
    15,
  );
  assert.equal(result.scenarios['map-streaming-route'].changePct, -25);
  assert.deepEqual(result.regressionsOver10Pct, []);

  const incomplete = makeMapReport(candidateCommit, 15);
  incomplete.workload.mapStreamingCapture.journeys.pop();
  incomplete.comparisonContract.timing.runs.pop();
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate: incomplete,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /five runs|Map timed journey run ids|map capture evidence|journeys.length/,
  );
});

test('paired weather reports require five 30/60 runs with phase-bound sources and strict common capture identity', () => {
  const baseline = makeWeatherReport(baselineCommit);
  const candidate = makeWeatherReport(candidateCommit);
  const accepted = validatePairedPerformanceReports({
    baseline,
    candidate,
    expectedAppCommits: {
      baseline: baselineCommit,
      candidate: candidateCommit,
    },
  });
  assert.equal(accepted.status, 'comparable');
  assert.equal(accepted.workloadObjective.status, 'not-assessed');

  const differentRequestCounts = makeWeatherReport(candidateCommit);
  for (const asset of differentRequestCounts.fixtureDelivery.assets)
    asset.responseCount += 1;
  differentRequestCounts.fixtureDelivery.fulfilledResponseCount =
    differentRequestCounts.fixtureDelivery.assets.reduce(
      (sum, asset) => sum + asset.responseCount,
      0,
    );
  for (const sample of differentRequestCounts.captures) {
    sample.fixtureDelivery.assets = structuredClone(
      differentRequestCounts.fixtureDelivery.assets,
    );
    sample.fixtureDelivery.fulfilledResponseCount =
      differentRequestCounts.fixtureDelivery.fulfilledResponseCount;
  }
  const acceptedDifferentRequestCounts = validatePairedPerformanceReports({
    baseline,
    candidate: differentRequestCounts,
    expectedAppCommits: {
      baseline: baselineCommit,
      candidate: candidateCommit,
    },
  });
  assert.equal(acceptedDifferentRequestCounts.status, 'comparable');
  assert.notEqual(
    acceptedDifferentRequestCounts.fixtureDeliveryDiagnostics.baseline
      .fulfilledResponseCount,
    acceptedDifferentRequestCounts.fixtureDeliveryDiagnostics.candidate
      .fulfilledResponseCount,
  );

  const rejectMutation = (mutate, pattern) => {
    const left = makeWeatherReport(baselineCommit);
    const right = makeWeatherReport(candidateCommit);
    mutate(right);
    assert.throws(
      () =>
        validatePairedPerformanceReports({
          baseline: left,
          candidate: right,
          expectedAppCommits: {
            baseline: baselineCommit,
            candidate: candidateCommit,
          },
        }),
      pattern,
    );
  };
  rejectMutation((report) => {
    report.captures[0].weatherEffectsClock.phaseObservations.phases[1].sourceObservationTimes[0] =
      report.workload.fixture.timeline[0];
  }, /Expected values|phase|source|contract/);
  rejectMutation((report) => {
    report.captures[0].weatherEffectsClock.weatherStateAfter.visualState.windPaused = true;
  }, /weather settings|contract/);
  rejectMutation((report) => {
    report.environment.layers.find((row) => row.id === 'wind').count -= 1;
  }, /Expected values|population|contract/);
  rejectMutation((report) => {
    report.environment.drawingBuffer.width += 1;
  }, /drawing buffer|rendering/);
  rejectMutation((report) => {
    report.workload.fixture = {
      ...report.workload.fixture,
      sha256: 'e'.repeat(64),
    };
  }, /Expected values|fixture hash|fixture SHA|contract/);
  rejectMutation((report) => {
    report.source.appCommit = baselineCommit;
  }, /wrong application build/);
  rejectMutation(
    (report) => report.captures.pop(),
    /Expected values|five runs|capture length|capture count|exactly five/,
  );
  rejectMutation(
    (report) => (report.workload.warmupMs = 29_999),
    /Expected values|warmup/,
  );
  rejectMutation(
    (report) => (report.workload.durationPerSampleMs = 30_000),
    /Expected values|measurement|60 seconds/,
  );
  rejectMutation((report) => {
    report.workload.fixture = {
      ...report.workload.fixture,
      schema: 'gev-weather-effects-fixture/v1',
      id: 'weather-effects-austin-v1',
      workloadId: 'austin-weather-effects-v1',
    };
  }, /fixture|weather-effects-fixture/);
  rejectMutation((report) => {
    report.comparisonContract.fixtureDelivery.schema =
      'gev-weather-effects-fixture-delivery/v1';
  }, /delivery contract/);
  rejectMutation((report) => {
    delete report.captures[0].weatherEffectsClock.phaseObservations;
  }, /phase|weather contract|weather-effects/);
  rejectMutation((report) => {
    report.comparisonEligible = false;
  }, /not marked comparison-eligible/);
});

test('paired delivery compares fixed identity while retaining independent poll counts', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  baseline.fixtureDelivery.fulfilledResponseCount = 20;
  candidate.fixtureDelivery.fulfilledResponseCount = 26;
  baseline.fixtureDelivery.perSampleResponseCounts = baseline.captures.map(
    (sample, index) => ({
      scenario: sample.scenario,
      run: sample.run,
      fulfilledResponseCount: index === 0 ? 6 : 1,
    }),
  );
  candidate.fixtureDelivery.perSampleResponseCounts = candidate.captures.map(
    (sample, index) => ({
      scenario: sample.scenario,
      run: sample.run,
      fulfilledResponseCount: index === 0 ? 12 : 1,
    }),
  );
  const result = validate(baseline, candidate);
  assert.equal(result.status, 'comparable');
  assert.equal(
    result.fixtureDeliveryDiagnostics.baseline.fulfilledResponseCount,
    20,
  );
  assert.equal(
    result.fixtureDeliveryDiagnostics.candidate.fulfilledResponseCount,
    26,
  );
  assert.throws(() => {
    candidate.comparisonContract.fixtureDelivery.method = 'different-method';
    validate(baseline, candidate);
  }, /delivery method mismatch|delivery contract method/);
});

test('paired delivery rejects inconsistent per-sample diagnostic totals', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  for (const report of [baseline, candidate]) {
    report.fixtureDelivery.perSampleResponseCounts = report.captures.map(
      (sample) => ({
        scenario: sample.scenario,
        run: sample.run,
        fulfilledResponseCount: 1,
      }),
    );
  }
  baseline.fixtureDelivery.perSampleResponseCounts[0].fulfilledResponseCount = 2;
  assert.throws(
    () => validate(baseline, candidate),
    /do not sum to the report total/,
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
    report.comparisonContract.fixtureDelivery.fixtureSha256 = 'e'.repeat(64);
    report.comparisonContract.fixtureDelivery.fixedTime =
      '2026-10-08T12:00:00.000Z';
    report.comparisonContract.fixtureDelivery.observedFlightsCount = 0;
    report.fixtureDelivery.fixtureSha256 = 'e'.repeat(64);
    report.fixtureDelivery.fixedTime = '2026-10-08T12:00:00.000Z';
    report.fixtureDelivery.observedFlightsCount = 0;
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

test('one-second infrastructure diagnostics cannot satisfy the 60-second paired contract', () => {
  const shortCapture = (report) => {
    report.workload.warmupMs = 1000;
    report.workload.durationPerSampleMs = 1000;
    report.workload.runsPerScenario = 2;
    report.captures = report.captures.filter((sample) => sample.run <= 2);
    for (const sample of report.captures) {
      sample.cameraPath.elapsedDurationMs = 1000;
      if (sample.scenario === 'scripted-motion')
        sample.cameraPath.motionDistanceM = 320;
    }
    report.comparisonContract = createObservedInfrastructureComparisonContract({
      fixture: report.workload.fixture,
      fixtureDelivery: report.fixtureDelivery,
      environment: report.environment,
      captures: report.captures,
      scenarios: report.workload.scenarios,
      workload: report.workload,
    });
    return report;
  };
  const baseline = shortCapture(
    makeInfrastructureReport(baselineCommit, 'infrastructure-datacenters'),
  );
  const candidate = shortCapture(
    makeInfrastructureReport(candidateCommit, 'infrastructure-datacenters'),
  );
  assert.equal(baseline.comparisonContract.routes.idle.elapsedDurationMs, 1000);
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /warmup must be 30 seconds/,
  );
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

test('paired route checks tolerate camera pose roundoff without rounding evidence', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  for (const scenario of scenarios) {
    const route = structuredClone(
      candidate.comparisonContract.routes[scenario],
    );
    route.start.position.x += 5e-7;
    route.start.direction.x += 5e-13;
    route.start.transform[0] += 5e-13;
    route.start.transform[12] += 5e-7;
    candidate.comparisonContract.routes[scenario] = route;
    for (const sample of candidate.captures.filter(
      (entry) => entry.scenario === scenario,
    ))
      sample.cameraPath = structuredClone(route);
  }
  const rawPosition = candidate.captures[0].cameraPath.start.position.x;
  assert.equal(validate(baseline, candidate).status, 'comparable');
  assert.equal(candidate.captures[0].cameraPath.start.position.x, rawPosition);
});

test('entity-follow endpoint jitter stays within sub-micron tolerance while real drift and phase changes fail', () => {
  const baseline = makeReport(baselineCommit);
  const candidate = makeReport(candidateCommit);
  const route =
    candidate.comparisonContract.routes['selected-aircraft-tracking'];
  route.start.position.x += 5e-7;
  route.end.position.z -= 5e-7;
  route.start.direction.y += 5e-13;
  route.end.transform[12] += 5e-7;
  route.targetStart.longitudeDeg += 1e-13;
  route.targetEnd.latitudeDeg -= 1e-13;
  for (const sample of candidate.captures.filter(
    (row) => row.scenario === 'selected-aircraft-tracking',
  ))
    sample.cameraPath = structuredClone(route);
  const preserved = candidate.captures.find(
    (row) => row.scenario === 'selected-aircraft-tracking',
  ).cameraPath.targetEnd.latitudeDeg;
  assert.equal(validate(baseline, candidate).status, 'comparable');
  assert.equal(
    candidate.captures.find(
      (row) => row.scenario === 'selected-aircraft-tracking',
    ).cameraPath.targetEnd.latitudeDeg,
    preserved,
  );

  for (const mutate of [
    (value) => {
      value.targetEnd.latitudeDeg += 1e-5;
    },
    (value) => {
      value.end.position.x += 1;
    },
    (value) => {
      value.measurementMs += 1;
    },
    (value) => {
      value.endEpochMs += 1;
    },
  ]) {
    const changed = makeReport(candidateCommit);
    const changedRoute =
      changed.comparisonContract.routes['selected-aircraft-tracking'];
    mutate(changedRoute);
    for (const sample of changed.captures.filter(
      (row) => row.scenario === 'selected-aircraft-tracking',
    ))
      sample.cameraPath = structuredClone(changedRoute);
    assert.throws(() => validate(makeReport(baselineCommit), changed));
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
