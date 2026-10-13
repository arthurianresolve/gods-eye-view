import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
  assertCaptureCleanupEvidence,
  assertRendererLoopRetirementEvidence,
  assertProviderFixtureCaptureClock,
  buildCaptureCliValidationExpectations,
  compactCaptureCliFailure,
  executeCaptureCliWithReportArtifact,
  parseSmokeArguments,
  preserveCaptureCliReportArtifact,
  respondToSmokeFixtureRequest,
  closeMapSmokeFixtureOwner,
  finalizeMapSmokeFixtureDocument,
  runMapStreamingFaultControlDocument,
  projectMapStreamingFaultBuildEvidence,
  attachFinalizedMapStreamingFailureEvidence,
  attachMapStreamingJourneyFailureEvidence,
  observeSmokeLayerPopulationInPage,
  runNativeMapJourneyForSmoke,
  smokeProviderPreparationMode,
  validateMapSmokeInterceptionRelease,
  validateMapStreamingFaultControlSet,
  validateMapStreamingFaultControlDocument,
  validateMapSmokeLayerPopulation,
  readProviderCpuProfileIndexSet,
  validateAustinOperatingReadinessHistoryEnvelope,
  runBoundedChild,
  validateCaptureCliReport,
  validateRendererBackendEvidence,
  projectMapStreamingJourneyFailureForSmoke,
  projectMapStreamingJourneyValidationFailureForSmoke,
} from './qa-performance-build-smoke.mjs';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
  resolveMapFixtureBuildProfile,
} from './performance/buildProvenance.mjs';
import {
  DEFAULT_CAPTURE_RENDERER_BACKEND,
  NATIVE_MACOS_DIAGNOSTIC_BACKEND,
} from './performance/hostedRendererBackend.mjs';
import { nativeRendererDiagnosticEvidence } from './performance/hostedRendererBackend.mjs';
import { MAP_STREAMING_WORKLOAD_ID } from './performance/mapStreamingWorkloadContract.mjs';
import {
  appendAustinOperatingReadinessHistory,
  createAustinOperatingReadinessHistory,
  createAustinOperatingReadinessHistoryEnvelope,
} from './performance/austinOperatingReadinessHistory.mjs';
import { MAX_CAPTURE_FAILURE_REPORT_BYTES } from './performance/captureFailureReport.mjs';
import {
  createProductionFlightFixture,
  installPhasedMonotonicWallClock,
} from './performance/productionFlightFixture.mjs';
import {
  createCaptureDocumentTopology,
  createObservedDenseComparisonContract,
  createObservedInfrastructureComparisonContract,
  getCaptureComparisonIneligibilityReasons,
} from './performance/captureComparisonContract.mjs';
import { createInfrastructureWorkloadFixture } from './performance/infrastructureWorkloadFixture.mjs';
import { createDeterministicMapStreamingFixture } from './performance/mapStreamingFixture.mjs';
import { createMapStreamingFixtureDelivery } from './performance/mapStreamingFixtureDelivery.mjs';
import {
  projectMapStreamingJourneyFailureEvidence,
  MAP_STREAMING_ROUTE,
  validateMapStreamingFaultControlReport,
  validateMapStreamingSmokeDeliverySummary,
} from './performance/mapStreamingCapture.mjs';
import {
  createWeatherEffectsFixtureDelivery,
  createWeatherEffectsFixtureLifecycle,
  createWeatherEffectsWorkloadFixture,
  WEATHER_EFFECTS_WORKLOAD_ID,
} from './performance/weatherEffectsWorkloadFixture.mjs';
import { createSceneFrameTimingDiagnostics } from './performance/importFrameDiagnostics.mjs';
import {
  boundedShaderProgramAttribution,
  createShaderProgramAttributionEnvelope,
  earlyRendererDocumentHook,
} from './performance/earlyCesiumRendererProbe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_SMOKE_APP_ORIGIN = 'http://127.0.0.1:4173';
const MAP_SMOKE_ARCGIS =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const MAP_SMOKE_GOOGLE = 'https://tile.googleapis.com';
const MAP_SMOKE_TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const MAP_SMOKE_CREDIT = 'https://assets.ion.cesium.com/google-credit.png';
const MAP_SMOKE_GOOGLE_KEY = getMapFixtureBuildProfileGoogleApiKey(
  MAP_FIXTURE_BUILD_PROFILE_ID,
);

function nativeMapSmokeAssetUrl(row) {
  if (row.kind === 'arcgis-mapserver-metadata-json')
    return `${MAP_SMOKE_ARCGIS}?f=json`;
  if (row.kind === 'arcgis-missing-tile-probe-png')
    return `${MAP_SMOKE_ARCGIS}/tile/${row.identity.level}/${row.identity.row}/${row.identity.column}`;
  if (row.kind === 'webmercator-imagery-png') {
    const [, level, column, tileRow] = row.path.match(
      /^imagery\/(\d+)\/(\d+)\/(\d+)\.png$/,
    );
    return `${MAP_SMOKE_ARCGIS}/tile/${level}/${tileRow}/${column}`;
  }
  if (row.kind === 'quantized-mesh-layer-metadata')
    return `${MAP_SMOKE_TERRAIN}/layer.json`;
  if (row.kind === 'quantized-mesh-1.0')
    return `${MAP_SMOKE_TERRAIN}/${row.path.slice('terrain/'.length)}`;
  if (row.kind === '3d-tiles-1.1')
    return `${MAP_SMOKE_GOOGLE}/v1/3dtiles/root.json?key=${MAP_SMOKE_GOOGLE_KEY}`;
  if (row.kind === 'textured-glb')
    return `${MAP_SMOKE_GOOGLE}/v1/tiles/${row.path.slice('tiles/'.length)}?key=${MAP_SMOKE_GOOGLE_KEY}`;
  if (row.kind === 'synthetic-google-credit-placeholder-png')
    return MAP_SMOKE_CREDIT;
  throw new Error(`No native smoke URL for map asset kind ${row.kind}.`);
}

async function acknowledgeNativeMapSmokeFixture(delivery, fixture) {
  const assetsByKind = new Map();
  for (const asset of fixture.manifest.assets)
    if (!assetsByKind.has(asset.kind)) assetsByKind.set(asset.kind, asset);
  const assets = [...assetsByKind.values()];
  let requestSequence = 0;
  for (const asset of assets) {
    const url = nativeMapSmokeAssetUrl(asset);
    const requestId = `smoke-map-${++requestSequence}`;
    const response = await delivery.respond(new URL(url), {
      requestId,
      url: () => url,
      method: () => 'GET',
    });
    assert.ok(response, `Native route resolves ${asset.path}.`);
    assert.equal(
      delivery.onFulfilled({
        requestId,
        url,
        method: 'GET',
        status: response.status,
        bodyBase64: response.body.toString('base64'),
      }),
      true,
    );
  }
  return assets.length;
}
function producerFixtureClock(fixedTime) {
  let time = 0;
  const target = { Date, performance: { now: () => time } };
  installPhasedMonotonicWallClock(Date.parse(fixedTime), 1000, 1000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  clock.startWarmup();
  time = 1200;
  const measurementStart = clock.holdWarmupBoundary();
  clock.startMeasurement();
  time = 2300;
  const end = clock.finishMeasurement();
  return {
    schema: 'gev-provider-fixture-capture-clock/v1',
    fixedTime,
    freshBrowserContext: true,
    appDocumentReinitialized: true,
    measurementStart,
    warmupBoundary: { ...measurementStart },
    end,
    sourceFreshness: 'current',
    freshnessWindowMs: 120_000,
    actualWarmupElapsedMs: measurementStart.warmupNativeElapsedMs,
    measuredWindowElapsedMs: end.measurementNativeElapsedMs,
    measurementPhaseNativeElapsedMs: end.measurementNativeElapsedMs,
    ageAtMeasurementStartMs: 1000,
    ageAtEndMs: 2000,
    configuredMeasurementMs: 1000,
    measurementClockElapsedMs: 1000,
  };
}

test('capture clock validation consumes the actual phased producer and rejects phase/time drift', () => {
  const fixedTime = '2026-10-08T12:00:00.000Z';
  const expected = { fixedTime, warmupMs: 1000, measurementMs: 1000 };
  assert.doesNotThrow(() =>
    assertProviderFixtureCaptureClock(
      producerFixtureClock(fixedTime),
      expected,
    ),
  );
  for (const mutate of [
    (c) => {
      delete c.measurementStart;
      c.start = { startCount: 1 };
    },
    (c) => {
      c.measurementStart.phase = 'measurement';
    },
    (c) => {
      c.measurementStart.measurementStartCount = 1;
    },
    (c) => {
      c.end.measurementStartCount = 2;
    },
    (c) => {
      c.end.phase = 'measurement';
    },
    (c) => {
      c.end.epochMs += 1;
    },
    (c) => {
      c.warmupBoundary.epochMs += 1;
    },
    (c) => {
      c.measurementClockElapsedMs = 999;
    },
    (c) => {
      c.end.measurementMs = 2000;
    },
    (c) => {
      c.measuredWindowElapsedMs = 1;
    },
    (c) => {
      c.freshBrowserContext = false;
    },
    (c) => {
      c.ageAtEndMs = 1;
    },
  ]) {
    const clock = producerFixtureClock(fixedTime);
    mutate(clock);
    assert.throws(() => assertProviderFixtureCaptureClock(clock, expected));
  }
});
const EXPECTED_FIXTURE_SHA256 = createProductionFlightFixture({
  count: 2500,
  fixedTime: '2026-10-08T12:00:00.000Z',
}).sha256;

function produceShaderAttributionFromSerializedHook() {
  let now = 0;
  const program = {};
  const gl = {
    LINK_STATUS: 1,
    RENDERER: 2,
    VENDOR: 3,
    createProgram: () => program,
    linkProgram: () => undefined,
    getProgramParameter: (_program, pname) => pname === 1,
    deleteProgram: () => undefined,
    getContextAttributes: () => ({ antialias: true, depth: true }),
    getExtension: () => null,
    getParameter: (pname) =>
      pname === 2 ? 'Fixture renderer' : 'Fixture vendor',
  };
  class HTMLCanvasElement {
    closest() {
      return {};
    }

    addEventListener() {}

    removeEventListener() {}
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => gl,
  });
  const window = {};
  window.top = window;
  const page = vm.createContext({
    HTMLCanvasElement,
    performance: { now: () => now++ },
    window,
  });
  const serializedHook = vm.runInContext(
    `(${earlyRendererDocumentHook.toString()})`,
    page,
  );
  serializedHook('__proof', true);
  const canvas = new HTMLCanvasElement();
  canvas.closest = () => ({ className: 'cesium-widget' });
  const context = HTMLCanvasElement.prototype.getContext.call(canvas, 'webgl2');
  const created = context.createProgram();
  context.linkProgram(created);
  context.getProgramParameter(created, context.LINK_STATUS);
  const snapshot =
    window.__gevRecoveryEarlyRendererProbe.shaderProgramAttribution.snapshotAndDispose();
  return boundedShaderProgramAttribution(snapshot);
}

function addShaderAttributionToCaptureReport(report) {
  const sourceSnapshot = produceShaderAttributionFromSerializedHook();
  const documents = report.performanceDiagnostics.documents.map(
    (entry, index) => ({
      ...entry,
      documentId: `shader-document-${index + 1}`,
    }),
  );
  report.performanceDiagnostics.documents = documents;
  const cleanupRows = documents.map(({ documentRole, documentId }) => ({
    documentRole,
    documentId,
    confirmed: true,
    document: {
      status: 'confirmed',
      shaderProgramAttribution: structuredClone(sourceSnapshot),
    },
  }));
  report.workload.rendererProbeCleanup = cleanupRows;
  report.workload.rendererProbeCleanupOmittedCount = 0;
  report.workload.performanceAcceptanceEligible = false;
  report.workload.shaderProgramAttribution =
    createShaderProgramAttributionEnvelope(cleanupRows, documents.length);
  report.comparisonReadiness.reasons.push(
    'shader-program-attribution-instrumentation-is-enabled',
  );
  report.comparisonReadiness.reason =
    report.comparisonReadiness.reasons.join('; ');
  return report;
}

test('smoke CLI parser preserves the candidate SHA and output path', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(
    parseSmokeArguments(['--candidate-sha', sha, '--out', 'smoke.json']),
    { candidateSha: sha, out: 'smoke.json' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--candidate-sha',
      sha,
      '--capture-worker-audit-mode',
      'prewarm',
    ]),
    { candidateSha: sha, captureWorkerAuditMode: 'prewarm' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-worker-audit-mode',
      'receipt-only',
      '--provider-fixture',
      'austin-operating-v1',
    ]),
    {
      captureWorkerAuditMode: 'receipt-only',
      providerFixture: 'austin-operating-v1',
    },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-scene-frame-diagnostics',
      'enabled',
      '--provider-fixture',
      'dense-investigation',
    ]),
    { sceneFrameDiagnostics: true, providerFixture: 'dense-investigation' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-scene-frame-diagnostics',
      'enabled',
      '--provider-fixture',
      'austin-operating-v1',
    ]),
    { sceneFrameDiagnostics: true, providerFixture: 'austin-operating-v1' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-first-motion-cpu-profile',
      'enabled',
      '--provider-fixture',
      'dense-investigation',
    ]),
    { firstMotionCpuProfile: true, providerFixture: 'dense-investigation' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-depth-pick-attribution',
      'enabled',
      '--provider-fixture',
      'dense-investigation',
    ]),
    { depthPickAttribution: true, providerFixture: 'dense-investigation' },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-shader-program-attribution',
      'enabled',
      '--provider-fixture',
      'dense-investigation',
    ]),
    {
      shaderProgramAttribution: true,
      providerFixture: 'dense-investigation',
    },
  );
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-shader-program-attribution',
      'disabled',
      '--provider-fixture',
      'dense-investigation',
    ]),
    {
      shaderProgramAttribution: false,
      providerFixture: 'dense-investigation',
    },
  );
  assert.deepEqual(parseSmokeArguments([]), {});
  assert.deepEqual(
    parseSmokeArguments([
      '--capture-renderer-backend',
      NATIVE_MACOS_DIAGNOSTIC_BACKEND,
    ]),
    { captureRendererBackend: NATIVE_MACOS_DIAGNOSTIC_BACKEND },
  );
  assert.throws(
    () => parseSmokeArguments(['--capture-renderer-backend', 'native']),
    /renderer backend is invalid/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-first-motion-cpu-profile',
        'enabled',
        '--provider-fixture',
        'infrastructure-datacenters',
      ]),
    /dense investigation fixture/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-depth-pick-attribution',
        'enabled',
        '--provider-fixture',
        'infrastructure-datacenters',
      ]),
    /dense investigation fixture/,
  );
  assert.throws(
    () => parseSmokeArguments(['--capture-depth-pick-attribution', 'maybe']),
    /enabled or disabled/,
  );
  assert.throws(
    () =>
      parseSmokeArguments(['--capture-shader-program-attribution', 'maybe']),
    /enabled or disabled/,
  );
  assert.throws(
    () =>
      parseSmokeArguments(['--capture-shader-program-attribution', 'enabled']),
    /dense investigation fixture/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-shader-program-attribution',
        'enabled',
        '--provider-fixture',
        'infrastructure-datacenters',
      ]),
    /dense investigation fixture/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-first-motion-cpu-profile',
        'yes',
        '--provider-fixture',
        'dense-investigation',
      ]),
    /enabled or disabled/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-scene-frame-diagnostics',
        'enabled',
        '--provider-fixture',
        'infrastructure-dams',
      ]),
    /dense investigation or Austin operating fixture/,
  );
  assert.throws(
    () => parseSmokeArguments(['--capture-scene-frame-diagnostics', 'maybe']),
    /enabled or disabled/,
  );
  for (const providerFixture of [
    'infrastructure-datacenters',
    'infrastructure-dams',
    'infrastructure-cables',
    'infrastructure',
    WEATHER_EFFECTS_WORKLOAD_ID,
    MAP_STREAMING_WORKLOAD_ID,
  ])
    assert.deepEqual(
      parseSmokeArguments(['--provider-fixture', providerFixture]),
      { providerFixture },
    );
  assert.throws(
    () => parseSmokeArguments(['--candidate-sha', sha, '--unknown', 'x']),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--candidate-sha',
        sha,
        '--capture-worker-audit-mode',
        'guess',
      ]),
    /Worker audit mode/,
  );
  assert.throws(
    () => parseSmokeArguments(['--provider-fixture', 'infrastructure-unknown']),
    /registered workload/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--provider-fixture',
        'infrastructure-datacenters',
        '--capture-worker-audit-mode',
        'prewarm',
      ]),
    /diagnostic worker auditing only/,
  );
  assert.throws(
    () =>
      parseSmokeArguments([
        '--capture-worker-audit-mode',
        'receipt-only',
        '--provider-fixture',
        'dense-investigation',
      ]),
    /Austin operating fixture/,
  );
});

test('capture report renderer validation binds verified evidence to the observed renderer', () => {
  const renderer =
    'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)';
  const nativeEvidence = nativeRendererDiagnosticEvidence({
    renderer,
    vendor: 'Apple Inc.',
    graphics: {
      featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
    },
  });
  const report = {
    environment: { renderer, vendor: 'Apple Inc.' },
    nativeRendererDiagnostic: nativeEvidence,
  };
  assert.equal(
    validateRendererBackendEvidence(report, NATIVE_MACOS_DIAGNOSTIC_BACKEND),
    nativeEvidence,
  );
  assert.equal(validateRendererBackendEvidence({ environment: {} }), true);
  assert.throws(
    () => validateRendererBackendEvidence(report),
    /Expected values to be strictly equal/,
  );
  const missingVendor = structuredClone(report);
  delete missingVendor.environment.vendor;
  assert.throws(
    () =>
      validateRendererBackendEvidence(
        missingVendor,
        NATIVE_MACOS_DIAGNOSTIC_BACKEND,
      ),
    /accelerated graphics/,
  );
  const mismatchedVendor = structuredClone(report);
  mismatchedVendor.environment.vendor = 'Different vendor';
  assert.throws(
    () =>
      validateRendererBackendEvidence(
        mismatchedVendor,
        NATIVE_MACOS_DIAGNOSTIC_BACKEND,
      ),
    /accelerated graphics/,
  );
  const contradictory = structuredClone(report);
  contradictory.environment.renderer = 'Google SwiftShader';
  assert.throws(
    () =>
      validateRendererBackendEvidence(
        contradictory,
        NATIVE_MACOS_DIAGNOSTIC_BACKEND,
      ),
    /accelerated graphics/,
  );
  const disabled = structuredClone(report);
  disabled.nativeRendererDiagnostic.featureStatus.webgl = 'disabled';
  assert.throws(
    () =>
      validateRendererBackendEvidence(
        disabled,
        NATIVE_MACOS_DIAGNOSTIC_BACKEND,
      ),
    /accelerated graphics/,
  );
});

function mapProducerShapedCleanup(topology) {
  const releases = topology.workerAudits.map((document, index) => ({
    ...document,
    sessionOrdinal: index + 1,
    confirmed: true,
    targetClosed: true,
    stop: {
      confirmed: true,
      listenerRemovalConfirmed: true,
      pendingAtStop: 0,
      pendingPreparationAtStop: 0,
      pendingAbortSubscriptionsAtStop: 0,
      pendingCommandsAtStop: 0,
      pendingCommandsAfterDrain: 0,
      pendingPreparationsAfterDrain: 0,
      pendingAbortSubscriptionsAfterDrain: 0,
      rejectedDrainOperations: 0,
      drainCommandFailures: 0,
      unexpectedLateRequestCount: 0,
    },
    interception: {
      confirmed: true,
      interception: {
        confirmed: true,
        listenerRemovalConfirmed: true,
        pendingAtStop: 0,
        pendingPreparationAtStop: 0,
        pendingAbortSubscriptionsAtStop: 0,
        pendingCommandsAtStop: 0,
        pendingCommandsAfterDrain: 0,
        pendingPreparationsAfterDrain: 0,
        pendingAbortSubscriptionsAfterDrain: 0,
        unexpectedLateRequestCount: 0,
        rejectedDrainOperations: 0,
        drainCommandFailures: 0,
      },
      fetchDisable: 'target-closed',
      detach: 'target-closed',
    },
    fetchDisable: 'target-closed',
    detach: 'target-closed',
  }));
  return releases;
}

function createMapCliProducerShape(fixture) {
  const topology = createCaptureDocumentTopology({
    reuseMainDocumentForSamples: true,
    startupRuns: 1,
    captureCount: 4,
  });
  const releases = mapProducerShapedCleanup(topology);
  const documentDeliveries = topology.workerAudits.map((document, index) => ({
    ...document,
    sessionOrdinal: index + 1,
    delivery: {
      status: 'disposed',
      fixtureId: fixture.id,
      manifestSha256: fixture.manifestSha256,
      cleanupConfirmed: true,
      pendingCount: 0,
      errorObservationCount: 0,
    },
    release: releases[index],
  }));
  const fixtureDelivery = {
    schema: 'gev-map-streaming-fixture-delivery/v1',
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    status: 'observed',
    requestedCount: 8,
    fulfilledAckCount: 8,
    cancelledCount: 0,
    pendingCount: 0,
    unexpectedFulfillmentCount: 0,
    errorObservationCount: 0,
    assets: [],
    cleanupConfirmed: true,
    browserDecodeObserved: false,
    renderedReadinessObserved: false,
  };
  const mapCapture = {
    schema: 'gev-map-streaming-capture/v1',
    workloadId: MAP_STREAMING_WORKLOAD_ID,
    status: 'observed',
    performanceAcceptanceEligible: false,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    buildProfile: resolveMapFixtureBuildProfile(MAP_FIXTURE_BUILD_PROFILE_ID),
    fixtureDelivery,
    documentDeliveries,
  };
  const retire = (document, phase, scenario, run) => ({
    ...document,
    phase,
    ...(scenario ? { scenario, run } : {}),
    requested: true,
    status:
      phase === 'startup-final-details'
        ? 'retired-with-final-observation'
        : 'retired-at-final-post-render',
    before: true,
    after: false,
    confirmed: true,
    elapsedMs: 2,
  });
  const captures = topology.samples.map((document, index) => {
    const scenario = index < 2 ? 'idle' : 'scripted-motion';
    const run = (index % 2) + 1;
    return {
      ...document,
      scenario,
      run,
    };
  });
  const rendererProbeCleanup = topology.workerAudits.map((document) => ({
    ...document,
    confirmed: true,
    document: {
      status: 'confirmed',
      statePresent: true,
      hookRestoreAttempted: true,
      hookRestored: true,
      stateDeleted: true,
      listenerCount: 0,
      listenerRemovalFailedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalAttemptedCount: 0,
      renderLoopRetirement: {
        requested: true,
        confirmed: true,
        after: false,
      },
    },
    scriptRegistration: {
      status: 'confirmed',
      errorKind: null,
      verification: 'puppeteer-registration-removal-acknowledged;test',
    },
  }));
  const rendererLoopRetirements = [
    ...topology.workerAudits
      .filter((document) => document.documentRole.startsWith('startup-'))
      .map((document) =>
        retire(document, 'startup-final-details', undefined, undefined),
      ),
  ];
  return {
    topology,
    releases,
    documentDeliveries,
    fixtureDelivery,
    mapCapture,
    captures,
    rendererProbeCleanup,
    rendererLoopRetirements,
  };
}

test('map capture CLI validates the complete producer envelope and rejects outer evidence mutations', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const produced = createMapCliProducerShape(fixture);
  const report = {
    schema: 'gev-performance-capture/v1',
    workerAuditMode: 'diagnostic',
    comparisonEligible: false,
    environment: {
      renderer: 'Google SwiftShader',
      hardwareEligible: false,
    },
    source: {
      appCommit: 'a'.repeat(40),
      harnessCommit: 'b'.repeat(40),
      appWorktreeState: 'clean',
      harnessDirtyWorktree: false,
      provenanceStatus:
        'verified-local-build-and-served-assets-before-and-after',
      buildProvenance: {
        receiptSha256: 'c'.repeat(64),
        pageAssetAudit: {
          workerAuditMode: 'diagnostic',
          scriptRequestCount: 5,
          loadedAssetPaths: ['index.html', 'assets/app.js'],
          unexpectedAssetPaths: [],
          workerAuditDocuments: produced.topology.workerAudits.map(
            (document) => ({
              ...document,
              mode: 'diagnostic',
            }),
          ),
        },
      },
    },
    integrity: { status: 'passed', sampleCount: produced.captures.length },
    comparisonReadiness: {
      status: 'not-ready',
      reasons: [
        'map-streaming-fixture-is-a-diagnostic-not-performance-acceptance',
      ],
    },
    fixtureDelivery: produced.fixtureDelivery,
    workload: {
      providerFixture: MAP_STREAMING_WORKLOAD_ID,
      fixtureId: fixture.id,
      fixture: {
        id: fixture.id,
        sha256: fixture.manifestSha256,
        byteLength: fixture.manifest.totalBytes,
      },
      warmupMs: 1000,
      durationPerSampleMs: 1000,
      runsPerScenario: 2,
      startupRuns: 1,
      scenarios: ['idle', 'scripted-motion'],
      performanceAcceptanceEligible: false,
      mapStreamingCapture: produced.mapCapture,
      mapStreamingFixtureDocuments: produced.documentDeliveries,
      rendererProbeCleanup: produced.rendererProbeCleanup,
      rendererProbeCleanupOmittedCount: 0,
      rendererLoopRetirements: produced.rendererLoopRetirements,
      rendererLoopRetirementsOmittedCount: 0,
      fixtureInterceptionReleases: produced.releases,
    },
    performanceDiagnostics: {
      documents: produced.topology.diagnostics.map((document) => ({
        ...document,
        requested: true,
      })),
    },
    captures: produced.captures,
  };
  const expected = {
    appSha: 'a'.repeat(40),
    harnessSha: 'b'.repeat(40),
    receiptSha256: 'c'.repeat(64),
    providerFixture: MAP_STREAMING_WORKLOAD_ID,
    workerAuditMode: 'diagnostic',
    mapStreamingFixture: fixture,
    mapStreamingBuildProfile: resolveMapFixtureBuildProfile(
      MAP_FIXTURE_BUILD_PROFILE_ID,
    ),
    warmupMs: 1000,
    durationPerSampleMs: 1000,
    validateMapStreamingCapture(observed) {
      assert.equal(observed?.fixtureId, fixture.id);
      assert.equal(observed?.manifestSha256, fixture.manifestSha256);
      assert.deepEqual(observed?.fixtureDelivery, produced.fixtureDelivery);
    },
  };
  assert.equal(
    validateCaptureCliReport(report, expected).comparisonEligible,
    false,
  );

  const mutations = [
    [(copy) => delete copy.source, /app commit/],
    [(copy) => (copy.source.appCommit = 'd'.repeat(40)), /app commit/],
    [(copy) => (copy.source.harnessCommit = 'd'.repeat(40)), /harness commit/],
    [
      (copy) => (copy.source.buildProvenance.receiptSha256 = 'd'.repeat(64)),
      /receipt identity/,
    ],
    [
      (copy) => (copy.source.provenanceStatus = 'unverified'),
      /verified local build/,
    ],
    [
      (copy) => (copy.environment.hardwareEligible = true),
      /ineligible for hardware/,
    ],
    [
      (copy) => (copy.environment.renderer = 'Other renderer'),
      /software-renderer contract/i,
    ],
    [(copy) => (copy.integrity.status = 'failed'), /integrity/],
    [(copy) => copy.captures.pop(), /sampleCount|length/],
    [
      (copy) => delete copy.captures[0].documentId,
      /exact planned main document owner/,
    ],
    [
      (copy) => (copy.captures[0].documentRole = 'provider-sample-1'),
      /exact planned main document owner/,
    ],
    [
      (copy) => delete copy.workload.mapStreamingCapture,
      /Finalized map capture/,
    ],
    [
      (copy) => copy.workload.mapStreamingFixtureDocuments.pop(),
      /exactly cover the observed startup and reused main document owners|exactly match the native map owners/,
    ],
    [
      (copy) =>
        (copy.workload.mapStreamingCapture.documentDeliveries[1].documentId =
          'provider-document-1'),
      /Map fixture deliveries must exactly cover/,
    ],
    [
      (copy) => (copy.fixtureDelivery.fulfilledAckCount += 1),
      /strictly deep-equal/,
    ],
    [
      (copy) => copy.workload.rendererProbeCleanup.pop(),
      /exactly one cleanup record/,
    ],
    [
      (copy) => (copy.workload.rendererProbeCleanup[0].confirmed = false),
      /Renderer probe cleanup/,
    ],
    [
      (copy) => copy.workload.fixtureInterceptionReleases.pop(),
      /exactly cover/,
    ],
    [
      (copy) =>
        copy.source.buildProvenance.pageAssetAudit.workerAuditDocuments.pop(),
      /worker audits must exactly cover/,
    ],
    [
      (copy) =>
        copy.source.buildProvenance.pageAssetAudit.workerAuditDocuments.push(
          structuredClone(
            copy.source.buildProvenance.pageAssetAudit.workerAuditDocuments[1],
          ),
        ),
      /worker audits must exactly cover/,
    ],
    [
      (copy) =>
        (copy.source.buildProvenance.pageAssetAudit.workerAuditDocuments[1].documentRole =
          'provider-sample-1'),
      /worker audits must exactly cover/,
    ],
    [
      (copy) => copy.performanceDiagnostics.documents.pop(),
      /diagnostics must exactly cover/,
    ],
    [
      (copy) =>
        copy.performanceDiagnostics.documents.push(
          structuredClone(copy.performanceDiagnostics.documents[1]),
        ),
      /diagnostics must exactly cover/,
    ],
    [
      (copy) =>
        (copy.performanceDiagnostics.documents[1].documentId =
          'provider-document-1'),
      /diagnostics must exactly cover/,
    ],
    [
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].stop.pendingCommandsAfterDrain = 1),
      /drain pending commands/,
    ],
  ];
  for (const [mutate, pattern] of mutations) {
    const copy = structuredClone(report);
    mutate(copy);
    assert.throws(() => validateCaptureCliReport(copy, expected), pattern);
  }
});

test('smoke fixture responder awaits the native map classifier before flight fallback', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const mapDelivery = createMapStreamingFixtureDelivery(fixture, {
    appOrigin: 'http://127.0.0.1:4173',
  });
  const flightFixture = createProductionFlightFixture({
    count: 2,
    fixedTime: '2026-10-08T12:00:00.000Z',
  });
  const url = 'http://127.0.0.1:4173/api/flights';
  const request = { url: () => url, method: () => 'GET' };
  const response = await respondToSmokeFixtureRequest(new URL(url), request, {
    baseUrl: 'http://127.0.0.1:4173',
    mapStreamingDelivery: mapDelivery,
    flightFixture,
  });
  assert.equal(response?.status, 200);
  assert.equal(response?.body, flightFixture.body);
  assert.equal(mapDelivery.summary().requestedCount, 0);
  mapDelivery.dispose();
});

test('map smoke uses native-only preparation for both exact revisions', async () => {
  assert.equal(
    smokeProviderPreparationMode(MAP_STREAMING_WORKLOAD_ID),
    'native-map-streaming',
  );
  assert.equal(
    smokeProviderPreparationMode('dense-investigation'),
    'dense-provider-fixture',
  );
  assert.equal(
    smokeProviderPreparationMode('weather-effects-v1'),
    'dense-provider-fixture',
  );

  const fixture = {
    id: 'austin-map-streaming-synthetic-v4',
    manifestSha256: 'a'.repeat(64),
  };
  const buildProfile = {
    id: MAP_FIXTURE_BUILD_PROFILE_ID,
    configurationSha256: 'b'.repeat(64),
  };
  const route = { id: 'declared-route', durationLimitMs: 60_000 };
  const calls = [];
  const journey = { route: { id: route.id, elapsedMs: route.durationLimitMs } };
  const mapStreamingCaptureModule = {
    MAP_STREAMING_ROUTE: route,
    async runNativeMapStreamingJourney(page, options) {
      calls.push({ page, options });
      return journey;
    },
    validateMapStreamingJourneyEvidence(actual, actualFixture) {
      assert.equal(actual, journey);
      assert.equal(actualFixture, fixture);
    },
  };
  for (const revision of ['a'.repeat(40), 'c'.repeat(40)]) {
    const page = { revision };
    const report = await runNativeMapJourneyForSmoke({
      page,
      revision,
      fixture,
      buildProfile,
      mapStreamingCaptureModule,
    });
    assert.equal(report.revision, revision);
    assert.equal(report.fixtureId, fixture.id);
    assert.equal(report.manifestSha256, fixture.manifestSha256);
    assert.equal(report.routeId, route.id);
    assert.deepEqual(report.buildProfile, buildProfile);
    assert.equal(report.performanceAcceptanceEligible, false);
  }
  assert.deepEqual(
    calls.map(({ page, options }) => ({
      revision: page.revision,
      durationMs: options.durationMs,
      route: options.route,
    })),
    [
      { revision: 'a'.repeat(40), durationMs: 60_000, route },
      { revision: 'c'.repeat(40), durationMs: 60_000, route },
    ],
  );
  await assert.rejects(
    runNativeMapJourneyForSmoke({
      page: {},
      revision: 'invalid',
      fixture,
      buildProfile,
      mapStreamingCaptureModule,
    }),
    /SHA/i,
  );
  await assert.rejects(
    runNativeMapJourneyForSmoke({
      page: {},
      revision: 'a'.repeat(40),
      fixture,
      buildProfile: { ...buildProfile, id: 'unreceipted-profile' },
      mapStreamingCaptureModule,
    }),
    /strictly equal/,
  );
});

test('outer smoke projects only validated CLI map-journey failure evidence', () => {
  const producerEvidence = projectMapStreamingJourneyFailureEvidence({
    schema: 'gev-map-streaming-journey-failure/v1',
    operationId: 'map-test-1',
    failureCode: 'host-deadline',
    elapsedMs: 151_234,
    expected: { maxElapsedMs: 150_000 },
    checkpoint: {
      phase: 'final-readiness',
      initialReadinessComplete: true,
      transitionCount: 3,
      targetStack: 'photoreal',
      routeElapsedMs: 61_234,
      latestObservation: {
        activeStack: 'photoreal',
        controllerStatus: 'ready',
        switchOrigin: 'manual',
        hasError: false,
        stackAvailable: true,
        globeTilesLoaded: true,
        terrainProviderClass: 'CesiumTerrainProvider',
        imageryLayerCount: 1,
        imageryProviderClass: 'ArcGisMapServerImageryProvider',
        photorealTilesLoaded: true,
        photorealReadyContentTiles: 12,
        photorealSelectedTiles: 9,
        globeQueueDiagnostics: {
          available: true,
          unavailableReason: null,
          queueCounts: { high: 0, medium: 0, low: 0, total: 0 },
          renderedTileCount: 3,
          sampledTiles: [],
          omittedSampledTileCount: 0,
        },
      },
    },
    retirement: {
      cancelStatus: 'acknowledged',
      drainStatus: 'drained',
      drainWaitMs: 4,
      terminalStatus: 'failed',
      disposeStatus: 'confirmed',
      cancelErrorKind: null,
      disposeErrorKind: null,
    },
    extra: { body: 'must not survive projection' },
  });
  const cliFailure = compactCaptureCliFailure({
    schema: 'gev-performance-capture-failure/v1',
    status: 'failed',
    failure: {
      phase: 'austin-map-streaming-route',
      message: 'Map route timed out.',
      actual: producerEvidence.checkpoint,
      expected: { maxElapsedMs: 150_000 },
    },
    workload: { mapStreamingJourneyFailure: producerEvidence },
    progress: {},
  });
  const projected = projectMapStreamingJourneyFailureForSmoke(
    { captureCliFailure: cliFailure },
    { projectMapStreamingJourneyFailureEvidence },
  );
  assert.deepEqual(projected, producerEvidence);
  assert.equal(projected.extra, undefined);
  assert.equal(projected.checkpoint.routeElapsedMs, 61_234);
  assert.deepEqual(projected.expected, { maxElapsedMs: 150_000 });
  assert.equal(
    projected.checkpoint.latestObservation.photorealSelectedTiles,
    9,
  );
  assert.equal(projected.retirement.disposeStatus, 'confirmed');
  assert.equal(
    projected.checkpoint.latestObservation.globeQueueDiagnostics,
    undefined,
  );
  assert.equal(projected.checkpointGlobeQueueDiagnostics.renderedTileCount, 3);
  const outerError = new Error('map journey failed');
  outerError.smokeDiagnostics = { phase: 'map-transition-readiness' };
  attachMapStreamingJourneyFailureEvidence(outerError, projected);
  const outerJson = JSON.parse(JSON.stringify(outerError.smokeDiagnostics));
  assert.equal(
    outerJson.mapStreamingJourneyFailure.checkpointGlobeQueueDiagnostics
      .queueCounts.total,
    0,
  );
  assert.deepEqual(
    projectMapStreamingJourneyFailureForSmoke(
      {
        captureCliFailure: {
          rawReport: {
            workload: {
              mapStreamingJourneyFailure: {
                schema: 'gev-map-streaming-journey-failure/v1',
                status: 'failed',
                body: 'unvalidated payload',
              },
            },
          },
        },
      },
      { projectMapStreamingJourneyFailureEvidence },
    ),
    {
      schema: 'gev-map-streaming-journey-failure/v1',
      status: 'invalid',
      reasonCode: 'invalid-envelope',
    },
  );
});

test('map smoke records real layer defaults and requires them to stay stable', () => {
  const pageLayers = [
    { id: 'imagery-control', enabled: true, stats: { count: 1 } },
    { id: 'satellites', enabled: false, stats: { count: 0 } },
  ];
  const observed = vm.runInNewContext(
    `(${observeSmokeLayerPopulationInPage.toString()})()`,
    {
      window: {
        __godsEyeView: {
          dataManager: {
            getAll: () => pageLayers,
            isEnabled: (id) =>
              pageLayers.find((layer) => layer.id === id).enabled,
          },
        },
      },
    },
  );
  const normalized = JSON.parse(JSON.stringify(observed));
  const evidence = validateMapSmokeLayerPopulation(normalized, normalized);
  assert.deepEqual(evidence.enabledLayerIds, ['imagery-control']);
  assert.match(
    evidence.scope,
    /does not assume all non-map layers are disabled/,
  );
  assert.throws(
    () =>
      validateMapSmokeLayerPopulation(normalized, [
        { ...normalized[0], enabled: false },
        normalized[1],
      ]),
    /preserve the application’s observed layer selection/,
  );
});

test('outer map smoke requires the exact candidate fault-control document set', () => {
  const revision = 'a'.repeat(40);
  const scenarioIds = [
    'esri-metadata-missing-v1',
    'esri-metadata-corrupt-v1',
    'esri-metadata-superseded-v1',
  ];
  const cleanDrain = {
    schema: 'gev-fixture-interception-drain/v1',
    listenerRemovalConfirmed: true,
    pendingAtStop: 0,
    pendingPreparationAtStop: 0,
    pendingAbortSubscriptionsAtStop: 0,
    pendingCommandsAtStop: 0,
    pendingCommandsAfterDrain: 0,
    pendingPreparationsAfterDrain: 0,
    pendingAbortSubscriptionsAfterDrain: 0,
    rejectedDrainOperations: 0,
    drainCommandFailures: 0,
    cancelledPreparationCount: 0,
    unexpectedLateRequestCount: 0,
    confirmed: true,
  };
  const documents = scenarioIds.map((scenarioId) => {
    const documentId = `candidate-${revision.slice(0, 8)}-map-fault-${scenarioId}`;
    const delivery = { schema: 'fixture-fault-summary', scenarioId };
    const harnessCommit = 'b'.repeat(40);
    const buildEvidence = {
      schema: 'gev-map-fault-build-evidence/v1',
      appCommit: revision,
      harnessCommit,
      receiptSha256: 'c'.repeat(64),
      buildProfile: {
        id: MAP_FIXTURE_BUILD_PROFILE_ID,
        configurationSha256: 'f'.repeat(64),
      },
      assetCount: 120,
      totalAssetBytes: 4_000_000,
      fixtureId: 'fixture-test',
      fixtureManifestSha256: 'd'.repeat(64),
    };
    return {
      schema: 'gev-map-streaming-fault-document/v1',
      status: 'passed',
      scenarioId,
      revision,
      harnessCommit,
      sourceIdentity: { appCommit: revision, harnessCommit },
      buildEvidence,
      documentRole: 'candidate-map-fault-control',
      documentId,
      performanceAcceptanceEligible: false,
      pageErrors: [],
      preflight: { status: 'closed' },
      rendererEvidence: {
        schema: 'gev-map-fault-renderer-evidence/v1',
        backend: DEFAULT_CAPTURE_RENDERER_BACKEND,
        observedRenderer: 'Google SwiftShader',
        observedVendor: null,
        appCommit: revision,
        drawingBuffer: { width: 1440, height: 900 },
      },
      workerEvidence: {
        schema: 'gev-map-fault-worker-evidence/v1',
        status: 'receipt-derived-worker-blobs-validated',
        auditMode: 'diagnostic',
        embeddedWorkerSourceSha256: 'e'.repeat(64),
        workerTargetCount: 0,
        observedBlobCount: 1,
        validatedWorkerCount: 0,
        validatedCreatedWrapperCount: 0,
        createdScriptBlobCount: 1,
        readBytes: 24,
        maxRetainedBytes: 32 * 1024 * 1024,
        overflowCount: 0,
        restoration: {
          nativeCreateObjectURLRestored: true,
          registryEmpty: true,
          overflowCountAtRestore: 0,
        },
      },
      rendererProbeCleanup: {
        confirmed: true,
        document: { renderLoopRetirement: { confirmed: true } },
      },
      interceptionRelease: {
        schema: 'gev-map-smoke-interception-release/v1',
        documentRole: 'candidate-map-fault-control',
        documentId,
        contextCloseStatus: 'closed',
        targetClosed: true,
        release: {
          schema: 'gev-fixture-interception-release/v1',
          fetchDisable: 'target-closed',
          detach: 'target-closed',
          interception: cleanDrain,
          confirmed: true,
        },
        confirmed: true,
      },
      delivery,
      control: {
        scenarioId,
        delivery,
      },
    };
  });
  const fixture = { id: 'fixture-test', manifestSha256: 'd'.repeat(64) };
  const captureModule = {
    validateMapStreamingFaultControlReport(report, expectedFixture) {
      assert.equal(expectedFixture, fixture);
      assert.equal(report.scenarioId, report.delivery.scenarioId);
      return true;
    },
  };
  const roundTrip = JSON.parse(JSON.stringify(documents));
  assert.equal(
    validateMapStreamingFaultControlSet(roundTrip, {
      label: 'candidate',
      revision,
      harnessCommit: documents[0].harnessCommit,
      buildEvidence: documents[0].buildEvidence,
      expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedRenderer: 'Google SwiftShader',
      expectedVendor: null,
      expectedWorkerSourceSha256: 'e'.repeat(64),
      fixture,
      captureModule,
    }),
    true,
  );
  assert.equal(
    validateMapStreamingFaultControlSet([], {
      label: 'baseline',
      revision,
      fixture,
      captureModule,
    }),
    true,
  );
  for (const mutate of [
    (copy) => copy.pop(),
    (copy) => {
      copy[1].documentId = 'candidate-foreign-map-fault';
    },
    (copy) => {
      copy[1].revision = '0'.repeat(40);
    },
    (copy) => {
      copy[0].scenarioId = 'esri-metadata-corrupt-v1';
    },
    (copy) => {
      copy[2].interceptionRelease.targetClosed = false;
    },
    (copy) => {
      copy[1].control.delivery.scenarioId = 'other-scenario';
    },
  ]) {
    const altered = structuredClone(roundTrip);
    mutate(altered);
    assert.throws(() =>
      validateMapStreamingFaultControlSet(altered, {
        label: 'candidate',
        revision,
        harnessCommit: roundTrip[0].harnessCommit,
        buildEvidence: roundTrip[0].buildEvidence,
        expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
        expectedRenderer: 'Google SwiftShader',
        expectedVendor: null,
        expectedWorkerSourceSha256: 'e'.repeat(64),
        fixture,
        captureModule,
      }),
    );
  }
  assert.throws(() =>
    validateMapStreamingFaultControlSet(roundTrip, {
      label: 'baseline',
      revision,
      fixture,
      captureModule,
    }),
  );
});

test('fault-control build projection uses the local build receipt asset and profile fields', () => {
  const appCommit = 'a'.repeat(40);
  const harnessCommit = 'b'.repeat(40);
  const fixture = {
    id: 'austin-map-streaming-synthetic-v4',
    manifestSha256: 'c'.repeat(64),
  };
  const receipt = {
    schema: 'gev-build-provenance/v1',
    receiptSha256: 'd'.repeat(64),
    source: { commit: appCommit, worktree: 'clean' },
    harness: { commit: harnessCommit, worktree: 'clean' },
    buildRecipe: {
      mapFixtureProfile: {
        id: MAP_FIXTURE_BUILD_PROFILE_ID,
        configurationSha256: 'e'.repeat(64),
      },
    },
    assets: [
      { path: 'index.html', bytes: 120, sha256: '1'.repeat(64) },
      { path: 'assets/app.js', bytes: 480, sha256: '2'.repeat(64) },
    ],
    assetCount: 2,
    totalAssetBytes: 600,
  };
  const projected = projectMapStreamingFaultBuildEvidence({
    receipt,
    appCommit,
    harnessCommit,
    fixture,
  });
  assert.deepEqual(projected, {
    schema: 'gev-map-fault-build-evidence/v1',
    appCommit,
    harnessCommit,
    receiptSha256: receipt.receiptSha256,
    buildProfile: receipt.buildRecipe.mapFixtureProfile,
    assetCount: 2,
    totalAssetBytes: 600,
    fixtureId: fixture.id,
    fixtureManifestSha256: fixture.manifestSha256,
  });
  assert.throws(
    () =>
      projectMapStreamingFaultBuildEvidence({
        receipt: {
          ...receipt,
          assets: receipt.assets.map(({ path, sha256 }) => ({
            path,
            sha256,
            byteLength: 300,
          })),
        },
        appCommit,
        harnessCommit,
        fixture,
      }),
    /asset\?\.bytes/,
  );
  assert.throws(
    () =>
      projectMapStreamingFaultBuildEvidence({
        receipt: { ...receipt, totalAssetBytes: 601 },
        appCommit,
        harnessCommit,
        fixture,
      }),
    /strictly equal/,
  );
});

test('outer fault document retains a real held delivery failure and closes its owned context', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const scenarioId = 'esri-metadata-superseded-v1';
  const baseUrl = MAP_SMOKE_APP_ORIGIN;
  const revision = 'a'.repeat(40);
  const harnessCommit = 'b'.repeat(40);
  const buildEvidence = {
    schema: 'gev-map-fault-build-evidence/v1',
    appCommit: revision,
    harnessCommit,
    receiptSha256: 'c'.repeat(64),
    buildProfile: {
      id: MAP_FIXTURE_BUILD_PROFILE_ID,
      configurationSha256: 'f'.repeat(64),
    },
    assetCount: 120,
    totalAssetBytes: 4_000_000,
    fixtureId: fixture.id,
    fixtureManifestSha256: fixture.manifestSha256,
  };
  const metadataUrl = `${MAP_SMOKE_ARCGIS}?f=json`;
  const page = new EventEmitter();
  let closed = false;
  page.setDefaultTimeout = () => {};
  page.setDefaultNavigationTimeout = () => {};
  page.setViewport = async () => {};
  page.setCacheEnabled = async () => {};
  page.setBypassServiceWorker = async () => {};
  page.evaluateOnNewDocument = async () => {};
  page.goto = async () => ({ status: () => 200 });
  page.waitForFunction = async () => {};
  page.workers = () => [];
  page.evaluate = async () => ({
    nativeCreateObjectURLRestored: true,
    registryEmpty: true,
    overflowCountAtRestore: 0,
  });
  page.isClosed = () => closed;
  const context = {
    async newPage() {
      return page;
    },
    async close() {
      closed = true;
    },
  };
  const browser = {
    createBrowserContext: async () => context,
    targets: () => [],
  };
  let releaseCalls = 0;
  let pendingDelivery = null;
  const cleanDrain = {
    schema: 'gev-fixture-interception-drain/v1',
    listenerRemovalConfirmed: true,
    pendingAtStop: 1,
    pendingPreparationAtStop: 0,
    pendingAbortSubscriptionsAtStop: 0,
    pendingCommandsAtStop: 1,
    pendingCommandsAfterDrain: 0,
    pendingPreparationsAfterDrain: 0,
    pendingAbortSubscriptionsAfterDrain: 0,
    rejectedDrainOperations: 0,
    drainCommandFailures: 0,
    cancelledPreparationCount: 0,
    unexpectedLateRequestCount: 0,
    confirmed: true,
  };
  const faultCaptureModule = {
    validateMapStreamingFaultControlReport,
    async runNativeMapStreamingFaultControl(targetPage, { delivery: owner }) {
      const requestId = 'outer-held-request-1';
      pendingDelivery = Promise.resolve(
        targetPage.fixtureRespond(new URL(metadataUrl), {
          requestId,
          url: () => metadataUrl,
          method: () => 'GET',
        }),
      );
      pendingDelivery.catch(() => {});
      await owner.waitForFaultRequest({ timeoutMs: 1_000 });
      const error = new Error(
        'Held Esri response was retired by outer failure.',
      );
      error.mapFaultControl = {
        schema: 'gev-map-streaming-fault-control/v1',
        status: 'failed',
        operationId: 'map-fault-outer-held-test',
        scenarioId,
        routeId: MAP_STREAMING_ROUTE.id,
        performanceAcceptanceEligible: false,
        delivery: owner.summary(),
      };
      throw error;
    },
  };
  let observedDocument;
  await assert.rejects(
    runMapStreamingFaultControlDocument({
      browser,
      baseUrl,
      fixture,
      flightFixture: createProductionFlightFixture(),
      captureModule: faultCaptureModule,
      createDelivery: createMapStreamingFixtureDelivery,
      route: MAP_STREAMING_ROUTE,
      scenarioId,
      revision,
      harnessCommit,
      buildEvidence,
      rendererBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedRenderer: 'Google SwiftShader',
      expectedVendor: null,
      browserGraphics: null,
      workerContract: {
        schema: 'gev-cesium-embedded-worker-contract/v1',
        workerSourceSha256: 'e'.repeat(64),
        embeddedWorkerSource: 'self.postMessage({ready:true});',
        allowedModuleIds: ['Core/Test'],
      },
      startedAt: Date.now(),
      budgetMs: 60_000,
      documentId: `candidate-${revision.slice(0, 8)}-map-fault-${scenarioId}`,
      preparePageImpl: async (_browser, _baseUrl, options) => {
        page.fixtureRespond = options.respond;
        return {
          page,
          errors: [],
          interception: {
            async releaseSession({ targetClosed }) {
              releaseCalls += 1;
              assert.equal(targetClosed, true);
              return {
                schema: 'gev-fixture-interception-release/v1',
                fetchDisable: 'target-closed',
                detach: 'target-closed',
                interception: cleanDrain,
                confirmed: true,
              };
            },
          },
        };
      },
      preflightImpl: async () => ({ status: 'passed' }),
      waitForTargetsImpl: async () => ({ closed: true, remainingCount: 0 }),
      installRendererProbeImpl: async () => 'owned-renderer-hook',
      cleanupRendererProbeImpl: async () => ({
        confirmed: true,
        document: { renderLoopRetirement: { confirmed: true } },
      }),
      cleanupPageDiagnosticsImpl: async () => {},
      readRendererImpl: () => {},
      readWorkerBodiesImpl: async () => null,
    }),
    (error) => {
      observedDocument = error.mapStreamingFaultDocument;
      assert.match(error.message, /Held Esri response was retired/);
      return true;
    },
  );
  await pendingDelivery.catch(() => {});
  assert.equal(closed, true);
  assert.equal(releaseCalls, 1);
  assert.equal(observedDocument?.status, 'failed');
  assert.equal(observedDocument?.performanceAcceptanceEligible, false);
  assert.equal(observedDocument?.interceptionRelease?.confirmed, true);
  assert.equal(observedDocument?.delivery?.status, 'disposed');
  assert.equal(observedDocument?.delivery?.cleanupConfirmed, false);
  assert.equal(observedDocument?.delivery?.pendingCount, 0);
  assert.equal(observedDocument?.control?.delivery, observedDocument?.delivery);
  assert.throws(
    () =>
      validateMapStreamingFaultControlReport(observedDocument.control, fixture),
    /observed|failed/,
  );
  assert.throws(
    () =>
      validateMapStreamingFaultControlDocument(observedDocument, {
        fixture,
        captureModule: faultCaptureModule,
        expectedRevision: revision,
        expectedHarnessCommit: harnessCommit,
        expectedBuildEvidence: buildEvidence,
        expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
        expectedRenderer: 'Google SwiftShader',
        expectedVendor: null,
        expectedWorkerSourceSha256: 'e'.repeat(64),
        expectedDocumentId: `candidate-${revision.slice(0, 8)}-map-fault-${scenarioId}`,
      }),
    /passed/,
  );
  assert.throws(() =>
    validateMapStreamingFaultControlSet([observedDocument, {}, {}], {
      label: 'candidate',
      revision,
      harnessCommit,
      buildEvidence,
      expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedRenderer: 'Google SwiftShader',
      expectedVendor: null,
      expectedWorkerSourceSha256: 'e'.repeat(64),
      fixture,
      captureModule: faultCaptureModule,
    }),
  );
});

test('outer fault document bounds a hung journey and closes ownership before page cleanup', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const scenarioId = 'esri-metadata-superseded-v1';
  const revision = 'a'.repeat(40);
  const harnessCommit = 'b'.repeat(40);
  const buildEvidence = {
    schema: 'gev-map-fault-build-evidence/v1',
    appCommit: revision,
    harnessCommit,
    receiptSha256: 'c'.repeat(64),
    buildProfile: {
      id: MAP_FIXTURE_BUILD_PROFILE_ID,
      configurationSha256: 'f'.repeat(64),
    },
    assetCount: 120,
    totalAssetBytes: 4_000_000,
    fixtureId: fixture.id,
    fixtureManifestSha256: fixture.manifestSha256,
  };
  const page = new EventEmitter();
  const lifecycle = [];
  let closed = false;
  let cleanupPageCalls = 0;
  let pageEvaluateCalls = 0;
  page.setDefaultTimeout = () => {};
  page.setDefaultNavigationTimeout = () => {};
  page.setViewport = async () => {};
  page.setCacheEnabled = async () => {};
  page.setBypassServiceWorker = async () => {};
  page.evaluateOnNewDocument = async () => {};
  page.goto = async () => ({ status: () => 200 });
  page.waitForFunction = async () => {};
  page.workers = () => [];
  page.evaluate = async () => {
    pageEvaluateCalls += 1;
    return {
      nativeCreateObjectURLRestored: true,
      registryEmpty: true,
      overflowCountAtRestore: 0,
    };
  };
  page.isClosed = () => closed;
  const context = {
    async newPage() {
      return page;
    },
    async close() {
      lifecycle.push('context-close');
      closed = true;
    },
  };
  const browser = {
    createBrowserContext: async () => context,
    targets: () => [],
  };
  const captureModule = {
    async runNativeMapStreamingFaultControl() {
      return new Promise(() => {});
    },
  };
  const interception = {
    async releaseSession({ targetClosed }) {
      lifecycle.push('interception-release');
      assert.equal(targetClosed, true);
      return {
        schema: 'gev-fixture-interception-release/v1',
        fetchDisable: 'target-closed',
        detach: 'target-closed',
        interception: {
          schema: 'gev-fixture-interception-drain/v1',
          listenerRemovalConfirmed: true,
          pendingAtStop: 0,
          pendingPreparationAtStop: 0,
          pendingAbortSubscriptionsAtStop: 0,
          pendingCommandsAtStop: 0,
          pendingCommandsAfterDrain: 0,
          pendingPreparationsAfterDrain: 0,
          pendingAbortSubscriptionsAfterDrain: 0,
          rejectedDrainOperations: 0,
          drainCommandFailures: 0,
          cancelledPreparationCount: 0,
          unexpectedLateRequestCount: 0,
          confirmed: true,
        },
        confirmed: true,
      };
    },
  };
  let observedDocument;
  await assert.rejects(
    runMapStreamingFaultControlDocument({
      browser,
      baseUrl: MAP_SMOKE_APP_ORIGIN,
      fixture,
      flightFixture: createProductionFlightFixture(),
      captureModule,
      createDelivery: createMapStreamingFixtureDelivery,
      route: MAP_STREAMING_ROUTE,
      scenarioId,
      revision,
      harnessCommit,
      buildEvidence,
      rendererBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedBackend: DEFAULT_CAPTURE_RENDERER_BACKEND,
      expectedRenderer: 'Google SwiftShader',
      expectedVendor: null,
      browserGraphics: null,
      workerContract: {
        schema: 'gev-cesium-embedded-worker-contract/v1',
        workerSourceSha256: 'e'.repeat(64),
        embeddedWorkerSource: 'self.postMessage({ready:true});',
        allowedModuleIds: ['Core/Test'],
      },
      startedAt: Date.now(),
      budgetMs: 15_200,
      documentId: `candidate-${revision.slice(0, 8)}-map-fault-${scenarioId}`,
      preparePageImpl: async (_browser, _baseUrl, options) => {
        page.fixtureRespond = options.respond;
        return { page, errors: [], interception };
      },
      preflightImpl: async () => ({ status: 'passed' }),
      waitForTargetsImpl: async () => ({ closed: true, remainingCount: 0 }),
      installRendererProbeImpl: async () => 'owned-renderer-hook',
      cleanupRendererProbeImpl: async () => {
        lifecycle.push('renderer-cleanup');
        return {
          confirmed: true,
          document: { renderLoopRetirement: { confirmed: true } },
        };
      },
      cleanupPageDiagnosticsImpl: async () => {
        cleanupPageCalls += 1;
      },
      readRendererImpl: () => {},
      readWorkerBodiesImpl: async () => null,
    }),
    (error) => {
      observedDocument = error.mapStreamingFaultDocument;
      assert.match(error.message, /Map fault control journey timed out/);
      return true;
    },
  );
  assert.equal(closed, true);
  assert.deepEqual(lifecycle, ['context-close', 'interception-release']);
  assert.equal(cleanupPageCalls, 0);
  assert.equal(pageEvaluateCalls, 0);
  assert.equal(observedDocument?.status, 'failed');
  assert.equal(observedDocument?.interceptionRelease?.confirmed, true);
  assert.equal(observedDocument?.delivery?.status, 'disposed');
  assert.equal(observedDocument?.delivery?.pendingCount, 0);
});

test('map owner closes its target before draining pending interception and catches late callbacks', async () => {
  for (const injectLateRequest of [false, true]) {
    const client = new EventEmitter();
    let resolveFulfill;
    let signalFulfillStarted;
    const fulfillStarted = new Promise((resolve) => {
      signalFulfillStarted = resolve;
    });
    client.send = (method) => {
      if (method === 'Fetch.enable') return Promise.resolve();
      if (method === 'Fetch.fulfillRequest') {
        signalFulfillStarted();
        return new Promise((resolve) => {
          resolveFulfill = resolve;
        });
      }
      return Promise.resolve();
    };
    let targetClosed = false;
    const interceptionOwner = await interceptFixtureSession(
      client,
      'http://127.0.0.1:4173',
      async () => ({ status: 200, contentType: 'text/plain', body: 'ok' }),
      () => {},
    );
    const interception = {
      ...interceptionOwner,
      async releaseSession(options) {
        assert.equal(
          targetClosed,
          true,
          'release follows actual target closure',
        );
        return interceptionOwner.releaseSession(options);
      },
    };
    const fixturePage = { interception };
    const page = { isClosed: () => targetClosed };
    const context = {
      async close() {
        targetClosed = true;
      },
    };
    const requestEvent = {
      requestId: 'map-smoke-request',
      request: {
        url: 'http://127.0.0.1:4173/api/map-fixture-test',
        method: 'GET',
        postData: null,
      },
    };
    client.emit('Fetch.requestPaused', requestEvent);
    await fulfillStarted;
    const staleListener = client.listeners('Fetch.requestPaused')[0];
    const closePromise = closeMapSmokeFixtureOwner({
      context,
      page,
      fixturePage,
      documentRole: 'smoke-variant',
      documentId: `candidate-${'a'.repeat(40)}`,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(targetClosed, true);
    assert.equal(client.listenerCount('Fetch.requestPaused'), 0);
    if (injectLateRequest)
      await staleListener({
        ...requestEvent,
        requestId: 'late-map-smoke-request',
      });
    let closeComplete = false;
    closePromise.then(() => {
      closeComplete = true;
    });
    await Promise.resolve();
    assert.equal(closeComplete, false, 'release waits for the pending command');
    resolveFulfill();
    const evidence = await closePromise;
    assert.equal(evidence.targetClosed, true);
    if (injectLateRequest) {
      assert.equal(evidence.confirmed, false);
      assert.equal(evidence.release.interception.unexpectedLateRequestCount, 1);
      assert.throws(
        () =>
          validateMapSmokeInterceptionRelease(evidence, {
            documentRole: 'smoke-variant',
            documentId: `candidate-${'a'.repeat(40)}`,
          }),
        /unexpectedLateRequestCount/,
      );
    } else {
      assert.equal(evidence.confirmed, true);
      assert.equal(evidence.release.interception.pendingCommandsAtStop, 1);
      assert.equal(evidence.release.interception.pendingCommandsAfterDrain, 0);
      assert.equal(
        validateMapSmokeInterceptionRelease(evidence, {
          documentRole: 'smoke-variant',
          documentId: `candidate-${'a'.repeat(40)}`,
        }),
        true,
      );
    }
  }
});

test('baseline and candidate map orchestration finalize delivery after target release', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const runFinalization = async ({ label, injectLateRequest }) => {
    const events = [];
    const delivery = createMapStreamingFixtureDelivery(fixture, {
      appOrigin: MAP_SMOKE_APP_ORIGIN,
    });
    const acknowledgedAssetCount = await acknowledgeNativeMapSmokeFixture(
      delivery,
      fixture,
    );

    const client = new EventEmitter();
    let resolveFulfill;
    let notifyFulfillStarted;
    const fulfillStarted = new Promise((resolve) => {
      notifyFulfillStarted = resolve;
    });
    client.send = (method) => {
      if (method === 'Fetch.enable') return Promise.resolve();
      if (method === 'Fetch.fulfillRequest') {
        notifyFulfillStarted();
        return new Promise((resolve) => {
          resolveFulfill = resolve;
        });
      }
      return Promise.resolve();
    };
    let targetClosed = false;
    let releaseComplete = false;
    const owner = await interceptFixtureSession(
      client,
      MAP_SMOKE_APP_ORIGIN,
      async (url, request) =>
        (await delivery.respond(url, request)) ?? {
          status: 503,
          contentType: 'application/json',
          body: '{}',
        },
      () => {},
      { onFulfilled: delivery.onFulfilled },
    );
    const fixturePage = {
      interception: {
        ...owner,
        async releaseSession(options) {
          const evidence = await owner.releaseSession(options);
          events.push('interception-released');
          releaseComplete = true;
          return evidence;
        },
      },
    };
    const page = { isClosed: () => targetClosed };
    const context = {
      async close() {
        events.push('target-closed');
        targetClosed = true;
      },
    };
    const requestEvent = {
      requestId: `${label}-pending-request`,
      request: {
        url: `${MAP_SMOKE_APP_ORIGIN}/api/map-smoke-cleanup`,
        method: 'GET',
        postData: null,
      },
    };
    client.emit('Fetch.requestPaused', requestEvent);
    await fulfillStarted;
    const staleListener = client.listeners('Fetch.requestPaused')[0];
    const deliveryOwner = {
      dispose() {
        assert.equal(releaseComplete, true);
        events.push('delivery-disposed');
        return delivery.dispose();
      },
    };
    const finalizationPromise = finalizeMapSmokeFixtureDocument({
      context,
      page,
      fixturePage,
      delivery: deliveryOwner,
      fixture,
      captureModule: { validateMapStreamingSmokeDeliverySummary },
      documentRole: 'smoke-variant',
      documentId: `${label}-${'a'.repeat(40)}`,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(targetClosed, true);
    assert.equal(client.listenerCount('Fetch.requestPaused'), 0);
    if (injectLateRequest)
      await staleListener({
        ...requestEvent,
        requestId: `${label}-late-request`,
      });
    resolveFulfill();
    const finalized = await finalizationPromise;
    assert.deepEqual(events, [
      'target-closed',
      'interception-released',
      'delivery-disposed',
    ]);
    assert.equal(
      finalized.deliveryEvidence.fulfilledAckCount,
      acknowledgedAssetCount,
    );
    assert.equal(finalized.deliveryEvidence.cleanupConfirmed, true);
    const failedSmoke = new Error('controlled post-journey failure');
    failedSmoke.smokeDiagnostics = { phase: 'native-map-transition' };
    attachFinalizedMapStreamingFailureEvidence(failedSmoke, {
      fixture,
      deliveryEvidence: {
        ...finalized.deliveryEvidence,
        untrustedExtra: { privatePayload: 'must not be copied' },
      },
      interceptionRelease: finalized.interceptionRelease,
    });
    const serializedFailure = JSON.parse(
      JSON.stringify(failedSmoke.smokeDiagnostics),
    );
    assert.equal(
      serializedFailure.mapStreamingFixtureSetup.delivery.fulfilledAckCount,
      acknowledgedAssetCount,
    );
    assert.equal(
      serializedFailure.mapStreamingFixtureSetup.delivery.cleanupConfirmed,
      true,
    );
    assert.equal(
      serializedFailure.mapStreamingInterceptionRelease.targetClosed,
      true,
    );
    assert.equal(
      serializedFailure.mapStreamingFixtureSetup.comparisonEligible,
      false,
    );
    assert.equal(
      serializedFailure.mapStreamingFixtureSetup.delivery.untrustedExtra,
      undefined,
    );
    const partialDelivery = createMapStreamingFixtureDelivery(fixture, {
      appOrigin: MAP_SMOKE_APP_ORIGIN,
    });
    await partialDelivery.respond(
      new URL('https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json'),
      {
        requestId: 'partial-layer-json',
        url: () =>
          'https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json',
        method: () => 'GET',
      },
    );
    const pendingFailure = new Error('map request still pending');
    pendingFailure.smokeDiagnostics = { phase: 'native-map-transition' };
    attachFinalizedMapStreamingFailureEvidence(pendingFailure, {
      fixture,
      deliveryEvidence: partialDelivery.summary(),
      interceptionRelease: finalized.interceptionRelease,
    });
    const pendingProjection =
      pendingFailure.smokeDiagnostics.mapStreamingFixtureSetup.delivery;
    assert.equal(pendingProjection.status, 'active');
    assert.equal(pendingProjection.pendingCount, 1);
    assert.equal(pendingProjection.cleanupConfirmed, false);
    const cancelledSummary = partialDelivery.dispose();
    const cancelledFailure = new Error('cancelled map setup');
    cancelledFailure.smokeDiagnostics = { phase: 'native-map-transition' };
    attachFinalizedMapStreamingFailureEvidence(cancelledFailure, {
      fixture,
      deliveryEvidence: cancelledSummary,
      interceptionRelease: finalized.interceptionRelease,
    });
    const cancelledProjection =
      cancelledFailure.smokeDiagnostics.mapStreamingFixtureSetup.delivery;
    assert.equal(cancelledProjection.status, 'disposed');
    assert.equal(cancelledProjection.requestedCount, 1);
    assert.equal(cancelledProjection.fulfilledAckCount, 0);
    assert.equal(cancelledProjection.cancelledCount, 1);
    assert.equal(cancelledProjection.assets[0].pendingCount, 0);
    assert.equal(cancelledProjection.cleanupConfirmed, true);

    const erroredDelivery = createMapStreamingFixtureDelivery(fixture, {
      appOrigin: MAP_SMOKE_APP_ORIGIN,
    });
    await assert.rejects(
      erroredDelivery.respond(
        new URL(
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/01/0/0',
        ),
        {
          url: () =>
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/01/0/0',
          method: () => 'GET',
        },
      ),
    );
    await assert.rejects(
      erroredDelivery.respond(
        new URL('https://tile.openstreetmap.org/99/0/42.png'),
        {
          url: () => 'https://tile.openstreetmap.org/99/0/42.png',
          method: () => 'GET',
        },
      ),
      /native-asset-not-in-manifest/,
    );
    const erroredSummary = erroredDelivery.dispose();
    const erroredFailure = new Error('preserve original failure');
    erroredFailure.smokeDiagnostics = { message: erroredFailure.message };
    attachFinalizedMapStreamingFailureEvidence(erroredFailure, {
      fixture,
      deliveryEvidence: erroredSummary,
      interceptionRelease: finalized.interceptionRelease,
    });
    const erroredProjection =
      erroredFailure.smokeDiagnostics.mapStreamingFixtureSetup.delivery;
    assert.equal(erroredFailure.message, 'preserve original failure');
    assert.equal(erroredProjection.cleanupConfirmed, false);
    assert.equal(erroredProjection.errorObservationCount, 2);
    assert.equal(erroredProjection.errors.length, 2);
    assert.equal(erroredProjection.errors[0].code, 'arcgis-route-invalid');
    assert.deepEqual(erroredProjection.missingAssetPathEvidence, {
      observationCount: 1,
      uniquePathCount: 1,
      omittedPathCount: 0,
      paths: [{ path: 'imagery/99/0/42.png', observationCount: 1 }],
    });
    assert.equal(
      JSON.stringify(erroredProjection).includes('tile.openstreetmap.org'),
      false,
    );
    const legacySummary = { ...erroredSummary };
    delete legacySummary.missingAssetPathEvidence;
    const legacyFailure = new Error('legacy delivery evidence');
    legacyFailure.smokeDiagnostics = {};
    attachFinalizedMapStreamingFailureEvidence(legacyFailure, {
      fixture,
      deliveryEvidence: legacySummary,
      interceptionRelease: finalized.interceptionRelease,
    });
    assert.equal(
      legacyFailure.smokeDiagnostics.mapStreamingFixtureSetup.delivery
        .missingAssetPathEvidence,
      null,
      'Legacy delivery snapshots retain unavailable path evidence explicitly.',
    );
    const malformedFailure = new Error('malformed diagnostic path');
    malformedFailure.smokeDiagnostics = {};
    attachFinalizedMapStreamingFailureEvidence(malformedFailure, {
      fixture,
      deliveryEvidence: {
        ...erroredSummary,
        missingAssetPathEvidence: {
          observationCount: 1,
          uniquePathCount: 1,
          omittedPathCount: 0,
          paths: [{ path: '../private?token=secret', observationCount: 1 }],
        },
      },
      interceptionRelease: finalized.interceptionRelease,
    });
    assert.equal(
      malformedFailure.smokeDiagnostics.mapStreamingFixtureSetupStatus,
      'invalid-finalized-evidence',
    );
    assert.equal(
      JSON.stringify(malformedFailure.smokeDiagnostics).includes('secret'),
      false,
    );
    if (injectLateRequest) {
      assert.equal(finalized.confirmed, false);
      assert.equal(
        finalized.interceptionRelease.release.interception
          .unexpectedLateRequestCount,
        1,
      );
      assert.match(finalized.errors.join('; '), /unexpectedLateRequestCount/);
    } else {
      assert.equal(finalized.confirmed, true);
    }
  };

  await runFinalization({ label: 'baseline', injectLateRequest: false });
  await runFinalization({ label: 'candidate', injectLateRequest: false });
  await runFinalization({ label: 'candidate', injectLateRequest: true });
});

test('Austin readiness-history smoke contract rejects unbounded or mismatched host samples', () => {
  const fixture = { selectedLayerIds: ['satellites', 'cctv'] };
  const makeHistory = () => ({
    enabled: true,
    schema: 'gev-austin-operating-readiness-history/v1',
    scope: 'host snapshots; no measurement polling; not CPU/GPU time',
    intervalMs: 1000,
    entryLimit: 16,
    attachTimeoutMs: 1000,
    commandTimeoutMs: 1500,
    performanceAcceptanceEligible: false,
    omittedCount: 0,
    documentOmittedCount: 0,
    documents: [
      {
        documentRole: 'provider-sample',
        documentId: 'sample-1',
        phase: 'source-readiness-wait',
        status: 'stalled',
        intervalMs: 1000,
        attachTimeoutMs: 1000,
        commandTimeoutMs: 1500,
        omittedCount: 0,
        session: { detachStatus: 'confirmed' },
      },
    ],
    samples: [
      {
        sequence: 1,
        documentRole: 'provider-sample',
        documentId: 'sample-1',
        phase: 'source-readiness-wait',
        status: 'observed',
        hostStartedAtMs: 10,
        hostCompletedAtMs: 11,
        snapshotEncoding: 'austin-layer-tuples-v1',
        snapshotJson: JSON.stringify({
          schema: 'gev-austin-readiness-failure/v1',
          selectedLayerCount: 2,
          layers: [
            [
              'satellites',
              true,
              828,
              false,
              828,
              828,
              'ready',
              null,
              0,
              0,
              2,
              0,
            ],
            [
              'cctv',
              true,
              250,
              true,
              17,
              250,
              'geometry-loading',
              null,
              0,
              3,
              2,
              0,
            ],
          ],
        }),
      },
    ],
  });
  const reasons = ['austin-setup-readiness-history-instrumentation-is-enabled'];
  assert.equal(
    validateAustinOperatingReadinessHistoryEnvelope(
      makeHistory(),
      fixture,
      reasons,
    ),
    true,
  );

  const delayedHostAck = makeHistory();
  delayedHostAck.samples[0].hostCompletedAtMs = 4010;
  assert.equal(
    validateAustinOperatingReadinessHistoryEnvelope(
      delayedHostAck,
      fixture,
      reasons,
    ),
    true,
  );

  const regressingHostTime = makeHistory();
  regressingHostTime.samples.push({
    ...regressingHostTime.samples[0],
    sequence: 2,
    hostStartedAtMs: 9,
    hostCompletedAtMs: 10,
  });
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(
      regressingHostTime,
      fixture,
      reasons,
    ),
  );

  const unknownDocument = makeHistory();
  unknownDocument.samples[0].documentId = 'replacement-document';
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(
      unknownDocument,
      fixture,
      reasons,
    ),
  );

  const wrongLayerOrder = makeHistory();
  const decoded = JSON.parse(wrongLayerOrder.samples[0].snapshotJson);
  decoded.layers.reverse();
  wrongLayerOrder.samples[0].snapshotJson = JSON.stringify(decoded);
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(
      wrongLayerOrder,
      fixture,
      reasons,
    ),
  );

  const tooMany = makeHistory();
  tooMany.samples = Array.from({ length: 17 }, () => tooMany.samples[0]);
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(tooMany, fixture, reasons),
  );

  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(makeHistory(), fixture, []),
  );
});

test('Austin readiness history validates producer snapshots with document-local sequences', async () => {
  const fixture = { selectedLayerIds: ['satellites', 'cctv'] };
  const envelope = createAustinOperatingReadinessHistoryEnvelope();
  const snapshot = {
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: fixture.selectedLayerIds.length,
    layers: fixture.selectedLayerIds.map((id) => ({
      id,
      enabled: true,
      count: id === 'cctv' ? 250 : 828,
      loading: false,
      loadingLoaded: id === 'cctv' ? 250 : 828,
      loadingTotal: id === 'cctv' ? 250 : 828,
      ownership: { timers: 0, pendingJobs: 0, primitives: 1, dataSources: 0 },
      status: 'ready',
      error: null,
    })),
  };
  const makeDocumentHistory = async (documentId, hostStart, repeatCount) => {
    let hostNow = hostStart;
    let intervalCallback = null;
    const timers = {
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval(callback) {
        intervalCallback = callback;
        return 2;
      },
      clearInterval() {
        intervalCallback = null;
      },
    };
    const session = {
      on() {},
      off() {},
      async send(method, params) {
        assert.equal(method, 'Runtime.evaluate');
        assert.equal(params.returnByValue, true);
        return { result: { value: snapshot } };
      },
      async detach() {},
    };
    const sampler = createAustinOperatingReadinessHistory(
      {
        async createCDPSession() {
          return session;
        },
      },
      {
        observerSource: 'function observeReadiness(ids) { return null; }',
        selectedLayerIds: fixture.selectedLayerIds,
        documentRole: 'provider-sample',
        documentId,
        now: () => hostNow++,
        timers,
      },
    );
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    for (let index = 0; index < repeatCount; index += 1) {
      intervalCallback();
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    }
    return sampler.stop('readiness-complete');
  };

  const firstDocument = await makeDocumentHistory('sample-1', 10, 10);
  const secondDocument = await makeDocumentHistory('sample-2', 100, 7);
  assert.equal(firstDocument.samples[0].sequence, 1);
  assert.equal(firstDocument.samples.at(-1).sequence, 11);
  assert.equal(secondDocument.samples[0].sequence, 1);
  appendAustinOperatingReadinessHistory(envelope, firstDocument);
  appendAustinOperatingReadinessHistory(envelope, secondDocument);

  const malformedProducerHistory = structuredClone(secondDocument);
  malformedProducerHistory.samples[0].documentId = 'wrong-document';
  const untouchedEnvelope = createAustinOperatingReadinessHistoryEnvelope();
  assert.throws(
    () =>
      appendAustinOperatingReadinessHistory(
        untouchedEnvelope,
        malformedProducerHistory,
      ),
    /sample identity does not match its document/,
  );
  assert.equal(untouchedEnvelope.documents.length, 0);
  assert.equal(untouchedEnvelope.samples.length, 0);

  assert.equal(envelope.attachTimeoutMs, 1000);
  assert.equal(envelope.commandTimeoutMs, 1500);
  assert.equal(envelope.documents.length, 2);
  assert.equal(envelope.samples.length, 16);
  assert.equal(envelope.omittedCount, 3);
  assert.equal(
    validateAustinOperatingReadinessHistoryEnvelope(envelope, fixture, [
      'austin-setup-readiness-history-instrumentation-is-enabled',
    ]),
    true,
  );

  const mismatchedDocumentBound = structuredClone(envelope);
  mismatchedDocumentBound.documents[1].attachTimeoutMs = 999;
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(
      mismatchedDocumentBound,
      fixture,
      ['austin-setup-readiness-history-instrumentation-is-enabled'],
    ),
  );
  const duplicateDocument = structuredClone(envelope);
  duplicateDocument.documents[1].documentId = 'sample-1';
  assert.throws(() =>
    validateAustinOperatingReadinessHistoryEnvelope(
      duplicateDocument,
      fixture,
      ['austin-setup-readiness-history-instrumentation-is-enabled'],
    ),
  );
  const regressingDocumentSequence = structuredClone(envelope);
  const firstDocumentSamples = regressingDocumentSequence.samples.filter(
    (sample) => sample.documentId === 'sample-1',
  );
  assert.equal(firstDocumentSamples[0].sequence, 4);
  firstDocumentSamples[1].sequence = firstDocumentSamples[0].sequence;
  assert.throws(
    () =>
      validateAustinOperatingReadinessHistoryEnvelope(
        regressingDocumentSequence,
        fixture,
        ['austin-setup-readiness-history-instrumentation-is-enabled'],
      ),
    /sample sequence must increase within its own document/,
  );
});

function validCaptureCliReport(workerAuditMode = 'diagnostic') {
  const scenarios = ['idle', 'scripted-motion', 'selected-aircraft-tracking'];
  const generatedFixture = createProductionFlightFixture({
    count: 2500,
    fixedTime: '2026-10-08T12:00:00.000Z',
  });
  const fixture = {
    id: generatedFixture.id,
    sha256: generatedFixture.sha256,
    fixedTime: generatedFixture.fixedTime,
    count: generatedFixture.count,
    center: { latitude: 30.2672, longitude: -97.7431 },
    cameraPath: {
      id: 'austin-overhead-v1',
      altitudeM: 130_000,
      headingDeg: 0,
      pitchDeg: -90,
    },
    seed: 1,
    detectionMode: 'DENSE',
  };
  const settings = {
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
  const layers = [
    { id: 'flights', enabled: true, count: 2500 },
    { id: 'local-datacenters', enabled: true, count: 4362 },
    { id: 'local-dams', enabled: true, count: 716 },
  ];
  const fixtureDelivery = {
    schema: 'gev-fixture-delivery-observation/v1',
    status: 'observed',
    method:
      'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    fulfilledResponseCount: 6,
    observedFlightsCount: 2500,
    perSampleResponseCounts: scenarios.flatMap((scenario) =>
      [1, 2].map((run) => ({ scenario, run, fulfilledResponseCount: 1 })),
    ),
  };
  const captures = scenarios.flatMap((scenario) =>
    [1, 2].map((run) => ({
      scenario,
      run,
      fixtureClock: producerFixtureClock(fixture.fixedTime),
      fixtureDelivery: {
        ...fixtureDelivery,
        fulfilledResponseCount: 1,
        perSampleResponseCounts: undefined,
      },
      layers: structuredClone(layers),
      conditions: {
        before: {
          settings: structuredClone(settings),
          visible: true,
          focused: true,
        },
        after: {
          settings: structuredClone(settings),
          visible: true,
          focused: true,
        },
      },
      foregroundThroughout: true,
      renderedFrameCount: 61,
      frameCount: 60,
      frameIntervalMs: { p50: 16, p95: 18, max: 20, samples: 60 },
      cameraPath: {
        id:
          scenario === 'scripted-motion'
            ? 'elapsed-move-right-v1'
            : scenario === 'selected-aircraft-tracking'
              ? 'entity-follow-v1'
              : 'parked-v1',
        start: { position: { x: 1, y: 2, z: 3 } },
      },
      ...(scenario === 'selected-aircraft-tracking'
        ? { trackedAircraftId: 'flights:000001' }
        : {}),
      settings: {
        before: structuredClone(settings),
        after: structuredClone(settings),
      },
    })),
  );
  const source = {
    appCommit: 'b'.repeat(40),
    harnessCommit: 'c'.repeat(40),
    provenanceStatus: 'verified-local-build-and-served-assets-before-and-after',
    buildProvenance: {
      schema: 'gev-capture-build-provenance/v1',
      status: 'verified-local-build-and-served-assets-before-and-after',
      receiptSha256: 'd'.repeat(64),
      pageAssetAudit: {
        workerAuditMode,
        scriptRequestCount: 12,
        loadedAssetPaths: ['assets/index.js'],
        unexpectedAssetPaths: [],
        cesiumWorkerBlobAudits: Array.from({ length: 8 }, (_, index) => ({
          status: 'receipt-derived-worker-blobs-validated',
          auditMode:
            workerAuditMode === 'prewarm' && index >= 2
              ? 'prewarm'
              : 'diagnostic',
        })),
      },
    },
  };
  const workerAuditRoles = [
    'startup-1',
    'main-setup',
    ...captures.map((sample, index) => `provider-sample-${index + 1}`),
  ];
  source.buildProvenance.pageAssetAudit.workerAuditDocuments =
    workerAuditRoles.map((documentRole) => {
      const measuredProviderDocument =
        documentRole.startsWith('provider-sample-');
      const prewarm = workerAuditMode === 'prewarm' && measuredProviderDocument;
      return {
        documentRole,
        mode: prewarm ? 'prewarm' : 'diagnostic',
        validation: {
          status: 'receipt-derived-worker-blobs-validated',
          auditMode: prewarm ? 'prewarm' : 'diagnostic',
          createdScriptBlobCount: 8,
        },
        restoration: {
          nativeCreateObjectURLRestored: true,
          registryEmpty: true,
          createdScriptBlobCountAtRestore: 8,
          overflowCountAtRestore: 0,
          auditedCreatedScriptBlobCount: 8,
          auditedOverflowCount: 0,
        },
        observedWorkerTargetCount: 1,
        observedBlobRequestCount: 1,
        ...(prewarm
          ? {
              lateUseCheck: {
                status: 'observed-late-code-paths-within-prewarm-inventory',
                unusedLateBlobCreationObservable: false,
              },
            }
          : {}),
      };
    });
  const workload = {
    warmupMs: 1000,
    durationPerSampleMs: 1000,
    runsPerScenario: 2,
    startupRuns: 1,
    scenarios,
    fixture,
    injectedDelayMs: 0,
    cameraPath: 'observed per-scenario route descriptors',
    populationStableAcrossSamples: true,
    cameraPathStableAcrossSamples: true,
    hardwareRequired: false,
  };
  const environment = {
    appCommit: source.appCommit,
    userAgent: 'Mozilla/5.0 HeadlessChrome/152.0.0.0',
    platform: 'Linux x86_64',
    renderer: 'ANGLE (Google, Vulkan 1.3, SwiftShader device)',
    vendor: 'Google Inc.',
    viewport: { width: 1280, height: 900, dpr: 1 },
    drawingBuffer: { width: 1280, height: 900 },
    layers: structuredClone(layers),
    hardwareEligible: false,
    startup: {
      runCount: 1,
      measurement: 'cache-disabled fresh browser contexts',
    },
  };
  const performanceDiagnostics = {
    requested:
      'disabled-after-app-ready-before-warmup-when-supported-per-document',
    documents: [
      {
        documentRole: 'startup-1',
        requested: true,
        hookAvailable: true,
        disabled: true,
      },
      {
        documentRole: 'main-setup',
        requested: true,
        hookAvailable: true,
        disabled: true,
      },
      ...captures.map((sample, index) => ({
        documentRole: `provider-sample-${index + 1}`,
        requested: true,
        hookAvailable: true,
        disabled: true,
      })),
    ],
  };
  const comparisonContract = createObservedDenseComparisonContract({
    fixture,
    fixtureDelivery,
    environment,
    captures,
    scenarios,
  });
  const comparisonReadiness = {
    status: 'not-ready',
    reasons: getCaptureComparisonIneligibilityReasons({
      contract: comparisonContract,
      fixture,
      fixtureDelivery,
      source,
      environment,
      workload,
      captures,
      diagnosticsDocuments: performanceDiagnostics.documents,
      workerBlobAuditInstrumented: true,
      workerBlobAuditMode: workerAuditMode,
      hardwareRequired: false,
    }),
  };
  comparisonReadiness.reason = comparisonReadiness.reasons.join('; ');
  return {
    schema: 'gev-performance-capture/v1',
    workerAuditMode,
    comparisonEligible: false,
    comparisonContract,
    comparisonReadiness,
    performanceDiagnostics,
    integrity: { status: 'passed', sampleCount: 6 },
    source,
    workload,
    environment,
    fixtureDelivery: {
      ...fixtureDelivery,
    },
    captures,
  };
}

function addNativeRendererDiagnosticToDenseReport(report) {
  const renderer =
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
  const vendor = 'Apple Inc.';
  report.environment.renderer = renderer;
  report.environment.vendor = vendor;
  report.environment.hardwareEligible = false;
  report.nativeRendererDiagnostic = nativeRendererDiagnosticEvidence({
    renderer,
    vendor,
    graphics: {
      featureStatus: {
        webgl: 'enabled',
        webgl2: 'enabled',
        gpu_compositing: 'enabled',
        opengl: 'enabled_on',
      },
    },
  });
  report.comparisonContract = createObservedDenseComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
  });
  report.comparisonReadiness.reasons = getCaptureComparisonIneligibilityReasons(
    {
      contract: report.comparisonContract,
      fixture: report.workload.fixture,
      fixtureDelivery: report.fixtureDelivery,
      source: report.source,
      environment: report.environment,
      workload: report.workload,
      captures: report.captures,
      diagnosticsDocuments: report.performanceDiagnostics.documents,
      workerBlobAuditInstrumented: true,
      workerBlobAuditMode: 'diagnostic',
      hardwareRequired: false,
    },
  );
  report.comparisonReadiness.reasons.push(
    'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
  );
  report.comparisonReadiness.reason =
    report.comparisonReadiness.reasons.join('; ');
  return report;
}

function validInfrastructureCaptureCliReport(
  providerFixture = 'infrastructure-datacenters',
) {
  const fixedTime = '2026-10-08T12:00:00.000Z';
  const fixture = createInfrastructureWorkloadFixture(
    providerFixture,
    fixedTime,
  );
  const topology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: 1,
    captureCount: 4,
  });
  const layers = Object.entries(fixture.expectedLayerCounts)
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
    fixedTime,
    assets,
    populationsBefore: layers,
    populationsAfter: layers,
  };
  const cesiumClock = {
    currentTime: { ...fixture.clock },
    shouldAnimate: false,
    multiplier: 0,
  };
  let sampleDocumentIndex = 0;
  const captures = ['idle', 'scripted-motion'].flatMap((scenario) =>
    [1, 2].map((run) => ({
      scenario,
      run,
      layers,
      settings: { before: settings, after: settings },
      fixtureDelivery,
      infrastructureFixtureClock: {
        fixedTime,
        wallClockBeforeMs: fixture.fixedTimeMs,
        wallClockAfterMs: fixture.fixedTimeMs,
        cesiumBefore: cesiumClock,
        cesiumAfter: cesiumClock,
      },
      ...topology.samples[sampleDocumentIndex++],
      conditions: {
        before: { visible: true, focused: true, environment: { layers } },
        after: { visible: true, focused: true, environment: { layers } },
      },
      foregroundThroughout: true,
      cameraPath: { id: `${scenario}-v1` },
      frameCount: 60,
      renderedFrameCount: 61,
      frameIntervalMs: { p50: 16, p95: 18, max: 20, samples: 60 },
    })),
  );
  const environment = {
    userAgent: 'Mozilla/5.0 HeadlessChrome/154.0.0.0 Safari/537.36',
    renderer: 'ANGLE (SwiftShader Device)',
    hardwareEligible: false,
    layers,
    viewport: { width: 1280, height: 900, dpr: 1 },
    drawingBuffer: { width: 1280, height: 900 },
    startup: {
      runCount: 1,
      measurement:
        'one measured app document; cache disabled before navigation',
    },
  };
  const workload = {
    providerFixture,
    fixtureId: fixture.id,
    fixture,
    warmupMs: 1000,
    durationPerSampleMs: 1000,
    runsPerScenario: 2,
    startupRuns: 1,
    scenarios: ['idle', 'scripted-motion'],
    injectedDelayMs: 0,
    infrastructureFixtureLifecycle: {
      freshBrowserContextPerSample: false,
    },
  };
  const diagnostics = topology.diagnostics.map(
    ({ documentRole, documentId }) => ({
      documentRole,
      documentId,
      requested: true,
      hookAvailable: true,
      disabled: true,
    }),
  );
  const workerSourceSha256 = 'e'.repeat(64);
  const workerAuditDocuments = topology.workerAudits.map(
    ({ documentRole, documentId }) => {
      const hasRequiredAudit = true;
      const validation = hasRequiredAudit
        ? {
            schema: 'gev-cesium-worker-blob-audit/v1',
            status: 'receipt-derived-worker-blobs-validated',
            auditMode: 'diagnostic',
            embeddedWorkerSourceSha256: workerSourceSha256,
            validatedWorkerCount: documentRole === 'main-measured' ? 100 : 20,
          }
        : null;
      return {
        documentRole,
        documentId,
        mode: 'diagnostic',
        validation,
        restoration: {
          nativeCreateObjectURLRestored: true,
          registryEmpty: true,
          overflowCountAtRestore: 0,
          createdScriptBlobCountAtRestore: hasRequiredAudit ? 1 : 0,
          auditedCreatedScriptBlobCount: hasRequiredAudit ? 1 : 0,
        },
        observedWorkerTargetCount: hasRequiredAudit ? 1 : 0,
        observedBlobRequestCount: hasRequiredAudit ? 1 : 0,
      };
    },
  );
  const source = {
    appCommit: 'b'.repeat(40),
    harnessCommit: 'c'.repeat(40),
    provenanceStatus: 'verified-local-build-and-served-assets-before-and-after',
    buildProvenance: {
      status: 'verified-local-build-and-served-assets-before-and-after',
      receiptSha256: 'd'.repeat(64),
      pageAssetAudit: {
        workerAuditMode: 'diagnostic',
        scriptRequestCount: 10,
        loadedAssetPaths: ['assets/app.js'],
        unexpectedAssetPaths: [],
        cesiumWorkerBlobAudits: structuredClone(
          workerAuditDocuments
            .filter((entry) => entry.validation)
            .map((entry) => entry.validation),
        ),
        workerAuditDocuments,
      },
    },
  };
  const comparisonContract = createObservedInfrastructureComparisonContract({
    fixture,
    fixtureDelivery,
    environment,
    captures,
    scenarios: workload.scenarios,
  });
  const comparisonReadinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: comparisonContract,
    fixture,
    fixtureDelivery,
    source,
    environment,
    workload,
    captures,
    diagnosticsDocuments: diagnostics,
    workerBlobAuditInstrumented: true,
    workerBlobAuditMode: 'diagnostic',
    hardwareRequired: false,
  });
  return {
    schema: 'gev-performance-capture/v1',
    workerAuditMode: 'diagnostic',
    comparisonEligible: false,
    integrity: { status: 'passed', sampleCount: 4 },
    source,
    workload,
    environment,
    fixtureDelivery,
    captures,
    comparisonContract,
    comparisonReadiness: {
      status: 'not-ready',
      reasons: comparisonReadinessReasons,
    },
    performanceDiagnostics: { documents: diagnostics },
  };
}

async function validWeatherEffectsCaptureCliReport() {
  const report = validInfrastructureCaptureCliReport();
  const fixture = createWeatherEffectsWorkloadFixture();
  const topology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: 1,
    captureCount: 4,
  });
  const layers = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const delivery = createWeatherEffectsFixtureDelivery(
    fixture,
    'http://127.0.0.1:4173/',
  );
  const fulfill = async (url) => {
    const response = await delivery.respond(
      new URL(url, 'http://127.0.0.1:4173/'),
      { method: 'GET' },
    );
    assert.ok(response);
    delivery.onFulfilled({
      url: new URL(url, 'http://127.0.0.1:4173/').href,
      method: 'GET',
      status: response.status,
      bodyBase64: Buffer.from(response.body).toString('base64'),
    });
  };
  for (const product of ['radar', 'clouds-regional', 'lightning']) {
    await fulfill(`/api/weather/manifest?product=${product}`);
    for (const time of fixture.manifests[product].times)
      await fulfill(
        `/api/weather/tile?product=${product}&time=${encodeURIComponent(time)}&z=2&x=3&y=1`,
      );
  }
  await fulfill('/api/wind/manifest?model=gfs');
  await fulfill(fixture.windManifest.gridUrl);
  const rawDelivery = delivery.summarize(layers, layers);
  const timeline = [
    fixture.timeline.at(-1),
    fixture.timeline.at(-2),
    fixture.timeline.at(0),
    fixture.timeline.at(-1),
  ].map((time) => [time, time, time]);
  const visualState = {
    satelliteProduct: 'clouds-regional',
    satelliteInfrared: 'filtered',
    radarOpacity: 'strong',
    lightningOpacity: 'strong',
    windModel: 'gfs',
    windOverlay: 'speed',
    windPaused: false,
  };
  const playback = {
    mode: 'history',
    playing: true,
    intervalMs: 2000,
    displayedAtStart: [fixture.fixedTime, fixture.fixedTime, fixture.fixedTime],
    visualState,
  };
  const timelinePreflight = {
    selectedTimes: timeline,
    sourceObservationTimes: [
      fixture.fixedTime,
      fixture.fixedTime,
      fixture.fixedTime,
    ],
    playback,
  };
  const fixtureDelivery = {
    ...rawDelivery,
    assets: rawDelivery.assets.map((asset) => ({
      ...asset,
      responseCount: asset.responseCount + report.captures.length - 1,
    })),
    cameraObservation: {
      longitudeDeg: fixture.camera.longitudeDeg,
      latitudeDeg: fixture.camera.latitudeDeg,
      altitudeM: fixture.camera.altitudeM,
      headingDeg: fixture.camera.headingDeg,
      pitchDeg: fixture.camera.pitchDeg,
    },
    timelinePreflight,
  };
  const cesiumClock = {
    currentTime: { ...fixture.clock },
    shouldAnimate: false,
    multiplier: 0,
  };
  report.integrity.sampleCount = 4;
  report.workload.providerFixture = WEATHER_EFFECTS_WORKLOAD_ID;
  report.workload.fixture = fixture;
  report.workload.fixtureId = fixture.id;
  report.workload.performanceAcceptanceEligible = false;
  delete report.workload.infrastructureFixtureLifecycle;
  report.workload.weatherEffectsFixtureLifecycle =
    createWeatherEffectsFixtureLifecycle({
      fixture,
      cameraObservation: fixtureDelivery.cameraObservation,
      timelinePreflight: {
        selectedTimes: timeline,
        sourceObservationTimes: [
          fixture.fixedTime,
          fixture.fixedTime,
          fixture.fixedTime,
        ],
        playback,
      },
    });
  report.workload.rendererProbeCleanup = [
    {
      documentRole: 'startup-1',
      documentId: topology.workerAudits[0].documentId,
      confirmed: true,
      document: {
        status: 'confirmed',
        statePresent: true,
        hookRestoreAttempted: true,
        hookRestored: true,
        stateDeleted: true,
        listenerCount: 2,
        listenerRemovalAttemptedCount: 2,
        listenerRemovalConfirmedCount: 2,
        listenerRemovalFailedCount: 0,
        renderLoopRetirement: {
          requested: true,
          confirmed: true,
          after: false,
        },
      },
      scriptRegistration: {
        status: 'confirmed',
        errorKind: null,
        verification:
          'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable',
      },
    },
    {
      documentRole: 'main-measured',
      documentId: topology.workerAudits[1].documentId,
      confirmed: true,
      document: {
        status: 'confirmed',
        statePresent: true,
        hookRestoreAttempted: true,
        hookRestored: true,
        stateDeleted: true,
        listenerCount: 2,
        listenerRemovalAttemptedCount: 2,
        listenerRemovalConfirmedCount: 2,
        listenerRemovalFailedCount: 0,
        renderLoopRetirement: {
          requested: true,
          confirmed: true,
          after: false,
        },
      },
      scriptRegistration: {
        status: 'confirmed',
        errorKind: null,
        verification:
          'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable',
      },
    },
  ];
  report.workload.rendererProbeCleanupOmittedCount = 0;
  report.workload.rendererLoopRetirements = [
    {
      phase: 'startup-final-details',
      documentRole: 'startup-1',
      documentId: topology.workerAudits[0].documentId,
      requested: true,
      confirmed: true,
      after: false,
    },
  ];
  report.workload.rendererLoopRetirementsOmittedCount = 0;
  report.workload.fixtureInterceptionReleases = [
    {
      documentRole: 'main-measured',
      documentId: topology.workerAudits[1].documentId,
      confirmed: true,
      targetClosed: true,
      stop: {
        confirmed: true,
        listenerRemovalConfirmed: true,
        pendingAtStop: 0,
        pendingPreparationAtStop: 0,
        pendingAbortSubscriptionsAtStop: 0,
        pendingCommandsAtStop: 0,
        pendingCommandsAfterDrain: 0,
        pendingPreparationsAfterDrain: 0,
        pendingAbortSubscriptionsAfterDrain: 0,
        rejectedDrainOperations: 0,
        drainCommandFailures: 0,
        unexpectedLateRequestCount: 0,
      },
      interception: {
        confirmed: true,
        fetchDisable: 'target-closed',
        detach: 'target-closed',
        interception: {
          confirmed: true,
          listenerRemovalConfirmed: true,
          pendingAtStop: 0,
          pendingPreparationAtStop: 0,
          pendingAbortSubscriptionsAtStop: 0,
          pendingCommandsAtStop: 0,
          pendingCommandsAfterDrain: 0,
          pendingPreparationsAfterDrain: 0,
          pendingAbortSubscriptionsAfterDrain: 0,
          rejectedDrainOperations: 0,
          drainCommandFailures: 0,
          unexpectedLateRequestCount: 0,
        },
      },
      fetchDisable: 'target-closed',
      detach: 'target-closed',
    },
  ];
  report.environment.layers = layers;
  report.fixtureDelivery = fixtureDelivery;
  report.comparisonContract = null;
  report.comparisonReadiness = {
    status: 'not-ready',
    reasons: [
      'weather-effects-fixture-is-a-short-diagnostic-not-performance-acceptance',
    ],
  };
  report.performanceDiagnostics.documents = topology.diagnostics.map(
    ({ documentRole, documentId }) => ({
      documentRole,
      documentId,
      requested: true,
      hookAvailable: true,
      disabled: true,
    }),
  );
  report.source.buildProvenance.pageAssetAudit.workerAuditDocuments =
    topology.workerAudits.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
      mode: 'diagnostic',
      validation: {
        schema: 'gev-cesium-worker-blob-audit/v1',
        status: 'receipt-derived-worker-blobs-validated',
        auditMode: 'diagnostic',
        embeddedWorkerSourceSha256: 'e'.repeat(64),
      },
      restoration: {
        nativeCreateObjectURLRestored: true,
        registryEmpty: true,
        overflowCountAtRestore: 0,
        createdScriptBlobCountAtRestore: 1,
        auditedCreatedScriptBlobCount: 1,
      },
      observedWorkerTargetCount: 1,
      observedBlobRequestCount: 1,
    }));
  report.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits =
    report.source.buildProvenance.pageAssetAudit.workerAuditDocuments.map(
      (entry) => entry.validation,
    );
  for (let index = 0; index < report.captures.length; index += 1) {
    const sample = report.captures[index];
    const sourceTimes = fixture.timeline.at(-1);
    sample.documentRole = 'main-measured';
    sample.documentId = topology.samples[0].documentId;
    sample.layers = layers;
    sample.settings.before = {
      ...sample.settings.before,
      qualityMode: 'manual',
      densityPct: 75,
      detectionMode: 'DENSE',
    };
    sample.settings.after = { ...sample.settings.before };
    sample.fixtureDelivery = {
      ...fixtureDelivery,
      assets: fixtureDelivery.assets.map((asset) => ({
        ...asset,
        responseCount: asset.responseCount - report.captures.length + 1 + index,
      })),
    };
    sample.weatherEffectsClock = {
      fixedHarnessTime: fixture.fixedTime,
      wallClockBeforeMs: Date.parse(fixture.fixedTime),
      wallClockAfterMs: Date.parse(fixture.fixedTime),
      cesiumBefore: cesiumClock,
      cesiumAfter: cesiumClock,
      weatherPlayback: playback,
      selectedTimesPreflight: timeline,
      weatherStateBefore: {
        clock: { mode: 'history', playing: true },
        sourceObservationTimes: [sourceTimes, sourceTimes, sourceTimes],
        visualState,
        wind: { model: 'gfs', overlay: 'speed', paused: false },
      },
      weatherStateAfter: {
        clock: { mode: 'history', playing: true },
        sourceObservationTimes: [sourceTimes, sourceTimes, sourceTimes],
        visualState,
        wind: { model: 'gfs', overlay: 'speed', paused: false },
      },
    };
    sample.cameraPath = { id: `${sample.scenario}-v1` };
  }
  return { report, fixture };
}

test('provider CPU profile set binds first two idle and first motion windows to exact documents', () => {
  const report = validCaptureCliReport();
  const targets = [
    { scenario: 'idle', run: 1 },
    { scenario: 'idle', run: 2 },
    { scenario: 'scripted-motion', run: 1 },
  ];
  const profiles = targets.map((target, index) => {
    const sample = report.captures.find(
      (item) => item.scenario === target.scenario && item.run === target.run,
    );
    sample.captureOrdinal = report.captures.indexOf(sample);
    sample.documentRole = `document-role-${index}`;
    sample.documentId = `document-id-${index}`;
    const key =
      target.scenario === 'idle'
        ? `provider-idle-${target.run}`
        : `provider-scripted-motion-${target.run}`;
    const profile = {
      schema: 'gev-render-boundary-cpu-profile-ref/v1',
      status: 'complete',
      windowCapReached: false,
      windowCapMs: null,
      profileWindowMs: 5000,
      stopOverrunMs: 0,
      performanceAcceptanceEligible: false,
      fileName: `${key}-cpu-profile.json`,
      sha256: String(index + 1).repeat(64),
      byteLength: 2048,
      profilerErrors: [],
      target: {
        scenario: target.scenario,
        run: target.run,
        captureOrdinal: sample.captureOrdinal,
        documentRole: sample.documentRole,
        documentId: sample.documentId,
      },
    };
    const window = {
      schema: 'gev-provider-sample-cpu-profile-window/v1',
      enabled: true,
      targetScenario: target.scenario,
      targetRun: target.run,
      captureOrdinal: sample.captureOrdinal,
      documentRole: sample.documentRole,
      documentId: sample.documentId,
      status: 'complete',
      windowCapReached: false,
      windowCapMs: null,
      profileWindowMs: 5000,
      stopOverrunMs: 0,
      profilerStarted: true,
      profile,
      scope:
        'sample-bound window from immediately before warmup through its measurement boundary',
      performanceAcceptanceEligible: false,
    };
    sample.providerSampleCpuProfile = structuredClone(window);
    return window;
  });
  report.providerSampleCpuProfiles = {
    enabled: true,
    targets,
    scope:
      'first two idle samples and first scripted-motion sample, each from immediately before warmup through its measurement-boundary completion or failure; sampled main-thread stacks include idle and garbage collection, and are not precise CPU execution or GPU timing',
    performanceAcceptanceEligible: false,
    status: 'complete',
    profiles,
  };
  report.comparisonReadiness.reasons.push(
    'provider-sample-cpu-profile-instrumentation-is-enabled',
  );
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
    firstMotionCpuProfile: true,
  };
  assert.doesNotThrow(() => validateCaptureCliReport(report, expected));

  const sampleMissing = structuredClone(report);
  delete sampleMissing.captures.find(
    (sample) => sample.scenario === 'idle' && sample.run === 2,
  ).providerSampleCpuProfile;
  assert.throws(() => validateCaptureCliReport(sampleMissing, expected));

  const eligible = structuredClone(report);
  eligible.providerSampleCpuProfiles.performanceAcceptanceEligible = true;
  assert.throws(() => validateCaptureCliReport(eligible, expected));

  const mismatchedWindowTarget = structuredClone(report);
  mismatchedWindowTarget.providerSampleCpuProfiles.profiles[2].profile.target.captureOrdinal = 3;
  mismatchedWindowTarget.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).providerSampleCpuProfile = structuredClone(
    mismatchedWindowTarget.providerSampleCpuProfiles.profiles[2],
  );
  assert.throws(() =>
    validateCaptureCliReport(mismatchedWindowTarget, expected),
  );

  const wrongFiveRunOrdinal = structuredClone(report);
  wrongFiveRunOrdinal.providerSampleCpuProfiles.profiles[2].captureOrdinal = 5;
  wrongFiveRunOrdinal.providerSampleCpuProfiles.profiles[2].profile.target.captureOrdinal = 5;
  wrongFiveRunOrdinal.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).providerSampleCpuProfile = structuredClone(
    wrongFiveRunOrdinal.providerSampleCpuProfiles.profiles[2],
  );
  assert.throws(() => validateCaptureCliReport(wrongFiveRunOrdinal, expected));

  const incomplete = structuredClone(report);
  const cappedWindow = incomplete.providerSampleCpuProfiles.profiles[1];
  cappedWindow.status = 'incomplete';
  cappedWindow.windowCapReached = true;
  cappedWindow.windowCapMs = 60_000;
  cappedWindow.profile.status = 'incomplete';
  cappedWindow.profile.windowCapReached = true;
  cappedWindow.profile.windowCapMs = 60_000;
  incomplete.captures.find(
    (sample) => sample.scenario === 'idle' && sample.run === 2,
  ).providerSampleCpuProfile = structuredClone(cappedWindow);
  incomplete.providerSampleCpuProfiles.status = 'incomplete';
  assert.doesNotThrow(() => validateCaptureCliReport(incomplete, expected));

  const cappedWithCleanupError = structuredClone(incomplete);
  cappedWithCleanupError.providerSampleCpuProfiles.profiles[1].profile.profilerErrors =
    ['Profiler.disable failed'];
  cappedWithCleanupError.captures.find(
    (sample) => sample.scenario === 'idle' && sample.run === 2,
  ).providerSampleCpuProfile = structuredClone(
    cappedWithCleanupError.providerSampleCpuProfiles.profiles[1],
  );
  assert.throws(() =>
    validateCaptureCliReport(cappedWithCleanupError, expected),
  );

  const wrongArtifactName = structuredClone(report);
  wrongArtifactName.providerSampleCpuProfiles.profiles[0].profile.fileName =
    '../different-profile.json';
  wrongArtifactName.captures.find(
    (sample) => sample.scenario === 'idle' && sample.run === 1,
  ).providerSampleCpuProfile = structuredClone(
    wrongArtifactName.providerSampleCpuProfiles.profiles[0],
  );
  assert.throws(() => validateCaptureCliReport(wrongArtifactName, expected));

  const capMismatch = structuredClone(incomplete);
  capMismatch.providerSampleCpuProfiles.profiles[1].windowCapMs = 59_999;
  capMismatch.captures.find(
    (sample) => sample.scenario === 'idle' && sample.run === 2,
  ).providerSampleCpuProfile = structuredClone(
    capMismatch.providerSampleCpuProfiles.profiles[1],
  );
  assert.throws(() => validateCaptureCliReport(capMismatch, expected));

  const overrun = structuredClone(report);
  const overrunWindow = overrun.providerSampleCpuProfiles.profiles[2];
  overrunWindow.status = 'incomplete';
  overrunWindow.profile.status = 'incomplete';
  overrunWindow.profile.profileWindowMs = 60_500;
  overrunWindow.profile.stopOverrunMs = 500;
  overrunWindow.profileWindowMs = 60_500;
  overrunWindow.stopOverrunMs = 500;
  overrun.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).providerSampleCpuProfile = structuredClone(overrunWindow);
  overrun.providerSampleCpuProfiles.status = 'incomplete';
  assert.doesNotThrow(() => validateCaptureCliReport(overrun, expected));
});

test('failed later profile window preserves the earlier ordered sidecar indexes', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-provider-profile-index-set-'),
  );
  try {
    const targets = [
      { scenario: 'idle', run: 1, key: 'provider-idle-1' },
      { scenario: 'idle', run: 2, key: 'provider-idle-2' },
      {
        scenario: 'scripted-motion',
        run: 1,
        key: 'provider-scripted-motion-1',
      },
    ];
    for (const target of targets) {
      const captureOrdinal = target.scenario === 'idle' ? target.run - 1 : 5;
      const profileBytes = Buffer.from(`profile-${captureOrdinal}`);
      const profileRef = {
        schema: 'gev-render-boundary-cpu-profile-ref/v1',
        status: 'complete',
        performanceAcceptanceEligible: false,
        fileName: `${target.key}-cpu-profile.json`,
        sha256: createHash('sha256').update(profileBytes).digest('hex'),
        byteLength: profileBytes.byteLength,
        profilerErrors: [],
        target: {
          scenario: target.scenario,
          run: target.run,
          captureOrdinal,
          documentRole: `provider-sample-${captureOrdinal}`,
          documentId: `document-${captureOrdinal}`,
        },
      };
      await writeFile(path.join(directory, profileRef.fileName), profileBytes);
      await writeFile(
        path.join(directory, `${target.key}-cpu-profile-ref.json`),
        `${JSON.stringify({
          schema: 'gev-provider-sample-cpu-profile-index/v1',
          performanceAcceptanceEligible: false,
          target: {
            scenario: target.scenario,
            run: target.run,
            captureOrdinal,
            documentRole: `provider-sample-${captureOrdinal}`,
            documentId: `document-${captureOrdinal}`,
          },
          profile: profileRef,
        })}\n`,
      );
    }
    const result = await readProviderCpuProfileIndexSet(directory);
    assert.equal(result.status, 'all-targets-recorded');
    assert.equal(result.invalidIndexCount, 0);
    assert.deepEqual(
      result.profiles.map(({ target }) => [target.scenario, target.run]),
      [
        ['idle', 1],
        ['idle', 2],
        ['scripted-motion', 1],
      ],
    );
    assert.equal(result.profiles.length, 3);
    assert.equal(
      result.profiles.every((profile) => profile.artifactVerified),
      true,
    );
    assert.equal(result.performanceAcceptanceEligible, false);

    const motionIndexPath = path.join(
      directory,
      'provider-scripted-motion-1-cpu-profile-ref.json',
    );
    const motionIndex = JSON.parse(await readFile(motionIndexPath, 'utf8'));
    assert.equal(motionIndex.target.captureOrdinal, 5);
    motionIndex.profile.target.captureOrdinal = 2;
    await writeFile(motionIndexPath, `${JSON.stringify(motionIndex)}\n`);
    const rejected = await readProviderCpuProfileIndexSet(directory);
    assert.equal(rejected.status, 'partial');
    assert.equal(rejected.invalidIndexCount, 1);

    for (const mutate of [
      (index) => {
        index.profile.schema = 'unknown-profile-ref/v1';
      },
      (index) => {
        index.profile.performanceAcceptanceEligible = true;
      },
      (index) => {
        index.profile.target.unexpected = true;
      },
    ]) {
      const malformedIndex = JSON.parse(
        await readFile(motionIndexPath, 'utf8'),
      );
      malformedIndex.profile.target.captureOrdinal = 5;
      mutate(malformedIndex);
      await writeFile(motionIndexPath, `${JSON.stringify(malformedIndex)}\n`);
      const malformed = await readProviderCpuProfileIndexSet(directory);
      assert.equal(malformed.invalidIndexCount, 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capture CLI validator accepts only the complete six-sample hosted smoke contract', () => {
  const result = validateCaptureCliReport(validCaptureCliReport(), {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.captureCount, 6);
  assert.equal(result.rawReport.schema, 'gev-performance-capture/v1');
  assert.throws(
    () =>
      validateCaptureCliReport(validCaptureCliReport(), {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: 'e'.repeat(64),
      }),
    /Expected values to be strictly equal/,
  );
  const stale = validCaptureCliReport();
  stale.captures[0].fixtureClock.freshBrowserContext = false;
  assert.throws(
    () =>
      validateCaptureCliReport(stale, {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: EXPECTED_FIXTURE_SHA256,
      }),
    /false !== true/,
  );
  const incomplete = validCaptureCliReport();
  incomplete.integrity.sampleCount = 5;
  assert.throws(
    () =>
      validateCaptureCliReport(incomplete, {
        appSha: 'b'.repeat(40),
        harnessSha: 'c'.repeat(40),
        receiptSha256: 'd'.repeat(64),
        fixtureSha256: EXPECTED_FIXTURE_SHA256,
      }),
    /sampleCount/,
  );
});

test('capture CLI accepts verified hosted native reports only with the recomputed ineligibility reason', () => {
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
    captureRendererBackend: NATIVE_MACOS_DIAGNOSTIC_BACKEND,
  };
  const report = addNativeRendererDiagnosticToDenseReport(
    validCaptureCliReport(),
  );
  assert.equal(validateCaptureCliReport(report, expected).status, 'passed');

  const missingReason = structuredClone(report);
  missingReason.comparisonReadiness.reasons =
    missingReason.comparisonReadiness.reasons.filter(
      (reason) =>
        reason !==
        'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
    );
  missingReason.comparisonReadiness.reason =
    missingReason.comparisonReadiness.reasons.join('; ');
  assert.throws(() => validateCaptureCliReport(missingReason, expected));

  const alteredReason = structuredClone(report);
  alteredReason.comparisonReadiness.reasons =
    alteredReason.comparisonReadiness.reasons.map((reason) =>
      reason ===
      'hosted-native-renderer-diagnostic-is-ineligible-for-comparison'
        ? 'hosted-native-renderer-diagnostic-is-eligible-for-comparison'
        : reason,
    );
  alteredReason.comparisonReadiness.reason =
    alteredReason.comparisonReadiness.reasons.join('; ');
  assert.throws(() => validateCaptureCliReport(alteredReason, expected));

  for (const field of ['comparisonEligible', 'hardwareEligible']) {
    const contradictory = structuredClone(report);
    if (field === 'comparisonEligible') contradictory.comparisonEligible = true;
    else contradictory.environment.hardwareEligible = true;
    assert.throws(
      () => validateCaptureCliReport(contradictory, expected),
      `Native diagnostic must keep ${field} false.`,
    );
  }
});

test('shader attribution smoke validation binds serialized producer records and remains ineligible', () => {
  const report = addShaderAttributionToCaptureReport(validCaptureCliReport());
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
    shaderProgramAttribution: true,
  };
  const validation = validateCaptureCliReport(report, expected);
  assert.equal(validation.status, 'passed');
  assert.equal(validation.comparisonEligible, false);
  assert.equal(report.workload.performanceAcceptanceEligible, false);
  assert.equal(
    report.comparisonReadiness.reasons.includes(
      'shader-program-attribution-instrumentation-is-enabled',
    ),
    true,
  );
  assert.equal(
    report.workload.shaderProgramAttribution.documents.length,
    report.workload.startupRuns + 1 + report.captures.length,
  );

  const expectations = buildCaptureCliValidationExpectations({
    build: { receipt: { receiptSha256: expected.receiptSha256 } },
    commit: expected.appSha,
    harnessCommit: expected.harnessSha,
    fixture: {
      sha256: expected.fixtureSha256,
      fixedTime: report.fixtureDelivery.fixedTime,
    },
    providerFixture: 'dense-investigation',
    workerAuditMode: 'diagnostic',
    sceneFrameDiagnostics: false,
    firstMotionCpuProfile: false,
    depthPickAttribution: false,
    shaderProgramAttribution: true,
  });
  assert.equal(expectations.shaderProgramAttribution, true);
  assert.doesNotThrow(() => validateCaptureCliReport(report, expectations));

  for (const [label, mutate] of [
    [
      'missing envelope',
      (copy) => delete copy.workload.shaderProgramAttribution,
    ],
    [
      'incomplete envelope',
      (copy) => (copy.workload.shaderProgramAttribution.status = 'incomplete'),
    ],
    [
      'performance eligible envelope',
      (copy) =>
        (copy.workload.shaderProgramAttribution.performanceAcceptanceEligible = true),
    ],
    [
      'missing document cleanup',
      (copy) => copy.workload.rendererProbeCleanup.pop(),
    ],
    [
      'truncated per-document observation',
      (copy) =>
        (copy.workload.rendererProbeCleanup[0].document.shaderProgramAttribution.status =
          'truncated'),
    ],
    [
      'unconfirmed method restoration',
      (copy) =>
        (copy.workload.rendererProbeCleanup[0].document.shaderProgramAttribution.cleanup.confirmed = false),
    ],
    [
      'summary does not match producer totals',
      (copy) =>
        (copy.workload.shaderProgramAttribution.documents[0].totals.createProgram.calls += 1),
    ],
    [
      'duplicate document identity',
      (copy) =>
        (copy.workload.shaderProgramAttribution.documents[1].documentId =
          copy.workload.shaderProgramAttribution.documents[0].documentId),
    ],
    [
      'jointly forged cleanup and envelope identity',
      (copy) => {
        copy.workload.rendererProbeCleanup[0].documentId =
          'replacement-document';
        copy.workload.shaderProgramAttribution.documents[0].documentId =
          'replacement-document';
      },
    ],
  ]) {
    const invalid = structuredClone(report);
    mutate(invalid);
    assert.throws(
      () => validateCaptureCliReport(invalid, expected),
      undefined,
      label,
    );
  }

  assert.doesNotThrow(() =>
    validateCaptureCliReport(validCaptureCliReport(), {
      ...expected,
      shaderProgramAttribution: false,
    }),
  );
  assert.throws(() =>
    validateCaptureCliReport(report, {
      ...expected,
      shaderProgramAttribution: false,
    }),
  );
});

test('scene frame attribution is bounded and permanently ineligible for comparison', () => {
  const makeEvent = () => {
    const listeners = new Set();
    return {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      fire() {
        for (const listener of listeners) listener();
      },
      get listenerCount() {
        return listeners.size;
      },
    };
  };
  let pageNow = 100;
  const scene = Object.fromEntries(
    ['preUpdate', 'postUpdate', 'preRender', 'postRender'].map((name) => [
      name,
      makeEvent(),
    ]),
  );
  const page = vm.createContext({
    performance: { now: () => pageNow },
    PerformanceObserver: undefined,
  });
  const serializedHelper = vm.runInContext(
    `(${createSceneFrameTimingDiagnostics.toString()})`,
    page,
  );
  const trace = serializedHelper(scene, {
    PerformanceObserverClass: null,
    maxEntries: 32,
  });
  scene.preUpdate.fire();
  pageNow = 103;
  scene.postUpdate.fire();
  scene.preRender.fire();
  pageNow = 121;
  scene.postRender.fire();
  const actualObservation = trace.stop();
  for (const event of Object.values(scene))
    assert.equal(event.listenerCount, 0);

  const report = validCaptureCliReport();
  report.sceneFrameDiagnostics = {
    status: 'completed',
    targetScenario: 'scripted-motion',
    targetRun: 1,
    eligibleForComparison: false,
  };
  report.comparisonReadiness.reasons.push(
    'scene-frame-attribution-instrumentation-is-enabled',
  );
  report.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution = {
    schema: 'gev-scene-frame-attribution/v1',
    status: 'completed',
    scope: 'bounded test evidence',
    cleanup: 'confirmed',
    eligibleForComparison: false,
    observerOriginPerformanceNowMs: actualObservation.originPerformanceNowMs,
    measurementWindowRelativeMs: { startMs: 5, timerFiredMs: 18 },
    observation: actualObservation,
  };
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
    sceneFrameDiagnostics: true,
  };
  assert.doesNotThrow(() => validateCaptureCliReport(report, expected));

  const accepted = structuredClone(report);
  accepted.comparisonEligible = true;
  assert.throws(() => validateCaptureCliReport(accepted, expected));

  const incomplete = structuredClone(report);
  incomplete.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution.status = 'stop-timeout';
  assert.throws(() => validateCaptureCliReport(incomplete, expected));

  const unbounded = structuredClone(report);
  unbounded.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution.observation.entries.longtask = Array(33).fill({
    startMs: 1,
    durationMs: 100,
  });
  assert.throws(() => validateCaptureCliReport(unbounded, expected));

  const unexplained = structuredClone(report);
  unexplained.comparisonReadiness.reasons = [];
  assert.throws(() => validateCaptureCliReport(unexplained, expected));

  const wrongTarget = structuredClone(report);
  wrongTarget.sceneFrameDiagnostics.targetRun = 2;
  assert.throws(() => validateCaptureCliReport(wrongTarget, expected));

  const malformedSpan = structuredClone(report);
  malformedSpan.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution.observation.spans.render = [
    { startMs: 5000, durationMs: -1 },
  ];
  assert.throws(() => validateCaptureCliReport(malformedSpan, expected));

  const malformedEntry = structuredClone(report);
  malformedEntry.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution.observation.entries.longtask = [
    { startMs: -1, durationMs: 1 },
  ];
  assert.throws(() => validateCaptureCliReport(malformedEntry, expected));

  const unexpectedDiagnosticField = structuredClone(report);
  unexpectedDiagnosticField.captures.find(
    (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
  ).sceneFrameAttribution.observation.providerUrl =
    'https://example.invalid/private';
  assert.throws(() =>
    validateCaptureCliReport(unexpectedDiagnosticField, expected),
  );
});

test('capture CLI validates the selected infrastructure workload and rejects dense substitution', () => {
  const report = validInfrastructureCaptureCliReport();
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: report.workload.fixture.sha256,
    providerFixture: 'infrastructure-datacenters',
    fixedTime: report.workload.fixture.fixedTime,
    infrastructureFixture: createInfrastructureWorkloadFixture(
      'infrastructure-datacenters',
      report.workload.fixture.fixedTime,
    ),
  };
  const result = validateCaptureCliReport(report, expected);
  assert.equal(result.status, 'passed');
  assert.equal(result.comparisonEligible, false);
  assert.equal(result.providerFixture, expected.providerFixture);
  assert.equal(result.captureCount, 4);

  const missingIndependentFixture = { ...expected };
  delete missingIndependentFixture.infrastructureFixture;
  assert.throws(() =>
    validateCaptureCliReport(report, missingIndependentFixture),
  );
  assert.throws(() =>
    validateCaptureCliReport(report, {
      ...expected,
      infrastructureFixture: createInfrastructureWorkloadFixture(
        'infrastructure-dams',
        expected.fixedTime,
      ),
    }),
  );

  const missingMeasuredAudit = validInfrastructureCaptureCliReport();
  const missingMeasuredDocument =
    missingMeasuredAudit.source.buildProvenance.pageAssetAudit.workerAuditDocuments.find(
      (entry) => entry.documentRole === 'main-measured',
    );
  missingMeasuredDocument.validation = null;
  missingMeasuredDocument.observedWorkerTargetCount = 0;
  missingMeasuredDocument.observedBlobRequestCount = 0;
  missingMeasuredDocument.restoration.createdScriptBlobCountAtRestore = 0;
  missingMeasuredDocument.restoration.auditedCreatedScriptBlobCount = 0;
  missingMeasuredAudit.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits.pop();
  assert.throws(
    () => validateCaptureCliReport(missingMeasuredAudit, expected),
    /Missing receipt-derived worker audit for main-measured/,
  );

  const missingSetupAudit = validInfrastructureCaptureCliReport();
  const missingSetupDocument =
    missingSetupAudit.source.buildProvenance.pageAssetAudit.workerAuditDocuments.find(
      (entry) => entry.documentRole === 'startup-1',
    );
  missingSetupDocument.validation = null;
  assert.throws(
    () => validateCaptureCliReport(missingSetupAudit, expected),
    /1 !== 0|observedWorkerTargetCount|worker target|worker audit|validated document audits/,
  );

  const emptyStartupAudit = validInfrastructureCaptureCliReport();
  const emptyStartupDocument =
    emptyStartupAudit.source.buildProvenance.pageAssetAudit
      .workerAuditDocuments[0];
  emptyStartupDocument.validation = null;
  emptyStartupDocument.observedWorkerTargetCount = 0;
  emptyStartupDocument.observedBlobRequestCount = 0;
  emptyStartupDocument.restoration.createdScriptBlobCountAtRestore = 0;
  emptyStartupDocument.restoration.auditedCreatedScriptBlobCount = 0;
  emptyStartupAudit.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits.shift();
  assert.doesNotThrow(() =>
    validateCaptureCliReport(emptyStartupAudit, expected),
  );

  const unownedObservation = validInfrastructureCaptureCliReport();
  unownedObservation.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits.push(
    { status: 'receipt-derived-worker-blobs-validated' },
  );
  assert.throws(
    () => validateCaptureCliReport(unownedObservation, expected),
    /one-to-one with validated document audits/,
  );

  const duplicatedObservation = validInfrastructureCaptureCliReport();
  const duplicateAudits =
    duplicatedObservation.source.buildProvenance.pageAssetAudit
      .cesiumWorkerBlobAudits;
  duplicateAudits[1] = structuredClone(duplicateAudits[0]);
  assert.throws(
    () => validateCaptureCliReport(duplicatedObservation, expected),
    /one-to-one with validated document audits|preserve each document validation in order/,
  );

  const malformedObservation = validInfrastructureCaptureCliReport();
  malformedObservation.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits[0].schema =
    'unknown-worker-audit/v9';
  assert.throws(() => validateCaptureCliReport(malformedObservation, expected));

  const emptyObservations = validInfrastructureCaptureCliReport();
  emptyObservations.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits =
    [];
  assert.throws(
    () => validateCaptureCliReport(emptyObservations, expected),
    /0 !== 2/,
  );

  const inconsistentWorkerSource = validInfrastructureCaptureCliReport();
  inconsistentWorkerSource.source.buildProvenance.pageAssetAudit.workerAuditDocuments[1].validation.embeddedWorkerSourceSha256 =
    'f'.repeat(64);
  assert.throws(
    () => validateCaptureCliReport(inconsistentWorkerSource, expected),
    /preserve each document validation in order/,
  );

  const crossDocumentWorkerSource = validInfrastructureCaptureCliReport();
  crossDocumentWorkerSource.source.buildProvenance.pageAssetAudit.workerAuditDocuments[0].validation.embeddedWorkerSourceSha256 =
    'f'.repeat(64);
  crossDocumentWorkerSource.source.buildProvenance.pageAssetAudit.cesiumWorkerBlobAudits[0].embeddedWorkerSourceSha256 =
    'f'.repeat(64);
  assert.throws(
    () => validateCaptureCliReport(crossDocumentWorkerSource, expected),
    /2 !== 1/,
  );

  const splitMeasuredDocument = validInfrastructureCaptureCliReport();
  splitMeasuredDocument.captures[2].documentId = 'other-measured-document';
  assert.throws(
    () => validateCaptureCliReport(splitMeasuredDocument, expected),
    /main-measured-document/,
  );

  const wrongDocumentRole = validInfrastructureCaptureCliReport();
  wrongDocumentRole.captures[0].documentRole = 'provider-sample-1';
  assert.throws(
    () => validateCaptureCliReport(wrongDocumentRole, expected),
    /main-measured/,
  );

  const missingSampleDocumentId = validInfrastructureCaptureCliReport();
  delete missingSampleDocumentId.captures[1].documentId;
  assert.throws(
    () => validateCaptureCliReport(missingSampleDocumentId, expected),
    /main-measured-document/,
  );

  const wrongWorkerDocumentId = validInfrastructureCaptureCliReport();
  wrongWorkerDocumentId.source.buildProvenance.pageAssetAudit.workerAuditDocuments[1].documentId =
    'wrong-main-document';
  assert.throws(
    () => validateCaptureCliReport(wrongWorkerDocumentId, expected),
    /main-measured-document/,
  );

  const duplicateDiagnosticDocumentId = validInfrastructureCaptureCliReport();
  duplicateDiagnosticDocumentId.performanceDiagnostics.documents[0].documentId =
    'main-measured-document';
  assert.throws(
    () => validateCaptureCliReport(duplicateDiagnosticDocumentId, expected),
    /startup-document-1/,
  );

  const duplicateWorkerRole = validInfrastructureCaptureCliReport();
  duplicateWorkerRole.source.buildProvenance.pageAssetAudit.workerAuditDocuments[1].documentRole =
    'startup-1';
  assert.throws(
    () => validateCaptureCliReport(duplicateWorkerRole, expected),
    /deep-equal|deepStrictEqual|startup-1/,
  );

  const missingProviderFixture = validInfrastructureCaptureCliReport();
  delete missingProviderFixture.workload.providerFixture;
  assert.throws(
    () => validateCaptureCliReport(missingProviderFixture, expected),
    /Expected values to be strictly equal/,
  );

  const missingFixtureId = validInfrastructureCaptureCliReport();
  delete missingFixtureId.workload.fixtureId;
  assert.throws(
    () => validateCaptureCliReport(missingFixtureId, expected),
    /Expected values to be strictly equal/,
  );

  const wrongCommitEvidence = validInfrastructureCaptureCliReport();
  wrongCommitEvidence.source.harnessCommit = 'a'.repeat(40);
  assert.throws(() => validateCaptureCliReport(wrongCommitEvidence, expected));

  const wrongCount = validInfrastructureCaptureCliReport();
  wrongCount.captures[0].layers[0].count += 1;
  assert.throws(() => validateCaptureCliReport(wrongCount, expected));

  const wrongWorkload = validInfrastructureCaptureCliReport(
    'infrastructure-dams',
  );
  assert.throws(() =>
    validateCaptureCliReport(wrongWorkload, {
      ...expected,
      providerFixture: 'infrastructure-datacenters',
    }),
  );
});

test('Austin renderer retirements exactly match startup and provider sample boundaries', () => {
  const topology = createCaptureDocumentTopology({
    startupRuns: 1,
    captureCount: 4,
  });
  const captures = topology.samples.map((document, index) => ({
    ...document,
    scenario: index < 2 ? 'idle' : 'scripted-motion',
    run: (index % 2) + 1,
    renderLoopRetirement: {
      requested: true,
      status: 'retired-at-final-post-render',
      before: true,
      after: false,
      confirmed: true,
      elapsedMs: index / 10,
    },
  }));
  const startup = {
    phase: 'startup-final-details',
    ...topology.workerAudits[0],
    requested: true,
    status: 'retired-with-final-observation',
    before: true,
    after: false,
    confirmed: true,
    elapsedMs: 0.1,
  };
  const retirements = [
    startup,
    ...captures.map((capture) => ({
      phase: 'provider-sample-measurement-post-render',
      scenario: capture.scenario,
      run: capture.run,
      documentRole: capture.documentRole,
      documentId: capture.documentId,
      ...capture.renderLoopRetirement,
    })),
  ];
  const workload = {
    rendererLoopRetirements: retirements,
    rendererLoopRetirementsOmittedCount: 0,
  };

  assert.doesNotThrow(() =>
    assertRendererLoopRetirementEvidence({ workload, topology, captures }),
  );

  const cases = [
    ['missing sample retirement', (copy) => copy.splice(2, 1)],
    ['duplicate retirement', (copy) => copy.push(structuredClone(copy[1]))],
    [
      'unknown document retirement',
      (copy) => (copy[1].documentId = 'unknown-document'),
    ],
    ['wrong sample phase', (copy) => (copy[1].phase = 'setup')],
    ['wrong sample scenario', (copy) => (copy[1].scenario = 'unrelated')],
    ['wrong sample run', (copy) => (copy[1].run = 3)],
    ['unconfirmed sample', (copy) => (copy[1].confirmed = false)],
    ['retirement did not stop loop', (copy) => (copy[1].after = true)],
    ['startup has wrong status', (copy) => (copy[0].status = 'confirmed')],
    ['non-finite retirement time', (copy) => (copy[1].elapsedMs = NaN)],
  ];
  for (const [label, mutate] of cases) {
    const invalid = structuredClone(workload);
    mutate(invalid.rendererLoopRetirements);
    assert.throws(
      () =>
        assertRendererLoopRetirementEvidence({
          workload: invalid,
          topology,
          captures,
        }),
      undefined,
      label,
    );
  }

  const captureMismatch = structuredClone(captures);
  captureMismatch[0].renderLoopRetirement.elapsedMs += 1;
  assert.throws(
    () =>
      assertRendererLoopRetirementEvidence({
        workload,
        topology,
        captures: captureMismatch,
      }),
    /elapsedMs must match its capture boundary/,
  );
  const missingCaptureRetirement = structuredClone(captures);
  delete missingCaptureRetirement[0].renderLoopRetirement;
  assert.throws(
    () =>
      assertRendererLoopRetirementEvidence({
        workload,
        topology,
        captures: missingCaptureRetirement,
      }),
    /must include its observed render-loop retirement/,
  );
});

test('full cleanup validator replays a raw Austin report and rejects release mutations', async () => {
  const replay = JSON.parse(
    await readFile(
      new URL(
        './performance/fixtures/austin-cleanup-replay-38330061064.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(replay.schema, 'gev-austin-capture-cleanup-replay/v1');
  assert.equal(
    replay.sourceReportSha256,
    'b9762d40eb00428077677758269e06d37ebb2b7d2a61214698715eec012bcbc6',
  );
  const topology = createCaptureDocumentTopology({
    startupRuns: 1,
    captureCount: replay.captures.length,
  });
  const validate = (candidate) =>
    assertCaptureCleanupEvidence(candidate.workload, topology, {
      captures: candidate.captures,
    });
  assert.equal(replay.workload.rendererProbeCleanup.length, 6);
  assert.equal(replay.workload.rendererLoopRetirements.length, 5);
  assert.equal(replay.workload.fixtureInterceptionReleases.length, 6);
  assert.doesNotThrow(() => validate(replay));

  const mutations = [
    [
      'missing startup release',
      (copy) => copy.workload.fixtureInterceptionReleases.splice(0, 1),
    ],
    [
      'missing sample release',
      (copy) => copy.workload.fixtureInterceptionReleases.pop(),
    ],
    [
      'duplicate release',
      (copy) =>
        copy.workload.fixtureInterceptionReleases.push(
          structuredClone(copy.workload.fixtureInterceptionReleases[0]),
        ),
    ],
    [
      'unknown release owner',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].documentId =
          'unknown-document'),
    ],
    [
      'unconfirmed release',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].confirmed = false),
    ],
    [
      'target not closed',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].targetClosed = false),
    ],
    [
      'undrained command',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].stop.pendingCommandsAfterDrain = 1),
    ],
    [
      'nested drain failure',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].interception.interception.drainCommandFailures = 1),
    ],
    [
      'unconfirmed renderer cleanup',
      (copy) => (copy.workload.rendererProbeCleanup[0].confirmed = false),
    ],
    [
      'missing retirement',
      (copy) => copy.workload.rendererLoopRetirements.pop(),
    ],
  ];
  for (const [label, mutate] of mutations) {
    const invalid = structuredClone(replay);
    mutate(invalid);
    assert.throws(() => validate(invalid), undefined, label);
  }
});

test('full Austin CLI validator accepts the recorded producer projection and rejects contract mutations', async () => {
  const compressedReportBytes = await readFile(
    new URL(
      './performance/fixtures/austin-cli-projection-replay-38332484324.json.gz',
      import.meta.url,
    ),
  );
  const reportBytes = gunzipSync(compressedReportBytes);
  const report = JSON.parse(reportBytes.toString('utf8'));
  assert.equal(reportBytes.length, 3_676_548, 'historical report byte length');
  assert.equal(
    createHash('sha256').update(reportBytes).digest('hex'),
    'eddeff6538198e2854875effaed7d3e830cd9fc2488017377881d9ef498d371e',
    'historical report bytes must stay fixed for this structural replay',
  );
  assert.equal(
    createHash('sha256').update(compressedReportBytes).digest('hex'),
    '550346cc6592621d175edd2affea93fc2760d08cde6ffc001c3e8570e10bb17d',
    'compressed replay fixture bytes must stay fixed',
  );
  assert.equal(
    report.source.appCommit,
    '78e0417244856a2a3d2905ab618d32b909507eb6',
  );
  assert.equal(
    report.source.harnessCommit,
    '78e0417244856a2a3d2905ab618d32b909507eb6',
  );
  assert.equal(
    report.source.buildProvenance.receiptSha256,
    'ff605b9885dfdf20ae51983f4197949f11076d4096e363bc71b6c7c17aca88a3',
  );
  const pageAudit = report.source.buildProvenance.pageAssetAudit;
  const expected = {
    appSha: report.source.appCommit,
    harnessSha: report.source.harnessCommit,
    receiptSha256: report.source.buildProvenance.receiptSha256,
    providerFixture: report.workload.providerFixture,
    austinOperatingFixture: report.workload.fixture,
    fixedTime: report.workload.fixture.fixedTime,
    workerAuditMode: 'receipt-only',
    captureRendererBackend: NATIVE_MACOS_DIAGNOSTIC_BACKEND,
    sceneFrameDiagnostics: true,
    firstMotionCpuProfile: false,
    depthPickAttribution: false,
    shaderProgramAttribution: false,
    // This is a structural replay of a historical report. These receipt and
    // asset identities bind the replay to its saved report; they are not a
    // fresh served-asset provenance check.
    receiptOnlyWorkerContract: {
      assetPaths: [
        'index.html',
        'assets/egm96-universal.esm-D6y_VLZc.js',
        'assets/index-D3_XUlb8.js',
        'cesium/Cesium.js',
      ],
      bundleSha256: pageAudit.workerSource.bundleSha256,
      workerSourceSha256: pageAudit.workerSource.workerSourceSha256,
      allowedModuleCount: pageAudit.workerSource.allowedModuleCount,
    },
  };

  // The pre-fix consumer compared a compact projection with raw delivery rows,
  // so this actual producer report was rejected despite a canonical contract.
  assert.throws(() =>
    assert.deepEqual(
      report.comparisonContract.fixtureDelivery.sampleDocuments,
      report.fixtureDelivery.sampleDocuments,
    ),
  );
  const validation = validateCaptureCliReport(report, expected);
  assert.equal(validation.status, 'passed');
  assert.equal(validation.captureCount, 4);

  const canonicalContract = report.comparisonContract;
  const rejectedContract = (mutate) => {
    const alteredContract = structuredClone(canonicalContract);
    mutate(alteredContract);
    report.comparisonContract = alteredContract;
    assert.throws(
      () => validateCaptureCliReport(report, expected),
      /Austin comparison contract must equal the canonical projection of observed producer data/,
    );
  };
  report.comparisonContract = undefined;
  assert.throws(
    () => validateCaptureCliReport(report, expected),
    /Austin comparison contract must equal the canonical projection of observed producer data/,
  );
  rejectedContract((contract) => {
    contract.fixtureDelivery.sampleDocuments[0].populations.after[0].count += 1;
  });
  rejectedContract((contract) => {
    contract.routes.idle.start.position.x += 1;
  });
  rejectedContract((contract) => {
    contract.browser.version = 'forged-browser-version';
  });
  rejectedContract((contract) => {
    contract.rendering.drawingBuffer.width += 1;
  });
  rejectedContract((contract) => {
    contract.workload.durationPerSampleMs += 1;
  });
  rejectedContract((contract) => {
    contract.fixtureDelivery.sampleDocuments.pop();
  });
  rejectedContract((contract) => {
    contract.fixtureDelivery.sampleDocuments.push(
      structuredClone(contract.fixtureDelivery.sampleDocuments.at(-1)),
    );
  });
  rejectedContract((contract) => {
    contract.fixtureDelivery.fixtureSha256 = 'f'.repeat(64);
  });
});

test('capture CLI validates the actual weather fixture manifest, timeline, states and worker topology', async () => {
  const { report, fixture } = await validWeatherEffectsCaptureCliReport();
  const expected = {
    appSha: report.source.appCommit,
    harnessSha: report.source.harnessCommit,
    receiptSha256: report.source.buildProvenance.receiptSha256,
    fixtureSha256: fixture.sha256,
    providerFixture: WEATHER_EFFECTS_WORKLOAD_ID,
    fixedTime: fixture.fixedTime,
    weatherEffectsFixture: fixture,
    workerAuditMode: 'diagnostic',
    sceneFrameDiagnostics: false,
    firstMotionCpuProfile: false,
    depthPickAttribution: false,
  };
  assert.deepEqual(
    buildCaptureCliValidationExpectations({
      build: {
        receipt: { receiptSha256: expected.receiptSha256 },
      },
      commit: expected.appSha,
      harnessCommit: expected.harnessSha,
      fixture,
      providerFixture: WEATHER_EFFECTS_WORKLOAD_ID,
      workerAuditMode: 'diagnostic',
      sceneFrameDiagnostics: false,
      firstMotionCpuProfile: false,
      depthPickAttribution: false,
    }),
    expected,
  );
  const result = validateCaptureCliReport(report, expected);
  assert.equal(result.status, 'passed');
  assert.equal(result.captureCount, 4);
  assert.equal(result.comparisonEligible, false);
  const inFlightAtShutdown = structuredClone(report);
  inFlightAtShutdown.workload.fixtureInterceptionReleases[0].stop.pendingAtStop = 2;
  inFlightAtShutdown.workload.fixtureInterceptionReleases[0].interception.interception.pendingCommandsAtStop = 1;
  assert.doesNotThrow(() =>
    validateCaptureCliReport(inFlightAtShutdown, expected),
  );

  for (const [label, mutate] of [
    [
      'unconfirmed renderer cleanup',
      (copy) => (copy.workload.rendererProbeCleanup[0].confirmed = false),
    ],
    [
      'missing renderer cleanup',
      (copy) => (copy.workload.rendererProbeCleanup = []),
    ],
    [
      'mismatched renderer cleanup owner',
      (copy) =>
        (copy.workload.rendererProbeCleanup[1].documentId = 'wrong-document'),
    ],
    [
      'unconfirmed interception release',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].confirmed = false),
    ],
    [
      'missing interception release',
      (copy) => (copy.workload.fixtureInterceptionReleases = []),
    ],
    [
      'mismatched interception release owner',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].documentId =
          'wrong-document'),
    ],
    [
      'missing startup retirement',
      (copy) => (copy.workload.rendererLoopRetirements = []),
    ],
    [
      'mismatched startup retirement owner',
      (copy) =>
        (copy.workload.rendererLoopRetirements[0].documentId =
          'wrong-document'),
    ],
    [
      'unconfirmed measured render-loop retirement',
      (copy) =>
        (copy.workload.rendererProbeCleanup[1].document.renderLoopRetirement.confirmed = false),
    ],
    [
      'missing listener removal counts',
      (copy) => {
        delete copy.workload.rendererProbeCleanup[0].document
          .listenerRemovalAttemptedCount;
        delete copy.workload.rendererProbeCleanup[0].document
          .listenerRemovalConfirmedCount;
      },
    ],
    [
      'retirement has wrong phase',
      (copy) =>
        (copy.workload.rendererLoopRetirements[0].phase = 'unrelated-success'),
    ],
    [
      'nested interception drain failure',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].interception.interception.drainCommandFailures = 1),
    ],
    [
      'missing nested in-flight count',
      (copy) =>
        delete copy.workload.fixtureInterceptionReleases[0].interception
          .interception.pendingCommandsAtStop,
    ],
    [
      'nested interception did not close',
      (copy) =>
        (copy.workload.fixtureInterceptionReleases[0].interception.fetchDisable =
          'failed'),
    ],
  ]) {
    const invalid = structuredClone(report);
    mutate(invalid);
    assert.throws(
      () => validateCaptureCliReport(invalid, expected),
      undefined,
      label,
    );
  }

  const missingFixture = { ...expected };
  delete missingFixture.weatherEffectsFixture;
  assert.throws(() => validateCaptureCliReport(report, missingFixture));

  const repeatedFrames = structuredClone(report);
  repeatedFrames.workload.weatherEffectsFixtureLifecycle.timeline[1] =
    repeatedFrames.workload.weatherEffectsFixtureLifecycle.timeline[0];
  repeatedFrames.fixtureDelivery.timelinePreflight.selectedTimes[1] =
    repeatedFrames.fixtureDelivery.timelinePreflight.selectedTimes[0];
  assert.throws(() => validateCaptureCliReport(repeatedFrames, expected));

  const wrongSourceTime = structuredClone(report);
  wrongSourceTime.captures[0].weatherEffectsClock.weatherStateBefore.sourceObservationTimes[0] =
    fixture.fixedTime;
  wrongSourceTime.captures[0].weatherEffectsClock.weatherStateBefore.sourceObservationTimes[1] =
    '2026-10-08T11:40:00.000Z';
  assert.throws(() => validateCaptureCliReport(wrongSourceTime, expected));

  const missingWorkerCoverage = structuredClone(report);
  missingWorkerCoverage.source.buildProvenance.pageAssetAudit.workerAuditDocuments.pop();
  assert.throws(() =>
    validateCaptureCliReport(missingWorkerCoverage, expected),
  );

  const unpausedWind = structuredClone(report);
  unpausedWind.captures[0].weatherEffectsClock.weatherStateAfter.wind.paused = true;
  assert.throws(() => validateCaptureCliReport(unpausedWind, expected));

  const decreasingResponseCount = structuredClone(report);
  decreasingResponseCount.captures[2].fixtureDelivery.assets[0].responseCount =
    decreasingResponseCount.captures[1].fixtureDelivery.assets[0]
      .responseCount - 1;
  assert.throws(
    () => validateCaptureCliReport(decreasingResponseCount, expected),
    /decreased in capture order/,
  );

  const responseCountAboveAggregate = structuredClone(report);
  responseCountAboveAggregate.captures[0].fixtureDelivery.assets[0].responseCount =
    responseCountAboveAggregate.fixtureDelivery.assets[0].responseCount + 1;
  assert.throws(
    () => validateCaptureCliReport(responseCountAboveAggregate, expected),
    /exceeds the final aggregate/,
  );

  const wrongSampleAssetHash = structuredClone(report);
  wrongSampleAssetHash.captures[0].fixtureDelivery.assets[0].sha256 =
    'f'.repeat(64);
  assert.throws(
    () => validateCaptureCliReport(wrongSampleAssetHash, expected),
    /deep-equal|deepStrictEqual/,
  );

  const repeatedSampleTuple = structuredClone(report);
  repeatedSampleTuple.captures[1].run = 1;
  assert.throws(
    () => validateCaptureCliReport(repeatedSampleTuple, expected),
    /deep-equal|deepStrictEqual/,
  );

  const missingSourceObservation = structuredClone(report);
  missingSourceObservation.captures[0].weatherEffectsClock.weatherStateBefore.sourceObservationTimes =
    [];
  assert.throws(
    () => validateCaptureCliReport(missingSourceObservation, expected),
    /0 !== 3|false == true/,
  );

  const sameButWrongCesiumClock = structuredClone(report);
  for (const key of ['cesiumBefore', 'cesiumAfter'])
    sameButWrongCesiumClock.captures[0].weatherEffectsClock[
      key
    ].currentTime.secondsOfDay += 10;
  assert.throws(
    () => validateCaptureCliReport(sameButWrongCesiumClock, expected),
    /assert\.ok/,
  );

  const extraEnabledLayer = structuredClone(report);
  extraEnabledLayer.fixtureDelivery.populationsBefore.push({
    id: 'local-datacenters',
    enabled: true,
    count: 4362,
  });
  assert.throws(
    () => validateCaptureCliReport(extraEnabledLayer, expected),
    /populations|deep-equal|deepStrictEqual/,
  );

  const movedCamera = structuredClone(report);
  movedCamera.fixtureDelivery.cameraObservation.longitudeDeg += 0.01;
  movedCamera.workload.weatherEffectsFixtureLifecycle.observedCamera.longitudeDeg += 0.01;
  assert.throws(
    () => validateCaptureCliReport(movedCamera, expected),
    /camera longitudeDeg/,
  );
});

test('infrastructure capture requires rendered motion, consistent frame evidence, and requested settings', () => {
  const makeExpected = (report) => ({
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: report.workload.fixture.sha256,
    providerFixture: 'infrastructure-datacenters',
    fixedTime: report.workload.fixture.fixedTime,
    infrastructureFixture: createInfrastructureWorkloadFixture(
      'infrastructure-datacenters',
      report.workload.fixture.fixedTime,
    ),
  });
  const refreshDerivedComparison = (report) => {
    report.comparisonContract = createObservedInfrastructureComparisonContract({
      fixture: report.workload.fixture,
      fixtureDelivery: report.fixtureDelivery,
      environment: report.environment,
      captures: report.captures,
      scenarios: report.workload.scenarios,
    });
    report.comparisonReadiness = {
      status: 'not-ready',
      reasons: getCaptureComparisonIneligibilityReasons({
        contract: report.comparisonContract,
        fixture: report.workload.fixture,
        fixtureDelivery: report.fixtureDelivery,
        source: report.source,
        environment: report.environment,
        workload: report.workload,
        captures: report.captures,
        diagnosticsDocuments: report.performanceDiagnostics.documents,
        workerBlobAuditInstrumented: true,
        workerBlobAuditMode: 'diagnostic',
        hardwareRequired: false,
      }),
    };
  };

  const valid = validInfrastructureCaptureCliReport();
  assert.doesNotThrow(() =>
    validateCaptureCliReport(valid, makeExpected(valid)),
  );

  const zeroMotion = validInfrastructureCaptureCliReport();
  const motion = zeroMotion.captures.find(
    (sample) => sample.scenario === 'scripted-motion',
  );
  motion.frameCount = 0;
  motion.renderedFrameCount = 0;
  motion.frameIntervalMs = { p50: null, p95: null, max: null, samples: 0 };
  assert.throws(
    () => validateCaptureCliReport(zeroMotion, makeExpected(zeroMotion)),
    /at least two rendered frames/,
  );

  const missingEvidence = validInfrastructureCaptureCliReport();
  delete missingEvidence.captures[0].frameCount;
  assert.throws(
    () =>
      validateCaptureCliReport(missingEvidence, makeExpected(missingEvidence)),
    /frame count is missing or invalid/,
  );

  const inconsistent = validInfrastructureCaptureCliReport();
  inconsistent.captures[0].frameIntervalMs.samples -= 1;
  assert.throws(
    () => validateCaptureCliReport(inconsistent, makeExpected(inconsistent)),
    /frame interval samples do not match/,
  );

  const wrongDensity = validInfrastructureCaptureCliReport();
  for (const sample of wrongDensity.captures) {
    sample.settings.before.densityPct = 50;
    sample.settings.after.densityPct = 50;
  }
  refreshDerivedComparison(wrongDensity);
  assert.throws(
    () => validateCaptureCliReport(wrongDensity, makeExpected(wrongDensity)),
    /50 !== 75/,
  );

  const wrongDetection = validInfrastructureCaptureCliReport();
  for (const sample of wrongDetection.captures) {
    sample.settings.before.detectionMode = 'SPARSE';
    sample.settings.after.detectionMode = 'SPARSE';
  }
  refreshDerivedComparison(wrongDetection);
  assert.throws(
    () =>
      validateCaptureCliReport(wrongDetection, makeExpected(wrongDetection)),
    /'SPARSE' !== 'DENSE'/,
  );

  const idleWithoutFrames = validInfrastructureCaptureCliReport();
  const idle = idleWithoutFrames.captures.find(
    (sample) => sample.scenario === 'idle',
  );
  idle.frameCount = 0;
  idle.renderedFrameCount = 0;
  idle.frameIntervalMs = { p50: null, p95: null, max: null, samples: 0 };
  assert.doesNotThrow(() =>
    validateCaptureCliReport(
      idleWithoutFrames,
      makeExpected(idleWithoutFrames),
    ),
  );
});

test('capture CLI checks diagnostic status for every document and accepts legacy baseline hook absence', () => {
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
  };
  const incomplete = validCaptureCliReport();
  incomplete.performanceDiagnostics.documents.pop();
  assert.throws(() => validateCaptureCliReport(incomplete, expected));

  const baseline = validCaptureCliReport();
  const baselineSha = 'eb8c6828d0d03e1c04bda94c8c4fb99915a577b7';
  baseline.source.appCommit = baselineSha;
  for (const entry of baseline.performanceDiagnostics.documents) {
    entry.hookAvailable = false;
    entry.disabled = false;
  }
  assert.doesNotThrow(() =>
    validateCaptureCliReport(baseline, { ...expected, appSha: baselineSha }),
  );
});

test('capture CLI accepts empty startup worker audits only when no worker path was observed', () => {
  const report = validCaptureCliReport();
  const documents =
    report.source.buildProvenance.pageAssetAudit.workerAuditDocuments;
  for (const entry of documents.slice(0, 2)) {
    entry.validation = null;
    entry.restoration.createdScriptBlobCountAtRestore = 0;
    entry.restoration.auditedCreatedScriptBlobCount = 0;
    entry.observedWorkerTargetCount = 0;
    entry.observedBlobRequestCount = 0;
  }
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
  };
  assert.doesNotThrow(() => validateCaptureCliReport(report, expected));

  documents[0].observedWorkerTargetCount = 1;
  assert.throws(() => validateCaptureCliReport(report, expected));
});

test('capture CLI validator requires the selected worker audit mode and per-sample prewarm proof', () => {
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
    workerAuditMode: 'prewarm',
  };
  const report = validCaptureCliReport('prewarm');
  const result = validateCaptureCliReport(report, expected);
  assert.equal(result.comparisonEligible, false);
  assert.throws(() =>
    validateCaptureCliReport(report, {
      ...expected,
      workerAuditMode: 'diagnostic',
    }),
  );
  const missingLateCheck = validCaptureCliReport('prewarm');
  delete missingLateCheck.source.buildProvenance.pageAssetAudit
    .workerAuditDocuments[2].lateUseCheck;
  assert.throws(() => validateCaptureCliReport(missingLateCheck, expected));
  const missingRestore = validCaptureCliReport('prewarm');
  missingRestore.source.buildProvenance.pageAssetAudit.workerAuditDocuments[2].restoration.registryEmpty = false;
  assert.throws(() => validateCaptureCliReport(missingRestore, expected));
  const wrongPerDocumentMode = validCaptureCliReport('prewarm');
  wrongPerDocumentMode.source.buildProvenance.pageAssetAudit.workerAuditDocuments[2].mode =
    'diagnostic';
  assert.throws(() => validateCaptureCliReport(wrongPerDocumentMode, expected));
});

test('capture CLI rejects missing, altered or unreported comparison contracts', () => {
  const expected = {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
  };
  const missing = validCaptureCliReport();
  delete missing.comparisonContract;
  assert.throws(() => validateCaptureCliReport(missing, expected));

  const altered = validCaptureCliReport();
  altered.comparisonContract.fixture.sha256 = 'e'.repeat(64);
  assert.throws(() => validateCaptureCliReport(altered, expected));

  const unreportedReason = validCaptureCliReport();
  unreportedReason.comparisonReadiness.reasons = [];
  assert.throws(() => validateCaptureCliReport(unreportedReason, expected));
});

test('capture CLI requires usable frame-interval evidence for moving and tracking samples', () => {
  const invalidCases = [
    [
      'empty',
      (sample) => {
        sample.renderedFrameCount = 0;
        sample.frameCount = 0;
        sample.frameIntervalMs = { p95: null, samples: 0 };
      },
    ],
    [
      'one rendered frame',
      (sample) => {
        sample.renderedFrameCount = 1;
        sample.frameCount = 0;
        sample.frameIntervalMs = { p95: null, samples: 0 };
      },
    ],
    [
      'missing p95',
      (sample) => {
        sample.frameIntervalMs.p95 = null;
      },
    ],
    [
      'non-finite p95',
      (sample) => {
        sample.frameIntervalMs.p95 = Number.NaN;
      },
    ],
    [
      'interval count mismatch',
      (sample) => {
        sample.frameIntervalMs.samples -= 1;
      },
    ],
  ];
  for (const scenario of ['scripted-motion', 'selected-aircraft-tracking']) {
    for (const [label, corrupt] of invalidCases) {
      const report = validCaptureCliReport();
      corrupt(report.captures.find((sample) => sample.scenario === scenario));
      assert.throws(
        () =>
          validateCaptureCliReport(report, {
            appSha: 'b'.repeat(40),
            harnessSha: 'c'.repeat(40),
            receiptSha256: 'd'.repeat(64),
            fixtureSha256: EXPECTED_FIXTURE_SHA256,
          }),
        new RegExp(`${scenario} run 1`),
        `${scenario} should reject ${label} frame evidence`,
      );
    }
  }
});

test('capture CLI preserves legitimately unavailable zero-frame idle timing', () => {
  const report = validCaptureCliReport();
  for (const sample of report.captures.filter(
    (entry) => entry.scenario === 'idle',
  )) {
    sample.renderedFrameCount = 0;
    sample.frameCount = 0;
    sample.frameIntervalMs = { p50: null, p95: null, max: null, samples: 0 };
  }
  const validated = validateCaptureCliReport(report, {
    appSha: 'b'.repeat(40),
    harnessSha: 'c'.repeat(40),
    receiptSha256: 'd'.repeat(64),
    fixtureSha256: EXPECTED_FIXTURE_SHA256,
  });
  assert.equal(validated.captureCount, 6);
});

test('smoke compaction preserves the complete bounded capture failure report and mismatch evidence', () => {
  const rawReport = {
    schema: 'gev-performance-capture-failure/v1',
    status: 'failed',
    comparisonEligible: false,
    source: { appCommit: 'b'.repeat(40), harnessCommit: 'c'.repeat(40) },
    fixtureDelivery: { status: 'observed', fulfilledResponseCount: 3 },
    failure: {
      phase: 'repeated-workload-check',
      scenario: 'idle',
      run: 2,
      message: 'Repeated workload changed.',
      operator: 'deepStrictEqual',
      actual: { camera: { x: 4 } },
      expected: { camera: { x: 3 } },
    },
    progress: {
      completedSampleCount: 2,
      completedSamplesRetained: 2,
      completedSamples: [
        { scenario: 'idle', run: 1, frameCount: 60 },
        { scenario: 'scripted-motion', run: 1, frameCount: 60 },
      ],
    },
    evidenceTruncated: false,
  };
  const serialized = `${JSON.stringify(rawReport, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );

  const compacted = compactCaptureCliFailure(rawReport);
  assert.equal(compacted.schema, 'gev-smoke-capture-cli-failure/v1');
  assert.deepEqual(compacted.rawReport, rawReport);
  assert.equal(compacted.summary.failure.phase, 'repeated-workload-check');
  assert.equal(compacted.summary.failure.operator, 'deepStrictEqual');
  assert.deepEqual(compacted.summary.failure.actual, { camera: { x: 4 } });
  assert.deepEqual(compacted.summary.failure.expected, { camera: { x: 3 } });
  assert.equal(compacted.summary.completedSampleCount, 2);
  assert.equal(compacted.summary.completedSamplesRetained, 2);
  assert.equal(compacted.summary.evidenceTruncated, false);
  assert.equal(compacted.rawReportTruncated, false);
});

test('smoke compaction preserves a bounded completed capture report after outer validation failure', () => {
  const completedReport = {
    schema: 'gev-performance-capture/v1',
    comparisonEligible: false,
    source: { appCommit: 'b'.repeat(40), harnessCommit: 'c'.repeat(40) },
    captures: [{ scenario: 'idle', run: 1, frames: 0 }],
    page: {
      pageUrl: 'http://127.0.0.1:4173/@fs/C:/Users/Private/source.mjs',
      responseUrl: 'https://example.invalid/assets/app.js?token=secret',
      body: 'large or private response data',
    },
  };
  const compacted = compactCaptureCliFailure(completedReport);
  assert.equal(compacted.summary.reportSchema, 'gev-performance-capture/v1');
  assert.equal(compacted.rawReport.schema, 'gev-performance-capture/v1');
  assert.equal(compacted.rawReport.page.pageUrl, '[url]');
  assert.equal(compacted.rawReport.page.responseUrl, '[url]');
  assert.equal(compacted.rawReport.page.body, undefined);
  assert.equal(compacted.rawReportTruncated, false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(compacted.rawReport), 'utf8') <=
      MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );
});

test('smoke compaction marks bounded completed reports truncated and rejects projections over the artifact cap', () => {
  const truncated = compactCaptureCliFailure({
    schema: 'gev-performance-capture/v1',
    samples: Array.from({ length: 300 }, (_, index) => ({ index })),
  });
  assert.equal(truncated.rawReport.schema, 'gev-performance-capture/v1');
  assert.equal(truncated.rawReport.samples.length, 256);
  assert.equal(truncated.rawReportTruncated, true);

  const oversized = compactCaptureCliFailure({
    schema: 'gev-performance-capture/v1',
    details: Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `field${index}`,
        Array.from({ length: 5 }, () => 'x'.repeat(1100)),
      ]),
    ),
  });
  assert.equal(oversized.rawReport, undefined);
  assert.match(oversized.rawReportUnavailable, /bounded artifact limit/);
});

test('smoke compaction does not label an unbounded or unrecognized report as raw failure evidence', () => {
  const compacted = compactCaptureCliFailure({
    schema: 'legacy-capture-report',
    status: 'failed',
    failure: { message: 'legacy failure' },
    progress: { completedSampleCount: 1, completedSamples: [{ run: 1 }] },
  });
  assert.equal(compacted.rawReport, undefined);
  assert.match(compacted.rawReportUnavailable, /recognized capture schema/);
  assert.equal(compacted.summary.completedSampleCount, 1);
});

test('bounded child runner stops an owned process on timeout', async () => {
  const started = Date.now();
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 150,
      maxOutputBytes: 2048,
    }),
    /timed out; .*cleanup confirmed/,
  );
  assert.ok(Date.now() - started < 5000);
});

test('bounded child runner stops an owned process when output exceeds its cap', async () => {
  await assert.rejects(
    runBoundedChild(
      process.execPath,
      [
        '-e',
        'process.stdout.write("x".repeat(8192)); setInterval(() => {}, 1000)',
      ],
      { timeoutMs: 3000, maxOutputBytes: 2048 },
    ),
    /output limit exceeded; .*cleanup confirmed/,
  );
});

test('bounded child runner stops a separately owned browser process', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-owned-child-test-'),
  );
  const pidPath = path.join(tempRoot, 'browser.pid');
  let ownedPid = null;
  t.after(async () => {
    if (ownedPid) {
      try {
        process.kill(ownedPid, 'SIGKILL');
      } catch {
        // It may already be gone.
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  });
  const code = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', code], {
      timeoutMs: 200,
      maxOutputBytes: 2048,
      ownedPidFile: pidPath,
    }),
    /timed out; .*cleanup confirmed/,
  );
  ownedPid = Number((await readFile(pidPath, 'utf8')).trim());
  if (process.platform !== 'win32')
    assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
});

test('bounded child runner cleans the owned browser when the CLI exits with failure', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-failed-child-test-'),
  );
  const pidPath = path.join(tempRoot, 'browser.pid');
  let ownedPid = null;
  t.after(async () => {
    if (ownedPid) {
      try {
        process.kill(ownedPid, 'SIGKILL');
      } catch {
        // It may already be gone.
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  });
  const code = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    'setTimeout(() => process.exit(17), 50);',
  ].join('\n');
  await assert.rejects(
    runBoundedChild(process.execPath, ['-e', code], {
      timeoutMs: 3000,
      maxOutputBytes: 2048,
      ownedPidFile: pidPath,
    }),
    /exited 17; .*cleanup confirmed/,
  );
  ownedPid = Number((await readFile(pidPath, 'utf8')).trim());
  if (process.platform !== 'win32')
    assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
});

test('bounded child failure keeps sanitized stderr and the latest capture progress', async () => {
  await assert.rejects(
    runBoundedChild(
      process.execPath,
      [
        '-e',
        'console.log("[performance] startup 1/1"); console.error("fixture failed at https://secret.invalid/token"); process.exit(2)',
      ],
      { timeoutMs: 3000, maxOutputBytes: 2048 },
    ),
    (error) => {
      assert.match(error.message, /fixture failed at \[url\]/);
      assert.doesNotMatch(error.message, /secret\.invalid/);
      assert.deepEqual(error.childDiagnostics.progressLines, [
        '[performance] startup 1 of 1',
      ]);
      return true;
    },
  );
});

test('capture CLI preserves hash-bound raw reports on success and failure', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-capture-report-artifact-'),
  );
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const reportPath = path.join(tempRoot, 'capture.json');
  const artifactPath = path.join(tempRoot, 'smoke.capture-report.json');
  const raw = Buffer.from(
    JSON.stringify({
      schema: 'gev-performance-capture/v1',
      status: 'complete',
    }),
  );
  const success = await executeCaptureCliWithReportArtifact({
    runChild: async () => writeFile(reportPath, raw),
    reportPath,
    artifactPath,
  });
  assert.deepEqual(await readFile(artifactPath), raw);
  assert.equal(success.artifact.status, 'preserved');
  assert.equal(success.artifact.childStatus, 'completed');
  assert.equal(success.artifact.byteLength, raw.byteLength);
  assert.equal(
    success.artifact.sha256,
    createHash('sha256').update(raw).digest('hex'),
  );

  const failedReportPath = path.join(tempRoot, 'failed-capture.json');
  const failedArtifactPath = path.join(tempRoot, 'smoke.failed-capture.json');
  const failedRaw = Buffer.from(
    JSON.stringify({
      schema: 'gev-performance-capture/v1',
      status: 'complete',
      captures: [{ scenario: 'scripted-motion', run: 1 }],
    }),
  );
  await assert.rejects(
    executeCaptureCliWithReportArtifact({
      runChild: async () => {
        await writeFile(failedReportPath, failedRaw);
        throw new Error('capture child failed');
      },
      reportPath: failedReportPath,
      artifactPath: failedArtifactPath,
    }),
    (error) => {
      assert.equal(error.message, 'capture child failed');
      assert.equal(error.captureCliReport.status, 'complete');
      assert.equal(error.captureCliReportArtifact.status, 'preserved');
      assert.equal(error.captureCliReportArtifact.childStatus, 'failed');
      return true;
    },
  );
  assert.deepEqual(await readFile(failedArtifactPath), failedRaw);
});

test('capture CLI report sidecar marks missing, malformed, and oversized reports', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-capture-report-bounds-'),
  );
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const missing = await preserveCaptureCliReportArtifact(
    path.join(tempRoot, 'missing.json'),
    path.join(tempRoot, 'missing-sidecar.json'),
  );
  assert.equal(missing.status, 'missing');
  assert.equal(missing.sha256, null);

  const malformedPath = path.join(tempRoot, 'malformed.json');
  const malformedArtifact = path.join(tempRoot, 'malformed-sidecar.json');
  const malformedBytes = Buffer.from('{ invalid JSON');
  await writeFile(malformedPath, malformedBytes);
  await assert.rejects(
    executeCaptureCliWithReportArtifact({
      runChild: async () => {},
      reportPath: malformedPath,
      artifactPath: malformedArtifact,
    }),
    (error) => {
      assert.equal(error.captureCliReportArtifact.status, 'preserved');
      assert.equal(error.captureCliReportArtifact.childStatus, 'completed');
      return error instanceof SyntaxError;
    },
  );
  assert.deepEqual(await readFile(malformedArtifact), malformedBytes);

  const oversizedPath = path.join(tempRoot, 'oversized.json');
  const oversizedArtifact = path.join(tempRoot, 'oversized-sidecar.json');
  await writeFile(
    oversizedPath,
    Buffer.alloc(MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES + 1, 0x61),
  );
  const oversized = await preserveCaptureCliReportArtifact(
    oversizedPath,
    oversizedArtifact,
  );
  assert.equal(oversized.status, 'oversize');
  assert.equal(oversized.byteLength, MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES + 1);
  await assert.rejects(readFile(oversizedArtifact), { code: 'ENOENT' });
});

test('capture CLI closes the browser after page creation fails inside its lifecycle', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-capture-cli-lifecycle-test-'),
  );
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));
  const witnessPath = path.join(tempRoot, 'browser-lifecycle.txt');
  const mockPuppeteerPath = path.join(tempRoot, 'mock-puppeteer.mjs');
  const preloadPath = path.join(tempRoot, 'mock-loader.mjs');
  const reportPath = path.join(tempRoot, 'capture-failure.json');
  await writeFile(
    mockPuppeteerPath,
    `import { appendFileSync } from 'node:fs';
const witness = process.env.GEV_CAPTURE_BROWSER_WITNESS;
const record = (value) => appendFileSync(witness, value + '\\n');
const puppeteer = {
  executablePath: async () => 'mock-chrome',
  launch: async () => ({
    createBrowserContext: async () => ({
      newPage: async () => { record('new-page'); throw new Error('sentinel-new-page-failure'); },
    }),
    close: async () => record('browser-close'),
  }),
};
export const CDPSessionEvent = { Disconnected: Symbol('CDPSession.Disconnected') };
export default puppeteer;
`,
  );
  await writeFile(
    preloadPath,
    `import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'puppeteer') return { url: pathToFileURL(${JSON.stringify(mockPuppeteerPath)}).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preloadPath).href,
      path.join(ROOT, 'scripts', 'capture-scene-performance.mjs'),
      '--url',
      'http://127.0.0.1:4173',
      '--runs',
      '1',
      '--startup-runs',
      '1',
      '--warmup-ms',
      '0',
      '--seconds',
      '1',
      '--headless',
      '--out',
      reportPath,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      env: {
        ...process.env,
        GEV_CAPTURE_BROWSER_WITNESS: witnessPath,
      },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /sentinel-new-page-failure/);
  assert.doesNotMatch(result.stderr, /page is not defined|ReferenceError/);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.schema, 'gev-performance-capture-failure/v1');
  assert.match(report.failure.message, /sentinel-new-page-failure/);
  assert.deepEqual(
    (await readFile(witnessPath, 'utf8')).trim().split(/\r?\n/),
    ['new-page', 'browser-close'],
  );
});

test('invalid smoke input writes a bounded failure artifact without launching a browser', async (t) => {
  const parent = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(
    path.join(parent, 'gev-build-smoke-cli-test-'),
  );
  t.after(async () => {
    const canonical = await realpath(tempRoot);
    assert.equal(path.dirname(canonical), parent);
    assert.ok(path.basename(canonical).startsWith('gev-build-smoke-cli-test-'));
    await rm(canonical, { recursive: true, force: false });
  });
  const reportPath = path.join(tempRoot, 'smoke.json');
  const dependencyWitnessPath = path.join(tempRoot, 'browser-dependencies.txt');
  const preloadPath = path.join(tempRoot, 'watch-browser-dependencies.mjs');
  await writeFile(
    preloadPath,
    `import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'puppeteer' || specifier === 'cesium' || specifier.endsWith('/qa-application-fixtures.mjs')) {
    appendFileSync(process.env.GEV_SMOKE_IMPORT_WITNESS, specifier + '\\n');
    throw new Error('invalid CLI resolved a forbidden browser dependency');
  }
  return nextResolve(specifier, context);
} });\n`,
  );
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preloadPath).href,
      path.join(ROOT, 'scripts', 'qa-performance-build-smoke.mjs'),
      '--candidate-sha',
      'invalid',
      '--out',
      reportPath,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: {
        ...process.env,
        GEV_SMOKE_IMPORT_WITNESS: dependencyWitnessPath,
      },
    },
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(
    result.status,
    1,
    JSON.stringify({
      status: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
      elapsedMs,
      stdout: result.stdout?.slice(0, 500) ?? '',
      stderr: result.stderr?.slice(0, 500) ?? '',
    }),
  );
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.schema, 'gev-performance-build-smoke/v1');
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.phase, 'setup');
  assert.match(report.failure.message, /full lowercase Git SHA/);
  await assert.rejects(readFile(dependencyWitnessPath), { code: 'ENOENT' });
});
