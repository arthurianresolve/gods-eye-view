import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOCATION_TEST_FILES = Object.freeze([
  'src/data/focusAllocations.test.mjs',
  'src/overlays/worldOverlayAllocation.test.mjs',
]);
export const PERFORMANCE_HARNESS_TEST_FILES = Object.freeze([
  'scripts/performance/decorationCaptureProof.test.mjs',
  'scripts/performance/decorationQuantization.test.mjs',
  'scripts/performance/nativeWindowViewport.test.mjs',
  'scripts/performance/settledIdleObservation.test.mjs',
  'scripts/performance/settledIdleQualification.test.mjs',
  'scripts/performance/repeatedFullImageControls.test.mjs',
  'scripts/performance/runRepeatedVisualQualification.test.mjs',
  'scripts/performance/visualPaintSignature.test.mjs',
  'scripts/performance/canonicalPointerHistory.test.mjs',
  'scripts/performance/fullExtentPointerSweep.test.mjs',
  'scripts/performance/interactionEventTiming.test.mjs',
  'scripts/performance/startupOperatingContract.test.mjs',
  'scripts/accessibilityFocusDiagnostics.test.mjs',
  'scripts/performance/cesiumDisabledInputInertia.test.mjs',
  'scripts/performance/cesiumTerrainCollisionTransform.test.mjs',
  'scripts/apply-cesium-patches.test.mjs',
  'scripts/audit-bundle-chunks.test.mjs',
  'scripts/performance/motionBudget.test.mjs',
  'scripts/performance/captureIntegrity.test.mjs',
  'scripts/performance/captureDiagnosticsControl.test.mjs',
  'scripts/performance/captureFailureReport.test.mjs',
  'scripts/performance/hostedRendererBackend.test.mjs',
  'scripts/performance/pairedReport.test.mjs',
  'scripts/performance/mapFrameCaptureHome.test.mjs',
  'scripts/performance/performanceMatrix.test.mjs',
  'scripts/performance/hostedSourceProvenance.test.mjs',
  'scripts/performance/hostedNavigationDiagnostics.test.mjs',
  'scripts/performance/hostedSoakSession.test.mjs',
  'scripts/performance/candidatePerformanceEvidence.test.mjs',
  'scripts/performance/qualificationMetrics.test.mjs',
  'scripts/performance/qualificationBuildIdentity.test.mjs',
  'scripts/performance/visibleButtonFeedback.test.mjs',
  'scripts/performance/webglFrameDelivery.test.mjs',
  'scripts/performance/webglStartDelay.test.mjs',
  'scripts/performance/captureComparisonContract.test.mjs',
  'scripts/performance/buildProvenance.test.mjs',
  'scripts/performance/buildSmokeContract.test.mjs',
  'scripts/performance/nativeSharpnessProfile.test.mjs',
  'scripts/performance/finalVisualQualification.test.mjs',
  'scripts/performance/visibleControlVariance.test.mjs',
  'scripts/performance/idleCadenceDisposition.test.mjs',
  'scripts/performance/austinOperatingRenderDemandDiagnostic.test.mjs',
  'scripts/qa-performance-build-smoke.test.mjs',
  'scripts/print-qa-evidence.test.mjs',
  'scripts/qa-application-fixtures.test.mjs',
  'scripts/performance/captureBuildProvenance.test.mjs',
  'scripts/performance/captureProducerCli.test.mjs',
  'scripts/performance/framebufferPreservationDiagnostic.test.mjs',
  'scripts/performance/commonSceneObserver.test.mjs',
  'scripts/performance/consoleMessageOwnership.test.mjs',
  'scripts/performance/startupDiagnostics.test.mjs',
  'scripts/performance/startupAttribution.test.mjs',
  'scripts/performance/startupCpuAttribution.test.mjs',
  'scripts/performance/startupProviderFixtureDiagnostic.test.mjs',
  'scripts/performance/profileRecoveryPageOwnership.test.mjs',
  'scripts/performance/profileRecoveryBrowserVersion.test.mjs',
  'scripts/performance/productionFlightFixture.test.mjs',
  'scripts/performance/glCompletionProbe.test.mjs',
  'scripts/performance/pairedRendererExperiment.test.mjs',
  'scripts/performance/shaderProgramAttributionArtifact.test.mjs',
  'scripts/performance/importFrameDiagnostics.test.mjs',
  'scripts/performance/importPointState.test.mjs',
  'scripts/performance/importPointRepresentationComparison.test.mjs',
  'scripts/performance/importPointRepresentationBenefit.test.mjs',
  'scripts/performance/profileRecoveryFixtureContract.test.mjs',
  'scripts/performance/importWorkspaceLifecycle.test.mjs',
  'scripts/performance/browserReadinessGate.test.mjs',
  'scripts/performance/rendererEvidence.test.mjs',
  'scripts/performance/browserShutdownControls.test.mjs',
  'scripts/performance/cesiumWorkerBlobContract.test.mjs',
  'scripts/performance/prewarmWorkerAuditBoundary.test.mjs',
  'scripts/performance/receiptOnlyWorkerAudit.test.mjs',
  'scripts/performance/receiptOnlyPageClose.test.mjs',
  'scripts/performance/rawReceiptAssetMiddleware.test.mjs',
  'scripts/performance/missionRenderDemand.test.mjs',
  'scripts/performance/trafficRenderDemand.test.mjs',
  'scripts/fixtures/traffic-surface-readiness.test.mjs',
  'scripts/performance/vesselRenderDemand.test.mjs',
  'scripts/performance/nativePointerFixture.test.mjs',
  'scripts/performance/cctvCalibrationDemand.test.mjs',
  'scripts/performance/cctvViewshedRetention.test.mjs',
  'scripts/qa-mission-render-demand.test.mjs',
  'scripts/performance/cctvLifecycle.test.mjs',
  'scripts/performance/terrainPickingLifecycle.test.mjs',
  'scripts/performance/mapStreamingFixture.test.mjs',
  'scripts/performance/mapStreamingFixtureDelivery.test.mjs',
  'scripts/performance/mapStreamingCapture.test.mjs',
  'scripts/performance/streamedTileNetworkEvidence.test.mjs',
  'scripts/fixtures/terrainCurrentUpdateReadiness.test.mjs',
  'scripts/performance/trackedFrameTimeRepro.test.mjs',
  'scripts/performance/trackedFloorCoverage.test.mjs',
  'scripts/performance/s59DocumentDecodeComparison.test.mjs',
  'scripts/performance/s59CoordinateTransfer.test.mjs',
  'scripts/performance/s58PostProcessStageCensus.test.mjs',
  'scripts/performance/csvDecodeComparison.test.mjs',
  'scripts/performance/militaryTrackedFrameTimeRepro.test.mjs',
  'scripts/performance/windFrameProbe.test.mjs',
  'scripts/performance/infrastructureCollectionExperiment.test.mjs',
  'scripts/performance/infrastructureRuntimeComparison.test.mjs',
  'scripts/fixtures/infrastructureCurrentUpdateReadiness.test.mjs',
  'scripts/fixtures/infrastructureFixtureCamera.test.mjs',
  'scripts/fixtures/infrastructureNativePickOwnership.test.mjs',
  'scripts/fixtures/infrastructurePickPathDiagnostic.test.mjs',
  'scripts/fixtures/infrastructurePrimitiveReadinessDiagnostic.test.mjs',
  'scripts/performance/overlayAttribution.test.mjs',
  'scripts/performance/aircraftBillboardMutationAudit.test.mjs',
  'scripts/performance/aircraftFleetTickAudit.test.mjs',
  'scripts/qa-candidate.test.mjs',
  'scripts/qa-install-recovery.test.mjs',
  'scripts/qa-mixed-use-soak.test.mjs',
  'scripts/review-soak-evidence.test.mjs',
  'scripts/stage-release.test.mjs',
  'scripts/performance/depthPickAttribution.test.mjs',
  'scripts/performance/infrastructureWorkloadFixture.test.mjs',
  'scripts/performance/austinOperatingDocumentEvidence.test.mjs',
  'scripts/performance/austinOperatingReadinessHistory.test.mjs',
  'scripts/performance/austinOperatingPopulationEvidence.test.mjs',
  'scripts/performance/austinOperatingWorkloadFixture.test.mjs',
  'scripts/performance/austinOperatingComparisonContract.test.mjs',
  'scripts/performance/austinSatelliteSampledEpoch.test.mjs',
  'scripts/performance/weatherEffectsWorkloadFixture.test.mjs',
  'scripts/performance/weatherInterleavedDiagnosticContract.test.mjs',
  'scripts/performance/weatherIdleDiagnostic.test.mjs',
  'scripts/performance/weatherIdleCadenceDisposition.test.mjs',
  'scripts/performance/weatherVisibleWindProbe.test.mjs',
  'scripts/performance/weatherBalancedQualification.test.mjs',
  'scripts/performance/balancedStartupConfirmation.test.mjs',
  'scripts/performance/startupObservationMethod.test.mjs',
  'scripts/run-unit-tests.test.mjs',
  'scripts/capture-scene-performance.test.mjs',
  'scripts/performance/captureRendererProbeRetirementIntegration.test.mjs',
  'scripts/performance/captureFixtureInterceptionReleaseIntegration.test.mjs',
  'scripts/performance/fixtureInterceptionFailureEvidence.test.mjs',
  'scripts/performance/foregroundPageActivation.test.mjs',
  'scripts/performance/foregroundSampleContinuity.test.mjs',
  'scripts/performance/renderBoundaryObservation.test.mjs',
  'scripts/performance/sceneMeasurementDeadline.test.mjs',
  'scripts/performance/postMeasurementSourceDrain.test.mjs',
  'scripts/performance/settleCompletedRenderDiagnostic.test.mjs',
  'scripts/performance/terminalViewerObservation.test.mjs',
  'scripts/performance/boundedCpuProfile.test.mjs',
  'scripts/performance/providerSampleCpuProfileWindow.test.mjs',
  'scripts/performance/providerDocumentRetirement.test.mjs',
  'scripts/performance/windowsForegroundWindow.test.mjs',
  'scripts/performance/runFinalVisualQualification.test.mjs',
  'scripts/performance/visualPresentationBoundary.test.mjs',
  'scripts/performance/debuggerPausedCapture.test.mjs',
  'scripts/performance/captureBrowserTrace.test.mjs',
  'scripts/captureNoUndefConfig.test.mjs',
]);

/** Whether this runtime matches the one the allocation budgets were calibrated on. */
export function isCalibratedAllocationRuntime(version = process.versions.node) {
  return Number.parseInt(String(version).split('.')[0], 10) === 24;
}

/** Require the runtime on which allocation budgets were calibrated. */
export function assertNode24AllocationRuntime(version = process.versions.node) {
  if (!isCalibratedAllocationRuntime(version)) {
    throw new Error(
      `Allocation budgets require the calibrated Node 24 runtime; received ${version}`,
    );
  }
  return version;
}

/**
 * Directories this runner searches for `*.test.mjs`, in stable order.
 *
 * `server/` belongs here because provider modules own tests of their own: a
 * suite placed beside the module it covers must run, and CI's unit-test job runs
 * `npm test`, so a directory missing from this list is a suite that never runs
 * there. `unitTestRunner.test.mjs` asserts the list covers every `*.test.mjs`
 * outside dependencies, build output and dot-directories, so adding a tree
 * without adding it here fails.
 */
export const UNIT_TEST_ROOTS = Object.freeze([
  'src',
  'server',
  'scripts',
  'build',
]);

/** Discover repository unit tests in stable path order. */
export function discoverUnitTestFiles(root = process.cwd()) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  for (const testRoot of UNIT_TEST_ROOTS) {
    const directory = path.join(root, testRoot);
    if (existsSync(directory)) visit(directory);
  }
  return files.sort();
}

/** Partition ordinary parallel tests from the two GC-bracketed probes. */
export function buildUnitTestPlan(files) {
  const known = new Set(files);
  const missingAllocationTests = ALLOCATION_TEST_FILES.filter(
    (file) => !known.has(file),
  );
  if (missingAllocationTests.length) {
    throw new Error(
      `Missing allocation microbenchmarks: ${missingAllocationTests.join(', ')}`,
    );
  }
  const allocationSet = new Set(ALLOCATION_TEST_FILES);
  return {
    parallel: files.filter((file) => !allocationSet.has(file)).sort(),
    serializedAllocations: [...ALLOCATION_TEST_FILES],
  };
}

/** Build the isolated Node invocation for one GC-bracketed allocation probe. */
export function allocationTestArgs(file) {
  if (!ALLOCATION_TEST_FILES.includes(file)) {
    throw new Error(`Not an allocation microbenchmark: ${file}`);
  }
  return ['--expose-gc', '--test', '--test-concurrency=1', file];
}

function runTests(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function runUnitTests() {
  const plan = buildUnitTestPlan(discoverUnitTestFiles());
  const parallelStatus = runTests(['--test', ...plan.parallel]);
  if (parallelStatus !== 0) return parallelStatus;

  // The GC-bracketed budgets are calibrated on Node 24 and are meaningless on
  // other allocators. A contributor's suite must stay green on any supported
  // engine (package.json permits >=24), so uncalibrated runtimes skip the
  // probes with a warning. Set GEV_REQUIRE_ALLOCATION_GATE=1 (pinned CI /
  // release batteries) to make an uncalibrated runtime a hard failure.
  if (!isCalibratedAllocationRuntime()) {
    if (process.env.GEV_REQUIRE_ALLOCATION_GATE === '1') {
      assertNode24AllocationRuntime();
    }
    console.warn(
      `[unit] SKIPPED ${ALLOCATION_TEST_FILES.length} allocation microbenchmarks: ` +
        `budgets are calibrated for Node 24, running ${process.versions.node}. ` +
        'Run under Node 24 (or set GEV_REQUIRE_ALLOCATION_GATE=1 to fail instead).',
    );
    return 0;
  }
  for (const file of plan.serializedAllocations) {
    const status = runTests(allocationTestArgs(file));
    if (status !== 0) return status;
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) process.exitCode = runUnitTests();
