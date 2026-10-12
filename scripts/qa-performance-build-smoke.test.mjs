import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
  assertProviderFixtureCaptureClock,
  buildCaptureCliValidationExpectations,
  compactCaptureCliFailure,
  executeCaptureCliWithReportArtifact,
  parseSmokeArguments,
  preserveCaptureCliReportArtifact,
  readProviderCpuProfileIndexSet,
  runBoundedChild,
  validateCaptureCliReport,
} from './qa-performance-build-smoke.mjs';
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
    /dense investigation fixture/,
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
