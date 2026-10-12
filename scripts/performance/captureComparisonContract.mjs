import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DENSE_FLIGHT_FIXTURE_ID } from './productionFlightFixture.mjs';
import { assertInfrastructureClockObservation } from './infrastructureWorkloadContract.mjs';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_WIND_VALID_TIME,
} from './austinOperatingWorkloadContract.mjs';
import { summarizeAustinNativePopulations } from './austinOperatingPopulationEvidence.mjs';
import { validateReceiptOnlyWorkerAuditEnvelope } from './receiptOnlyWorkerAudit.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const hashCanonicalIds = (ids) =>
  createHash('sha256')
    .update(ids.slice().sort().join('\n'), 'utf8')
    .digest('hex');
const REQUIRED_POPULATIONS = Object.freeze({
  flights: 2500,
  'local-datacenters': 4362,
  'local-dams': 716,
});
const OBJECTIVE_SCENARIOS = Object.freeze([
  'scripted-motion',
  'selected-aircraft-tracking',
]);

export function createCaptureDocumentTopology({
  infrastructure = false,
  startupRuns = 1,
  captureCount = 0,
} = {}) {
  if (!Number.isInteger(startupRuns) || startupRuns < 0 || startupRuns > 5)
    throw new Error(
      'Capture document topology startupRuns must be between 0 and 5.',
    );
  if (!Number.isInteger(captureCount) || captureCount < 0 || captureCount > 30)
    throw new Error(
      'Capture document topology captureCount must be between 0 and 30.',
    );
  const startup = Array.from({ length: startupRuns }, (_, index) => ({
    documentRole: `startup-${index + 1}`,
    documentId: `startup-document-${index + 1}`,
  }));
  const mainDocumentId = 'main-measured-document';
  const main = {
    documentRole: infrastructure ? 'main-measured' : 'main-setup',
    documentId: mainDocumentId,
  };
  const samples = infrastructure
    ? Array.from({ length: captureCount }, () => ({ ...main }))
    : Array.from({ length: captureCount }, (_, index) => ({
        documentRole: `provider-sample-${index + 1}`,
        documentId: `provider-document-${index + 1}`,
      }));
  return {
    diagnostics: [
      ...startup,
      { documentRole: 'main-setup', documentId: mainDocumentId },
      ...(!infrastructure ? samples : []),
    ],
    workerAudits: [...startup, main, ...(!infrastructure ? samples : [])],
    samples,
  };
}

export function getMainCaptureDocumentIdentity({
  infrastructure = false,
  startupRuns = 1,
} = {}) {
  const topology = createCaptureDocumentTopology({
    infrastructure,
    startupRuns,
    captureCount: 0,
  });
  const mainDiagnostic = topology.diagnostics[startupRuns];
  const mainWorkerAudit = topology.workerAudits.find((entry) =>
    infrastructure
      ? entry.documentRole === 'main-measured'
      : entry.documentRole === 'main-setup',
  );
  if (!mainDiagnostic || !mainWorkerAudit)
    throw new Error('Capture document topology has no measured main page.');
  return {
    documentRole: mainWorkerAudit.documentRole,
    documentId: mainDiagnostic.documentId,
  };
}

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

/** Build an S47 contract from actual bundled infrastructure responses and layer observations. */
export function createObservedInfrastructureComparisonContract({
  fixture,
  fixtureDelivery,
  environment,
  captures,
  scenarios,
} = {}) {
  assert.equal(fixture?.schema, 'gev-infrastructure-fixture-manifest/v1');
  assert.ok(
    typeof fixture.id === 'string' && fixture.id,
    'infrastructure fixture identity is required',
  );
  assert.match(
    fixture.sha256 || '',
    SHA256,
    'fixture manifest SHA-256 is required',
  );
  assert.ok(
    Number.isFinite(Date.parse(fixture.fixedTime)),
    'fixture fixed time is invalid',
  );
  assert.equal(
    fixtureDelivery?.schema,
    'gev-infrastructure-fixture-delivery-observation/v1',
  );
  assert.equal(fixtureDelivery?.status, 'observed');
  assert.equal(fixtureDelivery.fixtureId, fixture.id);
  assert.equal(fixtureDelivery.fixtureSha256, fixture.sha256);
  assert.equal(fixtureDelivery.fixedTime, fixture.fixedTime);
  assert.deepEqual(
    fixtureDelivery.assets,
    fixture.assets.map(({ id, sha256, byteLength }) => {
      const observed = fixtureDelivery.assets?.find((row) => row.id === id);
      assert.ok(observed, `served infrastructure asset ${id} is required`);
      assert.equal(
        observed.sha256,
        sha256,
        `served infrastructure asset ${id} SHA differs`,
      );
      assert.equal(
        observed.byteLength,
        byteLength,
        `served infrastructure asset ${id} size differs`,
      );
      assert.equal(
        observed.status,
        200,
        `served infrastructure asset ${id} status differs`,
      );
      assert.ok(
        Number.isInteger(observed.responseCount) && observed.responseCount > 0,
      );
      return observed;
    }),
    'delivered asset observations differ from the fixture manifest',
  );
  assert.ok(environment && typeof environment.userAgent === 'string');
  const browserMatch = environment.userAgent.match(
    /(HeadlessChrome|Chrome|Chromium)\/([\d.]+)/,
  );
  assert.ok(browserMatch, 'browser identity was not observed');
  assert.ok(Array.isArray(captures) && captures.length > 0);
  assert.deepEqual(scenarios, ['idle', 'scripted-motion']);

  const expectedPopulations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const enabled = (rows, label) => enabledPopulations(rows, label);
  assert.deepEqual(
    enabled(environment.layers, 'environment'),
    expectedPopulations,
  );
  assert.deepEqual(fixtureDelivery.populationsBefore, expectedPopulations);
  assert.deepEqual(fixtureDelivery.populationsAfter, expectedPopulations);
  for (const [index, sample] of captures.entries()) {
    const before = sample.conditions?.before;
    const after = sample.conditions?.after;
    assert.deepEqual(
      enabled(before?.environment?.layers, `capture ${index + 1} before`),
      expectedPopulations,
    );
    assert.deepEqual(
      enabled(after?.environment?.layers, `capture ${index + 1} after`),
      expectedPopulations,
    );
    assert.deepEqual(sample.layers, after.environment.layers);
    assert.deepEqual(sample.fixtureDelivery?.assets, fixtureDelivery.assets);
    assert.deepEqual(
      sample.fixtureDelivery?.populationsBefore,
      expectedPopulations,
    );
    assert.deepEqual(
      sample.fixtureDelivery?.populationsAfter,
      expectedPopulations,
    );
    assert.deepEqual(sample.settings?.before, sample.settings?.after);
    assert.deepEqual(sample.settings?.before, captures[0]?.settings?.before);
    assert.equal(
      sample.infrastructureFixtureClock?.fixedTime,
      fixture.fixedTime,
    );
    assert.equal(
      sample.infrastructureFixtureClock?.wallClockBeforeMs,
      fixture.fixedTimeMs,
    );
    assert.equal(
      sample.infrastructureFixtureClock?.wallClockAfterMs,
      fixture.fixedTimeMs,
    );
    assertInfrastructureClockObservation(
      sample.infrastructureFixtureClock?.cesiumBefore,
      fixture,
      `capture ${index + 1} before`,
    );
    assertInfrastructureClockObservation(
      sample.infrastructureFixtureClock?.cesiumAfter,
      fixture,
      `capture ${index + 1} after`,
    );
    assert.ok(
      sample.cameraPath?.id,
      `capture ${index + 1} observed route is required`,
    );
  }
  const settings = captures[0].settings?.before;
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
      settings?.[field],
      undefined,
      `effective visual setting ${field} is required`,
    );
  for (const [name, dimensions] of Object.entries({
    viewport: environment.viewport,
    drawingBuffer: environment.drawingBuffer,
  })) {
    assert.ok(
      Number.isInteger(dimensions?.width) && dimensions.width > 0,
      `${name} width is invalid`,
    );
    assert.ok(
      Number.isInteger(dimensions?.height) && dimensions.height > 0,
      `${name} height is invalid`,
    );
  }
  assert.ok(
    Number.isFinite(environment.viewport.dpr) && environment.viewport.dpr > 0,
  );
  const routes = {};
  for (const scenario of scenarios) {
    const sample = captures.find((entry) => entry.scenario === scenario);
    assert.ok(sample?.cameraPath?.id, `observed ${scenario} route is required`);
    routes[scenario] = structuredClone(sample.cameraPath);
  }
  for (const sample of captures)
    assert.deepEqual(sample.cameraPath, routes[sample.scenario]);

  return {
    schema: 'gev-performance-comparison-contract/v1',
    workloadId: fixture.workloadId,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      fixedTime: fixture.fixedTime,
      assets: fixture.assets.map(
        ({ id, sha256, byteLength, sourceFeatureCount }) => ({
          id,
          sha256,
          byteLength,
          sourceFeatureCount,
        }),
      ),
    },
    fixtureDelivery: {
      schema: fixtureDelivery.schema,
      status: fixtureDelivery.status,
      method: fixtureDelivery.method,
      fixtureId: fixtureDelivery.fixtureId,
      fixtureSha256: fixtureDelivery.fixtureSha256,
      fixedTime: fixtureDelivery.fixedTime,
      assets: structuredClone(fixtureDelivery.assets),
      populationsBefore: structuredClone(fixtureDelivery.populationsBefore),
      populationsAfter: structuredClone(fixtureDelivery.populationsAfter),
    },
    routes,
    browser: { name: browserMatch[1], version: browserMatch[2] },
    rendering: {
      viewport: structuredClone(environment.viewport),
      drawingBuffer: structuredClone(environment.drawingBuffer),
    },
    populations: expectedPopulations,
    visual: structuredClone(settings),
    // Static infrastructure supports workload comparisons, but does not inherit
    // the dense-flight 20% objective contract for moving/tracking scenarios.
    objectiveScenarios: [],
  };
}

/** Build the Austin operating contract from per-document native observations. */
export function createObservedAustinOperatingComparisonContract({
  fixture,
  fixtureDelivery,
  environment,
  captures,
  scenarios,
  workload,
} = {}) {
  assert.equal(fixture?.schema, 'gev-austin-operating-fixture/v1');
  assert.equal(fixture?.workloadId, 'austin-operating-v1');
  assert.equal(fixture?.fixedTime, AUSTIN_OPERATING_FIXED_TIME);
  assert.equal(fixture?.windSourceTime, AUSTIN_OPERATING_WIND_VALID_TIME);
  assert.match(fixture?.sha256 || '', SHA256);
  assert.deepEqual(fixture?.expectedLayerCounts, AUSTIN_OPERATING_LAYER_COUNTS);
  assert.equal(
    fixtureDelivery?.schema,
    'gev-austin-operating-capture-delivery/v1',
  );
  assert.equal(fixtureDelivery?.status, 'observed');
  assert.equal(fixtureDelivery?.fixtureId, fixture.id);
  assert.equal(fixtureDelivery?.fixtureSha256, fixture.sha256);
  assert.equal(fixtureDelivery?.fixedTime, fixture.fixedTime);
  assert.equal(fixtureDelivery?.windSourceTime, fixture.windSourceTime);
  assert.equal(fixtureDelivery?.windSourceAgeMs, fixture.windSourceAgeMs);
  assert.ok(environment && typeof environment.userAgent === 'string');
  const browserMatch = environment.userAgent.match(
    /(HeadlessChrome|Chrome|Chromium)\/([\d.]+)/,
  );
  assert.ok(browserMatch, 'browser identity was not observed');
  assert.deepEqual(scenarios, ['idle', 'scripted-motion']);
  assert.ok(
    Number.isInteger(workload?.runsPerScenario) && workload.runsPerScenario > 0,
  );
  assert.ok(Number.isInteger(workload?.warmupMs) && workload.warmupMs >= 0);
  assert.ok(
    Number.isInteger(workload?.durationPerSampleMs) &&
      workload.durationPerSampleMs > 0,
  );
  assert.equal(captures?.length, scenarios.length * workload.runsPerScenario);

  const requiredIds = [
    ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
    'installations',
  ].sort();
  const requiredTileKeys = AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map((tile) =>
    tile.join('/'),
  ).sort();
  const sourceHashes = new Map();
  let referenceSettings = null;
  const routes = {};
  for (const [index, sample] of captures.entries()) {
    const expectedScenario =
      scenarios[Math.floor(index / workload.runsPerScenario)];
    const expectedRun = (index % workload.runsPerScenario) + 1;
    assert.equal(
      sample.scenario,
      expectedScenario,
      `capture ${index + 1} is out of scenario order`,
    );
    assert.equal(
      sample.run,
      expectedRun,
      `capture ${index + 1} is out of run order`,
    );
    assert.equal(sample.documentRole, `provider-sample-${index + 1}`);
    assert.ok(
      typeof sample.documentId === 'string' && sample.documentId.length > 0,
    );
    const clock = sample.austinOperatingClock;
    assert.equal(clock?.schema, 'gev-austin-operating-capture-clock/v1');
    assert.equal(clock.fixedHarnessTime, fixture.fixedTime);
    assert.equal(
      clock.runOrdinal,
      1,
      'every sample uses a fresh single-run document',
    );
    assert.equal(clock.configuredWarmupMs, workload.warmupMs);
    assert.equal(clock.configuredMeasurementMs, workload.durationPerSampleMs);
    assert.equal(clock.start?.epochMs, fixture.fixedTimeMs);
    assert.equal(
      clock.measurementStart?.epochMs,
      fixture.fixedTimeMs + workload.warmupMs,
    );
    assert.equal(
      clock.wallClockBeforeMs,
      fixture.fixedTimeMs + workload.warmupMs,
    );
    assert.equal(
      clock.wallClockAfterMs,
      fixture.fixedTimeMs + workload.warmupMs + workload.durationPerSampleMs,
    );
    assert.equal(clock.windSourceTime, fixture.windSourceTime);
    assert.equal(
      clock.windSourceValidAtBeforeMs,
      Date.parse(fixture.windSourceTime),
    );
    assert.equal(
      clock.windSourceValidAtAfterMs,
      Date.parse(fixture.windSourceTime),
    );
    assert.equal(
      clock.windSourceAgeBeforeMs,
      clock.wallClockBeforeMs - Date.parse(fixture.windSourceTime),
    );
    assert.equal(
      clock.windSourceAgeAfterMs,
      clock.wallClockAfterMs - Date.parse(fixture.windSourceTime),
    );
    assert.equal(clock.measurementEnd?.phase, 'complete');
    assert.equal(clock.measurementEnd?.runOrdinal, 1);
    assert.equal(
      clock.measurementEnd?.elapsedMs,
      workload.warmupMs + workload.durationPerSampleMs,
    );
    const sampledEpochs = clock.satelliteSampledEpochs;
    assert.equal(
      sampledEpochs?.warmupHeld?.schema,
      'gev-austin-satellite-sampled-epoch/v1',
    );
    assert.equal(sampledEpochs?.warmupHeld?.boundary, 'warmup-held');
    assert.equal(
      sampledEpochs?.warmupHeld?.boundaryEpochMs,
      fixture.fixedTimeMs + workload.warmupMs,
    );
    assert.equal(
      sampledEpochs?.measurementComplete?.schema,
      'gev-austin-satellite-sampled-epoch/v1',
    );
    assert.equal(
      sampledEpochs?.measurementComplete?.boundary,
      'measurement-complete',
    );
    assert.equal(
      sampledEpochs?.measurementComplete?.boundaryEpochMs,
      fixture.fixedTimeMs + workload.warmupMs + workload.durationPerSampleMs,
    );
    for (const boundary of [
      sampledEpochs.warmupHeld,
      sampledEpochs.measurementComplete,
    ]) {
      assert.equal(
        boundary.recordCount,
        AUSTIN_OPERATING_LAYER_COUNTS.satellites,
      );
      assert.ok(
        Array.isArray(boundary.records) &&
          boundary.records.length === AUSTIN_OPERATING_LAYER_COUNTS.satellites,
        'cached satellite source rows are required at both boundaries',
      );
      assert.match(boundary.identitySha256 || '', SHA256);
      assert.match(boundary.positionSha256 || '', SHA256);
      assert.equal(boundary.epochKind, 'derived-from-cached-public-positions');
      assert.equal(
        boundary.numericalBoundStatus,
        'provisional-not-cross-engine-validated',
      );
      assert.equal(boundary.performanceAcceptanceEligible, false);
      assert.ok(Number.isSafeInteger(boundary.derivedEpochMs));
      assert.ok(
        Number.isSafeInteger(boundary.ageMs) &&
          boundary.ageMs >= 0 &&
          boundary.ageMs <= 1000,
      );
    }
    const satelliteBefore = clock.selectedLayersBefore?.find(
      (row) => row.id === 'satellites',
    )?.sourcePopulation;
    const satelliteAfter = clock.selectedLayersAfter?.find(
      (row) => row.id === 'satellites',
    )?.sourcePopulation;
    assert.equal(
      sampledEpochs.warmupHeld.identitySha256,
      satelliteBefore?.sha256,
      'warmup satellite records differ from the captured native identity digest',
    );
    assert.equal(
      sampledEpochs.warmupHeld.positionSha256,
      satelliteBefore?.positionSha256,
      'warmup satellite records differ from the captured native position digest',
    );
    assert.equal(
      sampledEpochs.measurementComplete.identitySha256,
      satelliteAfter?.sha256,
      'completed satellite records differ from the captured native identity digest',
    );
    assert.equal(
      sampledEpochs.measurementComplete.positionSha256,
      satelliteAfter?.positionSha256,
      'completed satellite records differ from the captured native position digest',
    );
    const witnessFor = (boundary) =>
      boundary.records.find((row) => row.id === 25544);
    for (const [evidence, witness] of [
      [sampledEpochs.warmupHeld, clock.satelliteWitnessBefore],
      [sampledEpochs.measurementComplete, clock.satelliteWitnessAfter],
    ]) {
      assert.deepEqual(
        witness,
        {
          noradId: witnessFor(evidence)?.id,
          latitude: witnessFor(evidence)?.latitude,
          longitude: witnessFor(evidence)?.longitude,
          altitudeM: witnessFor(evidence)?.altitudeM,
        },
        'ISS witness must come from the same cached-position boundary',
      );
    }
    assert.ok(
      Number.isFinite(clock.measurementBoundarySettleNativeMs) &&
        clock.measurementBoundarySettleNativeMs >= 0,
    );
    assert.ok(clock.satelliteWitnessBefore?.noradId === 25544);
    assert.ok(clock.satelliteWitnessAfter?.noradId === 25544);
    assert.ok(Number.isFinite(clock.satelliteWitnessBefore.latitude));
    assert.ok(Number.isFinite(clock.satelliteWitnessAfter.latitude));
    assert.notDeepEqual(
      [
        clock.satelliteWitnessBefore.latitude,
        clock.satelliteWitnessBefore.longitude,
      ],
      [
        clock.satelliteWitnessAfter.latitude,
        clock.satelliteWitnessAfter.longitude,
      ],
      `capture ${index + 1} satellite did not move during its advancing clock phase`,
    );
    const expectedRoute =
      expectedScenario === 'idle' ? 'parked-v1' : 'elapsed-move-right-v1';
    assert.equal(sample.cameraPath?.id, expectedRoute);
    assert.ok(sample.cameraPath?.start?.position);
    assert.equal(
      sample.cameraPath?.elapsedDurationMs,
      workload.durationPerSampleMs,
    );
    routes[expectedScenario] ||= structuredClone(sample.cameraPath);
    assert.deepEqual(sample.cameraPath, routes[expectedScenario]);

    const sampleDelivery = sample.fixtureDelivery;
    assert.equal(sampleDelivery?.schema, 'gev-austin-operating-delivery/v1');
    assert.equal(sampleDelivery?.status, 'observed');
    assert.equal(sampleDelivery?.fixtureId, fixture.id);
    assert.equal(sampleDelivery?.fixtureSha256, fixture.sha256);
    assert.equal(sampleDelivery?.fixedTime, fixture.fixedTime);
    assert.deepEqual([...sampleDelivery.requiredAssetIds].sort(), requiredIds);
    assert.deepEqual(
      [...sampleDelivery.alprTileCoverage.requiredForDocument].sort(),
      requiredTileKeys,
    );
    assert.deepEqual([...sampleDelivery.alprTileCoverage.missingRequired], []);
    const observedTileKeys = sampleDelivery.alprTileCoverage.requested.map(
      (tile) => `${tile.z}/${tile.x}/${tile.y}`,
    );
    assert.deepEqual(
      [...observedTileKeys].sort(),
      requiredTileKeys,
      `capture ${index + 1} did not observe every required native route tile`,
    );
    assert.equal(new Set(observedTileKeys).size, observedTileKeys.length);
    assert.equal(
      sampleDelivery.alprTileCoverage.fullRouteCoverageComplete,
      true,
    );
    for (const id of AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS) {
      const asset = fixture.assets.find((row) => row.id === id);
      const delivered = sampleDelivery.deliveredAssets?.find(
        (row) => row.id === id,
      );
      assert.ok(
        asset && delivered,
        `capture ${index + 1} is missing response ${id}`,
      );
      assert.equal(
        delivered.sha256,
        asset.sha256,
        `capture ${index + 1} delivered response hash differs for ${id}`,
      );
      assert.ok(
        Number.isSafeInteger(delivered.responseCount) &&
          delivered.responseCount > 0,
      );
    }
    assert.equal(
      sampleDelivery.installations.sourceCatalog.sha256,
      fixture.assets.find((row) => row.id === 'installations').sha256,
    );
    assert.equal(
      sampleDelivery.installations.sourceCatalog.sourceCount,
      AUSTIN_OPERATING_LAYER_COUNTS['military-installations'],
    );
    assert.ok(sampleDelivery.installations.responseVariants.length >= 1);
    assert.ok(sampleDelivery.installations.responseVariants.length <= 32);
    const deliveredInstallationIds = new Set();
    for (const variant of sampleDelivery.installations.responseVariants) {
      assert.match(variant.sha256 || '', SHA256);
      assert.ok(
        Number.isSafeInteger(variant.byteLength) && variant.byteLength > 0,
      );
      assert.ok(
        Number.isSafeInteger(variant.responseCount) &&
          variant.responseCount > 0,
      );
      assert.ok(
        Number.isSafeInteger(variant.elementCount) && variant.elementCount >= 0,
      );
      assert.ok(Array.isArray(variant.elementIds));
      assert.equal(variant.elementIds.length, variant.elementCount);
      assert.equal(new Set(variant.elementIds).size, variant.elementIds.length);
      for (const id of variant.elementIds) deliveredInstallationIds.add(id);
    }
    for (const tile of sampleDelivery.alprTileCoverage.requested) {
      const id = `alpr-${tile.z}-${tile.x}-${tile.y}`;
      const asset = fixture.assets.find((row) => row.id === id);
      assert.ok(
        asset,
        `capture ${index + 1} requested undeclared ALPR tile ${id}`,
      );
      assert.equal(tile.sha256, asset.sha256);
      assert.ok(
        Number.isSafeInteger(tile.responseCount) && tile.responseCount > 0,
      );
    }

    const layerSnapshots = [
      clock.selectedLayersBefore,
      clock.selectedLayersAfter,
    ];
    for (const [boundaryIndex, layers] of layerSnapshots.entries()) {
      assert.deepEqual(
        layers?.map((row) => row.id),
        Object.keys(AUSTIN_OPERATING_LAYER_COUNTS),
      );
      for (const layer of layers) {
        assert.equal(layer.enabled, true);
        assert.equal(
          layer.expectedSourceCatalogCount,
          AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
        );
        assert.ok(Number.isSafeInteger(layer.count) && layer.count >= 0);
        if (
          ['alpr-cameras', 'military-installations', 'radio'].includes(layer.id)
        )
          assert.ok(
            Number.isSafeInteger(layer.viewportCount) &&
              layer.viewportCount >= 0,
          );
        else assert.equal(layer.viewportCount, null);
        assert.equal(layer.loading, layer.id === 'satellites' ? null : false);
        assert.equal(layer.error, null);
        if (layer.id === 'military-installations') {
          const observedIds = layer.sourcePopulation?.identityIds;
          assert.ok(Number.isSafeInteger(layer.sourcePopulation?.count));
          assert.ok(layer.sourcePopulation.count >= 1);
          assert.ok(
            layer.sourcePopulation.count <=
              AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
          );
          assert.ok(Array.isArray(observedIds));
          assert.equal(observedIds.length, layer.sourcePopulation.count);
          assert.equal(new Set(observedIds).size, observedIds.length);
          assert.equal(
            layer.sourcePopulation.sha256,
            hashCanonicalIds(observedIds),
          );
        } else {
          assert.equal(
            layer.sourcePopulation?.count,
            AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
          );
          if (layer.id === 'wind')
            assert.equal(layer.sourcePopulation?.sha256, null);
          else {
            assert.match(layer.sourcePopulation?.sha256 || '', SHA256);
            assert.equal(
              layer.sourcePopulation.sha256,
              fixture.sourcePopulationHashes?.[layer.id],
              `capture ${index + 1} ${layer.id} identities differ from the pinned source catalog`,
            );
          }
        }
        assert.equal(layer.sourcePopulation?.truncated, false);
        if (layer.id !== 'military-installations') {
          const previousHash = sourceHashes.get(layer.id);
          if (previousHash)
            assert.equal(layer.sourcePopulation.sha256, previousHash);
          else sourceHashes.set(layer.id, layer.sourcePopulation.sha256);
        }
        if (layer.id === 'satellites' && boundaryIndex === 1)
          assert.match(layer.sourcePopulation.positionSha256 || '', SHA256);
        if (layer.id === 'military-installations') {
          assert.ok(layer.sourcePopulation.count >= 1);
          assert.ok(
            layer.sourcePopulation.count <=
              AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
          );
          assert.ok(Array.isArray(layer.sourcePopulation.identityIds));
          assert.equal(
            layer.sourcePopulation.identityIds.length,
            layer.sourcePopulation.count,
          );
          assert.ok(
            layer.sourcePopulation.identityIds.every((id) =>
              deliveredInstallationIds.has(id),
            ),
            `capture ${index + 1} installation identity is not acknowledged by its delivered response variants`,
          );
        }
      }
    }
    const visualBefore = clock.visualSettingsBefore;
    const visualAfter = clock.visualSettingsAfter;
    for (const observedSettings of [visualBefore, visualAfter]) {
      assert.equal(
        observedSettings?.qualityMode,
        AUSTIN_OPERATING_VISUAL_STATE.qualityMode,
      );
      assert.equal(
        observedSettings?.densityPct,
        AUSTIN_OPERATING_VISUAL_STATE.densityPct,
      );
      assert.equal(
        observedSettings?.detectionMode,
        AUSTIN_OPERATING_VISUAL_STATE.detectionMode,
      );
      assert.equal(observedSettings?.resolutionScale, 1);
      assert.equal(observedSettings?.fxaa, true);
    }
    assert.deepEqual(visualBefore, visualAfter);
    assert.deepEqual(sample.settings?.before, sample.settings?.after);
    assert.equal(
      sample.settings?.before?.qualityMode,
      AUSTIN_OPERATING_VISUAL_STATE.qualityMode,
    );
    assert.equal(
      sample.settings?.before?.densityPct,
      AUSTIN_OPERATING_VISUAL_STATE.densityPct,
    );
    assert.equal(
      sample.settings?.before?.detectionMode,
      AUSTIN_OPERATING_VISUAL_STATE.detectionMode,
    );
    assert.deepEqual(
      sample.conditions?.before?.settings,
      sample.settings?.before,
    );
    assert.deepEqual(
      sample.conditions?.after?.settings,
      sample.settings?.after,
    );
    if (referenceSettings)
      assert.deepEqual(sample.settings.before, referenceSettings);
    else referenceSettings = structuredClone(sample.settings.before);
  }
  assert.deepEqual(
    fixtureDelivery.sampleDocuments.map((row) => [
      row.scenario,
      row.run,
      row.documentRole,
      row.documentId,
    ]),
    captures.map((row) => [
      row.scenario,
      row.run,
      row.documentRole,
      row.documentId,
    ]),
  );
  assert.deepEqual(
    fixtureDelivery.sampleDocuments.map((row) => row.populations),
    captures.map((sample) => summarizeAustinNativePopulations(sample)),
    'fixture delivery must retain the exact native before/after populations for every sample',
  );
  assert.deepEqual(
    fixtureDelivery.sampleDocuments.map((row) => row.delivery),
    captures.map((sample) => sample.fixtureDelivery),
    'fixture delivery must retain the exact raw per-document response acknowledgments',
  );
  assert.equal(
    fixtureDelivery.requiredAssetIds.includes('cctv-raw-catalog'),
    false,
  );
  assert.equal(
    fixtureDelivery.sourceProvenance.radio.includes('synthetic'),
    true,
  );
  assert.equal(
    fixtureDelivery.sourceProvenance.installations.includes('synthetic'),
    true,
  );
  assert.ok(
    Number.isInteger(environment.viewport?.width) &&
      environment.viewport.width > 0,
  );
  assert.ok(
    Number.isInteger(environment.viewport?.height) &&
      environment.viewport.height > 0,
  );
  assert.ok(
    Number.isInteger(environment.drawingBuffer?.width) &&
      environment.drawingBuffer.width > 0,
  );
  assert.ok(
    Number.isInteger(environment.drawingBuffer?.height) &&
      environment.drawingBuffer.height > 0,
  );

  return {
    schema: 'gev-performance-comparison-contract/v1',
    workloadId: fixture.workloadId,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      fixedTime: fixture.fixedTime,
      windSourceTime: fixture.windSourceTime,
      windSourceAgeMs: fixture.windSourceAgeMs,
      sourceProvenance: structuredClone(fixture.provenance),
      expectedLayerCounts: structuredClone(fixture.expectedLayerCounts),
      sourcePopulationHashes: structuredClone(fixture.sourcePopulationHashes),
      sourcePopulationIds: structuredClone(fixture.sourcePopulationIds),
      assets: fixture.assets.map(({ id, sha256, byteLength }) => ({
        id,
        sha256,
        byteLength,
      })),
    },
    fixtureDelivery: {
      schema: fixtureDelivery.schema,
      status: fixtureDelivery.status,
      fixtureId: fixtureDelivery.fixtureId,
      fixtureSha256: fixtureDelivery.fixtureSha256,
      fixedTime: fixtureDelivery.fixedTime,
      windSourceTime: fixtureDelivery.windSourceTime,
      sampleDocuments: fixtureDelivery.sampleDocuments.map(
        ({ scenario, run, documentRole, documentId, populations }) => ({
          scenario,
          run,
          documentRole,
          documentId,
          populations: structuredClone(populations),
        }),
      ),
    },
    routes,
    browser: { name: browserMatch[1], version: browserMatch[2] },
    rendering: {
      viewport: structuredClone(environment.viewport),
      drawingBuffer: structuredClone(environment.drawingBuffer),
    },
    populations: Object.entries(AUSTIN_OPERATING_LAYER_COUNTS).map(
      ([id, count]) => ({ id, enabled: true, count }),
    ),
    visual: structuredClone(AUSTIN_OPERATING_VISUAL_STATE),
    // Austin reports both timelines but has no blanket improvement objective:
    // idle cadence is expected to remain stable, not improve by 20%.
    objectiveScenarios: [],
    workload: structuredClone(workload),
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
  receiptOnlyWorkerAuditEvidence = null,
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
  const infrastructureFixture =
    fixture?.schema === 'gev-infrastructure-fixture-manifest/v1';
  const weatherEffectsFixture =
    fixture?.schema === 'gev-weather-effects-fixture/v1';
  const austinOperatingFixture =
    fixture?.schema === 'gev-austin-operating-fixture/v1';
  const sharedDocumentFixture = infrastructureFixture || weatherEffectsFixture;
  if (fixture && diagnosticsDocuments.length > 0) {
    const expectedRoles = [
      ...Array.from(
        { length: workload?.startupRuns || 0 },
        (_, index) => `startup-${index + 1}`,
      ),
      'main-setup',
      ...(sharedDocumentFixture
        ? []
        : Array.from(
            { length: captures.length },
            (_, index) => `provider-sample-${index + 1}`,
          )),
    ].sort();
    const observedRoles = diagnosticsDocuments
      .map((row) => row.documentRole)
      .sort();
    if (JSON.stringify(observedRoles) !== JSON.stringify(expectedRoles))
      reasons.push('application-diagnostics-document-coverage-is-incomplete');
    if (sharedDocumentFixture) {
      const mainSetup = diagnosticsDocuments.find(
        (row) => row.documentRole === 'main-setup',
      );
      const measuredIds = captures.map((sample) => sample.documentId);
      if (
        !mainSetup?.documentId ||
        captures.length === 0 ||
        captures.some((sample) => sample.documentRole !== 'main-measured') ||
        measuredIds.some(
          (id) =>
            typeof id !== 'string' || id.length === 0 || id !== measuredIds[0],
        ) ||
        mainSetup.documentId !== measuredIds[0]
      )
        reasons.push(
          infrastructureFixture
            ? 'infrastructure-samples-do-not-share-measured-document'
            : 'weather-effects-samples-do-not-share-measured-document',
        );
    } else if (fixture) {
      const sampleDocumentsMatch = captures.every(
        (sample, index) =>
          sample.documentRole === `provider-sample-${index + 1}` &&
          typeof sample.documentId === 'string' &&
          sample.documentId.length > 0,
      );
      if (!sampleDocumentsMatch)
        reasons.push('provider-sample-document-identity-is-incomplete');
    }
  }
  if (workerBlobAuditMode === 'prewarm')
    reasons.push(
      'prewarm-worker-audit-does-not-observe-unused-late-blob-creations',
    );
  else if (workerBlobAuditMode === 'receipt-only') {
    const receiptOnlyValid = validateReceiptOnlyWorkerAuditEnvelope({
      pageAssetAudit: receiptOnlyWorkerAuditEvidence?.pageAssetAudit,
      appCommit: source?.buildProvenance?.appCommit,
      harnessCommit: source?.buildProvenance?.harnessCommit,
      receiptSha256: source?.buildProvenance?.receiptSha256,
      expectedDocuments: receiptOnlyWorkerAuditEvidence?.expectedDocuments,
      expectedAssetPaths: receiptOnlyWorkerAuditEvidence?.expectedAssetPaths,
      bundleSha256: receiptOnlyWorkerAuditEvidence?.bundleSha256,
      workerSourceSha256: receiptOnlyWorkerAuditEvidence?.workerSourceSha256,
      allowedModuleCount: receiptOnlyWorkerAuditEvidence?.allowedModuleCount,
    });
    if (!receiptOnlyValid)
      reasons.push('receipt-only-worker-audit-evidence-is-incomplete');
  } else if (workerBlobAuditInstrumented)
    reasons.push(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    );
  if (fixture && !sharedDocumentFixture && !austinOperatingFixture)
    reasons.push(
      'provider-fixture-is-static-count-only-not-trajectory-equivalent',
    );
  if (
    !captures.length ||
    captures.some((sample) => sample?.foregroundThroughout !== true)
  )
    reasons.push('foreground-continuity-is-incomplete');
  if (sharedDocumentFixture) {
    if (
      !workload?.scenarios?.includes('idle') ||
      !workload?.scenarios?.includes('scripted-motion')
    )
      reasons.push(
        infrastructureFixture
          ? 'required-infrastructure-objective-workloads-are-incomplete'
          : 'required-weather-effects-objective-workloads-are-incomplete',
      );
  } else if (austinOperatingFixture) {
    reasons.push(
      'austin-satellite-boundary-sampling-remains-frame-cadence-dependent',
    );
    if (
      !workload?.scenarios?.includes('idle') ||
      !workload?.scenarios?.includes('scripted-motion')
    )
      reasons.push(
        'required-austin-operating-objective-workloads-are-incomplete',
      );
  } else if (
    !workload?.scenarios?.includes('scripted-motion') ||
    !workload?.scenarios?.includes('selected-aircraft-tracking')
  )
    reasons.push('required-dense-objective-workloads-are-incomplete');
  if (!austinOperatingFixture)
    reasons.push(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    );
  return [...new Set(reasons)];
}

/** Capture CLI adapter keeps its workerAuditMode name at the report boundary. */
export function getCaptureReadinessReasons({
  workerAuditMode,
  ...options
} = {}) {
  return getCaptureComparisonIneligibilityReasons({
    ...options,
    workerBlobAuditMode: workerAuditMode,
  });
}
