import assert from 'node:assert/strict';
import { DENSE_FLIGHT_FIXTURE_ID } from './productionFlightFixture.mjs';
import { assertInfrastructureClockObservation } from './infrastructureWorkloadContract.mjs';

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
  const infrastructureFixture =
    fixture?.schema === 'gev-infrastructure-fixture-manifest/v1';
  if (fixture && diagnosticsDocuments.length > 0) {
    const expectedRoles = [
      ...Array.from(
        { length: workload?.startupRuns || 0 },
        (_, index) => `startup-${index + 1}`,
      ),
      'main-setup',
      ...(infrastructureFixture
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
    if (infrastructureFixture) {
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
        reasons.push('infrastructure-samples-do-not-share-measured-document');
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
  else if (workerBlobAuditInstrumented)
    reasons.push(
      'receipt-worker-blob-audit-retains-bodies-during-capture-and-is-instrumented',
    );
  if (fixture && !infrastructureFixture)
    reasons.push(
      'provider-fixture-is-static-count-only-not-trajectory-equivalent',
    );
  if (
    !captures.length ||
    captures.some((sample) => sample?.foregroundThroughout !== true)
  )
    reasons.push('foreground-continuity-is-incomplete');
  if (infrastructureFixture) {
    if (
      !workload?.scenarios?.includes('idle') ||
      !workload?.scenarios?.includes('scripted-motion')
    )
      reasons.push(
        'required-infrastructure-objective-workloads-are-incomplete',
      );
  } else if (
    !workload?.scenarios?.includes('scripted-motion') ||
    !workload?.scenarios?.includes('selected-aircraft-tracking')
  )
    reasons.push('required-dense-objective-workloads-are-incomplete');
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
