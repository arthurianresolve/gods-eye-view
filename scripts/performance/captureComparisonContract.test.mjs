import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCaptureDocumentTopology,
  getMainCaptureDocumentIdentity,
  createObservedDenseComparisonContract,
  createObservedInfrastructureComparisonContract,
  createObservedWeatherEffectsComparisonContract,
  getCaptureComparisonIneligibilityReasons,
  getCaptureReadinessReasons,
  isSupportedStartupOnlyFixture,
  resolveStartupOnlyFixtureIdentity,
} from './captureComparisonContract.mjs';
import { createProductionFlightFixture } from './productionFlightFixture.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';
import { makeInfrastructureReport } from './pairedReportTestFixtures.mjs';
import { AUSTIN_OPERATING_WORKLOAD_ID } from './austinOperatingWorkloadContract.mjs';

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

test('capture document topology models one infrastructure page and dense fresh sample pages', () => {
  const infrastructure = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: 1,
    captureCount: 4,
  });
  assert.deepEqual(
    infrastructure.diagnostics.map((entry) => entry.documentRole),
    ['startup-1', 'main-setup'],
  );
  assert.deepEqual(
    infrastructure.workerAudits.map((entry) => entry.documentRole),
    ['startup-1', 'main-measured'],
  );
  assert.equal(
    new Set(infrastructure.samples.map((entry) => entry.documentId)).size,
    1,
  );
  assert.deepEqual(
    getMainCaptureDocumentIdentity({ infrastructure: true, startupRuns: 1 }),
    { documentRole: 'main-measured', documentId: 'main-measured-document' },
  );

  const dense = createCaptureDocumentTopology({
    infrastructure: false,
    startupRuns: 1,
    captureCount: 3,
  });
  assert.deepEqual(
    dense.diagnostics.map((entry) => entry.documentRole),
    [
      'startup-1',
      'main-setup',
      'provider-sample-1',
      'provider-sample-2',
      'provider-sample-3',
    ],
  );
  assert.deepEqual(
    dense.workerAudits.map((entry) => entry.documentRole),
    [
      'startup-1',
      'main-setup',
      'provider-sample-1',
      'provider-sample-2',
      'provider-sample-3',
    ],
  );
  assert.equal(new Set(dense.samples.map((entry) => entry.documentId)).size, 3);
  assert.deepEqual(
    getMainCaptureDocumentIdentity({ infrastructure: false, startupRuns: 1 }),
    { documentRole: 'main-setup', documentId: 'main-measured-document' },
  );
  const reusedMain = createCaptureDocumentTopology({
    reuseMainDocumentForSamples: true,
    startupRuns: 1,
    captureCount: 4,
  });
  assert.deepEqual(reusedMain.diagnostics, [
    { documentRole: 'startup-1', documentId: 'startup-document-1' },
    { documentRole: 'main-setup', documentId: 'main-measured-document' },
  ]);
  assert.deepEqual(reusedMain.workerAudits, reusedMain.diagnostics);
  assert.deepEqual(
    reusedMain.samples,
    Array.from({ length: 4 }, () => ({
      documentRole: 'main-setup',
      documentId: 'main-measured-document',
    })),
  );
  assert.throws(
    () => createCaptureDocumentTopology({ startupRuns: 6 }),
    /between 0 and 5/,
  );
  assert.throws(
    () => createCaptureDocumentTopology({ captureCount: 31 }),
    /between 0 and 30/,
  );
});

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

test('validated receipt-only evidence clears the historical dense and infrastructure latency blockers', async () => {
  const {
    createReceiptOnlyWorkerAuditDocument,
    validateReceiptOnlyWorkerAuditEnvelope,
  } = await import('./receiptOnlyWorkerAudit.mjs');
  const appCommit = 'a'.repeat(40);
  const harnessCommit = 'b'.repeat(40);
  const receiptSha256 = 'c'.repeat(64);
  const bundlePath = `cesium/${'f'.repeat(64)}/Cesium.js`;
  const expectedAssetPaths = ['index.html', 'assets/app.js', bundlePath];
  const embeddedWorkerContract = {
    schema: 'gev-cesium-embedded-worker-contract/v1',
    bundlePath,
    bundleSha256: 'd'.repeat(64),
    workerSourceSha256: 'e'.repeat(64),
    allowedModuleCount: 12,
  };
  const expectedDocuments = [
    { documentRole: 'provider-sample-1', documentId: 'provider-document-1' },
  ];
  const document = createReceiptOnlyWorkerAuditDocument({
    ...expectedDocuments[0],
    appCommit,
    harnessCommit,
    receiptSha256,
    baseUrl: 'http://127.0.0.1:4173/',
    expectedAssetPaths,
    requestedAssetPaths: ['assets/app.js', bundlePath],
    workerTargetUrls: [`http://127.0.0.1:4173/${bundlePath}`],
    blobRequestUrls: [],
    embeddedWorkerContract,
  });
  const pageAssetAudit = {
    schema: 'gev-receipt-only-worker-audit/v1',
    status: 'all-document-receipt-paths-validated',
    workerAuditMode: 'receipt-only',
    appCommit,
    harnessCommit,
    receiptSha256,
    liveBlobBodyAttestation: 'unavailable-by-design',
    pageInstrumentation: structuredClone(document.pageInstrumentation),
    workerSource: structuredClone(document.workerSource),
    scriptRequestCount: document.requestedAssetPaths.length,
    loadedAssetPaths: [...document.requestedAssetPaths],
    unexpectedAssetPaths: [],
    workerAuditDocuments: [document],
  };
  const receiptOnlyWorkerAuditEvidence = {
    pageAssetAudit,
    expectedDocuments,
    expectedAssetPaths,
    bundlePath,
    bundleSha256: embeddedWorkerContract.bundleSha256,
    workerSourceSha256: embeddedWorkerContract.workerSourceSha256,
    allowedModuleCount: embeddedWorkerContract.allowedModuleCount,
  };
  assert.equal(
    validateReceiptOnlyWorkerAuditEnvelope({
      pageAssetAudit,
      appCommit,
      harnessCommit,
      receiptSha256,
      ...receiptOnlyWorkerAuditEvidence,
    }),
    true,
  );
  const source = {
    buildProvenance: { appCommit, harnessCommit, receiptSha256 },
  };
  for (const { fixture, contract } of [
    { fixture: {}, contract: { workloadId: 'dense-investigation' } },
    {
      fixture: { schema: 'gev-infrastructure-fixture-manifest/v1' },
      contract: { workloadId: 'infrastructure-datacenters' },
    },
  ]) {
    const reasons = getCaptureReadinessReasons({
      workerAuditMode: 'receipt-only',
      receiptOnlyWorkerAuditEvidence,
      source,
      fixture,
      contract,
    });
    assert.equal(
      reasons.includes('receipt-only-worker-audit-evidence-is-incomplete'),
      false,
    );
    assert.equal(
      reasons.includes(
        'provider-fixture-is-static-count-only-not-trajectory-equivalent',
      ),
      false,
    );
    assert.equal(
      reasons.includes(
        'latency-comparison-remains-disabled-pending-uninstrumented-capture',
      ),
      false,
    );
  }
});

test('receipt-only readiness uses capture producer identity when builder differs', async () => {
  const { validateReceiptOnlyWorkerAuditEnvelope } =
    await import('./receiptOnlyWorkerAudit.mjs');
  const producer = 'e'.repeat(40);
  const builder = 'f'.repeat(40);
  const base = {
    schema: 'gev-receipt-only-worker-audit/v1',
    status: 'all-document-receipt-paths-validated',
    workerAuditMode: 'receipt-only',
    appCommit: 'a'.repeat(40),
    harnessCommit: producer,
    receiptSha256: 'c'.repeat(64),
    expectedDocuments: [],
    expectedAssetPaths: [],
    workerAuditDocuments: [],
  };
  assert.equal(
    validateReceiptOnlyWorkerAuditEnvelope({
      pageAssetAudit: base,
      appCommit: base.appCommit,
      harnessCommit: producer,
      receiptSha256: base.receiptSha256,
      expectedDocuments: [],
      expectedAssetPaths: [],
      bundlePath: 'cesium/x/Cesium.js',
      bundleSha256: 'd'.repeat(64),
      workerSourceSha256: 'e'.repeat(64),
      allowedModuleCount: 1,
    }),
    false,
  );
  const source = {
    buildProvenance: {
      appCommit: base.appCommit,
      harnessCommit: builder,
      captureProducerCommit: producer,
      receiptSha256: base.receiptSha256,
    },
  };
  assert.equal(source.buildProvenance.harnessCommit, builder);
  assert.equal(source.buildProvenance.captureProducerCommit, producer);
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
  const report = makeInfrastructureReport(
    'a'.repeat(40),
    'infrastructure-datacenters',
  );
  return {
    fixture: report.workload.fixture,
    workload: {
      warmupMs: report.workload.warmupMs,
      durationPerSampleMs: report.workload.durationPerSampleMs,
      runsPerScenario: report.workload.runsPerScenario,
    },
    populations: report.environment.layers,
    settings: report.captures[0].settings.before,
    fixtureDelivery: report.fixtureDelivery,
    captures: report.captures,
    environment: report.environment,
  };
}

function makeWeatherEffectsObservation() {
  const fixture = createWeatherEffectsWorkloadFixture();
  const populations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const weatherVisual = {
    satelliteProduct: 'clouds-regional',
    satelliteInfrared: 'filtered',
    radarOpacity: 'strong',
    lightningOpacity: 'strong',
    windModel: 'gfs',
    windOverlay: 'speed',
    windPaused: false,
  };
  const visualSettings = {
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
  };
  const assets = fixture.assets.map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    contentType: asset.contentType,
    responseCount: 1,
  }));
  const fixtureDelivery = {
    schema: 'gev-weather-effects-fixture-delivery/v2',
    status: 'observed',
    workloadId: fixture.workloadId,
    method: 'same-origin-hash-pinned-weather-phase-fixture-v2',
    fixtureId: fixture.id,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    phaseSchedule: structuredClone(fixture.phaseSchedule),
    assets: assets.map((asset) => ({ ...asset, responseCount: 10 })),
    populationsBefore: populations,
    populationsAfter: populations,
    fulfilledResponseCount: assets.length,
    routeErrors: [],
  };
  fixtureDelivery.fulfilledResponseCount = fixtureDelivery.assets.reduce(
    (sum, asset) => sum + asset.responseCount,
    0,
  );
  const environment = {
    userAgent: 'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36',
    layers: populations,
    viewport: { width: 1440, height: 900, dpr: 1 },
    drawingBuffer: { width: 1440, height: 900 },
  };
  const routes = {
    idle: {
      id: 'parked-v1',
      start: {
        position: { x: 1, y: 2, z: 3 },
        direction: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      elapsedDurationMs: 60_000,
      motionDistanceM: 0,
    },
    'scripted-motion': {
      id: 'elapsed-move-right-v1',
      start: {
        position: { x: 1, y: 2, z: 3 },
        direction: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      elapsedDurationMs: 60_000,
      motionDistanceM: 19_200,
    },
  };
  const captures = [];
  let captureOrdinal = 0;
  for (const scenario of Object.keys(routes)) {
    for (let run = 1; run <= 5; run += 1) {
      const phaseObservations = {
        schema: 'gev-weather-phase-observations/v1',
        durationMs: 60_000,
        fixtureSha256: fixture.sha256,
        phases: fixture.phaseSchedule.phases.map((phase) => ({
          id: phase.id,
          fixtureSha256: fixture.sha256,
          expectedSourceTime: phase.sourceTime,
          scheduledAtMs: phase.offsetMs,
          observedAtElapsedMs: phase.offsetMs + 100,
          sourceObservationTimes: Array(3).fill(phase.sourceTime),
          clock: { mode: 'history', playing: false },
        })),
      };
      const weatherState = {
        motionPreference: {
          schema: 'gev-weather-motion-preference/v1',
          reducedMotion: false,
        },
        clock: { mode: 'latest', playing: false },
        sourceObservationTimes: Array(3).fill(fixture.timeline.at(-1)),
        visualState: weatherVisual,
        populations: populations.map((row) => ({
          ...row,
          loading: false,
          error: null,
        })),
      };
      const sample = {
        scenario,
        run,
        durationMs: 60_005,
        foregroundThroughout: true,
        cameraPath: structuredClone(routes[scenario]),
        layers: populations,
        settings: {
          before: structuredClone(visualSettings),
          after: structuredClone(visualSettings),
        },
        fixtureDelivery: {
          ...structuredClone(fixtureDelivery),
          assets: fixtureDelivery.assets.map((asset) => ({
            ...asset,
            responseCount: captureOrdinal + 1,
          })),
          fulfilledResponseCount:
            fixtureDelivery.assets.length * (captureOrdinal + 1),
        },
        conditions: {
          before: {
            settings: structuredClone(visualSettings),
            environment: {
              layers: populations,
              viewport: environment.viewport,
              drawingBuffer: environment.drawingBuffer,
            },
          },
          after: {
            settings: structuredClone(visualSettings),
            environment: {
              layers: populations,
              viewport: environment.viewport,
              drawingBuffer: environment.drawingBuffer,
            },
          },
        },
        weatherEffectsClock: {
          schema: 'gev-weather-effects-clock/v2',
          fixedHarnessTime: fixture.fixedTime,
          wallClockBeforeMs: fixture.fixedTimeMs,
          wallClockAfterMs: fixture.fixedTimeMs,
          motionPreferencePreflight: {
            schema: 'gev-weather-motion-preference/v1',
            reducedMotion: false,
          },
          weatherStateBefore: structuredClone(weatherState),
          weatherStateAfter: {
            ...structuredClone(weatherState),
            clock: { mode: 'history', playing: false },
          },
          phaseObservations,
        },
      };
      captures.push(sample);
      captureOrdinal += 1;
    }
  }
  return {
    fixture,
    fixtureDelivery,
    environment,
    captures,
    scenarios: ['idle', 'scripted-motion'],
    workload: {
      warmupMs: 30_000,
      durationPerSampleMs: 60_000,
      runsPerScenario: 5,
    },
  };
}

test('infrastructure comparison exports observed workloads without dense objective claims', () => {
  const observed = makeInfrastructureObservation();
  const contract = createObservedInfrastructureComparisonContract({
    ...observed,
    scenarios: ['idle', 'scripted-motion'],
    workload: observed.workload,
  });
  assert.equal(contract.workloadId, 'infrastructure-datacenters');
  assert.deepEqual(contract.populations, observed.populations);
  assert.deepEqual(contract.objectiveScenarios, []);
  const alteredSampleDelivery = structuredClone(observed);
  alteredSampleDelivery.captures[0].fixtureDelivery = structuredClone(
    alteredSampleDelivery.fixtureDelivery,
  );
  alteredSampleDelivery.captures[0].fixtureDelivery.assets[0].responseCount += 1;
  assert.throws(() =>
    createObservedInfrastructureComparisonContract({
      ...alteredSampleDelivery,
      scenarios: ['idle', 'scripted-motion'],
      workload: observed.workload,
    }),
  );
});

test('weather comparison contract binds phase source, settings, populations and display geometry', () => {
  const observed = makeWeatherEffectsObservation();
  const create = (overrides = {}) =>
    createObservedWeatherEffectsComparisonContract({
      ...observed,
      ...overrides,
    });
  const contract = create();
  assert.equal(contract.workloadId, 'weather-effects');
  assert.deepEqual(contract.objectiveScenarios, []);
  assert.equal(contract.fixture.phaseSchedule.measurementMs, 60_000);
  assert.equal(
    Object.hasOwn(contract.fixtureDelivery, 'fulfilledResponseCount'),
    false,
  );
  assert.equal(
    contract.fixtureDelivery.assets.some((asset) =>
      Object.hasOwn(asset, 'responseCount'),
    ),
    false,
  );
  assert.deepEqual(
    contract.populations,
    observed.fixtureDelivery.populationsBefore,
  );
  const numericInfrared = structuredClone(observed);
  for (const sample of numericInfrared.captures) {
    sample.weatherEffectsClock.weatherStateBefore.visualState.satelliteInfrared = 100;
    sample.weatherEffectsClock.weatherStateAfter.visualState.satelliteInfrared = 100;
  }
  assert.doesNotThrow(() => create(numericInfrared));
  assert.equal(
    numericInfrared.captures[0].weatherEffectsClock.weatherStateBefore
      .visualState.satelliteInfrared,
    100,
  );
  for (const invalidInfrared of [0, 99, '100', null, undefined]) {
    const invalid = structuredClone(observed);
    for (const sample of invalid.captures) {
      sample.weatherEffectsClock.weatherStateBefore.visualState.satelliteInfrared =
        invalidInfrared;
      sample.weatherEffectsClock.weatherStateAfter.visualState.satelliteInfrared =
        invalidInfrared;
    }
    assert.throws(() => create(invalid));
  }
  for (const mutate of [
    (value) => {
      value.fixture.mediaPreferences['prefers-reduced-motion'] = 'reduce';
    },
    (value) => {
      delete value.fixture.mediaPreferences;
      for (const sample of value.captures) {
        delete sample.weatherEffectsClock.schema;
        delete sample.weatherEffectsClock.motionPreferencePreflight;
        delete sample.weatherEffectsClock.weatherStateBefore.motionPreference;
        delete sample.weatherEffectsClock.weatherStateAfter.motionPreference;
      }
    },
    (value) => {
      delete value.captures[0].weatherEffectsClock.motionPreferencePreflight;
    },
    (value) => {
      value.captures[0].weatherEffectsClock.motionPreferencePreflight.reducedMotion = true;
    },
    (value) => {
      delete value.captures[0].weatherEffectsClock.weatherStateBefore
        .motionPreference;
    },
    (value) => {
      value.captures[0].weatherEffectsClock.weatherStateAfter.motionPreference.schema =
        'unknown';
    },
    (value) => {
      value.captures[0].weatherEffectsClock.schema = 'unknown';
    },
  ]) {
    const invalid = structuredClone(observed);
    mutate(invalid);
    assert.throws(() => create(invalid));
  }
  const legacyMotion = structuredClone(observed);
  const legacyFixtureSha256 =
    '5ba7e41ab29a1b9eeb6c773059f872bcd9f12879f358c4e7aaccb4a152bbac9a';
  const rewriteFixtureDigest = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) rewriteFixtureDigest(item);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (
          ['sha256', 'manifestSha256', 'fixtureSha256'].includes(key) &&
          child === observed.fixture.sha256
        )
          value[key] = legacyFixtureSha256;
        else rewriteFixtureDigest(child);
      }
    }
  };
  rewriteFixtureDigest(legacyMotion);
  delete legacyMotion.fixture.mediaPreferences;
  for (const sample of legacyMotion.captures) {
    delete sample.weatherEffectsClock.schema;
    delete sample.weatherEffectsClock.motionPreferencePreflight;
    delete sample.weatherEffectsClock.weatherStateBefore.motionPreference;
    delete sample.weatherEffectsClock.weatherStateAfter.motionPreference;
  }
  assert.doesNotThrow(() => create(legacyMotion));
  for (const mutate of [
    (value) =>
      (value.captures[0].weatherEffectsClock.weatherStateBefore.clock.mode =
        'history'),
    (value) =>
      (value.captures[0].weatherEffectsClock.weatherStateAfter.clock.mode =
        'latest'),
    (value) =>
      (value.captures[0].weatherEffectsClock.phaseObservations.phases[1].expectedSourceTime =
        value.fixture.timeline[0]),
    (value) =>
      (value.captures[0].weatherEffectsClock.weatherStateAfter.visualState.windPaused = true),
    (value) => {
      value.captures[0].layers = structuredClone(value.captures[0].layers);
      value.captures[0].layers[0].count += 1;
    },
    (value) => {
      value.captures[0].settings.after = {
        ...value.captures[0].settings.after,
        resolutionScale: 0.5,
      };
    },
    (value) => {
      value.captures[1].fixtureDelivery.assets[0].responseCount = 0;
    },
    (value) => {
      value.captures[2].fixtureDelivery.assets[0].responseCount = 11;
    },
    (value) => {
      value.captures[3].fixtureDelivery.fulfilledResponseCount += 1;
    },
    (value) => {
      value.captures[4].fixtureDelivery.assets[0].responseCount = 3;
    },
  ]) {
    const invalid = structuredClone(observed);
    mutate(invalid);
    assert.throws(() => create(invalid));
  }
  const legacy = structuredClone(observed);
  legacy.fixture.schema = 'gev-weather-effects-fixture/v1';
  legacy.fixture.id = 'weather-effects-austin-v1';
  assert.throws(() => create(legacy), /gev-weather-effects-fixture\/v2/);
  const short = structuredClone(observed);
  short.workload.durationPerSampleMs = 30_000;
  assert.throws(() => create(short));
});

test('infrastructure readiness binds one measured document across captures and setup diagnostics', () => {
  const observed = makeInfrastructureObservation();
  const diagnosticsDocuments = [
    {
      documentRole: 'startup-1',
      documentId: 'startup-document-1',
      requested: true,
      hookAvailable: true,
      disabled: true,
    },
    {
      documentRole: 'main-setup',
      documentId: 'main-measured-document',
      requested: true,
      hookAvailable: true,
      disabled: true,
    },
  ];
  const args = () => ({
    fixture: observed.fixture,
    fixtureDelivery: observed.fixtureDelivery,
    contract: createObservedInfrastructureComparisonContract({
      ...observed,
      scenarios: ['idle', 'scripted-motion'],
      workload: observed.workload,
    }),
    workload: {
      startupRuns: 1,
      scenarios: ['idle', 'scripted-motion'],
      runsPerScenario: observed.workload.runsPerScenario,
      injectedDelayMs: 0,
    },
    captures: observed.captures,
    diagnosticsDocuments,
  });
  assert.equal(
    getCaptureComparisonIneligibilityReasons(args()).includes(
      'application-diagnostics-document-coverage-is-incomplete',
    ),
    false,
  );
  assert.equal(
    getCaptureComparisonIneligibilityReasons(args()).includes(
      'infrastructure-samples-do-not-share-measured-document',
    ),
    false,
  );

  const splitSample = args();
  splitSample.captures = structuredClone(observed.captures);
  splitSample.captures[1].documentId = 'other-document';
  assert.ok(
    getCaptureComparisonIneligibilityReasons(splitSample).includes(
      'infrastructure-samples-do-not-share-measured-document',
    ),
  );
  const missingDocumentRole = args();
  missingDocumentRole.captures = structuredClone(observed.captures);
  missingDocumentRole.captures[0].documentRole = 'provider-sample-1';
  assert.ok(
    getCaptureComparisonIneligibilityReasons(missingDocumentRole).includes(
      'infrastructure-samples-do-not-share-measured-document',
    ),
  );
  const missingMainSetup = args();
  missingMainSetup.diagnosticsDocuments = [diagnosticsDocuments[0]];
  assert.ok(
    getCaptureComparisonIneligibilityReasons(missingMainSetup).includes(
      'application-diagnostics-document-coverage-is-incomplete',
    ),
  );
});

test('infrastructure contract rejects altered source populations and clock', () => {
  const observed = makeInfrastructureObservation();
  const args = () => ({
    ...observed,
    scenarios: ['idle', 'scripted-motion'],
    workload: observed.workload,
  });
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
  const changedAsset = args();
  changedAsset.fixture = structuredClone(observed.fixture);
  changedAsset.fixture.assets[0].sha256 = 'f'.repeat(64);
  assert.throws(
    () => createObservedInfrastructureComparisonContract(changedAsset),
    /fixture SHA-256|manifest differs/,
  );
  const changedRoute = args();
  changedRoute.captures = structuredClone(observed.captures);
  changedRoute.captures[0].cameraPath.start.position.x += 1;
  assert.throws(
    () => createObservedInfrastructureComparisonContract(changedRoute),
    /route differs from the pinned camera\/scenario/,
  );
});

test('startup-only shards accept dams, Austin, or dense with their real row identity', () => {
  assert.equal(isSupportedStartupOnlyFixture('infrastructure-dams'), true);
  assert.equal(
    isSupportedStartupOnlyFixture(AUSTIN_OPERATING_WORKLOAD_ID),
    true,
  );
  assert.equal(isSupportedStartupOnlyFixture('dense-investigation'), true);
  assert.equal(isSupportedStartupOnlyFixture('infrastructure-cables'), false);
  assert.deepEqual(
    resolveStartupOnlyFixtureIdentity('infrastructure-dams', {
      infrastructureWorkload: {
        workloadId: 'infrastructure-dams',
        id: 'bundled-dams-static-v1',
        sha256: 'a'.repeat(64),
      },
    }),
    {
      workloadId: 'infrastructure-dams',
      id: 'bundled-dams-static-v1',
      sha256: 'a'.repeat(64),
    },
  );
  assert.deepEqual(
    resolveStartupOnlyFixtureIdentity(AUSTIN_OPERATING_WORKLOAD_ID, {
      austinOperatingWorkload: {
        workloadId: AUSTIN_OPERATING_WORKLOAD_ID,
        id: 'austin-operating-composed-v1',
        sha256: 'b'.repeat(64),
      },
    }),
    {
      matrixRowId: 'operating-view',
      workloadId: AUSTIN_OPERATING_WORKLOAD_ID,
      id: 'austin-operating-composed-v1',
      sha256: 'b'.repeat(64),
    },
  );
  assert.throws(
    () => resolveStartupOnlyFixtureIdentity('infrastructure-cables'),
    /Unsupported startup-only workload/,
  );
  assert.throws(
    () =>
      resolveStartupOnlyFixtureIdentity(AUSTIN_OPERATING_WORKLOAD_ID, {
        austinOperatingWorkload: {
          workloadId: 'infrastructure-dams',
          id: 'bundled-dams-static-v1',
          sha256: 'c'.repeat(64),
        },
      }),
    /Expected values to be strictly equal/,
  );
});
