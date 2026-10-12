import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createObservedDenseComparisonContract,
  createObservedInfrastructureComparisonContract,
  getCaptureComparisonIneligibilityReasons,
  getCaptureReadinessReasons,
} from './captureComparisonContract.mjs';
import { createProductionFlightFixture } from './productionFlightFixture.mjs';
import { createInfrastructureWorkloadFixture } from './infrastructureWorkloadFixture.mjs';

const fixture = createProductionFlightFixture({
  count: 2500,
  fixedTime: '2026-10-08T12:00:00.000Z',
});
const populations = [
  { id: 'flights', enabled: true, count: 2500 },
  { id: 'local-datacenters', enabled: true, count: 4362 },
  { id: 'local-dams', enabled: true, count: 716 },
];
const settings = {
  qualityMode: 'manual',
  densityPct: 75,
  detectionMode: 'DENSE',
  resolutionScale: 1,
  msaaSamples: 4,
  antialias: false,
  fxaa: true,
  visualState: { style: 'normal', styleParams: {}, detection: { density: 75 } },
};

function makeObservedCapture() {
  const fixtureDelivery = {
    schema: 'gev-fixture-delivery-observation/v1',
    status: 'observed',
    method:
      'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    fulfilledResponseCount: 7,
    observedFlightsCount: 2500,
  };
  const scenarios = ['idle', 'scripted-motion', 'selected-aircraft-tracking'];
  const captures = scenarios.map((scenario) => ({
    scenario,
    run: 1,
    layers: structuredClone(populations),
    settings: { before: structuredClone(settings) },
    fixtureDelivery: { ...fixtureDelivery, fulfilledResponseCount: 2 },
    conditions: {
      before: { settings: structuredClone(settings) },
    },
    cameraPath: {
      id:
        scenario === 'scripted-motion'
          ? 'elapsed-move-right-v1'
          : scenario === 'selected-aircraft-tracking'
            ? 'entity-follow-v1'
            : 'parked-v1',
      start: { position: { x: 1, y: 2, z: 3 } },
    },
  }));
  const environment = {
    userAgent: 'Mozilla/5.0 HeadlessChrome/152.0.0.0',
    viewport: { width: 1280, height: 900, dpr: 1 },
    drawingBuffer: { width: 1280, height: 900 },
    layers: structuredClone(populations),
  };
  return { captures, fixtureDelivery, environment, scenarios };
}

function contractFor(observed = makeObservedCapture()) {
  return createObservedDenseComparisonContract({
    fixture,
    ...observed,
  });
}

test('contract adapter reads a realistic rawReport.captures export', () => {
  const observed = makeObservedCapture();
  const contract = contractFor(observed);
  assert.equal(contract.schema, 'gev-performance-comparison-contract/v1');
  assert.equal(contract.fixture.sha256, fixture.sha256);
  assert.equal(contract.browser.name, 'HeadlessChrome');
  assert.equal(contract.browser.version, '152.0.0.0');
  assert.equal(
    contract.fixtureDelivery.method,
    observed.fixtureDelivery.method,
  );
  assert.deepEqual(
    contract.populations,
    [...populations].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(contract.visual, settings);
  assert.deepEqual(contract.rendering.viewport, observed.environment.viewport);
  assert.equal(
    contract.routes['selected-aircraft-tracking'].id,
    'entity-follow-v1',
  );
});

test('contract refuses mismatched population, missing route, and divergent settings copies', () => {
  const wrongPopulation = makeObservedCapture();
  wrongPopulation.captures[0].layers[0].count = 2499;
  assert.throws(() => contractFor(wrongPopulation), /populations differ/);

  const missingTracking = makeObservedCapture();
  missingTracking.scenarios = ['idle', 'scripted-motion'];
  assert.throws(
    () => contractFor(missingTracking),
    /selected-aircraft-tracking objective/,
  );

  const divergentSettings = makeObservedCapture();
  divergentSettings.captures[0].settings.before.msaaSamples = 2;
  assert.throws(() => contractFor(divergentSettings), /settings copies differ/);

  const wrongDenseCount = makeObservedCapture();
  wrongDenseCount.captures[0].layers[0].count = 2499;
  wrongDenseCount.environment.layers[0].count = 2499;
  wrongDenseCount.captures.forEach((sample) => {
    sample.layers[0].count = 2499;
    sample.fixtureDelivery.observedFlightsCount = 2499;
  });
  wrongDenseCount.fixtureDelivery.observedFlightsCount = 2499;
  assert.throws(() => contractFor(wrongDenseCount), /registered fixture/);
});

test('contract refuses absent delivery acknowledgment or invalid viewport dimensions', () => {
  const missingAck = makeObservedCapture();
  missingAck.fixtureDelivery.fulfilledResponseCount = 0;
  assert.throws(() => contractFor(missingAck), /response acknowledgment/);

  const invalidSize = makeObservedCapture();
  invalidSize.environment.viewport.width = Infinity;
  assert.throws(() => contractFor(invalidSize), /viewport width/);
});

test('diagnostic-only captures retain explicit reasons and allow an unsupported baseline hook', () => {
  const observed = makeObservedCapture();
  const contract = contractFor(observed);
  const reasons = getCaptureComparisonIneligibilityReasons({
    fixture,
    fixtureDelivery: observed.fixtureDelivery,
    contract,
    source: {},
    environment: { hardwareEligible: false },
    workload: {
      warmupMs: 1000,
      durationPerSampleMs: 1000,
      runsPerScenario: 1,
      startupRuns: 0,
      injectedDelayMs: 0,
      scenarios: observed.scenarios,
      hardwareRequired: false,
    },
    captures: [{ foregroundThroughout: true }],
    diagnosticsDocuments: [
      {
        documentRole: 'main-setup',
        requested: true,
        hookAvailable: false,
        disabled: false,
      },
      {
        documentRole: 'provider-sample-1',
        requested: true,
        hookAvailable: false,
        disabled: false,
      },
    ],
    workerBlobAuditInstrumented: true,
    hardwareRequired: false,
  });
  assert.ok(reasons.includes('warmup-is-not-30-seconds'));
  assert.ok(reasons.includes('measurement-is-not-60-seconds'));
  assert.ok(
    reasons.includes(
      'application-diagnostics-were-not-disabled-in-every-document',
    ) === false,
  );
  assert.ok(
    reasons.includes(
      'application-diagnostics-document-coverage-is-incomplete',
    ) === false,
  );
  assert.ok(
    reasons.includes(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    ),
  );
  assert.ok(
    reasons.includes(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    ),
  );
});

test('prewarm audit readiness names the unobservable late-creation limitation', () => {
  const reasons = getCaptureComparisonIneligibilityReasons({
    workerBlobAuditMode: 'prewarm',
  });
  assert.ok(
    reasons.includes(
      'prewarm-worker-audit-does-not-observe-unused-late-blob-creations',
    ),
  );
  assert.equal(
    reasons.includes(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    ),
    false,
  );
});

test('capture readiness boundary maps workerAuditMode into the report reason', () => {
  const prewarmReasons = getCaptureReadinessReasons({
    workerAuditMode: 'prewarm',
    workerBlobAuditInstrumented: true,
  });
  assert.ok(
    prewarmReasons.includes(
      'prewarm-worker-audit-does-not-observe-unused-late-blob-creations',
    ),
  );
  assert.equal(
    prewarmReasons.includes(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    ),
    false,
  );
});

test('missing diagnostics document observations are explicitly ineligible', () => {
  const reasons = getCaptureComparisonIneligibilityReasons({
    diagnosticsDocuments: [],
  });
  assert.ok(
    reasons.includes(
      'application-diagnostics-were-not-disabled-in-every-document',
    ),
  );
});

function makeInfrastructureObservation() {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure-datacenters',
    '2026-10-08T12:00:00.000Z',
  );
  const populations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const settings = {
    qualityMode: 'manual',
    densityPct: 75,
    detectionMode: 'DENSE',
    resolutionScale: 1,
    msaaSamples: 4,
    antialias: true,
    fxaa: true,
  };
  const cesiumClock = {
    currentTime: fixture.clock,
    shouldAnimate: false,
    multiplier: 0,
  };
  const assets = fixture.assets.map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    status: 200,
    responseCount: 1,
  }));
  const fixtureDelivery = {
    schema: 'gev-infrastructure-fixture-delivery-observation/v1',
    status: 'observed',
    method: 'actual same-origin bundled asset response bodies SHA-256 verified',
    fixtureId: fixture.id,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    assets,
    populationsBefore: populations,
    populationsAfter: populations,
  };
  const captures = ['idle', 'scripted-motion'].map((scenario) => ({
    scenario,
    run: 1,
    layers: populations,
    settings: { before: settings, after: settings },
    fixtureDelivery,
    infrastructureFixtureClock: {
      fixedTime: fixture.fixedTime,
      wallClockBeforeMs: fixture.fixedTimeMs,
      wallClockAfterMs: fixture.fixedTimeMs,
      cesiumBefore: cesiumClock,
      cesiumAfter: cesiumClock,
    },
    conditions: {
      before: { environment: { layers: populations } },
      after: { environment: { layers: populations } },
    },
    cameraPath: { id: `${scenario}-route-v1` },
  }));
  const environment = {
    userAgent: 'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36',
    layers: populations,
    viewport: { width: 1440, height: 900, dpr: 1 },
    drawingBuffer: { width: 1440, height: 900 },
  };
  return {
    fixture,
    populations,
    settings,
    fixtureDelivery,
    captures,
    environment,
  };
}

test('infrastructure comparison exports observed workloads without dense objective claims', () => {
  const observed = makeInfrastructureObservation();
  const contract = createObservedInfrastructureComparisonContract({
    ...observed,
    scenarios: ['idle', 'scripted-motion'],
  });
  assert.equal(contract.workloadId, 'infrastructure-datacenters');
  assert.deepEqual(contract.populations, observed.populations);
  assert.deepEqual(contract.objectiveScenarios, []);
});

test('infrastructure contract rejects altered source populations and clock', () => {
  const observed = makeInfrastructureObservation();
  const args = () => ({ ...observed, scenarios: ['idle', 'scripted-motion'] });
  const wrongPopulation = args();
  wrongPopulation.captures = structuredClone(observed.captures);
  wrongPopulation.captures[0].layers[0].count += 1;
  assert.throws(() =>
    createObservedInfrastructureComparisonContract(wrongPopulation),
  );
  const wrongClock = args();
  wrongClock.captures = structuredClone(observed.captures);
  wrongClock.captures[0].infrastructureFixtureClock.wallClockAfterMs += 1;
  assert.throws(() =>
    createObservedInfrastructureComparisonContract(wrongClock),
  );
  const unsupported = args();
  unsupported.scenarios = ['idle', 'selected-aircraft-tracking'];
  assert.throws(
    () => createObservedInfrastructureComparisonContract(unsupported),
    /selected-aircraft-tracking/,
  );
});
