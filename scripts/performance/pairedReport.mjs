import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  assertCaptureIntegrity,
  comparableCaptureConditions,
} from './captureIntegrity.mjs';
import { assertRouteDescriptorsEquivalent } from './routeEquivalence.mjs';
import { assertObservedTrackingRoute } from './productionFlightFixture.mjs';
import {
  createCaptureDocumentTopology,
  createObservedAustinOperatingComparisonContract,
} from './captureComparisonContract.mjs';
import {
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_WORKLOAD_ID,
} from './austinOperatingWorkloadContract.mjs';
import { summarizeAustinNativePopulations } from './austinOperatingPopulationEvidence.mjs';

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
const isAustinContract = (contract) =>
  contract?.workloadId === AUSTIN_OPERATING_WORKLOAD_ID;
const hashCanonicalIds = (ids) =>
  createHash('sha256')
    .update(ids.slice().sort().join('\n'), 'utf8')
    .digest('hex');

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
  const contractDelivery = contract.fixtureDelivery;
  const austin = isAustinContract(contract);
  assert.equal(
    contractDelivery?.schema,
    austin
      ? 'gev-austin-operating-capture-delivery/v1'
      : 'gev-fixture-delivery-observation/v1',
    `${label}: observed fixture delivery contract is required`,
  );
  assert.equal(contractDelivery.status, 'observed');
  assert.equal(contractDelivery.fixtureSha256, contract.fixture.sha256);
  assert.equal(contractDelivery.fixedTime, contract.fixture.fixedTime);
  if (austin) {
    requireText(contract.fixture.id, `${label}: Austin fixture instance id`);
    assert.equal(contract.fixture.fixedTime, '2026-10-12T18:00:00.000Z');
    assert.equal(contract.fixture.windSourceTime, '2026-10-08T12:00:00.000Z');
    assert.deepEqual(contract.visual, AUSTIN_OPERATING_VISUAL_STATE);
    assert.ok(Array.isArray(contractDelivery.sampleDocuments));
    assert.ok(contract.fixture.sourcePopulationHashes);
    assert.ok(contract.fixture.sourcePopulationIds);
    assert.deepEqual(
      contract.fixture.expectedLayerCounts,
      AUSTIN_OPERATING_LAYER_COUNTS,
    );
  } else {
    requireText(contractDelivery.method, `${label}: delivery method`);
    validCount(
      contractDelivery.observedFlightsCount,
      `${label}: observed fixture flight population`,
    );
  }
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
  if (!austin)
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
  if (austin) {
    assert.deepEqual(
      ids.slice().sort(),
      Object.keys(AUSTIN_OPERATING_LAYER_COUNTS).sort(),
      `${label}: Austin source catalog inventory differs`,
    );
    for (const [id, count] of Object.entries(AUSTIN_OPERATING_LAYER_COUNTS))
      assert.equal(
        populations.find((row) => row.id === id)?.count,
        count,
        `${label}: Austin source catalog count differs for ${id}`,
      );
  }

  const browser = contract.browser;
  requireText(browser?.name, `${label}: browser name`);
  requireText(browser?.version, `${label}: browser version`);
  for (const name of ['viewport', 'drawingBuffer']) {
    const size = contract.rendering?.[name];
    finitePositive(size?.width, `${label}: ${name} width`);
    finitePositive(size?.height, `${label}: ${name} height`);
  }
  assert.deepEqual(
    contract.rendering.viewport,
    report.environment?.viewport,
    `${label}: contract viewport differs from observed environment`,
  );
  assert.deepEqual(
    contract.rendering.drawingBuffer,
    report.environment?.drawingBuffer,
    `${label}: contract drawing buffer differs from observed environment`,
  );
  return contract;
}

function validateAustinSamplePopulationBindings(report, contract, label) {
  const expectedHashes = contract.fixture.sourcePopulationHashes;
  const expectedIds = contract.fixture.sourcePopulationIds;
  const layerIds = Object.keys(AUSTIN_OPERATING_LAYER_COUNTS).sort();
  const documents = contract.fixtureDelivery.sampleDocuments;
  assert.equal(documents.length, report.captures.length);
  for (let index = 0; index < report.captures.length; index += 1) {
    const sample = report.captures[index];
    const document = documents[index];
    assert.deepEqual(
      document.populations,
      summarizeAustinNativePopulations(sample),
      `${label}: Austin report population snapshots differ from the captured clock witness`,
    );
    assert.deepEqual(
      [document.scenario, document.run, document.documentRole, document.documentId],
      [sample.scenario, sample.run, sample.documentRole, sample.documentId],
      `${label}: Austin population evidence is bound to another sample document`,
    );
    for (const boundary of ['before', 'after']) {
      const populations = document.populations?.[boundary];
      const point = sample.conditions?.[boundary];
      assert.ok(Array.isArray(populations), `${label}: missing Austin ${boundary} populations`);
      const enabledLayers = point?.environment?.layers
        ?.filter((row) => row?.enabled === true)
        .map((row) => row.id)
        .sort();
      assert.deepEqual(
        enabledLayers,
        layerIds,
        `${label}: ${sample.scenario} run ${sample.run} ${boundary} enabled layers differ`,
      );
      assert.deepEqual(
        populations.map((row) => row.id).sort(),
        layerIds,
        `${label}: ${sample.scenario} run ${sample.run} ${boundary} population inventory differs`,
      );
      for (const row of populations) {
        const layer = point.environment.layers.find((entry) => entry.id === row.id);
        assert.equal(row.enabled, true);
        assert.equal(
          row.count,
          layer?.count,
          `${label}: ${sample.scenario} run ${sample.run} ${boundary} ${row.id} count is not bound to capture conditions`,
        );
        assert.equal(row.error, null);
        assert.equal(row.loading, row.id === 'satellites' ? null : false);
        assert.equal(row.sourcePopulation?.truncated, false);
        if (row.id === 'military-installations') {
          const ids = row.sourcePopulation?.identityIds;
          const allowed = new Set(expectedIds[row.id] || []);
          assert.ok(Array.isArray(ids));
          assert.equal(ids.length, row.sourcePopulation.count);
          assert.equal(new Set(ids).size, ids.length);
          assert.ok(ids.every((id) => allowed.has(id)));
          assert.equal(row.sourcePopulation.sha256, hashCanonicalIds(ids));
          assert.ok(
            Number.isSafeInteger(row.viewportCount) &&
              row.viewportCount >= 1 &&
              row.viewportCount <= ids.length,
          );
        } else {
          assert.equal(
            row.sourcePopulation?.count,
            AUSTIN_OPERATING_LAYER_COUNTS[row.id],
          );
          if (row.id === 'wind') assert.equal(row.sourcePopulation.sha256, null);
          else assert.equal(row.sourcePopulation.sha256, expectedHashes[row.id]);
        }
        if (['alpr-cameras', 'military-installations', 'radio'].includes(row.id))
          assert.ok(Number.isSafeInteger(row.viewportCount) && row.viewportCount >= 0);
        else assert.equal(row.viewportCount, null);
      }
    }
  }
}

function validateFixtureDelivery(report, contract, label) {
  assert.equal(
    report.comparisonEligible,
    true,
    `${label}: capture is not marked comparison-eligible`,
  );
  const delivery = report.fixtureDelivery;
  if (isAustinContract(contract)) {
    assert.equal(
      delivery?.schema,
      'gev-austin-operating-capture-delivery/v1',
      `${label}: observed Austin fixture delivery is required`,
    );
    assert.equal(delivery.status, 'observed');
    assert.equal(delivery.fixtureId, contract.fixture.id);
    assert.equal(delivery.fixtureSha256, contract.fixture.sha256);
    assert.equal(delivery.fixedTime, contract.fixture.fixedTime);
    assert.deepEqual(
      delivery.sampleDocuments.map(
        ({ scenario, run, documentRole, documentId, populations }) => ({
          scenario,
          run,
          documentRole,
          documentId,
          populations,
        }),
      ),
      contract.fixtureDelivery.sampleDocuments,
      `${label}: report and contract Austin document evidence differ`,
    );
    const expectedAssets = [...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS, 'installations'].sort();
    assert.deepEqual([...delivery.requiredAssetIds].sort(), expectedAssets);
    const topology = createCaptureDocumentTopology({
      startupRuns: report.workload?.startupRuns,
      captureCount: report.captures?.length,
    });
    const owners = report.workload?.austinOperatingFixtureDocuments;
    assert.ok(Array.isArray(owners));
    assert.deepEqual(
      owners
        .map(({ documentRole, documentId }) => ({ documentRole, documentId }))
        .sort((a, b) => a.documentRole.localeCompare(b.documentRole)),
      topology.workerAudits
        .map(({ documentRole, documentId }) => ({ documentRole, documentId }))
        .sort((a, b) => a.documentRole.localeCompare(b.documentRole)),
      `${label}: Austin document owner set differs from capture topology`,
    );
    for (const owner of owners) {
      assert.equal(owner.cleanup?.confirmed, true);
      assert.equal(owner.interceptionRelease?.confirmed, true);
      assert.equal(owner.interceptionRelease?.targetClosed, true);
    }
    for (const document of delivery.sampleDocuments) {
      const owner = owners.find(
        (entry) =>
          entry.documentRole === document.documentRole &&
          entry.documentId === document.documentId,
      );
      assert.ok(owner, `${label}: missing Austin owner cleanup record`);
      assert.equal(owner.delivery?.status, 'observed');
    }
    assert.deepEqual(
      delivery.sampleDocuments.map((document) => document.delivery),
      report.captures.map((sample) => sample.fixtureDelivery),
      `${label}: top-level per-document delivery differs from captured evidence`,
    );
    validateAustinSamplePopulationBindings(report, contract, label);
    return;
  }
  assert.equal(
    delivery?.schema,
    'gev-fixture-delivery-observation/v1',
    `${label}: observed fixture delivery is required`,
  );
  assert.equal(
    delivery.status,
    'observed',
    `${label}: fixture delivery was not observed`,
  );
  requireText(delivery.method, `${label}: fixture delivery method`);
  assert.equal(
    delivery.fixtureSha256,
    contract.fixture.sha256,
    `${label}: observed fixture hash mismatch`,
  );
  assert.equal(
    delivery.fixedTime,
    contract.fixture.fixedTime,
    `${label}: observed fixture time mismatch`,
  );
  assert.equal(
    delivery.method,
    contract.fixtureDelivery?.method,
    `${label}: observed fixture delivery method mismatch`,
  );
  assert.equal(
    delivery.status,
    contract.fixtureDelivery?.status,
    `${label}: contract does not record observed fixture delivery`,
  );
  const expectedFlightCount = contract.populations.find(
    (row) => row.id === 'flights',
  )?.count;
  if (expectedFlightCount !== undefined) {
    assert.equal(
      contract.fixtureDelivery?.observedFlightsCount,
      expectedFlightCount,
      `${label}: contract flight population differs from observed delivery`,
    );
    assert.equal(
      delivery.observedFlightsCount,
      expectedFlightCount,
      `${label}: observed delivery did not produce the declared flight population`,
    );
  } else
    assert.equal(
      contract.fixtureDelivery?.observedFlightsCount,
      delivery.observedFlightsCount,
      `${label}: contract and report fixture populations differ`,
    );
  assert.ok(
    Number.isInteger(delivery.fulfilledResponseCount) &&
      delivery.fulfilledResponseCount > 0,
    `${label}: at least one successful fixture response acknowledgement is required`,
  );
  if (delivery.perSampleResponseCounts !== undefined) {
    assert.ok(
      Array.isArray(delivery.perSampleResponseCounts),
      `${label}: per-sample delivery diagnostics must be an array`,
    );
    const diagnosticKeys = delivery.perSampleResponseCounts.map((row) => {
      requireText(row?.scenario, `${label}: per-sample delivery scenario`);
      assert.ok(
        Number.isInteger(row.run) && row.run > 0,
        `${label}: per-sample delivery run is invalid`,
      );
      assert.ok(
        Number.isInteger(row.fulfilledResponseCount) &&
          row.fulfilledResponseCount > 0,
        `${label}: per-sample delivery count is invalid`,
      );
      return `${row.scenario}:${row.run}`;
    });
    const captureKeys = report.captures.map(
      (sample) => `${sample.scenario}:${sample.run}`,
    );
    assert.deepEqual(
      [...diagnosticKeys].sort(),
      [...captureKeys].sort(),
      `${label}: delivery diagnostics do not match capture samples`,
    );
    assert.equal(
      delivery.perSampleResponseCounts.reduce(
        (sum, row) => sum + row.fulfilledResponseCount,
        0,
      ),
      delivery.fulfilledResponseCount,
      `${label}: delivery diagnostic counts do not sum to the report total`,
    );
  }
  assert.equal(
    contract.fixtureDelivery?.fixtureSha256,
    contract.fixture.sha256,
    `${label}: delivery contract fixture hash differs`,
  );
  assert.equal(
    contract.fixtureDelivery?.fixedTime,
    contract.fixture.fixedTime,
    `${label}: delivery contract fixture time differs`,
  );
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
function validateBuildProvenance(source, side) {
  const provenance = source?.buildProvenance;
  assert.equal(
    provenance?.schema,
    'gev-capture-build-provenance/v1',
    `${side}: verified build provenance is required`,
  );
  assert.equal(
    provenance.status,
    'verified-local-build-and-served-assets-before-and-after',
    `${side}: build and served-byte checks must bracket capture`,
  );
  assert.match(
    provenance.receiptSha256 || '',
    SHA256,
    `${side}: receipt hash is missing`,
  );
  assert.equal(
    provenance.appCommit,
    source.appCommit,
    `${side}: receipt app SHA mismatch`,
  );
  assert.equal(
    provenance.harnessCommit,
    source.harnessCommit,
    `${side}: receipt harness SHA mismatch`,
  );
  assert.match(
    provenance.scope || '',
    /browser response bytes are not independently attested/,
    `${side}: build provenance limitations are not declared`,
  );
  const recipe = provenance.buildRecipe;
  for (const name of [
    'nodeVersion',
    'npmVersion',
    'dependencyInstall',
    'buildInvocation',
  ])
    requireText(recipe?.[name], `${side}: build recipe ${name}`);
  for (const name of [
    'packageJsonSha256',
    'packageLockSha256',
    'buildScriptSha256',
  ])
    assert.match(
      recipe?.[name] || '',
      SHA256,
      `${side}: build recipe ${name} is missing`,
    );
  const validateServed = (record, phase) => {
    assert.equal(
      record?.schema,
      'gev-served-assets-verification/v1',
      `${side}: ${phase} served check schema`,
    );
    assert.equal(
      record?.status,
      'served-assets-match',
      `${side}: ${phase} served check failed`,
    );
    assert.equal(
      record.receiptSha256,
      provenance.receiptSha256,
      `${side}: ${phase} receipt hash mismatch`,
    );
    assert.ok(
      Number.isInteger(record.assetCount) && record.assetCount > 0,
      `${side}: ${phase} asset count is invalid`,
    );
    assert.ok(
      Number.isInteger(record.totalAssetBytes) && record.totalAssetBytes > 0,
      `${side}: ${phase} asset byte count is invalid`,
    );
  };
  validateServed(provenance.before, 'pre-capture');
  validateServed(provenance.after, 'post-capture');
  assert.deepEqual(
    provenance.after,
    provenance.before,
    `${side}: served build changed during capture`,
  );
  const pageAssets = provenance.pageAssetAudit;
  assert.ok(
    Number.isInteger(pageAssets?.scriptRequestCount) &&
      pageAssets.scriptRequestCount > 0,
    `${side}: receipted script requests are missing`,
  );
  assert.ok(
    Array.isArray(pageAssets.loadedAssetPaths) &&
      pageAssets.loadedAssetPaths.length > 0,
    `${side}: loaded asset paths are missing`,
  );
  assert.equal(
    new Set(pageAssets.loadedAssetPaths).size,
    pageAssets.loadedAssetPaths.length,
    `${side}: duplicate loaded asset path`,
  );
  assert.deepEqual(
    pageAssets.unexpectedAssetPaths,
    [],
    `${side}: unreceipted same-origin code asset was requested`,
  );
  for (const assetPath of pageAssets.loadedAssetPaths) {
    requireText(assetPath, `${side}: loaded asset path`);
    assert.equal(
      assetPath.includes('..'),
      false,
      `${side}: unsafe loaded asset path`,
    );
  }
  return recipe;
}
function validateRoute(
  route,
  scenario,
  durationMs,
  label,
  { fixture, warmupMs } = {},
) {
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
    assertObservedTrackingRoute(route, {
      fixtureId: fixture?.id,
      fixtureSha256: fixture?.sha256,
      fixedTime: fixture?.fixedTime,
      fixtureCount: fixture?.count,
      warmupMs,
      measurementMs: durationMs,
    });
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
  const buildRecipe = validateBuildProvenance(report.source, side);

  const contract = validateContract(report, side);
  validateFixtureDelivery(report, contract, side);
  const { workload, environment, captures } = report;
  const austin = isAustinContract(contract);
  if (austin) {
    const rebuilt = createObservedAustinOperatingComparisonContract({
      fixture: workload?.fixture,
      fixtureDelivery: report.fixtureDelivery,
      environment,
      captures,
      scenarios: workload?.scenarios,
      workload: {
        warmupMs: workload?.warmupMs,
        durationPerSampleMs: workload?.durationPerSampleMs,
        runsPerScenario: workload?.runsPerScenario,
      },
    });
    equal(
      rebuilt,
      contract,
      `${side}: report comparison contract is not derived from its Austin producer evidence`,
    );
  }
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
  if (austin) {
    assert.deepEqual(
      contract.fixture.sourcePopulationHashes,
      workload.fixture?.sourcePopulationHashes,
      `${side}: pinned Austin source hashes differ from the loaded fixture`,
    );
    assert.deepEqual(
      contract.fixture.sourcePopulationIds,
      workload.fixture?.sourcePopulationIds,
      `${side}: pinned Austin source identities differ from the loaded fixture`,
    );
    assert.deepEqual(
      contract.fixture.assets,
      workload.fixture?.assets?.map(({ id, sha256, byteLength }) => ({
        id,
        sha256,
        byteLength,
      })),
      `${side}: pinned Austin asset identities differ from the loaded fixture`,
    );
  }
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
  if (!austin) {
    const actualPopulations = layerSignature(
      environment.layers,
      `${side} environment`,
    );
    equal(
      actualPopulations,
      populationSignature(contract.populations),
      `${side}: comparison contract populations do not match capture environment`,
    );
  }
  for (const [scenario, route] of Object.entries(contract.routes))
    validateRoute(
      route,
      scenario,
      workload.durationPerSampleMs,
      `${side}: route ${scenario}`,
      {
        fixture: { ...contract.fixture, count: workload.fixture?.count },
        warmupMs: workload.warmupMs,
      },
    );

  const counts = austin
    ? {}
    : Object.fromEntries(contract.populations.map((row) => [row.id, row.count]));
  assertCaptureIntegrity(captures, {
    expectedCommit: expectedAppCommit,
    qualityMode: 'manual',
    expectedDensityPct: 75,
    expectedCounts: counts,
    expectedFixture: { ...contract.fixture, count: workload.fixture?.count },
    expectedWarmupMs: workload.warmupMs,
    expectedMeasurementMs: workload.durationPerSampleMs,
    ...(austin
      ? { dynamicPopulationIds: ['alpr-cameras', 'military-installations', 'radio'] }
      : {}),
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
    assertRouteDescriptorsEquivalent(
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
      if (!austin)
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
  return { contract, byScenario, buildRecipe };
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
  for (const key of [
    'nodeVersion',
    'npmVersion',
    'dependencyInstall',
    'buildInvocation',
  ])
    assert.equal(
      base.buildRecipe[key],
      next.buildRecipe[key],
      `Build toolchain differs: ${key}`,
    );
  const { routes: baseRoutes, ...baseContract } = base.contract;
  const { routes: candidateRoutes, ...candidateContract } = next.contract;
  equal(
    baseContract,
    candidateContract,
    'Baseline and candidate comparison contracts differ',
  );
  equal(
    Object.keys(baseRoutes).sort(),
    Object.keys(candidateRoutes).sort(),
    'Baseline and candidate route scenarios differ',
  );
  for (const scenario of Object.keys(baseRoutes))
    assertRouteDescriptorsEquivalent(
      baseRoutes[scenario],
      candidateRoutes[scenario],
      `Baseline and candidate ${scenario} route descriptors differ beyond camera pose roundoff`,
    );
  const fixtureDeliverySignature = (delivery) => ({
    schema: delivery.schema,
    status: delivery.status,
    method: delivery.method,
    fixtureSha256: delivery.fixtureSha256,
    fixedTime: delivery.fixedTime,
    observedFlightsCount: delivery.observedFlightsCount,
  });
  equal(
    fixtureDeliverySignature(baseline.fixtureDelivery),
    fixtureDeliverySignature(candidate.fixtureDelivery),
    'Observed fixture identity and delivered population differ between builds',
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
        for (const key of ['before', 'after']) {
          conditions[key] = comparableCaptureConditions(
            conditions[key],
            'manual',
          );
          const point = conditions[key];
          delete point.environment.appCommit;
        }
        return conditions;
      };
      equal(
        pairedConditions(baseRun),
        pairedConditions(candidateRun),
        `${scenario} run ${baseRun.run}: baseline and candidate conditions differ`,
      );
      assertRouteDescriptorsEquivalent(
        baseRun.cameraPath,
        candidateRun.cameraPath,
        `${scenario} run ${baseRun.run}: baseline and candidate routes differ beyond camera pose roundoff`,
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
  const workloadObjectiveAssessed =
    workloadObjectiveScenarios.length > 0 &&
    workloadObjectiveScenarios.every(
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
    fixtureDeliveryDiagnostics: {
      baseline: {
        fulfilledResponseCount: baseline.fixtureDelivery.fulfilledResponseCount,
        perSample: baseline.fixtureDelivery.perSampleResponseCounts || null,
      },
      candidate: {
        fulfilledResponseCount:
          candidate.fixtureDelivery.fulfilledResponseCount,
        perSample: candidate.fixtureDelivery.perSampleResponseCounts || null,
      },
    },
    regressionsOver10Pct: Object.keys(scenarios).filter(
      (scenario) => scenarios[scenario].regressionOver10Pct,
    ),
  };
}
