import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import { createOrbits } from '../../src/layers/satellites/orbits.js';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
  AUSTIN_OPERATING_RENDERING_STATE,
  AUSTIN_OPERATING_ROUTE,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_WIND_VALID_TIME,
  AUSTIN_OPERATING_WORKLOAD_ID,
} from './austinOperatingWorkloadContract.mjs';
import {
  createAustinOperatingFixtureDelivery,
  createAustinOperatingWorkloadFixture,
} from './austinOperatingWorkloadFixture.mjs';
import {
  createObservedAustinOperatingComparisonContract,
  readSettledRenderBoundaryElapsedMs,
} from './captureComparisonContract.mjs';
import { observeRenderBoundary } from './renderBoundaryObservation.mjs';
import {
  normalizeAustinSatelliteWitness,
  summarizeAustinNativePopulations,
} from './austinOperatingPopulationEvidence.mjs';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import { evaluateManifestPerformanceEvidence } from './candidatePerformanceEvidence.mjs';
import { createAustinOperatingDocumentEvidence } from './austinOperatingDocumentEvidence.mjs';
import {
  deriveAustinSatelliteSampledEpoch,
  loadAustinSatelliteEpochReference,
} from './austinSatelliteSampledEpoch.mjs';
import {
  baselineCommit,
  candidateCommit,
  makeReport,
} from './pairedReportTestFixtures.mjs';

const APP = 'https://fixture.example';
const FIXED_MS = Date.parse(AUSTIN_OPERATING_FIXED_TIME);
const ORBITS = createOrbits({ state: {}, services: {}, parts: {}, source: {} });
const hashIds = (ids) =>
  createHash('sha256')
    .update(ids.slice().sort().join('\n'), 'utf8')
    .digest('hex');

function assetUrl(id) {
  if (id.startsWith('tle-')) return `${APP}/api/celestrak/${id.slice(4)}`;
  if (id === 'cctv-catalog-response') return `${APP}/api/cctv/sources`;
  if (id === 'cctv-health') return `${APP}/api/cctv/health`;
  if (id === 'alpr-tilejson')
    return 'https://tiles.dontgetflocked.com/cameras-us-hourly.json';
  if (id === 'radio-directory') return `${APP}/api/radio/stations`;
  if (id === 'wind-manifest') return `${APP}/api/wind/manifest?model=gfs`;
  if (id === 'wind-grid')
    return `${APP}/api/wind/grid/gfs-austin-operating-v1.bin?model=gfs`;
  throw new Error(`Unknown Austin fixture asset ${id}`);
}

async function observedDelivery(fixture, ordinal) {
  const delivery = createAustinOperatingFixtureDelivery(fixture, APP);
  const fulfill = async (url) => {
    const result = await delivery.respond(url, { method: 'GET' });
    assert.ok(result, `fixture route must own ${url}`);
    delivery.onFulfilled({
      url,
      method: 'GET',
      status: result.status,
      bodyBase64: Buffer.from(result.body).toString('base64'),
    });
  };
  for (const id of AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS)
    await fulfill(assetUrl(id));
  for (const [z, x, y] of AUSTIN_OPERATING_REQUIRED_ALPR_TILES)
    await fulfill(
      `https://tiles.dontgetflocked.com/cameras-us-hourly/${z}/${x}/${y}.mvt`,
    );
  const route = AUSTIN_OPERATING_ROUTE;
  await fulfill(
    `${APP}/api/military-installations?south=${route.south}&west=${route.west}&north=${route.north}&east=${route.east}&exact=1`,
  );
  if (ordinal % 2 === 0) await fulfill(assetUrl('tle-stations'));
  return delivery.summarize({
    requiredAssetIds: [
      ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
      'installations',
    ],
    requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
      ([z, x, y]) => ({ z, x, y }),
    ),
  });
}

function layerObservation(
  fixture,
  {
    installations = 357,
    alprNearby = 776,
    radioVisible = 88,
    positionVersion = 0,
  } = {},
) {
  const installationIds = fixture.sourcePopulationIds[
    'military-installations'
  ].slice(0, installations);
  const source = (id, count, sha256, extra = {}) => ({
    count,
    sha256,
    positionSha256:
      id === 'satellites'
        ? positionVersion.toString(16).repeat(64).slice(0, 64)
        : null,
    truncated: false,
    ...(id === 'military-installations'
      ? { identityIds: installationIds }
      : {}),
    ...extra,
  });
  return Object.keys(AUSTIN_OPERATING_LAYER_COUNTS).map((id) => {
    const catalogCount = AUSTIN_OPERATING_LAYER_COUNTS[id];
    const row = {
      id,
      enabled: true,
      expectedSourceCatalogCount: catalogCount,
      count:
        id === 'alpr-cameras'
          ? alprNearby
          : id === 'wind'
            ? catalogCount
            : id === 'military-installations'
              ? installations
              : catalogCount,
      viewportCount: [
        'alpr-cameras',
        'military-installations',
        'radio',
      ].includes(id)
        ? id === 'alpr-cameras'
          ? alprNearby
          : id === 'military-installations'
            ? installations
            : radioVisible
        : null,
      nearbyCount: id === 'alpr-cameras' ? alprNearby : null,
      onScreenCount: id === 'alpr-cameras' ? 203 : null,
      loading: id === 'satellites' ? null : false,
      error: null,
      sourcePopulation: source(
        id,
        id === 'military-installations' ? installations : catalogCount,
        id === 'wind'
          ? null
          : id === 'military-installations'
            ? hashIds(installationIds)
            : fixture.sourcePopulationHashes[id],
      ),
    };
    return row;
  });
}

function cameraPose() {
  return {
    position: { x: 1, y: 2, z: 3 },
    direction: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    headingDeg: AUSTIN_OPERATING_ROUTE.headingDeg,
    pitchDeg: AUSTIN_OPERATING_ROUTE.pitchDeg,
    rollDeg: 0,
  };
}

async function makeObservedPairInput({ responseVariant = true } = {}) {
  const fixture = createAustinOperatingWorkloadFixture();
  const satelliteReference = loadAustinSatelliteEpochReference(fixture);
  const captures = [];
  const scenarios = ['idle', 'scripted-motion'];
  const runsPerScenario = 5;
  const warmupMs = 30_000;
  const durationPerSampleMs = 60_000;
  const settings = {
    qualityMode: 'manual',
    densityPct: 75,
    detectionMode: 'DENSE',
    ...AUSTIN_OPERATING_RENDERING_STATE,
    visualState: {
      style: 'normal',
      styleParams: {},
      detection: { density: 75 },
    },
  };
  for (const index of Array.from(
    { length: scenarios.length * runsPerScenario },
    (_, item) => item,
  )) {
    const scenario = scenarios[Math.floor(index / runsPerScenario)];
    const run = (index % runsPerScenario) + 1;
    const ordinal = index + 1;
    const delivery = await observedDelivery(
      fixture,
      responseVariant ? ordinal : 1,
    );
    const beforeLayers = layerObservation(fixture, {
      positionVersion: ordinal * 2,
      installations: 357,
      alprNearby: scenario === 'idle' ? 776 : 704,
    });
    const afterLayers = layerObservation(fixture, {
      positionVersion: ordinal * 2 + 1,
      installations: 357,
      alprNearby: scenario === 'idle' ? 776 : 704,
    });
    const before = FIXED_MS + warmupMs;
    const after = before + durationPerSampleMs;
    const positionRowsAt = (epochMs) =>
      [...satelliteReference.catalog.values()].map((entry) => {
        const position = ORBITS.propagatePosition(
          twoline2satrec(entry.line1, entry.line2),
          new Date(epochMs),
        );
        return {
          id: entry.id,
          longitude: position.longitude,
          latitude: position.latitude,
          altitudeM: position.altitude,
        };
      });
    const rawSatelliteRowsBefore = positionRowsAt(before);
    const rawSatelliteRowsAfter = positionRowsAt(after);
    const sampledEpochOptions = {
      reference: satelliteReference,
      documentRole: `provider-sample-${ordinal}`,
      documentId: `provider-document-${ordinal}`,
      runOrdinal: 1,
    };
    const satelliteSampledEpochs = {
      warmupHeld: deriveAustinSatelliteSampledEpoch({
        ...sampledEpochOptions,
        records: rawSatelliteRowsBefore,
        boundaryEpochMs: before,
        boundary: 'warmup-held',
      }),
      measurementComplete: deriveAustinSatelliteSampledEpoch({
        ...sampledEpochOptions,
        records: rawSatelliteRowsAfter,
        boundaryEpochMs: after,
        boundary: 'measurement-complete',
      }),
    };
    const satelliteLayerBefore = beforeLayers.find(
      (layer) => layer.id === 'satellites',
    );
    const satelliteLayerAfter = afterLayers.find(
      (layer) => layer.id === 'satellites',
    );
    satelliteLayerBefore.sourcePopulation.sha256 =
      satelliteSampledEpochs.warmupHeld.identitySha256;
    satelliteLayerBefore.sourcePopulation.positionSha256 =
      satelliteSampledEpochs.warmupHeld.positionSha256;
    satelliteLayerAfter.sourcePopulation.sha256 =
      satelliteSampledEpochs.measurementComplete.identitySha256;
    satelliteLayerAfter.sourcePopulation.positionSha256 =
      satelliteSampledEpochs.measurementComplete.positionSha256;
    const pose = cameraPose();
    const cameraPath = {
      id: scenario === 'idle' ? 'parked-v1' : 'elapsed-move-right-v1',
      start: pose,
      end: {
        ...pose,
        position: {
          ...pose.position,
          x: pose.position.x + (scenario === 'idle' ? 0 : 19_200),
        },
      },
      elapsedDurationMs: durationPerSampleMs,
      motionDistanceM: scenario === 'idle' ? 0 : 19_200,
    };
    const environment = {
      layers: afterLayers.map(({ id, enabled, count }) => ({
        id,
        enabled,
        count,
      })),
      totalObjects: afterLayers.reduce((sum, row) => sum + row.count, 0),
      focused: true,
      visible: true,
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
    };
    const austinOperatingClock = {
      schema: 'gev-austin-operating-capture-clock/v1',
      fixedHarnessTime: fixture.fixedTime,
      runOrdinal: 1,
      configuredWarmupMs: warmupMs,
      configuredMeasurementMs: durationPerSampleMs,
      start: { epochMs: FIXED_MS },
      measurementStart: { epochMs: before },
      measurementEnd: {
        phase: 'complete',
        runOrdinal: 1,
        elapsedMs: warmupMs + durationPerSampleMs,
      },
      measurementBoundarySettleNativeMs: 15,
      wallClockBeforeMs: before,
      wallClockAfterMs: after,
      windSourceTime: fixture.windSourceTime,
      windSourceValidAtBeforeMs: Date.parse(fixture.windSourceTime),
      windSourceValidAtAfterMs: Date.parse(fixture.windSourceTime),
      windSourceAgeBeforeMs: before - Date.parse(fixture.windSourceTime),
      windSourceAgeAfterMs: after - Date.parse(fixture.windSourceTime),
      satelliteWitnessBefore: normalizeAustinSatelliteWitness({
        ...rawSatelliteRowsBefore.find((row) => row.id === 25544),
      }),
      satelliteWitnessAfter: normalizeAustinSatelliteWitness({
        ...rawSatelliteRowsAfter.find((row) => row.id === 25544),
      }),
      satelliteSampledEpochs,
      selectedLayersBefore: beforeLayers,
      selectedLayersAfter: afterLayers,
      visualSettingsBefore: settings,
      visualSettingsAfter: settings,
      cameraStart: pose,
      cameraEnd: cameraPath.end,
    };
    captures.push({
      scenario,
      run,
      documentRole: `provider-sample-${ordinal}`,
      documentId: `provider-document-${ordinal}`,
      foregroundThroughout: true,
      cameraPath,
      austinOperatingClock,
      fixtureDelivery: delivery,
      layers: environment.layers,
      totalObjects: environment.totalObjects,
      settings: { before: settings, after: settings },
      conditions: {
        before: {
          environment: {
            ...environment,
            layers: beforeLayers.map(({ id, enabled, count }) => ({
              id,
              enabled,
              count,
            })),
          },
          settings,
          focused: true,
          visible: true,
        },
        after: { environment, settings, focused: true, visible: true },
      },
    });
  }
  const sampleDocuments = captures.map((sample) => ({
    scenario: sample.scenario,
    run: sample.run,
    documentRole: sample.documentRole,
    documentId: sample.documentId,
    delivery: sample.fixtureDelivery,
    populations: summarizeAustinNativePopulations(sample),
  }));
  const fixtureDelivery = {
    schema: 'gev-austin-operating-capture-delivery/v1',
    status: 'observed',
    fixtureId: fixture.id,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    windSourceTime: fixture.windSourceTime,
    windSourceAgeMs: fixture.windSourceAgeMs,
    requiredAssetIds: [
      ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
      'installations',
    ],
    requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
      ([z, x, y]) => `${z}/${x}/${y}`,
    ),
    sampleDocuments,
    sourceProvenance: fixture.provenance,
  };
  const environment = {
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
    viewport: { width: 1440, height: 900, dpr: 1 },
    drawingBuffer: { width: 1440, height: 900 },
    layers: captures[0].conditions.after.environment.layers,
  };
  const workload = {
    warmupMs,
    durationPerSampleMs,
    runsPerScenario,
    injectedDelayMs: 0,
    startupRuns: 1,
  };
  const contract = createObservedAustinOperatingComparisonContract({
    fixture,
    fixtureDelivery,
    environment,
    captures,
    scenarios,
    workload: {
      warmupMs,
      durationPerSampleMs,
      runsPerScenario,
    },
  });
  return {
    fixture,
    fixtureDelivery,
    environment,
    captures,
    scenarios,
    workload,
    contract,
  };
}

function asPairedReport(input, commit, p95Offset = 0) {
  const report = makeReport(commit);
  report.comparisonEligible = true;
  report.comparisonContract = structuredClone(input.contract);
  report.environment = {
    ...report.environment,
    ...input.environment,
    appCommit: commit,
    platform: 'Win32',
    renderer: 'Test Renderer',
    vendor: 'Test Vendor',
  };
  report.graphics.browserVersion = 'Chrome/140.0.7339.80';
  const documentOwners = [
    { documentRole: 'startup-1', documentId: 'startup-document-1' },
    { documentRole: 'main-setup', documentId: 'main-measured-document' },
    ...input.captures.map((sample) => ({
      documentRole: sample.documentRole,
      documentId: sample.documentId,
      delivery: sample.fixtureDelivery,
    })),
  ].map((owner, index) => ({ ...owner, sessionOrdinal: index + 1 }));
  const drained = () => ({
    schema: 'gev-fixture-interception-drain/v1',
    confirmed: true,
    listenerRemovalConfirmed: true,
    pendingAtStop: 1,
    pendingCommandsAfterDrain: 0,
    pendingPreparationsAfterDrain: 0,
    pendingAbortSubscriptionsAfterDrain: 0,
    rejectedDrainOperations: 0,
    drainCommandFailures: 0,
    unexpectedLateRequestCount: 0,
  });
  const fixtureInterceptionReleases = documentOwners.map((owner) => ({
    schema: 'gev-flight-fixture-session-release/v1',
    sessionOrdinal: owner.sessionOrdinal,
    documentRole: owner.documentRole,
    documentId: owner.documentId,
    confirmed: true,
    targetClosed: true,
    stop: drained(),
    interception: {
      schema: 'gev-fixture-interception-release/v1',
      confirmed: true,
      interception: drained(),
      fetchDisable: 'target-closed',
      detach: 'target-closed',
    },
  }));
  report.workload = {
    ...report.workload,
    warmupMs: input.workload.warmupMs,
    durationPerSampleMs: input.workload.durationPerSampleMs,
    runsPerScenario: input.workload.runsPerScenario,
    startupRuns: 1,
    scenarios: input.scenarios,
    fixture: input.fixture,
    mixedLayers: [],
    qualityMode: 'manual',
    expectedDensityPct: 75,
    detectionMode: 'DENSE',
    injectedDelayMs: 0,
    populationStableAcrossSamples: true,
    cameraPathStableAcrossSamples: true,
    cameraPath: 'Austin fixed route: parked-v1 and elapsed-move-right-v1',
    fixtureInterceptionReleases,
    austinOperatingFixtureDocuments: documentOwners.map((owner) =>
      createAustinOperatingDocumentEvidence({
        ...owner,
        releaseRecords: fixtureInterceptionReleases,
        disposed: true,
        disposeReason: 'paired-report-test-target-closed',
      }),
    ),
  };
  report.fixtureDelivery = structuredClone(input.fixtureDelivery);
  report.fixtureDelivery.documentOwners = structuredClone(
    report.workload.austinOperatingFixtureDocuments,
  );
  report.fixtureDelivery.sourceProvenance = input.fixture.provenance;
  report.fixtureDelivery.status = 'observed';
  report.fixtureDelivery.fulfilledResponseCount = input.captures.reduce(
    (sum, sample) =>
      sum +
      sample.fixtureDelivery.deliveredAssets.reduce(
        (total, asset) => total + asset.responseCount,
        0,
      ),
    0,
  );
  report.captures = input.captures.map((sample, index) => {
    const clone = structuredClone(sample);
    clone.durationMs = input.workload.durationPerSampleMs;
    clone.frameCount = 100;
    const p95 = 38 + p95Offset + (index % 3);
    clone.frameIntervalMs = { p50: p95, p95, max: p95, samples: 100 };
    for (const boundary of ['before', 'after']) {
      clone.conditions[boundary].environment.appCommit = commit;
      clone.conditions[boundary].environment.renderer = 'Test Renderer';
      clone.conditions[boundary].environment.vendor = 'Test Vendor';
    }
    return clone;
  });
  return report;
}

test('Austin comparison contract is built from real fixture delivery acknowledgments and exact five-run evidence', async () => {
  const input = await makeObservedPairInput();
  assert.ok(
    Buffer.byteLength(JSON.stringify(input.captures), 'utf8') < 8 * 1024 * 1024,
    'raw sample rows fit the existing bounded capture artifact limit',
  );
  assert.equal(input.contract.objectiveScenarios.length, 0);
  assert.equal(input.contract.fixtureDelivery.sampleDocuments.length, 10);
  assert.notDeepEqual(
    input.captures[0].fixtureDelivery.deliveredAssets,
    input.captures[1].fixtureDelivery.deliveredAssets,
    'per-document request counts stay observed even though fixed identities match',
  );
  assert.ok(
    input.contract.fixtureDelivery.sampleDocuments.every(
      (row) => row.populations.before.length === 6,
    ),
  );
});

test('candidate coverage consumes the actual Austin producer contract and rejects its ineligible form', async () => {
  const input = await makeObservedPairInput();
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-austin-candidate-'),
  );
  try {
    const manifestPath = path.join(directory, 'manifest.json');
    const writeReport = async (name, report) => {
      const bytes = Buffer.from(JSON.stringify(report));
      await writeFile(path.join(directory, `${name}.json`), bytes);
      return {
        path: `${name}.json`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    };
    const nativeReport = (commit) => {
      const report = asPairedReport(input, commit);
      report.environment.renderer = 'Intel UHD 620';
      report.environment.vendor = 'Intel';
      report.graphics = {
        ...report.graphics,
        featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
        devices: [{ vendor: 'Intel', device: 'UHD 620', driver: '31.0' }],
      };
      report.hostEnvironment = {
        platform: 'win32',
        architecture: 'x64',
        osRelease: '10.0.26200',
        cpu: 'Intel Core i7',
        memoryBytes: 16 * 1024 ** 3,
        hosted: false,
      };
      for (const sample of report.captures)
        for (const boundary of ['before', 'after']) {
          sample.conditions[boundary].environment.renderer = 'Intel UHD 620';
          sample.conditions[boundary].environment.vendor = 'Intel';
        }
      return report;
    };
    const evaluate = async (comparisonEligible) => {
      const baseline = nativeReport(baselineCommit);
      const candidate = nativeReport(candidateCommit);
      baseline.comparisonEligible = comparisonEligible;
      candidate.comparisonEligible = comparisonEligible;
      const baselineArtifact = await writeReport('austin-baseline', baseline);
      const candidateArtifact = await writeReport(
        'austin-candidate',
        candidate,
      );
      return evaluateManifestPerformanceEvidence(
        {
          comparisons: [
            {
              environmentId: 'windows-uhd620',
              baselineCommit,
              baseline: baselineArtifact,
              candidate: candidateArtifact,
            },
          ],
          retention: [],
        },
        { manifestPath, candidateCommit },
      );
    };

    const eligible = await evaluate(true);
    assert.equal(
      eligible.comparisons[0].workloadId,
      AUSTIN_OPERATING_WORKLOAD_ID,
    );
    assert.equal(eligible.comparisons[0].validation.status, 'comparable');
    assert.ok(eligible.comparison.workloadIds.includes('operating-view'));
    assert.ok(!eligible.comparison.missingWorkloads.includes('operating-view'));

    const diagnostic = await evaluate(false);
    assert.ok(!diagnostic.comparison.workloadIds.includes('operating-view'));
    assert.ok(
      diagnostic.comparison.missingWorkloads.includes('operating-view'),
    );
    assert.equal(diagnostic.comparison.environments[0].status, 'failed');
  } finally {
    await rm(directory, { recursive: true, force: false });
  }
});

test('Austin rendering contract matches observed viewer defaults and labels changed AA settings', async () => {
  const input = await makeObservedPairInput();
  assert.equal(input.captures[0].settings.before.fxaa, false);
  assert.equal(input.captures[0].settings.before.msaaSamples, 4);
  assert.equal(input.captures[0].settings.before.antialias, true);
  assert.equal(input.captures[0].settings.before.resolutionScale, 1);

  for (const [property, replacement] of [
    ['fxaa', true],
    ['msaaSamples', 8],
    ['antialias', false],
    ['resolutionScale', 0.75],
  ]) {
    const captures = structuredClone(input.captures);
    for (const sample of captures) {
      const observedSettings = [
        sample.austinOperatingClock.visualSettingsBefore,
        sample.austinOperatingClock.visualSettingsAfter,
        sample.settings.before,
        sample.settings.after,
        sample.conditions.before.settings,
        sample.conditions.after.settings,
      ];
      for (const settings of observedSettings) settings[property] = replacement;
    }
    const sample = captures[0];
    assert.throws(
      () =>
        createObservedAustinOperatingComparisonContract({
          ...input,
          captures,
        }),
      new RegExp(
        `${sample.scenario} run ${sample.run}: Austin before visual property ${property} differs`,
      ),
      `${property} mutation must fail with its sample/boundary/property label`,
    );
  }
});

test('Austin capture setting copies stay bound to the native visual observations', async () => {
  const input = await makeObservedPairInput();
  const captures = structuredClone(input.captures);
  for (const sample of captures) {
    sample.settings.before = {
      ...sample.settings.before,
      bloomIntensity: 0.25,
    };
    sample.conditions.before.settings = sample.settings.before;
  }

  assert.throws(
    () =>
      createObservedAustinOperatingComparisonContract({
        ...input,
        captures,
      }),
    /idle run 1: Austin capture settings before differ from the native before observation/,
  );
});

test('Austin measurement contract consumes the settled render-boundary producer result', async () => {
  const boundary = await observeRenderBoundary({
    label: 'Austin measurement boundary',
    timeoutMs: 100,
    evaluate: async () => ({
      status: 'settled',
      settleElapsedMs: 27.3,
      diagnostics: {
        phase: 'settled',
        pageEntryElapsedMs: 0,
        pageElapsedMs: 27.3,
        listenerRegistered: true,
        listenerRegistrationElapsedMs: 1,
        renderRequestStarted: true,
        renderRequestStartElapsedMs: 2,
        renderRequestCompleted: true,
        renderRequestCompleteElapsedMs: 3,
        postRenderObserved: true,
        postRenderElapsedMs: 27.3,
        pageTimerFired: false,
        pageTimerElapsedMs: null,
        cleanup: { timerCleared: true, listenerRemoved: true },
      },
    }),
  });
  const input = await makeObservedPairInput();
  input.captures[0].austinOperatingClock.measurementBoundarySettleNativeMs =
    readSettledRenderBoundaryElapsedMs(boundary, 'Austin measurement');
  const contract = createObservedAustinOperatingComparisonContract({
    fixture: input.fixture,
    fixtureDelivery: input.fixtureDelivery,
    environment: input.environment,
    captures: input.captures,
    scenarios: input.scenarios,
    workload: {
      warmupMs: input.workload.warmupMs,
      durationPerSampleMs: input.workload.durationPerSampleMs,
      runsPerScenario: input.workload.runsPerScenario,
    },
  });

  assert.equal(contract.schema, 'gev-performance-comparison-contract/v1');
  assert.equal(
    input.captures[0].austinOperatingClock.measurementBoundarySettleNativeMs,
    27.3,
  );
  assert.throws(
    () =>
      readSettledRenderBoundaryElapsedMs(
        { status: 'host-observation-deadline', settleElapsedMs: null },
        'Austin measurement',
      ),
    /did not settle/,
  );
});

test('Austin comparison rejects same-count source identity substitution and keeps response counters out of fixed identity', async () => {
  const input = await makeObservedPairInput();
  const changed = structuredClone(input.captures);
  const altered = changed[0].austinOperatingClock.selectedLayersAfter.find(
    (row) => row.id === 'cctv',
  );
  altered.sourcePopulation.sha256 = 'f'.repeat(64);
  assert.throws(
    () =>
      createObservedAustinOperatingComparisonContract({
        ...input,
        captures: changed,
      }),
    /identities differ from the pinned source catalog/,
  );
  assert.equal(
    input.contract.fixtureDelivery.sampleDocuments[0].populations.before.find(
      (row) => row.id === 'satellites',
    ).count,
    AUSTIN_OPERATING_LAYER_COUNTS.satellites,
  );
});

test('Austin paired report accepts actual fixture delivery with variable counters, and rejects a substituted native catalog', async () => {
  const baseInput = await makeObservedPairInput();
  const nextInput = await makeObservedPairInput();
  const baseline = asPairedReport(baseInput, baselineCommit);
  const candidate = asPairedReport(nextInput, candidateCommit);
  for (const [
    index,
    sample,
  ] of candidate.fixtureDelivery.sampleDocuments.entries()) {
    sample.delivery.deliveredAssets[0].responseCount += index + 1;
    candidate.captures[
      index
    ].fixtureDelivery.deliveredAssets[0].responseCount += index + 1;
  }
  const result = validatePairedPerformanceReports({
    baseline,
    candidate,
    expectedAppCommits: {
      baseline: baselineCommit,
      candidate: candidateCommit,
    },
  });
  assert.equal(result.status, 'comparable');
  assert.equal(result.workloadObjective.status, 'not-assessed');
  assert.equal(result.scenarios.idle.changePct, 0);

  const wrongCatalog = structuredClone(candidate);
  const row =
    wrongCatalog.captures[0].austinOperatingClock.selectedLayersAfter.find(
      (entry) => entry.id === 'cctv',
    );
  row.sourcePopulation.sha256 = 'f'.repeat(64);
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate: wrongCatalog,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /Austin report population snapshots differ from the captured clock witness/,
  );

  const badHash = structuredClone(candidate);
  badHash.captures[0].fixtureDelivery.deliveredAssets[0].sha256 = 'f'.repeat(
    64,
  );
  badHash.fixtureDelivery.sampleDocuments[0].delivery.deliveredAssets[0].sha256 =
    'f'.repeat(64);
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate: badHash,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /delivered response hash differs/,
  );

  const missingTile = structuredClone(candidate);
  for (const delivery of [
    missingTile.captures[0].fixtureDelivery,
    missingTile.fixtureDelivery.sampleDocuments[0].delivery,
  ]) {
    delivery.alprTileCoverage.requested.pop();
  }
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate: missingTile,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /required native route tile|per-document response acknowledgments/,
  );

  const missingInstallationIdentity = structuredClone(candidate);
  const missingId =
    missingInstallationIdentity.captures[0].austinOperatingClock.selectedLayersAfter.find(
      (entry) => entry.id === 'military-installations',
    ).sourcePopulation.identityIds[0];
  for (const delivery of [
    missingInstallationIdentity.captures[0].fixtureDelivery,
    missingInstallationIdentity.fixtureDelivery.sampleDocuments[0].delivery,
  ]) {
    const variant = delivery.installations.responseVariants.find((entry) =>
      entry.elementIds.includes(missingId),
    );
    assert.ok(variant);
    variant.elementIds = variant.elementIds.filter((id) => id !== missingId);
    variant.elementCount = variant.elementIds.length;
  }
  assert.throws(
    () =>
      validatePairedPerformanceReports({
        baseline,
        candidate: missingInstallationIdentity,
        expectedAppCommits: {
          baseline: baselineCommit,
          candidate: candidateCommit,
        },
      }),
    /not acknowledged by its delivered response variants/,
  );
});

test('paired Austin ingestion recomputes cleanup from producer-shaped drain records', async () => {
  const input = await makeObservedPairInput();
  const baseline = asPairedReport(input, baselineCommit);
  const validCandidate = asPairedReport(input, candidateCommit);
  assert.equal(
    validatePairedPerformanceReports({
      baseline,
      candidate: validCandidate,
      expectedAppCommits: {
        baseline: baselineCommit,
        candidate: candidateCommit,
      },
    }).status,
    'comparable',
  );

  const mutations = [
    (report) => {
      report.workload.fixtureInterceptionReleases[0].stop.pendingCommandsAfterDrain = 1;
    },
    (report) => {
      report.workload.fixtureInterceptionReleases[0].stop.rejectedDrainOperations = 1;
    },
    (report) => {
      report.workload.fixtureInterceptionReleases[0].interception.interception.drainCommandFailures = 1;
    },
    (report) => {
      delete report.workload.fixtureInterceptionReleases[0].interception
        .interception.pendingAbortSubscriptionsAfterDrain;
    },
    (report) => {
      report.workload.fixtureInterceptionReleases[0].sessionOrdinal += 1;
    },
    (report) => {
      report.workload.fixtureInterceptionReleases[0].documentId =
        'other-document';
    },
    (report) => {
      report.workload.austinOperatingFixtureDocuments[0].disposed = false;
    },
    (report) => {
      report.workload.fixtureInterceptionReleases[0].confirmed = false;
    },
    (report) => {
      report.workload.austinOperatingFixtureDocuments[0].cleanup.confirmed = false;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(validCandidate);
    mutate(candidate);
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
      /Austin fixture interception release is incomplete|cleanup summary differs|release differs/,
    );
  }
});

test('paired Austin validation recomputes raw satellite rows against the pinned TLEs', async () => {
  const baselineInput = await makeObservedPairInput();
  const candidateInput = await makeObservedPairInput();
  const baseline = asPairedReport(baselineInput, baselineCommit);
  const candidate = asPairedReport(candidateInput, candidateCommit);
  const row =
    candidate.captures[0].austinOperatingClock.satelliteSampledEpochs.warmupHeld
      .records[0];
  row.latitude += 0.001;
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
    /does not match|unique epoch/i,
  );
});

test('Austin evidence producer rejects a coherent alternate boundary epoch', async () => {
  const candidateInput = await makeObservedPairInput();
  const candidate = asPairedReport(candidateInput, candidateCommit);
  const sample = candidate.captures[0];
  const evidence =
    sample.austinOperatingClock.satelliteSampledEpochs.warmupHeld;
  const reference = loadAustinSatelliteEpochReference(
    candidate.workload.fixture,
  );
  const olderEpoch = evidence.boundaryEpochMs - 1000;
  const records = [...reference.catalog.values()].map((entry) => {
    const position = ORBITS.propagatePosition(
      twoline2satrec(entry.line1, entry.line2),
      new Date(olderEpoch),
    );
    return {
      id: entry.id,
      longitude: position.longitude,
      latitude: position.latitude,
      altitudeM: position.altitude,
    };
  });
  assert.throws(
    () =>
      deriveAustinSatelliteSampledEpoch({
        reference,
        records,
        boundaryEpochMs: evidence.boundaryEpochMs,
        boundary: evidence.boundary,
        documentRole: sample.documentRole,
        documentId: sample.documentId,
        runOrdinal: sample.austinOperatingClock.runOrdinal,
      }),
    /declared fixture boundary/,
  );
});
