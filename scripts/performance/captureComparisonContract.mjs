import assert from 'node:assert/strict';
import { DENSE_FLIGHT_FIXTURE_ID } from './productionFlightFixture.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_POPULATIONS = Object.freeze({
  flights: 2500,
  'local-datacenters': 4362,
  'local-dams': 716,
});
const OBJECTIVE_SCENARIOS = Object.freeze([
  'scripted-motion',
  'selected-aircraft-tracking',
]);

function enabledPopulations(layers, label) {
  assert.ok(Array.isArray(layers), `${label} layer observations are required`);
  return layers
    .filter((layer) => layer?.enabled === true)
    .map((layer) => {
      assert.ok(
        typeof layer.id === 'string' && layer.id,
        `${label} layer id is required`,
      );
      assert.ok(
        Number.isInteger(layer.count) && layer.count >= 0,
        `${label} ${layer.id} count is invalid`,
      );
      return { id: layer.id, enabled: true, count: layer.count };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Build the comparison contract only from observed production-fixture capture fields. */
export function createObservedDenseComparisonContract({
  fixture,
  fixtureDelivery,
  environment,
  captures,
  scenarios,
} = {}) {
  assert.equal(
    fixture?.id,
    DENSE_FLIGHT_FIXTURE_ID,
    'unsupported production fixture identity',
  );
  assert.match(
    fixture?.sha256 || '',
    SHA256,
    'observed fixture SHA-256 is required',
  );
  assert.equal(
    typeof fixture?.fixedTime,
    'string',
    'observed fixed fixture time is required',
  );
  assert.ok(
    Number.isFinite(Date.parse(fixture.fixedTime)),
    'observed fixture time is invalid',
  );
  assert.equal(
    fixture.count,
    REQUIRED_POPULATIONS.flights,
    'dense flight count is not the registered workload',
  );
  assert.equal(fixtureDelivery?.schema, 'gev-fixture-delivery-observation/v1');
  assert.equal(
    fixtureDelivery?.status,
    'observed',
    'fixture delivery was not acknowledged',
  );
  assert.ok(
    typeof fixtureDelivery.method === 'string' && fixtureDelivery.method.trim(),
  );
  assert.equal(fixtureDelivery.fixtureSha256, fixture.sha256);
  assert.equal(fixtureDelivery.fixedTime, fixture.fixedTime);
  assert.equal(
    fixtureDelivery.observedFlightsCount,
    fixture.count,
    'observed provider population differs from the registered fixture',
  );
  assert.ok(
    Number.isInteger(fixtureDelivery.fulfilledResponseCount) &&
      fixtureDelivery.fulfilledResponseCount > 0,
    'at least one fixture response acknowledgment is required',
  );
  assert.ok(environment && typeof environment.userAgent === 'string');
  const browserMatch = environment.userAgent.match(
    /(HeadlessChrome|Chrome|Chromium)\/([\d.]+)/,
  );
  assert.ok(
    browserMatch,
    'browser identity was not present in the observed user agent',
  );
  assert.ok(
    Array.isArray(captures) && captures.length > 0,
    'raw capture records are required',
  );
  assert.ok(
    Array.isArray(scenarios) && scenarios.length > 0,
    'observed workload scenarios are required',
  );

  const populations = enabledPopulations(captures[0].layers, 'capture');
  const environmentPopulations = enabledPopulations(
    environment.layers,
    'environment',
  );
  assert.deepEqual(
    populations,
    environmentPopulations,
    'capture and environment populations differ',
  );
  for (const [index, sample] of captures.entries()) {
    assert.deepEqual(
      enabledPopulations(sample.layers, `capture ${index + 1}`),
      populations,
      `capture ${index + 1} populations differ from the observed contract`,
    );
    assert.equal(sample.fixtureDelivery?.schema, fixtureDelivery.schema);
    assert.equal(sample.fixtureDelivery?.status, 'observed');
    assert.equal(sample.fixtureDelivery?.method, fixtureDelivery.method);
    assert.equal(sample.fixtureDelivery?.fixtureSha256, fixture.sha256);
    assert.equal(sample.fixtureDelivery?.fixedTime, fixture.fixedTime);
    assert.equal(sample.fixtureDelivery?.observedFlightsCount, fixture.count);
    assert.ok(
      Number.isInteger(sample.fixtureDelivery?.fulfilledResponseCount) &&
        sample.fixtureDelivery.fulfilledResponseCount > 0,
      `capture ${index + 1} provider delivery was not independently acknowledged`,
    );
    assert.deepEqual(
      sample.conditions?.before?.settings,
      sample.settings?.before,
      `capture ${index + 1} observed settings copies differ`,
    );
    assert.deepEqual(
      sample.settings?.before,
      captures[0]?.settings?.before,
      `capture ${index + 1} visual settings differ from the observed contract`,
    );
  }
  for (const [id, count] of Object.entries(REQUIRED_POPULATIONS)) {
    const actual = populations.find((row) => row.id === id);
    assert.ok(actual, `dense production workload is missing ${id}`);
    assert.equal(
      actual.count,
      count,
      `dense production workload has the wrong ${id} count`,
    );
  }

  const routes = {};
  for (const scenario of scenarios) {
    const sample = captures.find((entry) => entry?.scenario === scenario);
    assert.ok(sample?.cameraPath?.id, `observed ${scenario} route is required`);
    routes[scenario] = structuredClone(sample.cameraPath);
  }
  assert.ok(
    scenarios.includes('scripted-motion'),
    'scripted-motion objective is required',
  );
  assert.ok(
    scenarios.includes('selected-aircraft-tracking'),
    'selected-aircraft-tracking objective is required',
  );

  const settings = captures[0]?.conditions?.before?.settings;
  assert.ok(
    settings && typeof settings === 'object',
    'observed visual settings are required',
  );
  assert.deepEqual(
    settings,
    captures[0]?.settings?.before,
    'observed condition and capture settings differ',
  );
  for (const field of [
    'qualityMode',
    'densityPct',
    'detectionMode',
    'resolutionScale',
    'msaaSamples',
    'antialias',
    'fxaa',
  ])
    assert.notEqual(
      settings[field],
      undefined,
      `observed visual setting ${field} is required`,
    );

  for (const [name, dimensions] of Object.entries({
    viewport: environment.viewport,
    drawingBuffer: environment.drawingBuffer,
  })) {
    assert.ok(
      dimensions && typeof dimensions === 'object',
      `observed ${name} is required`,
    );
    assert.ok(
      Number.isInteger(dimensions.width) && dimensions.width > 0,
      `observed ${name} width is invalid`,
    );
    assert.ok(
      Number.isInteger(dimensions.height) && dimensions.height > 0,
      `observed ${name} height is invalid`,
    );
  }
  assert.ok(
    Number.isFinite(environment.viewport.dpr) && environment.viewport.dpr > 0,
    'observed viewport DPR is invalid',
  );

  return {
    schema: 'gev-performance-comparison-contract/v1',
    workloadId: 'dense-investigation',
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      fixedTime: fixture.fixedTime,
    },
    fixtureDelivery: {
      schema: fixtureDelivery.schema,
      status: fixtureDelivery.status,
      method: fixtureDelivery.method,
      fixtureSha256: fixtureDelivery.fixtureSha256,
      fixedTime: fixtureDelivery.fixedTime,
      observedFlightsCount: fixtureDelivery.observedFlightsCount,
    },
    routes,
    browser: { name: browserMatch[1], version: browserMatch[2] },
    rendering: {
      viewport: structuredClone(environment.viewport),
      drawingBuffer: structuredClone(environment.drawingBuffer),
    },
    populations,
    visual: structuredClone(settings),
    objectiveScenarios: [...OBJECTIVE_SCENARIOS],
  };
}

/** Return concrete reasons a capture is diagnostic-only or incomplete. */
export function getCaptureComparisonIneligibilityReasons({
  contract = null,
  fixture = null,
  fixtureDelivery = null,
  source = null,
  environment = null,
  workload = null,
  captures = [],
  diagnosticsDocuments = [],
  workerBlobAuditInstrumented = false,
  workerBlobAuditMode = 'diagnostic',
  hardwareRequired = false,
} = {}) {
  const reasons = [];
  if (!fixture) reasons.push('production-provider-fixture-not-used');
  if (fixture && !contract)
    reasons.push('observed-comparison-contract-incomplete');
  if (!fixtureDelivery || fixtureDelivery.status !== 'observed')
    reasons.push('provider-fixture-delivery-not-observed');
  if (workload?.warmupMs !== 30_000) reasons.push('warmup-is-not-30-seconds');
  if (workload?.durationPerSampleMs !== 60_000)
    reasons.push('measurement-is-not-60-seconds');
  if (workload?.runsPerScenario !== 5)
    reasons.push('capture-does-not-have-five-runs-per-scenario');
  if (
    !Array.isArray(workload?.scenarios) ||
    !Number.isInteger(workload.runsPerScenario) ||
    workload.scenarios.some((scenario) => {
      const samples = captures.filter((sample) => sample.scenario === scenario);
      return (
        samples.length !== workload.runsPerScenario ||
        JSON.stringify(samples.map((sample) => sample.run).sort()) !==
          JSON.stringify(
            Array.from(
              { length: workload.runsPerScenario },
              (_, index) => index + 1,
            ),
          )
      );
    })
  )
    reasons.push('scenario-run-evidence-is-incomplete-or-duplicated');
  if (workload?.injectedDelayMs !== 0)
    reasons.push('injected-delay-is-enabled');
  if (!hardwareRequired || !environment?.hardwareEligible)
    reasons.push(
      'hardware-performance-acceptance-was-not-requested-or-verified',
    );
  if (
    !source?.buildProvenance ||
    source.buildProvenance.status !==
      'verified-local-build-and-served-assets-before-and-after'
  )
    reasons.push('verified-build-provenance-is-incomplete');
  if (
    diagnosticsDocuments.length === 0 ||
    diagnosticsDocuments.some(
      (row) =>
        !row?.documentRole ||
        row.requested !== true ||
        typeof row.hookAvailable !== 'boolean' ||
        typeof row.disabled !== 'boolean' ||
        (row.hookAvailable && row.disabled !== true),
    )
  )
    reasons.push('application-diagnostics-were-not-disabled-in-every-document');
  if (fixture && diagnosticsDocuments.length > 0) {
    const expectedRoles = [
      ...Array.from(
        { length: workload?.startupRuns || 0 },
        (_, index) => `startup-${index + 1}`,
      ),
      'main-setup',
      ...Array.from(
        { length: captures.length },
        (_, index) => `provider-sample-${index + 1}`,
      ),
    ].sort();
    const observedRoles = diagnosticsDocuments
      .map((row) => row.documentRole)
      .sort();
    if (JSON.stringify(observedRoles) !== JSON.stringify(expectedRoles))
      reasons.push('application-diagnostics-document-coverage-is-incomplete');
  }
  if (workerBlobAuditMode === 'prewarm')
    reasons.push(
      'prewarm-worker-audit-does-not-observe-unused-late-blob-creations',
    );
  else if (workerBlobAuditInstrumented)
    reasons.push(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    );
  if (fixture)
    reasons.push(
      'provider-fixture-is-static-count-only-not-trajectory-equivalent',
    );
  if (
    !captures.length ||
    captures.some((sample) => sample?.foregroundThroughout !== true)
  )
    reasons.push('foreground-continuity-is-incomplete');
  if (
    !workload?.scenarios?.includes('scripted-motion') ||
    !workload?.scenarios?.includes('selected-aircraft-tracking')
  )
    reasons.push('required-dense-objective-workloads-are-incomplete');
  reasons.push(
    'latency-comparison-remains-disabled-pending-uninstrumented-capture',
  );
  return [...new Set(reasons)];
}
