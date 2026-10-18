#!/usr/bin/env node
/** Capture comparable scene timings from an already running app. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer, { CDPSessionEvent } from 'puppeteer';
import { evaluateMotionFrameBudget } from './performance/motionBudget.mjs';
import {
  assertCaptureIntegrity,
  deriveNativeSharpnessProfile,
} from './performance/captureIntegrity.mjs';
import { routeDescriptorsEquivalent } from './performance/routeEquivalence.mjs';
import {
  beginCaptureBuildProvenance,
  projectPublicCaptureBuildProvenance,
} from './performance/captureBuildProvenance.mjs';
import {
  MAP_FIXTURE_BUILD_PROFILE_ID,
  resolveMapFixtureBuildProfile,
} from './performance/buildProvenance.mjs';
import { MAP_STREAMING_WORKLOAD_ID } from './performance/mapStreamingWorkloadContract.mjs';
import {
  closeTargetBeforeFixtureInterceptionRelease,
  createFixtureInterceptionErrorRecorder,
  interceptFixtureSession,
} from './performance/fixtureInterception.mjs';
import { closeReceiptOnlyAuditPage } from './performance/receiptOnlyPageClose.mjs';
import {
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  expectedFixtureRunOrdinal,
  installFixtureWallClockOnPage,
  holdProviderWarmupBoundary,
  assertObservedTrackingRoute,
  respondToProductionFlightFixture,
} from './performance/productionFlightFixture.mjs';
import {
  createBoundaryProgressRecorder,
  observeRenderBoundary,
  prepareRenderBoundaryProgressBinding,
} from './performance/renderBoundaryObservation.mjs';
import { runSceneMeasurementWithHostDeadline } from './performance/sceneMeasurementDeadline.mjs';
import { evaluateCompletedRenderDiagnostic } from './performance/settleCompletedRenderDiagnostic.mjs';
import {
  appendAustinOperatingReadinessHistory,
  createAustinOperatingReadinessHistoryEnvelope,
  createAustinOperatingReadinessHistory,
  observeAustinInstallationsReadyForRenderBoundary,
  waitForAustinOperatingReadiness,
} from './performance/austinOperatingReadinessHistory.mjs';
import {
  describeObservedRoute,
  observeCommonScene,
} from './performance/commonSceneObserver.mjs';
import {
  applyNativeSharpnessProfile,
  assertNativeSharpnessProfile,
} from './performance/nativeSharpnessProfile.mjs';
import {
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
import {
  assertVerifiedNativeRendererEvidence,
  nativeRendererDiagnosticEvidence,
  rendererLaunchArgs,
  validateNativeRendererDiagnosticHost,
} from './performance/hostedRendererBackend.mjs';
import {
  cleanupEarlyCesiumRendererProbeWithEvidence,
  createShaderProgramAttributionEnvelope,
  installEarlyCesiumRendererProbe,
  retireEarlyCesiumRendererProbeForCapturePage,
  readEarlyCesiumRendererProbe,
} from './performance/earlyCesiumRendererProbe.mjs';
import { persistShaderProgramAttributionCheckpoint } from './performance/shaderProgramAttributionArtifact.mjs';
import {
  createEntityFollowRoute,
  observeTrackedEntityBoundary,
} from './performance/trackingRoute.mjs';
import {
  deriveCesiumEmbeddedWorkerContract,
  resolveCesiumBundlePath,
  classifyLateWorkerAuditObservations,
  installCesiumWorkerBlobAudit,
  MAX_WORKER_BLOB_RECORDS,
  MAX_WORKER_TARGETS,
  readAndRestoreCesiumWorkerBodies,
  restoreCesiumWorkerBlobAudit,
  summarizeWorkerAuditBoundary,
  validatePrewarmedWorkerUse,
  validateCesiumWorkerBlobs,
} from './performance/cesiumWorkerBlobContract.mjs';
import {
  runWorkerAuditAtWarmupBoundary,
  readProviderWarmupBoundarySnapshot,
  PREWARM_WORKER_AUDIT_BOUNDARY,
} from './performance/prewarmWorkerAuditBoundary.mjs';
import {
  createCaptureFailureReport,
  writeCaptureFailureReportFile,
} from './performance/captureFailureReport.mjs';
import { disableOptionalPerformanceDiagnostics } from './performance/captureDiagnosticsControl.mjs';
import { createSceneFrameTimingDiagnostics } from './performance/importFrameDiagnostics.mjs';
import { runBoundedBoundaryProfile } from './performance/boundedCpuProfile.mjs';
import {
  createProviderSampleCpuProfileWindow,
  isProviderSampleCpuProfileTarget,
  upsertProviderSampleCpuProfile,
} from './performance/providerSampleCpuProfileWindow.mjs';
import { retireProviderDocument } from './performance/providerDocumentRetirement.mjs';
import { observeTerminalViewerState } from './performance/terminalViewerObservation.mjs';
import {
  createDepthPickAttributionIdentity,
  depthPickRetirementConfirmed,
  disposeDepthPickAttributionForPage as disposeDepthPickPageOwner,
  installDepthPickAttribution,
  observeDepthPickAttributionBoundary,
  retainDepthPickBoundaryFailure,
} from './performance/depthPickAttribution.mjs';
import {
  createObservedDenseComparisonContract,
  createObservedAustinOperatingComparisonContract,
  createObservedMapStreamingComparisonContract,
  createObservedInfrastructureComparisonContract,
  createObservedWeatherEffectsComparisonContract,
  createCaptureDocumentTopology,
  getMainCaptureDocumentIdentity,
  getCaptureReadinessReasons,
  readSettledRenderBoundaryElapsedMs,
} from './performance/captureComparisonContract.mjs';
import {
  assertInfrastructureClockObservation,
  INFRASTRUCTURE_WORKLOAD_IDS,
} from './performance/infrastructureWorkloadContract.mjs';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_WORKLOAD_ID,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
} from './performance/austinOperatingWorkloadContract.mjs';
import { createAustinOperatingDocumentEvidence } from './performance/austinOperatingDocumentEvidence.mjs';
import {
  createReceiptOnlyWorkerAuditCollector,
  validateReceiptOnlyWorkerAuditEnvelope,
} from './performance/receiptOnlyWorkerAudit.mjs';
import {
  assertAustinPopulationEvidence,
  assertAustinStableCatalogs,
  normalizeAustinSatelliteWitness,
  summarizeAustinNativePopulations,
} from './performance/austinOperatingPopulationEvidence.mjs';
import {
  settlePostMeasurementSourceChanges,
  waitForPostMeasurementSourceDrain,
} from './performance/postMeasurementSourceDrain.mjs';
import { activateForegroundPage } from './performance/foregroundPageActivation.mjs';
import {
  createWindowsForegroundActivationSession,
  focusOwnedWindowsBrowserWindow,
} from './performance/windowsForegroundWindow.mjs';
import { evaluateForegroundSampleContinuity } from './performance/foregroundSampleContinuity.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://localhost:4173');
// The default is the release-comparison workload from S47. Short exploratory
// captures remain available by passing --seconds/--warmup-ms/--runs explicitly.
const seconds = Math.max(1, Number(option('--seconds', '60')) || 60);
const warmupMs = Math.max(0, Number(option('--warmup-ms', '30000')) || 0);
const runs = Math.max(1, Math.min(10, Number(option('--runs', '5')) || 5));
// Zero delegates device scale to the native browser/OS configuration; the
// observer records the resulting window.devicePixelRatio for each document.
const declaredDeviceScaleFactor = Math.max(
  0,
  Number(option('--device-scale-factor', '0')) || 0,
);
const comparisonProfile = option('--comparison-profile', 'native-sharpness-v1');
if (!['native-sharpness-v1', 'legacy'].includes(comparisonProfile))
  throw new Error(
    '--comparison-profile must be native-sharpness-v1 or legacy.',
  );
const delayMs = Math.max(0, Number(option('--inject-delay-ms', '0')) || 0);
const maxP95Ms = Number(option('--max-p95-ms', '0')) || 0;
const fixtureAircraftCount = Number(option('--fixture-aircraft', '0'));
const providerFixtureMode = option('--provider-fixture', null);
const infrastructureWorkloadSelected =
  INFRASTRUCTURE_WORKLOAD_IDS.includes(providerFixtureMode);
const WEATHER_EFFECTS_WORKLOAD_ID = 'austin-weather-effects-phased-v2';
const weatherPhaseDiagnostic = args.includes('--weather-phase-diagnostic');
const austinOperatingWorkloadSelected =
  providerFixtureMode === AUSTIN_OPERATING_WORKLOAD_ID;
if (
  austinOperatingWorkloadSelected &&
  (warmupMs % 1000 !== 0 || (seconds * 1000) % 1000 !== 0)
)
  throw new TypeError(
    'Austin operating capture requires whole-second warmup and measurement durations.',
  );
const mapStreamingWorkloadSelected =
  providerFixtureMode === MAP_STREAMING_WORKLOAD_ID;
let mapStreamingModule = null;
let mapStreamingDeliveryFactory = null;
let mapStreamingFixture = null;
let mapStreamingJourney = null;
let mapStreamingJourneys = [];
let mapStreamingCaptureReport = null;
let mapStreamingFinalEvidence = null;
const mapStreamingFixtureOwners = [];
let austinOperatingModule = null;
let austinOperatingWorkload = null;
let austinSatelliteEpochModule = null;
let austinSatelliteEpochReference = null;
const providerFixtureTime = option(
  '--provider-fixture-time',
  '2026-10-08T12:00:00.000Z',
);
const workerAuditMode = option('--worker-audit-mode', 'diagnostic');
const sceneFrameDiagnosticsEnabled = args.includes('--scene-frame-diagnostics');
const austinReadinessHistoryEnabled =
  sceneFrameDiagnosticsEnabled && austinOperatingWorkloadSelected;
const firstMotionCpuProfileEnabled = args.includes(
  '--first-motion-cpu-profile',
);
const depthPickAttributionEnabled = args.includes('--depth-pick-attribution');
const shaderProgramAttributionEnabled = args.includes(
  '--shader-program-attribution',
);
const cpuProfileArtifactDirectory = option(
  '--cpu-profile-artifact-directory',
  null,
);
let weatherEffectsModule = null;
let weatherEffectsWorkload = null;
if (providerFixtureMode === WEATHER_EFFECTS_WORKLOAD_ID) {
  if (providerFixtureTime !== '2026-10-08T12:00:00.000Z')
    throw new TypeError(
      'Weather-effects fixture time must be 2026-10-08T12:00:00.000Z.',
    );
  weatherEffectsModule =
    await import('./performance/weatherEffectsWorkloadFixture.mjs');
  weatherEffectsWorkload =
    weatherEffectsModule.createWeatherEffectsWorkloadFixture(
      providerFixtureTime,
    );
  const comparisonRun = warmupMs === 30_000 && seconds === 60 && runs === 5;
  const diagnosticRun = warmupMs === 1_000 && seconds === 60 && runs === 1;
  if (weatherPhaseDiagnostic ? !diagnosticRun : !comparisonRun)
    throw new TypeError(
      'Phased weather/effects requires either the exact 30s/60s/5-run comparison contract or the explicit 1s/60s/1-run producer diagnostic.',
    );
} else if (weatherPhaseDiagnostic) {
  throw new TypeError(
    '--weather-phase-diagnostic requires the phased weather/effects fixture.',
  );
}
if (mapStreamingWorkloadSelected) {
  if (warmupMs !== 30_000 || seconds !== 60 || runs !== 5)
    throw new TypeError(
      'Map streaming comparison requires the exact 30s warmup, 60s measurement and five-run contract.',
    );
  if (delayMs !== 0)
    throw new TypeError(
      'Map streaming comparison cannot use an injected delay.',
    );
}
if (!['diagnostic', 'prewarm', 'receipt-only'].includes(workerAuditMode))
  throw new Error(
    '--worker-audit-mode must be diagnostic, prewarm or receipt-only.',
  );
if (
  providerFixtureMode?.startsWith('infrastructure') &&
  !infrastructureWorkloadSelected
)
  throw new TypeError(
    `Unsupported infrastructure workload: ${providerFixtureMode}`,
  );
if (
  providerFixtureMode &&
  providerFixtureMode !== 'dense-investigation' &&
  !infrastructureWorkloadSelected &&
  !weatherEffectsWorkload &&
  !austinOperatingWorkloadSelected &&
  !mapStreamingWorkloadSelected
)
  throw new Error(
    '--provider-fixture must be dense-investigation or a registered static workload.',
  );
if (
  providerFixtureMode &&
  (fixtureAircraftCount !== 0 || !args.includes('--mixed-layers')) &&
  providerFixtureMode === 'dense-investigation'
)
  throw new Error(
    'The dense provider fixture requires --mixed-layers and must not use --fixture-aircraft.',
  );
if (
  (infrastructureWorkloadSelected ||
    weatherEffectsWorkload ||
    austinOperatingWorkloadSelected ||
    mapStreamingWorkloadSelected) &&
  (fixtureAircraftCount !== 0 || args.includes('--mixed-layers'))
)
  throw new Error(
    'Infrastructure workloads select their exact layer population and cannot use aircraft or --mixed-layers.',
  );
const productionFlightFixture =
  providerFixtureMode === 'dense-investigation'
    ? createProductionFlightFixture({
        count: 2500,
        fixedTime: providerFixtureTime,
      })
    : null;
const qualityMode = option('--quality-mode', 'manual');
const detectionMode = String(option('--detection-mode', 'DENSE')).toUpperCase();
const mixedLayers = args.includes('--mixed-layers');
const effectiveFixtureAircraftCount = productionFlightFixture
  ? productionFlightFixture.count
  : fixtureAircraftCount || (mixedLayers ? 2500 : 0);
const expectedDensityPct = Number(
  option(
    '--expected-density',
    (effectiveFixtureAircraftCount ||
      austinOperatingWorkloadSelected ||
      infrastructureWorkloadSelected ||
      weatherEffectsWorkload) &&
      qualityMode === 'manual'
      ? '75'
      : 'NaN',
  ),
);
const startupRuns = Math.max(
  1,
  Math.min(5, Number(option('--startup-runs', String(runs))) || runs),
);
const startupDocumentTopology = createCaptureDocumentTopology({
  infrastructure: Boolean(
    infrastructureWorkloadSelected || weatherEffectsWorkload,
  ),
  startupRuns,
});
const mainCaptureDocumentIdentity = getMainCaptureDocumentIdentity({
  infrastructure: Boolean(
    infrastructureWorkloadSelected || weatherEffectsWorkload,
  ),
  startupRuns,
});
const protocolTimeoutMs = Math.max(
  10_000,
  Math.min(
    600_000,
    Number(option('--protocol-timeout-ms', '300000')) || 300_000,
  ),
);
const fixtureTimeoutMs = Math.max(
  1_000,
  Math.min(180_000, Number(option('--fixture-timeout-ms', '90000')) || 90_000),
);
const out = option('--out', null);
// Diagnostic-only raw frame trace. It is intentionally opt-in and excluded
// from normal comparison reports because per-frame records add measurable
// serialization overhead.
const frameTraceOut = option('--frame-trace-out', null);
if (
  args.includes('--frame-trace-out') &&
  (!frameTraceOut || frameTraceOut.startsWith('--'))
)
  throw new Error(
    '--frame-trace-out requires a separate diagnostic output path.',
  );
if (frameTraceOut && out && path.resolve(frameTraceOut) === path.resolve(out))
  throw new Error('--frame-trace-out must differ from --out.');
const frameTraceEnabled = Boolean(frameTraceOut);
const ownedBrowserPidFile = option('--owned-browser-pid-file', null);
const hardwareRequired = args.includes('--hardware-required');
const softwareRendering = args.includes('--software-rendering');
const hostedFixture = args.includes('--hosted-fixture');
const nativeRenderingDiagnostic = args.includes(
  '--native-rendering-diagnostic',
);
if (nativeRenderingDiagnostic) validateNativeRendererDiagnosticHost();
if (hardwareRequired && softwareRendering)
  throw new Error(
    '--hardware-required cannot be combined with --software-rendering',
  );
if (nativeRenderingDiagnostic && softwareRendering)
  throw new Error(
    '--native-rendering-diagnostic cannot be combined with --software-rendering',
  );
if (nativeRenderingDiagnostic && hardwareRequired)
  throw new Error(
    '--native-rendering-diagnostic is diagnostic-only and cannot be combined with --hardware-required',
  );
const appCommitOverride = option('--app-commit', null);
const appWorktreeStateOverride = option('--app-worktree-state', null);
const buildProvenanceOptions = {
  receipt: option('--build-receipt', null),
  checkoutRoot: option('--app-checkout', null),
  harnessRoot: option('--harness-checkout', null),
  buildHarnessRoot: option('--build-harness-checkout', null),
  buildRoot: option('--build-root', null),
  expectedAppCommit: option('--expected-app-sha', null),
  expectedHarnessCommit: option('--expected-harness-sha', null),
  expectedBuildHarnessCommit: option('--expected-build-harness-sha', null),
  baseUrl: option('--served-base-url', null),
};
const buildProfileOptionIndex = args.indexOf('--build-profile');
const expectedBuildProfile = option('--build-profile', null);
if (
  buildProfileOptionIndex >= 0 &&
  (expectedBuildProfile == null || expectedBuildProfile.startsWith('--'))
)
  throw new Error('--build-profile requires a value.');
resolveMapFixtureBuildProfile(expectedBuildProfile);
if (
  mapStreamingWorkloadSelected &&
  expectedBuildProfile !== MAP_FIXTURE_BUILD_PROFILE_ID
)
  throw new Error(
    `Map streaming capture requires --build-profile ${MAP_FIXTURE_BUILD_PROFILE_ID}.`,
  );
if (mapStreamingWorkloadSelected && workerAuditMode !== 'diagnostic')
  throw new Error(
    'Map streaming capture supports diagnostic worker auditing only.',
  );
const buildProvenanceEnabled = Object.values(buildProvenanceOptions).some(
  Boolean,
);
if (
  (buildProvenanceOptions.buildHarnessRoot &&
    !buildProvenanceOptions.expectedBuildHarnessCommit) ||
  (!buildProvenanceOptions.buildHarnessRoot &&
    buildProvenanceOptions.expectedBuildHarnessCommit)
)
  throw new Error(
    '--build-harness-checkout and --expected-build-harness-sha must be supplied together.',
  );
if (buildProvenanceEnabled && !buildProvenanceOptions.buildHarnessRoot)
  buildProvenanceOptions.buildHarnessRoot = buildProvenanceOptions.harnessRoot;
if (
  buildProvenanceEnabled &&
  !buildProvenanceOptions.expectedBuildHarnessCommit
)
  buildProvenanceOptions.expectedBuildHarnessCommit =
    buildProvenanceOptions.expectedHarnessCommit;
if (
  buildProvenanceEnabled &&
  Object.values(buildProvenanceOptions).some((value) => !value)
)
  throw new Error(
    'Verified capture requires --build-receipt, --app-checkout, --harness-checkout, --build-root, --expected-app-sha, --expected-harness-sha and --served-base-url together.',
  );
if (expectedBuildProfile && !buildProvenanceEnabled)
  throw new Error('--build-profile requires a verified build receipt.');
if (
  (productionFlightFixture ||
    infrastructureWorkloadSelected ||
    weatherEffectsWorkload ||
    austinOperatingWorkloadSelected ||
    mapStreamingWorkloadSelected) &&
  !buildProvenanceEnabled
)
  throw new Error(
    'Comparison fixtures require verified build provenance options.',
  );
if (workerAuditMode === 'prewarm' && !productionFlightFixture)
  throw new Error(
    'Prewarm worker auditing requires the verified dense production fixture.',
  );
if (
  workerAuditMode === 'receipt-only' &&
  providerFixtureMode !== 'dense-investigation' &&
  !infrastructureWorkloadSelected &&
  !austinOperatingWorkloadSelected &&
  !weatherEffectsWorkload
)
  throw new Error(
    'Receipt-only worker auditing requires a verified dense, infrastructure, Austin operating, or phased weather fixture.',
  );
if (
  sceneFrameDiagnosticsEnabled &&
  !productionFlightFixture &&
  !austinOperatingWorkloadSelected
)
  throw new Error(
    '--scene-frame-diagnostics requires --provider-fixture dense-investigation or austin-operating-v1.',
  );
if (firstMotionCpuProfileEnabled && !productionFlightFixture)
  throw new Error(
    '--first-motion-cpu-profile requires --provider-fixture dense-investigation.',
  );
if (depthPickAttributionEnabled && !productionFlightFixture)
  throw new Error(
    '--depth-pick-attribution requires --provider-fixture dense-investigation.',
  );
if (shaderProgramAttributionEnabled && !productionFlightFixture)
  throw new Error(
    '--shader-program-attribution requires --provider-fixture dense-investigation.',
  );
if (firstMotionCpuProfileEnabled && !cpuProfileArtifactDirectory)
  throw new Error(
    '--first-motion-cpu-profile requires --cpu-profile-artifact-directory.',
  );
if (!firstMotionCpuProfileEnabled && cpuProfileArtifactDirectory)
  throw new Error(
    '--cpu-profile-artifact-directory requires --first-motion-cpu-profile.',
  );
if (
  hostedFixture &&
  (!(
    productionFlightFixture ||
    infrastructureWorkloadSelected ||
    weatherEffectsWorkload ||
    austinOperatingWorkloadSelected ||
    mapStreamingWorkloadSelected
  ) ||
    !(softwareRendering || nativeRenderingDiagnostic) ||
    !buildProvenanceEnabled)
)
  throw new Error(
    '--hosted-fixture requires a registered verified fixture and an explicit hosted rendering backend.',
  );
if (
  nativeRenderingDiagnostic &&
  (!hostedFixture ||
    !buildProvenanceEnabled ||
    !(
      productionFlightFixture ||
      infrastructureWorkloadSelected ||
      weatherEffectsWorkload ||
      austinOperatingWorkloadSelected ||
      mapStreamingWorkloadSelected
    ))
)
  throw new Error(
    '--native-rendering-diagnostic requires a registered verified hosted fixture.',
  );
const actualHarnessRoot = await fs.realpath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
function harnessSourceRevision(root) {
  try {
    const runGit = (gitArgs) =>
      execFileSync('git', ['-C', root, ...gitArgs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return {
      commit: runGit(['rev-parse', 'HEAD']) || null,
      dirtyWorktree: Boolean(runGit(['status', '--porcelain'])),
      reason: null,
    };
  } catch {
    return {
      commit: null,
      dirtyWorktree: null,
      reason: 'Git revision is unavailable outside a readable repository.',
    };
  }
}
const harnessSource = harnessSourceRevision(actualHarnessRoot);
let captureProvenance = null;
let captureWorkerContract = null;
let buildReceipt = null;
if (buildProvenanceEnabled) {
  buildReceipt = JSON.parse(
    await fs.readFile(buildProvenanceOptions.receipt, 'utf8'),
  );
  const requestedHarnessRoot = await fs.realpath(
    buildProvenanceOptions.harnessRoot,
  );
  if (requestedHarnessRoot !== actualHarnessRoot)
    throw new Error(
      'Explicit harness checkout is not the checkout containing this capture script.',
    );
  if (buildProvenanceOptions.expectedHarnessCommit !== harnessSource.commit)
    throw new Error(
      'Expected harness SHA does not match the capture checkout.',
    );
  if (harnessSource.dirtyWorktree !== false)
    throw new Error('Verified capture requires a clean harness checkout.');
  if (
    appCommitOverride &&
    appCommitOverride !== buildProvenanceOptions.expectedAppCommit
  )
    throw new Error(
      '--app-commit differs from the verified build receipt SHA.',
    );
  captureProvenance = await beginCaptureBuildProvenance({
    ...buildProvenanceOptions,
    receipt: buildReceipt,
    harnessRoot: requestedHarnessRoot,
    actualHarnessRoot,
    captureUrl: url,
    expectedBuildProfile,
    captureProducerCommit: harnessSource.commit,
  });
  const bundlePath = resolveCesiumBundlePath(buildReceipt.assets);
  captureWorkerContract = deriveCesiumEmbeddedWorkerContract({
    bundlePath,
    bundleBytes: await fs.readFile(
      path.join(buildProvenanceOptions.buildRoot, ...bundlePath.split('/')),
    ),
    assets: buildReceipt.assets,
  });
  if (effectiveFixtureAircraftCount && !productionFlightFixture)
    throw new Error(
      'The aircraft fixture uses a Vite development-only injection seam and is not comparable with a local production build receipt.',
    );
}
let infrastructureFixtureModule = null;
let infrastructureWorkload = null;
if (infrastructureWorkloadSelected) {
  infrastructureFixtureModule =
    await import('./performance/infrastructureWorkloadFixture.mjs');
  infrastructureWorkload =
    infrastructureFixtureModule.createInfrastructureWorkloadFixture(
      providerFixtureMode,
      providerFixtureTime,
    );
}
const source = {
  harnessCommit:
    captureProvenance?.source.captureProducerCommit || harnessSource.commit,
  buildHarnessCommit: captureProvenance?.source.buildHarnessCommit || null,
  harnessDirtyWorktree: harnessSource.dirtyWorktree,
  appCommit:
    captureProvenance?.source.appCommit ||
    appCommitOverride ||
    harnessSource.commit,
  appWorktreeState:
    (captureProvenance ? 'clean' : null) ||
    appWorktreeStateOverride ||
    (appCommitOverride && appCommitOverride !== harnessSource.commit
      ? 'unknown'
      : harnessSource.dirtyWorktree == null
        ? 'unknown'
        : harnessSource.dirtyWorktree
          ? 'dirty'
          : 'clean'),
  buildProvenance: captureProvenance
    ? projectPublicCaptureBuildProvenance(captureProvenance.source)
    : null,
  provenanceStatus: captureProvenance
    ? captureProvenance.source.status
    : 'unverified-exploratory-capture',
  reason: harnessSource.reason,
};
const infrastructureAssetRoutes = infrastructureWorkload
  ? infrastructureFixtureModule.resolveInfrastructureFixtureAssetRoutes(
      infrastructureWorkload,
      buildReceipt?.assets,
      buildProvenanceOptions.baseUrl,
    )
  : null;
let infrastructureFixtureDelivery = null;
let weatherEffectsFixtureDelivery = null;
let weatherEffectsFixtureAbortController = null;
const austinOperatingFixtureDeliveries = [];
const infrastructureResponseListeners = new Map();
const earlyRendererProbeScripts = new Map();
async function refreshShaderProgramAttributionCheckpoint() {
  if (!shaderProgramAttributionEnabled || !out) return;
  const checkpointPath = `${out}.shader-program-attribution.json`;
  const persisted = await persistShaderProgramAttributionCheckpoint({
    checkpointPath,
    cleanupRows: failureProgress.workload.rendererProbeCleanup || [],
    expectedDocumentCount: startupRuns + 1 + 3 * runs,
    provenance: {
      appSha: source.appCommit,
      harnessSha: source.harnessCommit,
      receiptSha256: captureProvenance?.source.receiptSha256,
    },
  });
  failureProgress.workload.shaderProgramAttributionArtifact =
    persisted.artifact;
}
async function recordRendererProbeCleanupEvidence(evidence) {
  const records = failureProgress.workload.rendererProbeCleanup || [];
  const maximumRecords = shaderProgramAttributionEnabled ? 40 : 16;
  if (records.length >= maximumRecords) {
    records.shift();
    failureProgress.workload.rendererProbeCleanupOmittedCount =
      (failureProgress.workload.rendererProbeCleanupOmittedCount || 0) + 1;
  }
  records.push(evidence);
  failureProgress.workload.rendererProbeCleanup = records;
  if (shaderProgramAttributionEnabled)
    failureProgress.workload.shaderProgramAttribution =
      shaderProgramAttributionEnvelope();
  await refreshShaderProgramAttributionCheckpoint().catch(() => {});
}
async function cleanupEarlyRendererProbeForPage(
  page,
  {
    retireViewerRenderLoop = false,
    phase = 'document-cleanup',
    documentRole = null,
    documentId = null,
  } = {},
) {
  const hasRegistration = Boolean(page && earlyRendererProbeScripts.has(page));
  if (!page || (!hasRegistration && !retireViewerRenderLoop)) return true;
  const scriptIdentifier = hasRegistration
    ? earlyRendererProbeScripts.get(page)
    : null;
  const evidence = retireViewerRenderLoop
    ? await retireEarlyCesiumRendererProbeForCapturePage(
        page,
        scriptIdentifier,
        1_000,
        {
          requireShaderProgramAttribution: shaderProgramAttributionEnabled,
          // The page-side cleanup budget stays one second. Allow a separate,
          // bounded second for Windows CDP acknowledgement delivery; a late
          // page execution still fails through pageExecutionBudgetMs.
          hostReceiptGraceMs: 1_000,
        },
      )
    : await cleanupEarlyCesiumRendererProbeWithEvidence(
        page,
        scriptIdentifier,
        1_000,
        {
          requireShaderProgramAttribution: shaderProgramAttributionEnabled,
          hostReceiptGraceMs: 1_000,
        },
      );
  if (hasRegistration && retireViewerRenderLoop)
    evidence.registrationRemovalBoundary = 'owned-document-retirement';
  evidence.phase = phase;
  evidence.documentRole = documentRole;
  evidence.documentId = documentId;
  await recordRendererProbeCleanupEvidence(evidence);
  if (!evidence.confirmed)
    throw new Error(
      retireViewerRenderLoop
        ? 'Retired-document render loop and renderer probe cleanup were not confirmed.'
        : 'Early Cesium renderer probe cleanup was not confirmed.',
    );
  if (hasRegistration) earlyRendererProbeScripts.delete(page);
  return true;
}
function shaderProgramAttributionEnvelope() {
  return createShaderProgramAttributionEnvelope(
    failureProgress.workload.rendererProbeCleanup || [],
    startupRuns + 1 + 3 * runs,
  );
}
const providerSampleCpuProfileTargets = [
  { scenario: 'idle', run: 1 },
  { scenario: 'idle', run: 2 },
  { scenario: 'scripted-motion', run: 1 },
];
const providerSampleCpuProfileScope =
  'first two idle samples and first scripted-motion sample, each from immediately before warmup through its measurement-boundary completion or failure; sampled main-thread stacks include idle and garbage collection, and are not precise CPU execution or GPU timing';
const failureProgress = {
  phase: 'browser-startup',
  scenario: null,
  run: null,
  current: null,
  startupSamples: [],
  completedSamples: [],
  fixture:
    productionFlightFixture ||
    infrastructureWorkload ||
    weatherEffectsWorkload ||
    austinOperatingWorkload ||
    mapStreamingFixture,
  fixtureDelivery: null,
  fixtureInterceptionErrors: [],
  workload: {
    rendererProbeCleanup: [],
    rendererProbeCleanupOmittedCount: 0,
    rendererLoopRetirements: [],
    rendererLoopRetirementsOmittedCount: 0,
    ...(nativeRenderingDiagnostic
      ? {
          nativeRendererDiagnostic: {
            requestedBackend: 'macos-native-diagnostic',
            performanceAcceptanceEligible: false,
          },
        }
      : {}),
    fixtureInterceptionReleases: [],
    warmupMs,
    durationPerSampleMs: seconds * 1000,
    runsPerScenario: runs,
    startupRuns,
    qualityMode,
    expectedDensityPct: Number.isFinite(expectedDensityPct)
      ? expectedDensityPct
      : null,
    detectionMode,
    mixedLayers,
    ...(sceneFrameDiagnosticsEnabled && productionFlightFixture
      ? {
          sceneFrameDiagnostics: {
            enabled: true,
            scope:
              'first scripted-motion run; installed before warmup and stopped after its measurement boundary',
            eligibleForComparison: false,
          },
        }
      : {}),
    ...(austinReadinessHistoryEnabled
      ? {
          austinOperatingReadinessHistory:
            createAustinOperatingReadinessHistoryEnvelope(),
        }
      : {}),
    ...(firstMotionCpuProfileEnabled
      ? {
          providerSampleCpuProfiles: {
            enabled: true,
            targets: providerSampleCpuProfileTargets,
            scope: providerSampleCpuProfileScope,
            performanceAcceptanceEligible: false,
            status: 'pending',
            profiles: [],
          },
        }
      : {}),
    ...(depthPickAttributionEnabled
      ? {
          depthPickAttribution: {
            enabled: true,
            schema: 'gev-depth-pick-attribution/v1',
            performanceAcceptanceEligible: false,
            scope:
              'opt-in caller-tagged application depth-pick/cache observations during dense provider sample documents; pickElapsedMs is browser main-thread API wall time, not CPU execution or GPU duration',
            status: 'pending',
            samples: [],
          },
        }
      : {}),
    ...(shaderProgramAttributionEnabled
      ? {
          shaderProgramAttribution: {
            enabled: true,
            schema: 'gev-shader-program-attribution/v1',
            status: 'incomplete',
            performanceAcceptanceEligible: false,
            scope:
              'whole owned dense-investigation document lifetime from Cesium WebGL context acquisition through the existing document cleanup callback; it is not isolated to warmup or measurement and is not GPU execution time',
            expectedDocumentCount: startupRuns + 1 + 3 * runs,
            documents: [],
          },
        }
      : {}),
  },
};
function recordAustinOperatingReadinessHistory(history) {
  if (!austinReadinessHistoryEnabled || !history) return;
  const evidence = failureProgress.workload.austinOperatingReadinessHistory;
  if (!evidence) return;
  appendAustinOperatingReadinessHistory(evidence, history);
  if (failureProgress.current)
    failureProgress.current.austinOperatingReadinessHistory = history;
}
// At most 5 startup + 1 setup + (3 scenarios × 10 repetitions) = 36.
const MAX_RENDER_LOOP_RETIREMENT_RECORDS = 40;
function recordRendererLoopRetirement(record) {
  const rows = failureProgress.workload.rendererLoopRetirements;
  if (rows.length < MAX_RENDER_LOOP_RETIREMENT_RECORDS) rows.push(record);
  else failureProgress.workload.rendererLoopRetirementsOmittedCount += 1;
}
let captureFailure = null;
let failureReportWritten = false;
let activePage = null;
let finalizeReceiptOnlyDocumentAudit = null;
let activeDocumentRole = mainCaptureDocumentIdentity.documentRole;
let activeDocumentId = mainCaptureDocumentIdentity.documentId;
let activeRenderBoundaryProgressBinding = null;
let activeRenderBoundaryProgressBindingRecord = null;
const SCENE_FRAME_DIAGNOSTICS_KEY = '__gevS47SceneFrameTimingV1';
const SCENE_FRAME_DIAGNOSTIC_COMMAND_TIMEOUT_MS = 750;
let activeSceneFrameAttribution = null;
let activeProviderSampleCpuProfile = null;
const providerSampleCpuProfiles = [];
const depthPickAttributionSamples = [];
let activeDepthPickAttribution = null;

function depthPickAttributionEnvelope() {
  return {
    enabled: true,
    schema: 'gev-depth-pick-attribution/v1',
    performanceAcceptanceEligible: false,
    scope:
      'opt-in caller-tagged application depth-pick/cache observations during dense provider sample documents; pickElapsedMs is browser main-thread API wall time, not CPU execution or GPU duration',
    status:
      depthPickAttributionSamples.length > 0 &&
      depthPickAttributionSamples.every((sample) => sample.cleanupConfirmed)
        ? 'complete'
        : 'incomplete',
    samples: depthPickAttributionSamples,
  };
}

function providerSampleCpuProfileEnvelope() {
  return {
    enabled: true,
    targets: providerSampleCpuProfileTargets,
    scope: providerSampleCpuProfileScope,
    performanceAcceptanceEligible: false,
    status:
      providerSampleCpuProfiles.length === 3 &&
      providerSampleCpuProfiles.every((record) => record.status === 'complete')
        ? 'complete'
        : 'incomplete',
    profiles: providerSampleCpuProfiles,
  };
}

function shouldProfileProviderSample(scenario, run) {
  return (
    firstMotionCpuProfileEnabled &&
    isProviderSampleCpuProfileTarget(scenario, run)
  );
}

async function disposeDepthPickAttributionForPage(
  targetPage,
  identity = activeDepthPickAttribution,
) {
  if (!depthPickAttributionEnabled || !identity) return null;
  const result = await disposeDepthPickPageOwner(targetPage, identity);
  failureProgress.workload.depthPickAttribution =
    depthPickAttributionEnvelope();
  if (result?.confirmed === true && activeDepthPickAttribution === identity)
    activeDepthPickAttribution = null;
  if (failureProgress.current)
    failureProgress.current.depthPickAttribution = identity.sample;
  return result;
}

async function startProviderSampleCpuProfile(
  targetPage,
  progressRecord,
  { scenario, run, captureOrdinal, documentRole, documentId },
) {
  if (!isProviderSampleCpuProfileTarget(scenario, run)) return null;
  if (activeProviderSampleCpuProfile)
    throw new Error('A provider sample CPU profile is already active.');
  const window = createProviderSampleCpuProfileWindow({
    enabled: firstMotionCpuProfileEnabled,
    profileRunner: runBoundedBoundaryProfile,
    page: targetPage,
    artifactDirectory: cpuProfileArtifactDirectory,
    targetScenario: scenario,
    targetRun: run,
    captureOrdinal,
    documentRole,
    documentId,
    onRecord(record) {
      if (record.profilerStarted !== null && !record.startedHostElapsedMs)
        record.startedHostElapsedMs = performance.now();
      if (record.profile && !record.completedHostElapsedMs)
        record.completedHostElapsedMs = performance.now();
      upsertProviderSampleCpuProfile(providerSampleCpuProfiles, record);
      failureProgress.workload.providerSampleCpuProfiles =
        providerSampleCpuProfileEnvelope();
      if (failureProgress.current)
        failureProgress.current.providerSampleCpuProfile = record;
    },
  });
  const record = window.record;
  if (!record) return null;
  upsertProviderSampleCpuProfile(providerSampleCpuProfiles, record);
  progressRecord.providerSampleCpuProfile = record;
  await window.started;
  record.windowStartRequestedHostElapsedMs = performance.now();
  activeProviderSampleCpuProfile = window;
  return record;
}

async function stopProviderSampleCpuProfile(reason) {
  const active = activeProviderSampleCpuProfile;
  if (!active) return providerSampleCpuProfiles.at(-1) || null;
  activeProviderSampleCpuProfile = null;
  active.record.windowEndRequestedHostElapsedMs = performance.now();
  try {
    await active.stop(reason);
  } catch (error) {
    active.record.status = 'failed';
    active.record.error = boundedDiagnosticError(error);
  }
  return active.record;
}

function boundedDiagnosticError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || error).slice(0, 240),
  };
}

async function withSceneFrameDiagnosticTimeout(promise, label) {
  let timer;
  const outcome = await Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ status: 'completed', value }),
      (error) => ({ status: 'failed', error }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: 'timeout',
            error: Object.assign(new Error(`${label} timed out.`), {
              name: 'TimeoutError',
            }),
          }),
        SCENE_FRAME_DIAGNOSTIC_COMMAND_TIMEOUT_MS,
      );
    }),
  ]);
  clearTimeout(timer);
  return outcome;
}

async function startSceneFrameAttribution(targetPage, progressRecord) {
  const record = {
    schema: 'gev-scene-frame-attribution/v1',
    status: 'installing',
    scope:
      'first scripted-motion run; installed before warmup and stopped after measurement-boundary settlement; bounded CPU/event timing, not GPU duration',
    eligibleForComparison: false,
    observerOriginPerformanceNowMs: null,
    measurementWindowRelativeMs: null,
    observation: null,
    cleanup: 'pending',
  };
  progressRecord.sceneFrameAttribution = record;
  const installPromise = Promise.resolve().then(() =>
    targetPage.evaluate(createSceneFrameTimingDiagnostics, undefined, {
      storeAs: SCENE_FRAME_DIAGNOSTICS_KEY,
      maxEntries: 32,
    }),
  );
  const installed = await withSceneFrameDiagnosticTimeout(
    installPromise,
    'Scene frame diagnostic setup',
  );
  if (installed.status !== 'completed') {
    record.status =
      installed.status === 'timeout' ? 'setup-timeout' : 'setup-failed';
    record.error = boundedDiagnosticError(installed.error);
    if (installed.status === 'timeout') {
      // If the page recovers after the host setup bound, release a late observer
      // from its owning page. This never changes the capture result.
      record.lateCleanup = { status: 'pending' };
      installPromise
        .then(async (result) => {
          if (result?.status !== 'installed') {
            record.lateCleanup = { status: 'not-installed' };
            return;
          }
          const cleanup = await releaseLateSceneFrameAttribution(targetPage);
          record.lateCleanup = {
            status:
              cleanup.status === 'completed' &&
              cleanup.value?.result?.cleanupComplete === true
                ? 'confirmed'
                : cleanup.status === 'timeout'
                  ? 'timeout'
                  : 'unconfirmed',
          };
          if (record.lateCleanup.status === 'confirmed')
            record.cleanup = 'confirmed-after-timeout';
          progressRecord.sceneFrameAttribution = record;
        })
        .catch((error) => {
          record.lateCleanup = {
            status: 'failed',
            error: boundedDiagnosticError(error),
          };
          progressRecord.sceneFrameAttribution = record;
        });
    }
    throw installed.error;
  }
  if (
    installed.value?.status !== 'installed' ||
    !Number.isFinite(installed.value.originPerformanceNowMs)
  ) {
    record.status = 'setup-invalid';
    record.cleanup = 'unconfirmed';
    try {
      const cleanup = await releaseLateSceneFrameAttribution(targetPage);
      if (
        cleanup.status === 'completed' &&
        cleanup.value?.result?.cleanupComplete === true
      )
        record.cleanup = 'confirmed';
    } catch {
      // The malformed setup result remains the primary diagnostic failure.
    }
    throw new Error('Scene frame diagnostic install result is malformed.');
  }
  record.status = 'recording';
  record.observerOriginPerformanceNowMs =
    installed.value.originPerformanceNowMs;
  activeSceneFrameAttribution = {
    page: targetPage,
    record,
    progressRecord,
    stopPromise: null,
  };
  return record;
}

async function releaseLateSceneFrameAttribution(targetPage) {
  return withSceneFrameDiagnosticTimeout(
    targetPage.evaluate((key) => {
      const controller = globalThis[key];
      try {
        return {
          status: controller?.stop ? 'released' : 'missing',
          result: controller?.stop?.() ?? null,
        };
      } finally {
        delete globalThis[key];
      }
    }, SCENE_FRAME_DIAGNOSTICS_KEY),
    'Late scene frame diagnostic cleanup',
  );
}

async function stopSceneFrameAttribution(reason, sample = null) {
  const active = activeSceneFrameAttribution;
  if (!active) return null;
  if (!active.stopPromise) {
    active.stopPromise = (async () => {
      active.record.status = 'stopping';
      active.record.stopReason = reason;
      let stopping;
      let stopOperation;
      try {
        stopOperation = Promise.resolve().then(() =>
          active.page.evaluate((key) => {
            const controller = globalThis[key];
            if (!controller || typeof controller.stop !== 'function')
              return { status: 'missing' };
            try {
              return { status: 'stopped', observation: controller.stop() };
            } finally {
              delete globalThis[key];
            }
          }, SCENE_FRAME_DIAGNOSTICS_KEY),
        );
        stopping = await withSceneFrameDiagnosticTimeout(
          stopOperation,
          'Scene frame diagnostic cleanup',
        );
      } catch (error) {
        stopping = { status: 'failed', error };
      }
      const outcome = stopping;
      if (outcome.status === 'completed') {
        const observation = outcome.value?.observation ?? null;
        const eventsAvailable =
          observation?.sceneEventAvailability?.update === true &&
          observation?.sceneEventAvailability?.render === true;
        const cleanupComplete =
          outcome.value?.status === 'stopped' &&
          observation?.cleanupComplete === true;
        active.record.status =
          outcome.value?.status === 'stopped' &&
          cleanupComplete &&
          eventsAvailable
            ? 'completed'
            : outcome.value?.status === 'stopped'
              ? 'incomplete'
              : outcome.value?.status || 'incomplete';
        active.record.cleanup = cleanupComplete ? 'confirmed' : 'unconfirmed';
        active.record.observation = observation;
        const origin = active.record.observerOriginPerformanceNowMs;
        const window = sample?.sceneFrameDiagnosticWindow;
        if (
          Number.isFinite(origin) &&
          Number.isFinite(window?.startPerformanceNowMs) &&
          Number.isFinite(window?.timerFiredPerformanceNowMs)
        )
          active.record.measurementWindowRelativeMs = {
            startMs: Math.max(0, window.startPerformanceNowMs - origin),
            timerFiredMs: Math.max(
              0,
              window.timerFiredPerformanceNowMs - origin,
            ),
          };
      } else {
        active.record.status =
          outcome.status === 'timeout' ? 'stop-timeout' : 'stop-failed';
        active.record.cleanup = 'unconfirmed';
        active.record.error = boundedDiagnosticError(outcome.error);
        if (outcome.status === 'timeout' && stopOperation) {
          active.record.lateCleanup = { status: 'pending' };
          stopOperation
            .then((value) => {
              const observation = value?.observation ?? null;
              const confirmed =
                value?.status === 'stopped' &&
                observation?.cleanupComplete === true;
              active.record.lateCleanup = {
                status: confirmed ? 'confirmed' : 'unconfirmed',
              };
              if (confirmed) active.record.cleanup = 'confirmed-after-timeout';
              if (observation) active.record.observation = observation;
              active.progressRecord.sceneFrameAttribution = active.record;
              if (sample) sample.sceneFrameAttribution = active.record;
            })
            .catch((error) => {
              active.record.lateCleanup = {
                status: 'failed',
                error: boundedDiagnosticError(error),
              };
              active.progressRecord.sceneFrameAttribution = active.record;
            });
        }
      }
      if (sample) {
        delete sample.sceneFrameDiagnosticWindow;
        sample.sceneFrameAttribution = active.record;
      }
      active.progressRecord.sceneFrameAttribution = active.record;
      return active.record;
    })().catch((error) => {
      active.record.status = 'stop-failed';
      active.record.cleanup = 'unconfirmed';
      active.record.error = boundedDiagnosticError(error);
      active.progressRecord.sceneFrameAttribution = active.record;
      return active.record;
    });
  }
  const stopped = await active.stopPromise;
  if (activeSceneFrameAttribution === active)
    activeSceneFrameAttribution = null;
  return stopped;
}

function deactivateActiveRenderBoundaryProgressBinding(reason) {
  const binding = activeRenderBoundaryProgressBinding;
  const record = activeRenderBoundaryProgressBindingRecord;
  if (!binding || !record) return null;
  record.status = 'inactive-awaiting-document-close';
  record.disposeReason = reason;
  const deactivated = binding.deactivate?.() === true;
  record.deactivation = {
    confirmed: deactivated,
    method: 'host-handlers-cleared',
  };
  record.ignoredCallbacks = { ...binding.ignoredCallbacks };
  return record.deactivation;
}

async function disposeActiveRenderBoundaryProgressBinding(
  reason,
  { documentClosed = false } = {},
) {
  const binding = activeRenderBoundaryProgressBinding;
  const record = activeRenderBoundaryProgressBindingRecord;
  if (!binding || !record) return null;
  activeRenderBoundaryProgressBinding = null;
  activeRenderBoundaryProgressBindingRecord = null;
  record.status = 'disposing';
  record.disposeReason = reason;
  try {
    const cleanup = await binding.dispose({ documentClosed });
    record.cleanup = cleanup;
    record.ignoredCallbacks = { ...binding.ignoredCallbacks };
    record.status = cleanup.removed ? 'disposed' : 'cleanup-failed';
    return cleanup;
  } catch (error) {
    record.status = 'cleanup-failed';
    record.cleanup = {
      removed: false,
      error: {
        name: String(error?.name || 'Error').slice(0, 80),
        message: String(error?.message || error).slice(0, 240),
      },
    };
    return record.cleanup;
  }
}
async function writeCaptureFailure(error, { refresh = false } = {}) {
  const report = createCaptureFailureReport({
    source,
    fixture: failureProgress.fixture,
    workload: {
      ...failureProgress.workload,
      scenarios: failureProgress.scenarios || [],
    },
    phase: failureProgress.current?.phase || failureProgress.phase,
    scenario: failureProgress.current?.scenario || failureProgress.scenario,
    run: failureProgress.current?.run || failureProgress.run,
    error,
    errorActual: error?.actual,
    errorExpected: error?.expected,
    errorOperator: error?.operator,
    current: performanceDiagnosticsDocuments.length
      ? {
          ...(failureProgress.current || {}),
          performanceDiagnosticsDocuments,
        }
      : failureProgress.current,
    startupSamples: failureProgress.startupSamples,
    completedSamples: failureProgress.completedSamples,
    fixtureDelivery: failureProgress.fixtureDelivery,
    fixtureInterceptionErrors: failureProgress.fixtureInterceptionErrors,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await writeCaptureFailureReportFile(out, json, { refresh });
    process.stderr.write(
      refresh
        ? 'Refreshed bounded failed-capture evidence after cleanup.\n'
        : 'Wrote bounded failed-capture evidence.\n',
    );
  } else process.stdout.write(json);
  process.stderr.write(
    `Capture failed during ${report.failure.phase}: ${report.failure.message}\n`,
  );
}
if (
  !Number.isInteger(fixtureAircraftCount) ||
  fixtureAircraftCount < 0 ||
  fixtureAircraftCount > 20_000
)
  throw new Error('--fixture-aircraft must be an integer from 0 to 20000');
if (!['manual', 'auto', 'quality', 'performance'].includes(qualityMode))
  throw new Error(
    '--quality-mode must be manual, auto, quality or performance',
  );
if (!['SPARSE', 'BALANCED', 'DENSE'].includes(detectionMode))
  throw new Error('--detection-mode must be SPARSE, BALANCED or DENSE');
if (
  args.includes('--expected-density') &&
  (!Number.isFinite(expectedDensityPct) ||
    expectedDensityPct < 0 ||
    expectedDensityPct > 100)
)
  throw new Error('--expected-density must be a number from 0 to 100');

if (
  (infrastructureWorkloadSelected || weatherEffectsWorkload) &&
  (qualityMode !== 'manual' ||
    detectionMode !== 'DENSE' ||
    expectedDensityPct !== 75)
)
  throw new Error(
    'Infrastructure and weather/effects captures require Manual/DENSE/75.',
  );

if (austinOperatingWorkloadSelected) {
  if (providerFixtureTime !== AUSTIN_OPERATING_FIXED_TIME)
    throw new TypeError(
      `Austin operating fixture time must be ${AUSTIN_OPERATING_FIXED_TIME}.`,
    );
  if (
    qualityMode !== 'manual' ||
    detectionMode !== AUSTIN_OPERATING_VISUAL_STATE.detectionMode ||
    expectedDensityPct !== AUSTIN_OPERATING_VISUAL_STATE.densityPct ||
    fixtureAircraftCount !== 0 ||
    mixedLayers
  )
    throw new Error(
      'Austin operating capture requires Manual/DENSE/75, zero aircraft and no mixed-layer override.',
    );
  austinOperatingModule =
    await import('./performance/austinOperatingWorkloadFixture.mjs');
  austinOperatingWorkload =
    austinOperatingModule.createAustinOperatingWorkloadFixture(
      providerFixtureTime,
    );
  austinSatelliteEpochModule =
    await import('./performance/austinSatelliteSampledEpoch.mjs');
  austinSatelliteEpochReference =
    austinSatelliteEpochModule.loadAustinSatelliteEpochReference(
      austinOperatingWorkload,
    );
  failureProgress.fixture = austinOperatingWorkload;
}
if (mapStreamingWorkloadSelected) {
  mapStreamingModule = await import('./performance/mapStreamingCapture.mjs');
  const { createDeterministicMapStreamingFixture } =
    await import('./performance/mapStreamingFixture.mjs');
  ({ createMapStreamingFixtureDelivery: mapStreamingDeliveryFactory } =
    await import('./performance/mapStreamingFixtureDelivery.mjs'));
  mapStreamingFixture = await createDeterministicMapStreamingFixture();
  failureProgress.fixture = {
    id: mapStreamingFixture.id,
    sha256: mapStreamingFixture.manifestSha256,
    byteLength: mapStreamingFixture.manifest.totalBytes,
  };
}

const browser = await puppeteer.launch({
  headless: args.includes('--headless') ? 'new' : false,
  protocolTimeout: protocolTimeoutMs,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  defaultViewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: declaredDeviceScaleFactor,
  },
  args: [
    '--window-size=1440,900',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(hostedFixture ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ...rendererLaunchArgs(
      nativeRenderingDiagnostic
        ? 'macos-native-diagnostic'
        : softwareRendering
          ? 'swiftshader'
          : null,
    ),
  ],
});
const ownedBrowserPid = browser.process?.()?.pid;
let foregroundActivationSession = null;
async function activateCapturePage(targetPage) {
  const hostWindowActivation = await focusOwnedWindowsBrowserWindow({
    browserPid: ownedBrowserPid,
    enabled: !args.includes('--headless'),
    runner: foregroundActivationSession?.request,
  });
  return {
    ...(await activateForegroundPage(targetPage)),
    hostWindowActivation,
  };
}
if (ownedBrowserPidFile) {
  try {
    if (!Number.isInteger(ownedBrowserPid) || ownedBrowserPid < 1)
      throw new Error('Owned browser process ID is unavailable.');
    await fs.writeFile(ownedBrowserPidFile, `${ownedBrowserPid}\n`, 'utf8');
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

const fixtureInterceptionSessions = [];
const fixtureInterceptionErrorRecorder =
  createFixtureInterceptionErrorRecorder();
const fixtureInterceptionErrors = fixtureInterceptionErrorRecorder.records;
failureProgress.fixtureInterceptionErrors = fixtureInterceptionErrors;
const fixtureInterceptionSessionContexts = new WeakMap();
let fixtureInterceptionSessionOrdinal = 0;
const performanceDiagnosticsDocuments = [];
async function disableCaptureDiagnostics(
  targetPage,
  documentRole,
  documentId = null,
) {
  const status = await targetPage.evaluate(
    disableOptionalPerformanceDiagnostics,
  );
  performanceDiagnosticsDocuments.push({ documentRole, documentId, ...status });
  failureProgress.performanceDiagnosticsDocuments = [
    ...performanceDiagnosticsDocuments,
  ];
  return status;
}

async function configureFlightFixturePage(
  page,
  deliveryObserver = null,
  {
    holdClockUntilCapture = false,
    phasedClock = false,
    documentRole = 'unclassified',
    documentId = null,
  } = {},
) {
  if (!productionFlightFixture) return;
  await installFixtureWallClockOnPage(
    page,
    productionFlightFixture.fixedTimeMs,
    { phasedClock, holdClockUntilCapture },
    phasedClock ? [warmupMs, seconds * 1000] : [],
  );
  const session = await page.createCDPSession();
  fixtureInterceptionSessions.push(session);
  const sessionContext = {
    sessionOrdinal: ++fixtureInterceptionSessionOrdinal,
    documentRole,
    documentId,
    page,
    lifecycleStage: 'active',
  };
  fixtureInterceptionSessionContexts.set(session, sessionContext);
  sessionContext.interception = await interceptFixtureSession(
    session,
    new URL(url).origin + '/',
    (requestUrl, request) =>
      respondToProductionFlightFixture(
        requestUrl,
        request,
        productionFlightFixture,
        new URL(url).origin + '/',
      ),
    fixtureInterceptionErrorRecorder.onError,
    {
      ...(deliveryObserver
        ? { onFulfilled: deliveryObserver.onFulfilled }
        : {}),
      getErrorContext: () => ({ ...sessionContext }),
    },
  );
  return session;
}

async function configureWeatherEffectsFixturePage(
  page,
  deliveryObserver,
  { documentRole = 'unclassified', documentId = null } = {},
) {
  if (!weatherEffectsWorkload) return null;
  const abortController = new AbortController();
  weatherEffectsFixtureAbortController = abortController;
  page.once('close', () =>
    abortController.abort(
      new Error('Weather fixture page closed before delivery completed.'),
    ),
  );
  await installFixtureWallClockOnPage(
    page,
    weatherEffectsWorkload.fixedTimeMs,
    { infrastructure: true },
  );
  const session = await page.createCDPSession();
  fixtureInterceptionSessions.push(session);
  const sessionContext = {
    sessionOrdinal: ++fixtureInterceptionSessionOrdinal,
    documentRole,
    documentId,
    page,
    lifecycleStage: 'active',
  };
  fixtureInterceptionSessionContexts.set(session, sessionContext);
  sessionContext.interception = await interceptFixtureSession(
    session,
    new URL(url).origin + '/',
    (requestUrl, request) => deliveryObserver.respond(requestUrl, request),
    fixtureInterceptionErrorRecorder.onError,
    {
      onFulfilled: deliveryObserver.onFulfilled,
      getErrorContext: () => ({ ...sessionContext }),
    },
  );
  return session;
}

async function configureAustinOperatingFixturePage(
  page,
  {
    documentRole = 'unclassified',
    documentId = null,
    phasedClock = false,
  } = {},
) {
  if (!austinOperatingWorkload) return null;
  const delivery = austinOperatingModule.createAustinOperatingFixtureDelivery(
    austinOperatingWorkload,
    buildProvenanceOptions.baseUrl || url,
  );
  const owner = {
    delivery,
    documentRole,
    documentId,
    sessionOrdinal: null,
    disposed: false,
    disposeReason: null,
    finalEvidence: null,
    error: null,
  };
  austinOperatingFixtureDeliveries.push(owner);
  await installFixtureWallClockOnPage(
    page,
    austinOperatingWorkload.fixedTimeMs,
    { infrastructure: !phasedClock, phasedClock },
    // Satellite fleet propagation is intentionally one-second cadence. Step
    // fixture wall time on the same boundaries so baseline and candidate
    // snapshots cannot inherit different sub-second preRender schedules.
    // performance.now(), RAF delivery and measured durations remain native.
    phasedClock ? [warmupMs, seconds * 1000, 1000] : [],
  );
  const session = await page.createCDPSession();
  fixtureInterceptionSessions.push(session);
  const sessionContext = {
    sessionOrdinal: ++fixtureInterceptionSessionOrdinal,
    documentRole,
    documentId,
    page,
    lifecycleStage: 'active',
  };
  owner.sessionOrdinal = sessionContext.sessionOrdinal;
  fixtureInterceptionSessionContexts.set(session, sessionContext);
  sessionContext.interception = await interceptFixtureSession(
    session,
    new URL(url).origin + '/',
    (requestUrl, request) => delivery.respond(requestUrl, request),
    fixtureInterceptionErrorRecorder.onError,
    {
      onFulfilled: delivery.onFulfilled,
      getErrorContext: () => ({ ...sessionContext }),
    },
  );
  return { session, delivery, owner };
}

async function configureMapStreamingFixturePage(
  page,
  { documentRole = 'unclassified', documentId = null } = {},
) {
  if (!mapStreamingWorkloadSelected) return null;
  const delivery = mapStreamingDeliveryFactory(mapStreamingFixture, {
    appOrigin: new URL(url).origin,
  });
  const owner = {
    delivery,
    documentRole,
    documentId,
    sessionOrdinal: null,
    disposed: false,
    finalEvidence: null,
    error: null,
  };
  mapStreamingFixtureOwners.push(owner);
  page.once('close', () => delivery.cancel());
  const session = await page.createCDPSession();
  fixtureInterceptionSessions.push(session);
  const sessionContext = {
    sessionOrdinal: ++fixtureInterceptionSessionOrdinal,
    documentRole,
    documentId,
    page,
    lifecycleStage: 'active',
  };
  owner.sessionOrdinal = sessionContext.sessionOrdinal;
  owner.session = session;
  fixtureInterceptionSessionContexts.set(session, sessionContext);
  sessionContext.interception = await interceptFixtureSession(
    session,
    new URL(url).origin + '/',
    (requestUrl, request) => delivery.respond(requestUrl, request),
    fixtureInterceptionErrorRecorder.onError,
    {
      onFulfilled: delivery.onFulfilled,
      getErrorContext: () => ({ ...sessionContext }),
    },
  );
  return { session, delivery, owner };
}

function finalizeMapStreamingFixtureDelivery(owner) {
  if (!owner || owner.disposed) return owner?.finalEvidence || null;
  try {
    owner.delivery.cancel();
    owner.finalEvidence = owner.delivery.dispose();
  } catch (error) {
    owner.error = {
      name: String(error?.name || 'Error').slice(0, 80),
      message: String(error?.message || error).slice(0, 240),
    };
    throw error;
  } finally {
    owner.disposed = true;
  }
  return owner.finalEvidence;
}

function collectMapStreamingFixtureDocumentDeliveries() {
  const releases = failureProgress.workload.fixtureInterceptionReleases || [];
  return mapStreamingFixtureOwners.map((owner) => {
    const delivery = finalizeMapStreamingFixtureDelivery(owner);
    const matchingReleases = releases.filter(
      (release) =>
        release.documentRole === owner.documentRole &&
        release.documentId === owner.documentId &&
        release.sessionOrdinal === owner.sessionOrdinal,
    );
    return {
      documentRole: owner.documentRole,
      documentId: owner.documentId,
      sessionOrdinal: owner.sessionOrdinal,
      delivery,
      release: matchingReleases.length === 1 ? matchingReleases[0] : null,
    };
  });
}

function publishAustinOperatingFixtureDocumentEvidence() {
  failureProgress.workload.austinOperatingFixtureDocuments =
    austinOperatingFixtureDeliveries.map((owner) =>
      createAustinOperatingDocumentEvidence({
        documentRole: owner.documentRole,
        documentId: owner.documentId,
        sessionOrdinal: owner.sessionOrdinal,
        delivery: owner.finalEvidence,
        releaseRecords: failureProgress.workload.fixtureInterceptionReleases,
        disposed: owner.disposed,
        disposeReason: owner.disposeReason,
        error: owner.error,
      }),
    );
}

function finalizeAustinOperatingFixtureDelivery(owner, reason) {
  if (!owner || owner.disposed) return;
  try {
    owner.finalEvidence = owner.delivery.summarize({
      requiredAssetIds: [],
      requiredAlprTiles: [],
    });
  } catch (error) {
    owner.error = {
      name: String(error?.name || 'Error').slice(0, 80),
      message: String(error?.message || error).slice(0, 240),
    };
    throw error;
  } finally {
    owner.disposeReason = reason;
    try {
      owner.delivery.dispose();
      owner.disposed = true;
    } catch (error) {
      owner.error ||= {
        name: String(error?.name || 'Error').slice(0, 80),
        message: String(error?.message || error).slice(0, 240),
      };
      throw error;
    }
    publishAustinOperatingFixtureDocumentEvidence();
  }
}

function observeWeatherEffectsRuntimeState() {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  if (!manager?.layers?.get)
    throw new Error('Weather source state is unavailable.');
  const layer = (id) => manager.layers.get(id)?.module;
  const products = ['weather-radar', 'weather-satellite', 'weather-lightning'];
  const sourceObservationTimes = products.map(
    (id) => layer(id)?.getStats?.()?.observedAt ?? null,
  );
  const clock = layer('weather-radar')?.getDiagnostics?.()?.clock;
  const wind = layer('wind')?.getParams?.();
  const visualState = {
    satelliteProduct: layer('weather-satellite')?.getParams?.()?.product,
    satelliteInfrared: layer('weather-satellite')?.getParams?.()?.infrared,
    radarOpacity: layer('weather-radar')?.getParams?.()?.opacity,
    lightningOpacity: layer('weather-lightning')?.getParams?.()?.opacity,
    windModel: wind?.model?.toLowerCase(),
    windOverlay: wind?.overlay,
    windPaused: wind?.paused,
  };
  const selectedIds = [
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'wind',
  ];
  const layerRows = new Map(
    (manager.getAll?.() || []).map((row) => [row.id, row]),
  );
  const populations = selectedIds.map((id) => ({
    id,
    enabled: layerRows.get(id)?.enabled ?? null,
    count: layerRows.get(id)?.stats?.count ?? null,
    loading: layer(id)?.getStats?.()?.loading ?? null,
    error: layer(id)?.getStats?.()?.error ?? null,
  }));
  const motionPreference = {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion:
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : null,
  };
  const visualSettings = app?.styleManager?.getVisualState?.() ?? null;
  return {
    motionPreference,
    clock,
    sourceObservationTimes,
    visualState,
    visualSettings,
    populations,
    wind,
  };
}

async function observeAustinOperatingRuntimeState(
  selectedLayerIds,
  expectedSourceCounts,
  includeSatellitePositionRecords = false,
) {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const layers = manager?.layers;
  const viewer = app?.viewer;
  if (!manager || !layers?.get || !viewer)
    throw new Error('Austin operating source state is unavailable.');
  const digestRows = async (rows, project) => {
    if (typeof project !== 'function') return null;
    const projected = rows.slice(0, 1000).map(project).sort();
    const bytes = new TextEncoder().encode(projected.join('\n'));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };
  const summarizeRows = async (
    rows,
    identityProject,
    positionProject = null,
    includeIdentityIds = false,
  ) => {
    if (!Array.isArray(rows))
      return {
        count: null,
        sha256: null,
        positionSha256: null,
        truncated: false,
      };
    return {
      count: rows.length,
      sha256: await digestRows(rows, identityProject),
      positionSha256: await digestRows(rows, positionProject),
      ...(includeIdentityIds
        ? { identityIds: rows.slice(0, 1000).map(identityProject).sort() }
        : {}),
      truncated: rows.length > 1000,
    };
  };
  const satelliteModule = layers.get('satellites')?.module;
  const satellitePositionRecords =
    satelliteModule?.getAllPositions?.(1000) ?? null;
  const satelliteRecord = Array.isArray(satellitePositionRecords)
    ? (satellitePositionRecords.find((record) => record.id === 25544) ?? null)
    : null;
  const selectedLayers = await Promise.all(
    selectedLayerIds.map(async (id) => {
      const entry = layers.get(id);
      const module = entry?.module;
      const stats = module?.getStats?.() ?? entry?.stats ?? null;
      let sourceRows = null;
      let identityProjection = null;
      let positionProjection = null;
      if (id === 'satellites') {
        sourceRows = satellitePositionRecords;
        identityProjection = (row) => String(row.id);
        positionProjection = (row) =>
          `${row.id}|${row.latitude}|${row.longitude}|${row.altitudeM}`;
      } else if (id === 'cctv') {
        sourceRows =
          module?.getDetectableObjects?.({ maxCount: 1000, seed: 0 }) ?? null;
        identityProjection = (row) => String(row.sourceId);
        positionProjection = (row) =>
          `${row.sourceId}|${row.position?.x}|${row.position?.y}|${row.position?.z}`;
      } else if (id === 'alpr-cameras' || id === 'military-installations') {
        sourceRows = module?.getAnalystRecords?.(1000) ?? null;
        identityProjection = (row) => String(row.id);
        positionProjection = (row) => `${row.id}|${row.lat}|${row.lon}`;
      } else if (id === 'radio') {
        const accepted = module?.getAcceptedCatalogSnapshot?.();
        sourceRows = accepted?.stationIds ?? null;
        identityProjection = (row) => String(row);
      }
      const sourcePopulation = sourceRows
        ? await summarizeRows(
            sourceRows,
            identityProjection,
            positionProjection,
            id === 'military-installations',
          )
        : {
            count: id === 'wind' ? (stats?.count ?? null) : null,
            sha256: null,
            positionSha256: null,
            truncated: false,
          };
      return {
        id,
        enabled: manager.isEnabled(id) === true,
        count: Number.isSafeInteger(stats?.count) ? stats.count : null,
        sourcePopulation,
        expectedSourceCatalogCount: Number.isSafeInteger(
          expectedSourceCounts?.[id],
        )
          ? expectedSourceCounts[id]
          : null,
        viewportCount:
          id === 'radio' && Number.isSafeInteger(stats?.filtered)
            ? stats.filtered
            : (id === 'alpr-cameras' || id === 'military-installations') &&
                Number.isSafeInteger(stats?.count)
              ? stats.count
              : null,
        nearbyCount:
          id === 'alpr-cameras' && Number.isSafeInteger(stats?.count)
            ? stats.count
            : null,
        onScreenCount:
          id === 'alpr-cameras' && Number.isSafeInteger(stats?.onScreen)
            ? stats.onScreen
            : null,
        filteredCount: Number.isSafeInteger(stats?.filtered)
          ? stats.filtered
          : null,
        loading: typeof stats?.loading === 'boolean' ? stats.loading : null,
        error:
          typeof stats?.error === 'string' ? stats.error.slice(0, 160) : null,
        stale: typeof stats?.stale === 'boolean' ? stats.stale : null,
        sourceStatus:
          typeof stats?.status === 'string' ? stats.status.slice(0, 40) : null,
        params: id === 'wind' ? (module?.getParams?.() ?? null) : null,
        windValidAt: id === 'wind' ? (stats?.validAt ?? null) : null,
        windIssuedAt: id === 'wind' ? (stats?.issuedAt ?? null) : null,
        windModel: id === 'wind' ? (stats?.model ?? null) : null,
      };
    }),
  );
  const clock = viewer.clock?.currentTime;
  return {
    wallClockMs: Date.now(),
    phasedClock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
    windSourceAgeMs: Date.now() - Date.parse('2026-10-08T12:00:00.000Z'),
    cesiumClock: clock
      ? {
          dayNumber: clock.dayNumber,
          secondsOfDay: clock.secondsOfDay,
          shouldAnimate: viewer.clock.shouldAnimate === true,
          multiplier: viewer.clock.multiplier,
        }
      : null,
    selectedLayers,
    satelliteWitness: satelliteRecord
      ? {
          noradId: satelliteRecord.id,
          latitude: satelliteRecord.latitude,
          longitude: satelliteRecord.longitude,
          altitudeM: satelliteRecord.altitudeM,
        }
      : null,
    ...(includeSatellitePositionRecords
      ? {
          satellitePositionRecords: Array.isArray(satellitePositionRecords)
            ? satellitePositionRecords.slice(0, 1000).map((record) => ({
                id: record.id,
                longitude: record.longitude,
                latitude: record.latitude,
                altitudeM: record.altitudeM,
              }))
            : null,
        }
      : {}),
  };
}

function austinOperatingSourcesReady(selectedLayerIds) {
  const manager = window.__godsEyeView?.dataManager;
  if (!manager?.layers?.get || !window.__godsEyeView?.viewer) return false;
  return selectedLayerIds.every((id) => {
    const entry = manager.layers.get(id);
    const stats = entry?.module?.getStats?.() ?? entry?.stats;
    return (
      manager.isEnabled(id) === true &&
      Number.isSafeInteger(stats?.count) &&
      stats.count > 0 &&
      stats.loading !== true &&
      !stats.error
    );
  });
}

async function configureAustinOperatingPage(fixture) {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const viewer = app?.viewer;
  if (!manager || !viewer)
    throw new Error('Austin operating fixture needs the application viewer.');
  const controller = app.styleManager?._adaptiveQuality;
  const qualityControl = document.getElementById('presentation-quality-mode');
  const densityControl = document.getElementById('detection-density-slider');
  if (!controller?.setMode || !qualityControl || !densityControl)
    throw new Error('Austin quality controls are unavailable.');
  qualityControl.value = fixture.visualState.qualityMode;
  qualityControl.dispatchEvent(new Event('change', { bubbles: true }));
  const services = app.styleManager?.services;
  if (
    typeof app.styleManager?.setDetection !== 'function' ||
    typeof services?.getDetectionTuning !== 'function' ||
    typeof services?.getDetectionMode !== 'function'
  )
    throw new Error('Austin detection workload controls are unavailable.');
  const detectionResult = app.styleManager.setDetection({
    enabled: true,
    mode: fixture.visualState.detectionMode,
    densityPct: fixture.visualState.densityPct,
  });
  if (!detectionResult?.ok)
    throw new Error(
      `Austin detection settings were rejected: ${JSON.stringify(detectionResult)}`,
    );
  const visualDetection = app.styleManager.getVisualState()?.detection;
  if (
    controller.getMode() !== fixture.visualState.qualityMode ||
    densityControl.value !== String(fixture.visualState.densityPct) ||
    services.getDetectionTuning()?.densityPct !==
      fixture.visualState.densityPct ||
    services.getDetectionMode() !== fixture.visualState.detectionMode ||
    visualDetection?.mode !== fixture.visualState.detectionMode ||
    visualDetection?.density !== fixture.visualState.densityPct
  )
    throw new Error(
      'Austin detection/quality settings did not match the fixture contract.',
    );
  const clock = viewer.clock;
  if (!clock?.currentTime)
    throw new Error('Austin Cesium Julian clock is unavailable.');
  clock.shouldAnimate = false;
  clock.multiplier = 0;
  clock.currentTime.dayNumber = fixture.clock.dayNumber;
  clock.currentTime.secondsOfDay = fixture.clock.secondsOfDay;
  const route = fixture.route;
  const destination = viewer.scene.globe.ellipsoid.cartographicToCartesian({
    longitude: (route.center.longitude * Math.PI) / 180,
    latitude: (route.center.latitude * Math.PI) / 180,
    height: route.altitudeM,
  });
  viewer.camera.cancelFlight?.();
  viewer.camera.setView({
    destination,
    orientation: {
      heading: (route.headingDeg * Math.PI) / 180,
      pitch: (route.pitchDeg * Math.PI) / 180,
      roll: 0,
    },
  });
  viewer.scene.requestRender();
  const selected = new Set(fixture.selectedLayerIds);
  for (const layer of manager.getAll()) {
    if (layer.enabled && !selected.has(layer.id))
      await manager.setEnabled(layer.id, false);
  }
  for (const id of fixture.selectedLayerIds) {
    const entry = manager.layers?.get(id);
    if (!entry?.module)
      throw new Error(`Austin operating layer ${id} is unavailable.`);
    if (id === 'wind') entry.module.setParams(fixture.visualState.wind);
    if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
  }
  const camera = viewer.camera;
  window.__gevPerformanceHome = {
    position: camera.position.clone(),
    direction: camera.direction.clone(),
    up: camera.up.clone(),
    transform: camera.transform.clone(),
  };
  return {
    cesiumClock: {
      dayNumber: clock.currentTime.dayNumber,
      secondsOfDay: clock.currentTime.secondsOfDay,
      shouldAnimate: clock.shouldAnimate === true,
      multiplier: clock.multiplier,
    },
    wallClockMs: Date.now(),
    enabledLayerIds: manager
      .getAll()
      .filter((layer) => manager.isEnabled(layer.id))
      .map((layer) => layer.id)
      .sort(),
    qualityMode: controller.getMode(),
    densityControl: {
      id: densityControl.id,
      value: densityControl.value,
      densityPct: services.getDetectionTuning()?.densityPct,
    },
    detectionMode: services.getDetectionMode(),
  };
}

async function settleProviderRenderAtBoundary(
  targetPage,
  label,
  timeoutMs = 5000,
  onProgress,
  progressBinding,
  {
    retireViewerRenderLoop = false,
    finalObservationFunction = null,
    finalObservationArgs = [],
    beforeRenderRequestFunction = null,
    beforeRenderRequestArgs = [],
    postRenderConditionFunction = null,
    postRenderConditionStabilityMs = 0,
  } = {},
) {
  return observeRenderBoundary({
    label,
    timeoutMs,
    // Keep the page execution budget independent from Windows CDP delivery.
    // A late host receipt cannot turn a page-side timeout into a pass because
    // the returned page status is still validated below.
    hostGraceMs: 2000,
    progressBinding,
    evaluate: (pageTimeoutMs, progressBinding) =>
      evaluateCompletedRenderDiagnostic(targetPage, pageTimeoutMs, {
        ...progressBinding,
        retireViewerRenderLoop,
        finalObservationFunction,
        finalObservationArgs,
        beforeRenderRequestFunction,
        beforeRenderRequestArgs,
        postRenderConditionFunction,
        postRenderConditionStabilityMs,
      }),
    onProgress,
  });
}

async function stopFlightFixtureSession(session) {
  if (!session) return null;
  const sessionContext = fixtureInterceptionSessionContexts.get(session);
  if (!sessionContext?.interception) return null;
  if (sessionContext.stopEvidence) return sessionContext.stopEvidence;
  sessionContext.lifecycleStage = 'releasing';
  sessionContext.stopEvidence =
    await sessionContext.interception.stopAndDrain();
  return sessionContext.stopEvidence;
}

async function releaseFlightFixtureSession(session) {
  if (!session) return;
  const sessionContext = fixtureInterceptionSessionContexts.get(session);
  if (sessionContext) sessionContext.lifecycleStage = 'releasing';
  const index = fixtureInterceptionSessions.indexOf(session);
  if (index >= 0) fixtureInterceptionSessions.splice(index, 1);
  const release = {
    schema: 'gev-flight-fixture-session-release/v1',
    sessionOrdinal: sessionContext?.sessionOrdinal ?? null,
    documentRole: sessionContext?.documentRole ?? null,
    documentId: sessionContext?.documentId ?? null,
    interception: null,
    stop: sessionContext?.stopEvidence || null,
    fetchDisable: 'not-attempted',
    detach: 'not-attempted',
    confirmed: false,
  };
  let primaryError = null;
  try {
    if (!sessionContext?.stopEvidence)
      release.stop = await stopFlightFixtureSession(session);
  } catch (error) {
    primaryError = error;
  }
  const targetRelease = await closeTargetBeforeFixtureInterceptionRelease(
    sessionContext?.page,
    sessionContext?.interception,
  );
  primaryError ||= targetRelease.error;
  release.targetClosed = targetRelease.targetClosed;
  if (targetRelease.release) {
    release.interception = targetRelease.release;
    release.fetchDisable = targetRelease.release.fetchDisable;
    release.detach = targetRelease.release.detach;
  } else if (targetRelease.targetClosed) {
    release.interception = {
      schema: 'gev-fixture-interception-release/v1',
      interception: null,
      fetchDisable: 'not-attempted',
      detach: 'not-attempted',
      confirmed: false,
    };
  }
  if (primaryError) {
    fixtureInterceptionErrorRecorder.onError(primaryError, {
      ...(sessionContext || {}),
      phase: 'command-send',
    });
    release.errorKind =
      primaryError?.name === 'Error' ? 'cleanup-error' : 'cleanup-failed';
  }
  release.confirmed = targetRelease.confirmed && !primaryError;
  if (sessionContext) sessionContext.lifecycleStage = 'released';
  const releaseRecords = failureProgress.workload.fixtureInterceptionReleases;
  if (releaseRecords.length < 64) releaseRecords.push(release);
  if (primaryError) throw primaryError;
  if (!release.confirmed)
    throw new Error('Fixture interception session release was not confirmed.');
}

try {
  if (!args.includes('--headless')) {
    if (!Number.isInteger(ownedBrowserPid) || ownedBrowserPid < 1)
      throw new Error('Owned browser process ID is unavailable.');
    foregroundActivationSession = createWindowsForegroundActivationSession({
      browserPid: ownedBrowserPid,
    });
    failureProgress.phase = 'initialize-foreground-helper';
    failureProgress.current = { phase: failureProgress.phase };
    try {
      await foregroundActivationSession.start({ timeoutMs: 15_000 });
    } catch (error) {
      error.name = 'HostWindowActivationError';
      error.foregroundActivation = {
        schema: 'gev-windows-owned-browser-foreground-diagnostic/v1',
        category: error.gevTimeout ? 'timeout' : 'process-failure',
        runnerExited: null,
        runnerTimedOut: error.gevTimeout === true,
        runnerKilled: error.killed === true,
        ...(typeof error.signal === 'string'
          ? { runnerSignal: error.signal.slice(0, 32) }
          : {}),
      };
      throw error;
    }
  }
  failureProgress.phase = 'startup-navigation';
  const startupUrl = new URL(url);
  startupUrl.searchParams.set('welcome', '0');
  const startupSamples = [];
  failureProgress.startupSamples = startupSamples;
  const loadedScriptAssets = new Set();
  const unexpectedScriptAssets = new Set();
  const workerBlobObservations = [];
  const workerAuditDocuments = [];
  const receiptOnlyWorkerAuditDocuments = [];
  let providerSampleWorkerAuditComplete = false;
  let activePrewarmedWorkerInventory = null;
  let activePrewarmedWorkerDocument = null;
  let scriptRequestCount = 0;
  const auditPageCodeRequests = (auditPage) => {
    if (!captureProvenance)
      return {
        workerUrls: new Set(),
        blobUrls: new Set(),
        requestedAssetPaths: new Set(),
        getReceiptOnlyState: () => ({ unreceiptedExecutableCount: 0 }),
      };
    const workerUrls = new Set();
    const blobUrls = new Set();
    let workerUrlOverflow = 0;
    let blobUrlOverflow = 0;
    let requestedPathOverflow = 0;
    let unreceiptedExecutableCount = 0;
    const requestedAssetPaths = new Set();
    const receiptOnlyCollector =
      workerAuditMode === 'receipt-only'
        ? createReceiptOnlyWorkerAuditCollector({
            baseUrl: buildProvenanceOptions.baseUrl,
            expectedAssetPaths: captureProvenance.source.expectedAssetPaths,
          })
        : null;
    const disposeReceiptOnlyObserver = receiptOnlyCollector
      ? receiptOnlyCollector.attach(auditPage)
      : null;
    const rememberWorker = (workerUrl) => {
      if (workerUrls.has(workerUrl)) return;
      if (workerUrls.size >= MAX_WORKER_TARGETS) workerUrlOverflow += 1;
      else workerUrls.add(workerUrl);
    };
    const rememberBlob = (blobUrl) => {
      if (blobUrls.has(blobUrl)) return;
      if (blobUrls.size >= MAX_WORKER_BLOB_RECORDS) blobUrlOverflow += 1;
      else blobUrls.add(blobUrl);
    };
    const base = new URL(buildProvenanceOptions.baseUrl);
    const prefix = base.pathname.endsWith('/')
      ? base.pathname
      : `${base.pathname}/`;
    const expected = new Set(captureProvenance.source.expectedAssetPaths);
    auditPage.on('request', (request) => {
      if (
        !['script', 'worker', 'serviceworker'].includes(request.resourceType())
      )
        return;
      let requested;
      try {
        requested = new URL(request.url());
      } catch {
        unreceiptedExecutableCount += 1;
        return;
      }
      if (requested.protocol === 'blob:') {
        rememberBlob(request.url());
        return;
      }
      if (requested.origin !== base.origin) {
        unreceiptedExecutableCount += 1;
        return;
      }
      let relative = '';
      if (requested.pathname.startsWith(prefix)) {
        try {
          relative = decodeURIComponent(
            requested.pathname.slice(prefix.length),
          );
        } catch {
          relative = '';
        }
      }
      if (relative && expected.has(relative)) {
        scriptRequestCount += 1;
        loadedScriptAssets.add(relative);
        if (requestedAssetPaths.has(relative)) return;
        if (requestedAssetPaths.size >= 2048) requestedPathOverflow += 1;
        else requestedAssetPaths.add(relative);
      } else {
        unreceiptedExecutableCount += 1;
        unexpectedScriptAssets.add(requested.pathname);
      }
    });
    auditPage.on('workercreated', (worker) => {
      rememberWorker(worker.url());
      if (worker.url().startsWith('blob:')) rememberBlob(worker.url());
    });
    return {
      workerUrls,
      blobUrls,
      requestedAssetPaths,
      receiptOnlyCollector,
      disposeReceiptOnlyObserver,
      getOverflow: () => ({ workerUrlOverflow, blobUrlOverflow }),
      getReceiptOnlyState: () => ({
        unreceiptedExecutableCount,
        requestedPathOverflow,
      }),
    };
  };
  const auditPageWorkerBlobs = async (
    auditPage,
    auditState,
    {
      documentRole,
      documentId = null,
      auditMode = 'diagnostic',
      requireEvidence = false,
    } = {},
  ) => {
    if (!captureProvenance) return null;
    for (const worker of auditPage.workers()) {
      if (!auditState.workerUrls.has(worker.url()))
        throw new Error(
          'Capture worker targets exceeded the observed creation audit.',
        );
    }
    const overflow = auditState.getOverflow();
    if (overflow.workerUrlOverflow || overflow.blobUrlOverflow)
      throw new Error(
        'Capture worker target audit exceeded its bounded capacity.',
      );
    const workerTargetsAtBoundary = [...auditState.workerUrls];
    const blobRequestsAtBoundary = [...auditState.blobUrls];
    const workerUrls = workerTargetsAtBoundary.filter((value) =>
      value.startsWith('blob:'),
    );
    let validation = null;
    let metadata = null;
    let restoreAttestation = null;
    let restorationSummary = null;
    let blobAudit = null;
    let lateWorkerTargetCount = null;
    let lateBlobRequestCount = null;
    let delayedValidatedWorkerTargetCount = null;
    let delayedValidatedBlobRequestCount = null;
    let unvalidatedLateWorkerTargetCount = null;
    let unvalidatedLateBlobRequestCount = null;
    let overflowAtCompletion = null;
    let workerTargetsAfterAudit = null;
    let blobRequestsAfterAudit = null;
    try {
      // Freeze page-owned blob metadata/bodies and restore URL.createObjectURL
      // in the same page task. Reading metadata, awaiting body text(), then
      // restoring allowed diagnostic mode to observe a mixed-time inventory.
      blobAudit = await readAndRestoreCesiumWorkerBodies(auditPage, workerUrls);
      if (!blobAudit)
        throw new Error('Receipt-verified page worker blob audit is missing.');
      restoreAttestation = blobAudit.restoration;
      metadata = {
        createdBlobCount: blobAudit.createdBlobCount,
        overflowCount: blobAudit.overflowCount,
        maxRetainedBytes: blobAudit.maxRetainedBytes,
        records: blobAudit.records.map(({ url, type, byteLength }) => ({
          url,
          type,
          byteLength,
        })),
      };
      if (!metadata)
        throw new Error('Receipt-verified page worker blob audit is missing.');

      workerTargetsAfterAudit = [
        ...auditState.workerUrls,
        ...auditPage.workers().map((worker) => worker.url()),
      ];
      blobRequestsAfterAudit = [...auditState.blobUrls];
      const boundarySummary = summarizeWorkerAuditBoundary({
        workerTargetsAtBoundary,
        blobRequestsAtBoundary,
        workerTargetsAfter: workerTargetsAfterAudit,
        blobRequestsAfter: blobRequestsAfterAudit,
      });
      overflowAtCompletion = auditState.getOverflow();
      lateWorkerTargetCount = boundarySummary.lateWorkerTargetCount;
      lateBlobRequestCount = boundarySummary.lateBlobRequestCount;
      if (
        overflowAtCompletion.workerUrlOverflow ||
        overflowAtCompletion.blobUrlOverflow
      )
        throw new Error(
          'Worker target audit exceeded its bound during the frozen read.',
        );
      if (blobAudit.readError)
        throw new Error(
          auditMode === 'prewarm'
            ? 'Prewarm worker blob body read failed.'
            : 'Diagnostic worker blob body read failed.',
        );

      const hasEvidence = !(
        metadata.createdBlobCount === 0 &&
        workerUrls.length === 0 &&
        blobRequestsAtBoundary.length === 0
      );
      if (requireEvidence && !hasEvidence)
        throw new Error('Prewarm worker audit observed no executable blobs.');
      if (hasEvidence) {
        validation = validateCesiumWorkerBlobs({
          contract: captureWorkerContract,
          baseUrl: buildProvenanceOptions.baseUrl,
          workerUrls,
          observedBlobUrls: blobRequestsAtBoundary,
          blobAudit,
          auditMode,
        });
      }
      const publication = classifyLateWorkerAuditObservations({
        workerTargetsAtBoundary,
        blobRequestsAtBoundary,
        workerTargetsAfter: workerTargetsAfterAudit,
        blobRequestsAfter: blobRequestsAfterAudit,
        validatedWorkerTargetUrls: validation?.validatedWorkerTargetUrls || [],
        acceptedBlobUrls: validation?.acceptedBlobUrls || [],
      });
      delayedValidatedWorkerTargetCount =
        publication.delayedValidatedWorkerTargetCount;
      delayedValidatedBlobRequestCount =
        publication.delayedValidatedBlobRequestCount;
      unvalidatedLateWorkerTargetCount =
        publication.unvalidatedLateWorkerTargetCount;
      unvalidatedLateBlobRequestCount =
        publication.unvalidatedLateBlobRequestCount;
      if (unvalidatedLateWorkerTargetCount || unvalidatedLateBlobRequestCount)
        throw new Error(
          'Worker targets or blob requests arrived after the frozen audit boundary without validated frozen bytes.',
        );
    } finally {
      if (!restoreAttestation)
        restoreAttestation = await auditPage.evaluate(
          restoreCesiumWorkerBlobAudit,
        );
      if (lateWorkerTargetCount === null) {
        workerTargetsAfterAudit = [...auditState.workerUrls];
        blobRequestsAfterAudit = [...auditState.blobUrls];
        const boundarySummary = summarizeWorkerAuditBoundary({
          workerTargetsAtBoundary,
          blobRequestsAtBoundary,
          workerTargetsAfter: workerTargetsAfterAudit,
          blobRequestsAfter: blobRequestsAfterAudit,
        });
        lateWorkerTargetCount = boundarySummary.lateWorkerTargetCount;
        lateBlobRequestCount = boundarySummary.lateBlobRequestCount;
        overflowAtCompletion = auditState.getOverflow();
      }
      restorationSummary = {
        nativeCreateObjectURLRestored:
          restoreAttestation?.nativeCreateObjectURLRestored === true,
        registryEmpty: restoreAttestation?.registryEmpty === true,
        createdScriptBlobCountAtRestore:
          restoreAttestation?.createdScriptBlobCountAtRestore ?? null,
        overflowCountAtRestore:
          restoreAttestation?.overflowCountAtRestore ?? null,
        auditedCreatedScriptBlobCount: metadata?.createdBlobCount ?? null,
        auditedOverflowCount: metadata?.overflowCount ?? null,
        validatedCreatedScriptBlobCount:
          validation?.observation.createdScriptBlobCount ?? null,
        observedWorkerTargetCount: workerTargetsAtBoundary.length,
        observedBlobRequestCount: blobRequestsAtBoundary.length,
        lateWorkerTargetCount,
        lateBlobRequestCount,
        delayedValidatedWorkerTargetCount,
        delayedValidatedBlobRequestCount,
        unvalidatedLateWorkerTargetCount,
        unvalidatedLateBlobRequestCount,
        workerUrlOverflowAtCompletion:
          overflowAtCompletion?.workerUrlOverflow ?? null,
        blobUrlOverflowAtCompletion:
          overflowAtCompletion?.blobUrlOverflow ?? null,
      };
      if (failureProgress.current)
        failureProgress.current.workerAuditRestoration = restorationSummary;
      else failureProgress.workerAuditRestoration = restorationSummary;
    }
    if (
      restoreAttestation?.nativeCreateObjectURLRestored !== true ||
      restoreAttestation?.registryEmpty !== true ||
      restoreAttestation?.createdScriptBlobCountAtRestore !==
        metadata?.createdBlobCount ||
      restoreAttestation?.overflowCountAtRestore !== metadata?.overflowCount ||
      (validation &&
        restoreAttestation.createdScriptBlobCountAtRestore !==
          validation.observation.createdScriptBlobCount) ||
      restoreAttestation?.overflowCountAtRestore !== 0
    )
      throw new Error('Worker blob audit did not fully restore and clear.');
    const documentAudit = {
      documentRole: documentRole || 'unclassified',
      documentId,
      mode: auditMode,
      validation: validation?.observation || null,
      restoration: {
        nativeCreateObjectURLRestored:
          restoreAttestation.nativeCreateObjectURLRestored,
        registryEmpty: restoreAttestation.registryEmpty,
        createdScriptBlobCountAtRestore:
          restoreAttestation.createdScriptBlobCountAtRestore,
        overflowCountAtRestore: restoreAttestation.overflowCountAtRestore,
        auditedCreatedScriptBlobCount: metadata.createdBlobCount,
        auditedOverflowCount: metadata.overflowCount,
        publicationBoundary: {
          workerTargetCountAtBoundary: workerTargetsAtBoundary.length,
          blobRequestCountAtBoundary: blobRequestsAtBoundary.length,
          lateWorkerTargetCount,
          lateBlobRequestCount,
          delayedValidatedWorkerTargetCount,
          delayedValidatedBlobRequestCount,
          unvalidatedLateWorkerTargetCount,
          unvalidatedLateBlobRequestCount,
        },
      },
      observedWorkerTargetCount: new Set(
        workerTargetsAfterAudit || workerTargetsAtBoundary,
      ).size,
      observedBlobRequestCount: new Set(
        blobRequestsAfterAudit || blobRequestsAtBoundary,
      ).size,
    };
    workerAuditDocuments.push(documentAudit);
    if (validation) workerBlobObservations.push(validation.observation);
    if (!validation)
      return { observation: null, documentAudit, inventory: null };
    return {
      observation: validation.observation,
      documentAudit,
      inventory: {
        schema: 'gev-prewarmed-worker-inventory/v1',
        status: validation.observation.status,
        receiptSha256: captureProvenance.source.receiptSha256,
        workerSourceSha256: captureWorkerContract.workerSourceSha256,
        createdScriptBlobCount: validation.observation.createdScriptBlobCount,
        acceptedBlobUrls: validation.acceptedBlobUrls,
        validatedWorkerTargetUrls: validation.validatedWorkerTargetUrls,
        restoration: documentAudit.restoration,
      },
    };
  };
  const verifyPrewarmedWorkerUse = (auditState, inventory, documentAudit) => {
    const overflow = auditState.getOverflow();
    const lateUseCheck = validatePrewarmedWorkerUse({
      inventory,
      expectedReceiptSha256: captureProvenance.source.receiptSha256,
      expectedWorkerSourceSha256: captureWorkerContract.workerSourceSha256,
      workerUrls: [...auditState.workerUrls],
      observedBlobUrls: [...auditState.blobUrls],
      workerUrlOverflow: overflow.workerUrlOverflow,
      blobUrlOverflow: overflow.blobUrlOverflow,
      baseUrl: buildProvenanceOptions.baseUrl,
      expectedAssetPaths: captureProvenance.source.expectedAssetPaths,
    });
    documentAudit.lateUseCheck = lateUseCheck;
    return lateUseCheck;
  };
  const auditReceiptOnlyWorkerDocument = (
    auditPage,
    auditState,
    { documentRole, documentId, includeLiveWorkers = true },
  ) => {
    let document;
    try {
      if (!auditState.receiptOnlyCollector)
        throw new Error(
          'Receipt-only observer was not installed for this document.',
        );
      document = auditState.receiptOnlyCollector.createDocument({
        documentRole,
        documentId,
        appCommit: captureProvenance.source.appCommit,
        harnessCommit: source.harnessCommit,
        receiptSha256: captureProvenance.source.receiptSha256,
        embeddedWorkerContract: captureWorkerContract,
        liveWorkers: includeLiveWorkers ? auditPage.workers() : [],
      });
    } catch (error) {
      const observed = auditState.receiptOnlyCollector?.snapshot() || {};
      failureProgress.workload.receiptOnlyWorkerAudit = {
        status: 'incomplete',
        errorKind: 'unreceipted-path-or-observation-overflow',
        documentRole: String(documentRole || '').slice(0, 80),
        documentId: String(documentId || '').slice(0, 160),
        requestedPathCount: observed.requestedAssetPaths?.length || 0,
        workerTargetCount: observed.workerTargetCount || 0,
        blobRequestCount: observed.blobRequestCount || 0,
        unreceiptedExecutableCount: observed.unreceiptedExecutableCount,
        overflowCount: observed.overflowCount,
      };
      throw error;
    }
    const key = `${documentRole}\u0000${documentId}`;
    const index = receiptOnlyWorkerAuditDocuments.findIndex(
      (entry) => `${entry.documentRole}\u0000${entry.documentId}` === key,
    );
    if (index < 0) receiptOnlyWorkerAuditDocuments.push(document);
    else receiptOnlyWorkerAuditDocuments[index] = document;
    failureProgress.workload.receiptOnlyWorkerAudit = {
      status: 'partial',
      documents: receiptOnlyWorkerAuditDocuments.map((entry) => ({
        documentRole: entry.documentRole,
        documentId: entry.documentId,
        requestedPathCount: entry.requestedAssetPaths.length,
        workerTargetCount: entry.workerTargets.count,
        blobRequestCount: entry.blobRequestCount,
      })),
    };
    return document;
  };
  const auditPageWorkerEvidence = async (
    auditPage,
    auditState,
    identity,
    options = {},
  ) =>
    workerAuditMode === 'receipt-only'
      ? auditReceiptOnlyWorkerDocument(auditPage, auditState, identity)
      : auditPageWorkerBlobs(auditPage, auditState, {
          ...identity,
          ...options,
        });
  const finalizeReceiptOnlyAuditAfterClose = (
    auditPage,
    auditState,
    identity,
  ) => {
    let auditError = null;
    try {
      auditReceiptOnlyWorkerDocument(auditPage, auditState, {
        ...identity,
        includeLiveWorkers: false,
      });
    } catch (error) {
      auditError = error;
    }
    let cleanupConfirmed = false;
    try {
      cleanupConfirmed = auditState.disposeReceiptOnlyObserver?.() === true;
    } catch (error) {
      auditError ||= error;
    }
    if (auditError) throw auditError;
    if (!cleanupConfirmed)
      throw new Error('Receipt-only observer cleanup was not confirmed.');
  };
  async function attachMeasuredPage(
    auditPage,
    deliveryObserver = null,
    { documentRole = 'unclassified', documentId = null } = {},
  ) {
    if (weatherEffectsWorkload)
      await weatherEffectsModule.configureWeatherEffectsMotionPreference(
        auditPage,
      );
    await auditPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: declaredDeviceScaleFactor,
    });
    await auditPage.setCacheEnabled(false);
    await auditPage.setBypassServiceWorker(true);
    const documentInfrastructureDelivery = infrastructureWorkload
      ? infrastructureFixtureModule.createInfrastructureFixtureDeliveryObserver(
          infrastructureWorkload,
          {
            assetRoutes: infrastructureAssetRoutes,
            baseUrl: buildProvenanceOptions.baseUrl,
          },
        )
      : null;
    if (documentInfrastructureDelivery) {
      await installFixtureWallClockOnPage(
        auditPage,
        infrastructureWorkload.fixedTimeMs,
        { infrastructure: true },
      );
      const responseListener = (response) =>
        documentInfrastructureDelivery.onResponse(response);
      auditPage.on('response', responseListener);
      infrastructureResponseListeners.set(auditPage, responseListener);
    }
    const fixtureSession = await configureFlightFixturePage(
      auditPage,
      deliveryObserver,
      {
        phasedClock: Boolean(productionFlightFixture),
        holdClockUntilCapture: Boolean(productionFlightFixture),
        documentRole,
        documentId,
      },
    );
    if (weatherEffectsWorkload) {
      weatherEffectsFixtureDelivery =
        weatherEffectsModule.createWeatherEffectsFixtureDelivery(
          weatherEffectsWorkload,
          buildProvenanceOptions.baseUrl,
        );
    }
    const weatherFixtureSession = await configureWeatherEffectsFixturePage(
      auditPage,
      weatherEffectsFixtureDelivery,
      { documentRole, documentId },
    );
    const austinFixture = await configureAustinOperatingFixturePage(auditPage, {
      documentRole,
      documentId,
      phasedClock: Boolean(austinOperatingWorkload),
    });
    const mapStreamingFixturePage = await configureMapStreamingFixturePage(
      auditPage,
      { documentRole, documentId },
    );
    earlyRendererProbeScripts.set(
      auditPage,
      await installEarlyCesiumRendererProbe(auditPage, {
        shaderProgramAttribution: shaderProgramAttributionEnabled,
      }),
    );
    if (captureProvenance && workerAuditMode !== 'receipt-only')
      await auditPage.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    return {
      fixtureSession,
      weatherFixtureSession,
      austinFixture,
      mapStreamingFixturePage,
      auditState: auditPageCodeRequests(auditPage),
      infrastructureFixtureDelivery: documentInfrastructureDelivery,
    };
  }
  for (let run = 1; run <= startupRuns; run += 1) {
    failureProgress.phase = 'startup-navigation';
    failureProgress.run = run;
    process.stdout.write(`[performance] startup ${run}/${startupRuns}\n`);
    const context = await browser.createBrowserContext();
    const startupPage = await context.newPage();
    if (weatherEffectsWorkload)
      await weatherEffectsModule.configureWeatherEffectsMotionPreference(
        startupPage,
      );
    await startupPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: declaredDeviceScaleFactor,
    });
    await startupPage.setCacheEnabled(false);
    await startupPage.setBypassServiceWorker(true);
    earlyRendererProbeScripts.set(
      startupPage,
      await installEarlyCesiumRendererProbe(startupPage, {
        shaderProgramAttribution: shaderProgramAttributionEnabled,
      }),
    );
    const { documentRole: startupDocumentRole, documentId: startupDocumentId } =
      startupDocumentTopology.diagnostics[run - 1];
    const startupFixtureSession = await configureFlightFixturePage(
      startupPage,
      null,
      {
        documentRole: startupDocumentRole,
        documentId: startupDocumentId,
      },
    );
    const startupAustinFixture = await configureAustinOperatingFixturePage(
      startupPage,
      { documentRole: startupDocumentRole, documentId: startupDocumentId },
    );
    const startupMapFixture = await configureMapStreamingFixturePage(
      startupPage,
      { documentRole: startupDocumentRole, documentId: startupDocumentId },
    );
    if (captureProvenance && workerAuditMode !== 'receipt-only')
      await startupPage.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    const startupAuditState = auditPageCodeRequests(startupPage);
    const startedAt = Date.now();
    await startupPage.goto(startupUrl.href, { waitUntil: 'domcontentloaded' });
    if (captureProvenance) {
      const servedBase = new URL(buildProvenanceOptions.baseUrl);
      const actualPage = new URL(startupPage.url());
      if (
        actualPage.origin !== servedBase.origin ||
        !captureProvenance.source.entryPaths.includes(actualPage.pathname)
      )
        throw new Error(
          'Startup navigation redirected outside the verified application entry point.',
        );
    }
    const startupForegroundActivation = await activateCapturePage(startupPage);
    failureProgress.startupForegroundActivation = {
      run,
      ...startupForegroundActivation,
    };
    await startupPage.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    await disableCaptureDiagnostics(
      startupPage,
      startupDocumentRole,
      startupDocumentId,
    );
    const appReadyMs = Date.now() - startedAt;
    await startupPage.waitForFunction(
      () =>
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    if (
      captureProvenance &&
      (await startupPage.evaluate(() =>
        Boolean(navigator.serviceWorker?.controller),
      ))
    )
      throw new Error(
        'Verified startup page is controlled by a service worker.',
      );
    const initialSettleMs = Date.now() - startedAt;
    const earlyRenderer = await readEarlyCesiumRendererProbe(startupPage);
    const terminalStartupObservation = await startupPage.evaluate(
      observeTerminalViewerState,
      'startup-details',
    );
    const details = {
      ...terminalStartupObservation.observation,
      renderLoopRetirement: terminalStartupObservation.renderLoopRetirement,
    };
    recordRendererLoopRetirement({
      phase: 'startup-final-details',
      documentRole: startupDocumentRole,
      documentId: startupDocumentId,
      ...terminalStartupObservation.renderLoopRetirement,
    });
    if (terminalStartupObservation.renderLoopRetirement.confirmed !== true)
      throw new Error(
        'Startup document render loop retirement at its final details observation was not confirmed.',
      );
    details.renderer = earlyRenderer.renderer;
    details.vendor = earlyRenderer.vendor;
    details.rendererEvidence = {
      source: 'early-cesium-context-creation',
      contextAttributes: earlyRenderer.contextAttributes,
      queryDurationMs: earlyRenderer.queryDurationMs,
      parameterQueryCount: earlyRenderer.parameterQueryCount,
    };
    startupSamples.push({
      run,
      cacheDisabled: true,
      foregroundActivation: startupForegroundActivation,
      appReadyMs,
      initialSettleMs,
      ...details,
    });
    await auditPageWorkerEvidence(startupPage, startupAuditState, {
      documentRole: startupDocumentRole,
      documentId: startupDocumentId,
    });
    for (const ownedSession of [
      startupFixtureSession,
      startupAustinFixture?.session,
      startupMapFixture?.session,
    ]) {
      if (!ownedSession) continue;
      const startupInterceptionStopped =
        await stopFlightFixtureSession(ownedSession);
      if (!startupInterceptionStopped?.confirmed)
        throw new Error(
          'Startup fixture interception stop and command drain were not confirmed.',
        );
    }
    await cleanupEarlyRendererProbeForPage(startupPage, {
      retireViewerRenderLoop: true,
      phase: 'startup-document-retirement',
      documentRole: startupDocumentRole,
      documentId: startupDocumentId,
    });
    await context.close();
    if (workerAuditMode === 'receipt-only') {
      finalizeReceiptOnlyAuditAfterClose(startupPage, startupAuditState, {
        documentRole: startupDocumentRole,
        documentId: startupDocumentId,
      });
    }
    for (const ownedSession of [
      startupFixtureSession,
      startupAustinFixture?.session,
      startupMapFixture?.session,
    ])
      await releaseFlightFixtureSession(ownedSession);
    if (startupAustinFixture?.owner)
      finalizeAustinOperatingFixtureDelivery(
        startupAustinFixture.owner,
        'startup-page-closed-after-session-release',
      );
    if (startupMapFixture?.owner)
      finalizeMapStreamingFixtureDelivery(startupMapFixture.owner);
  }

  process.stdout.write('[performance] preparing measured scene\n');
  failureProgress.phase = 'main-navigation';
  failureProgress.scenario = null;
  failureProgress.run = null;
  activePage = await browser.newPage();
  let page = activePage;
  let providerContext = null;
  let nativeRendererEvidence = null;
  let graphics = null;
  let graphicsRead = false;
  let flightFixtureDelivery = productionFlightFixture
    ? createFlightFixtureDeliveryObserver(
        productionFlightFixture,
        new URL(url).origin + '/',
      )
    : null;
  const initialPageAttachment = await attachMeasuredPage(
    page,
    flightFixtureDelivery,
    {
      documentRole: activeDocumentRole,
      documentId: activeDocumentId,
    },
  );
  infrastructureFixtureDelivery =
    initialPageAttachment.infrastructureFixtureDelivery;
  let austinOperatingFixtureDelivery =
    initialPageAttachment.austinFixture?.delivery || null;
  let activeAustinFixtureSession =
    initialPageAttachment.austinFixture?.session || null;
  let activeAustinFixtureOwner =
    initialPageAttachment.austinFixture?.owner || null;
  let activeFixtureSession = initialPageAttachment.fixtureSession;
  let captureAuditState = initialPageAttachment.auditState;
  const setReceiptOnlyDocumentFinalizer = () => {
    finalizeReceiptOnlyDocumentAudit =
      workerAuditMode === 'receipt-only'
        ? () => {
            finalizeReceiptOnlyAuditAfterClose(page, captureAuditState, {
              documentRole: activeDocumentRole,
              documentId: activeDocumentId,
            });
          }
        : null;
  };
  setReceiptOnlyDocumentFinalizer();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (captureProvenance) {
    const servedBase = new URL(buildProvenanceOptions.baseUrl);
    const actualPage = new URL(page.url());
    if (
      actualPage.origin !== servedBase.origin ||
      !captureProvenance.source.entryPaths.includes(actualPage.pathname)
    )
      throw new Error(
        'Capture navigation redirected outside the verified application entry point.',
      );
  }
  failureProgress.mainForegroundActivation = await activateCapturePage(page);
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
    timeout: 90_000,
  });
  if (nativeRenderingDiagnostic) {
    const earlyRenderer = await page.evaluate(() => ({
      renderer: window.__gevRecoveryEarlyRendererProbe?.renderer ?? null,
      vendor: window.__gevRecoveryEarlyRendererProbe?.vendor ?? null,
    }));
    graphics = await readBrowserGraphicsInfo(browser);
    graphicsRead = true;
    nativeRendererEvidence = nativeRendererDiagnosticEvidence({
      renderer: earlyRenderer.renderer,
      vendor: earlyRenderer.vendor,
      graphics,
    });
    failureProgress.workload.nativeRendererDiagnostic = nativeRendererEvidence;
    assertVerifiedNativeRendererEvidence(
      nativeRendererEvidence,
      earlyRenderer.renderer,
      earlyRenderer.vendor,
    );
  }
  await disableCaptureDiagnostics(page, 'main-setup', activeDocumentId);
  const readyMs = Date.now();
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  if (
    captureProvenance &&
    (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
  )
    throw new Error('Verified capture page is controlled by a service worker.');
  const mainStartupElapsedMs = Date.now() - readyMs;

  const fixture = effectiveFixtureAircraftCount
    ? await page.evaluate(
        async ({
          count,
          mode,
          detectionMode,
          densityPct,
          productionProvider,
          fixtureId,
          fixtureSha256,
          fixedTime,
        }) => {
          const app = window.__godsEyeView;
          const manager = app?.dataManager;
          const entry = manager?.layers?.get('flights');
          if (!entry)
            throw new Error(
              'Aircraft fixture requires the registered flights layer',
            );
          if (!manager.isEnabled('flights'))
            await manager.setEnabled('flights', true);
          if (!productionProvider) {
            const layer = manager.layers.get('flights')?.module;
            const inject = layer?.__focusEvidence?.setAircraft;
            if (typeof inject !== 'function')
              throw new Error(
                'Aircraft fixture injection is available only in a Vite development build',
              );
            const records = Array.from({ length: count }, (_, index) => {
              const angle = index * 2.399963229728653;
              const radius = Math.sqrt((index + 0.5) / count);
              return {
                id: (index + 1).toString(16).padStart(6, '0'),
                callsign: `FX${String(index + 1).padStart(5, '0')}`,
                latitude: 30.2672 + Math.sin(angle) * radius * 0.14,
                longitude: -97.7431 + Math.cos(angle) * radius * 0.18,
                altitudeM: 1_500 + (index % 16) * 850,
                velocityMps: 70 + (index % 90),
                trackDeg: index % 360,
              };
            });
            const result = inject(records);
            if (!result?.ok || result.count !== count)
              throw new Error(
                `Fixture injection failed: ${JSON.stringify(result)}`,
              );
            if (entry.intervalId != null) clearInterval(entry.intervalId);
            entry.intervalId = null;
          }
          const controller = app.styleManager?._adaptiveQuality;
          if (controller && !controller.setMode(mode))
            throw new Error('Presentation quality controller is unavailable');
          if (!controller && mode !== 'manual')
            throw new Error(
              'Auto/Quality/Performance profiles are unavailable in this app revision',
            );
          const services = app.styleManager?.services;
          const densityControl = document.getElementById(
            'detection-density-slider',
          );
          if (
            typeof app.styleManager?.setDetection !== 'function' ||
            typeof services?.getDetectionTuning !== 'function' ||
            typeof services?.getDetectionMode !== 'function' ||
            typeof services?.readDetectionDiagnostics !== 'function' ||
            !densityControl
          )
            throw new Error('Detection workload controls are unavailable');
          const requestedDensity = Number.isFinite(densityPct)
            ? densityPct
            : services.getDetectionTuning()?.densityPct;
          if (!Number.isFinite(requestedDensity))
            throw new Error('Detection density is unavailable');
          const detectionResult = app.styleManager.setDetection({
            enabled: true,
            mode: detectionMode,
            densityPct: requestedDensity,
          });
          if (!detectionResult?.ok)
            throw new Error(
              `Detection settings were rejected: ${JSON.stringify(detectionResult)}`,
            );
          if (mode === 'manual')
            controller?.rememberManualDensity?.(requestedDensity);
          const visualDetection = app.styleManager.getVisualState()?.detection;
          if (
            services.getDetectionMode() !== detectionMode ||
            services.getDetectionTuning()?.densityPct !== requestedDensity ||
            densityControl.value !== String(requestedDensity) ||
            visualDetection?.mode !== detectionMode ||
            visualDetection?.density !== requestedDensity
          )
            throw new Error(
              `Detection settings did not become ${detectionMode}/${requestedDensity}`,
            );
          const viewer = app.viewer;
          const center = { latitude: 30.2672, longitude: -97.7431 };
          const radians = Math.PI / 180;
          const destination =
            viewer.scene.globe.ellipsoid.cartographicToCartesian({
              longitude: center.longitude * radians,
              latitude: center.latitude * radians,
              height: 130_000,
            });
          viewer.camera.cancelFlight?.();
          viewer.camera.setView({
            destination,
            orientation: {
              heading: 0,
              pitch: -Math.PI / 2,
              roll: 0,
            },
          });
          viewer.scene.requestRender();
          return {
            id: productionProvider ? fixtureId : 'synthetic-aircraft-ring-v1',
            count,
            center,
            ...(productionProvider ? { sha256: fixtureSha256, fixedTime } : {}),
            cameraPath: {
              id: 'austin-overhead-v1',
              altitudeM: 130_000,
              headingDeg: 0,
              pitchDeg: -90,
            },
            seed: 1,
            detectionMode,
          };
        },
        {
          count: effectiveFixtureAircraftCount,
          mode: qualityMode,
          detectionMode,
          densityPct: expectedDensityPct,
          productionProvider: Boolean(productionFlightFixture),
          fixtureId: productionFlightFixture?.id || null,
          fixtureSha256: productionFlightFixture?.sha256 || null,
          fixedTime: productionFlightFixture?.fixedTime || null,
        },
      )
    : null;
  failureProgress.fixture =
    productionFlightFixture ||
    infrastructureWorkload ||
    weatherEffectsWorkload ||
    (mapStreamingFixture
      ? {
          id: mapStreamingFixture.id,
          sha256: mapStreamingFixture.manifestSha256,
          byteLength: mapStreamingFixture.manifest.totalBytes,
        }
      : null) ||
    fixture;

  const summarizeFlightFixtureDelivery = async (observedCount = undefined) => {
    if (!productionFlightFixture) return null;
    if (fixtureInterceptionErrors.length)
      throw new Error(
        `Provider fixture interception reported ${fixtureInterceptionErrors.length} bounded errors.`,
      );
    if (observedCount === undefined)
      observedCount = await page.evaluate(
        () =>
          window.__godsEyeView?.dataManager
            ?.getAll?.()
            ?.find((entry) => entry.id === 'flights')?.stats?.count ?? null,
      );
    return flightFixtureDelivery.summarize(observedCount);
  };
  let fixtureDelivery = null;
  let weatherCameraObservation = null;
  failureProgress.phase = productionFlightFixture
    ? 'wait-for-initial-provider-fixture'
    : 'prepare-measured-scene';
  if (productionFlightFixture) {
    await page.waitForFunction(
      (count) => {
        const layer = window.__godsEyeView?.dataManager
          ?.getAll?.()
          ?.find((entry) => entry.id === 'flights');
        return layer?.enabled === true && layer?.stats?.count === count;
      },
      { timeout: fixtureTimeoutMs, polling: 100 },
      productionFlightFixture.count,
    );
    fixtureDelivery = await summarizeFlightFixtureDelivery();
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  if (infrastructureWorkload) {
    failureProgress.phase = 'configure-infrastructure-fixture';
    const before = await page.evaluate(
      async ({
        selectedLayerIds,
        clock,
        qualityMode: mode,
        detectionMode: requestedDetectionMode,
        densityPct,
        camera,
      }) => {
        const app = window.__godsEyeView;
        const manager = app?.dataManager;
        const viewer = app?.viewer;
        if (!manager || !viewer)
          throw new Error(
            'Infrastructure fixture needs the application viewer.',
          );
        const selected = new Set(selectedLayerIds);
        for (const layer of manager.getAll()) {
          if (layer.enabled && !selected.has(layer.id))
            await manager.setEnabled(layer.id, false);
        }
        for (const id of selectedLayerIds) {
          if (!manager.layers?.has(id))
            throw new Error(`Missing infrastructure layer ${id}.`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        const controller = app.styleManager?._adaptiveQuality;
        if (!controller?.setMode?.(mode))
          throw new Error('Presentation quality controller is unavailable.');
        const services = app.styleManager?.services;
        const densityControl = document.getElementById(
          'detection-density-slider',
        );
        if (
          typeof app.styleManager?.setDetection !== 'function' ||
          typeof services?.getDetectionTuning !== 'function' ||
          typeof services?.getDetectionMode !== 'function' ||
          !densityControl
        )
          throw new Error('Detection workload controls are unavailable.');
        const detectionResult = app.styleManager.setDetection({
          enabled: true,
          mode: requestedDetectionMode,
          densityPct,
        });
        if (mode === 'manual') controller?.rememberManualDensity?.(densityPct);
        const visualDetection = app.styleManager.getVisualState()?.detection;
        if (
          !detectionResult?.ok ||
          services.getDetectionMode() !== requestedDetectionMode ||
          services.getDetectionTuning()?.densityPct !== densityPct ||
          densityControl.value !== String(densityPct) ||
          visualDetection?.mode !== requestedDetectionMode ||
          visualDetection?.density !== densityPct
        )
          throw new Error(
            `Detection settings did not become ${requestedDetectionMode}/${densityPct}.`,
          );
        const cesiumClock = viewer.clock;
        if (
          !cesiumClock?.currentTime ||
          !Number.isFinite(cesiumClock.currentTime.dayNumber) ||
          !Number.isFinite(cesiumClock.currentTime.secondsOfDay)
        )
          throw new Error('Cesium Julian clock is unavailable.');
        cesiumClock.shouldAnimate = false;
        cesiumClock.multiplier = 0;
        cesiumClock.currentTime.dayNumber = clock.dayNumber;
        cesiumClock.currentTime.secondsOfDay = clock.secondsOfDay;
        const destination =
          viewer.scene.globe.ellipsoid.cartographicToCartesian({
            longitude: (camera.longitudeDeg * Math.PI) / 180,
            latitude: (camera.latitudeDeg * Math.PI) / 180,
            height: camera.altitudeM,
          });
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
          destination,
          orientation: {
            heading: (camera.headingDeg * Math.PI) / 180,
            pitch: (camera.pitchDeg * Math.PI) / 180,
            roll: 0,
          },
        });
        viewer.scene.requestRender();
        return manager.getAll().map((layer) => ({
          id: layer.id,
          enabled: Boolean(layer.enabled),
          count: Number.isInteger(layer.stats?.count)
            ? layer.stats.count
            : null,
        }));
      },
      {
        selectedLayerIds: infrastructureWorkload.selectedLayerIds,
        clock: infrastructureWorkload.clock,
        qualityMode,
        detectionMode,
        densityPct: expectedDensityPct,
        camera: infrastructureWorkload.camera,
      },
    );
    failureProgress.current = {
      phase: failureProgress.phase,
      populationsBeforeLoad: before,
      fixtureId: infrastructureWorkload.id,
      fixtureSha256: infrastructureWorkload.sha256,
    };
    await page.waitForFunction(
      (expected) => {
        const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
        return Object.entries(expected).every(([id, count]) => {
          const layer = layers.find((row) => row.id === id);
          return layer?.enabled === true && layer?.stats?.count === count;
        });
      },
      { timeout: fixtureTimeoutMs, polling: 100 },
      infrastructureWorkload.expectedLayerCounts,
    );
    const observed = await page.evaluate(observeCommonScene, {
      appCommit: source.appCommit,
    });
    assertInfrastructureClockObservation(
      observed.cesiumClock,
      infrastructureWorkload,
      'setup',
    );
    if (observed.wallClockEpochMs !== infrastructureWorkload.fixedTimeMs)
      throw new Error(
        'Infrastructure document wall clock did not remain at the fixture epoch.',
      );
    fixtureDelivery = await infrastructureFixtureDelivery.summarize(
      observed.environment.layers,
      observed.environment.layers,
    );
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  let austinOperatingSetupObservation = null;
  async function configureAndObserveAustinDocument(targetPage) {
    const before = await targetPage.evaluate(
      configureAustinOperatingPage,
      austinOperatingWorkload,
    );
    const expectedEnabledIds = [
      ...austinOperatingWorkload.selectedLayerIds,
    ].sort();
    if (
      JSON.stringify(before.enabledLayerIds) !==
        JSON.stringify(expectedEnabledIds) ||
      before.wallClockMs !== austinOperatingWorkload.fixedTimeMs ||
      before.qualityMode !== austinOperatingWorkload.visualState.qualityMode ||
      before.densityControl?.id !== 'detection-density-slider' ||
      before.densityControl?.value !==
        String(austinOperatingWorkload.visualState.densityPct) ||
      before.densityControl?.densityPct !==
        austinOperatingWorkload.visualState.densityPct ||
      before.detectionMode !==
        austinOperatingWorkload.visualState.detectionMode ||
      before.cesiumClock?.dayNumber !==
        austinOperatingWorkload.clock.dayNumber ||
      before.cesiumClock?.secondsOfDay !==
        austinOperatingWorkload.clock.secondsOfDay ||
      before.cesiumClock?.shouldAnimate !== false ||
      before.cesiumClock?.multiplier !== 0
    )
      throw new Error(
        `Austin operating setup did not match its fixed route/clock/settings: ${JSON.stringify(before)}`,
      );
    const historyObserver = austinReadinessHistoryEnabled
      ? createAustinOperatingReadinessHistory(targetPage, {
          observerSource:
            austinOperatingModule.observeAustinOperatingReadinessFailure.toString(),
          selectedLayerIds: austinOperatingWorkload.selectedLayerIds,
          documentRole: activeDocumentRole,
          documentId: activeDocumentId,
          phase: 'source-readiness-wait',
          disconnectedEvent: CDPSessionEvent.Disconnected,
        })
      : null;
    const readiness = await waitForAustinOperatingReadiness(
      () =>
        targetPage.waitForFunction(
          austinOperatingSourcesReady,
          { timeout: fixtureTimeoutMs, polling: 100 },
          austinOperatingWorkload.selectedLayerIds,
        ),
      historyObserver,
    );
    recordAustinOperatingReadinessHistory(readiness.history);
    if (readiness.error) {
      const observed = await withSceneFrameDiagnosticTimeout(
        targetPage.evaluate(
          austinOperatingModule.observeAustinOperatingReadinessFailure,
          austinOperatingWorkload.selectedLayerIds,
        ),
        'Austin source readiness failure snapshot',
      );
      const failureEvidence = {
        phase: 'source-readiness-wait',
        documentRole: activeDocumentRole,
        documentId: activeDocumentId,
        status: observed.status,
        snapshot:
          observed.status === 'completed'
            ? observed.value
            : { status: observed.status },
      };
      if (failureProgress.current)
        failureProgress.current.austinReadinessFailure = failureEvidence;
      const records =
        failureProgress.workload.austinOperatingReadinessFailures || [];
      if (records.length < 64) records.push(failureEvidence);
      else
        failureProgress.workload.austinOperatingReadinessFailureOmittedCount =
          (failureProgress.workload
            .austinOperatingReadinessFailureOmittedCount || 0) + 1;
      failureProgress.workload.austinOperatingReadinessFailures = records;
      throw readiness.error;
    }
    const observed = await targetPage.evaluate(observeCommonScene, {
      appCommit: source.appCommit,
    });
    const runtimeState = await targetPage.evaluate(
      observeAustinOperatingRuntimeState,
      austinOperatingWorkload.selectedLayerIds,
      austinOperatingWorkload.expectedLayerCounts,
    );
    assertAustinPopulationEvidence(
      runtimeState,
      austinOperatingWorkload,
      'setup',
    );
    if (
      runtimeState.wallClockMs !== austinOperatingWorkload.fixedTimeMs ||
      runtimeState.windSourceAgeMs !==
        austinOperatingWorkload.windSourceAgeMs ||
      runtimeState.cesiumClock?.dayNumber !==
        austinOperatingWorkload.clock.dayNumber ||
      runtimeState.cesiumClock?.secondsOfDay !==
        austinOperatingWorkload.clock.secondsOfDay ||
      runtimeState.cesiumClock?.shouldAnimate !== false ||
      runtimeState.cesiumClock?.multiplier !== 0 ||
      runtimeState.selectedLayers.length !== expectedEnabledIds.length ||
      runtimeState.selectedLayers.some(
        (layer) => !layer.enabled || layer.error || layer.loading === true,
      ) ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'satellites')
        ?.count !== austinOperatingWorkload.expectedLayerCounts.satellites ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'wind')
        ?.windValidAt !== Date.parse(austinOperatingWorkload.windSourceTime) ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'wind')?.params
        ?.model !== austinOperatingWorkload.visualState.wind.model ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'wind')?.params
        ?.overlay !== austinOperatingWorkload.visualState.wind.overlay ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'wind')?.params
        ?.paused !== false ||
      runtimeState.selectedLayers.find((layer) => layer.id === 'wind')?.params
        ?.units !== austinOperatingWorkload.visualState.wind.units ||
      observed.settings?.qualityMode !==
        austinOperatingWorkload.visualState.qualityMode ||
      observed.settings?.densityPct !==
        austinOperatingWorkload.visualState.densityPct ||
      observed.settings?.detectionMode !==
        austinOperatingWorkload.visualState.detectionMode ||
      runtimeState.satelliteWitness?.noradId !== 25544 ||
      !Number.isFinite(runtimeState.satelliteWitness?.latitude) ||
      !Number.isFinite(runtimeState.satelliteWitness?.longitude)
    )
      throw new Error(
        `Austin native source readiness did not match its fixture contract: ${JSON.stringify(runtimeState)}`,
      );
    const selectedRows = observed.environment.layers
      .filter((layer) => layer.enabled)
      .map((layer) => layer.id)
      .sort();
    if (JSON.stringify(selectedRows) !== JSON.stringify(expectedEnabledIds))
      throw new Error(
        `Austin enabled layer population contains missing or unexpected layers: ${JSON.stringify(selectedRows)}`,
      );
    const requiredAssetIds = [
      ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
      'installations',
    ];
    const delivery = austinOperatingFixtureDelivery.summarize({
      requiredAssetIds,
      requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
        ([z, x, y]) => ({ z, x, y }),
      ),
    });
    return { before, commonScene: observed, runtimeState, delivery };
  }
  if (austinOperatingWorkload) {
    failureProgress.phase = 'configure-austin-operating-fixture';
    const setup = await configureAndObserveAustinDocument(page);
    failureProgress.current = {
      phase: failureProgress.phase,
      fixtureId: austinOperatingWorkload.id,
      fixtureSha256: austinOperatingWorkload.sha256,
      setup: setup.before,
    };
    fixtureDelivery = setup.delivery;
    austinOperatingSetupObservation = setup;
    failureProgress.current.austinSetupObservation =
      austinOperatingSetupObservation;
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  let weatherTimelinePreflight = null;
  if (weatherEffectsWorkload) {
    failureProgress.phase = 'configure-weather-effects-fixture';
    const observedMotionPreference = await page.evaluate(
      weatherEffectsModule.observeWeatherEffectsMotionPreference,
    );
    weatherEffectsModule.recordWeatherMotionPreferencePreflight(
      failureProgress,
      observedMotionPreference,
    );
    const motionPreference =
      weatherEffectsModule.assertWeatherEffectsMotionPreference(
        observedMotionPreference,
        'weather preflight',
      );
    const before = await page.evaluate(
      async ({ fixture, qualityMode: mode, detectionMode: requestedMode }) => {
        const app = window.__godsEyeView;
        const manager = app?.dataManager;
        const viewer = app?.viewer;
        if (!manager || !viewer)
          throw new Error('Weather fixture needs the application viewer.');
        const selected = new Set(fixture.selectedLayerIds);
        for (const layer of manager.getAll()) {
          if (layer.enabled && !selected.has(layer.id))
            await manager.setEnabled(layer.id, false);
        }
        for (const id of fixture.selectedLayerIds) {
          const entry = manager.layers?.get(id);
          if (!entry?.module)
            throw new Error(`Weather fixture layer ${id} is unavailable.`);
          if (id === 'weather-satellite')
            entry.module.setParams({ product: 'clouds-regional' });
          if (id === 'wind')
            entry.module.setParams({
              model: 'gfs',
              overlay: 'speed',
              paused: false,
              units: 'km/h',
            });
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        const controller = app.styleManager?._adaptiveQuality;
        if (!controller?.setMode?.(mode))
          throw new Error('Presentation quality controller is unavailable.');
        const services = app.styleManager?.services;
        const densityControl = document.getElementById(
          'detection-density-slider',
        );
        if (
          typeof app.styleManager?.setDetection !== 'function' ||
          typeof services?.getDetectionTuning !== 'function' ||
          typeof services?.getDetectionMode !== 'function' ||
          !densityControl
        )
          throw new Error('Detection workload controls are unavailable.');
        const densityPct = fixture.visualState.densityPct;
        const detectionResult = app.styleManager.setDetection({
          enabled: true,
          mode: requestedMode,
          densityPct,
        });
        if (mode === 'manual') controller?.rememberManualDensity?.(densityPct);
        const visualDetection = app.styleManager.getVisualState()?.detection;
        if (
          !detectionResult?.ok ||
          services.getDetectionMode() !== requestedMode ||
          services.getDetectionTuning()?.densityPct !== densityPct ||
          densityControl.value !== String(densityPct) ||
          visualDetection?.mode !== requestedMode ||
          visualDetection?.density !== densityPct
        )
          throw new Error(
            `Detection settings did not become ${requestedMode}/${densityPct}.`,
          );
        const clock = viewer.clock;
        if (!clock?.currentTime)
          throw new Error('Cesium Julian clock is unavailable.');
        clock.shouldAnimate = false;
        clock.multiplier = 0;
        clock.currentTime.dayNumber = fixture.clock.dayNumber;
        clock.currentTime.secondsOfDay = fixture.clock.secondsOfDay;
        const destination =
          viewer.scene.globe.ellipsoid.cartographicToCartesian({
            longitude: (fixture.camera.longitudeDeg * Math.PI) / 180,
            latitude: (fixture.camera.latitudeDeg * Math.PI) / 180,
            height: fixture.camera.altitudeM,
          });
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
          destination,
          orientation: {
            heading: (fixture.camera.headingDeg * Math.PI) / 180,
            pitch: (fixture.camera.pitchDeg * Math.PI) / 180,
            roll: 0,
          },
        });
        viewer.scene.requestRender();
        const position = viewer.camera.positionCartographic;
        return {
          populations: manager.getAll().map((layer) => ({
            id: layer.id,
            enabled: Boolean(layer.enabled),
            count: Number.isInteger(layer.stats?.count)
              ? layer.stats.count
              : null,
            loading: Boolean(layer.stats?.loading),
          })),
          camera: position
            ? {
                longitudeDeg: (position.longitude * 180) / Math.PI,
                latitudeDeg: (position.latitude * 180) / Math.PI,
                altitudeM: position.height,
                headingDeg: (viewer.camera.heading * 180) / Math.PI,
                pitchDeg: (viewer.camera.pitch * 180) / Math.PI,
              }
            : null,
        };
      },
      { fixture: weatherEffectsWorkload, qualityMode, detectionMode },
    );
    failureProgress.current = {
      phase: failureProgress.phase,
      populationsBeforeLoad: before.populations,
      cameraObservation: before.camera,
      fixtureId: weatherEffectsWorkload.id,
      fixtureSha256: weatherEffectsWorkload.sha256,
    };
    weatherCameraObservation = before.camera;
    const recordWeatherLayerFailure = async () => {
      let layerState = { status: 'unavailable', layers: [], clock: null };
      try {
        const snapshot = await withSceneFrameDiagnosticTimeout(
          page.evaluate(weatherEffectsModule.observeWeatherEffectsLayerState),
          'Weather selected-layer failure snapshot',
        );
        if (snapshot.status === 'completed') layerState = snapshot.value;
        else
          layerState = {
            status: 'unavailable',
            reason:
              snapshot.status === 'timeout'
                ? 'snapshot-timeout'
                : 'snapshot-error',
            layers: [],
            clock: null,
          };
      } catch {
        // Keep the readiness failure primary if the read-only snapshot fails.
      }
      failureProgress.current.weatherLayerStatesAtFailure = layerState;
      failureProgress.current.weatherFixtureDeliveryAtFailure = {
        responseCounts: weatherEffectsFixtureDelivery.snapshot(),
        routeErrors: weatherEffectsFixtureDelivery.routeErrors.slice(0, 8),
      };
    };
    try {
      const layerReadiness =
        await weatherEffectsModule.waitForWeatherEffectsReadiness(
          page,
          weatherEffectsWorkload,
          weatherEffectsFixtureDelivery,
          fixtureTimeoutMs,
        );
      if (layerReadiness?.status !== 'ready') {
        await recordWeatherLayerFailure();
        throw new Error(
          'Weather selected layer source failed before population readiness.',
        );
      }
    } catch (error) {
      if (!failureProgress.current.weatherLayerStatesAtFailure)
        await recordWeatherLayerFailure();
      throw error;
    }
    let frameResults;
    try {
      frameResults = await weatherEffectsModule.prepareWeatherEffectsTimeline({
        page,
        fixture: weatherEffectsWorkload,
      });
    } catch (error) {
      await recordWeatherLayerFailure();
      throw error;
    }
    weatherEffectsModule.assertWeatherEffectsWindState(
      frameResults.wind?.params,
      frameResults.wind?.stats,
    );
    weatherTimelinePreflight = { ...frameResults, motionPreference };
    await weatherEffectsFixtureDelivery.waitForRequiredAssets(
      fixtureTimeoutMs,
      { signal: weatherEffectsFixtureAbortController?.signal },
    );
    await page.waitForFunction(
      (counts) => {
        const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
        return Object.entries(counts).every(([id, count]) => {
          const row = layers.find((layer) => layer.id === id);
          return row?.enabled === true && row?.stats?.count === count;
        });
      },
      {
        timeout: fixtureTimeoutMs,
        polling: 100,
      },
      weatherEffectsWorkload.expectedLayerCounts,
    );
    const observed = await page.evaluate(observeCommonScene, {
      appCommit: source.appCommit,
    });
    weatherEffectsModule.assertWeatherEffectsClock(
      observed,
      weatherEffectsWorkload,
      'weather-effects setup',
    );
    fixtureDelivery = await weatherEffectsFixtureDelivery.summarize(
      observed.environment.layers,
      observed.environment.layers,
    );
    fixtureDelivery = {
      ...fixtureDelivery,
      cameraObservation: before.camera,
      timelinePreflight: weatherTimelinePreflight,
    };
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  failureProgress.phase = 'configure-aircraft-fixture';
  if (fixture) {
    try {
      await page.waitForFunction(
        () => {
          const diagnostics =
            window.__godsEyeView?.styleManager?.services?.readDetectionDiagnostics?.();
          return (
            diagnostics &&
            diagnostics.observationCount > 0 &&
            diagnostics.candidateCount > 0 &&
            Object.values(diagnostics.labelsByLayer || {}).some(
              (count) => count > 0,
            )
          );
        },
        { timeout: fixtureTimeoutMs },
      );
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => {
          const app = window.__godsEyeView;
          const camera = app?.viewer?.camera;
          const position = camera?.positionCartographic;
          return {
            detection:
              app?.styleManager?.services?.readDetectionDiagnostics?.() ?? null,
            camera: position
              ? {
                  latitudeDeg: (position.latitude * 180) / Math.PI,
                  longitudeDeg: (position.longitude * 180) / Math.PI,
                  heightM: position.height,
                  pitchDeg: (camera.pitch * 180) / Math.PI,
                }
              : null,
          };
        })
        .catch(() => null);
      throw new Error(
        `Aircraft fixture did not produce visible labels within ${fixtureTimeoutMs} ms; diagnostics=${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }
  }

  failureProgress.phase = 'configure-mixed-layers';
  const mixedLayerFixture = mixedLayers
    ? await page.evaluate(async () => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager)
          throw new Error('Mixed-layer fixture needs the data manager');
        const ids = ['local-datacenters', 'local-dams'];
        for (const id of ids) {
          if (!manager.layers?.has(id))
            throw new Error(`Mixed-layer fixture is missing ${id}`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        return ids;
      })
    : null;
  if (mixedLayerFixture) {
    await page.waitForFunction(
      (ids) =>
        ids.every((id) => {
          const layer = window.__godsEyeView?.dataManager
            ?.getAll?.()
            ?.find((entry) => entry.id === id);
          return Number.isFinite(layer?.stats?.count) && layer.stats.count > 0;
        }),
      { timeout: 90_000 },
      mixedLayerFixture,
    );
  }
  if (!fixture) {
    await page.evaluate(
      ({ mode, requestedDetectionMode, densityPct }) => {
        const styleManager = window.__godsEyeView?.styleManager;
        const controller = styleManager?._adaptiveQuality;
        if (!controller?.setMode(mode))
          throw new Error('Presentation quality controller is unavailable');
        const services = styleManager?.services;
        const densityControl = document.getElementById(
          'detection-density-slider',
        );
        if (
          typeof styleManager?.setDetection !== 'function' ||
          typeof services?.getDetectionTuning !== 'function' ||
          typeof services?.getDetectionMode !== 'function' ||
          !densityControl
        )
          throw new Error('Detection workload controls are unavailable');
        const result = styleManager.setDetection({
          enabled: true,
          mode: requestedDetectionMode,
          densityPct,
        });
        if (!result?.ok)
          throw new Error(
            `Detection settings were rejected: ${JSON.stringify(result)}`,
          );
        if (mode === 'manual') controller?.rememberManualDensity?.(densityPct);
        const visualDetection = styleManager.getVisualState()?.detection;
        if (
          services.getDetectionMode() !== requestedDetectionMode ||
          services.getDetectionTuning()?.densityPct !== densityPct ||
          densityControl.value !== String(densityPct) ||
          visualDetection?.mode !== requestedDetectionMode ||
          visualDetection?.density !== densityPct
        )
          throw new Error(
            `Detection settings did not become ${requestedDetectionMode}/${densityPct}`,
          );
      },
      {
        mode: qualityMode,
        requestedDetectionMode: detectionMode,
        densityPct: expectedDensityPct,
      },
    );
  }

  await page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    window.__gevPerformanceHome = {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      transform: camera.transform.clone(),
    };
  });
  const commonScene = await page.evaluate(observeCommonScene, {
    appCommit: source.appCommit,
  });
  const environment = commonScene.environment;
  environment.startup = {
    runs: startupSamples,
    runCount: startupSamples.length,
    measurement: infrastructureWorkload
      ? 'one measured app document; cache disabled before navigation'
      : 'cache-disabled fresh browser contexts',
    performancePageInitialSettleMs: mainStartupElapsedMs,
  };
  const softwareRenderer =
    /swiftshader|software|llvmpipe|mesa offscreen|angle \(.*software/i.test(
      environment.renderer || '',
    );
  environment.hardwareEligible =
    Boolean(environment.renderer) &&
    !softwareRenderer &&
    !nativeRenderingDiagnostic;
  if (nativeRenderingDiagnostic) {
    const currentRendererEvidence = nativeRendererDiagnosticEvidence({
      renderer: environment.renderer,
      vendor: environment.vendor,
      graphics,
    });
    if (
      currentRendererEvidence.observedRenderer !==
        nativeRendererEvidence.observedRenderer ||
      currentRendererEvidence.observedWebglVendor !==
        nativeRendererEvidence.observedWebglVendor
    )
      throw new Error(
        'Cesium renderer changed after native diagnostic verification.',
      );
    assertVerifiedNativeRendererEvidence(
      nativeRendererEvidence,
      environment.renderer,
      environment.vendor,
    );
  }

  if (mapStreamingWorkloadSelected) {
    if (comparisonProfile === 'native-sharpness-v1')
      await page.evaluate(applyNativeSharpnessProfile);
    failureProgress.phase = 'austin-map-streaming-route';
    failureProgress.workload.mapStreamingCapture = {
      status: 'running',
      fixtureId: mapStreamingFixture.id,
      manifestSha256: mapStreamingFixture.manifestSha256,
      routeId: mapStreamingModule.MAP_STREAMING_ROUTE.id,
    };
    mapStreamingJourneys = [];
    for (let run = 1; run <= runs; run += 1) {
      const journey = await mapStreamingModule.runNativeMapStreamingJourney(
        page,
        {
          durationMs: mapStreamingModule.MAP_STREAMING_ROUTE.durationLimitMs,
          route: mapStreamingModule.MAP_STREAMING_ROUTE,
          warmupMs: mapStreamingModule.MAP_STREAMING_ROUTE.warmupMs,
          comparisonProfile,
        },
      );
      mapStreamingJourneys.push({ run, ...journey });
      if (!mapStreamingJourney) mapStreamingJourney = journey;
    }
    failureProgress.workload.mapStreamingCapture = {
      status: 'journey-observed',
      fixtureId: mapStreamingFixture.id,
      manifestSha256: mapStreamingFixture.manifestSha256,
      routeId: mapStreamingModule.MAP_STREAMING_ROUTE.id,
      route: mapStreamingJourney.route,
      transitionCount: mapStreamingJourney.transitions.length,
      runCount: mapStreamingJourneys.length,
    };
  }

  const scenarios = ['idle', 'scripted-motion'];
  if (fixture) scenarios.push('selected-aircraft-tracking');
  const captureDocumentTopology = createCaptureDocumentTopology({
    infrastructure: Boolean(infrastructureWorkload || weatherEffectsWorkload),
    reuseMainDocumentForSamples: mapStreamingWorkloadSelected,
    startupRuns,
    captureCount: scenarios.length * runs,
  });
  failureProgress.scenarios = scenarios;
  const captures = [];
  failureProgress.completedSamples = captures;
  failureProgress.phase = infrastructureWorkload
    ? 'verify-infrastructure-populations'
    : 'verify-dense-populations';
  const mixedLayerCounts = productionFlightFixture
    ? await page.evaluate(() => {
        const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
        return {
          datacenters:
            layers.find((entry) => entry.id === 'local-datacenters')?.stats
              ?.count ?? null,
          dams:
            layers.find((entry) => entry.id === 'local-dams')?.stats?.count ??
            null,
        };
      })
    : null;
  if (
    productionFlightFixture &&
    (mixedLayerCounts.datacenters !== 4362 || mixedLayerCounts.dams !== 716)
  )
    throw new Error(
      `Provider-fixture mixed populations are incomplete: ${JSON.stringify(mixedLayerCounts)}`,
    );

  if (productionFlightFixture) {
    const terminalSetupObservation = await page.evaluate(
      observeTerminalViewerState,
      'layer-population',
      ['flights', 'local-datacenters', 'local-dams'],
    );
    recordRendererLoopRetirement({
      phase: 'main-setup-final-population',
      documentRole: activeDocumentRole,
      documentId: activeDocumentId,
      population: terminalSetupObservation.observation,
      ...terminalSetupObservation.renderLoopRetirement,
    });
    if (terminalSetupObservation.renderLoopRetirement.confirmed !== true)
      throw new Error(
        'Main setup render loop retirement at its final population observation was not confirmed.',
      );
    const expectedSetupPopulation = {
      flights: productionFlightFixture.count,
      'local-datacenters': 4362,
      'local-dams': 716,
    };
    if (
      Object.entries(expectedSetupPopulation).some(
        ([id, count]) =>
          terminalSetupObservation.observation[id]?.enabled !== true ||
          terminalSetupObservation.observation[id]?.count !== count,
      )
    )
      throw new Error('Provider setup terminal population changed.');
    fixtureDelivery = await summarizeFlightFixtureDelivery(
      terminalSetupObservation.observation.flights.count,
    );
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  let providerSampleDocumentIndex = 0;
  async function prepareFreshProviderDocument() {
    providerSampleDocumentIndex += 1;
    const retiringAustinOwner = activeAustinFixtureOwner;
    await retireProviderDocument({
      retireRenderer: async () => {
        const expectedAttributionOwner = activeDepthPickAttribution;
        const attributionCleanup = await disposeDepthPickAttributionForPage(
          page,
          expectedAttributionOwner,
        );
        const rendererCleanup = await cleanupEarlyRendererProbeForPage(page, {
          retireViewerRenderLoop: true,
          phase: 'provider-document-retirement',
          documentRole: activeDocumentRole,
          documentId: activeDocumentId,
        });
        return (
          rendererCleanup === true &&
          depthPickRetirementConfirmed(
            depthPickAttributionEnabled,
            expectedAttributionOwner,
            attributionCleanup,
          )
        );
      },
      auditWorkers: async () => {
        if (
          providerSampleWorkerAuditComplete &&
          workerAuditMode !== 'receipt-only'
        )
          return;
        await auditPageWorkerEvidence(page, captureAuditState, {
          documentRole: activeDocumentRole,
          documentId: activeDocumentId,
        });
        providerSampleWorkerAuditComplete = true;
      },
      disposeProgressBinding: async () => {
        const bindingCleanup = await disposeActiveRenderBoundaryProgressBinding(
          'document-replaced',
          { documentClosed: true },
        );
        if (bindingCleanup && !bindingCleanup.removed)
          throw new Error(
            'Render-boundary binding cleanup failed before document replacement.',
          );
      },
      stopInterception: async () => {
        for (const session of [
          activeFixtureSession,
          activeAustinFixtureSession,
        ].filter(Boolean)) {
          const stopped = await stopFlightFixtureSession(session);
          if (!stopped?.confirmed)
            throw new Error(
              'Fixture interception stop and command drain were not confirmed.',
            );
        }
      },
      closeDocument: async () => {
        if (providerContext) await providerContext.close();
        else await closeReceiptOnlyAuditPage(page);
        if (workerAuditMode === 'receipt-only') {
          finalizeReceiptOnlyDocumentAudit?.();
          finalizeReceiptOnlyDocumentAudit = null;
        }
      },
      releaseInterception: async () => {
        for (const session of [
          activeFixtureSession,
          activeAustinFixtureSession,
        ].filter(Boolean))
          await releaseFlightFixtureSession(session);
      },
    });
    if (retiringAustinOwner)
      finalizeAustinOperatingFixtureDelivery(
        retiringAustinOwner,
        'provider-document-retired-after-interception-release',
      );
    providerContext = await browser.createBrowserContext();
    page = await providerContext.newPage();
    activePage = page;
    ({ documentRole: activeDocumentRole, documentId: activeDocumentId } =
      captureDocumentTopology.samples[providerSampleDocumentIndex - 1]);
    flightFixtureDelivery = productionFlightFixture
      ? createFlightFixtureDeliveryObserver(
          productionFlightFixture,
          new URL(url).origin + '/',
        )
      : null;
    const pageAttachment = await attachMeasuredPage(
      page,
      flightFixtureDelivery,
      {
        documentRole: activeDocumentRole,
        documentId: activeDocumentId,
      },
    );
    activeFixtureSession = pageAttachment.fixtureSession;
    austinOperatingFixtureDelivery =
      pageAttachment.austinFixture?.delivery || null;
    activeAustinFixtureSession = pageAttachment.austinFixture?.session || null;
    activeAustinFixtureOwner = pageAttachment.austinFixture?.owner || null;
    captureAuditState = pageAttachment.auditState;
    setReceiptOnlyDocumentFinalizer();
    captureAuditState.workerUrls.clear();
    captureAuditState.blobUrls.clear();
    providerSampleWorkerAuditComplete = false;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (captureProvenance) {
      const servedBase = new URL(buildProvenanceOptions.baseUrl);
      const actualPage = new URL(page.url());
      if (
        actualPage.origin !== servedBase.origin ||
        !captureProvenance.source.entryPaths.includes(actualPage.pathname)
      )
        throw new Error(
          'Provider-fixture navigation redirected outside the verified application entry point.',
        );
    }
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    if (depthPickAttributionEnabled) {
      const identity = createDepthPickAttributionIdentity(captures, {
        scenario: failureProgress.scenario,
        run: failureProgress.run,
        documentRole: activeDocumentRole,
        documentId: activeDocumentId,
      });
      const installed = await page.evaluate(installDepthPickAttribution, {
        ...identity,
        maxRows: 128,
      });
      if (
        installed?.installed !== true ||
        typeof installed.ownerToken !== 'string' ||
        installed.ownerToken.length > 160
      )
        throw new Error('Depth-pick attribution observer installation failed.');
      const sample = {
        ...identity,
        schema: 'gev-depth-pick-attribution-sample/v1',
        ownerToken: installed.ownerToken,
        install: installed,
        warmupBoundary: null,
        measurementBoundary: null,
        cleanupConfirmed: false,
      };
      depthPickAttributionSamples.push(sample);
      activeDepthPickAttribution = { ownerToken: installed.ownerToken, sample };
      failureProgress.workload.depthPickAttribution =
        depthPickAttributionEnvelope();
      if (failureProgress.current)
        failureProgress.current.depthPickAttribution = sample;
    }
    await disableCaptureDiagnostics(page, activeDocumentRole, activeDocumentId);
    await page.waitForFunction(
      () =>
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
      throw new Error(
        'Provider-fixture page is controlled by a service worker.',
      );
    if (austinOperatingWorkload) {
      failureProgress.phase = 'configure-austin-operating-sample-document';
      failureProgress.current = {
        ...failureProgress.current,
        phase: failureProgress.phase,
      };
      const setup = await configureAndObserveAustinDocument(page);
      austinOperatingSetupObservation = setup;
      fixtureDelivery = setup.delivery;
      failureProgress.current.austinSetupObservation = setup;
      failureProgress.fixtureDelivery = fixtureDelivery;
    }
    if (productionFlightFixture) {
      const initialEpoch = await page.evaluate(() => ({
        now: Date.now(),
        clock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
      }));
      if (
        initialEpoch.now !== productionFlightFixture.fixedTimeMs ||
        initialEpoch.clock?.phase !== 'setup'
      )
        throw new Error(
          `Provider-fixture document did not start at the held epoch: ${JSON.stringify(initialEpoch)}`,
        );
      await page.evaluate(
        async ({
          qualityMode: mode,
          detectionMode: requestedDetectionMode,
          densityPct,
        }) => {
          const app = window.__godsEyeView;
          const manager = app.dataManager;
          if (!manager.isEnabled('flights'))
            await manager.setEnabled('flights', true);
          const controller = app.styleManager?._adaptiveQuality;
          if (controller && !controller.setMode(mode))
            throw new Error('Presentation quality controller is unavailable');
          if (!controller && mode !== 'manual')
            throw new Error('Requested quality profile is unavailable');
          const services = app.styleManager?.services;
          const densityControl = document.getElementById(
            'detection-density-slider',
          );
          if (
            typeof app.styleManager?.setDetection !== 'function' ||
            typeof services?.getDetectionTuning !== 'function' ||
            typeof services?.getDetectionMode !== 'function' ||
            !densityControl
          )
            throw new Error('Detection workload controls are unavailable');
          const requestedDensity = Number.isFinite(densityPct)
            ? densityPct
            : services.getDetectionTuning()?.densityPct;
          if (!Number.isFinite(requestedDensity))
            throw new Error('Detection density is unavailable');
          const detectionResult = app.styleManager.setDetection({
            enabled: true,
            mode: requestedDetectionMode,
            densityPct: requestedDensity,
          });
          if (!detectionResult?.ok)
            throw new Error(
              `Detection settings were rejected: ${JSON.stringify(detectionResult)}`,
            );
          if (mode === 'manual')
            controller?.rememberManualDensity?.(requestedDensity);
          const visualDetection = app.styleManager.getVisualState()?.detection;
          if (
            services.getDetectionMode() !== requestedDetectionMode ||
            services.getDetectionTuning()?.densityPct !== requestedDensity ||
            densityControl.value !== String(requestedDensity) ||
            visualDetection?.mode !== requestedDetectionMode ||
            visualDetection?.density !== requestedDensity
          )
            throw new Error(
              `Detection settings did not become ${requestedDetectionMode}/${requestedDensity}`,
            );
          for (const id of ['local-datacenters', 'local-dams']) {
            const entry = manager.layers.get(id);
            if (!entry) throw new Error(`Missing required mixed layer ${id}`);
            if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
          }
          const viewer = app.viewer;
          const destination =
            viewer.scene.globe.ellipsoid.cartographicToCartesian({
              longitude: (-97.7431 * Math.PI) / 180,
              latitude: (30.2672 * Math.PI) / 180,
              height: 130_000,
            });
          viewer.camera.cancelFlight?.();
          viewer.camera.setView({
            destination,
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          });
          viewer.scene.requestRender();
        },
        {
          qualityMode,
          detectionMode,
          densityPct: expectedDensityPct,
        },
      );
      await page.waitForFunction(
        (counts) => {
          const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
          const getLayer = (id) => layers.find((entry) => entry.id === id);
          return (
            ['flights', 'local-datacenters', 'local-dams'].every(
              (id) => getLayer(id)?.enabled === true,
            ) &&
            getLayer('flights')?.stats?.count === counts.flights &&
            getLayer('local-datacenters')?.stats?.count ===
              counts.datacenters &&
            getLayer('local-dams')?.stats?.count === counts.dams
          );
        },
        { timeout: fixtureTimeoutMs, polling: 100 },
        {
          flights: productionFlightFixture.count,
          datacenters: mixedLayerCounts.datacenters,
          dams: mixedLayerCounts.dams,
        },
      );
      fixtureDelivery = await summarizeFlightFixtureDelivery();
      failureProgress.fixtureDelivery = fixtureDelivery;
      await page.evaluate(() => {
        const camera = window.__godsEyeView.viewer.camera;
        window.__gevPerformanceHome = {
          position: camera.position.clone(),
          direction: camera.direction.clone(),
          up: camera.up.clone(),
          transform: camera.transform.clone(),
        };
      });
    }
  }

  for (const scenario of scenarios) {
    for (let run = 1; run <= runs; run += 1) {
      failureProgress.phase = 'prepare-sample-context';
      failureProgress.scenario = scenario;
      failureProgress.run = run;
      failureProgress.current = { phase: failureProgress.phase, scenario, run };
      process.stdout.write(`[performance] ${scenario} ${run}/${runs}\n`);
      if (productionFlightFixture || austinOperatingWorkload) {
        failureProgress.phase = 'prepare-fresh-provider-document';
        failureProgress.current.phase = failureProgress.phase;
        await prepareFreshProviderDocument();
      }
      failureProgress.phase = 'configure-scenario-route';
      failureProgress.current.phase = failureProgress.phase;
      const trackingResult = await page.evaluate(
        async ({ scenarioName, hasFixture }) => {
          const app = window.__godsEyeView;
          const viewer = app.viewer;
          const flights = app.dataManager.layers.get('flights')?.module;
          let trackedAircraftId = null;
          if (viewer.trackedEntity) flights?.stopTracking?.();
          if (scenarioName === 'selected-aircraft-tracking') {
            if (!hasFixture || typeof flights?.trackById !== 'function')
              throw new Error(
                'Selected-aircraft workload requires an injected flight fixture',
              );
            if (!flights.trackById('000001'))
              throw new Error('Selected-aircraft fixture could not be tracked');
            if (viewer.trackedEntity?.gevTrackedId !== 'flights:000001')
              throw new Error(
                'Selected-aircraft tracker did not claim the camera',
              );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            trackedAircraftId = viewer.trackedEntity.gevTrackedId;
          } else {
            viewer.camera.cancelFlight?.();
            const home = window.__gevPerformanceHome;
            viewer.camera.setView({
              destination: home.position,
              orientation: { direction: home.direction, up: home.up },
              endTransform: home.transform,
            });
            viewer.scene.requestRender();
          }
          return { trackedAircraftId };
        },
        { scenarioName: scenario, hasFixture: Boolean(fixture) },
      );
      const trackingSetup = trackingResult?.trackedAircraftId ?? null;
      failureProgress.current.trackingSetup = trackingSetup;
      failureProgress.phase = 'activate-sample-foreground';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.foregroundActivation =
        await activateCapturePage(page);
      let boundaryProgressBindingRecord = null;
      if (productionFlightFixture || austinOperatingWorkload) {
        failureProgress.phase = 'prepare-render-boundary-binding';
        failureProgress.current.phase = failureProgress.phase;
        boundaryProgressBindingRecord = {
          ownerId: `${activeDocumentRole}:${activeDocumentId}`.slice(0, 160),
          status: 'setup-pending',
          setupTimeoutMs: 5000,
          setupElapsedMs: null,
          cleanup: null,
        };
        failureProgress.current.renderBoundaryProgressBinding =
          boundaryProgressBindingRecord;
        const setupStartedAt = performance.now();
        try {
          activeRenderBoundaryProgressBinding =
            await prepareRenderBoundaryProgressBinding({
              page,
              ownerId: boundaryProgressBindingRecord.ownerId,
              timeoutMs: boundaryProgressBindingRecord.setupTimeoutMs,
            });
          activeRenderBoundaryProgressBindingRecord =
            boundaryProgressBindingRecord;
          boundaryProgressBindingRecord.setupElapsedMs =
            activeRenderBoundaryProgressBinding.setupElapsedMs;
          boundaryProgressBindingRecord.cleanupTimeoutMs =
            activeRenderBoundaryProgressBinding.cleanupTimeoutMs;
          boundaryProgressBindingRecord.status = 'ready';
        } catch (error) {
          boundaryProgressBindingRecord.setupElapsedMs = Math.max(
            0,
            performance.now() - setupStartedAt,
          );
          boundaryProgressBindingRecord.status =
            error?.name === 'TimeoutError' ? 'setup-timeout' : 'setup-failed';
          boundaryProgressBindingRecord.error = {
            name: String(error?.name || 'Error').slice(0, 80),
            message: String(error?.message || error).slice(0, 240),
          };
          boundaryProgressBindingRecord.lateRemovalScheduled =
            error?.lateRemovalScheduled === true;
          if (error?.cleanupError)
            boundaryProgressBindingRecord.cleanup = {
              removed: false,
              error: error.cleanupError,
            };
          throw error;
        }
      }
      const collectSceneFrameAttribution =
        sceneFrameDiagnosticsEnabled &&
        Boolean(productionFlightFixture) &&
        scenario === 'scripted-motion' &&
        run === 1;
      if (collectSceneFrameAttribution)
        await startSceneFrameAttribution(page, failureProgress.current);
      const collectProviderSampleCpuProfile = shouldProfileProviderSample(
        scenario,
        run,
      );
      if (collectProviderSampleCpuProfile)
        await startProviderSampleCpuProfile(page, failureProgress.current, {
          scenario,
          run,
          captureOrdinal: captures.length,
          documentRole: activeDocumentRole,
          documentId: activeDocumentId,
        });
      // Start the fixture epoch only after observer setup so its host cost is
      // outside both warmup and measurement render-boundary deadlines.
      let weatherSampleReset = null;
      if (weatherEffectsWorkload) {
        failureProgress.phase = 'reset-weather-latest-before-warmup';
        failureProgress.current.phase = failureProgress.phase;
        weatherSampleReset =
          await weatherEffectsModule.resetWeatherEffectsToLatest({
            page,
            fixture: weatherEffectsWorkload,
          });
        failureProgress.current.weatherSampleReset = weatherSampleReset;
      }
      const hasPhasedFixtureClock = Boolean(
        productionFlightFixture || austinOperatingWorkload,
      );
      const phaseRunOrdinal = hasPhasedFixtureClock
        ? expectedFixtureRunOrdinal({
            sharedDocument: false,
            completedSampleCount: captures.length,
          })
        : null;
      const clockStart = hasPhasedFixtureClock
        ? await page.evaluate(
            ({ resetCompletedRun, expectedRunOrdinal }) => {
              const clock = window.__gevPhasedMonotonicWallClockV1;
              if (!clock)
                throw new Error('Phased fixture clock is unavailable.');
              let before = clock.snapshot();
              if (before.phase === 'complete' && resetCompletedRun)
                before = clock.resetForNextRun(expectedRunOrdinal - 1);
              if (before.phase !== 'setup')
                throw new Error(
                  `Fixture clock cannot start warmup from ${before.phase}.`,
                );
              const started = clock.startWarmup(expectedRunOrdinal);
              return { before, started };
            },
            {
              resetCompletedRun: false,
              expectedRunOrdinal: phaseRunOrdinal,
            },
          )
        : null;
      if (
        austinOperatingWorkload &&
        (clockStart?.before?.runOrdinal !== phaseRunOrdinal ||
          clockStart?.started?.runOrdinal !== phaseRunOrdinal ||
          clockStart?.started?.phase !== 'warmup' ||
          clockStart?.started?.epochMs !== austinOperatingWorkload.fixedTimeMs)
      )
        throw new Error(
          `Austin phased clock did not start its declared run: ${JSON.stringify(clockStart)}`,
        );
      failureProgress.current.clockStart = clockStart;
      let nativeSharpnessProfile = null;
      if (comparisonProfile === 'native-sharpness-v1') {
        nativeSharpnessProfile = await page.evaluate(
          applyNativeSharpnessProfile,
        );
        failureProgress.current.nativeSharpnessProfile = nativeSharpnessProfile;
      }
      // Each workload/run receives the declared warmup, including tracking.
      failureProgress.phase = 'warmup';
      failureProgress.current.phase = failureProgress.phase;
      if (warmupMs)
        await new Promise((resolve) => setTimeout(resolve, warmupMs));
      let fixtureBoundaryStart = null;
      let warmupBoundarySettle = null;
      let measurementBoundarySettle = null;
      let clockEnd = null;
      let prewarmWorkerAuditTimingBoundary = null;
      if (workerAuditMode === 'prewarm') {
        failureProgress.phase = 'prewarm-worker-audit-after-warmup';
        failureProgress.current.phase = failureProgress.phase;
        failureProgress.current.prewarmWorkerAudit = {
          status: 'pending',
          timingBoundary: PREWARM_WORKER_AUDIT_BOUNDARY,
          warmupMs,
        };
      }
      const prewarm = await runWorkerAuditAtWarmupBoundary({
        auditMode: workerAuditMode,
        warmupMs,
        readWarmupBoundary: async () => {
          if (productionFlightFixture || austinOperatingWorkload) {
            const warmupProgressRecord = failureProgress.current;
            try {
              warmupBoundarySettle = await settleProviderRenderAtBoundary(
                page,
                'Warmup boundary',
                5000,
                warmupProgressRecord
                  ? createBoundaryProgressRecorder(
                      warmupProgressRecord,
                      'warmupBoundaryObservation',
                    )
                  : undefined,
                activeRenderBoundaryProgressBinding,
                {
                  finalObservationFunction: depthPickAttributionEnabled
                    ? observeDepthPickAttributionBoundary
                    : null,
                  finalObservationArgs: depthPickAttributionEnabled
                    ? [
                        {
                          label: 'warmup-boundary',
                          ownerToken: activeDepthPickAttribution?.ownerToken,
                        },
                      ]
                    : [],
                  beforeRenderRequestFunction: holdProviderWarmupBoundary,
                  beforeRenderRequestArgs: [warmupMs, phaseRunOrdinal],
                },
              );
            } catch (error) {
              if (depthPickAttributionEnabled && activeDepthPickAttribution) {
                retainDepthPickBoundaryFailure(
                  activeDepthPickAttribution.sample,
                  'warmupBoundary',
                  error,
                );
                failureProgress.current.depthPickAttribution =
                  activeDepthPickAttribution.sample;
                failureProgress.workload.depthPickAttribution =
                  depthPickAttributionEnvelope();
              }
              throw error;
            }
            fixtureBoundaryStart =
              readProviderWarmupBoundarySnapshot(warmupBoundarySettle);
            if (
              austinOperatingWorkload &&
              (fixtureBoundaryStart?.runOrdinal !== phaseRunOrdinal ||
                fixtureBoundaryStart?.epochMs !==
                  austinOperatingWorkload.fixedTimeMs + warmupMs)
            )
              throw new Error(
                `Austin warmup boundary clock snapshot is invalid: ${JSON.stringify(fixtureBoundaryStart)}`,
              );
            if (depthPickAttributionEnabled && activeDepthPickAttribution) {
              const observation =
                warmupBoundarySettle?.page?.diagnostics?.finalObservation ??
                null;
              activeDepthPickAttribution.sample.warmupBoundary = observation;
              if (failureProgress.current)
                failureProgress.current.depthPickAttribution =
                  activeDepthPickAttribution.sample;
              failureProgress.workload.depthPickAttribution =
                depthPickAttributionEnvelope();
            }
            failureProgress.current.warmupBoundarySettle = warmupBoundarySettle;
            failureProgress.current.warmupBoundary = fixtureBoundaryStart;
            if (warmupBoundarySettle?.status !== 'settled')
              throw new Error(
                warmupBoundarySettle?.error?.message ||
                  'Provider fixture warmup completed-render boundary failed.',
              );
          }
          failureProgress.current.warmupBoundary = fixtureBoundaryStart;
          return fixtureBoundaryStart;
        },
        settleCompletedRender: async () => {
          if (!productionFlightFixture && !austinOperatingWorkload)
            warmupBoundarySettle = null;
          failureProgress.current.warmupBoundarySettle = warmupBoundarySettle;
          if (failureProgress.current.prewarmWorkerAudit) {
            failureProgress.current.prewarmWorkerAudit.fixtureClockElapsedMs =
              fixtureBoundaryStart?.elapsedMs ?? null;
            failureProgress.current.prewarmWorkerAudit.completedRenderSettleMs =
              warmupBoundarySettle?.settleElapsedMs ?? null;
          }
          return warmupBoundarySettle;
        },
        audit: () =>
          auditPageWorkerBlobs(page, captureAuditState, {
            documentRole: activeDocumentRole,
            documentId: activeDocumentId,
            auditMode: 'prewarm',
            requireEvidence: true,
          }),
      });
      if (workerAuditMode === 'prewarm') {
        prewarm.documentAudit.timingBoundary = prewarm.timingBoundary;
        activePrewarmedWorkerInventory = prewarm.inventory;
        activePrewarmedWorkerDocument = prewarm.documentAudit;
        providerSampleWorkerAuditComplete = false;
        prewarmWorkerAuditTimingBoundary = prewarm.timingBoundary;
        failureProgress.current.prewarmWorkerAudit = {
          status: 'passed',
          ...prewarm.timingBoundary,
        };
      }
      const trackingStart =
        scenario === 'selected-aircraft-tracking'
          ? await page.evaluate(observeTrackedEntityBoundary, 'flights:000001')
          : null;
      failureProgress.current.warmupBoundary = fixtureBoundaryStart;
      failureProgress.current.warmupBoundarySettle = warmupBoundarySettle;
      if (prewarmWorkerAuditTimingBoundary)
        failureProgress.current.prewarmWorkerAuditTimingBoundary =
          prewarmWorkerAuditTimingBoundary;
      if (trackingStart) failureProgress.current.trackingStart = trackingStart;
      failureProgress.phase = 'activate-measurement-foreground';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.measurementForegroundActivation =
        await activateCapturePage(page);
      const fixtureMeasurementStart =
        productionFlightFixture || austinOperatingWorkload
          ? await page.evaluate(() => ({
              clock:
                window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
              wallTimeMs: Date.now(),
              flightStats:
                window.__godsEyeView?.dataManager?.layers
                  ?.get('flights')
                  ?.module?.getStats?.() ?? null,
              satelliteWitness:
                window.__godsEyeView?.dataManager?.layers
                  ?.get('satellites')
                  ?.module?.getAllPositions?.(300)
                  ?.find((record) => record.id === 25544) ?? null,
              documentVisible: !document.hidden,
              documentFocused: document.hasFocus(),
            }))
          : null;
      failureProgress.phase = 'validate-measurement-start';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.measurementStart = fixtureMeasurementStart;
      if (
        productionFlightFixture &&
        (fixtureMeasurementStart.clock.phase !== 'warmup-held' ||
          fixtureMeasurementStart.clock.startCount !== 1 ||
          fixtureMeasurementStart.clock.elapsedMs !== warmupMs ||
          fixtureMeasurementStart.wallTimeMs <
            productionFlightFixture.fixedTimeMs ||
          fixtureMeasurementStart.wallTimeMs -
            productionFlightFixture.fixedTimeMs >
            120_000 ||
          fixtureMeasurementStart.flightStats?.lastUpdate !==
            productionFlightFixture.fixedTimeMs ||
          fixtureMeasurementStart.flightStats?.stale !== false ||
          fixtureMeasurementStart.flightStats?.count !==
            productionFlightFixture.count ||
          !fixtureMeasurementStart.documentVisible ||
          !fixtureMeasurementStart.documentFocused)
      )
        throw new Error(
          `Provider fixture was stale or unfocused at measurement start: ${JSON.stringify(fixtureMeasurementStart)}`,
        );
      if (
        austinOperatingWorkload &&
        (fixtureMeasurementStart.clock?.phase !== 'warmup-held' ||
          fixtureMeasurementStart.clock?.runOrdinal !== phaseRunOrdinal ||
          fixtureMeasurementStart.clock?.elapsedMs !== warmupMs ||
          fixtureMeasurementStart.wallTimeMs !==
            austinOperatingWorkload.fixedTimeMs + warmupMs ||
          fixtureMeasurementStart.clock?.epochMs !==
            austinOperatingWorkload.fixedTimeMs + warmupMs ||
          fixtureMeasurementStart.satelliteWitness?.id !== 25544 ||
          !Number.isFinite(
            fixtureMeasurementStart.satelliteWitness?.latitude,
          ) ||
          !Number.isFinite(
            fixtureMeasurementStart.satelliteWitness?.longitude,
          ) ||
          !austinOperatingSetupObservation?.runtimeState?.satelliteWitness ||
          (fixtureMeasurementStart.satelliteWitness.latitude ===
            austinOperatingSetupObservation.runtimeState.satelliteWitness
              .latitude &&
            fixtureMeasurementStart.satelliteWitness.longitude ===
              austinOperatingSetupObservation.runtimeState.satelliteWitness
                .longitude) ||
          !fixtureMeasurementStart.documentVisible ||
          !fixtureMeasurementStart.documentFocused)
      )
        throw new Error(
          `Austin fixture clock or satellite witness was invalid at measurement start: ${JSON.stringify(fixtureMeasurementStart)}`,
        );
      const sceneBefore = await page.evaluate(observeCommonScene, {
        appCommit: source.appCommit,
      });
      if (comparisonProfile === 'native-sharpness-v1')
        assertNativeSharpnessProfile(
          sceneBefore,
          `${scenario} run ${run} before`,
        );
      const austinStateBefore = austinOperatingWorkload
        ? await page.evaluate(
            observeAustinOperatingRuntimeState,
            austinOperatingWorkload.selectedLayerIds,
            austinOperatingWorkload.expectedLayerCounts,
            true,
          )
        : null;
      if (austinOperatingWorkload)
        assertAustinPopulationEvidence(
          austinStateBefore,
          austinOperatingWorkload,
          `${scenario} run ${run} measurement start`,
        );
      const weatherStateBefore = weatherEffectsWorkload
        ? await page.evaluate(observeWeatherEffectsRuntimeState)
        : null;
      failureProgress.phase = 'measure-scene';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.before = sceneBefore;
      const rawSamplePromise = page.evaluate(
        async ({
          durationMs,
          scenarioName,
          delay,
          recordFrameWindow,
          expectedRunOrdinal,
          frameTraceEnabled,
        }) => {
          const viewer = window.__godsEyeView.viewer;
          const scene = viewer.scene;
          const stagedClock = window.__gevPhasedMonotonicWallClockV1;
          const focusedAtStart = document.hasFocus();
          const visibleAtStart = !document.hidden;
          let focusInterruptionCount = 0;
          let visibleThroughout = visibleAtStart;
          const onBlur = () => {
            focusInterruptionCount += 1;
          };
          const onVisibility = () => {
            if (document.hidden) visibleThroughout = false;
          };
          window.addEventListener('blur', onBlur);
          document.addEventListener('visibilitychange', onVisibility);
          const intervals = [];
          const longTasks = [];
          const longTaskTrace = frameTraceEnabled ? [] : null;
          let previous = null;
          let renderedFrameCount = 0;
          let lastPreRenderAt = null;
          let appliedRoutePhaseMs = null;
          const frameTrace = frameTraceEnabled ? [] : null;
          const boundedDiagnosticLabel = (value) => {
            if (typeof value === 'string') return value.slice(0, 96);
            if (
              value == null ||
              typeof value === 'number' ||
              typeof value === 'boolean'
            )
              return String(value);
            try {
              return JSON.stringify(value).slice(0, 96);
            } catch {
              return null;
            }
          };
          const onPreRender = () => {
            if (frameTrace && frameTrace.length < 4096)
              lastPreRenderAt = performance.now();
          };
          const onRender = () => {
            renderedFrameCount += 1;
            const now = performance.now();
            if (previous != null) intervals.push(now - previous);
            previous = now;
            if (frameTrace && frameTrace.length < 4096) {
              const governor =
                window.__godsEyeView.getRenderGovernorDiagnostics?.() || null;
              frameTrace.push({
                postRenderAtMs: now,
                preRenderAtMs: lastPreRenderAt,
                routePhaseMs: appliedRoutePhaseMs,
                intervalMs:
                  frameTrace.length > 0
                    ? now - frameTrace[frameTrace.length - 1].postRenderAtMs
                    : null,
                sceneRenderWallMs:
                  lastPreRenderAt == null
                    ? null
                    : Math.max(0, now - lastPreRenderAt),
                focused: document.hasFocus(),
                visible: !document.hidden,
                requestRenderMode: Boolean(scene.requestRenderMode),
                governor: governor
                  ? {
                      mode: governor.mode ?? null,
                      holds: Array.isArray(governor.holds)
                        ? governor.holds
                            .slice(0, 32)
                            .map(boundedDiagnosticLabel)
                        : null,
                      scheduledUpdates: Array.isArray(governor.scheduledUpdates)
                        ? governor.scheduledUpdates
                            .slice(0, 32)
                            .map(boundedDiagnosticLabel)
                        : null,
                    }
                  : null,
              });
            }
          };
          if (frameTrace) scene.preRender?.addEventListener?.(onPreRender);
          scene.postRender.addEventListener(onRender);
          let observer = null;
          if (typeof PerformanceObserver !== 'undefined') {
            try {
              observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  longTasks.push(entry.duration);
                  if (
                    longTaskTrace &&
                    startedAt != null &&
                    Number.isFinite(entry.startTime) &&
                    entry.startTime >= startedAt &&
                    longTaskTrace.length < 2048
                  )
                    longTaskTrace.push({
                      startTimeMs: Number(entry.startTime),
                      durationMs: Number(entry.duration),
                    });
                }
              });
              observer.observe({ type: 'longtask', buffered: false });
            } catch {
              observer = null;
            }
          }
          let active = true;
          let motionStartedAt = null;
          let motionDistance = 0;
          let measurementTimer = null;
          let measurementTimerFiredPerformanceNowMs = null;
          let delayTimer = null;
          let initialDelayTimer = null;
          let startedAt = null;
          let resolveMeasurement = null;
          let motionFrameRequest = null;
          let finishMotion = () => {};
          const renderDemandOwnership = {
            requested: scenarioName !== 'idle',
            beforeRequestRenderMode: Boolean(scene.requestRenderMode),
            beforeUseDefaultRenderLoop: viewer.useDefaultRenderLoop,
            defaultLoopQuiesced: false,
            manualFramePump: false,
            restored: scenarioName === 'idle',
            restoreReason:
              scenarioName === 'idle' ? 'idle-sample-unchanged' : null,
          };
          let renderDemandCleanupAttempted = false;
          const restoreMeasurementRenderDemand = () => {
            if (renderDemandCleanupAttempted) return;
            renderDemandCleanupAttempted = true;
            if (!renderDemandOwnership.requested) return;
            viewer.useDefaultRenderLoop =
              renderDemandOwnership.beforeUseDefaultRenderLoop;
            scene.requestRender();
            renderDemandOwnership.restored =
              viewer.useDefaultRenderLoop ===
              renderDemandOwnership.beforeUseDefaultRenderLoop;
            renderDemandOwnership.restoreReason = renderDemandOwnership.restored
              ? 'restored-original-default-loop-state'
              : 'default-loop-state-restore-failed';
          };
          try {
            // Programmatic motion runs outside Cesium's input handlers, and a
            // hosted software renderer can leave the default loop latched even
            // while its public flags say it is active. Moving samples therefore
            // own one bounded public Viewer.render() pump. Quiesce the default
            // loop first so baseline and candidate cannot double-render. Idle
            // samples retain the production loop exactly as configured.
            if (renderDemandOwnership.requested) {
              viewer.useDefaultRenderLoop = false;
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              renderDemandOwnership.defaultLoopQuiesced =
                viewer.useDefaultRenderLoop === false;
              if (!renderDemandOwnership.defaultLoopQuiesced)
                throw new Error(
                  'Performance capture could not quiesce the default render loop.',
                );
              renderDemandOwnership.manualFramePump = true;
            }
            if (stagedClock) stagedClock.startMeasurement(expectedRunOrdinal);
            intervals.length = 0;
            previous = null;
            renderedFrameCount = 0;
            if (frameTrace) {
              frameTrace.length = 0;
              lastPreRenderAt = null;
            }
            if (longTaskTrace) longTaskTrace.length = 0;
            startedAt = performance.now();
            window.__gevWeatherMeasurementStartedAt = startedAt;
            const measurementWait = new Promise((resolve) => {
              resolveMeasurement = resolve;
              measurementTimer = setTimeout(() => {
                if (recordFrameWindow)
                  measurementTimerFiredPerformanceNowMs = performance.now();
                resolve();
              }, durationMs);
            });
            window.__gevWeatherMeasurementAbort = () => {
              active = false;
              clearTimeout(measurementTimer);
              resolveMeasurement?.();
            };
            let updateMotion = () => {};
            if (scenarioName === 'scripted-motion') {
              // Rebuild the pose from one elapsed-time sample on every frame.
              // A timer-step route accumulates missed callbacks and makes a slow
              // machine travel a different distance from a fast one.
              const home = window.__gevPerformanceHome;
              const applyDistance = (distance) => {
                viewer.camera.setView({
                  destination: home.position,
                  orientation: { direction: home.direction, up: home.up },
                  endTransform: home.transform,
                });
                viewer.camera.moveRight(distance);
                motionDistance = distance;
              };
              finishMotion = () => applyDistance((durationMs * 16) / 50);
              updateMotion = (elapsed) => applyDistance((elapsed * 16) / 50);
            }
            if (renderDemandOwnership.requested) {
              motionStartedAt = performance.now();
              const move = () => {
                motionFrameRequest = null;
                if (!active) return;
                const elapsed = Math.min(
                  durationMs,
                  Math.max(0, performance.now() - motionStartedAt),
                );
                updateMotion(elapsed);
                appliedRoutePhaseMs =
                  scenarioName === 'scripted-motion' ? elapsed : null;
                viewer.render();
                if (elapsed >= durationMs) return;
                motionFrameRequest = requestAnimationFrame(move);
              };
              move();
            }
            if (delay > 0) {
              const runInjectedDelay = () => {
                const start = performance.now();
                while (performance.now() - start < delay) {}
              };
              // Fire inside the first quarter of a short diagnostic window so
              // the negative control cannot pass merely because its first
              // one-second interval occurs after measurement has ended.
              initialDelayTimer = setTimeout(
                runInjectedDelay,
                Math.min(250, Math.max(1, Math.floor(durationMs / 4))),
              );
              delayTimer = setInterval(runInjectedDelay, 1000);
            }
            await measurementWait;
            const clockEnd =
              stagedClock?.finishMeasurement?.(expectedRunOrdinal) ?? null;
            active = false;
            if (motionFrameRequest != null) {
              cancelAnimationFrame(motionFrameRequest);
              motionFrameRequest = null;
            }
            clearInterval(delayTimer);
            clearTimeout(initialDelayTimer);
            // Completion follows the fixed measurement timer, not delivery of
            // another animation frame. Slow hardware must still reach the same
            // absolute route endpoint without extending the measured window.
            finishMotion();
            if (renderDemandOwnership.requested) viewer.render();
            // A parked request-render scene is allowed to stop scheduling
            // animation frames. Requiring one here left idle captures pending
            // until Puppeteer's unrelated protocol timeout. Motion already
            // reaches its absolute endpoint through motionFinished; the
            // completed-render boundary below owns terminal visual settlement.
            const renderCount = intervals.length;
            const sorted = [...intervals].sort((a, b) => a - b);
            const pick = (p) =>
              sorted.length
                ? sorted[
                    Math.min(
                      sorted.length - 1,
                      Math.ceil(sorted.length * p) - 1,
                    )
                  ]
                : null;
            const memory = performance.memory
              ? { usedJsHeapBytes: performance.memory.usedJSHeapSize }
              : {
                  usedJsHeapBytes: null,
                  reason: 'performance.memory is unavailable in this browser',
                };
            const focusedAtEnd = document.hasFocus();
            const visibleAtEnd = !document.hidden;
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibility);
            if (window.__gevWeatherMeasurementStartedAt === startedAt) {
              delete window.__gevWeatherMeasurementStartedAt;
              delete window.__gevWeatherMeasurementAbort;
            }
            observer?.takeRecords?.().forEach((entry) => {
              longTasks.push(entry.duration);
              if (
                longTaskTrace &&
                startedAt != null &&
                Number.isFinite(entry.startTime) &&
                entry.startTime >= startedAt &&
                longTaskTrace.length < 2048
              )
                longTaskTrace.push({
                  startTimeMs: Number(entry.startTime),
                  durationMs: Number(entry.duration),
                });
            });
            observer?.disconnect();
            scene.postRender.removeEventListener(onRender);
            if (frameTrace) scene.preRender?.removeEventListener?.(onPreRender);
            restoreMeasurementRenderDemand();
            return {
              durationMs: performance.now() - startedAt,
              renderedFrameCount,
              frameCount: renderCount,
              frameIntervalMs: {
                p50: pick(0.5),
                p95: pick(0.95),
                max: sorted.at(-1) ?? null,
                samples: sorted.length,
                reason: sorted.length
                  ? null
                  : 'no scene postRender samples in this window',
              },
              ...(frameTrace
                ? {
                    frameTrace,
                    frameTraceWindow: {
                      timeOriginMs: performance.timeOrigin,
                      startPerformanceNowMs: startedAt,
                      endPerformanceNowMs: performance.now(),
                      preRenderAvailable: Boolean(
                        scene.preRender?.addEventListener,
                      ),
                      truncated: renderedFrameCount > frameTrace.length,
                      recordedFrames: frameTrace.length,
                      observedFrames: renderedFrameCount,
                    },
                  }
                : {}),
              longTasks: {
                count: longTasks.length,
                maxMs: longTasks.length ? Math.max(...longTasks) : null,
              },
              ...(longTaskTrace ? { longTaskTrace } : {}),
              memory,
              layers: [],
              totalObjects: null,
              focused: focusedAtEnd,
              visible: visibleAtEnd,
              trackedAircraftId: viewer.trackedEntity?.gevTrackedId || null,
              injectedDelayMs: delay || 0,
              quality: null,
              detection: {
                mode: null,
                reason:
                  'Candidate-only detection diagnostics are disabled for comparable capture.',
              },
              performanceSnapshot: null,
              performanceSnapshotReason:
                'Candidate-only runtime snapshots are disabled for comparable capture.',
              focusContinuity: {
                focusedAtStart,
                focusedAtEnd,
                interruptionCount: focusInterruptionCount,
              },
              visibilityContinuity: {
                visibleAtStart,
                visibleAtEnd,
                visibleThroughout,
              },
              cameraPath: {
                id:
                  scenarioName === 'scripted-motion'
                    ? 'elapsed-move-right-v1'
                    : 'parked-v1',
                motionDistancePx: motionDistance,
                motionDistanceM: motionDistance,
              },
              phasedClockEnd: clockEnd,
              renderDemandOwnership,
              ...(recordFrameWindow
                ? {
                    sceneFrameDiagnosticWindow: {
                      startPerformanceNowMs: startedAt,
                      timerFiredPerformanceNowMs:
                        measurementTimerFiredPerformanceNowMs,
                    },
                  }
                : {}),
            };
          } finally {
            active = false;
            clearTimeout(measurementTimer);
            clearInterval(delayTimer);
            clearTimeout(initialDelayTimer);
            if (motionFrameRequest != null)
              cancelAnimationFrame(motionFrameRequest);
            restoreMeasurementRenderDemand();
            observer?.disconnect();
            scene.postRender.removeEventListener(onRender);
            if (frameTrace) scene.preRender?.removeEventListener?.(onPreRender);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibility);
            if (window.__gevWeatherMeasurementStartedAt === startedAt) {
              delete window.__gevWeatherMeasurementStartedAt;
              delete window.__gevWeatherMeasurementAbort;
            }
          }
        },
        {
          durationMs: seconds * 1000,
          scenarioName: scenario,
          delay: delayMs,
          recordFrameWindow: collectSceneFrameAttribution,
          expectedRunOrdinal: phaseRunOrdinal,
          frameTraceEnabled,
        },
      );
      const samplePromise = runSceneMeasurementWithHostDeadline({
        evaluate: () => rawSamplePromise,
        measurementMs: seconds * 1000,
        onProgress(observation) {
          failureProgress.current.sceneMeasurementObservation = observation;
        },
      });
      let weatherPhaseObservations = null;
      let sample;
      try {
        if (weatherEffectsWorkload) {
          weatherPhaseObservations =
            await weatherEffectsModule.runWeatherEffectsPhaseSchedule({
              page,
              fixture: weatherEffectsWorkload,
              samplePromise,
            });
        }
        sample = await samplePromise;
      } catch (error) {
        if (
          weatherEffectsWorkload &&
          error?.sceneMeasurementObservation?.status !== 'host-deadline'
        ) {
          await page
            .evaluate(() => window.__gevWeatherMeasurementAbort?.())
            .catch(() => {});
          await samplePromise.catch(() => {});
        }
        throw error;
      }
      const foregroundContinuity = evaluateForegroundSampleContinuity(sample);
      sample.foregroundContinuity = foregroundContinuity;
      sample.foregroundThroughout = foregroundContinuity.foregroundThroughout;
      if (weatherEffectsWorkload)
        sample.weatherPhaseObservations = weatherPhaseObservations;
      failureProgress.current.measurement = sample;
      if (boundaryProgressBindingRecord)
        sample.renderBoundaryProgressBinding = boundaryProgressBindingRecord;
      if (sample.visible && !sample.focused) {
        failureProgress.phase = 'reactivate-post-measurement-foreground';
        failureProgress.current.phase = failureProgress.phase;
        sample.postMeasurementForegroundActivation =
          await activateCapturePage(page);
        failureProgress.current.postMeasurementForegroundActivation =
          sample.postMeasurementForegroundActivation;
      }
      if (productionFlightFixture || austinOperatingWorkload) {
        failureProgress.phase = 'validate-provider-fixture-clock';
        failureProgress.current.phase = failureProgress.phase;
        clockEnd = await page.evaluate(() => ({
          clock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
          wallTimeMs: Date.now(),
          documentVisible: !document.hidden,
          documentFocused: document.hasFocus(),
          flightStats:
            window.__godsEyeView?.dataManager?.layers
              ?.get('flights')
              ?.module?.getStats?.() ?? null,
        }));
        let fixtureAgeMs = null;
        if (productionFlightFixture) {
          fixtureAgeMs =
            clockEnd.wallTimeMs - productionFlightFixture.fixedTimeMs;
          if (
            clockEnd.clock.startCount !== 1 ||
            clockEnd.clock.phase !== 'complete' ||
            clockEnd.clock.elapsedMs !== warmupMs + seconds * 1000 ||
            fixtureAgeMs < 0 ||
            fixtureAgeMs > 120_000 ||
            clockEnd.flightStats?.lastUpdate !==
              productionFlightFixture.fixedTimeMs ||
            clockEnd.flightStats?.stale !== false ||
            clockEnd.flightStats?.count !== productionFlightFixture.count ||
            !sample.foregroundThroughout ||
            !clockEnd.documentVisible ||
            !clockEnd.documentFocused
          )
            throw new Error(
              `Provider-fixture capture clock/freshness/foreground contract failed: ${JSON.stringify({ clock: clockEnd.clock, fixtureAgeMs, flightStats: clockEnd.flightStats, documentVisible: clockEnd.documentVisible, documentFocused: clockEnd.documentFocused })}`,
            );
        } else if (
          sample.phasedClockEnd?.startCount !== 1 ||
          sample.phasedClockEnd?.phase !== 'complete' ||
          sample.phasedClockEnd?.runOrdinal !== phaseRunOrdinal ||
          sample.phasedClockEnd?.elapsedMs !== warmupMs + seconds * 1000 ||
          sample.phasedClockEnd?.epochMs !==
            austinOperatingWorkload.fixedTimeMs + warmupMs + seconds * 1000 ||
          clockEnd.wallTimeMs !==
            austinOperatingWorkload.fixedTimeMs + warmupMs + seconds * 1000 ||
          !sample.foregroundThroughout ||
          !clockEnd.documentVisible ||
          !clockEnd.documentFocused
        )
          throw new Error(
            `Austin phased clock/foreground contract failed: ${JSON.stringify({ clock: sample.phasedClockEnd, clockEnd })}`,
          );
        if (austinOperatingWorkload) {
          const sourceSettle = await settlePostMeasurementSourceChanges({
            settleSourceTriggerBoundary: async () => {
              failureProgress.phase =
                'post-measurement-source-trigger-render-wait';
              failureProgress.current.phase = failureProgress.phase;
              return settleProviderRenderAtBoundary(
                page,
                'Post-measurement source trigger boundary',
                5000,
                createBoundaryProgressRecorder(
                  failureProgress.current,
                  'postMeasurementSourceTriggerBoundaryObservation',
                ),
                activeRenderBoundaryProgressBinding,
              );
            },
            settleSourceReadinessBoundary: async () => {
              failureProgress.phase =
                'post-measurement-source-readiness-render-wait';
              failureProgress.current.phase = failureProgress.phase;
              return settleProviderRenderAtBoundary(
                page,
                'Post-measurement source readiness boundary',
                5000,
                createBoundaryProgressRecorder(
                  failureProgress.current,
                  'postMeasurementSourceReadinessBoundaryObservation',
                ),
                activeRenderBoundaryProgressBinding,
                {
                  postRenderConditionFunction:
                    observeAustinInstallationsReadyForRenderBoundary,
                  postRenderConditionStabilityMs: 250,
                },
              );
            },
            waitForDrain: async (drainPhase) => {
              failureProgress.phase = 'post-measurement-source-debounce-drain';
              failureProgress.current.phase = failureProgress.phase;
              const drain = await waitForPostMeasurementSourceDrain();
              return { ...drain, phase: drainPhase };
            },
          });
          sample.postMeasurementSourceSettle = sourceSettle;
          sample.postMeasurementSourceDrain = sourceSettle.readinessDrain;
          failureProgress.current.postMeasurementSourceSettle = sourceSettle;
          failureProgress.current.postMeasurementSourceDrain =
            sourceSettle.readinessDrain;
        }
        failureProgress.phase = 'measurement-boundary-render-wait';
        failureProgress.current.phase = failureProgress.phase;
        const measurementProgressRecord = failureProgress.current;
        try {
          measurementBoundarySettle = await settleProviderRenderAtBoundary(
            page,
            'Measurement boundary',
            5000,
            measurementProgressRecord
              ? createBoundaryProgressRecorder(
                  measurementProgressRecord,
                  'measurementBoundaryObservation',
                )
              : undefined,
            activeRenderBoundaryProgressBinding,
            {
              retireViewerRenderLoop: Boolean(
                productionFlightFixture || austinOperatingWorkload,
              ),
              finalObservationFunction:
                scenario === 'selected-aircraft-tracking'
                  ? observeTrackedEntityBoundary
                  : depthPickAttributionEnabled
                    ? observeDepthPickAttributionBoundary
                    : null,
              finalObservationArgs:
                scenario === 'selected-aircraft-tracking'
                  ? depthPickAttributionEnabled
                    ? [
                        'flights:000001',
                        activeDepthPickAttribution?.ownerToken,
                        'measurement-boundary',
                      ]
                    : ['flights:000001']
                  : depthPickAttributionEnabled
                    ? [
                        {
                          label: 'measurement-boundary',
                          ownerToken: activeDepthPickAttribution?.ownerToken,
                        },
                      ]
                    : [],
              postRenderConditionFunction: austinOperatingWorkload
                ? observeAustinInstallationsReadyForRenderBoundary
                : null,
              postRenderConditionStabilityMs: austinOperatingWorkload ? 250 : 0,
            },
          );
        } catch (error) {
          const retirement =
            error.boundaryObservation?.page?.diagnostics
              ?.renderLoopRetirement ?? null;
          if (retirement)
            recordRendererLoopRetirement({
              phase: 'provider-sample-measurement-post-render',
              scenario,
              run,
              documentRole: activeDocumentRole,
              documentId: activeDocumentId,
              ...retirement,
            });
          if (depthPickAttributionEnabled && activeDepthPickAttribution) {
            activeDepthPickAttribution.sample.measurementBoundary =
              error?.boundaryObservation?.page?.diagnostics?.finalObservation ??
              null;
            if (failureProgress.current)
              failureProgress.current.depthPickAttribution =
                activeDepthPickAttribution.sample;
            failureProgress.workload.depthPickAttribution =
              depthPickAttributionEnvelope();
          }
          throw error;
        } finally {
          if (collectProviderSampleCpuProfile)
            await stopProviderSampleCpuProfile(
              'measurement-boundary-settled-or-failed',
            );
          if (
            activeSceneFrameAttribution?.progressRecord ===
            measurementProgressRecord
          )
            await stopSceneFrameAttribution(
              'measurement-boundary-settled-or-failed',
              measurementProgressRecord.measurement,
            );
        }
        const bindingDeactivation =
          deactivateActiveRenderBoundaryProgressBinding(
            'both-boundaries-complete',
          );
        if (depthPickAttributionEnabled && activeDepthPickAttribution) {
          const finalObservation =
            measurementBoundarySettle?.page?.diagnostics?.finalObservation ??
            null;
          activeDepthPickAttribution.sample.measurementBoundary =
            finalObservation?.depthPickAttribution ?? finalObservation;
          failureProgress.current.depthPickAttribution =
            activeDepthPickAttribution.sample;
          failureProgress.workload.depthPickAttribution =
            depthPickAttributionEnvelope();
        }
        if (bindingDeactivation && !bindingDeactivation.confirmed)
          throw new Error(
            'Render-boundary binding deactivation failed after sample boundaries.',
          );
        const trackingEnd =
          scenario === 'selected-aircraft-tracking'
            ? measurementBoundarySettle.page?.diagnostics?.finalObservation
            : null;
        if (trackingEnd) {
          sample.trackingObservation = {
            start: trackingStart,
            end: trackingEnd,
          };
          failureProgress.current.trackingEnd = trackingEnd;
        } else if (scenario === 'selected-aircraft-tracking') {
          throw new Error(
            'Tracked entity endpoint was unavailable at the terminal postRender observation.',
          );
        }
        if (productionFlightFixture)
          sample.fixtureClock = {
            schema: 'gev-provider-fixture-capture-clock/v1',
            fixedTime: productionFlightFixture.fixedTime,
            start: trackingResult.clockStart,
            measurementStart: fixtureMeasurementStart.clock,
            warmupBoundary: fixtureBoundaryStart,
            actualWarmupElapsedMs: fixtureBoundaryStart.warmupNativeElapsedMs,
            warmupBoundarySettleNativeMs: warmupBoundarySettle.settleElapsedMs,
            ageAtMeasurementStartMs:
              fixtureMeasurementStart.wallTimeMs -
              productionFlightFixture.fixedTimeMs,
            end: clockEnd.clock,
            configuredMeasurementMs: seconds * 1000,
            measurementPhaseNativeElapsedMs:
              sample.phasedClockEnd?.measurementNativeElapsedMs ?? null,
            measuredWindowElapsedMs:
              sample.phasedClockEnd?.measurementNativeElapsedMs ?? null,
            measurementClockElapsedMs: seconds * 1000,
            measurementBoundarySettleNativeMs:
              measurementBoundarySettle.settleElapsedMs,
            ageAtEndMs: fixtureAgeMs,
            sourceFreshness: 'current',
            freshnessWindowMs: 120_000,
            appDocumentReinitialized: true,
            freshBrowserContext: true,
          };
        sample.renderLoopRetirement =
          measurementBoundarySettle.page?.diagnostics?.renderLoopRetirement ??
          null;
        if (sample.renderLoopRetirement)
          recordRendererLoopRetirement({
            phase: 'provider-sample-measurement-post-render',
            scenario,
            run,
            documentRole: activeDocumentRole,
            documentId: activeDocumentId,
            ...sample.renderLoopRetirement,
          });
        if (scenario === 'selected-aircraft-tracking') {
          const cameraPose = (boundary) => ({
            dateEpochMs: boundary.dateEpochMs,
            position: boundary.camera?.position,
            direction: boundary.camera?.direction,
            up: boundary.camera?.up,
            transform: boundary.camera?.transform,
          });
          const route = createEntityFollowRoute({
            fixtureId: productionFlightFixture.id,
            fixtureSha256: productionFlightFixture.sha256,
            fixedTime: productionFlightFixture.fixedTime,
            fixtureCount: productionFlightFixture.count,
            warmupMs,
            measurementMs: seconds * 1000,
            start: { ...trackingStart, camera: cameraPose(trackingStart) },
            end: { ...trackingEnd, camera: cameraPose(trackingEnd) },
          });
          sample.cameraPath = route;
          failureProgress.current.trackingRoute = route;
          assertObservedTrackingRoute(route, {
            fixtureId: productionFlightFixture.id,
            fixtureSha256: productionFlightFixture.sha256,
            fixedTime: productionFlightFixture.fixedTime,
            warmupMs,
            measurementMs: seconds * 1000,
          });
        }
        if (!austinOperatingWorkload) {
          fixtureDelivery = await summarizeFlightFixtureDelivery();
          failureProgress.fixtureDelivery = fixtureDelivery;
          sample.fixtureDelivery = fixtureDelivery;
        }
        if (workerAuditMode === 'prewarm') {
          if (!activePrewarmedWorkerInventory || !activePrewarmedWorkerDocument)
            throw new Error('Provider sample has no active prewarm inventory.');
          const overflow = captureAuditState.getOverflow();
          failureProgress.current.workerAudit = {
            status: 'late-use-check-pending',
            observedWorkerTargetCount: captureAuditState.workerUrls.size,
            observedBlobRequestCount: captureAuditState.blobUrls.size,
            workerTargetOverflowCount: overflow.workerUrlOverflow,
            blobRequestOverflowCount: overflow.blobUrlOverflow,
          };
          const lateUseCheck = verifyPrewarmedWorkerUse(
            captureAuditState,
            activePrewarmedWorkerInventory,
            activePrewarmedWorkerDocument,
          );
          failureProgress.current.workerAudit = lateUseCheck;
          sample.workerAudit = lateUseCheck;
          activePrewarmedWorkerInventory = null;
          activePrewarmedWorkerDocument = null;
        } else {
          await auditPageWorkerEvidence(page, captureAuditState, {
            documentRole: activeDocumentRole,
            documentId: activeDocumentId,
          });
        }
        providerSampleWorkerAuditComplete = true;
      }
      const sceneAfter = await page.evaluate(observeCommonScene, {
        appCommit: source.appCommit,
      });
      if (comparisonProfile === 'native-sharpness-v1')
        assertNativeSharpnessProfile(
          sceneAfter,
          `${scenario} run ${run} after`,
        );
      const austinStateAfter = austinOperatingWorkload
        ? await page.evaluate(
            observeAustinOperatingRuntimeState,
            austinOperatingWorkload.selectedLayerIds,
            austinOperatingWorkload.expectedLayerCounts,
            true,
          )
        : null;
      if (austinOperatingWorkload) {
        assertAustinPopulationEvidence(
          austinStateAfter,
          austinOperatingWorkload,
          `${scenario} run ${run} measurement end`,
        );
        assertAustinStableCatalogs(
          austinStateBefore,
          austinStateAfter,
          `${scenario} run ${run}`,
        );
      }
      const weatherStateAfter = weatherEffectsWorkload
        ? await page.evaluate(observeWeatherEffectsRuntimeState)
        : null;
      if (austinOperatingWorkload) {
        const requiredAssetIds = [
          ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
          'installations',
        ];
        fixtureDelivery = austinOperatingFixtureDelivery.summarize({
          requiredAssetIds,
          requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
            ([z, x, y]) => ({ z, x, y }),
          ),
        });
        sample.fixtureDelivery = fixtureDelivery;
        const satelliteSampledEpochs = {
          warmupHeld:
            austinSatelliteEpochModule.deriveAustinSatelliteSampledEpoch({
              reference: austinSatelliteEpochReference,
              records: austinStateBefore?.satellitePositionRecords,
              boundaryEpochMs: austinStateBefore?.phasedClock?.epochMs,
              boundary: 'warmup-held',
              documentRole: activeDocumentRole,
              documentId: activeDocumentId,
              runOrdinal: phaseRunOrdinal,
            }),
          measurementComplete:
            austinSatelliteEpochModule.deriveAustinSatelliteSampledEpoch({
              reference: austinSatelliteEpochReference,
              records: austinStateAfter?.satellitePositionRecords,
              boundaryEpochMs: austinStateAfter?.phasedClock?.epochMs,
              boundary: 'measurement-complete',
              documentRole: activeDocumentRole,
              documentId: activeDocumentId,
              runOrdinal: phaseRunOrdinal,
            }),
        };
        sample.austinOperatingClock = {
          schema: 'gev-austin-operating-capture-clock/v1',
          fixedHarnessTime: austinOperatingWorkload.fixedTime,
          runOrdinal: phaseRunOrdinal,
          configuredWarmupMs: warmupMs,
          configuredMeasurementMs: seconds * 1000,
          start: clockStart.started,
          measurementStart: fixtureMeasurementStart.clock,
          warmupBoundary: fixtureBoundaryStart,
          measurementEnd: sample.phasedClockEnd,
          measurementBoundarySettleNativeMs: readSettledRenderBoundaryElapsedMs(
            measurementBoundarySettle,
            'Austin measurement',
          ),
          wallClockBeforeMs: fixtureMeasurementStart.wallTimeMs,
          wallClockAfterMs: clockEnd.wallTimeMs,
          windSourceTime: austinOperatingWorkload.windSourceTime,
          windSourceValidAtBeforeMs:
            austinStateBefore?.selectedLayers?.find(
              (layer) => layer.id === 'wind',
            )?.windValidAt ?? null,
          windSourceValidAtAfterMs:
            austinStateAfter?.selectedLayers?.find(
              (layer) => layer.id === 'wind',
            )?.windValidAt ?? null,
          windSourceAgeBeforeMs: austinStateBefore?.windSourceAgeMs ?? null,
          windSourceAgeAfterMs: austinStateAfter?.windSourceAgeMs ?? null,
          satelliteWitnessBefore: normalizeAustinSatelliteWitness(
            austinStateBefore?.satelliteWitness,
          ),
          satelliteWitnessAfter: austinStateAfter?.satelliteWitness ?? null,
          selectedLayersBefore: austinStateBefore?.selectedLayers ?? null,
          selectedLayersAfter: austinStateAfter?.selectedLayers ?? null,
          visualSettingsBefore: sceneBefore.settings,
          visualSettingsAfter: sceneAfter.settings,
          cameraStart: sceneBefore.camera,
          cameraEnd: sceneAfter.camera,
          satelliteSampledEpochs,
          fixtureDelivery,
        };
        const beforeWitness = austinStateBefore?.satelliteWitness;
        const afterWitness = austinStateAfter?.satelliteWitness;
        const windBefore = austinStateBefore?.selectedLayers?.find(
          (layer) => layer.id === 'wind',
        );
        const windAfter = austinStateAfter?.selectedLayers?.find(
          (layer) => layer.id === 'wind',
        );
        if (
          !beforeWitness ||
          afterWitness?.noradId !== 25544 ||
          (beforeWitness.latitude === afterWitness.latitude &&
            beforeWitness.longitude === afterWitness.longitude) ||
          austinStateBefore?.selectedLayers?.find(
            (layer) => layer.id === 'satellites',
          )?.sourcePopulation?.positionSha256 ===
            austinStateAfter?.selectedLayers?.find(
              (layer) => layer.id === 'satellites',
            )?.sourcePopulation?.positionSha256 ||
          !windBefore ||
          !windAfter ||
          windBefore.windValidAt !==
            Date.parse(austinOperatingWorkload.windSourceTime) ||
          windAfter.windValidAt !==
            Date.parse(austinOperatingWorkload.windSourceTime) ||
          windBefore.params?.model !==
            austinOperatingWorkload.visualState.wind.model ||
          windBefore.params?.overlay !==
            austinOperatingWorkload.visualState.wind.overlay ||
          windBefore.params?.paused !== false ||
          windBefore.params?.units !==
            austinOperatingWorkload.visualState.wind.units ||
          JSON.stringify(sceneBefore.settings) !==
            JSON.stringify(sceneAfter.settings)
        )
          throw new Error(
            `Austin source/clock/settings contract failed at ${scenario} run ${run}.`,
          );
        failureProgress.fixtureDelivery = fixtureDelivery;
        failureProgress.current.austinOperatingClock =
          sample.austinOperatingClock;
      }
      failureProgress.current.after = sceneAfter;
      failureProgress.phase = 'validate-sample-integrity';
      failureProgress.current.phase = failureProgress.phase;
      sample.layers = sceneAfter.environment.layers;
      sample.totalObjects = sceneAfter.environment.totalObjects;
      sample.quality = {
        mode: sceneAfter.settings.qualityMode,
        densityPct: sceneAfter.settings.densityPct,
        p95FrameMs: null,
      };
      sample.settings = {
        before: sceneBefore.settings,
        after: sceneAfter.settings,
      };
      sample.conditions = {
        before: {
          environment: sceneBefore.environment,
          settings: sceneBefore.settings,
          focused: sceneBefore.environment.focused,
          visible: sceneBefore.environment.visible,
        },
        after: {
          environment: sceneAfter.environment,
          settings: sceneAfter.settings,
          focused: sceneAfter.environment.focused,
          visible: sceneAfter.environment.visible,
        },
      };
      if (infrastructureWorkload) {
        assertInfrastructureClockObservation(
          sceneBefore.cesiumClock,
          infrastructureWorkload,
          `${scenario} run ${run} before`,
        );
        assertInfrastructureClockObservation(
          sceneAfter.cesiumClock,
          infrastructureWorkload,
          `${scenario} run ${run} after`,
        );
        if (
          sceneBefore.wallClockEpochMs !== infrastructureWorkload.fixedTimeMs ||
          sceneAfter.wallClockEpochMs !== infrastructureWorkload.fixedTimeMs
        )
          throw new Error(
            `Infrastructure fixture wall clock drifted during ${scenario} run ${run}.`,
          );
        sample.infrastructureFixtureClock = {
          fixedTime: infrastructureWorkload.fixedTime,
          wallClockBeforeMs: sceneBefore.wallClockEpochMs,
          wallClockAfterMs: sceneAfter.wallClockEpochMs,
          cesiumBefore: sceneBefore.cesiumClock,
          cesiumAfter: sceneAfter.cesiumClock,
        };
        fixtureDelivery = await infrastructureFixtureDelivery.summarize(
          sceneBefore.environment.layers,
          sceneAfter.environment.layers,
        );
        sample.fixtureDelivery = fixtureDelivery;
        failureProgress.fixtureDelivery = fixtureDelivery;
      }
      if (weatherEffectsWorkload) {
        weatherEffectsModule.assertWeatherPhaseRunSet(
          sample.weatherPhaseObservations,
          weatherEffectsWorkload,
          { durationMs: seconds * 1000 },
        );
        weatherEffectsModule.assertWeatherEffectsClock(
          sceneBefore,
          weatherEffectsWorkload,
          `${scenario} run ${run} before`,
        );
        weatherEffectsModule.assertWeatherEffectsClock(
          sceneAfter,
          weatherEffectsWorkload,
          `${scenario} run ${run} after`,
        );
        sample.weatherEffectsClock = {
          schema: 'gev-weather-effects-clock/v2',
          fixedHarnessTime: weatherEffectsWorkload.fixedTime,
          wallClockBeforeMs: sceneBefore.wallClockEpochMs,
          wallClockAfterMs: sceneAfter.wallClockEpochMs,
          cesiumBefore: sceneBefore.cesiumClock,
          cesiumAfter: sceneAfter.cesiumClock,
          weatherPlayback: weatherTimelinePreflight.playback,
          selectedTimesPreflight: weatherTimelinePreflight.selectedTimes,
          motionPreferencePreflight: weatherTimelinePreflight.motionPreference,
          phaseSchedule: weatherEffectsWorkload.phaseSchedule,
          phaseObservations: sample.weatherPhaseObservations,
          weatherStateBefore,
          weatherStateAfter,
        };
        fixtureDelivery = await weatherEffectsFixtureDelivery.summarize(
          sceneBefore.environment.layers,
          sceneAfter.environment.layers,
        );
        fixtureDelivery = {
          ...fixtureDelivery,
          cameraObservation: weatherCameraObservation,
          timelinePreflight: weatherTimelinePreflight,
        };
        sample.fixtureDelivery = fixtureDelivery;
        failureProgress.fixtureDelivery = fixtureDelivery;
      }
      if (scenario !== 'selected-aircraft-tracking' || !productionFlightFixture)
        sample.cameraPath = describeObservedRoute({
          scenario,
          start: sceneBefore.camera,
          durationMs: seconds * 1000,
          measurement: sample,
          fixture,
        });
      if (
        scenario === 'selected-aircraft-tracking' &&
        (trackingSetup !== 'flights:000001' ||
          sample.trackedAircraftId !== 'flights:000001')
      )
        throw new Error(
          `Selected-aircraft workload lost camera tracking: ${JSON.stringify({ trackingSetup, trackedAircraftId: sample.trackedAircraftId })}`,
        );
      sample.documentRole = activeDocumentRole;
      sample.documentId = activeDocumentId;
      sample.captureOrdinal = captures.length;
      if (collectProviderSampleCpuProfile)
        sample.providerSampleCpuProfile =
          providerSampleCpuProfiles.find(
            (record) => record.captureOrdinal === captures.length,
          ) || null;
      if (depthPickAttributionEnabled && activeDepthPickAttribution) {
        sample.captureOrdinal = captures.length;
        sample.depthPickAttribution = activeDepthPickAttribution.sample;
        failureProgress.workload.depthPickAttribution =
          depthPickAttributionEnvelope();
      }
      captures.push({ scenario, run, ...sample });
      failureProgress.current = null;
    }
  }

  for (const sample of captures) {
    const before = sample.settings?.before;
    const after = sample.settings?.after;
    if (!before || !after || before.qualityMode !== after.qualityMode) {
      throw new Error(
        `Performance sample changed quality mode during capture: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, before, after })}`,
      );
    }
    if (fixture && before.detectionMode !== detectionMode) {
      throw new Error(
        `Performance sample used the wrong detection mode: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, expected: detectionMode, actual: before.detectionMode })}`,
      );
    }
    if (sample.quality?.mode !== qualityMode) {
      throw new Error(
        `Performance sample used the wrong quality mode: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, expected: qualityMode, actual: sample.quality?.mode })}`,
      );
    }
  }

  if (captureProvenance) {
    await captureProvenance.verifyAfterCapture();
    source.buildProvenance = projectPublicCaptureBuildProvenance(
      captureProvenance.source,
    );
    if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
      throw new Error(
        'Verified capture page became controlled by a service worker.',
      );
    if (unexpectedScriptAssets.size)
      throw new Error(
        `Capture requested same-origin code outside its build receipt: ${JSON.stringify([...unexpectedScriptAssets].sort())}`,
      );
    if (!loadedScriptAssets.size)
      throw new Error(
        'Capture did not request any receipted same-origin code assets.',
      );
    if (
      workerAuditMode === 'receipt-only' ||
      !providerSampleWorkerAuditComplete
    ) {
      await auditPageWorkerEvidence(page, captureAuditState, {
        documentRole: activeDocumentRole,
        documentId: activeDocumentId,
      });
      providerSampleWorkerAuditComplete = true;
    }
    if (workerAuditMode === 'receipt-only') {
      source.buildProvenance.pageAssetAudit = {
        schema: 'gev-receipt-only-worker-audit/v1',
        status: 'all-document-receipt-paths-validated',
        workerAuditMode,
        appCommit: captureProvenance.source.appCommit,
        harnessCommit: source.harnessCommit,
        receiptSha256: captureProvenance.source.receiptSha256,
        liveBlobBodyAttestation: 'unavailable-by-design',
        pageInstrumentation: {
          createObjectUrlWrapped: false,
          workerApiWrapped: false,
          blobBodyRegistryInstalled: false,
          debuggerAttached: false,
          profilerEnabled: false,
          observation:
            'external-puppeteer-request-and-worker-target-events-only',
        },
        workerSource: receiptOnlyWorkerAuditDocuments[0]?.workerSource || null,
        scriptRequestCount,
        loadedAssetPaths: [...loadedScriptAssets].sort(),
        unexpectedAssetPaths: [...unexpectedScriptAssets].sort(),
        workerAuditDocuments: receiptOnlyWorkerAuditDocuments,
      };
      const receiptOnlyValid = validateReceiptOnlyWorkerAuditEnvelope({
        pageAssetAudit: source.buildProvenance.pageAssetAudit,
        appCommit: captureProvenance.source.appCommit,
        harnessCommit: source.harnessCommit,
        receiptSha256: captureProvenance.source.receiptSha256,
        expectedDocuments: captureDocumentTopology.workerAudits,
        expectedAssetPaths: captureProvenance.source.expectedAssetPaths,
        bundlePath: captureWorkerContract.bundlePath,
        bundleSha256: captureWorkerContract.bundleSha256,
        workerSourceSha256: captureWorkerContract.workerSourceSha256,
        allowedModuleCount: captureWorkerContract.allowedModuleCount,
      });
      if (!receiptOnlyValid)
        throw new Error('Receipt-only worker audit envelope is incomplete.');
    } else
      source.buildProvenance.pageAssetAudit = {
        scope:
          workerAuditMode === 'prewarm'
            ? 'receipt-backed page paths plus receipt-derived Cesium embedded-worker blobs validated after configured warmup and a completed boundary render, before measurement; native URL.createObjectURL restored and retained blob bodies cleared before measurement; late observed executable paths checked against bounded prewarm inventory; unused late blob creation is not observable'
            : 'receipt-backed page paths plus receipt-derived Cesium embedded-worker blobs; blob observer ran during capture and is diagnostic instrumentation, not timing evidence',
        workerAuditMode,
        scriptRequestCount,
        loadedAssetPaths: [...loadedScriptAssets].sort(),
        cesiumWorkerBlobAudits: workerBlobObservations,
        workerAuditDocuments,
        unexpectedAssetPaths: [],
      };
    source.provenanceStatus = source.buildProvenance.status;
  }

  const stableWithinScenario = (
    read,
    equivalent = (left, right) =>
      JSON.stringify(left) === JSON.stringify(right),
  ) => {
    const firstByScenario = new Map();
    for (const sample of captures) {
      const value = read(sample);
      if (firstByScenario.has(sample.scenario)) {
        if (!equivalent(value, firstByScenario.get(sample.scenario)))
          return false;
      } else firstByScenario.set(sample.scenario, value);
    }
    return true;
  };
  // Idle, scripted motion, and tracking intentionally have different routes.
  // Compare repeated runs within each workload rather than declaring the
  // entire report mismatched because two different workloads were collected.
  const populationStableAcrossSamples = stableWithinScenario(
    (sample) => sample.layers,
  );
  const cameraPathStableAcrossSamples = stableWithinScenario(
    (sample) => sample.cameraPath,
    routeDescriptorsEquivalent,
  );
  // Recheck delivery after all samples so a late failed/mismatched fulfillment
  // cannot leave an earlier pre-measurement observation looking complete.
  failureProgress.phase = 'final-integrity-check';
  failureProgress.scenario = null;
  failureProgress.run = null;
  failureProgress.current = null;
  fixtureDelivery = productionFlightFixture
    ? await summarizeFlightFixtureDelivery()
    : infrastructureWorkload
      ? await infrastructureFixtureDelivery.summarize(
          environment.layers,
          captures.at(-1)?.layers || environment.layers,
        )
      : weatherEffectsWorkload
        ? await weatherEffectsFixtureDelivery.summarize(
            environment.layers,
            captures.at(-1)?.layers || environment.layers,
          )
        : austinOperatingWorkload
          ? {
              schema: 'gev-austin-operating-capture-delivery/v1',
              status: 'observed',
              fixtureId: austinOperatingWorkload.id,
              fixtureSha256: austinOperatingWorkload.sha256,
              fixedTime: austinOperatingWorkload.fixedTime,
              windSourceTime: austinOperatingWorkload.windSourceTime,
              windSourceAgeMs: austinOperatingWorkload.windSourceAgeMs,
              requiredAssetIds: [
                ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
                'installations',
              ],
              requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
                ([z, x, y]) => `${z}/${x}/${y}`,
              ),
              sampleDocuments: captures.map((sample) => ({
                scenario: sample.scenario,
                run: sample.run,
                documentRole: sample.documentRole,
                documentId: sample.documentId,
                delivery: sample.fixtureDelivery,
                populations: summarizeAustinNativePopulations(sample),
              })),
              documentOwners: [],
              sourceProvenance: austinOperatingWorkload.provenance,
            }
          : null;
  if (weatherEffectsWorkload)
    fixtureDelivery = {
      ...fixtureDelivery,
      cameraObservation: weatherCameraObservation,
      timelinePreflight: weatherTimelinePreflight,
    };
  failureProgress.fixtureDelivery = fixtureDelivery;
  if (productionFlightFixture) {
    const perSampleResponseCounts = captures.map((sample) => ({
      scenario: sample.scenario,
      run: sample.run,
      fulfilledResponseCount:
        sample.fixtureDelivery?.fulfilledResponseCount ?? null,
    }));
    fixtureDelivery = {
      ...fixtureDelivery,
      fulfilledResponseCount: perSampleResponseCounts.reduce(
        (total, row) => total + (row.fulfilledResponseCount || 0),
        0,
      ),
      perSampleResponseCounts,
    };
    failureProgress.fixtureDelivery = fixtureDelivery;
  }
  const motionBudget = evaluateMotionFrameBudget(captures, maxP95Ms);
  if (comparisonProfile === 'native-sharpness-v1')
    environment.nativeSharpnessProfile = deriveNativeSharpnessProfile(captures);
  const integrity = assertCaptureIntegrity(captures, {
    expectedCommit: source.appCommit,
    qualityMode,
    requireNativeSharpnessProfile: comparisonProfile === 'native-sharpness-v1',
    expectedDensityPct,
    expectedCounts: {
      ...(fixture ? { flights: effectiveFixtureAircraftCount } : {}),
      ...(mixedLayers ? { 'local-datacenters': 4362, 'local-dams': 716 } : {}),
      ...(infrastructureWorkload
        ? infrastructureWorkload.expectedLayerCounts
        : {}),
      ...(weatherEffectsWorkload
        ? weatherEffectsWorkload.expectedLayerCounts
        : {}),
    },
    ...(austinOperatingWorkload
      ? {
          dynamicPopulationIds: [
            'alpr-cameras',
            'military-installations',
            'radio',
          ],
        }
      : {}),
    ...(productionFlightFixture
      ? {
          expectedFixture: productionFlightFixture,
          expectedWarmupMs: warmupMs,
          expectedMeasurementMs: seconds * 1000,
        }
      : {}),
  });
  const comparisonFixture =
    productionFlightFixture ||
    infrastructureWorkload ||
    weatherEffectsWorkload ||
    austinOperatingWorkload ||
    (mapStreamingWorkloadSelected ? mapStreamingFixture : null);
  const weatherEffectsComparisonRun =
    weatherEffectsWorkload &&
    warmupMs === 30_000 &&
    seconds === 60 &&
    runs === 5;
  let comparisonContract = productionFlightFixture
    ? createObservedDenseComparisonContract({
        fixture: productionFlightFixture,
        fixtureDelivery,
        environment,
        captures,
        scenarios,
      })
    : infrastructureWorkload
      ? createObservedInfrastructureComparisonContract({
          fixture: infrastructureWorkload,
          fixtureDelivery,
          environment,
          captures,
          scenarios,
          workload: {
            warmupMs,
            durationPerSampleMs: seconds * 1000,
            runsPerScenario: runs,
          },
        })
      : weatherEffectsComparisonRun
        ? createObservedWeatherEffectsComparisonContract({
            fixture: weatherEffectsWorkload,
            fixtureDelivery,
            environment,
            captures,
            scenarios,
            workload: {
              warmupMs,
              durationPerSampleMs: seconds * 1000,
              runsPerScenario: runs,
            },
          })
        : austinOperatingWorkload
          ? createObservedAustinOperatingComparisonContract({
              fixture: austinOperatingWorkload,
              fixtureDelivery,
              environment,
              captures,
              scenarios,
              workload: {
                warmupMs,
                durationPerSampleMs: seconds * 1000,
                runsPerScenario: runs,
              },
            })
          : null;
  if (page && activeDepthPickAttribution)
    await disposeDepthPickAttributionForPage(page, activeDepthPickAttribution);
  if (page)
    await cleanupEarlyRendererProbeForPage(page, {
      retireViewerRenderLoop: true,
      phase: 'capture-document-retirement',
      documentRole: activeDocumentRole,
      documentId: activeDocumentId,
    });
  for (const session of [...fixtureInterceptionSessions])
    await releaseFlightFixtureSession(session);
  if (mapStreamingWorkloadSelected) {
    const documentDeliveries = collectMapStreamingFixtureDocumentDeliveries();
    mapStreamingFinalEvidence =
      mapStreamingModule.createFinalizedMapStreamingCaptureEvidence({
        fixture: mapStreamingFixture,
        journey: mapStreamingJourney,
        journeys: mapStreamingJourneys,
        profile: resolveMapFixtureBuildProfile(expectedBuildProfile),
        documentDeliveries,
      });
    mapStreamingCaptureReport = mapStreamingFinalEvidence.mapStreamingCapture;
    fixtureDelivery = mapStreamingFinalEvidence.fixtureDelivery;
    failureProgress.fixtureDelivery = fixtureDelivery;
    failureProgress.workload.mapStreamingFixtureDocuments =
      mapStreamingFinalEvidence.mapStreamingFixtureDocuments;
    failureProgress.workload.mapStreamingCapture = mapStreamingCaptureReport;
    comparisonContract = createObservedMapStreamingComparisonContract({
      fixture: mapStreamingFixture,
      mapStreamingCapture: mapStreamingCaptureReport,
      environment,
      workload: {
        warmupMs,
        durationPerSampleMs: seconds * 1000,
        runsPerScenario: runs,
      },
    });
  }
  if (austinOperatingWorkload) {
    for (const owner of austinOperatingFixtureDeliveries)
      finalizeAustinOperatingFixtureDelivery(
        owner,
        owner.disposed
          ? owner.disposeReason
          : 'capture-success-after-session-release',
      );
    publishAustinOperatingFixtureDocumentEvidence();
    fixtureDelivery = {
      ...fixtureDelivery,
      documentOwners: failureProgress.workload.austinOperatingFixtureDocuments,
    };
    failureProgress.fixtureDelivery = fixtureDelivery;
  }
  if (providerContext) {
    await providerContext.close();
    providerContext = null;
    const bindingCleanup = await disposeActiveRenderBoundaryProgressBinding(
      'capture-success-document-closed',
      { documentClosed: true },
    );
    if (bindingCleanup && !bindingCleanup.removed)
      throw new Error(
        'Render-boundary binding cleanup was not confirmed by document closure.',
      );
  }
  if (workerAuditMode === 'receipt-only' && finalizeReceiptOnlyDocumentAudit) {
    if (!providerContext && !page.isClosed())
      await closeReceiptOnlyAuditPage(page);
    finalizeReceiptOnlyDocumentAudit();
    finalizeReceiptOnlyDocumentAudit = null;
  }
  const workload = {
    warmupMs,
    durationPerSampleMs: seconds * 1000,
    runsPerScenario: runs,
    startupRuns: startupSamples.length,
    scenarios,
    rendererProbeCleanup: [
      ...(failureProgress.workload.rendererProbeCleanup || []),
    ],
    rendererProbeCleanupOmittedCount:
      failureProgress.workload.rendererProbeCleanupOmittedCount || 0,
    rendererLoopRetirements: [
      ...(failureProgress.workload.rendererLoopRetirements || []),
    ],
    rendererLoopRetirementsOmittedCount:
      failureProgress.workload.rendererLoopRetirementsOmittedCount || 0,
    ...(austinOperatingWorkload
      ? {
          austinOperatingFixtureDocuments: [
            ...(failureProgress.workload.austinOperatingFixtureDocuments || []),
          ],
          ...(austinReadinessHistoryEnabled
            ? {
                austinOperatingReadinessHistory: structuredClone(
                  failureProgress.workload.austinOperatingReadinessHistory,
                ),
              }
            : {}),
        }
      : {}),
    ...(shaderProgramAttributionEnabled
      ? {
          shaderProgramAttribution: shaderProgramAttributionEnvelope(),
          shaderProgramAttributionArtifact:
            failureProgress.workload.shaderProgramAttributionArtifact || null,
          performanceAcceptanceEligible: false,
        }
      : {}),
    fixtureInterceptionReleases: [
      ...(failureProgress.workload.fixtureInterceptionReleases || []),
    ],
    ...(depthPickAttributionEnabled
      ? {
          depthPickAttribution: depthPickAttributionEnvelope(),
          performanceAcceptanceEligible: false,
        }
      : {}),
    fixture:
      infrastructureWorkload ||
      weatherEffectsWorkload ||
      austinOperatingWorkload ||
      (mapStreamingFixture
        ? {
            id: mapStreamingFixture.id,
            sha256: mapStreamingFixture.manifestSha256,
            byteLength: mapStreamingFixture.manifest.totalBytes,
          }
        : null) ||
      fixture,
    providerFixture: infrastructureWorkload
      ? infrastructureWorkload.workloadId
      : weatherEffectsWorkload
        ? weatherEffectsWorkload.workloadId
        : austinOperatingWorkload
          ? austinOperatingWorkload.workloadId
          : mapStreamingWorkloadSelected
            ? MAP_STREAMING_WORKLOAD_ID
            : productionFlightFixture
              ? 'dense-investigation'
              : null,
    fixtureId:
      infrastructureWorkload?.id ||
      weatherEffectsWorkload?.id ||
      austinOperatingWorkload?.id ||
      mapStreamingFixture?.id ||
      productionFlightFixture?.id ||
      null,
    injectedDelayMs: delayMs,
    hardwareRequired,
    ...(productionFlightFixture
      ? {
          providerFixtureLifecycle: {
            scope:
              'each measured scenario/repetition uses a newly created browser context; the earlier setup page contributes environment metadata only, not a capture sample',
            clock:
              'fixture wall time is held during setup, advances monotonically within configured warmup/measurement phases, then stays capped at each declared boundary; native timers, RAF and performance.now are unchanged',
            boundarySettling:
              'one completed Cesium postRender is observed at each capped boundary outside the measured interval, with host and page timeout bounds',
            workerAuditTimingBoundary:
              workerAuditMode === 'prewarm'
                ? PREWARM_WORKER_AUDIT_BOUNDARY
                : 'during-capture-diagnostic-instrumentation',
            trackingRoute:
              'entity-follow-v1 observes the public trackedEntity position, camera pose and Cesium clock state at both fixture epochs',
            fixtureTimeAlignment:
              'whole-second UTC; OpenSky source and position epochs agree exactly',
            sourceFreshnessWindowMs: 120_000,
          },
        }
      : {}),
    ...(infrastructureWorkload
      ? {
          infrastructureFixtureLifecycle: {
            scope:
              'one measured app document per capture process; each asset response is matched to its verified build-receipt URL and SHA-256, with populations observed before and after every sample',
            clock:
              'Date.now remains at the declared whole-millisecond epoch; Cesium currentTime is set from Cesium.JulianDate.fromDate with shouldAnimate=false and multiplier=0',
            camera: structuredClone(infrastructureWorkload.camera),
            routeScope:
              'idle and elapsed-time scripted camera motion, reset from the same captured home pose before every run',
            freshBrowserContextPerSample: false,
          },
        }
      : {}),
    ...(weatherEffectsWorkload
      ? {
          weatherEffectsCaptureMode: weatherEffectsComparisonRun
            ? 'comparison'
            : 'phase-producer-diagnostic',
          performanceAcceptanceEligible: Boolean(weatherEffectsComparisonRun),
          weatherEffectsFixtureLifecycle:
            weatherEffectsModule.createWeatherEffectsFixtureLifecycle({
              fixture: weatherEffectsWorkload,
              cameraObservation: weatherCameraObservation,
              timelinePreflight: weatherTimelinePreflight,
              workload: {
                warmupMs,
                durationPerSampleMs: seconds * 1000,
                runsPerScenario: runs,
              },
              phaseObservationsBySample: captures.map(
                (sample) => sample.weatherEffectsClock?.phaseObservations,
              ),
            }),
        }
      : {}),
    ...(mapStreamingWorkloadSelected
      ? mapStreamingModule.mapStreamingCaptureWorkloadFields(
          mapStreamingFinalEvidence,
        )
      : {}),
    mixedLayers: mixedLayerFixture,
    qualityMode,
    expectedDensityPct: Number.isFinite(expectedDensityPct)
      ? expectedDensityPct
      : null,
    cameraPath:
      'elapsed-move-right-v1 for scripted motion; parked-v1 for idle; entity-follow-v1 for provider-backed tracking',
    detectionMode:
      fixture ||
      infrastructureWorkload ||
      weatherEffectsWorkload ||
      austinOperatingWorkload ||
      mapStreamingWorkloadSelected
        ? detectionMode
        : null,
    populationStableAcrossSamples,
    cameraPathStableAcrossSamples,
    ...(sceneFrameDiagnosticsEnabled && productionFlightFixture
      ? {
          sceneFrameDiagnostics: {
            enabled: true,
            targetScenario: 'scripted-motion',
            targetRun: 1,
            scope:
              'installed before warmup, stopped after measurement-boundary settlement; bounded CPU/event timing, not GPU duration',
            eligibleForComparison: false,
          },
        }
      : {}),
    ...(firstMotionCpuProfileEnabled
      ? {
          providerSampleCpuProfiles: {
            ...providerSampleCpuProfileEnvelope(),
          },
        }
      : {}),
    note: 'Repeat base and candidate with the same browser, renderer, source population, camera path, viewport, warmup and foreground state.',
  };
  const comparisonReadinessReasons = getCaptureReadinessReasons({
    contract: comparisonContract,
    fixture: comparisonFixture,
    fixtureDelivery,
    comparisonProfile,
    source,
    environment,
    workload,
    captures,
    diagnosticsDocuments: performanceDiagnosticsDocuments,
    workerBlobAuditInstrumented:
      Boolean(captureProvenance) && workerAuditMode !== 'receipt-only',
    receiptOnlyWorkerAuditEvidence:
      workerAuditMode === 'receipt-only'
        ? {
            pageAssetAudit: source.buildProvenance.pageAssetAudit,
            expectedDocuments: captureDocumentTopology.workerAudits,
            expectedAssetPaths: captureProvenance.source.expectedAssetPaths,
            bundlePath: captureWorkerContract.bundlePath,
            bundleSha256: captureWorkerContract.bundleSha256,
            workerSourceSha256: captureWorkerContract.workerSourceSha256,
            allowedModuleCount: captureWorkerContract.allowedModuleCount,
          }
        : null,
    workerAuditMode,
    hardwareRequired,
  });
  if (sceneFrameDiagnosticsEnabled && productionFlightFixture)
    comparisonReadinessReasons.push(
      'scene-frame-attribution-instrumentation-is-enabled',
    );
  if (austinReadinessHistoryEnabled)
    comparisonReadinessReasons.push(
      'austin-setup-readiness-history-instrumentation-is-enabled',
    );
  if (firstMotionCpuProfileEnabled)
    comparisonReadinessReasons.push(
      'provider-sample-cpu-profile-instrumentation-is-enabled',
    );
  if (depthPickAttributionEnabled)
    comparisonReadinessReasons.push(
      'depth-pick-attribution-instrumentation-is-enabled',
    );
  if (shaderProgramAttributionEnabled)
    comparisonReadinessReasons.push(
      'shader-program-attribution-instrumentation-is-enabled',
    );
  if (weatherEffectsWorkload && !weatherEffectsComparisonRun)
    comparisonReadinessReasons.push(
      'weather-effects-fixture-is-a-short-diagnostic-not-performance-acceptance',
    );
  if (nativeRenderingDiagnostic)
    comparisonReadinessReasons.push(
      'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
    );
  if (frameTraceEnabled)
    comparisonReadinessReasons.push(
      'diagnostic-frame-trace-instrumentation-is-ineligible-for-comparison',
    );
  const comparisonEligible = comparisonReadinessReasons.length === 0;
  // These host/browser identity reads happen after all timed samples. Keep
  // browser-reported platform separate from the machine that launched Chrome.
  const hostEnvironment = readHostEnvironment();
  if (!graphicsRead) graphics = await readBrowserGraphicsInfo(browser);
  const report = {
    schema: 'gev-performance-capture/v1',
    workerAuditMode,
    workerAuditTimingBoundary:
      workerAuditMode === 'prewarm'
        ? PREWARM_WORKER_AUDIT_BOUNDARY
        : workerAuditMode === 'receipt-only'
          ? 'external-receipt-path-observation-no-page-worker-instrumentation'
          : 'during-capture-diagnostic-instrumentation',
    ...(firstMotionCpuProfileEnabled
      ? {
          providerSampleCpuProfiles: {
            ...providerSampleCpuProfileEnvelope(),
          },
        }
      : {}),
    ...(sceneFrameDiagnosticsEnabled && productionFlightFixture
      ? {
          sceneFrameDiagnostics: {
            status: captures.some(
              (sample) =>
                sample.scenario === 'scripted-motion' &&
                sample.run === 1 &&
                sample.sceneFrameAttribution?.status === 'completed' &&
                sample.sceneFrameAttribution?.cleanup === 'confirmed' &&
                sample.sceneFrameAttribution?.observation
                  ?.sceneEventAvailability?.update === true &&
                sample.sceneFrameAttribution?.observation
                  ?.sceneEventAvailability?.render === true,
            )
              ? 'completed'
              : 'incomplete',
            targetScenario: 'scripted-motion',
            targetRun: 1,
            eligibleForComparison: false,
          },
        }
      : {}),
    performanceDiagnostics: {
      requested:
        'disabled-after-app-ready-before-warmup-when-supported-per-document',
      documents: performanceDiagnosticsDocuments,
    },
    capturedAt: new Date().toISOString(),
    ...(nativeRendererEvidence
      ? { nativeRendererDiagnostic: nativeRendererEvidence }
      : {}),
    source,
    url: new URL(url).origin,
    comparisonEligible,
    ...(comparisonContract ? { comparisonContract } : {}),
    comparisonReadiness: {
      status: comparisonEligible ? 'ready' : 'not-ready',
      workerAuditTimingBoundary:
        workerAuditMode === 'prewarm'
          ? PREWARM_WORKER_AUDIT_BOUNDARY
          : workerAuditMode === 'receipt-only'
            ? 'external-receipt-path-observation-no-page-worker-instrumentation'
            : 'during-capture-diagnostic-instrumentation',
      reasons: comparisonReadinessReasons,
      reason: comparisonReadinessReasons.join('; ') || null,
    },
    ...(fixtureDelivery ? { fixtureDelivery } : {}),
    environment,
    hostEnvironment,
    graphics,
    integrity,
    workload,
    motionBudget: {
      ...motionBudget,
      note: 'Idle rendering is intentionally sparse and is excluded from motion frame budgets.',
    },
    captures,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, json, 'utf8');
    process.stdout.write(`Wrote ${path.resolve(out)}\n`);
  } else {
    process.stdout.write(json);
  }
  if (frameTraceOut) {
    const trace = {
      schema: 'gev-performance-frame-trace/v1',
      diagnosticOnly: true,
      appCommit: source.appCommit,
      harnessCommit: source.harnessCommit,
      buildHarnessCommit: source.buildHarnessCommit,
      workloadId: workload.providerFixture || workload.workloadId || null,
      fixtureId: workload.fixtureId || null,
      profile: comparisonProfile,
      url: new URL(url).origin,
      captures: captures.map((sample) => ({
        scenario: sample.scenario,
        run: sample.run,
        durationMs: sample.durationMs,
        frameTrace: sample.frameTrace || [],
        frameTraceWindow: sample.frameTraceWindow || null,
        longTaskTrace: sample.longTaskTrace || [],
        longTasks: sample.longTasks || null,
        renderDemandOwnership: sample.renderDemandOwnership || null,
        foregroundContinuity: sample.foregroundContinuity || null,
        cameraPath: sample.cameraPath || null,
      })),
      limits: { maxFramesPerCapture: 4096, maxCaptures: captures.length },
      note: 'Diagnostic-only preRender/postRender wall times; sceneRenderWallMs is not GPU execution time.',
    };
    await fs.mkdir(path.dirname(path.resolve(frameTraceOut)), {
      recursive: true,
    });
    await fs.writeFile(frameTraceOut, `${JSON.stringify(trace, null, 2)}\n`, {
      flag: 'wx',
    });
    process.stdout.write(`Wrote ${path.resolve(frameTraceOut)}\n`);
  }
  if (nativeRendererEvidence && nativeRendererEvidence.status !== 'verified')
    process.exitCode = 2;
  if (hardwareRequired && !environment.hardwareEligible) process.exitCode = 2;
  // Idle governor frames are intentionally sparse and are not a motion
  // performance failure. Apply an explicit frame budget only to the moving
  // workload, as required by the performance acceptance contract.
  if (motionBudget.status === 'failed' || motionBudget.status === 'incomplete')
    process.exitCode = 1;
} catch (error) {
  captureFailure = error;
  if (mapStreamingWorkloadSelected && mapStreamingModule) {
    try {
      if (error?.mapStreamingJourneyFailure) {
        failureProgress.workload.mapStreamingJourneyFailure =
          mapStreamingModule.projectMapStreamingJourneyFailureEvidence(
            error.mapStreamingJourneyFailure,
          );
        if (failureProgress.workload.mapStreamingCapture?.status === 'running')
          failureProgress.workload.mapStreamingCapture = {
            ...failureProgress.workload.mapStreamingCapture,
            status: 'journey-failed',
          };
      }
    } catch {
      failureProgress.workload.mapStreamingJourneyFailure = {
        schema: 'gev-map-streaming-journey-failure/v1',
        status: 'invalid',
        reasonCode: 'invalid-envelope',
      };
    }
  }
  await stopProviderSampleCpuProfile('capture-failed');
  await stopSceneFrameAttribution(
    'capture-failed',
    failureProgress.current?.measurement ?? null,
  );
  await disposeActiveRenderBoundaryProgressBinding('capture-failed');
  if (failureProgress.phase === 'final-integrity-check') {
    const failedSample = String(error?.message || '').match(
      /^(idle|scripted-motion|selected-aircraft-tracking) run (\d+):/,
    );
    if (failedSample) {
      failureProgress.scenario = failedSample[1];
      failureProgress.run = Number(failedSample[2]);
    }
  }
  process.exitCode = 1;
  try {
    await writeCaptureFailure(error);
    failureReportWritten = true;
  } catch {
    process.stderr.write('Could not write bounded failed-capture evidence.\n');
  }
} finally {
  weatherEffectsFixtureAbortController?.abort(
    new Error('Weather fixture capture ended.'),
  );
  await stopProviderSampleCpuProfile('capture-finally');
  await stopSceneFrameAttribution(
    'capture-finally',
    failureProgress.current?.measurement ?? null,
  );
  await disposeActiveRenderBoundaryProgressBinding('capture-finally');
  if (activePage && activeDepthPickAttribution) {
    try {
      await disposeDepthPickAttributionForPage(
        activePage,
        activeDepthPickAttribution,
      );
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  for (const probePage of [...earlyRendererProbeScripts.keys()]) {
    try {
      await cleanupEarlyRendererProbeForPage(probePage, {
        retireViewerRenderLoop: true,
        phase: 'capture-final-document-retirement',
        documentRole:
          probePage === activePage ? activeDocumentRole : 'retired-document',
        documentId: probePage === activePage ? activeDocumentId : null,
      });
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  for (const session of [...fixtureInterceptionSessions]) {
    try {
      await releaseFlightFixtureSession(session);
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  for (const owner of austinOperatingFixtureDeliveries) {
    if (owner.disposed) continue;
    try {
      finalizeAustinOperatingFixtureDelivery(
        owner,
        'capture-finally-after-session-release',
      );
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  publishAustinOperatingFixtureDocumentEvidence();
  if (mapStreamingWorkloadSelected) {
    try {
      failureProgress.workload.mapStreamingFixtureDocuments =
        collectMapStreamingFixtureDocumentDeliveries();
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  weatherEffectsFixtureDelivery?.dispose();
  try {
    await foregroundActivationSession?.dispose();
  } catch (error) {
    captureFailure ||= error;
    process.exitCode = 1;
  }
  foregroundActivationSession = null;
  for (const [
    responsePage,
    responseListener,
  ] of infrastructureResponseListeners) {
    try {
      if (typeof responsePage.off === 'function')
        responsePage.off('response', responseListener);
      else responsePage.removeListener('response', responseListener);
    } catch (error) {
      captureFailure ||= error;
      process.exitCode = 1;
    }
  }
  infrastructureResponseListeners.clear();
  try {
    await browser.close();
  } catch (error) {
    captureFailure ||= error;
    process.exitCode = 1;
  } finally {
    if (workerAuditMode === 'receipt-only') {
      try {
        finalizeReceiptOnlyDocumentAudit?.();
      } catch (error) {
        captureFailure ||= error;
        process.exitCode = 1;
      }
    }
    if (ownedBrowserPidFile)
      await fs.rm(ownedBrowserPidFile, { force: true }).catch(() => {});
  }
  await refreshShaderProgramAttributionCheckpoint().catch(() => {});
}
if (captureFailure && !failureReportWritten) {
  try {
    await writeCaptureFailure(captureFailure);
  } catch {
    process.stderr.write('Could not write bounded failed-capture evidence.\n');
  }
} else if (
  captureFailure &&
  (sceneFrameDiagnosticsEnabled ||
    depthPickAttributionEnabled ||
    shaderProgramAttributionEnabled ||
    failureProgress.workload.fixtureInterceptionReleases.length > 0 ||
    austinOperatingFixtureDeliveries.length > 0)
) {
  try {
    await writeCaptureFailure(captureFailure, { refresh: true });
  } catch {
    process.stderr.write(
      'Could not refresh bounded failed-capture evidence after cleanup; preserving the initial report.\n',
    );
  }
}
