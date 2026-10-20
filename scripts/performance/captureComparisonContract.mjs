import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DENSE_FLIGHT_FIXTURE_ID } from './productionFlightFixture.mjs';
import {
  assertInfrastructureClockObservation,
  assertInfrastructureFixtureIdentity,
} from './infrastructureWorkloadContract.mjs';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_WORKLOAD_ID,
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_RENDERING_STATE,
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_WIND_VALID_TIME,
} from './austinOperatingWorkloadContract.mjs';
import { summarizeAustinNativePopulations } from './austinOperatingPopulationEvidence.mjs';
import { validateReceiptOnlyWorkerAuditEnvelope } from './receiptOnlyWorkerAudit.mjs';
import { assertRouteDescriptorsEquivalent } from './routeEquivalence.mjs';
import { assertNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';
import {
  MAP_STREAMING_WORKLOAD_ID,
  MAP_STREAMING_CAPTURE_SCHEMA,
} from './mapStreamingWorkloadContract.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
export const SETTLED_IDLE_ONLY_INELIGIBLE_REASON =
  'settled-idle-only-evidence-is-not-full-paired-performance';
const STARTUP_ONLY_FIXTURES = Object.freeze({
  'infrastructure-datacenters': Object.freeze({
    matrixRowId: 'infrastructure-datacenters',
    workloadId: 'infrastructure-datacenters',
    fixtureId: 'bundled-datacenters-static-v1',
  }),
  'infrastructure-dams': Object.freeze({
    matrixRowId: 'infrastructure-dams',
    workloadId: 'infrastructure-dams',
    fixtureId: 'bundled-dams-static-v1',
  }),
  [AUSTIN_OPERATING_WORKLOAD_ID]: Object.freeze({
    matrixRowId: 'operating-view',
    workloadId: AUSTIN_OPERATING_WORKLOAD_ID,
    fixtureId: 'austin-operating-composed-v1',
  }),
  'dense-investigation': Object.freeze({
    matrixRowId: 'dense-investigation',
    workloadId: 'dense-investigation',
    fixtureId: DENSE_FLIGHT_FIXTURE_ID,
  }),
});

export function isSupportedStartupOnlyFixture(workloadId) {
  return Object.hasOwn(STARTUP_ONLY_FIXTURES, workloadId);
}

export function resolveStartupOnlyFixtureIdentity(
  workloadId,
  {
    infrastructureWorkload,
    austinOperatingWorkload,
    productionFlightFixture,
  } = {},
) {
  const expected = STARTUP_ONLY_FIXTURES[workloadId];
  assert.ok(expected, `Unsupported startup-only workload: ${workloadId}`);
  const fixture =
    workloadId === AUSTIN_OPERATING_WORKLOAD_ID
      ? austinOperatingWorkload
      : workloadId === 'dense-investigation'
        ? productionFlightFixture
        : infrastructureWorkload;
  assert.ok(fixture, `The ${workloadId} startup fixture was not prepared.`);
  if (workloadId !== 'dense-investigation')
    assert.equal(fixture.workloadId, expected.workloadId);
  assert.equal(fixture.id, expected.fixtureId);
  assert.match(fixture.sha256 || '', SHA256);
  return {
    ...(expected.matrixRowId !== expected.workloadId
      ? { matrixRowId: expected.matrixRowId }
      : {}),
    workloadId: fixture.workloadId ?? expected.workloadId,
    id: fixture.id,
    sha256: fixture.sha256,
  };
}
const LEGACY_WEATHER_EFFECTS_V2_FIXTURE_SHA256 =
  '5ba7e41ab29a1b9eeb6c773059f872bcd9f12879f358c4e7aaccb4a152bbac9a';
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
const MAP_STREAMING_SCENARIO = 'map-streaming-route';
const MAP_STREAMING_TIMED_METRIC = 'transition-readiness-p95-ms';

/** Read the page-reported wait duration from a settled render boundary. */
export function readSettledRenderBoundaryElapsedMs(boundary, label) {
  assert.equal(
    boundary?.status,
    'settled',
    `${label} completed-render boundary did not settle`,
  );
  assert.ok(
    Number.isFinite(boundary.settleElapsedMs) && boundary.settleElapsedMs >= 0,
    `${label} completed-render boundary elapsed time is invalid`,
  );
  return boundary.settleElapsedMs;
}

export function createCaptureDocumentTopology({
  infrastructure = false,
  reuseMainDocumentForSamples = false,
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
  const samples =
    infrastructure || reuseMainDocumentForSamples
      ? Array.from({ length: captureCount }, () => ({ ...main }))
      : Array.from({ length: captureCount }, (_, index) => ({
          documentRole: `provider-sample-${index + 1}`,
          documentId: `provider-document-${index + 1}`,
        }));
  const freshSampleDocuments = !infrastructure && !reuseMainDocumentForSamples;
  return {
    diagnostics: [
      ...startup,
      { documentRole: 'main-setup', documentId: mainDocumentId },
      ...(freshSampleDocuments ? samples : []),
    ],
    workerAudits: [...startup, main, ...(freshSampleDocuments ? samples : [])],
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
    if (
      environment.nativeSharpnessProfile ||
      sample.settings?.before?.nativeSharpnessProfile
    ) {
      assert.ok(
        sample.settings?.before?.nativeSharpnessProfile,
        `capture ${index + 1} is missing its before sharpness profile`,
      );
      assert.ok(
        sample.settings?.after?.nativeSharpnessProfile,
        `capture ${index + 1} is missing its after sharpness profile`,
      );
      assertNativeSharpnessProfile(
        {
          environment: {
            nativeSharpnessProfile:
              environment.nativeSharpnessProfile ??
              sample.settings.before.nativeSharpnessProfile,
          },
        },
        `capture ${index + 1} environment`,
      );
      assert.deepEqual(
        sample.settings?.before?.nativeSharpnessProfile,
        sample.settings?.after?.nativeSharpnessProfile,
        `capture ${index + 1} sharpness profile changed during measurement`,
      );
      assert.deepEqual(
        sample.settings.before.nativeSharpnessProfile,
        environment.nativeSharpnessProfile,
        `capture ${index + 1} sharpness profile differs from report environment`,
      );
    }
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
  workload,
  settledIdleOnly = false,
} = {}) {
  assertInfrastructureFixtureIdentity(fixture, 'infrastructure fixture');
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
  assert.equal(typeof settledIdleOnly, 'boolean');
  if (settledIdleOnly) {
    assert.equal(fixture.workloadId, 'infrastructure-cables');
    assert.equal(workload?.warmupMs, 30_000);
    assert.equal(workload?.durationPerSampleMs, 60_000);
    assert.equal(workload?.runsPerScenario, 5);
  }
  assert.deepEqual(
    scenarios,
    settledIdleOnly ? ['idle'] : ['idle', 'scripted-motion'],
  );
  assert.ok(
    Number.isSafeInteger(workload?.durationPerSampleMs) &&
      workload.durationPerSampleMs > 0,
    'infrastructure sample duration must be declared',
  );
  assert.ok(
    Number.isSafeInteger(workload?.runsPerScenario) &&
      workload.runsPerScenario > 0,
    'infrastructure run count must be declared',
  );
  assert.equal(
    captures.length,
    scenarios.length * workload.runsPerScenario,
    'infrastructure captures must exactly cover declared runs',
  );
  for (const scenario of scenarios) {
    const rows = captures.filter((sample) => sample.scenario === scenario);
    assert.equal(rows.length, workload.runsPerScenario);
    assert.deepEqual(
      rows.map((sample) => sample.run).sort((a, b) => a - b),
      Array.from({ length: workload.runsPerScenario }, (_, index) => index + 1),
    );
  }

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
    const scenarioRoute =
      sample.scenario === 'idle'
        ? {
            id: 'parked-v1',
            elapsedDurationMs: workload.durationPerSampleMs,
            motionDistanceM: 0,
          }
        : sample.scenario === 'scripted-motion'
          ? {
              id: 'elapsed-move-right-v1',
              elapsedDurationMs: workload.durationPerSampleMs,
              motionDistanceM: sample.cameraPath?.motionDistanceM,
            }
          : null;
    assert.ok(scenarioRoute, `capture ${index + 1} scenario is unsupported`);
    if (sample.scenario === 'scripted-motion')
      assert.ok(
        Number.isFinite(scenarioRoute.motionDistanceM) &&
          scenarioRoute.motionDistanceM > 0,
        `capture ${index + 1} scripted-motion distance must be observed`,
      );
    const radius = 6_378_137 + fixture.camera.altitudeM;
    assertRouteDescriptorsEquivalent(
      sample.cameraPath,
      {
        ...scenarioRoute,
        start: {
          position: { x: radius, y: 0, z: 0 },
          direction: { x: -1, y: 0, z: 0 },
          up: { x: 0, y: 0, z: 1 },
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      },
      `capture ${index + 1} infrastructure route differs from the pinned camera/scenario`,
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
    ...(settledIdleOnly ? { qualificationMode: 'settled-idle-only' } : {}),
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

/** Build the weather/effects comparison contract from timed UI phase observations. */
export function createObservedWeatherEffectsComparisonContract({
  fixture,
  fixtureDelivery,
  environment,
  captures,
  scenarios,
  workload,
  balancedQualificationShard = false,
} = {}) {
  assert.equal(fixture?.schema, 'gev-weather-effects-fixture/v2');
  assert.equal(fixture?.id, 'weather-effects-austin-phased-v2');
  assert.equal(fixture?.workloadId, 'austin-weather-effects-phased-v2');
  assert.equal(fixture?.fixedTime, '2026-10-08T12:00:00.000Z');
  if (fixture?.mediaPreferences !== undefined)
    assert.deepEqual(fixture.mediaPreferences, {
      'prefers-reduced-motion': 'no-preference',
    });
  if (fixture?.mediaPreferences === undefined) {
    assert.equal(fixture?.sha256, LEGACY_WEATHER_EFFECTS_V2_FIXTURE_SHA256);
    assert.equal(
      fixture?.manifestSha256,
      LEGACY_WEATHER_EFFECTS_V2_FIXTURE_SHA256,
    );
  } else {
    assert.equal(fixture?.manifestSha256, fixture?.sha256);
  }
  assert.match(fixture?.sha256 || '', SHA256);
  assert.deepEqual(fixture?.expectedLayerCounts, {
    'weather-radar': 1,
    'weather-satellite': 1,
    'weather-lightning': 1,
    wind: 65_160,
  });
  const phaseSchedule = fixture.phaseSchedule;
  assert.equal(phaseSchedule?.schema, 'gev-weather-phase-schedule/v1');
  assert.equal(phaseSchedule?.measurementMs, 60_000);
  assert.equal(phaseSchedule?.maximumLatenessMs, 5_000);
  assert.deepEqual(phaseSchedule?.offsetsMs, [0, 20_000, 40_000]);
  assert.equal(fixture.timeline?.length, 3);
  assert.deepEqual(
    phaseSchedule.phases,
    fixture.timeline.map((sourceTime, index) => ({
      id: ['early-history', 'middle-history', 'latest-history'][index],
      timelineIndex: index,
      sourceTime,
      offsetMs: phaseSchedule.offsetsMs[index],
    })),
  );
  assert.equal(
    fixtureDelivery?.schema,
    'gev-weather-effects-fixture-delivery/v2',
  );
  assert.equal(fixtureDelivery?.status, 'observed');
  assert.equal(fixtureDelivery?.workloadId, fixture.workloadId);
  assert.equal(
    fixtureDelivery?.method,
    'same-origin-hash-pinned-weather-phase-fixture-v2',
  );
  assert.equal(fixtureDelivery?.fixtureId, fixture.id);
  assert.equal(fixtureDelivery?.fixtureSha256, fixture.sha256);
  assert.equal(fixtureDelivery?.fixedTime, fixture.fixedTime);
  assert.deepEqual(fixtureDelivery.phaseSchedule, phaseSchedule);
  const expectedAssets = fixture.assets.map(({ id, sha256, byteLength }) => ({
    id,
    sha256,
    byteLength,
  }));
  assert.equal(fixtureDelivery.assets?.length, expectedAssets.length);
  for (const [index, expected] of expectedAssets.entries()) {
    const actual = fixtureDelivery.assets[index];
    assert.deepEqual(
      {
        id: actual?.id,
        sha256: actual?.sha256,
        byteLength: actual?.byteLength,
      },
      expected,
    );
    assert.ok(
      Number.isInteger(actual.responseCount) && actual.responseCount > 0,
    );
  }
  assert.equal(
    fixtureDelivery.fulfilledResponseCount,
    fixtureDelivery.assets.reduce((sum, asset) => sum + asset.responseCount, 0),
  );
  assert.deepEqual(fixtureDelivery.routeErrors, []);
  assert.ok(
    Number.isInteger(fixtureDelivery.fulfilledResponseCount) &&
      fixtureDelivery.fulfilledResponseCount > 0,
  );
  assert.ok(environment && typeof environment.userAgent === 'string');
  const browserMatch = environment.userAgent.match(
    /(HeadlessChrome|Chrome|Chromium)\/([\d.]+)/,
  );
  assert.ok(browserMatch, 'browser identity was not observed');
  assert.deepEqual(scenarios, ['idle', 'scripted-motion']);
  assert.equal(workload?.warmupMs, 30_000);
  assert.equal(workload?.durationPerSampleMs, 60_000);
  assert.equal(workload?.runsPerScenario, balancedQualificationShard ? 1 : 5);
  assert.equal(captures?.length, scenarios.length * workload.runsPerScenario);

  const expectedPopulations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(
    enabledPopulations(environment.layers, 'weather environment'),
    expectedPopulations,
  );
  assert.deepEqual(fixtureDelivery.populationsBefore, expectedPopulations);
  assert.deepEqual(fixtureDelivery.populationsAfter, expectedPopulations);
  const weatherVisual = {
    satelliteProduct: 'clouds-regional',
    satelliteInfrared: 'filtered',
    radarOpacity: 'strong',
    lightningOpacity: 'strong',
    windModel: 'gfs',
    windOverlay: 'speed',
    windPaused: false,
  };
  const routeByScenario = {};
  const visualSettings = captures[0]?.settings?.before;
  for (const field of [
    'qualityMode',
    'densityPct',
    'detectionMode',
    'resolutionScale',
    'msaaSamples',
    'antialias',
    'fxaa',
  ])
    assert.notEqual(visualSettings?.[field], undefined);
  assert.equal(visualSettings.qualityMode, 'manual');
  assert.equal(visualSettings.densityPct, 75);
  assert.equal(visualSettings.detectionMode, 'DENSE');
  assert.deepEqual(
    captures[0]?.settings?.before?.visualState?.detection?.density,
    75,
  );

  let priorWeatherResponseCounts = null;
  for (const [index, sample] of captures.entries()) {
    const label = `weather capture ${index + 1}`;
    assert.ok(scenarios.includes(sample.scenario));
    assert.ok(
      Number.isInteger(sample.run) && sample.run >= 1 && sample.run <= 5,
    );
    assert.equal(sample.durationMs >= 60_000, true);
    assert.equal(sample.foregroundThroughout, true);
    assert.deepEqual(
      enabledPopulations(
        sample.conditions?.before?.environment?.layers,
        `${label} before`,
      ),
      expectedPopulations,
    );
    assert.deepEqual(
      enabledPopulations(
        sample.conditions?.after?.environment?.layers,
        `${label} after`,
      ),
      expectedPopulations,
    );
    assert.deepEqual(
      enabledPopulations(sample.layers, `${label} layers`),
      expectedPopulations,
    );
    assert.deepEqual(sample.settings?.before, sample.settings?.after);
    assert.deepEqual(sample.settings?.before, visualSettings);
    assert.deepEqual(
      sample.conditions?.before?.settings,
      sample.settings?.before,
    );
    assert.deepEqual(
      sample.conditions?.after?.settings,
      sample.settings?.after,
    );
    assert.deepEqual(
      sample.conditions?.before?.environment?.viewport,
      environment.viewport,
    );
    assert.deepEqual(
      sample.conditions?.after?.environment?.viewport,
      environment.viewport,
    );
    assert.deepEqual(
      sample.conditions?.before?.environment?.drawingBuffer,
      environment.drawingBuffer,
    );
    assert.deepEqual(
      sample.conditions?.after?.environment?.drawingBuffer,
      environment.drawingBuffer,
    );
    assert.equal(
      sample.weatherEffectsClock?.fixedHarnessTime,
      fixture.fixedTime,
    );
    assert.equal(
      sample.weatherEffectsClock?.wallClockBeforeMs,
      fixture.fixedTimeMs,
    );
    assert.equal(
      sample.weatherEffectsClock?.wallClockAfterMs,
      fixture.fixedTimeMs,
    );
    const weatherClockSchema = sample.weatherEffectsClock?.schema;
    if (
      weatherClockSchema !== undefined ||
      fixture.mediaPreferences !== undefined
    ) {
      assert.equal(weatherClockSchema, 'gev-weather-effects-clock/v2');
      const motionObservations = [
        sample.weatherEffectsClock?.motionPreferencePreflight,
        sample.weatherEffectsClock?.weatherStateBefore?.motionPreference,
        sample.weatherEffectsClock?.weatherStateAfter?.motionPreference,
      ];
      for (const observation of motionObservations) {
        assert.deepEqual(observation, {
          schema: 'gev-weather-motion-preference/v1',
          reducedMotion: false,
        });
      }
    }
    assertWeatherEffectsRuntimeState(
      sample.weatherEffectsClock?.weatherStateBefore,
      expectedPopulations,
      weatherVisual,
      fixture,
      `${label} before`,
      'latest',
    );
    assertWeatherEffectsRuntimeState(
      sample.weatherEffectsClock?.weatherStateAfter,
      expectedPopulations,
      weatherVisual,
      fixture,
      `${label} after`,
      'history',
    );
    assertWeatherPhaseObservation(
      sample.weatherEffectsClock?.phaseObservations,
      fixture,
      label,
    );
    assert.equal(sample.fixtureDelivery?.schema, fixtureDelivery.schema);
    assert.equal(sample.fixtureDelivery?.fixtureSha256, fixture.sha256);
    assert.equal(sample.fixtureDelivery?.method, fixtureDelivery.method);
    assert.equal(
      sample.fixtureDelivery?.assets?.length,
      fixtureDelivery.assets.length,
    );
    const sampleResponseCounts = [];
    for (const [assetIndex, asset] of fixtureDelivery.assets.entries()) {
      const sampleAsset = sample.fixtureDelivery.assets[assetIndex];
      assert.deepEqual(
        {
          id: sampleAsset?.id,
          sha256: sampleAsset?.sha256,
          byteLength: sampleAsset?.byteLength,
          contentType: sampleAsset?.contentType,
        },
        {
          id: asset.id,
          sha256: asset.sha256,
          byteLength: asset.byteLength,
          contentType: asset.contentType,
        },
      );
      assert.ok(
        Number.isSafeInteger(sampleAsset.responseCount) &&
          sampleAsset.responseCount > 0 &&
          sampleAsset.responseCount <= asset.responseCount,
      );
      if (priorWeatherResponseCounts)
        assert.ok(
          sampleAsset.responseCount >= priorWeatherResponseCounts[assetIndex],
          `${label}: cumulative response count went backwards for ${asset.id}`,
        );
      sampleResponseCounts.push(sampleAsset.responseCount);
    }
    assert.equal(
      sample.fixtureDelivery.fulfilledResponseCount,
      sampleResponseCounts.reduce((sum, count) => sum + count, 0),
    );
    assert.ok(
      sample.fixtureDelivery.fulfilledResponseCount <=
        fixtureDelivery.fulfilledResponseCount,
    );
    priorWeatherResponseCounts = sampleResponseCounts;
    assert.deepEqual(
      sample.fixtureDelivery?.populationsBefore,
      expectedPopulations,
    );
    assert.deepEqual(
      sample.fixtureDelivery?.populationsAfter,
      expectedPopulations,
    );
    assert.ok(sample.cameraPath?.id);
    routeByScenario[sample.scenario] ||= structuredClone(sample.cameraPath);
    assert.deepEqual(sample.cameraPath, routeByScenario[sample.scenario]);
  }
  for (const scenario of scenarios)
    assert.equal(
      captures.filter((sample) => sample.scenario === scenario).length,
      workload.runsPerScenario,
    );
  return {
    schema: 'gev-performance-comparison-contract/v1',
    workloadId: 'weather-effects',
    fixture: {
      schema: fixture.schema,
      id: fixture.id,
      sha256: fixture.sha256,
      fixedTime: fixture.fixedTime,
      expectedLayerCounts: structuredClone(fixture.expectedLayerCounts),
      assets: expectedAssets,
      phaseSchedule: structuredClone(phaseSchedule),
      timeline: [...fixture.timeline],
    },
    fixtureDelivery: {
      schema: fixtureDelivery.schema,
      status: fixtureDelivery.status,
      workloadId: fixtureDelivery.workloadId,
      method: fixtureDelivery.method,
      fixtureId: fixtureDelivery.fixtureId,
      fixtureSha256: fixtureDelivery.fixtureSha256,
      fixedTime: fixtureDelivery.fixedTime,
      phaseSchedule: structuredClone(fixtureDelivery.phaseSchedule),
      assets: fixtureDelivery.assets.map(
        ({ id, sha256, byteLength, contentType }) => ({
          id,
          sha256,
          byteLength,
          contentType,
        }),
      ),
      populationsBefore: structuredClone(fixtureDelivery.populationsBefore),
      populationsAfter: structuredClone(fixtureDelivery.populationsAfter),
      routeErrors: [],
    },
    routes: routeByScenario,
    browser: { name: browserMatch[1], version: browserMatch[2] },
    rendering: {
      viewport: structuredClone(environment.viewport),
      drawingBuffer: structuredClone(environment.drawingBuffer),
    },
    populations: expectedPopulations,
    visual: {
      ...structuredClone(visualSettings),
      weatherEffects: weatherVisual,
    },
    objectiveScenarios: [],
    ...(balancedQualificationShard
      ? { qualificationMode: 'balanced-five-pair-shards' }
      : {}),
  };
}

function assertWeatherEffectsRuntimeState(
  state,
  expectedPopulations,
  visual,
  fixture,
  label,
  expectedMode,
) {
  assert.ok(
    state && typeof state === 'object',
    `${label}: runtime state is required`,
  );
  assert.ok(
    state.visualState && typeof state.visualState === 'object',
    `${label}: weather visual state is required`,
  );
  // The application stores the filtered satellite mode as numeric 100 in its
  // live layer parameters. The fixture's historical contract names that same
  // visual mode "filtered". Canonicalize only this documented representation
  // at the comparison boundary; retain the raw observation in the report.
  const observedVisualState = {
    ...state.visualState,
    satelliteInfrared:
      state.visualState.satelliteInfrared === 100
        ? 'filtered'
        : state.visualState.satelliteInfrared,
  };
  assert.deepEqual(
    observedVisualState,
    visual,
    `${label}: weather settings differ`,
  );
  assert.deepEqual(
    enabledPopulations(state.populations, `${label} populations`),
    expectedPopulations,
  );
  assert.deepEqual(state.sourceObservationTimes, [
    fixture.timeline.at(-1),
    fixture.timeline.at(-1),
    fixture.timeline.at(-1),
  ]);
  assert.equal(state.clock?.mode, expectedMode);
  assert.equal(state.clock?.playing, false);
  for (const row of state.populations) {
    assert.equal(row.loading, false, `${label}: ${row.id} is loading`);
    assert.equal(row.error, null, `${label}: ${row.id} has an error`);
  }
}

function assertWeatherPhaseObservation(observations, fixture, label) {
  assert.equal(observations?.schema, 'gev-weather-phase-observations/v1');
  assert.equal(observations.durationMs, 60_000);
  assert.equal(observations.fixtureSha256, fixture.sha256);
  assert.equal(
    observations.phases?.length,
    fixture.phaseSchedule.phases.length,
  );
  for (const [index, phase] of fixture.phaseSchedule.phases.entries()) {
    const actual = observations.phases[index];
    assert.equal(actual.id, phase.id, `${label}: weather phase order differs`);
    assert.equal(actual.fixtureSha256, fixture.sha256);
    assert.equal(actual.expectedSourceTime, phase.sourceTime);
    assert.equal(actual.scheduledAtMs, phase.offsetMs);
    assert.ok(Number.isFinite(actual.observedAtElapsedMs));
    assert.ok(actual.observedAtElapsedMs >= phase.offsetMs);
    assert.ok(
      actual.observedAtElapsedMs <=
        phase.offsetMs + fixture.phaseSchedule.maximumLatenessMs,
      `${label}: weather phase was late`,
    );
    assert.deepEqual(
      actual.sourceObservationTimes,
      Array(3).fill(phase.sourceTime),
    );
    assert.deepEqual(actual.clock, { mode: 'history', playing: false });
    if (index > 0)
      assert.ok(
        actual.observedAtElapsedMs >
          observations.phases[index - 1].observedAtElapsedMs,
      );
  }
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
    const sampleLabel = `${sample.scenario} run ${sample.run}: Austin`;
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
    const sampledEpochSchema = sampledEpochs?.warmupHeld?.schema;
    assert.ok(
      [
        'gev-austin-satellite-sampled-epoch/v1',
        'gev-austin-satellite-sampled-epoch/v2',
      ].includes(sampledEpochSchema),
      'Austin satellite sampled-epoch schema is unsupported',
    );
    assert.equal(sampledEpochs?.warmupHeld?.boundary, 'warmup-held');
    assert.equal(
      sampledEpochs?.warmupHeld?.boundaryEpochMs,
      fixture.fixedTimeMs + workload.warmupMs,
    );
    assert.equal(
      sampledEpochs?.measurementComplete?.schema,
      sampledEpochSchema,
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
      const legacySampledEpoch =
        sampledEpochSchema === 'gev-austin-satellite-sampled-epoch/v1';
      assert.equal(
        boundary.numericalBoundStatus,
        legacySampledEpoch
          ? 'provisional-not-cross-engine-validated'
          : 'exact-boundary-and-node-recomputed',
      );
      assert.equal(boundary.performanceAcceptanceEligible, !legacySampledEpoch);
      if (!legacySampledEpoch)
        assert.equal(
          boundary.derivedEpochMs,
          boundary.boundaryEpochMs,
          'Austin satellite positions must be sampled at the declared boundary',
        );
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
      `${sampleLabel} required ALPR route coverage is incomplete`,
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
      const boundaryName = boundaryIndex === 0 ? 'before' : 'after';
      const boundaryLabel = `${sampleLabel} ${boundaryName}`;
      assert.deepEqual(
        layers?.map((row) => row.id),
        Object.keys(AUSTIN_OPERATING_LAYER_COUNTS),
        `${boundaryLabel} required layer identities differ`,
      );
      for (const layer of layers) {
        const layerLabel = `${boundaryLabel} required layer ${layer.id}`;
        assert.equal(layer.enabled, true, `${layerLabel} must be enabled`);
        assert.equal(
          layer.expectedSourceCatalogCount,
          AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
          `${layerLabel} source catalog count differs`,
        );
        assert.ok(
          Number.isSafeInteger(layer.count) && layer.count >= 0,
          `${layerLabel} observed count is invalid`,
        );
        if (
          ['alpr-cameras', 'military-installations', 'radio'].includes(layer.id)
        )
          assert.ok(
            Number.isSafeInteger(layer.viewportCount) &&
              layer.viewportCount >= 0,
            `${layerLabel} viewport count is invalid`,
          );
        else
          assert.equal(
            layer.viewportCount,
            null,
            `${layerLabel} must not claim an unsupported viewport count`,
          );
        assert.equal(
          layer.loading,
          layer.id === 'satellites' ? null : false,
          `${layerLabel} loading state differs`,
        );
        assert.equal(layer.error, null, `${layerLabel} reports an error`);
        if (layer.id === 'military-installations') {
          const observedIds = layer.sourcePopulation?.identityIds;
          assert.ok(
            Number.isSafeInteger(layer.sourcePopulation?.count),
            `${layerLabel} installation population count is invalid`,
          );
          assert.ok(
            layer.sourcePopulation.count >= 1,
            `${layerLabel} installation source population is empty`,
          );
          assert.ok(
            layer.sourcePopulation.count <=
              AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
            `${layerLabel} installation population exceeds the pinned catalog`,
          );
          assert.ok(
            Array.isArray(observedIds),
            `${layerLabel} installation identity rows are missing`,
          );
          assert.equal(
            observedIds.length,
            layer.sourcePopulation.count,
            `${layerLabel} installation identity count differs`,
          );
          assert.equal(
            new Set(observedIds).size,
            observedIds.length,
            `${layerLabel} installation identities are duplicated`,
          );
          assert.equal(
            layer.sourcePopulation.sha256,
            hashCanonicalIds(observedIds),
            `${layerLabel} installation identity digest differs from its records`,
          );
        } else {
          assert.equal(
            layer.sourcePopulation?.count,
            AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
            `${layerLabel} source population count differs`,
          );
          if (layer.id === 'wind')
            assert.equal(
              layer.sourcePopulation?.sha256,
              null,
              `${layerLabel} must not claim an unavailable source digest`,
            );
          else {
            assert.match(
              layer.sourcePopulation?.sha256 || '',
              SHA256,
              `${layerLabel} source identity digest is invalid`,
            );
            assert.equal(
              layer.sourcePopulation.sha256,
              fixture.sourcePopulationHashes?.[layer.id],
              `${layerLabel} identities differ from the pinned source catalog`,
            );
          }
        }
        assert.equal(
          layer.sourcePopulation?.truncated,
          false,
          `${layerLabel} source population is truncated`,
        );
        if (layer.id !== 'military-installations') {
          const previousHash = sourceHashes.get(layer.id);
          if (previousHash)
            assert.equal(
              layer.sourcePopulation.sha256,
              previousHash,
              `${layerLabel} identity digest changed across capture boundaries`,
            );
          else sourceHashes.set(layer.id, layer.sourcePopulation.sha256);
        }
        if (layer.id === 'satellites' && boundaryIndex === 1)
          assert.match(
            layer.sourcePopulation.positionSha256 || '',
            SHA256,
            `${layerLabel} cached position digest is invalid`,
          );
        if (layer.id === 'military-installations') {
          assert.ok(
            layer.sourcePopulation.count >= 1,
            `${layerLabel} installation source population is empty`,
          );
          assert.ok(
            layer.sourcePopulation.count <=
              AUSTIN_OPERATING_LAYER_COUNTS[layer.id],
            `${layerLabel} installation source population exceeds the pinned catalog`,
          );
          assert.ok(
            Array.isArray(layer.sourcePopulation.identityIds),
            `${layerLabel} installation identity rows are missing`,
          );
          assert.equal(
            layer.sourcePopulation.identityIds.length,
            layer.sourcePopulation.count,
            `${layerLabel} installation identity count differs`,
          );
          assert.ok(
            layer.sourcePopulation.identityIds.every((id) =>
              deliveredInstallationIds.has(id),
            ),
            `${layerLabel} installation identity is not acknowledged by its delivered response variants`,
          );
        }
      }
    }
    const visualBefore = clock.visualSettingsBefore;
    const visualAfter = clock.visualSettingsAfter;
    for (const [boundaryName, observedSettings] of [
      ['before', visualBefore],
      ['after', visualAfter],
    ]) {
      const settingLabel = `${sampleLabel} ${boundaryName} visual property`;
      assert.equal(
        observedSettings?.qualityMode,
        AUSTIN_OPERATING_VISUAL_STATE.qualityMode,
        `${settingLabel} qualityMode differs`,
      );
      assert.equal(
        observedSettings?.densityPct,
        AUSTIN_OPERATING_VISUAL_STATE.densityPct,
        `${settingLabel} densityPct differs`,
      );
      assert.equal(
        observedSettings?.detectionMode,
        AUSTIN_OPERATING_VISUAL_STATE.detectionMode,
        `${settingLabel} detectionMode differs`,
      );
      for (const [property, expectedValue] of Object.entries(
        AUSTIN_OPERATING_RENDERING_STATE,
      ))
        assert.equal(
          observedSettings?.[property],
          expectedValue,
          `${settingLabel} ${property} differs (expected ${expectedValue}, observed ${observedSettings?.[property]})`,
        );
    }
    assert.deepEqual(
      sample.settings?.before,
      visualBefore,
      `${sampleLabel} capture settings before differ from the native before observation`,
    );
    assert.deepEqual(
      sample.settings?.after,
      visualAfter,
      `${sampleLabel} capture settings after differ from the native after observation`,
    );
    assert.deepEqual(
      visualBefore,
      visualAfter,
      `${sampleLabel} visual settings changed between boundaries`,
    );
    assert.deepEqual(
      sample.settings?.before,
      sample.settings?.after,
      `${sampleLabel} capture settings changed between boundaries`,
    );
    assert.equal(
      sample.settings?.before?.qualityMode,
      AUSTIN_OPERATING_VISUAL_STATE.qualityMode,
      `${sampleLabel} capture settings before qualityMode differs`,
    );
    assert.equal(
      sample.settings?.before?.densityPct,
      AUSTIN_OPERATING_VISUAL_STATE.densityPct,
      `${sampleLabel} capture settings before densityPct differs`,
    );
    assert.equal(
      sample.settings?.before?.detectionMode,
      AUSTIN_OPERATING_VISUAL_STATE.detectionMode,
      `${sampleLabel} capture settings before detectionMode differs`,
    );
    assert.deepEqual(
      sample.conditions?.before?.settings,
      sample.settings?.before,
      `${sampleLabel} before condition settings differ from capture settings`,
    );
    assert.deepEqual(
      sample.conditions?.after?.settings,
      sample.settings?.after,
      `${sampleLabel} after condition settings differ from capture settings`,
    );
    if (referenceSettings)
      assert.deepEqual(
        sample.settings.before,
        referenceSettings,
        `${sampleLabel} visual settings differ from the first capture`,
      );
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
    'Austin radio fixture provenance must be labeled synthetic',
  );
  assert.equal(
    fixtureDelivery.sourceProvenance.installations.includes('synthetic'),
    true,
    'Austin installation fixture provenance must be labeled synthetic',
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

function mapTransitionReadinessP95(journey, label) {
  assert.ok(
    Array.isArray(journey?.transitions) && journey.transitions.length >= 2,
    `${label}: map stack transitions are required`,
  );
  const values = journey.transitions.slice(1).map((transition, index) => {
    const actualStartMs = transition?.actualStartMs;
    const settledAtMs = transition?.settledAtMs;
    assert.ok(
      Number.isFinite(actualStartMs) && Number.isFinite(settledAtMs),
      `${label}: transition ${index + 1} timing is missing`,
    );
    const elapsedMs = settledAtMs - actualStartMs;
    assert.ok(
      Number.isFinite(elapsedMs) && elapsedMs >= 0,
      `${label}: transition ${index + 1} timing is invalid`,
    );
    return elapsedMs;
  });
  const sorted = [...values].sort((left, right) => left - right);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { values, p95 };
}

/** Build a five-run map-streaming contract from the native route evidence. */
export function createObservedMapStreamingComparisonContract({
  fixture,
  mapStreamingCapture,
  environment,
  workload,
} = {}) {
  assert.equal(fixture?.id, mapStreamingCapture?.fixtureId);
  assert.equal(fixture?.manifestSha256, mapStreamingCapture?.manifestSha256);
  assert.equal(mapStreamingCapture?.schema, MAP_STREAMING_CAPTURE_SCHEMA);
  assert.equal(mapStreamingCapture?.workloadId, MAP_STREAMING_WORKLOAD_ID);
  assert.equal(mapStreamingCapture?.status, 'observed');
  assert.equal(mapStreamingCapture?.performanceAcceptanceEligible, true);
  assert.equal(workload?.warmupMs, 30_000);
  assert.equal(workload?.durationPerSampleMs, 60_000);
  assert.equal(workload?.runsPerScenario, 5);
  const journeys = mapStreamingCapture.journeys;
  assert.ok(Array.isArray(journeys) && journeys.length === 5);
  assert.deepEqual(
    journeys.map((entry) => entry.run),
    [1, 2, 3, 4, 5],
    'Map timed journey run ids must be 1 through 5.',
  );
  // The native map capture adapter validates every journey against the full
  // fixture before this contract is built. The comparison contract itself is
  // intentionally Cesium-free so CLI rejection paths can run before Cesium
  // is imported.
  assert.ok(environment && typeof environment.userAgent === 'string');
  const browserMatch = environment.userAgent.match(
    /(HeadlessChrome|Chrome|Chromium)\/([\d.]+)/,
  );
  assert.ok(browserMatch, 'map browser identity was not observed');
  const first = journeys[0];
  const firstSettings = first.settingsBefore;
  assert.equal(first.route?.warmupMs, 30_000);
  assert.equal(firstSettings?.qualityMode, 'manual');
  assert.equal(firstSettings?.densityPct, 75);
  assert.equal(firstSettings?.detectionMode, 'DENSE');
  for (const [index, journey] of journeys.entries()) {
    assert.deepEqual(
      journey.settingsBefore,
      firstSettings,
      `map journey ${index + 1} visual settings differ`,
    );
    assert.deepEqual(
      journey.settingsAfter,
      firstSettings,
      `map journey ${index + 1} final settings differ`,
    );
    assert.equal(journey.route?.id, first.route?.id);
    assert.equal(journey.route?.durationMs, 60_000);
    assert.equal(
      journey.route?.startupFlightDelayMs,
      first.route.startupFlightDelayMs,
    );
    assert.equal(
      journey.route?.warmupMs,
      first.route.warmupMs,
      `map journey ${index + 1} warmup differs`,
    );
    assert.equal(
      journey.route?.moveRightMetersPerSecond,
      first.route.moveRightMetersPerSecond,
    );
    assert.deepEqual(journey.route?.declaredBounds, first.route.declaredBounds);
  }
  const timingRuns = journeys.map((journey) => {
    const timing = mapTransitionReadinessP95(
      journey,
      `map journey ${journey.run}`,
    );
    return {
      run: journey.run,
      transitionReadinessMs: timing.values,
      p95Ms: timing.p95,
    };
  });
  const delivery = mapStreamingCapture.fixtureDelivery;
  assert.equal(delivery?.status, 'observed');
  assert.equal(delivery?.fixtureId, fixture.id);
  assert.equal(delivery?.manifestSha256, fixture.manifestSha256);
  assert.equal(delivery?.cleanupConfirmed, true);
  const assets = (delivery.assets || []).map((asset) => ({
    path: asset.path,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
  }));
  assert.ok(assets.length > 0, 'map fixture delivery assets are required');
  return {
    schema: 'gev-performance-comparison-contract/v1',
    workloadId: MAP_STREAMING_WORKLOAD_ID,
    fixture: {
      id: fixture.id,
      manifestSha256: fixture.manifestSha256,
      routeId: first.route.id,
      routeBounds: structuredClone(first.route.declaredBounds),
      buildProfile: structuredClone(mapStreamingCapture.buildProfile),
    },
    fixtureDelivery: {
      schema: delivery.schema,
      status: delivery.status,
      fixtureId: delivery.fixtureId,
      manifestSha256: delivery.manifestSha256,
      cleanupConfirmed: delivery.cleanupConfirmed,
      assets,
    },
    routes: {
      [MAP_STREAMING_SCENARIO]: {
        id: first.route.id,
        durationMs: first.route.durationMs,
        startupFlightDelayMs: first.route.startupFlightDelayMs,
        warmupMs: first.route.warmupMs,
        moveRightMetersPerSecond: first.route.moveRightMetersPerSecond,
        headingRadians: first.route.headingRadians,
        pitchRadians: first.route.pitchRadians,
        declaredBounds: structuredClone(first.route.declaredBounds),
        stackSchedule: first.transitions.map((transition) => ({
          stackId: transition.stackId,
          scheduledAtMs: transition.scheduledAtMs,
        })),
      },
    },
    browser: { name: browserMatch[1], version: browserMatch[2] },
    rendering: {
      viewport: structuredClone(environment.viewport),
      drawingBuffer: structuredClone(environment.drawingBuffer),
    },
    populations: [],
    visual: structuredClone(firstSettings),
    objectiveScenarios: [],
    timing: {
      metric: MAP_STREAMING_TIMED_METRIC,
      runs: timingRuns,
    },
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
  if (workload?.settledIdleOnly === true)
    reasons.push(SETTLED_IDLE_ONLY_INELIGIBLE_REASON);
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
    fixture?.schema === 'gev-weather-effects-fixture/v2';
  const austinOperatingFixture =
    fixture?.schema === 'gev-austin-operating-fixture/v1';
  const denseFixture = contract?.workloadId === 'dense-investigation';
  const mapStreamingFixture = [
    'gev-map-streaming-fixture/v4',
    'gev-map-streaming-fixture/v5',
  ].includes(fixture?.manifest?.schema);
  if (mapStreamingFixture) {
    if (workload?.mapStreamingCapture?.performanceAcceptanceEligible !== true)
      reasons.push('map-streaming-five-run-contract-is-incomplete');
    if (
      !Array.isArray(workload?.mapStreamingCapture?.journeys) ||
      workload.mapStreamingCapture.journeys.length !== 5
    )
      reasons.push('map-streaming-journey-evidence-is-incomplete');
    return [...new Set(reasons)];
  }
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
      harnessCommit:
        source?.buildProvenance?.captureProducerCommit ??
        source?.buildProvenance?.harnessCommit,
      receiptSha256: source?.buildProvenance?.receiptSha256,
      expectedDocuments: receiptOnlyWorkerAuditEvidence?.expectedDocuments,
      expectedAssetPaths: receiptOnlyWorkerAuditEvidence?.expectedAssetPaths,
      bundlePath: receiptOnlyWorkerAuditEvidence?.bundlePath,
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
  const receiptOnlyAuditValidated =
    workerBlobAuditMode === 'receipt-only' &&
    !reasons.includes('receipt-only-worker-audit-evidence-is-incomplete');
  if (
    fixture &&
    !sharedDocumentFixture &&
    !austinOperatingFixture &&
    (!denseFixture || !receiptOnlyAuditValidated)
  )
    reasons.push(
      'provider-fixture-is-static-count-only-not-trajectory-equivalent',
    );
  if (
    !captures.length ||
    captures.some((sample) => sample?.foregroundThroughout !== true)
  )
    reasons.push('foreground-continuity-is-incomplete');
  if (sharedDocumentFixture) {
    const scopedIdle =
      infrastructureFixture &&
      fixture.workloadId === 'infrastructure-cables' &&
      workload?.settledIdleOnly === true &&
      contract?.qualificationMode === 'settled-idle-only' &&
      JSON.stringify(workload?.scenarios) === '["idle"]';
    if (
      !scopedIdle &&
      (!workload?.scenarios?.includes('idle') ||
        !workload?.scenarios?.includes('scripted-motion'))
    )
      reasons.push(
        infrastructureFixture
          ? 'required-infrastructure-objective-workloads-are-incomplete'
          : 'required-weather-effects-objective-workloads-are-incomplete',
      );
  } else if (austinOperatingFixture) {
    const deterministicSatelliteBoundaries =
      captures.length > 0 &&
      captures.every((sample) => {
        const sampled = sample?.austinOperatingClock?.satelliteSampledEpochs;
        return [sampled?.warmupHeld, sampled?.measurementComplete].every(
          (boundary) =>
            boundary?.performanceAcceptanceEligible === true &&
            boundary?.schema === 'gev-austin-satellite-sampled-epoch/v2' &&
            boundary?.numericalBoundStatus ===
              'exact-boundary-and-node-recomputed' &&
            boundary?.derivedEpochMs === boundary?.boundaryEpochMs,
        );
      });
    if (!deterministicSatelliteBoundaries)
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
  if (
    !austinOperatingFixture &&
    !weatherEffectsFixture &&
    (!receiptOnlyAuditValidated || (!denseFixture && !infrastructureFixture))
  )
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
