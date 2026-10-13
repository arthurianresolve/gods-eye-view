#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  rename,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createLocalBuildReceipt,
  MAP_FIXTURE_BUILD_PROFILE_ID,
} from './performance/buildProvenance.mjs';
import { beginCaptureBuildProvenance } from './performance/captureBuildProvenance.mjs';
import {
  auditReceiptedCodeRequests,
  createApplicationCodeRequestAudit,
  respondToWorkerPreflight,
  runSameOriginWorkerPreflight,
  waitForPreflightWorkerTargetsClosed,
} from './performance/buildSmokeContract.mjs';
import {
  describeObservedRoute,
  observeCommonScene,
} from './performance/commonSceneObserver.mjs';
import {
  cleanupEarlyCesiumRendererProbeWithEvidence,
  installEarlyCesiumRendererProbe,
} from './performance/earlyCesiumRendererProbe.mjs';
import {
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  installHeldMonotonicWallClock,
  respondToProductionFlightFixture,
} from './performance/productionFlightFixture.mjs';
import {
  deriveCesiumEmbeddedWorkerContract,
  installCesiumWorkerBlobAudit,
  MAX_WORKER_TARGETS,
  restoreCesiumWorkerBlobAudit,
  summarizeCesiumWorkerBlobEvidence,
  validateCesiumWorkerBlobs,
} from './performance/cesiumWorkerBlobContract.mjs';
import {
  boundCaptureReportEvidence,
  MAX_CAPTURE_FAILURE_REPORT_BYTES,
} from './performance/captureFailureReport.mjs';
import {
  createObservedDenseComparisonContract,
  createObservedInfrastructureComparisonContract,
  createObservedAustinOperatingComparisonContract,
  createCaptureDocumentTopology,
  getCaptureComparisonIneligibilityReasons,
} from './performance/captureComparisonContract.mjs';
import { INFRASTRUCTURE_WORKLOAD_IDS } from './performance/infrastructureWorkloadContract.mjs';
import { AUSTIN_OPERATING_WORKLOAD_ID } from './performance/austinOperatingWorkloadContract.mjs';
import { MAP_STREAMING_WORKLOAD_ID } from './performance/mapStreamingWorkloadContract.mjs';
import { validateReceiptOnlyWorkerAuditEnvelope } from './performance/receiptOnlyWorkerAudit.mjs';
import {
  assertVerifiedNativeRendererEvidence,
  captureCliRendererArgs,
  DEFAULT_CAPTURE_RENDERER_BACKEND,
  NATIVE_MACOS_DIAGNOSTIC_BACKEND,
  nativeRendererDiagnosticEvidence,
  rendererLaunchArgs,
  validateNativeRendererDiagnosticHost,
} from './performance/hostedRendererBackend.mjs';
import { readBrowserGraphicsInfo } from './performance/rendererEvidence.mjs';
import { observeTerminalViewerState } from './performance/terminalViewerObservation.mjs';
import { validateDepthPickAttributionEnvelope } from './performance/depthPickAttribution.mjs';
import { boundedShaderProgramAttribution } from './performance/earlyCesiumRendererProbe.mjs';
import {
  MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
  createShaderProgramAttributionCheckpointReference,
  validateShaderProgramAttributionCheckpoint,
  validateShaderProgramAttributionCheckpointReference,
  verifyShaderProgramAttributionArtifactBytes,
} from './performance/shaderProgramAttributionArtifact.mjs';

const BASELINE_SHA = 'eb8c6828d0d03e1c04bda94c8c4fb99915a577b7';
export const MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES = 8 * 1024 * 1024;
const ROOT = await realpath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const DEFAULT_BUDGET_MS = 12 * 60 * 1000;
const BUILD_COMMAND_TIMEOUT_MS = 150 * 1000;
const CAPTURE_CLI_TIMEOUT_MS = 180 * 1000;

export async function respondToSmokeFixtureRequest(
  url,
  request,
  { baseUrl, mapStreamingDelivery, flightFixture },
) {
  const workerResponse = respondToWorkerPreflight(url, baseUrl);
  if (workerResponse !== undefined) return workerResponse;

  const mapResponse = mapStreamingDelivery
    ? await mapStreamingDelivery.respond(url, request)
    : null;
  if (mapResponse !== null && mapResponse !== undefined) return mapResponse;

  return respondToProductionFlightFixture(url, request, flightFixture, baseUrl);
}

export function smokeProviderPreparationMode(providerFixture) {
  return providerFixture === MAP_STREAMING_WORKLOAD_ID
    ? 'native-map-streaming'
    : 'dense-provider-fixture';
}

export function observeSmokeLayerPopulationInPage() {
  const manager = window.__godsEyeView?.dataManager;
  if (!manager || typeof manager.getAll !== 'function')
    throw new Error('Application layer manager is unavailable.');
  const layers = manager.getAll();
  if (!Array.isArray(layers) || layers.length > 256)
    throw new Error('Application layer inventory is invalid or oversized.');
  return layers
    .map((layer) => {
      if (typeof layer?.id !== 'string' || !layer.id || layer.id.length > 96)
        throw new Error('Application layer identity is invalid.');
      const count = layer.stats?.count;
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
        throw new Error(`Application layer count is invalid for ${layer.id}.`);
      return {
        id: layer.id,
        enabled:
          typeof manager.isEnabled === 'function'
            ? manager.isEnabled(layer.id) === true
            : layer.enabled === true,
        count: count ?? null,
      };
    })
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
}

export function validateMapSmokeLayerPopulation(before, after) {
  for (const [label, layers] of [
    ['before', before],
    ['after', after],
  ]) {
    assert.ok(Array.isArray(layers) && layers.length <= 256);
    const ids = new Set();
    for (const layer of layers) {
      assert.equal(typeof layer?.id, 'string');
      assert.ok(layer.id.length > 0 && layer.id.length <= 96);
      assert.equal(ids.has(layer.id), false, `Duplicate ${label} layer ID.`);
      ids.add(layer.id);
      assert.equal(typeof layer.enabled, 'boolean');
      assert.ok(
        layer.count === null ||
          (Number.isSafeInteger(layer.count) && layer.count >= 0),
      );
    }
  }
  assert.deepEqual(
    before.map(({ id, enabled }) => [id, enabled]),
    after.map(({ id, enabled }) => [id, enabled]),
    'Map smoke must preserve the application’s observed layer selection.',
  );
  return {
    schema: 'gev-map-smoke-layer-population/v1',
    scope:
      'Observed application layer enabled states and source counts; map smoke leaves defaults unchanged and does not assume all non-map layers are disabled.',
    before,
    after,
    enabledLayerIds: before
      .filter((layer) => layer.enabled)
      .map(({ id }) => id),
  };
}

export async function runNativeMapJourneyForSmoke({
  page,
  revision,
  fixture,
  buildProfile,
  mapStreamingCaptureModule,
}) {
  assertSha(revision, 'Map smoke revision');
  assert.ok(fixture && typeof fixture === 'object');
  assert.equal(fixture.id, 'austin-map-streaming-synthetic-v1');
  assert.match(fixture.manifestSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(
    typeof mapStreamingCaptureModule?.runNativeMapStreamingJourney,
    'function',
  );
  assert.equal(
    typeof mapStreamingCaptureModule?.validateMapStreamingJourneyEvidence,
    'function',
  );
  assert.ok(buildProfile && typeof buildProfile === 'object');
  assert.equal(buildProfile.id, MAP_FIXTURE_BUILD_PROFILE_ID);
  assert.match(buildProfile.configurationSha256 || '', /^[a-f0-9]{64}$/);
  const route = mapStreamingCaptureModule.MAP_STREAMING_ROUTE;
  assert.ok(route && Number.isSafeInteger(route.durationLimitMs));
  const journey = await mapStreamingCaptureModule.runNativeMapStreamingJourney(
    page,
    { durationMs: route.durationLimitMs, route },
  );
  mapStreamingCaptureModule.validateMapStreamingJourneyEvidence(
    journey,
    fixture,
  );
  return {
    schema: 'gev-map-streaming-native-smoke/v1',
    revision,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    buildProfile,
    routeId: route.id,
    performanceAcceptanceEligible: false,
    journey,
  };
}

export function validateMapSmokeInterceptionRelease(evidence, identity) {
  assert.equal(evidence?.schema, 'gev-map-smoke-interception-release/v1');
  assert.equal(evidence.documentRole, identity?.documentRole);
  assert.equal(evidence.documentId, identity?.documentId);
  assert.equal(evidence.contextCloseStatus, 'closed');
  assert.equal(evidence.targetClosed, true);
  const release = evidence.release;
  assert.equal(release?.schema, 'gev-fixture-interception-release/v1');
  assert.equal(release.fetchDisable, 'target-closed');
  assert.equal(release.detach, 'target-closed');
  const drain = release.interception;
  assert.equal(drain?.schema, 'gev-fixture-interception-drain/v1');
  assert.equal(drain.listenerRemovalConfirmed, true);
  for (const name of [
    'pendingAtStop',
    'pendingPreparationAtStop',
    'pendingAbortSubscriptionsAtStop',
    'pendingCommandsAtStop',
    'pendingCommandsAfterDrain',
    'pendingPreparationsAfterDrain',
    'pendingAbortSubscriptionsAfterDrain',
    'rejectedDrainOperations',
    'drainCommandFailures',
    'cancelledPreparationCount',
    'unexpectedLateRequestCount',
  ])
    assert.ok(Number.isSafeInteger(drain[name]) && drain[name] >= 0);
  for (const name of [
    'pendingCommandsAfterDrain',
    'pendingPreparationsAfterDrain',
    'pendingAbortSubscriptionsAfterDrain',
    'rejectedDrainOperations',
    'drainCommandFailures',
    'unexpectedLateRequestCount',
  ])
    assert.equal(
      drain[name],
      0,
      `Map smoke interception ${name} must be zero.`,
    );
  assert.equal(drain.confirmed, true);
  assert.equal(release.confirmed, true);
  assert.equal(evidence.confirmed, true);
  return true;
}

/** Close the owning target before stopping, draining, and releasing Fetch. */
export async function closeMapSmokeFixtureOwner({
  context,
  page,
  fixturePage,
  documentRole,
  documentId,
}) {
  let contextCloseStatus = 'closed';
  let contextCloseError = null;
  try {
    await withTimeout(context.close(), 5_000, 'Map smoke context cleanup');
  } catch (error) {
    contextCloseStatus = 'failed';
    contextCloseError = sanitizeError(error);
  }
  let targetClosed = false;
  try {
    targetClosed = page?.isClosed?.() === true;
  } catch {
    targetClosed = false;
  }
  let release = null;
  let releaseError = null;
  try {
    release = await fixturePage?.interception?.releaseSession?.({
      targetClosed,
    });
  } catch (error) {
    releaseError = sanitizeError(error);
  }
  return {
    schema: 'gev-map-smoke-interception-release/v1',
    documentRole,
    documentId,
    contextCloseStatus,
    ...(contextCloseError ? { contextCloseError } : {}),
    targetClosed,
    release,
    ...(releaseError ? { releaseError } : {}),
    confirmed:
      contextCloseStatus === 'closed' &&
      targetClosed &&
      release?.confirmed === true &&
      releaseError === null,
  };
}

/** Shared map-document finalization used by baseline and candidate runs. */
export async function finalizeMapSmokeFixtureDocument({
  context,
  page,
  fixturePage,
  delivery,
  fixture,
  captureModule,
  documentRole,
  documentId,
}) {
  const interceptionRelease = await closeMapSmokeFixtureOwner({
    context,
    page,
    fixturePage,
    documentRole,
    documentId,
  });
  const errors = [];
  try {
    validateMapSmokeInterceptionRelease(interceptionRelease, {
      documentRole,
      documentId,
    });
  } catch (error) {
    errors.push(sanitizeError(error));
  }

  let deliveryEvidence = null;
  if (delivery) {
    try {
      deliveryEvidence = delivery.dispose();
      if (deliveryEvidence.cleanupConfirmed !== true)
        errors.push('Map fixture delivery cleanup was not confirmed.');
      captureModule.validateMapStreamingSmokeDeliverySummary(
        deliveryEvidence,
        fixture,
      );
    } catch (error) {
      errors.push(sanitizeError(error));
    }
  }
  return {
    interceptionRelease,
    deliveryEvidence,
    errors,
    confirmed: errors.length === 0,
  };
}

function projectMapStreamingFailureDeliveryEvidence(summary, fixture) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary))
    return null;
  const expectedAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  assert.equal(summary.schema, 'gev-map-streaming-fixture-delivery/v1');
  assert.equal(summary.fixtureId, fixture.id);
  assert.equal(summary.manifestSha256, fixture.manifestSha256);
  assert.ok(['active', 'cancelled', 'disposed'].includes(summary.status));
  const countNames = [
    'requestedCount',
    'fulfilledAckCount',
    'cancelledCount',
    'pendingCount',
    'unexpectedFulfillmentCount',
    'errorObservationCount',
    'omittedErrorObservationCount',
    'omittedErrorKindCount',
  ];
  for (const name of countNames)
    assert.ok(
      Number.isSafeInteger(summary[name]) &&
        summary[name] >= 0 &&
        summary[name] <= 512,
    );
  assert.equal(
    summary.requestedCount,
    summary.fulfilledAckCount + summary.cancelledCount + summary.pendingCount,
  );
  assert.equal(typeof summary.cleanupConfirmed, 'boolean');
  assert.equal(summary.browserDecodeObserved, false);
  assert.equal(summary.renderedReadinessObserved, false);
  assert.ok(Array.isArray(summary.assets));
  assert.ok(summary.assets.length <= fixture.manifest.assets.length);
  const seen = new Set();
  let requests = 0;
  let acknowledgements = 0;
  let cancellations = 0;
  const assets = summary.assets.map((asset) => {
    const expected = expectedAssets.get(asset.path);
    assert.ok(expected);
    assert.equal(seen.has(asset.path), false);
    seen.add(asset.path);
    assert.equal(asset.sha256, expected.sha256);
    assert.equal(asset.byteLength, expected.byteLength);
    for (const name of ['requests', 'fulfilledAckCount', 'cancelledCount'])
      assert.ok(Number.isSafeInteger(asset[name]) && asset[name] >= 0);
    assert.ok(asset.requests <= 512);
    assert.ok(asset.fulfilledAckCount + asset.cancelledCount <= asset.requests);
    requests += asset.requests;
    acknowledgements += asset.fulfilledAckCount;
    cancellations += asset.cancelledCount;
    return {
      path: asset.path,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      requests: asset.requests,
      fulfilledAckCount: asset.fulfilledAckCount,
      cancelledCount: asset.cancelledCount,
      pendingCount:
        asset.requests - asset.fulfilledAckCount - asset.cancelledCount,
    };
  });
  assert.equal(requests, summary.requestedCount);
  assert.equal(acknowledgements, summary.fulfilledAckCount);
  assert.equal(cancellations, summary.cancelledCount);
  const errors = summary.errors;
  assert.ok(Array.isArray(errors) && errors.length <= 8);
  const projectedErrors = errors.map((entry) => {
    assert.ok(
      typeof entry.code === 'string' && /^[a-z0-9-]{1,80}$/.test(entry.code),
    );
    assert.ok(Number.isSafeInteger(entry.count) && entry.count > 0);
    return { code: entry.code, count: entry.count };
  });
  return {
    schema: summary.schema,
    fixtureId: summary.fixtureId,
    manifestSha256: summary.manifestSha256,
    status: summary.status,
    requestedCount: summary.requestedCount,
    fulfilledAckCount: summary.fulfilledAckCount,
    cancelledCount: summary.cancelledCount,
    pendingCount: summary.pendingCount,
    unexpectedFulfillmentCount: summary.unexpectedFulfillmentCount,
    errorObservationCount: summary.errorObservationCount,
    omittedErrorObservationCount: summary.omittedErrorObservationCount,
    omittedErrorKindCount: summary.omittedErrorKindCount,
    cleanupConfirmed: summary.cleanupConfirmed,
    errors: projectedErrors,
    assets,
    browserDecodeObserved: false,
    renderedReadinessObserved: false,
  };
}

/** Attach a bounded map delivery diagnostic without implying success. */
export function attachFinalizedMapStreamingFailureEvidence(
  failure,
  { fixture, deliveryEvidence, interceptionRelease },
) {
  assert.ok(failure && typeof failure === 'object');
  const diagnostics = failure.smokeDiagnostics || {};
  if (deliveryEvidence) {
    try {
      const delivery = projectMapStreamingFailureDeliveryEvidence(
        deliveryEvidence,
        fixture,
      );
      diagnostics.mapStreamingFixtureSetup = {
        fixtureId: fixture.id,
        manifestSha256: fixture.manifestSha256,
        delivery,
        comparisonEligible: false,
      };
    } catch {
      diagnostics.mapStreamingFixtureSetupStatus = 'invalid-finalized-evidence';
    }
  }
  if (interceptionRelease)
    diagnostics.mapStreamingInterceptionRelease = interceptionRelease;
  failure.smokeDiagnostics = diagnostics;
  return failure;
}

const SHA1 = /^[a-f0-9]{40}$/;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

let puppeteer = null;
let cleanupFixturePageDiagnostics = null;
let prepareFixturePage = null;

async function loadBrowserDependencies() {
  if (puppeteer && cleanupFixturePageDiagnostics && prepareFixturePage) return;
  const [puppeteerModule, fixtureModule] = await Promise.all([
    import('puppeteer'),
    import('./qa-application-fixtures.mjs'),
  ]);
  puppeteer = puppeteerModule.default;
  cleanupFixturePageDiagnostics = fixtureModule.cleanupFixturePageDiagnostics;
  prepareFixturePage = fixtureModule.prepareFixturePage;
}

const OPTION_KEYS = new Map([
  ['--candidate-sha', 'candidateSha'],
  ['--out', 'out'],
  ['--capture-worker-audit-mode', 'captureWorkerAuditMode'],
  ['--provider-fixture', 'providerFixture'],
  ['--capture-scene-frame-diagnostics', 'sceneFrameDiagnostics'],
  ['--capture-first-motion-cpu-profile', 'firstMotionCpuProfile'],
  ['--capture-depth-pick-attribution', 'depthPickAttribution'],
  ['--capture-shader-program-attribution', 'shaderProgramAttribution'],
  ['--capture-renderer-backend', 'captureRendererBackend'],
]);

const PROVIDER_CPU_PROFILE_TARGETS = Object.freeze([
  { scenario: 'idle', run: 1 },
  { scenario: 'idle', run: 2 },
  { scenario: 'scripted-motion', run: 1 },
]);
const WEATHER_EFFECTS_WORKLOAD_ID = 'austin-weather-effects-v1';

function providerCpuProfileKey(target) {
  return target.scenario === 'idle'
    ? `provider-idle-${target.run}`
    : `provider-scripted-motion-${target.run}`;
}

function sameProviderCpuProfileTarget(left, right) {
  const fields = [
    'scenario',
    'run',
    'captureOrdinal',
    'documentRole',
    'documentId',
  ];
  return (
    left !== null &&
    typeof left === 'object' &&
    !Array.isArray(left) &&
    right !== null &&
    typeof right === 'object' &&
    !Array.isArray(right) &&
    Object.keys(left).sort().join(',') === fields.slice().sort().join(',') &&
    Object.keys(right).sort().join(',') === fields.slice().sort().join(',') &&
    fields.every((field) => left[field] === right[field])
  );
}

function validateProviderCpuProfileWindow(window, target, sample) {
  assert.equal(window?.schema, 'gev-provider-sample-cpu-profile-window/v1');
  assert.equal(window?.targetScenario, target.scenario);
  assert.equal(window?.targetRun, target.run);
  assert.ok(Number.isSafeInteger(sample?.captureOrdinal));
  assert.ok(sample.captureOrdinal >= 0);
  assert.equal(window?.captureOrdinal, sample.captureOrdinal);
  assert.equal(window?.documentRole, sample.documentRole);
  assert.equal(window?.documentId, sample.documentId);
  assert.equal(window?.profilerStarted, true);
  assert.equal(window?.performanceAcceptanceEligible, false);
  assert.ok(['complete', 'incomplete'].includes(window?.status));
  const ref = window.profile;
  const key = providerCpuProfileKey(target);
  assert.equal(ref?.schema, 'gev-render-boundary-cpu-profile-ref/v1');
  assert.equal(ref?.performanceAcceptanceEligible, false);
  assert.equal(
    sameProviderCpuProfileTarget(ref?.target, {
      scenario: target.scenario,
      run: target.run,
      captureOrdinal: sample.captureOrdinal,
      documentRole: sample.documentRole,
      documentId: sample.documentId,
    }),
    true,
  );
  assert.equal(ref?.fileName, `${key}-cpu-profile.json`);
  assert.equal(ref?.performanceAcceptanceEligible, false);
  assert.ok(Array.isArray(ref?.profilerErrors));
  assert.equal(ref.profilerErrors.length, 0);
  assert.ok(Number.isFinite(ref?.profileWindowMs) && ref.profileWindowMs >= 0);
  assert.ok(Number.isFinite(ref?.stopOverrunMs) && ref.stopOverrunMs >= 0);
  assert.ok(ref.profileWindowMs <= 62_000);
  assert.ok(ref.stopOverrunMs <= 2_000);
  assert.equal(ref.stopOverrunMs, Math.max(0, ref.profileWindowMs - 60_000));
  assert.ok(
    (ref.status === 'complete' &&
      ref.windowCapReached === false &&
      ref.windowCapMs === null &&
      ref.stopOverrunMs === 0) ||
      (ref.status === 'incomplete' &&
        ((ref.windowCapReached === true && ref.windowCapMs === 60_000) ||
          (ref.windowCapReached === false &&
            ref.windowCapMs === null &&
            ref.stopOverrunMs > 0))),
  );
  assert.equal(window.status, ref.status);
  assert.equal(window.windowCapReached, ref.windowCapReached);
  assert.equal(window.windowCapMs, ref.windowCapMs);
  assert.equal(window.profileWindowMs, ref.profileWindowMs);
  assert.equal(window.stopOverrunMs, ref.stopOverrunMs);
  assert.match(ref.sha256 || '', /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isInteger(ref.byteLength) &&
      ref.byteLength > 0 &&
      ref.byteLength <= 8 * 1024 * 1024,
  );
}

export async function readProviderCpuProfileIndexSet(directory) {
  const profiles = [];
  let invalidIndexCount = 0;
  for (const target of PROVIDER_CPU_PROFILE_TARGETS) {
    const key = providerCpuProfileKey(target);
    const indexPath = path.join(directory, `${key}-cpu-profile-ref.json`);
    let bytes;
    try {
      bytes = await readFile(indexPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      invalidIndexCount += 1;
      continue;
    }
    try {
      if (bytes.byteLength > 16 * 1024) {
        invalidIndexCount += 1;
        continue;
      }
      const index = JSON.parse(bytes.toString('utf8'));
      if (
        index?.schema !== 'gev-provider-sample-cpu-profile-index/v1' ||
        index?.performanceAcceptanceEligible !== false ||
        index.target?.scenario !== target.scenario ||
        index.target?.run !== target.run ||
        !Number.isSafeInteger(index.target?.captureOrdinal) ||
        index.target.captureOrdinal < 0 ||
        typeof index.target?.documentRole !== 'string' ||
        index.target.documentRole.length < 1 ||
        index.target.documentRole.length > 80 ||
        typeof index.target?.documentId !== 'string' ||
        index.target.documentId.length < 1 ||
        index.target.documentId.length > 160 ||
        index.profile?.schema !== 'gev-render-boundary-cpu-profile-ref/v1' ||
        index.profile?.performanceAcceptanceEligible !== false ||
        !['complete', 'incomplete'].includes(index.profile?.status) ||
        !Array.isArray(index.profile?.profilerErrors) ||
        index.profile.profilerErrors.length !== 0 ||
        !sameProviderCpuProfileTarget(index.profile?.target, index.target) ||
        index.profile?.fileName !== `${key}-cpu-profile.json` ||
        !/^[a-f0-9]{64}$/.test(index.profile?.sha256 || '') ||
        !Number.isSafeInteger(index.profile?.byteLength) ||
        index.profile.byteLength < 1 ||
        index.profile.byteLength > 8 * 1024 * 1024
      ) {
        invalidIndexCount += 1;
        continue;
      }
      const profileBytes = await readFile(
        path.join(directory, index.profile.fileName),
      );
      if (
        profileBytes.byteLength !== index.profile.byteLength ||
        profileBytes.byteLength > 8 * 1024 * 1024 ||
        createHash('sha256').update(profileBytes).digest('hex') !==
          index.profile.sha256
      ) {
        invalidIndexCount += 1;
        continue;
      }
      profiles.push({ ...index, artifactVerified: true });
    } catch {
      invalidIndexCount += 1;
    }
  }
  return {
    schema: 'gev-provider-sample-cpu-profile-index-set/v1',
    performanceAcceptanceEligible: false,
    expectedTargets: PROVIDER_CPU_PROFILE_TARGETS,
    status:
      profiles.length === PROVIDER_CPU_PROFILE_TARGETS.length &&
      invalidIndexCount === 0
        ? 'all-targets-recorded'
        : 'partial',
    invalidIndexCount,
    profiles,
  };
}

export function parseSmokeArguments(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = OPTION_KEYS.get(flag);
    if (!key) throw new TypeError(`Unknown option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError(`Missing value for ${flag}`);
    if (
      flag === '--capture-worker-audit-mode' &&
      !['diagnostic', 'prewarm', 'receipt-only'].includes(value)
    )
      throw new TypeError('Worker audit mode is invalid.');
    if (
      flag === '--capture-renderer-backend' &&
      !['swiftshader', 'macos-native-diagnostic'].includes(value)
    )
      throw new TypeError('Capture renderer backend is invalid.');
    if (
      flag === '--provider-fixture' &&
      value !== 'dense-investigation' &&
      !INFRASTRUCTURE_WORKLOAD_IDS.includes(value) &&
      value !== WEATHER_EFFECTS_WORKLOAD_ID &&
      value !== AUSTIN_OPERATING_WORKLOAD_ID &&
      value !== MAP_STREAMING_WORKLOAD_ID
    )
      throw new TypeError('Provider fixture must be a registered workload.');
    if (
      flag === '--capture-scene-frame-diagnostics' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'Scene frame diagnostics must be enabled or disabled.',
      );
    if (
      flag === '--capture-first-motion-cpu-profile' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'First-motion CPU profile must be enabled or disabled.',
      );
    if (
      flag === '--capture-depth-pick-attribution' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'Depth-pick attribution must be enabled or disabled.',
      );
    if (
      flag === '--capture-shader-program-attribution' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'Shader program attribution must be enabled or disabled.',
      );
    output[key] = value;
  }
  if (
    output.providerFixture?.startsWith('infrastructure') &&
    output.captureWorkerAuditMode &&
    output.captureWorkerAuditMode !== 'diagnostic'
  )
    throw new TypeError(
      'Infrastructure provider fixtures support diagnostic worker auditing only.',
    );
  if (
    output.captureWorkerAuditMode === 'receipt-only' &&
    output.providerFixture !== AUSTIN_OPERATING_WORKLOAD_ID
  )
    throw new TypeError(
      'Receipt-only worker auditing requires the Austin operating fixture.',
    );
  if (
    output.sceneFrameDiagnostics === 'enabled' &&
    output.providerFixture &&
    output.providerFixture !== 'dense-investigation' &&
    output.providerFixture !== AUSTIN_OPERATING_WORKLOAD_ID
  )
    throw new TypeError(
      'Scene frame diagnostics require the dense investigation or Austin operating fixture.',
    );
  if (
    output.depthPickAttribution === 'enabled' &&
    output.providerFixture &&
    output.providerFixture !== 'dense-investigation'
  )
    throw new TypeError(
      'Depth-pick attribution requires the dense investigation fixture.',
    );
  if (
    output.shaderProgramAttribution === 'enabled' &&
    output.providerFixture !== 'dense-investigation'
  )
    throw new TypeError(
      'Shader program attribution requires the dense investigation fixture.',
    );
  if (output.sceneFrameDiagnostics)
    output.sceneFrameDiagnostics = output.sceneFrameDiagnostics === 'enabled';
  if (output.firstMotionCpuProfile)
    output.firstMotionCpuProfile = output.firstMotionCpuProfile === 'enabled';
  if (output.depthPickAttribution)
    output.depthPickAttribution = output.depthPickAttribution === 'enabled';
  if (output.shaderProgramAttribution)
    output.shaderProgramAttribution =
      output.shaderProgramAttribution === 'enabled';
  if (
    output.firstMotionCpuProfile &&
    output.providerFixture &&
    output.providerFixture !== 'dense-investigation'
  )
    throw new TypeError(
      'First-motion CPU profiling requires the dense investigation fixture.',
    );
  return output;
}

/** Run an owned CLI process with bounded output and process-tree cleanup. */
export function runBoundedChild(
  command,
  args,
  { timeoutMs, maxOutputBytes = 64 * 1024, ownedPidFile = null } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError('Child timeout must be a positive integer.');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024)
    throw new TypeError('Child output bound must be at least 1024 bytes.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = { stdout: [], stderr: [] };
    const outputChunks = [];
    let capturedBytes = 0;
    let stopReason = null;
    let stopTimer = null;
    let finalTimer = null;
    let timeoutTimer = null;
    let settled = false;
    let ownedBrowserPid = null;

    const rememberOwnedBrowserPid = () => {
      if (!ownedPidFile) return;
      try {
        const value = Number(readFileSync(ownedPidFile, 'utf8').trim());
        if (Number.isSafeInteger(value) && value > 0) ownedBrowserPid = value;
      } catch {
        // The CLI may not have launched Chromium yet, or may have cleaned up.
      }
    };
    const terminatePid = (pid, signal) => {
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      if (process.platform === 'win32') {
        const result = spawnSync(
          'taskkill',
          ['/PID', String(pid), '/T', '/F'],
          {
            encoding: 'utf8',
            stdio: 'ignore',
            timeout: 1500,
            windowsHide: true,
          },
        );
        if (result.error) return false;
        return result.status === 0;
      }
      try {
        process.kill(pid, signal);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return true;
        return false;
      }
    };

    const signalOwnedTree = (signal) => {
      if (!child.pid) return;
      rememberOwnedBrowserPid();
      if (process.platform === 'win32') {
        terminatePid(child.pid, signal);
      } else {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      if (ownedBrowserPid && ownedBrowserPid !== child.pid) {
        if (process.platform === 'win32') {
          terminatePid(ownedBrowserPid, signal);
        } else {
          try {
            process.kill(-ownedBrowserPid, signal);
          } catch (error) {
            if (error.code === 'ESRCH') terminatePid(ownedBrowserPid, signal);
            else throw error;
          }
        }
      }
    };
    const isProcessPresent = (pid, group) => {
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      if (process.platform === 'win32') {
        const result = spawnSync(
          'tasklist',
          ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1000,
            windowsHide: true,
          },
        );
        if (result.error || result.status !== 0) return null;
        return result.stdout.includes(`"${pid}"`);
      }
      try {
        process.kill(group ? -pid : pid, 0);
        return true;
      } catch (error) {
        return error.code === 'ESRCH' ? false : null;
      }
    };
    const waitForProcessExit = async (pid, group) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const present = isProcessPresent(pid, group);
        if (present === false) return true;
        if (present === null) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    const cleanupTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(stopTimer);
      clearTimeout(finalTimer);
    };
    const childDiagnostics = () => {
      const allOutputLines = Buffer.concat(outputChunks)
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean);
      const progress = allOutputLines.filter((line) =>
        line.includes('[performance]'),
      );
      return {
        stderrLines: Buffer.concat(chunks.stderr)
          .toString('utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 4)
          .map((line) => sanitizeError(line).slice(0, 200)),
        progressLines: (progress.length ? progress : allOutputLines)
          .slice(-4)
          .map((line) =>
            sanitizeError(line.replace(/(\d+)\/(\d+)/g, '$1 of $2')).slice(
              0,
              200,
            ),
          ),
      };
    };
    const rejectAfterStop = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      try {
        signalOwnedTree('SIGTERM');
      } catch {
        // The child may have exited between the event and signal.
      }
      stopTimer = setTimeout(() => {
        try {
          signalOwnedTree('SIGKILL');
        } catch {
          // The child tree may already be gone.
        }
        finalTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.stdin?.destroy();
          child.unref();
          const error = new Error(
            `Child process ${stopReason}; cleanup unconfirmed; pipes released.`,
          );
          error.childDiagnostics = childDiagnostics();
          reject(error);
        }, 2000);
      }, 5000);
    };
    const append = (stream, chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= maxOutputBytes) {
        chunks[stream].push(chunk);
        outputChunks.push(chunk);
      } else rejectAfterStop('output limit exceeded');
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(
        new Error(`Child process could not start: ${sanitizeError(error)}`),
      );
    });
    child.once('close', async (code, signal) => {
      if (settled) return;
      rememberOwnedBrowserPid();
      if (stopReason || code !== 0 || ownedBrowserPid) {
        try {
          signalOwnedTree('SIGKILL');
        } catch {
          // The owned process group may already have exited.
        }
      }
      cleanupTimers();
      const output = {
        code,
        signal,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      };
      if (stopReason || code !== 0 || ownedBrowserPid) {
        const ownedTargets = [
          ...(process.platform !== 'win32'
            ? [{ pid: child.pid, group: true }]
            : [{ pid: child.pid, group: false }]),
          ...(ownedBrowserPid ? [{ pid: ownedBrowserPid, group: true }] : []),
        ];
        let cleanupConfirmed = true;
        for (const target of ownedTargets) {
          if (!(await waitForProcessExit(target.pid, target.group)))
            cleanupConfirmed = false;
        }
        settled = true;
        const diagnostics = childDiagnostics();
        const detail = diagnostics.stderrLines.join(' ').slice(0, 500);
        const error = new Error(
          `Child process ${stopReason || `exited ${code}`}; ${detail || diagnostics.progressLines.join(' | ') || 'no child diagnostics'}; cleanup ${cleanupConfirmed ? 'confirmed' : 'unconfirmed'} (${signal || code}).`,
        );
        error.childDiagnostics = diagnostics;
        reject(error);
      } else {
        settled = true;
        resolve(output);
      }
    });
    timeoutTimer = setTimeout(() => rejectAfterStop('timed out'), timeoutMs);
  });
}

function assertCaptureFrameAndSettingsEvidence(sample, scenario) {
  assert.ok(
    Number.isInteger(sample.frameCount) && sample.frameCount >= 0,
    `${scenario} run ${sample.run}: frame count is missing or invalid.`,
  );
  assert.ok(
    Number.isInteger(sample.renderedFrameCount) &&
      sample.renderedFrameCount >= 0,
    `${scenario} run ${sample.run}: rendered-frame count is missing or invalid.`,
  );
  assert.equal(
    sample.frameCount,
    Math.max(0, sample.renderedFrameCount - 1),
    `${scenario} run ${sample.run}: rendered-frame and interval counts disagree.`,
  );
  const frameIntervals = sample.frameIntervalMs;
  assert.ok(
    Number.isInteger(frameIntervals?.samples) &&
      frameIntervals.samples === sample.frameCount,
    `${scenario} run ${sample.run}: frame interval samples do not match rendered-frame intervals.`,
  );
  if (scenario === 'idle') {
    if (sample.frameCount === 0)
      assert.equal(
        frameIntervals.p95,
        null,
        `idle run ${sample.run}: zero-frame timing must remain unavailable.`,
      );
    else
      assert.ok(
        Number.isFinite(frameIntervals.p95) && frameIntervals.p95 > 0,
        `idle run ${sample.run}: frame interval p95 is missing or invalid.`,
      );
  } else {
    assert.ok(
      sample.renderedFrameCount >= 2,
      `${scenario} run ${sample.run}: expected at least two rendered frames.`,
    );
    assert.ok(
      Number.isFinite(frameIntervals.p95) && frameIntervals.p95 > 0,
      `${scenario} run ${sample.run}: frame interval p95 is missing or invalid.`,
    );
  }
  assert.equal(sample.settings?.before?.qualityMode, 'manual');
  assert.equal(sample.settings?.before?.densityPct, 75);
  assert.equal(sample.settings?.before?.detectionMode, 'DENSE');
  assert.equal(sample.settings?.after?.qualityMode, 'manual');
  assert.equal(sample.settings?.after?.densityPct, 75);
  assert.equal(sample.settings?.after?.detectionMode, 'DENSE');
}

export function assertProviderFixtureCaptureClock(
  clock,
  { fixedTime, warmupMs, measurementMs },
) {
  assert.equal(clock?.schema, 'gev-provider-fixture-capture-clock/v1');
  assert.equal(clock.fixedTime, fixedTime);
  const epoch = Date.parse(fixedTime);
  assert.ok(Number.isFinite(epoch), 'Fixture clock epoch is unavailable.');
  assert.equal(clock.freshBrowserContext, true);
  assert.equal(clock.appDocumentReinitialized, true);
  // The producer records a held warmup boundary, then starts measurement.
  // It no longer emits the old single-phase `start` observation.
  const start = clock.measurementStart;
  const end = clock.end;
  assert.equal(start?.schema, 'gev-phased-monotonic-wall-clock/v1');
  assert.equal(end?.schema, 'gev-phased-monotonic-wall-clock/v1');
  assert.equal(start.phase, 'warmup-held');
  assert.equal(end.phase, 'complete');
  assert.equal(start.startCount, 1);
  assert.equal(end.startCount, 1);
  assert.equal(start.measurementStartCount, 0);
  assert.equal(end.measurementStartCount, 1);
  assert.deepEqual(clock.warmupBoundary, start);
  for (const observation of [start, end]) {
    assert.equal(observation.warmupMs, warmupMs);
    assert.equal(observation.measurementMs, measurementMs);
  }
  assert.equal(start.elapsedMs, warmupMs);
  assert.equal(start.epochMs, epoch + warmupMs);
  assert.equal(end.elapsedMs, warmupMs + measurementMs);
  assert.equal(end.epochMs, epoch + warmupMs + measurementMs);
  assert.equal(clock.ageAtMeasurementStartMs, warmupMs);
  assert.equal(clock.ageAtEndMs, warmupMs + measurementMs);
  assert.equal(clock.configuredMeasurementMs, measurementMs);
  assert.equal(clock.measurementClockElapsedMs, measurementMs);
  assert.equal(clock.actualWarmupElapsedMs, start.warmupNativeElapsedMs);
  assert.equal(end.warmupNativeElapsedMs, start.warmupNativeElapsedMs);
  assert.equal(start.measurementNativeElapsedMs, null);
  assert.equal(clock.measuredWindowElapsedMs, end.measurementNativeElapsedMs);
  assert.equal(
    clock.measurementPhaseNativeElapsedMs,
    end.measurementNativeElapsedMs,
  );
  assert.ok(
    Number.isFinite(clock.actualWarmupElapsedMs) &&
      clock.actualWarmupElapsedMs >= warmupMs,
  );
  assert.ok(
    Number.isFinite(clock.measuredWindowElapsedMs) &&
      clock.measuredWindowElapsedMs >= measurementMs,
  );
  assert.equal(clock.sourceFreshness, 'current');
  assert.equal(clock.freshnessWindowMs, 120_000);
  assert.ok(clock.ageAtEndMs <= clock.freshnessWindowMs);
}

function validateMapStreamingCaptureCliReport(report, expected) {
  const fixture = expected.mapStreamingFixture;
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  assert.equal(report.workerAuditMode, 'diagnostic');
  assert.equal(report.comparisonEligible, false);
  assert.equal(
    report.environment?.hardwareEligible,
    false,
    'Map fixture capture is ineligible for hardware performance acceptance.',
  );
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND) {
    assert.ok(
      report.comparisonReadiness?.reasons?.includes(
        'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
      ),
      'Native map rendering remains comparison-ineligible.',
    );
    assert.ok(report.environment?.renderer);
  } else {
    assert.match(
      report.environment?.renderer || '',
      /swiftshader/i,
      'Default map smoke must preserve the software-renderer contract.',
    );
  }
  assert.equal(
    report.source?.appCommit,
    expected.appSha,
    'Capture report app commit must match the exact verified build.',
  );
  assert.equal(
    report.source?.harnessCommit,
    expected.harnessSha,
    'Capture report harness commit must match the exact harness.',
  );
  assert.equal(
    report.source?.appWorktreeState,
    'clean',
    'Map capture app checkout must be the verified clean build source.',
  );
  assert.equal(
    report.source?.harnessDirtyWorktree,
    false,
    'Map capture harness checkout must be clean.',
  );
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
    'Map capture requires verified local build and served-asset provenance.',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
    'Capture report must retain the verified build receipt identity.',
  );
  const pageAssetAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAssetAudit?.workerAuditMode, 'diagnostic');
  assert.ok(
    Number.isSafeInteger(pageAssetAudit?.scriptRequestCount) &&
      pageAssetAudit.scriptRequestCount > 0,
    'Map capture requires observed receipted script requests.',
  );
  assert.ok(pageAssetAudit?.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAssetAudit?.unexpectedAssetPaths, []);
  assert.deepEqual(
    report.integrity,
    {
      status: 'passed',
      sampleCount: report.captures?.length,
    },
    'Map capture integrity must pass for every reported sample.',
  );
  assert.equal(report.workload?.providerFixture, MAP_STREAMING_WORKLOAD_ID);
  assert.equal(report.workload?.fixtureId, fixture?.id);
  assert.deepEqual(report.workload?.fixture, {
    id: fixture?.id,
    sha256: fixture?.manifestSha256,
    byteLength: fixture?.manifest?.totalBytes,
  });
  assert.equal(report.workload?.performanceAcceptanceEligible, false);
  assert.equal(report.workload?.warmupMs, expected.warmupMs);
  assert.equal(
    report.workload?.durationPerSampleMs,
    expected.durationPerSampleMs,
  );
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.deepEqual(report.workload?.scenarios, ['idle', 'scripted-motion']);
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.ok(
    report.comparisonReadiness?.reasons?.includes(
      'map-streaming-fixture-is-a-diagnostic-not-performance-acceptance',
    ),
  );
  assert.equal(typeof expected.validateMapStreamingCapture, 'function');
  assert.equal(report.captures?.length, 4);
  const topology = createCaptureDocumentTopology({
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures.length,
  });
  const sampleKeys = new Set();
  for (const sample of report.captures) {
    assert.ok(['idle', 'scripted-motion'].includes(sample.scenario));
    assert.ok([1, 2].includes(sample.run));
    const key = `${sample.scenario}:${sample.run}`;
    assert.equal(sampleKeys.has(key), false, `Duplicate map sample ${key}.`);
    sampleKeys.add(key);
  }
  assert.deepEqual([...sampleKeys].sort(), [
    'idle:1',
    'idle:2',
    'scripted-motion:1',
    'scripted-motion:2',
  ]);
  assertCaptureCleanupEvidence(report.workload, topology, {
    captures: report.captures,
  });

  const mapCapture = report.workload?.mapStreamingCapture;
  assert.equal(
    mapCapture?.schema,
    'gev-map-streaming-capture/v1',
    'Finalized map capture report is required.',
  );
  assert.equal(mapCapture?.workloadId, MAP_STREAMING_WORKLOAD_ID);
  assert.equal(mapCapture?.status, 'observed');
  assert.equal(mapCapture?.performanceAcceptanceEligible, false);
  assert.equal(mapCapture?.fixtureId, fixture?.id);
  assert.equal(mapCapture?.manifestSha256, fixture?.manifestSha256);
  assert.deepEqual(
    mapCapture?.buildProfile,
    expected.mapStreamingBuildProfile,
    'Map capture build profile must match the receipted profile.',
  );
  expected.validateMapStreamingCapture(mapCapture);
  assert.deepEqual(
    report.workload?.mapStreamingFixtureDocuments,
    mapCapture.documentDeliveries,
    'Outer map document inventory must match the validated native capture.',
  );
  const mapReleases = mapCapture.documentDeliveries.map(
    (entry) => entry.release,
  );
  const outerReleases = report.workload.fixtureInterceptionReleases;
  assert.ok(Array.isArray(outerReleases));
  const releaseByIdentity = (rows) =>
    rows
      .map((row) => ({
        identity: `${row.documentRole}\0${row.documentId}`,
        row,
      }))
      .sort((left, right) => left.identity.localeCompare(right.identity));
  assert.deepEqual(
    releaseByIdentity(outerReleases),
    releaseByIdentity(mapReleases),
    'Fixture session releases must exactly match the native map owners.',
  );
  assert.deepEqual(
    report.fixtureDelivery,
    mapCapture.fixtureDelivery,
    'Outer delivery summary must bind to the validated native map report.',
  );
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
  };
}

export function validateCaptureCliReport(report, expected) {
  validateRendererBackendEvidence(report, expected.captureRendererBackend);
  const nativeRendererReason =
    'hosted-native-renderer-diagnostic-is-ineligible-for-comparison';
  const readinessReasons = report?.comparisonReadiness?.reasons;
  assert.ok(Array.isArray(readinessReasons));
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND) {
    assert.ok(readinessReasons.includes(nativeRendererReason));
    assert.equal(report.comparisonEligible, false);
    assert.equal(report.environment?.hardwareEligible, false);
  } else assert.equal(readinessReasons.includes(nativeRendererReason), false);
  if (expected.providerFixture === AUSTIN_OPERATING_WORKLOAD_ID)
    return validateAustinOperatingCaptureCliReport(report, expected);
  if (expected.providerFixture === WEATHER_EFFECTS_WORKLOAD_ID)
    return validateWeatherEffectsCaptureCliReport(report, expected);
  if (expected.providerFixture === MAP_STREAMING_WORKLOAD_ID) {
    return validateMapStreamingCaptureCliReport(report, expected);
  }
  if (expected.providerFixture?.startsWith('infrastructure'))
    return validateInfrastructureCaptureCliReport(report, expected);
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  const workerAuditMode = expected.workerAuditMode || 'diagnostic';
  assert.equal(report.workerAuditMode, workerAuditMode);
  assert.equal(report.comparisonEligible, false);
  if (expected.firstMotionCpuProfile) {
    const profileEvidence = report.providerSampleCpuProfiles;
    const targets = PROVIDER_CPU_PROFILE_TARGETS;
    assert.equal(profileEvidence?.enabled, true);
    assert.deepEqual(profileEvidence?.targets, targets);
    assert.equal(profileEvidence?.performanceAcceptanceEligible, false);
    assert.equal(
      profileEvidence?.scope,
      'first two idle samples and first scripted-motion sample, each from immediately before warmup through its measurement-boundary completion or failure; sampled main-thread stacks include idle and garbage collection, and are not precise CPU execution or GPU timing',
    );
    assert.ok(['complete', 'incomplete'].includes(profileEvidence?.status));
    assert.equal(profileEvidence?.profiles?.length, targets.length);
    const samples = new Map(
      (report.captures || []).map((sample) => [
        `${sample.scenario}:${sample.run}`,
        sample,
      ]),
    );
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const window = profileEvidence.profiles[index];
      const sample = samples.get(`${target.scenario}:${target.run}`);
      assert.ok(sample, 'profile target capture sample is missing');
      assert.equal(
        sample.captureOrdinal,
        report.captures.indexOf(sample),
        'sample capture ordinal must match its position in the actual capture sequence',
      );
      validateProviderCpuProfileWindow(window, target, sample);
      assert.deepEqual(sample.providerSampleCpuProfile, window);
    }
    assert.equal(
      profileEvidence.status,
      profileEvidence.profiles.every((window) => window.status === 'complete')
        ? 'complete'
        : 'incomplete',
    );
    assert.equal(
      report.comparisonReadiness?.reasons?.includes(
        'provider-sample-cpu-profile-instrumentation-is-enabled',
      ),
      true,
    );
  } else assert.equal(report.providerSampleCpuProfiles, undefined);
  if (expected.depthPickAttribution) {
    assert.equal(report.workload?.performanceAcceptanceEligible, false);
    assert.equal(
      validateDepthPickAttributionEnvelope(
        report.workload?.depthPickAttribution,
        report.captures,
      ),
      true,
    );
  } else assert.equal(report.workload?.depthPickAttribution, undefined);
  if (expected.shaderProgramAttribution) {
    const envelope = report.workload?.shaderProgramAttribution;
    assert.equal(report.workload?.performanceAcceptanceEligible, false);
    assert.equal(envelope?.enabled, true);
    assert.equal(envelope?.schema, 'gev-shader-program-attribution/v1');
    assert.equal(envelope?.status, 'complete');
    assert.equal(envelope?.performanceAcceptanceEligible, false);
    assert.equal(
      envelope?.scope,
      'whole owned dense-investigation document lifetime from Cesium WebGL context acquisition through the existing document cleanup callback; it is not isolated to warmup or measurement and is not GPU execution time',
    );
  } else assert.equal(report.workload?.shaderProgramAttribution, undefined);
  if (expected.sceneFrameDiagnostics) {
    assert.deepEqual(report.sceneFrameDiagnostics, {
      status: 'completed',
      targetScenario: 'scripted-motion',
      targetRun: 1,
      eligibleForComparison: false,
    });
    assert.equal(report.sceneFrameDiagnostics?.status, 'completed');
    assert.equal(report.sceneFrameDiagnostics?.eligibleForComparison, false);
    assert.equal(
      report.comparisonReadiness?.reasons?.includes(
        'scene-frame-attribution-instrumentation-is-enabled',
      ),
      true,
    );
    const targets = report.captures?.filter(
      (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
    );
    assert.equal(targets?.length, 1);
    const target = targets[0];
    const evidence = target?.sceneFrameAttribution;
    assert.ok(
      evidence && typeof evidence === 'object' && !Array.isArray(evidence),
    );
    assert.ok(
      Object.keys(evidence).every((key) =>
        [
          'schema',
          'status',
          'scope',
          'eligibleForComparison',
          'observerOriginPerformanceNowMs',
          'measurementWindowRelativeMs',
          'observation',
          'cleanup',
          'stopReason',
          'error',
        ].includes(key),
      ),
    );
    assert.equal(evidence.schema, 'gev-scene-frame-attribution/v1');
    assert.equal(evidence?.status, 'completed');
    assert.equal(evidence?.cleanup, 'confirmed');
    assert.equal(evidence?.eligibleForComparison, false);
    assert.ok(Number.isFinite(evidence?.observerOriginPerformanceNowMs));
    assert.ok(
      Number.isFinite(evidence?.measurementWindowRelativeMs?.startMs) &&
        Number.isFinite(evidence?.measurementWindowRelativeMs?.timerFiredMs) &&
        evidence.measurementWindowRelativeMs.timerFiredMs >=
          evidence.measurementWindowRelativeMs.startMs &&
        evidence.measurementWindowRelativeMs.timerFiredMs <=
          evidence.observation?.elapsedMs,
    );
    assert.deepEqual(Object.keys(evidence.measurementWindowRelativeMs).sort(), [
      'startMs',
      'timerFiredMs',
    ]);
    const observation = evidence.observation;
    assert.ok(
      observation &&
        Number.isFinite(observation.elapsedMs) &&
        observation.elapsedMs >= 0 &&
        observation.elapsedMs <= 120_000,
    );
    assert.deepEqual(Object.keys(observation.spans || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation).sort(), [
      'cleanupComplete',
      'cleanupErrors',
      'counts',
      'elapsedMs',
      'entries',
      'observerErrors',
      'originPerformanceNowMs',
      'overflow',
      'sceneEventAvailability',
      'scope',
      'spans',
    ]);
    assert.ok(
      Number.isFinite(observation.originPerformanceNowMs) &&
        observation.originPerformanceNowMs ===
          evidence.observerOriginPerformanceNowMs,
    );
    assert.equal(observation.sceneEventAvailability?.update, true);
    assert.equal(observation.sceneEventAvailability?.render, true);
    assert.ok(
      Array.isArray(observation.cleanupErrors) &&
        observation.cleanupErrors.length === 0,
    );
    assert.equal(observation.cleanupComplete, true);
    assert.deepEqual(Object.keys(observation.counts || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation.overflow || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation.entries || {}).sort(), [
      'long-animation-frame',
      'longtask',
    ]);
    for (const kind of ['update', 'render']) {
      assert.ok(Array.isArray(observation.spans[kind]));
      assert.ok(observation.spans[kind].length <= 32);
      for (const span of observation.spans[kind]) {
        assert.deepEqual(Object.keys(span).sort(), ['durationMs', 'startMs']);
        assert.ok(Number.isFinite(span.startMs) && span.startMs >= 0);
        assert.ok(
          Number.isFinite(span.durationMs) &&
            span.durationMs >= 0 &&
            span.durationMs <= observation.elapsedMs,
        );
        assert.ok(span.startMs <= observation.elapsedMs);
      }
    }
    for (const kind of ['update', 'render']) {
      assert.ok(
        Number.isInteger(observation.counts?.[kind]) &&
          observation.counts[kind] >= observation.spans[kind].length &&
          observation.counts[kind] <= 1_000_000,
      );
      assert.equal(typeof observation.overflow?.[kind], 'boolean');
      if (observation.counts[kind] > 32)
        assert.equal(observation.overflow[kind], true);
    }
    assert.ok(Array.isArray(observation.observerErrors));
    assert.ok(observation.observerErrors.length <= 3);
    assert.ok(
      observation.observerErrors.every((type) =>
        ['longtask', 'long-animation-frame'].includes(type),
      ),
    );
    for (const key of ['longtask', 'long-animation-frame']) {
      const entries = observation.entries?.[key];
      assert.ok(
        entries === null || (Array.isArray(entries) && entries.length <= 32),
      );
      if (entries === null) continue;
      for (const entry of entries) {
        assert.deepEqual(
          Object.keys(entry).sort(),
          key === 'longtask'
            ? ['durationMs', 'startMs']
            : [
                'blockingDuration',
                'durationMs',
                'renderStart',
                'scripts',
                'startMs',
                'styleAndLayoutStart',
              ],
        );
        assert.ok(Number.isFinite(entry.startMs) && entry.startMs >= 0);
        assert.ok(
          Number.isFinite(entry.durationMs) &&
            entry.durationMs >= 0 &&
            entry.startMs + entry.durationMs <= observation.elapsedMs + 1,
        );
        if (key === 'long-animation-frame') {
          for (const metric of [
            'blockingDuration',
            'renderStart',
            'styleAndLayoutStart',
          ])
            assert.ok(
              entry[metric] === null ||
                (Number.isFinite(entry[metric]) && entry[metric] >= 0),
            );
          assert.ok(Array.isArray(entry.scripts) && entry.scripts.length <= 8);
          for (const script of entry.scripts) {
            assert.deepEqual(Object.keys(script).sort(), [
              'durationMs',
              'forcedStyleAndLayoutDurationMs',
              'invokerType',
            ]);
            assert.ok(
              script.durationMs === null ||
                (Number.isFinite(script.durationMs) &&
                  script.durationMs >= 0 &&
                  script.durationMs <= entry.durationMs),
            );
            assert.ok(
              [
                'classic-script',
                'module-script',
                'event-listener',
                'user-callback',
                'resolve-promise',
                'reject-promise',
                'unknown',
              ].includes(script.invokerType),
            );
            assert.ok(
              script.forcedStyleAndLayoutDurationMs === null ||
                (Number.isFinite(script.forcedStyleAndLayoutDurationMs) &&
                  script.forcedStyleAndLayoutDurationMs >= 0 &&
                  script.forcedStyleAndLayoutDurationMs <= entry.durationMs),
            );
          }
        }
      }
    }
    assert.equal(JSON.stringify(evidence).includes('sourceURL'), false);
  } else {
    assert.equal(report.sceneFrameDiagnostics, undefined);
  }
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 6 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  const pageAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAudit?.workerAuditMode, workerAuditMode);
  assert.ok(
    Number.isInteger(pageAudit?.scriptRequestCount) &&
      pageAudit.scriptRequestCount > 0,
  );
  assert.ok(pageAudit.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAudit.unexpectedAssetPaths, []);
  for (const workerAudit of pageAudit.cesiumWorkerBlobAudits || [])
    assert.equal(workerAudit.status, 'receipt-derived-worker-blobs-validated');
  assert.ok(pageAudit.cesiumWorkerBlobAudits?.length >= 6);
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.equal(report.environment?.startup?.runCount, 1);
  assert.equal(
    report.environment?.startup?.measurement,
    'cache-disabled fresh browser contexts',
  );
  assert.deepEqual(report.workload?.scenarios, [
    'idle',
    'scripted-motion',
    'selected-aircraft-tracking',
  ]);
  const diagnosticDocuments = report.performanceDiagnostics?.documents;
  const expectedDiagnosticCount =
    report.workload.startupRuns + 1 + report.captures.length;
  assert.ok(Array.isArray(diagnosticDocuments));
  assert.equal(diagnosticDocuments.length, expectedDiagnosticCount);
  const expectedRoles = [
    ...Array.from(
      { length: report.workload.startupRuns },
      (_, index) => `startup-${index + 1}`,
    ),
    'main-setup',
    ...Array.from(
      { length: report.captures.length },
      (_, index) => `provider-sample-${index + 1}`,
    ),
  ].sort();
  assert.deepEqual(
    diagnosticDocuments.map((entry) => entry.documentRole).sort(),
    expectedRoles,
  );
  if (expected.shaderProgramAttribution) {
    const envelope = report.workload.shaderProgramAttribution;
    assert.equal(envelope.expectedDocumentCount, expectedDiagnosticCount);
    assert.equal(envelope.documents.length, expectedDiagnosticCount);
    const cleanupRows = report.workload.rendererProbeCleanup;
    assert.ok(Array.isArray(cleanupRows));
    assert.equal(cleanupRows.length, expectedDiagnosticCount);
    assert.equal(report.workload.rendererProbeCleanupOmittedCount, 0);
    const diagnosticIdentities = diagnosticDocuments.map((entry) => {
      assert.equal(typeof entry.documentRole, 'string');
      assert.equal(typeof entry.documentId, 'string');
      assert.ok(entry.documentId.length > 0);
      return `${entry.documentRole}\u0000${entry.documentId}`;
    });
    assert.equal(new Set(diagnosticIdentities).size, expectedDiagnosticCount);
    const cleanupByIdentity = new Map();
    for (const entry of cleanupRows) {
      const identity = `${entry.documentRole}\u0000${entry.documentId}`;
      assert.equal(cleanupByIdentity.has(identity), false);
      cleanupByIdentity.set(identity, entry);
      assert.equal(entry.confirmed, true);
      const observer = entry.document?.shaderProgramAttribution;
      assert.ok(
        observer,
        `Missing shader attribution for ${entry.documentRole}.`,
      );
      assert.deepEqual(
        observer,
        boundedShaderProgramAttribution(observer),
        'shader attribution must match its allowlisted bounded schema',
      );
      assert.equal(observer.status, 'complete');
      assert.equal(observer.cleanup.confirmed, true);
      assert.equal(observer.cleanup.requestedMethodCount, 4);
      assert.equal(observer.cleanup.installedMethodCount, 4);
      assert.equal(observer.cleanup.restoredMethodCount, 4);
      assert.equal(observer.cleanup.changedOwnerCount, 0);
    }
    const evidenceIdentities = new Set();
    for (const entry of envelope.documents) {
      const identity = `${entry.documentRole}\u0000${entry.documentId}`;
      assert.equal(evidenceIdentities.has(identity), false);
      evidenceIdentities.add(identity);
      const cleanup = cleanupByIdentity.get(identity);
      assert.ok(
        cleanup,
        `Shader evidence has unknown document ${entry.documentRole}.`,
      );
      assert.equal(entry.status, 'complete');
      assert.equal(entry.cleanupConfirmed, true);
      const raw = boundedShaderProgramAttribution(
        cleanup.document.shaderProgramAttribution,
      );
      assert.deepEqual(entry.totals, raw.totals);
      assert.equal(entry.trackedProgramCount, raw.programs.length);
      assert.deepEqual(entry.limits, {
        untrackedProgramOperationCount:
          raw.limits.untrackedProgramOperationCount,
        pnameRowsOverflow: raw.limits.pnameRowsOverflow,
      });
    }
    assert.equal(evidenceIdentities.size, expectedDiagnosticCount);
    assert.deepEqual(
      [...evidenceIdentities].sort(),
      [...cleanupByIdentity.keys()].sort(),
    );
    assert.deepEqual(
      [...evidenceIdentities].sort(),
      diagnosticIdentities.sort(),
      'shader evidence must cover the exact documents in the diagnostic inventory',
    );
  }
  const workerAuditDocuments = pageAudit.workerAuditDocuments;
  assert.ok(Array.isArray(workerAuditDocuments));
  assert.deepEqual(
    workerAuditDocuments.map((entry) => entry.documentRole).sort(),
    expectedRoles,
  );
  for (const entry of workerAuditDocuments) {
    const measuredProviderDocument =
      entry.documentRole.startsWith('provider-sample-');
    assert.equal(
      entry.mode,
      workerAuditMode === 'prewarm' && measuredProviderDocument
        ? 'prewarm'
        : 'diagnostic',
    );
    assert.equal(entry.restoration?.nativeCreateObjectURLRestored, true);
    assert.equal(entry.restoration?.registryEmpty, true);
    assert.equal(entry.restoration.overflowCountAtRestore, 0);
    assert.equal(
      entry.restoration.createdScriptBlobCountAtRestore,
      entry.restoration.auditedCreatedScriptBlobCount,
    );
    if (entry.validation === null) {
      assert.equal(entry.restoration.auditedCreatedScriptBlobCount, 0);
      assert.equal(entry.observedWorkerTargetCount, 0);
      assert.equal(entry.observedBlobRequestCount, 0);
      assert.equal(entry.restoration.createdScriptBlobCountAtRestore, 0);
    } else {
      assert.equal(
        entry.validation.status,
        'receipt-derived-worker-blobs-validated',
      );
    }
    if (workerAuditMode === 'prewarm' && measuredProviderDocument) {
      assert.equal(entry.validation.auditMode, 'prewarm');
      assert.equal(
        entry.lateUseCheck?.status,
        'observed-late-code-paths-within-prewarm-inventory',
      );
      assert.equal(entry.lateUseCheck?.unusedLateBlobCreationObservable, false);
    } else if (entry.validation) {
      assert.equal(entry.validation.auditMode, 'diagnostic');
    }
  }
  for (const entry of diagnosticDocuments) {
    assert.equal(entry.requested, true);
    if (expected.appSha === BASELINE_SHA) {
      assert.equal(entry.hookAvailable, false);
      assert.equal(entry.disabled, false);
    } else {
      assert.equal(entry.hookAvailable, true);
      assert.equal(entry.disabled, true);
    }
  }
  const observedComparisonContract = createObservedDenseComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
  });
  assert.deepEqual(report.comparisonContract, observedComparisonContract);
  const observedReadinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: observedComparisonContract,
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    source: report.source,
    environment: report.environment,
    workload: report.workload,
    captures: report.captures,
    diagnosticsDocuments: diagnosticDocuments,
    workerBlobAuditInstrumented: true,
    workerBlobAuditMode: workerAuditMode,
    hardwareRequired: false,
  });
  if (expected.sceneFrameDiagnostics)
    observedReadinessReasons.push(
      'scene-frame-attribution-instrumentation-is-enabled',
    );
  if (expected.firstMotionCpuProfile)
    observedReadinessReasons.push(
      'provider-sample-cpu-profile-instrumentation-is-enabled',
    );
  if (expected.depthPickAttribution)
    observedReadinessReasons.push(
      'depth-pick-attribution-instrumentation-is-enabled',
    );
  if (expected.shaderProgramAttribution)
    observedReadinessReasons.push(
      'shader-program-attribution-instrumentation-is-enabled',
    );
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
    observedReadinessReasons.push(
      'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
    );
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.deepEqual(
    report.comparisonReadiness?.reasons,
    observedReadinessReasons,
  );
  assert.ok(
    observedReadinessReasons.includes(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    ),
  );
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
    assert.ok(report.environment?.renderer);
  else assert.match(report.environment?.renderer || '', /swiftshader/i);
  assert.equal(report.environment?.hardwareEligible, false);
  assert.equal(report.captures?.length, 6);
  assert.equal(report.fixtureDelivery?.status, 'observed');
  assert.equal(report.fixtureDelivery?.fixtureSha256, expected.fixtureSha256);
  assert.equal(report.fixtureDelivery?.observedFlightsCount, 2500);
  assert.ok(report.fixtureDelivery.fulfilledResponseCount >= 1);
  for (const scenario of report.workload.scenarios) {
    const samples = report.captures.filter(
      (sample) => sample.scenario === scenario,
    );
    assert.equal(samples.length, 2, `Expected two ${scenario} captures.`);
    assert.deepEqual(samples.map((sample) => sample.run).sort(), [1, 2]);
    for (const sample of samples) {
      assertProviderFixtureCaptureClock(sample.fixtureClock, {
        fixedTime: expected.fixedTime || report.fixtureDelivery.fixedTime,
        warmupMs: report.workload.warmupMs,
        measurementMs: report.workload.durationPerSampleMs,
      });
      assert.equal(sample.fixtureDelivery?.status, 'observed');
      assert.equal(
        sample.fixtureDelivery?.fixtureSha256,
        expected.fixtureSha256,
      );
      assert.equal(sample.fixtureDelivery?.observedFlightsCount, 2500);
      assert.ok(sample.fixtureDelivery?.fulfilledResponseCount >= 1);
      const population = Object.fromEntries(
        (sample.layers || [])
          .filter((layer) =>
            ['flights', 'local-datacenters', 'local-dams'].includes(layer.id),
          )
          .map((layer) => [
            layer.id,
            { enabled: layer.enabled, count: layer.count },
          ]),
      );
      assert.deepEqual(population, {
        flights: { enabled: true, count: 2500 },
        'local-datacenters': { enabled: true, count: 4362 },
        'local-dams': { enabled: true, count: 716 },
      });
      assert.equal(sample.conditions?.before?.visible, true);
      assert.equal(sample.conditions?.before?.focused, true);
      assert.equal(sample.conditions?.after?.visible, true);
      assert.equal(sample.conditions?.after?.focused, true);
      assert.equal(sample.foregroundThroughout, true);
      assertCaptureFrameAndSettingsEvidence(sample, scenario);
      if (scenario === 'selected-aircraft-tracking')
        assert.equal(sample.trackedAircraftId, 'flights:000001');
    }
  }
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    renderer: report.environment.renderer,
    fixtureSha256: report.fixtureDelivery.fixtureSha256,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    captures: report.captures.map((sample) => ({
      scenario: sample.scenario,
      run: sample.run,
      fixtureDelivery: sample.fixtureDelivery,
      fixtureClock: sample.fixtureClock,
      layers: sample.layers,
      conditions: sample.conditions,
    })),
    rawReport: report,
    limitations: [
      expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND
        ? 'Hosted native-renderer CLI integration only; not physical desktop or paired performance evidence.'
        : 'Hosted software-rendering CLI integration only; not hardware or paired performance evidence.',
      'The static production flight fixture verifies source delivery and populations, not a complete moving trajectory contract.',
    ],
  };
}

export function validateRendererBackendEvidence(
  report,
  backend = DEFAULT_CAPTURE_RENDERER_BACKEND,
) {
  if (backend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
    return assertVerifiedNativeRendererEvidence(
      report?.nativeRendererDiagnostic,
      report?.environment?.renderer,
      report?.environment?.vendor,
    );
  assert.equal(backend, DEFAULT_CAPTURE_RENDERER_BACKEND);
  assert.equal(report?.nativeRendererDiagnostic, undefined);
  return true;
}

export function validateAustinOperatingReadinessHistoryEnvelope(
  history,
  fixture,
  comparisonReadinessReasons,
) {
  assert.equal(history?.enabled, true);
  assert.equal(history?.schema, 'gev-austin-operating-readiness-history/v1');
  assert.equal(history?.intervalMs, 1000, 'sampler interval must remain 1 Hz');
  assert.equal(history?.entryLimit, 16, 'history ring cap must remain 16');
  assert.ok(
    Number.isSafeInteger(history?.attachTimeoutMs) &&
      history.attachTimeoutMs >= 1 &&
      history.attachTimeoutMs <= 1000,
    'session attach timeout must remain within the declared bound',
  );
  assert.ok(
    Number.isSafeInteger(history?.commandTimeoutMs) &&
      history.commandTimeoutMs >= 1 &&
      history.commandTimeoutMs <= 2000,
    'snapshot command timeout must remain within the declared bound',
  );
  assert.equal(history?.performanceAcceptanceEligible, false);
  assert.equal(history?.scope.includes('not CPU/GPU time'), true);
  assert.ok(Array.isArray(history?.documents));
  assert.ok(history.documents.length > 0 && history.documents.length <= 40);
  assert.ok(Array.isArray(history?.samples));
  assert.ok(history.samples.length <= 16);
  assert.ok(
    Number.isSafeInteger(history.omittedCount) && history.omittedCount >= 0,
  );
  assert.ok(
    Number.isSafeInteger(history.documentOmittedCount) &&
      history.documentOmittedCount >= 0,
  );
  const documentKeys = new Set();
  for (const document of history.documents) {
    assert.match(document.documentRole, /^[a-z0-9-]{1,48}$/i);
    assert.match(document.documentId, /^[a-z0-9._:-]{1,96}$/i);
    assert.equal(document.phase, 'source-readiness-wait');
    assert.equal(document.intervalMs, 1000);
    assert.equal(
      document.attachTimeoutMs,
      history.attachTimeoutMs,
      'document attach timeout must match the envelope configuration',
    );
    assert.equal(
      document.commandTimeoutMs,
      history.commandTimeoutMs,
      'document command timeout must match the envelope configuration',
    );
    assert.ok(Number.isSafeInteger(document.omittedCount));
    assert.ok(document.omittedCount >= 0);
    assert.ok(document.session && typeof document.session === 'object');
    const key = `${document.documentRole}\0${document.documentId}\0${document.phase}`;
    assert.equal(
      documentKeys.has(key),
      false,
      'readiness document identity must be unique',
    );
    documentKeys.add(key);
  }
  const previousSequenceByDocument = new Map();
  let previousCompletion = null;
  for (const sample of history.samples) {
    const documentKey = `${sample.documentRole}\0${sample.documentId}\0${sample.phase}`;
    const previousSequence = previousSequenceByDocument.get(documentKey) || 0;
    assert.ok(
      Number.isSafeInteger(sample.sequence) &&
        sample.sequence > previousSequence,
      'sample sequence must increase within its own document',
    );
    previousSequenceByDocument.set(documentKey, sample.sequence);
    assert.ok(
      history.documents.some(
        (document) =>
          document.documentRole === sample.documentRole &&
          document.documentId === sample.documentId &&
          document.phase === sample.phase,
      ),
      'sample identity must match a declared readiness document',
    );
    assert.ok(
      sample.hostStartedAtMs === null ||
        (Number.isFinite(sample.hostStartedAtMs) &&
          sample.hostStartedAtMs >= 0),
    );
    assert.ok(Number.isFinite(sample.hostCompletedAtMs));
    assert.ok(sample.hostCompletedAtMs >= 0);
    if (sample.hostStartedAtMs !== null) {
      assert.ok(sample.hostCompletedAtMs >= sample.hostStartedAtMs);
      if (previousCompletion !== null)
        assert.ok(sample.hostStartedAtMs >= previousCompletion);
    }
    if (previousCompletion !== null)
      assert.ok(sample.hostCompletedAtMs >= previousCompletion);
    previousCompletion = sample.hostCompletedAtMs;
    assert.ok(
      [
        'observed',
        'command-timeout',
        'evaluation-failed',
        'invalid-snapshot',
        'session-timeout',
        'session-create-failed',
        'session-listener-failed',
        'disconnected',
      ].includes(sample.status),
    );
    if (sample.status === 'observed') {
      assert.equal(sample.snapshotEncoding, 'austin-layer-tuples-v1');
      assert.ok(typeof sample.snapshotJson === 'string');
      assert.ok(Buffer.byteLength(sample.snapshotJson, 'utf8') <= 1024);
      const snapshot = JSON.parse(sample.snapshotJson);
      assert.equal(snapshot.schema, 'gev-austin-readiness-failure/v1');
      assert.equal(
        snapshot.selectedLayerCount,
        fixture.selectedLayerIds.length,
      );
      assert.ok(Array.isArray(snapshot.layers));
      assert.equal(snapshot.layers.length, fixture.selectedLayerIds.length);
      assert.ok(
        snapshot.layers.every(
          (layer) => Array.isArray(layer) && layer.length === 12,
        ),
      );
      assert.deepEqual(
        snapshot.layers.map((layer) => layer[0]),
        fixture.selectedLayerIds,
      );
      for (const layer of snapshot.layers) {
        for (const count of layer.slice(8))
          assert.ok(
            count === null || (Number.isSafeInteger(count) && count >= 0),
          );
      }
    } else {
      assert.equal(sample.snapshotJson, null);
      assert.equal(sample.snapshotEncoding, null);
    }
  }
  assert.ok(
    comparisonReadinessReasons.includes(
      'austin-setup-readiness-history-instrumentation-is-enabled',
    ),
  );
  return true;
}

function validateAustinOperatingCaptureCliReport(report, expected) {
  const fixture = expected.austinOperatingFixture;
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  assert.equal(
    report.workerAuditMode,
    expected.workerAuditMode || 'diagnostic',
  );
  assert.equal(report.comparisonEligible, false);
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 4 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  assert.equal(fixture?.schema, 'gev-austin-operating-fixture/v1');
  assert.equal(fixture?.workloadId, AUSTIN_OPERATING_WORKLOAD_ID);
  assert.equal(fixture?.fixedTime, expected.fixedTime);
  assert.equal(report.workload?.providerFixture, AUSTIN_OPERATING_WORKLOAD_ID);
  assert.equal(report.workload?.fixtureId, fixture.id);
  assert.deepEqual(report.workload?.fixture, fixture);
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.deepEqual(report.workload?.scenarios, ['idle', 'scripted-motion']);
  assert.ok(
    report.comparisonReadiness?.status === 'not-ready' &&
      report.comparisonReadiness.reasons.length > 0,
    'short Austin hosted smoke must remain comparison-ineligible',
  );
  if (expected.sceneFrameDiagnostics) {
    validateAustinOperatingReadinessHistoryEnvelope(
      report.workload?.austinOperatingReadinessHistory,
      fixture,
      report.comparisonReadiness.reasons,
    );
    assert.equal(report.sceneFrameDiagnostics, undefined);
  } else {
    assert.equal(report.workload?.austinOperatingReadinessHistory, undefined);
  }
  if (expected.workerAuditMode === 'receipt-only') {
    const topology = createCaptureDocumentTopology({
      startupRuns: report.workload.startupRuns,
      captureCount: report.captures.length,
    });
    const pageAssetAudit = report.source?.buildProvenance?.pageAssetAudit;
    assert.equal(
      validateReceiptOnlyWorkerAuditEnvelope({
        pageAssetAudit,
        appCommit: expected.appSha,
        harnessCommit: expected.harnessSha,
        receiptSha256: expected.receiptSha256,
        expectedDocuments: topology.workerAudits,
        expectedAssetPaths: expected.receiptOnlyWorkerContract?.assetPaths,
        bundleSha256: expected.receiptOnlyWorkerContract?.bundleSha256,
        workerSourceSha256:
          expected.receiptOnlyWorkerContract?.workerSourceSha256,
        allowedModuleCount:
          expected.receiptOnlyWorkerContract?.allowedModuleCount,
      }),
      true,
      'receipt-only mode must provide verified, non-instrumented path evidence',
    );
    assert.ok(
      report.comparisonReadiness.reasons.includes(
        'austin-satellite-boundary-sampling-remains-frame-cadence-dependent',
      ),
      'receipt-only mode does not clear the independent satellite cadence blocker',
    );
  } else {
    assert.notEqual(
      report.source?.buildProvenance?.pageAssetAudit?.workerAuditMode,
      'receipt-only',
    );
  }
  assert.equal(report.captures?.length, 4);
  const observedComparisonContract =
    createObservedAustinOperatingComparisonContract({
      fixture,
      fixtureDelivery: report.fixtureDelivery,
      environment: report.environment,
      captures: report.captures,
      scenarios: report.workload.scenarios,
      workload: {
        warmupMs: report.workload.warmupMs,
        durationPerSampleMs: report.workload.durationPerSampleMs,
        runsPerScenario: report.workload.runsPerScenario,
      },
    });
  const topology = createCaptureDocumentTopology({
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures.length,
  });
  assertCaptureCleanupEvidence(report.workload, topology, {
    captures: report.captures,
  });
  assert.equal(
    report.fixtureDelivery?.schema,
    'gev-austin-operating-capture-delivery/v1',
  );
  assert.equal(report.fixtureDelivery?.fixtureId, fixture.id);
  assert.equal(report.fixtureDelivery?.fixtureSha256, fixture.sha256);
  assert.ok(
    isDeepStrictEqual(report.comparisonContract, observedComparisonContract),
    'Austin comparison contract must equal the canonical projection of observed producer data',
  );
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    renderer: report.environment.renderer,
    fixtureSha256: report.fixtureDelivery.fixtureSha256,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    captures: report.captures.map((sample) => ({
      scenario: sample.scenario,
      run: sample.run,
      documentRole: sample.documentRole,
      documentId: sample.documentId,
      fixtureDelivery: sample.fixtureDelivery,
      populations: sample.austinOperatingClock,
    })),
    rawReport: report,
    limitations: [
      'Four-sample Austin provider wiring smoke only; not the required five-run, 30-second warmup and 60-second comparison workload.',
      'Synthetic radio and installation sources are benchmark fixtures and do not establish live Austin source coverage.',
      expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND
        ? 'Hosted native rendering is diagnostic only; it does not establish physical desktop coverage or paired performance evidence.'
        : 'Software rendering cannot support hardware performance claims.',
    ],
  };
}

function validateWeatherEffectsCaptureCliReport(report, expected) {
  const fixture = expected.weatherEffectsFixture;
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  assert.equal(expected.workerAuditMode || 'diagnostic', 'diagnostic');
  assert.equal(report.workerAuditMode, 'diagnostic');
  assert.equal(report.comparisonEligible, false);
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 4 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  assert.equal(fixture?.schema, 'gev-weather-effects-fixture/v1');
  assert.equal(fixture?.workloadId, WEATHER_EFFECTS_WORKLOAD_ID);
  assert.equal(fixture?.fixedTime, expected.fixedTime);
  assert.equal(report.workload?.providerFixture, WEATHER_EFFECTS_WORKLOAD_ID);
  assert.equal(report.workload?.fixtureId, fixture.id);
  assert.deepEqual(report.workload?.fixture, fixture);
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.deepEqual(report.workload?.scenarios, ['idle', 'scripted-motion']);
  assert.equal(report.workload?.performanceAcceptanceEligible, false);
  const captureTopology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures?.length,
  });
  assertCaptureCleanupEvidence(report.workload, captureTopology);
  const lifecycle = report.workload?.weatherEffectsFixtureLifecycle;
  assert.equal(lifecycle?.freshBrowserContextPerSample, false);
  assert.equal(lifecycle?.performanceAcceptanceEligible, false);
  assert.equal(lifecycle?.playback?.mode, 'history');
  assert.equal(lifecycle?.playback?.playing, true);
  assert.deepEqual(
    lifecycle?.observedCamera,
    report.fixtureDelivery?.cameraObservation,
  );
  for (const key of [
    'longitudeDeg',
    'latitudeDeg',
    'altitudeM',
    'headingDeg',
    'pitchDeg',
  ]) {
    const observed = lifecycle?.observedCamera?.[key];
    const expectedValue = fixture.camera[key];
    assert.ok(Number.isFinite(observed), `Observed camera ${key} is required.`);
    assert.ok(
      Math.abs(observed - expectedValue) <= (key.endsWith('Deg') ? 1e-4 : 1),
      `Observed camera ${key} differs from the pinned Austin route.`,
    );
  }
  assert.equal(lifecycle?.playback?.visualState?.windPaused, false);
  assert.deepEqual(lifecycle?.playback?.visualState, {
    satelliteProduct: 'clouds-regional',
    satelliteInfrared: 'filtered',
    radarOpacity: 'strong',
    lightningOpacity: 'strong',
    windModel: 'gfs',
    windOverlay: 'speed',
    windPaused: false,
  });
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.ok(
    report.comparisonReadiness?.reasons?.includes(
      'weather-effects-fixture-is-a-short-diagnostic-not-performance-acceptance',
    ),
  );
  const expectedTimes = [
    fixture.timeline.at(-1),
    fixture.timeline.at(-2),
    fixture.timeline.at(0),
    fixture.timeline.at(-1),
  ];
  assert.deepEqual(
    lifecycle?.timeline?.map((row) => row[0]),
    expectedTimes,
  );
  for (const row of lifecycle?.timeline || [])
    assert.deepEqual(row, [row[0], row[0], row[0]]);
  assert.deepEqual(lifecycle?.sourceObservationTimes, [
    fixture.timeline.at(-1),
    fixture.timeline.at(-1),
    fixture.timeline.at(-1),
  ]);
  assert.deepEqual(
    report.fixtureDelivery?.cameraObservation,
    lifecycle?.observedCamera,
  );
  assert.ok(
    lifecycle?.timeline?.some((row) => row[0] !== fixture.fixedTime),
    'Historical weather observations must differ from the held harness time.',
  );
  assert.deepEqual(report.fixtureDelivery, {
    ...report.fixtureDelivery,
    schema: 'gev-weather-effects-fixture-delivery/v1',
    status: 'observed',
    workloadId: fixture.workloadId,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
  });
  assert.deepEqual(
    report.fixtureDelivery.assets.map(
      ({ id, sha256, byteLength, contentType, responseCount }) => ({
        id,
        sha256,
        byteLength,
        contentType,
        responseCount,
      }),
    ),
    fixture.assets.map((asset) => ({
      id: asset.id,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      contentType: asset.contentType,
      responseCount: assertPositiveCount(
        report.fixtureDelivery.assets,
        asset.id,
      ),
    })),
  );
  const finalAssetCounts = new Map(
    report.fixtureDelivery.assets.map((asset) => [
      asset.id,
      asset.responseCount,
    ]),
  );
  const previousSampleCounts = new Map();
  assert.deepEqual(
    report.fixtureDelivery.populationsBefore,
    fixture.selectedLayerIds
      .map((id) => ({
        id,
        enabled: true,
        count: fixture.expectedLayerCounts[id],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(
    report.fixtureDelivery.populationsAfter,
    report.fixtureDelivery.populationsBefore,
  );
  assert.equal(report.captures?.length, 4);
  assert.deepEqual(
    report.captures.map(({ scenario, run }) => [scenario, run]),
    [
      ['idle', 1],
      ['idle', 2],
      ['scripted-motion', 1],
      ['scripted-motion', 2],
    ],
  );
  const pageAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAudit?.workerAuditMode, 'diagnostic');
  assert.ok(
    Number.isInteger(pageAudit?.scriptRequestCount) &&
      pageAudit.scriptRequestCount > 0,
  );
  assert.ok(pageAudit.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAudit.unexpectedAssetPaths, []);
  for (const audit of pageAudit.cesiumWorkerBlobAudits || [])
    assert.equal(audit.status, 'receipt-derived-worker-blobs-validated');
  const topology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures.length,
  });
  const roles = report.performanceDiagnostics?.documents || [];
  assert.deepEqual(
    roles.map(({ documentRole, documentId }) => ({ documentRole, documentId })),
    topology.diagnostics,
  );
  for (const entry of roles) {
    assert.equal(entry.requested, true);
    assert.equal(entry.disabled, true);
  }
  const workerDocuments = pageAudit.workerAuditDocuments;
  assert.deepEqual(
    workerDocuments.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.workerAudits,
  );
  for (const entry of workerDocuments) {
    assert.equal(entry.mode, 'diagnostic');
    assert.equal(entry.restoration?.nativeCreateObjectURLRestored, true);
    assert.equal(entry.restoration?.registryEmpty, true);
    assert.equal(entry.restoration?.overflowCountAtRestore, 0);
    assert.equal(
      entry.restoration?.createdScriptBlobCountAtRestore,
      entry.restoration?.auditedCreatedScriptBlobCount,
    );
    if (entry.validation === null) {
      assert.equal(entry.observedWorkerTargetCount, 0);
      assert.equal(entry.observedBlobRequestCount, 0);
      assert.equal(entry.restoration?.createdScriptBlobCountAtRestore, 0);
    } else {
      assert.equal(entry.validation?.schema, 'gev-cesium-worker-blob-audit/v1');
      assert.equal(
        entry.validation?.status,
        'receipt-derived-worker-blobs-validated',
      );
      assert.equal(entry.validation?.auditMode, 'diagnostic');
      assert.match(
        entry.validation?.embeddedWorkerSourceSha256 || '',
        /^[a-f0-9]{64}$/,
      );
    }
  }
  const validatedWorkerDocuments = workerDocuments.filter(
    (entry) =>
      entry.validation?.status === 'receipt-derived-worker-blobs-validated',
  );
  assert.equal(
    pageAudit.cesiumWorkerBlobAudits.length,
    validatedWorkerDocuments.length,
  );
  assert.deepEqual(
    pageAudit.cesiumWorkerBlobAudits,
    validatedWorkerDocuments.map((entry) => entry.validation),
  );
  assert.equal(
    workerDocuments.find((entry) => entry.documentRole === 'main-measured')
      ?.validation?.status,
    'receipt-derived-worker-blobs-validated',
  );
  const firstId = report.captures[0]?.documentId;
  assert.ok(firstId);
  for (const sample of report.captures) {
    assert.equal(sample.documentRole, 'main-measured');
    assert.equal(sample.documentId, firstId);
    assert.ok(['idle', 'scripted-motion'].includes(sample.scenario));
    assert.ok([1, 2].includes(sample.run));
    assert.deepEqual(sample.settings?.before, sample.settings?.after);
    assert.equal(sample.settings?.before?.qualityMode, 'manual');
    assert.equal(sample.settings?.before?.densityPct, 75);
    assert.equal(sample.settings?.before?.detectionMode, 'DENSE');
    for (const clock of [
      sample.weatherEffectsClock?.cesiumBefore,
      sample.weatherEffectsClock?.cesiumAfter,
    ]) {
      assert.equal(clock?.currentTime?.dayNumber, fixture.clock.dayNumber);
      assert.ok(
        Math.abs(
          (clock?.currentTime?.secondsOfDay ?? Number.NaN) -
            fixture.clock.secondsOfDay,
        ) < 1e-6,
      );
      assert.equal(clock?.shouldAnimate, false);
      assert.equal(clock?.multiplier, 0);
    }
    assert.equal(
      sample.weatherEffectsClock?.fixedHarnessTime,
      fixture.fixedTime,
    );
    assert.equal(
      sample.weatherEffectsClock?.wallClockBeforeMs,
      Date.parse(fixture.fixedTime),
    );
    assert.equal(
      sample.weatherEffectsClock?.wallClockAfterMs,
      Date.parse(fixture.fixedTime),
    );
    assert.deepEqual(
      sample.weatherEffectsClock?.weatherPlayback,
      lifecycle.playback,
    );
    assert.deepEqual(
      sample.weatherEffectsClock?.weatherStateBefore?.visualState,
      lifecycle.playback.visualState,
    );
    assert.deepEqual(
      sample.weatherEffectsClock?.weatherStateAfter?.visualState,
      lifecycle.playback.visualState,
    );
    for (const weatherState of [
      sample.weatherEffectsClock?.weatherStateBefore,
      sample.weatherEffectsClock?.weatherStateAfter,
    ]) {
      assert.equal(weatherState?.sourceObservationTimes?.length, 3);
      assert.ok(
        weatherState?.sourceObservationTimes?.every((time) =>
          fixture.timeline.includes(time),
        ),
      );
      assert.equal(weatherState?.clock?.mode, 'history');
      assert.equal(weatherState?.clock?.playing, true);
      assert.deepEqual(
        weatherState?.visualState,
        lifecycle.playback.visualState,
      );
      assert.equal(weatherState?.wind?.paused, false);
      assert.equal(weatherState?.wind?.model, 'gfs');
      assert.equal(weatherState?.wind?.overlay, 'speed');
    }
    const sampledAssets = sample.fixtureDelivery?.assets;
    assert.equal(sample.fixtureDelivery?.schema, report.fixtureDelivery.schema);
    assert.equal(sample.fixtureDelivery?.status, 'observed');
    assert.equal(sample.fixtureDelivery?.workloadId, fixture.workloadId);
    assert.equal(sample.fixtureDelivery?.fixtureSha256, fixture.sha256);
    assert.equal(sample.fixtureDelivery?.fixedTime, fixture.fixedTime);
    assert.deepEqual(
      sample.fixtureDelivery?.cameraObservation,
      report.fixtureDelivery.cameraObservation,
    );
    assert.deepEqual(
      sample.fixtureDelivery?.timelinePreflight,
      report.fixtureDelivery.timelinePreflight,
    );
    assert.deepEqual(
      sample.fixtureDelivery?.populationsBefore,
      report.fixtureDelivery.populationsBefore,
    );
    assert.deepEqual(
      sample.fixtureDelivery?.populationsAfter,
      report.fixtureDelivery.populationsAfter,
    );
    assert.deepEqual(
      sampledAssets?.map(({ id, sha256, byteLength, contentType }) => ({
        id,
        sha256,
        byteLength,
        contentType,
      })),
      fixture.assets.map(({ id, sha256, byteLength, contentType }) => ({
        id,
        sha256,
        byteLength,
        contentType,
      })),
    );
    for (const asset of sampledAssets || []) {
      assert.ok(
        Number.isSafeInteger(asset.responseCount) && asset.responseCount > 0,
        `Sample ${sample.scenario}/${sample.run} did not observe ${asset.id}.`,
      );
      assert.ok(
        asset.responseCount <= finalAssetCounts.get(asset.id),
        `Sample response count for ${asset.id} exceeds the final aggregate.`,
      );
      assert.ok(
        asset.responseCount >= (previousSampleCounts.get(asset.id) || 0),
        `Sample response count for ${asset.id} decreased in capture order.`,
      );
      previousSampleCounts.set(asset.id, asset.responseCount);
    }
    assertCaptureFrameAndSettingsEvidence(sample, sample.scenario);
  }
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    providerFixture: expected.providerFixture,
    fixtureSha256: fixture.sha256,
    renderer: report.environment?.renderer,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    rawReport: report,
    limitations: [
      expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND
        ? 'Hosted short native-renderer weather/effects fixture diagnostic only; not physical desktop or paired performance evidence.'
        : 'Hosted short software-rendering weather/effects fixture diagnostic only; not hardware or paired performance evidence.',
      'The preflight exercises the three fixed weather frames and starts the weather clock playback; it does not complete the full 90-second performance acceptance workload.',
    ],
  };
}

export function assertCaptureCleanupEvidence(
  workload,
  topology,
  { captures = null } = {},
) {
  const cleanup = workload?.rendererProbeCleanup;
  assert.ok(
    Array.isArray(cleanup),
    'Renderer probe cleanup evidence is required.',
  );
  assert.equal(workload.rendererProbeCleanupOmittedCount, 0);
  const expectedDocuments = topology.workerAudits;
  assert.deepEqual(
    cleanup
      .map(({ documentRole, documentId }) => ({ documentRole, documentId }))
      .sort((a, b) => a.documentRole.localeCompare(b.documentRole)),
    [...expectedDocuments].sort((a, b) =>
      a.documentRole.localeCompare(b.documentRole),
    ),
    'Every owned capture document must have exactly one cleanup record.',
  );
  for (const expectedDocument of expectedDocuments) {
    const evidence = cleanup.find(
      (entry) =>
        entry.documentRole === expectedDocument.documentRole &&
        entry.documentId === expectedDocument.documentId,
    );
    assert.equal(
      evidence?.confirmed,
      true,
      `Renderer probe cleanup ${expectedDocument.documentId} must be confirmed.`,
    );
    assert.equal(
      evidence?.document?.status,
      'confirmed',
      `Renderer probe document ${expectedDocument.documentId} must report confirmed state.`,
    );
    assert.equal(evidence?.document?.statePresent, true);
    assert.equal(evidence?.document?.hookRestoreAttempted, true);
    assert.equal(evidence?.document?.hookRestored, true);
    assert.equal(evidence?.document?.stateDeleted, true);
    assert.ok(
      Number.isSafeInteger(evidence?.document?.listenerCount) &&
        evidence.document.listenerCount >= 0,
    );
    assert.equal(evidence?.document?.listenerRemovalFailedCount, 0);
    assert.equal(
      evidence?.document?.listenerRemovalConfirmedCount,
      evidence?.document?.listenerRemovalAttemptedCount,
    );
    assert.equal(
      evidence?.document?.listenerRemovalAttemptedCount,
      evidence?.document?.listenerCount,
    );
    assert.ok(
      ['confirmed', 'already-confirmed'].includes(
        evidence?.scriptRegistration?.status,
      ),
    );
    assert.equal(evidence?.scriptRegistration?.errorKind, null);
    assert.match(
      evidence?.scriptRegistration?.verification || '',
      /^puppeteer-registration-removal-acknowledged;/,
    );
    assert.equal(evidence?.document?.renderLoopRetirement?.requested, true);
    assert.equal(evidence?.document?.renderLoopRetirement?.confirmed, true);
    assert.equal(evidence?.document?.renderLoopRetirement?.after, false);
  }

  assertRendererLoopRetirementEvidence({ workload, topology, captures });

  const measuredDocuments = [
    ...new Map(
      topology.samples.map((entry) => [entry.documentId, entry]),
    ).values(),
  ];
  const expectedReleaseDocuments =
    captures === null ? measuredDocuments : topology.workerAudits;
  const releases = workload.fixtureInterceptionReleases;
  assert.ok(
    Array.isArray(releases),
    'Fixture session release evidence is required.',
  );
  assert.deepEqual(
    releases
      .map(({ documentRole, documentId }) => ({ documentRole, documentId }))
      .sort((a, b) => a.documentRole.localeCompare(b.documentRole)),
    expectedReleaseDocuments
      .map(({ documentRole, documentId }) => ({ documentRole, documentId }))
      .sort((a, b) => a.documentRole.localeCompare(b.documentRole)),
    'Fixture interception releases must exactly cover the owned documents for this workload.',
  );
  for (const expectedDocument of expectedReleaseDocuments) {
    const release = releases.find(
      (entry) =>
        entry.documentRole === expectedDocument.documentRole &&
        entry.documentId === expectedDocument.documentId,
    );
    assert.equal(
      release?.confirmed,
      true,
      `Fixture release ${expectedDocument.documentId} must be confirmed.`,
    );
    assert.equal(
      release?.targetClosed,
      true,
      `Fixture target ${expectedDocument.documentId} must be closed.`,
    );
    assert.equal(release?.stop?.confirmed, true);
    assert.equal(release?.stop?.listenerRemovalConfirmed, true);
    for (const field of [
      'pendingAtStop',
      'pendingPreparationAtStop',
      'pendingAbortSubscriptionsAtStop',
      'pendingCommandsAtStop',
    ])
      assert.ok(
        Number.isSafeInteger(release?.stop?.[field]) &&
          release.stop[field] >= 0,
        `Fixture release ${field} must be a nonnegative observed count.`,
      );
    assert.equal(
      release?.stop?.pendingCommandsAfterDrain,
      0,
      `Fixture release ${expectedDocument.documentId} must drain pending commands.`,
    );
    assert.equal(release?.stop?.pendingPreparationsAfterDrain, 0);
    assert.equal(release?.stop?.pendingAbortSubscriptionsAfterDrain, 0);
    assert.equal(release?.stop?.rejectedDrainOperations, 0);
    assert.equal(release?.stop?.drainCommandFailures, 0);
    assert.equal(release?.stop?.unexpectedLateRequestCount, 0);
    assert.equal(release?.interception?.confirmed, true);
    assert.equal(release?.interception?.interception?.confirmed, true);
    for (const field of [
      'pendingAtStop',
      'pendingPreparationAtStop',
      'pendingAbortSubscriptionsAtStop',
      'pendingCommandsAtStop',
    ])
      assert.ok(
        Number.isSafeInteger(release?.interception?.interception?.[field]) &&
          release.interception.interception[field] >= 0,
        `Interception drain ${field} must be a nonnegative observed count.`,
      );
    assert.equal(
      release?.interception?.interception?.listenerRemovalConfirmed,
      true,
    );
    assert.equal(
      release?.interception?.interception?.pendingCommandsAfterDrain,
      0,
    );
    assert.equal(
      release?.interception?.interception?.pendingPreparationsAfterDrain,
      0,
    );
    assert.equal(
      release?.interception?.interception?.pendingAbortSubscriptionsAfterDrain,
      0,
    );
    assert.equal(
      release?.interception?.interception?.unexpectedLateRequestCount,
      0,
    );
    assert.equal(
      release?.interception?.interception?.rejectedDrainOperations,
      0,
    );
    assert.equal(release?.interception?.interception?.drainCommandFailures, 0);
    assert.equal(release?.interception?.fetchDisable, 'target-closed');
    assert.equal(release?.interception?.detach, 'target-closed');
    assert.equal(release?.fetchDisable, 'target-closed');
    assert.equal(release?.detach, 'target-closed');
  }
}

export function assertRendererLoopRetirementEvidence({
  workload,
  topology,
  captures = null,
} = {}) {
  const retirements = workload?.rendererLoopRetirements;
  assert.ok(
    Array.isArray(retirements),
    'Renderer-loop retirement rows are required.',
  );
  assert.equal(workload.rendererLoopRetirementsOmittedCount, 0);

  const expected = topology.workerAudits
    .filter((document) => document.documentRole.startsWith('startup-'))
    .map((document) => ({
      ...document,
      phase: 'startup-final-details',
      scenario: undefined,
      run: undefined,
      retirement: null,
    }));

  if (captures !== null) {
    assert.ok(Array.isArray(captures), 'Austin captures must be an array.');
    assert.equal(
      captures.length,
      topology.samples.length,
      'Every Austin sample document must have one capture record.',
    );
    for (const document of topology.samples) {
      const matchingCaptures = captures.filter(
        (capture) =>
          capture.documentRole === document.documentRole &&
          capture.documentId === document.documentId,
      );
      assert.equal(
        matchingCaptures.length,
        1,
        `Austin sample ${document.documentRole} must map to exactly one capture.`,
      );
      const capture = matchingCaptures[0];
      assert.ok(
        capture.renderLoopRetirement &&
          typeof capture.renderLoopRetirement === 'object' &&
          !Array.isArray(capture.renderLoopRetirement),
        `Austin sample ${document.documentRole} must include its observed render-loop retirement.`,
      );
      assert.ok(
        ['idle', 'scripted-motion'].includes(capture.scenario),
        `Austin sample ${document.documentRole} has an unknown scenario.`,
      );
      assert.ok(
        Number.isSafeInteger(capture.run) && capture.run > 0,
        `Austin sample ${document.documentRole} has an invalid run ordinal.`,
      );
      expected.push({
        ...document,
        phase: 'provider-sample-measurement-post-render',
        scenario: capture.scenario,
        run: capture.run,
        retirement: capture.renderLoopRetirement,
      });
    }
  }

  assert.equal(
    retirements.length,
    expected.length,
    'Renderer-loop retirement rows must exactly cover the expected boundaries.',
  );
  const identity = (entry) =>
    [
      entry.phase,
      entry.documentRole,
      entry.documentId,
      entry.scenario ?? '',
      entry.run ?? '',
    ].join('\u0000');
  const expectedByIdentity = new Map();
  for (const entry of expected) {
    const key = identity(entry);
    assert.equal(
      expectedByIdentity.has(key),
      false,
      `Expected renderer-loop retirement ${entry.documentRole} is duplicated.`,
    );
    expectedByIdentity.set(key, entry);
  }
  const actualByIdentity = new Map();
  for (const entry of retirements) {
    const key = identity(entry);
    assert.equal(
      actualByIdentity.has(key),
      false,
      `Renderer-loop retirement ${entry.documentRole} is duplicated.`,
    );
    actualByIdentity.set(key, entry);
  }
  assert.deepEqual(
    [...actualByIdentity.keys()].sort(),
    [...expectedByIdentity.keys()].sort(),
    'Renderer-loop retirement identities, phases, and sample ordinals must match the capture topology.',
  );

  for (const [key, expectedEntry] of expectedByIdentity) {
    const retirement = actualByIdentity.get(key);
    assert.equal(retirement.requested, true);
    if (captures !== null) {
      assert.ok(
        Number.isFinite(retirement.elapsedMs) && retirement.elapsedMs >= 0,
        `Retirement ${expectedEntry.documentRole} elapsed time must be finite and nonnegative.`,
      );
      assert.equal(
        retirement.status,
        expectedEntry.phase === 'startup-final-details'
          ? 'retired-with-final-observation'
          : 'retired-at-final-post-render',
      );
      assert.equal(retirement.before, true);
    }
    assert.equal(retirement.confirmed, true);
    assert.equal(retirement.after, false);
    if (expectedEntry.retirement) {
      for (const field of [
        'requested',
        'status',
        'before',
        'after',
        'confirmed',
        'elapsedMs',
      ])
        assert.equal(
          retirement[field],
          expectedEntry.retirement[field],
          `Retirement ${expectedEntry.documentRole} ${field} must match its capture boundary.`,
        );
    }
  }
}

function assertPositiveCount(assets, id) {
  const row = assets.find((asset) => asset.id === id);
  assert.ok(Number.isInteger(row?.responseCount) && row.responseCount > 0);
  return row.responseCount;
}

function validateInfrastructureCaptureCliReport(report, expected) {
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  assert.equal(expected.workerAuditMode || 'diagnostic', 'diagnostic');
  assert.equal(report.workerAuditMode, 'diagnostic');
  assert.equal(report.comparisonEligible, false);
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 4 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  const pageAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAudit?.workerAuditMode, 'diagnostic');
  assert.ok(
    Number.isInteger(pageAudit?.scriptRequestCount) &&
      pageAudit.scriptRequestCount > 0,
  );
  assert.ok(pageAudit.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAudit.unexpectedAssetPaths, []);
  const blobAudits = pageAudit.cesiumWorkerBlobAudits;
  assert.ok(Array.isArray(blobAudits));
  for (const audit of blobAudits)
    assert.equal(audit.status, 'receipt-derived-worker-blobs-validated');

  const fixture = expected.infrastructureFixture;
  assert.equal(fixture?.schema, 'gev-infrastructure-fixture-manifest/v1');
  assert.equal(fixture?.workloadId, expected.providerFixture);
  assert.equal(fixture?.fixedTime, expected.fixedTime);
  assert.equal(report.workload?.providerFixture, expected.providerFixture);
  assert.equal(report.workload?.fixtureId, fixture.id);
  assert.equal(
    report.workload?.infrastructureFixtureLifecycle
      ?.freshBrowserContextPerSample,
    false,
  );
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.deepEqual(report.workload?.scenarios, ['idle', 'scripted-motion']);
  assert.equal(report.environment?.startup?.runCount, 1);
  assert.equal(
    report.environment?.startup?.measurement,
    'one measured app document; cache disabled before navigation',
  );
  const observedContract = createObservedInfrastructureComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
  });
  assert.deepEqual(report.workload.fixture, fixture);
  assert.deepEqual(report.comparisonContract, observedContract);
  const diagnostics = report.performanceDiagnostics?.documents;
  assert.ok(Array.isArray(diagnostics));
  const topology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures.length,
  });
  assert.equal(diagnostics.length, topology.diagnostics.length);
  assert.deepEqual(
    diagnostics.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.diagnostics,
  );
  for (const entry of diagnostics) {
    assert.equal(entry.requested, true);
    assert.equal(entry.disabled, true);
  }
  const workerDocuments = pageAudit.workerAuditDocuments;
  assert.ok(Array.isArray(workerDocuments));
  assert.deepEqual(
    workerDocuments.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.workerAudits,
  );
  for (const entry of workerDocuments) {
    assert.equal(entry.mode, 'diagnostic');
    assert.equal(entry.restoration?.nativeCreateObjectURLRestored, true);
    assert.equal(entry.restoration?.registryEmpty, true);
    assert.equal(entry.restoration?.overflowCountAtRestore, 0);
    assert.equal(
      entry.restoration?.createdScriptBlobCountAtRestore,
      entry.restoration?.auditedCreatedScriptBlobCount,
    );
    if (entry.validation === null) {
      assert.equal(entry.observedWorkerTargetCount, 0);
      assert.equal(entry.observedBlobRequestCount, 0);
      assert.equal(entry.restoration?.createdScriptBlobCountAtRestore, 0);
    } else {
      assert.equal(entry.validation?.schema, 'gev-cesium-worker-blob-audit/v1');
      assert.equal(
        entry.validation?.status,
        'receipt-derived-worker-blobs-validated',
      );
      assert.equal(entry.validation?.auditMode, 'diagnostic');
      assert.match(
        entry.validation?.embeddedWorkerSourceSha256 || '',
        /^[a-f0-9]{64}$/,
      );
    }
  }
  const auditsByRole = new Map(
    workerDocuments.map((entry) => [entry.documentRole, entry]),
  );
  assert.equal(
    auditsByRole.get('main-measured')?.validation?.status,
    'receipt-derived-worker-blobs-validated',
    'Missing receipt-derived worker audit for main-measured',
  );
  const startupDiagnostic = diagnostics.find(
    (entry) => entry.documentRole === 'startup-1',
  );
  const mainDiagnostic = diagnostics.find(
    (entry) => entry.documentRole === 'main-setup',
  );
  const startupAudit = auditsByRole.get('startup-1');
  const mainAudit = auditsByRole.get('main-measured');
  assert.ok(startupDiagnostic?.documentId);
  assert.ok(mainDiagnostic?.documentId);
  assert.notEqual(startupDiagnostic.documentId, mainDiagnostic.documentId);
  assert.equal(startupAudit.documentId, startupDiagnostic.documentId);
  assert.equal(mainAudit.documentId, mainDiagnostic.documentId);
  assert.deepEqual(
    report.captures.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.samples,
  );
  assert.equal(mainDiagnostic.documentId, topology.samples[0]?.documentId);
  const validatedDocumentCount = workerDocuments.filter(
    (entry) =>
      entry.validation?.status === 'receipt-derived-worker-blobs-validated',
  ).length;
  assert.equal(
    blobAudits.length,
    validatedDocumentCount,
    'Worker blob observations must correspond one-to-one with validated document audits',
  );
  assert.deepEqual(
    blobAudits,
    workerDocuments
      .filter(
        (entry) =>
          entry.validation?.status === 'receipt-derived-worker-blobs-validated',
      )
      .map((entry) => entry.validation),
    'Worker blob observations must preserve each document validation in order',
  );
  const workerSourceHashes = new Set(
    workerDocuments
      .filter((entry) => entry.validation)
      .map((entry) => entry.validation.embeddedWorkerSourceSha256),
  );
  assert.equal(workerSourceHashes.size, 1);
  for (const audit of blobAudits) {
    assert.equal(audit?.schema, 'gev-cesium-worker-blob-audit/v1');
    assert.equal(audit?.auditMode, 'diagnostic');
    assert.ok(workerSourceHashes.has(audit?.embeddedWorkerSourceSha256));
  }
  const readinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: observedContract,
    fixture,
    fixtureDelivery: report.fixtureDelivery,
    source: report.source,
    environment: report.environment,
    workload: report.workload,
    captures: report.captures,
    diagnosticsDocuments: diagnostics,
    workerBlobAuditInstrumented: true,
    workerBlobAuditMode: 'diagnostic',
    hardwareRequired: false,
  });
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
    readinessReasons.push(
      'hosted-native-renderer-diagnostic-is-ineligible-for-comparison',
    );
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.deepEqual(report.comparisonReadiness?.reasons, readinessReasons);
  assert.ok(
    readinessReasons.includes(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    ),
  );
  if (expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
    assert.ok(report.environment?.renderer);
  else assert.match(report.environment?.renderer || '', /swiftshader/i);
  assert.equal(report.environment?.hardwareEligible, false);
  assert.equal(report.captures?.length, 4);
  for (const scenario of report.workload.scenarios) {
    const samples = report.captures.filter(
      (sample) => sample.scenario === scenario,
    );
    assert.equal(samples.length, 2);
    assert.deepEqual(samples.map((sample) => sample.run).sort(), [1, 2]);
    for (const sample of samples) {
      const expectedLayers = Object.entries(fixture.expectedLayerCounts)
        .map(([id, count]) => ({ id, enabled: true, count }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const observedLayers = (sample.layers || [])
        .filter((layer) => Object.hasOwn(fixture.expectedLayerCounts, layer.id))
        .map(({ id, enabled, count }) => ({ id, enabled, count }))
        .sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(observedLayers, expectedLayers);
      assert.equal(sample.fixtureDelivery?.fixtureSha256, fixture.sha256);
      assert.equal(sample.settings?.before?.qualityMode, 'manual');
      assert.deepEqual(sample.settings?.before, sample.settings?.after);
      assert.equal(sample.conditions?.before?.visible, true);
      assert.equal(sample.conditions?.after?.visible, true);
      assert.equal(sample.conditions?.before?.focused, true);
      assert.equal(sample.conditions?.after?.focused, true);
      assert.equal(sample.foregroundThroughout, true);
      assert.ok(sample.cameraPath?.id);
      assertCaptureFrameAndSettingsEvidence(sample, scenario);
    }
  }
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    providerFixture: expected.providerFixture,
    fixtureSha256: fixture.sha256,
    renderer: report.environment.renderer,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    rawReport: report,
    limitations: [
      expected.captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND
        ? 'Hosted native-renderer infrastructure capture only; not physical desktop or paired performance evidence.'
        : 'Hosted software-rendering infrastructure capture only; not hardware or paired performance evidence.',
      'Infrastructure capture is diagnostic and does not establish baseline/candidate visual parity.',
    ],
  };
}

export function compactCaptureCliFailure(report) {
  if (!report || typeof report !== 'object') return null;
  let preservedRawReport;
  let rawReportTruncated = false;
  let rawReportUnavailable = 'CLI report was not a recognized capture schema.';
  try {
    if (
      report.schema === 'gev-performance-capture-failure/v1' &&
      report.status === 'failed'
    ) {
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      if (
        Buffer.byteLength(serialized, 'utf8') <=
        MAX_CAPTURE_FAILURE_REPORT_BYTES
      )
        preservedRawReport = report;
      else
        rawReportUnavailable =
          'Failure report exceeded the bounded artifact limit.';
    } else if (report.schema === 'gev-performance-capture/v1') {
      const bounded = boundCaptureReportEvidence(report);
      const serialized = `${JSON.stringify(bounded.value, null, 2)}\n`;
      if (
        bounded.value?.schema === 'gev-performance-capture/v1' &&
        Buffer.byteLength(serialized, 'utf8') <=
          MAX_CAPTURE_FAILURE_REPORT_BYTES
      ) {
        preservedRawReport = bounded.value;
        rawReportTruncated = bounded.truncated;
      } else
        rawReportUnavailable =
          'Completed report exceeded the bounded artifact limit.';
    } else if (report.schema === 'gev-performance-capture-failure/v1') {
      rawReportUnavailable = 'Failure report was not marked failed.';
    }
  } catch {
    rawReportUnavailable = 'CLI report could not be safely bounded.';
  }
  return {
    schema: 'gev-smoke-capture-cli-failure/v1',
    summary: {
      reportSchema: report.schema || null,
      status: report.status || null,
      failure: report.failure
        ? {
            message: sanitizeError(report.failure.message || 'Capture failed.'),
            phase: report.failure.phase || null,
            scenario: report.failure.scenario || null,
            run: Number.isInteger(report.failure.run)
              ? report.failure.run
              : null,
            operator: report.failure.operator || null,
            actual: report.failure.actual ?? null,
            expected: report.failure.expected ?? null,
          }
        : null,
      source: {
        appCommit: report.source?.appCommit || null,
        harnessCommit: report.source?.harnessCommit || null,
        provenanceStatus: report.source?.provenanceStatus || null,
      },
      fixtureDelivery: report.fixtureDelivery
        ? {
            status: report.fixtureDelivery.status,
            fixtureSha256: report.fixtureDelivery.fixtureSha256,
            observedFlightsCount: report.fixtureDelivery.observedFlightsCount,
            fulfilledResponseCount:
              report.fixtureDelivery.fulfilledResponseCount,
          }
        : null,
      fixtureInterceptionErrors: Array.isArray(report.fixtureInterceptionErrors)
        ? report.fixtureInterceptionErrors.slice(0, 8).map((entry) => ({
            message: sanitizeError(entry?.message || 'Interception failed.'),
            phase: entry?.phase || null,
            documentRole: entry?.documentRole || null,
            documentId: entry?.documentId || null,
            sessionOrdinal: Number.isSafeInteger(entry?.sessionOrdinal)
              ? entry.sessionOrdinal
              : null,
            lifecycleStage: entry?.lifecycleStage || null,
          }))
        : [],
      completedSampleCount:
        report.progress?.completedSampleCount ?? report.captures?.length ?? 0,
      completedSamplesRetained:
        report.progress?.completedSamplesRetained ??
        report.progress?.completedSamples?.length ??
        report.captures?.length ??
        0,
      evidenceTruncated: report.evidenceTruncated ?? null,
    },
    ...(preservedRawReport
      ? { rawReport: preservedRawReport, rawReportTruncated }
      : { rawReportUnavailable }),
  };
}

export function projectMapStreamingJourneyFailureForSmoke(
  error,
  mapStreamingCaptureModule,
) {
  const candidate =
    error?.mapStreamingJourneyFailure ||
    error?.captureCliFailure?.rawReport?.workload?.mapStreamingJourneyFailure ||
    null;
  if (!candidate) return null;
  if (
    typeof mapStreamingCaptureModule?.projectMapStreamingJourneyFailureEvidence !==
    'function'
  )
    return {
      schema: 'gev-map-streaming-journey-failure/v1',
      status: 'invalid',
      reasonCode: 'projector-unavailable',
    };
  try {
    return mapStreamingCaptureModule.projectMapStreamingJourneyFailureEvidence(
      candidate,
    );
  } catch {
    return {
      schema: 'gev-map-streaming-journey-failure/v1',
      status: 'invalid',
      reasonCode: 'invalid-envelope',
    };
  }
}

export function attachMapStreamingJourneyFailureEvidence(
  failure,
  projectedFailure,
) {
  if (!projectedFailure) return failure;
  const diagnostics = failure.smokeDiagnostics || {};
  diagnostics.mapStreamingJourneyFailure = projectedFailure;
  failure.smokeDiagnostics = diagnostics;
  return failure;
}

export async function preserveCaptureCliReportArtifact(
  sourcePath,
  artifactPath,
) {
  let sourceHandle;
  let sourceStat;
  try {
    sourceHandle = await open(sourcePath, 'r');
    sourceStat = await sourceHandle.stat();
  } catch {
    await sourceHandle?.close().catch(() => {});
    return {
      schema: 'gev-smoke-capture-cli-report-artifact/v1',
      status: 'missing',
      fileName: path.basename(artifactPath),
      byteLength: null,
      sha256: null,
      limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
    };
  }
  if (!sourceStat.isFile()) {
    await sourceHandle.close().catch(() => {});
    return {
      schema: 'gev-smoke-capture-cli-report-artifact/v1',
      status: 'unavailable',
      reason: 'source-not-file',
      fileName: path.basename(artifactPath),
      byteLength: null,
      sha256: null,
      limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
    };
  }
  if (sourceStat.size > MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES) {
    await sourceHandle.close().catch(() => {});
    return {
      schema: 'gev-smoke-capture-cli-report-artifact/v1',
      status: 'oversize',
      fileName: path.basename(artifactPath),
      byteLength: sourceStat.size,
      sha256: null,
      limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
    };
  }

  const temporaryPath = `${artifactPath}.pending-${process.pid}`;
  try {
    const boundedBuffer = Buffer.alloc(
      MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES + 1,
    );
    let byteLength = 0;
    while (byteLength < boundedBuffer.byteLength) {
      const { bytesRead } = await sourceHandle.read(
        boundedBuffer,
        byteLength,
        boundedBuffer.byteLength - byteLength,
        byteLength,
      );
      if (bytesRead === 0) break;
      byteLength += bytesRead;
    }
    if (byteLength > MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES) {
      await sourceHandle.close().catch(() => {});
      return {
        schema: 'gev-smoke-capture-cli-report-artifact/v1',
        status: 'oversize',
        fileName: path.basename(artifactPath),
        byteLength: sourceStat.size > byteLength ? sourceStat.size : byteLength,
        sha256: null,
        limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
      };
    }
    const bytes = boundedBuffer.subarray(0, byteLength);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    await sourceHandle.close();
    await rename(temporaryPath, artifactPath);
    return {
      schema: 'gev-smoke-capture-cli-report-artifact/v1',
      status: 'preserved',
      fileName: path.basename(artifactPath),
      byteLength: bytes.byteLength,
      sha256,
      limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
    };
  } catch {
    await sourceHandle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    return {
      schema: 'gev-smoke-capture-cli-report-artifact/v1',
      status: 'write-failed',
      fileName: path.basename(artifactPath),
      byteLength: sourceStat.size,
      sha256: null,
      limitBytes: MAX_CAPTURE_CLI_REPORT_ARTIFACT_BYTES,
    };
  }
}

export async function executeCaptureCliWithReportArtifact({
  runChild,
  reportPath,
  artifactPath,
  shaderAttributionArtifactPath = null,
  shaderAttributionArtifactSourcePath = null,
  shaderAttributionReferenceSourcePath = null,
  shaderAttributionExpectedComplete = false,
  shaderAttributionExpectedProvenance = null,
}) {
  let childError = null;
  try {
    await runChild();
  } catch (error) {
    childError = error;
  }
  const artifact = await preserveCaptureCliReportArtifact(
    reportPath,
    artifactPath,
  );
  artifact.childStatus = childError ? 'failed' : 'completed';
  let shaderAttributionArtifact = null;
  let shaderAttributionCheckpoint = null;
  let shaderAttributionCheckpointSummary = null;
  let shaderAttributionSourceReference = null;
  if (
    shaderAttributionArtifactPath &&
    shaderAttributionArtifactSourcePath &&
    shaderAttributionReferenceSourcePath
  ) {
    const preserved = await preserveShaderProgramAttributionArtifact(
      shaderAttributionArtifactSourcePath,
      shaderAttributionReferenceSourcePath,
      shaderAttributionArtifactPath,
      shaderAttributionExpectedProvenance,
    );
    shaderAttributionArtifact = preserved.artifact;
    shaderAttributionCheckpoint = preserved.checkpoint;
    shaderAttributionCheckpointSummary = preserved.checkpointSummary || null;
    shaderAttributionSourceReference = preserved.sourceReference || null;
    if (
      !childError &&
      (shaderAttributionArtifact.status !== 'preserved' ||
        !shaderAttributionCheckpoint ||
        (shaderAttributionExpectedComplete &&
          shaderAttributionCheckpoint.status !== 'complete'))
    )
      childError = new Error(
        'Shader-program attribution checkpoint was not complete and verified.',
      );
  }
  let report = null;
  if (artifact.status === 'preserved') {
    try {
      report = JSON.parse(await readFile(artifactPath, 'utf8'));
    } catch (error) {
      if (!childError) childError = error;
    }
  }
  if (shaderAttributionArtifact) {
    const producerReference =
      report?.workload?.shaderProgramAttributionArtifact || null;
    if (!report) {
      shaderAttributionArtifact.reportBindingStatus = 'report-unavailable';
    } else if (!producerReference || !shaderAttributionSourceReference) {
      shaderAttributionArtifact.reportBindingStatus = 'report-binding-missing';
    } else {
      const bindingMatches =
        producerReference.schema ===
          'gev-shader-program-attribution-artifact/v1' &&
        producerReference.status === shaderAttributionCheckpoint?.status &&
        producerReference.fileName ===
          path.basename(shaderAttributionArtifactSourcePath || '') &&
        producerReference.byteLength ===
          shaderAttributionArtifact.sourceByteLength &&
        producerReference.sha256 === shaderAttributionArtifact.sourceSha256 &&
        producerReference.referenceFileName ===
          path.basename(shaderAttributionReferenceSourcePath || '') &&
        producerReference.referenceByteLength ===
          shaderAttributionSourceReference.byteLength &&
        producerReference.referenceSha256 ===
          shaderAttributionSourceReference.sha256 &&
        producerReference.limitBytes ===
          MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES;
      const checkpointIdentities = (
        shaderAttributionCheckpoint?.documents || []
      )
        .map(
          (document) => `${document.documentRole}\u0000${document.documentId}`,
        )
        .sort();
      const envelopeIdentities = (
        report?.workload?.shaderProgramAttribution?.documents || []
      )
        .map(
          (document) => `${document.documentRole}\u0000${document.documentId}`,
        )
        .sort();
      const identityMatches =
        !shaderAttributionExpectedComplete ||
        (checkpointIdentities.length === envelopeIdentities.length &&
          checkpointIdentities.every(
            (identity, index) => identity === envelopeIdentities[index],
          ));
      shaderAttributionArtifact.reportBindingStatus =
        bindingMatches && identityMatches ? 'bound' : 'report-binding-mismatch';
      if ((!bindingMatches || !identityMatches) && !childError)
        childError = new Error(
          'Shader-program attribution sidecar did not match the capture report reference or document identities.',
        );
    }
  }
  if (
    shaderAttributionArtifact &&
    !childError &&
    shaderAttributionArtifact.reportBindingStatus !== 'bound'
  )
    childError = new Error(
      'Shader-program attribution checkpoint is missing its capture report binding.',
    );
  if (!childError && artifact.status === 'oversize')
    childError = new Error('Capture CLI report exceeded its artifact limit.');
  if (!childError && artifact.status !== 'preserved')
    childError = new Error('Capture CLI report artifact was not preserved.');
  if (childError) {
    childError.captureCliReport = report;
    childError.captureCliReportArtifact = artifact;
    if (shaderAttributionArtifact) {
      childError.shaderProgramAttributionArtifact = shaderAttributionArtifact;
      childError.shaderProgramAttributionCheckpoint =
        shaderAttributionCheckpoint;
      childError.shaderProgramAttributionCheckpointSummary =
        shaderAttributionCheckpointSummary;
    }
    throw childError;
  }
  return {
    report,
    artifact,
    shaderProgramAttributionArtifact: shaderAttributionArtifact,
    shaderProgramAttributionCheckpoint: shaderAttributionCheckpoint,
    shaderProgramAttributionCheckpointSummary:
      shaderAttributionCheckpointSummary,
  };
}

export async function preserveShaderProgramAttributionArtifact(
  sourcePath,
  referencePath,
  artifactPath,
  expectedProvenance = null,
) {
  const metadata = (status, details = {}) => ({
    schema: 'gev-smoke-shader-program-attribution-artifact/v1',
    status,
    fileName: path.basename(artifactPath),
    byteLength: null,
    sha256: null,
    sourceByteLength: null,
    sourceSha256: null,
    referenceFileName: `${path.basename(artifactPath)}.ref.json`,
    referenceByteLength: null,
    referenceSha256: null,
    sourceReferenceFileName: path.basename(referencePath),
    sourceReferenceByteLength: null,
    sourceReferenceSha256: null,
    limitBytes: MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
    ...details,
  });
  const summarizeCheckpoint = (checkpoint) => ({
    status: checkpoint.status,
    expectedDocumentCount: checkpoint.expectedDocumentCount,
    recordedDocumentCount: checkpoint.recordedDocumentCount,
    invalidDocumentCount: checkpoint.invalidDocumentCount,
    documentIdentities: checkpoint.documents.map((document) => ({
      role: document.documentRole,
      id: document.documentId,
    })),
  });
  const readBounded = async (filePath, limit) => {
    let handle;
    try {
      handle = await open(filePath, 'r');
      const statResult = await handle.stat();
      if (!statResult.isFile()) return { status: 'unavailable' };
      if (statResult.size > limit)
        return { status: 'oversize', byteLength: statResult.size };
      const buffer = Buffer.alloc(limit + 1);
      let byteLength = 0;
      while (byteLength < buffer.byteLength) {
        const { bytesRead } = await handle.read(
          buffer,
          byteLength,
          buffer.byteLength - byteLength,
          byteLength,
        );
        if (bytesRead === 0) break;
        byteLength += bytesRead;
      }
      if (byteLength > limit) return { status: 'oversize', byteLength };
      return { status: 'read', bytes: buffer.subarray(0, byteLength) };
    } catch (error) {
      return { status: 'missing', code: error?.code || null };
    } finally {
      await handle?.close().catch(() => {});
    }
  };
  const payload = await readBounded(
    sourcePath,
    MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
  );
  if (payload.status !== 'read')
    return {
      artifact: metadata(
        payload.status === 'oversize' ? 'oversize' : 'missing-or-unreadable',
        { sourceByteLength: payload.byteLength ?? null },
      ),
      checkpoint: null,
    };
  const referenceRead = await readBounded(referencePath, 16 * 1024);
  if (referenceRead.status !== 'read')
    return {
      artifact: metadata('reference-missing-or-invalid', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: createHash('sha256').update(payload.bytes).digest('hex'),
      }),
      checkpoint: null,
    };
  let parsed;
  let reference;
  try {
    reference = JSON.parse(referenceRead.bytes.toString('utf8'));
  } catch {
    return {
      artifact: metadata('malformed', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: createHash('sha256').update(payload.bytes).digest('hex'),
      }),
      checkpoint: null,
    };
  }
  if (
    !validateShaderProgramAttributionCheckpointReference(
      reference,
      payload.bytes,
      expectedProvenance,
      path.basename(sourcePath),
    )
  )
    return {
      artifact: metadata('hash-or-reference-mismatch', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: createHash('sha256').update(payload.bytes).digest('hex'),
      }),
      checkpoint: null,
    };
  try {
    parsed = JSON.parse(payload.bytes.toString('utf8'));
  } catch {
    return {
      artifact: metadata('malformed', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: reference.sha256,
      }),
      checkpoint: null,
    };
  }
  const checkpoint = validateShaderProgramAttributionCheckpoint(
    parsed,
    expectedProvenance,
  );
  if (!checkpoint || checkpoint.status !== reference.status)
    return {
      artifact: metadata('malformed', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: reference.sha256,
      }),
      checkpoint: null,
    };
  const canonicalBytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`);
  if (canonicalBytes.byteLength > MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES)
    return {
      artifact: metadata('oversize', {
        sourceByteLength: payload.bytes.byteLength,
      }),
      checkpoint: null,
    };
  const outputReference = createShaderProgramAttributionCheckpointReference(
    checkpoint,
    canonicalBytes,
    path.basename(artifactPath),
  );
  if (!outputReference)
    return {
      artifact: metadata('malformed', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: reference.sha256,
      }),
      checkpoint: null,
    };
  const referenceBytes = Buffer.from(`${JSON.stringify(outputReference)}\n`);
  const temporaryPath = `${artifactPath}.pending-${process.pid}`;
  const artifactReferencePath = `${artifactPath}.ref.json`;
  const temporaryReferencePath = `${artifactReferencePath}.pending-${process.pid}`;
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(temporaryPath, canonicalBytes, { flag: 'wx' });
    await rename(temporaryPath, artifactPath);
    await writeFile(temporaryReferencePath, referenceBytes, { flag: 'wx' });
    await rename(temporaryReferencePath, artifactReferencePath);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => {});
    await rm(temporaryReferencePath, { force: true }).catch(() => {});
    return {
      artifact: metadata('write-failed', {
        sourceByteLength: payload.bytes.byteLength,
        sourceSha256: reference.sha256,
      }),
      checkpoint: null,
    };
  }
  const artifactMetadata = metadata('preserved', {
    byteLength: canonicalBytes.byteLength,
    sha256: createHash('sha256').update(canonicalBytes).digest('hex'),
    sourceByteLength: payload.bytes.byteLength,
    sourceSha256: reference.sha256,
    sourceReferenceFileName: path.basename(referencePath),
    sourceReferenceByteLength: referenceRead.bytes.byteLength,
    sourceReferenceSha256: createHash('sha256')
      .update(referenceRead.bytes)
      .digest('hex'),
    referenceByteLength: referenceBytes.byteLength,
    referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  });
  if (
    !verifyShaderProgramAttributionArtifactBytes(
      artifactMetadata,
      canonicalBytes,
    )
  )
    return { artifact: metadata('hash-mismatch'), checkpoint: null };
  return {
    artifact: artifactMetadata,
    checkpoint,
    checkpointSummary: summarizeCheckpoint(checkpoint),
    sourceReference: {
      fileName: path.basename(referencePath),
      byteLength: referenceRead.bytes.byteLength,
      sha256: createHash('sha256').update(referenceRead.bytes).digest('hex'),
    },
  };
}

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  }).trim();
}

function sanitizeError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'<>]+[\\/])*[^\s"'<>]*/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400);
}

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA1.test(value))
    throw new TypeError(`${label} must be a full lowercase Git SHA.`);
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function createOwnedTempRoot() {
  const parent = await realpath(process.env.RUNNER_TEMP || os.tmpdir());
  const created = await mkdtemp(
    path.join(parent, 'gev-performance-build-smoke-'),
  );
  const canonical = await realpath(created);
  if (
    !assertInside(parent, canonical) ||
    path.dirname(canonical) !== parent ||
    !path.basename(canonical).startsWith('gev-performance-build-smoke-')
  )
    throw new Error('Generated smoke directory escaped its task-owned root.');
  return { parent, root: canonical };
}

async function writeReport(report, outputPath) {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function addWorktree(tempRoot, label, commit) {
  const checkout = path.join(tempRoot, `source-${label}`);
  execFileSync(
    'git',
    ['-C', ROOT, 'worktree', 'add', '--detach', checkout, commit],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      timeout: 30_000,
    },
  );
  const canonical = await realpath(checkout);
  if (!assertInside(tempRoot, canonical) || canonical === tempRoot)
    throw new Error('Generated source worktree escaped its task-owned root.');
  return canonical;
}

function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405).end();
        return;
      }
      const parsed = new URL(request.url || '/', 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(parsed.pathname);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (
        !relative ||
        relative.includes('\\') ||
        relative
          .split('/')
          .some((part) => !part || part === '.' || part === '..')
      ) {
        response.writeHead(400).end();
        return;
      }
      const absolute = path.resolve(root, ...relative.split('/'));
      if (!assertInside(root, absolute)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(absolute);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': info.size,
        'content-type':
          MIME_TYPES[path.extname(absolute)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(absolute).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      reject(
        new Error('Static server did not close within its cleanup bound.'),
      );
    }, 5000);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

function simplifyObservation(observed) {
  return {
    environment: {
      appCommit: observed.environment.appCommit,
      renderer: observed.environment.renderer,
      vendor: observed.environment.vendor,
      viewport: observed.environment.viewport,
      drawingBuffer: observed.environment.drawingBuffer,
      layers: observed.environment.layers,
      totalObjects: observed.environment.totalObjects,
      focused: observed.environment.focused,
      visible: observed.environment.visible,
    },
    settings: {
      qualityMode: observed.settings.qualityMode,
      densityPct: observed.settings.densityPct,
      detectionMode: observed.settings.detectionMode,
      resolutionScale: observed.settings.resolutionScale,
      antialias: observed.settings.antialias,
      msaaSamples: observed.settings.msaaSamples,
      fxaa: observed.settings.fxaa,
      bloom: observed.settings.bloom,
      bloomIntensity: observed.settings.bloomIntensity,
      sharpen: observed.settings.sharpen,
      sharpenIntensity: observed.settings.sharpenIntensity,
    },
    camera: observed.camera,
  };
}

export function buildCaptureCliValidationExpectations({
  build,
  commit,
  harnessCommit,
  fixture,
  providerFixture,
  workerAuditMode,
  sceneFrameDiagnostics,
  firstMotionCpuProfile,
  depthPickAttribution,
  shaderProgramAttribution,
  captureRendererBackend = DEFAULT_CAPTURE_RENDERER_BACKEND,
  austinOperatingFixture,
  mapStreamingFixture,
  warmupMs = 1000,
  durationPerSampleMs = 1000,
  validateMapStreamingCapture,
  receiptOnlyWorkerContract,
}) {
  return {
    appSha: commit,
    harnessSha: harnessCommit,
    receiptSha256: build.receipt.receiptSha256,
    fixtureSha256: fixture?.sha256 || fixture?.manifestSha256 || null,
    providerFixture,
    fixedTime: fixture?.fixedTime || null,
    ...(providerFixture.startsWith('infrastructure')
      ? { infrastructureFixture: fixture }
      : providerFixture === WEATHER_EFFECTS_WORKLOAD_ID
        ? { weatherEffectsFixture: fixture }
        : providerFixture === AUSTIN_OPERATING_WORKLOAD_ID
          ? { austinOperatingFixture: fixture }
          : {}),
    ...(providerFixture === MAP_STREAMING_WORKLOAD_ID
      ? {
          mapStreamingFixture,
          mapStreamingBuildProfile:
            build.receipt.buildRecipe?.mapFixtureProfile || null,
          validateMapStreamingCapture,
          warmupMs,
          durationPerSampleMs,
        }
      : {}),
    workerAuditMode,
    ...(captureRendererBackend !== DEFAULT_CAPTURE_RENDERER_BACKEND
      ? { captureRendererBackend }
      : {}),
    ...(receiptOnlyWorkerContract ? { receiptOnlyWorkerContract } : {}),
    sceneFrameDiagnostics,
    firstMotionCpuProfile,
    depthPickAttribution,
    ...(typeof shaderProgramAttribution === 'boolean'
      ? { shaderProgramAttribution }
      : {}),
  };
}

async function runCandidateCaptureCli({
  build,
  checkout,
  commit,
  harnessCommit,
  served,
  tempRoot,
  fixture,
  mapStreamingCaptureModule = null,
  providerFixture,
  workerAuditMode,
  captureRendererBackend = DEFAULT_CAPTURE_RENDERER_BACKEND,
  sceneFrameDiagnostics = false,
  firstMotionCpuProfile = false,
  depthPickAttribution = false,
  shaderProgramAttribution = false,
  captureCliReportArtifactPath,
  profileArtifactDirectory = null,
  startedAt,
  budgetMs,
}) {
  const remainingMs = budgetMs - (Date.now() - startedAt);
  if (remainingMs < CAPTURE_CLI_TIMEOUT_MS + 15_000)
    throw new Error(
      'Insufficient outer smoke budget for capture CLI integration.',
    );
  const receiptPath = path.join(tempRoot, 'capture-cli-build-receipt.json');
  const reportPath = path.join(tempRoot, 'capture-cli-report.json');
  const shaderAttributionSourcePath = `${reportPath}.shader-program-attribution.json`;
  const shaderAttributionReferenceSourcePath = `${shaderAttributionSourcePath}.ref.json`;
  const shaderAttributionArtifactPath = shaderProgramAttribution
    ? `${captureCliReportArtifactPath}.shader-program-attribution.json`
    : null;
  const browserPidPath = path.join(tempRoot, 'capture-cli-browser.pid');
  await writeFile(receiptPath, `${JSON.stringify(build.receipt)}\n`, 'utf8');
  const expectedReceiptOnlyWorkerContract =
    workerAuditMode === 'receipt-only'
      ? {
          ...deriveCesiumEmbeddedWorkerContract({
            bundlePath: 'cesium/Cesium.js',
            bundleBytes: await readFile(
              path.join(build.buildRoot, 'cesium', 'Cesium.js'),
            ),
            assets: build.receipt.assets,
          }),
          assetPaths: build.receipt.assets.map((asset) => asset.path),
        }
      : null;
  const scriptPath = path.join(
    ROOT,
    'scripts',
    'capture-scene-performance.mjs',
  );
  const args = [
    scriptPath,
    '--url',
    served.baseUrl,
    '--provider-fixture',
    providerFixture,
    '--provider-fixture-time',
    fixture.fixedTime || '2026-10-08T12:00:00.000Z',
    '--worker-audit-mode',
    workerAuditMode,
    '--quality-mode',
    'manual',
    '--detection-mode',
    'DENSE',
    '--expected-density',
    '75',
    '--runs',
    '2',
    '--startup-runs',
    '1',
    '--warmup-ms',
    '1000',
    '--seconds',
    '1',
    '--fixture-timeout-ms',
    '60000',
    '--protocol-timeout-ms',
    '120000',
    '--headless',
    '--hosted-fixture',
    '--owned-browser-pid-file',
    browserPidPath,
    '--build-receipt',
    receiptPath,
    '--app-checkout',
    checkout,
    '--harness-checkout',
    ROOT,
    '--build-root',
    build.buildRoot,
    '--expected-app-sha',
    commit,
    '--expected-harness-sha',
    harnessCommit,
    '--served-base-url',
    served.baseUrl,
    '--out',
    reportPath,
  ];
  if (providerFixture === MAP_STREAMING_WORKLOAD_ID)
    args.push('--build-profile', MAP_FIXTURE_BUILD_PROFILE_ID);
  args.push(...captureCliRendererArgs(captureRendererBackend));
  if (providerFixture === 'dense-investigation') args.push('--mixed-layers');
  if (sceneFrameDiagnostics) args.push('--scene-frame-diagnostics');
  if (depthPickAttribution) args.push('--depth-pick-attribution');
  if (shaderProgramAttribution) args.push('--shader-program-attribution');
  if (firstMotionCpuProfile) {
    if (typeof profileArtifactDirectory !== 'string')
      throw new TypeError('CPU profile artifact directory is required.');
    args.push(
      '--first-motion-cpu-profile',
      '--cpu-profile-artifact-directory',
      profileArtifactDirectory,
    );
  }
  let captureReport = null;
  let captureCliReportArtifact = null;
  let shaderProgramAttributionArtifact = null;
  try {
    const captureCliResult = await executeCaptureCliWithReportArtifact({
      runChild: () =>
        runBoundedChild(process.execPath, args, {
          timeoutMs: Math.min(CAPTURE_CLI_TIMEOUT_MS, remainingMs - 15_000),
          maxOutputBytes: 64 * 1024,
          ownedPidFile: browserPidPath,
        }),
      reportPath,
      artifactPath: captureCliReportArtifactPath,
      shaderAttributionArtifactPath,
      shaderAttributionArtifactSourcePath: shaderProgramAttribution
        ? shaderAttributionSourcePath
        : null,
      shaderAttributionReferenceSourcePath: shaderProgramAttribution
        ? shaderAttributionReferenceSourcePath
        : null,
      shaderAttributionExpectedComplete: shaderProgramAttribution,
      shaderAttributionExpectedProvenance: {
        appSha: commit,
        harnessSha: harnessCommit,
        receiptSha256: build.receipt.receiptSha256,
      },
    });
    captureReport = captureCliResult.report;
    captureCliReportArtifact = captureCliResult.artifact;
    shaderProgramAttributionArtifact =
      captureCliResult.shaderProgramAttributionArtifact;
    const validated = validateCaptureCliReport(
      captureReport,
      buildCaptureCliValidationExpectations({
        build,
        commit,
        harnessCommit,
        fixture,
        providerFixture,
        workerAuditMode,
        captureRendererBackend,
        sceneFrameDiagnostics,
        firstMotionCpuProfile,
        depthPickAttribution,
        shaderProgramAttribution,
        receiptOnlyWorkerContract: expectedReceiptOnlyWorkerContract,
        mapStreamingFixture:
          providerFixture === MAP_STREAMING_WORKLOAD_ID ? fixture : null,
        validateMapStreamingCapture:
          providerFixture === MAP_STREAMING_WORKLOAD_ID
            ? (mapCapture) =>
                mapStreamingCaptureModule.validateMapStreamingCaptureReport(
                  mapCapture,
                  {
                    fixture,
                    profile: build.receipt.buildRecipe?.mapFixtureProfile,
                  },
                )
            : null,
      }),
    );
    if (providerFixture === AUSTIN_OPERATING_WORKLOAD_ID) {
      const { validateAustinSatelliteEpochCaptureReport } =
        await import('./performance/austinSatelliteSampledEpoch.mjs');
      validateAustinSatelliteEpochCaptureReport({
        fixture,
        warmupMs: captureReport.workload?.warmupMs,
        durationPerSampleMs: captureReport.workload?.durationPerSampleMs,
        captures: captureReport.captures,
      });
    }
    if (firstMotionCpuProfile) {
      const evidence = captureReport.providerSampleCpuProfiles;
      for (
        let indexPosition = 0;
        indexPosition < evidence.profiles.length;
        indexPosition += 1
      ) {
        const window = evidence.profiles[indexPosition];
        const target = PROVIDER_CPU_PROFILE_TARGETS[indexPosition];
        const key = providerCpuProfileKey(target);
        const indexPath = path.join(
          profileArtifactDirectory,
          `${key}-cpu-profile-ref.json`,
        );
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        assert.equal(index?.schema, 'gev-provider-sample-cpu-profile-index/v1');
        assert.equal(index?.performanceAcceptanceEligible, false);
        assert.deepEqual(index.target, {
          scenario: target.scenario,
          run: target.run,
          captureOrdinal: window.captureOrdinal,
          documentRole: window.documentRole,
          documentId: window.documentId,
        });
        assert.deepEqual(index.profile, window.profile);
        const profileBytes = await readFile(
          path.join(profileArtifactDirectory, index.profile.fileName),
        );
        assert.ok(profileBytes.byteLength <= 8 * 1024 * 1024);
        assert.equal(profileBytes.byteLength, index.profile.byteLength);
        assert.equal(
          createHash('sha256').update(profileBytes).digest('hex'),
          index.profile.sha256,
        );
      }
    }
    return {
      ...validated,
      captureCliReportArtifact,
      ...(shaderProgramAttributionArtifact
        ? { shaderProgramAttributionArtifact }
        : {}),
    };
  } catch (error) {
    captureReport ||= error.captureCliReport || null;
    captureCliReportArtifact ||= error.captureCliReportArtifact || null;
    shaderProgramAttributionArtifact ||=
      error.shaderProgramAttributionArtifact || null;
    const captureCliFailure = compactCaptureCliFailure(captureReport) || {
      diagnostics: error.childDiagnostics || null,
    };
    if (firstMotionCpuProfile) {
      const directory = profileArtifactDirectory || `${reportPath}.cpu-profile`;
      captureCliFailure.cpuProfileArtifacts =
        await readProviderCpuProfileIndexSet(directory);
    }
    if (captureCliReportArtifact)
      captureCliFailure.captureCliReportArtifact = captureCliReportArtifact;
    if (shaderProgramAttributionArtifact)
      captureCliFailure.shaderProgramAttributionArtifact =
        shaderProgramAttributionArtifact;
    if (error.shaderProgramAttributionCheckpointSummary)
      captureCliFailure.shaderProgramAttributionCheckpoint =
        error.shaderProgramAttributionCheckpointSummary;
    error.captureCliFailure = captureCliFailure;
    error.captureCliReportArtifact = captureCliReportArtifact;
    error.shaderProgramAttributionArtifact = shaderProgramAttributionArtifact;
    throw error;
  }
}

async function runRevision({
  browser,
  checkout,
  commit,
  label,
  harnessCommit,
  tempRoot,
  startedAt,
  budgetMs,
  workerAuditMode,
  captureRendererBackend = DEFAULT_CAPTURE_RENDERER_BACKEND,
  browserGraphics = null,
  providerFixture,
  sceneFrameDiagnostics = false,
  firstMotionCpuProfile = false,
  depthPickAttribution = false,
  shaderProgramAttribution = false,
  captureCliReportArtifactPath,
  profileArtifactDirectory = null,
  infrastructureCaptureFixture,
  weatherEffectsCaptureFixture,
  austinOperatingCaptureFixture,
  mapStreamingCaptureFixture,
  mapStreamingCaptureModule,
  createMapStreamingFixtureDelivery,
}) {
  const buildRootPath = path.join(tempRoot, `build-${label}`);
  let build;
  let workerContract;
  try {
    build = await createLocalBuildReceipt({
      checkoutRoot: checkout,
      harnessRoot: ROOT,
      buildOutDir: buildRootPath,
      expectedAppCommit: commit,
      expectedHarnessCommit: harnessCommit,
      commandTimeoutMs: BUILD_COMMAND_TIMEOUT_MS,
      buildProfile:
        providerFixture === MAP_STREAMING_WORKLOAD_ID
          ? MAP_FIXTURE_BUILD_PROFILE_ID
          : null,
    });
    const bundlePath = 'cesium/Cesium.js';
    const bundleAsset = build.receipt.assets.find(
      (asset) => asset.path === bundlePath,
    );
    if (!bundleAsset)
      throw new Error('Build receipt is missing the Cesium bundle.');
    const bundleBytes = await readFile(
      path.join(build.buildRoot, ...bundlePath.split('/')),
    );
    workerContract = deriveCesiumEmbeddedWorkerContract({
      bundlePath,
      bundleBytes,
      assets: build.receipt.assets,
    });
  } catch (error) {
    error.smokeDiagnostics = {
      phase: 'clean-source-build',
      pageErrors: [],
      interceptionErrors: [],
    };
    throw error;
  }
  let served;
  try {
    served = await startStaticServer(build.buildRoot);
  } catch (error) {
    error.smokeDiagnostics = {
      phase: 'start-static-server',
      pageErrors: [],
      interceptionErrors: [],
    };
    throw error;
  }
  let context = null;
  let page = null;
  let earlyRendererProbeScriptIdentifier = null;
  let provenance = null;
  let fixturePage = null;
  let workerBlobValidation = null;
  let workerBlobDiagnostics = null;
  let densePopulationObservations = [];
  let finalDenseLayerPopulation = null;
  let terminalRenderLoopRetirement = null;
  let terminalMapObservation = null;
  let phase = 'browser-page-setup';
  const pageErrors = [];
  const cleanupErrors = [];
  const rendererProbeCleanup = [];
  let rendererProbeCleanupOmittedCount = 0;
  const recordRendererProbeCleanup = (evidence) => {
    if (rendererProbeCleanup.length >= 4) {
      rendererProbeCleanup.shift();
      rendererProbeCleanupOmittedCount += 1;
    }
    rendererProbeCleanup.push(evidence);
    return evidence;
  };
  let failure = null;
  let result = null;
  let nativeRendererEvidence = null;
  let mapStreamingSmokeDelivery = null;
  let mapStreamingSmokeEvidence = null;
  let mapStreamingNativeJourney = null;
  let mapStreamingInterceptionRelease = null;
  let mapStreamingRendering = null;
  let mapLayerPopulationBefore = null;
  try {
    const captureUrl = served.baseUrl;
    phase = 'verify-served-assets-before';
    provenance = await beginCaptureBuildProvenance({
      receipt: build.receipt,
      checkoutRoot: checkout,
      harnessRoot: ROOT,
      actualHarnessRoot: ROOT,
      buildRoot: build.buildRoot,
      expectedAppCommit: commit,
      expectedHarnessCommit: harnessCommit,
      baseUrl: served.baseUrl,
      captureUrl,
      expectedBuildProfile:
        providerFixture === MAP_STREAMING_WORKLOAD_ID
          ? MAP_FIXTURE_BUILD_PROFILE_ID
          : null,
    });
    phase = 'budget-check-before-browser';
    if (Date.now() - startedAt > budgetMs)
      throw new Error('Smoke time budget expired before browser load.');

    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport(
      providerFixture === MAP_STREAMING_WORKLOAD_ID
        ? { width: 1440, height: 900, deviceScaleFactor: 1 }
        : { width: 1280, height: 900, deviceScaleFactor: 1 },
    );
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);
    const preflightPhase = { active: true };
    const requestAudit = createApplicationCodeRequestAudit();
    const workerTargetUrls = new Set();
    let workerTargetOverflowCount = 0;
    const rememberWorkerTarget = (workerUrl) => {
      if (!workerUrl.startsWith('blob:') || workerTargetUrls.has(workerUrl))
        return;
      if (workerTargetUrls.size >= MAX_WORKER_TARGETS)
        workerTargetOverflowCount += 1;
      else workerTargetUrls.add(workerUrl);
    };
    page.on('request', (request) => {
      requestAudit.observeRequest(request.url(), request.resourceType());
    });
    page.on('workercreated', (worker) => {
      if (!preflightPhase.active) requestAudit.observeWorker(worker.url());
      rememberWorkerTarget(worker.url());
    });
    page.on('pageerror', (error) => {
      if (pageErrors.length < 8) pageErrors.push(sanitizeError(error));
    });
    phase = 'worker-aware-provider-interception';
    const flightFixture = createProductionFlightFixture();
    const flightFixtureDelivery = createFlightFixtureDeliveryObserver(
      flightFixture,
      served.baseUrl,
    );
    mapStreamingSmokeDelivery = mapStreamingCaptureFixture
      ? createMapStreamingFixtureDelivery(mapStreamingCaptureFixture, {
          appOrigin: served.baseUrl,
        })
      : null;
    fixturePage = await prepareFixturePage(browser, served.baseUrl, {
      page,
      viewport:
        providerFixture === MAP_STREAMING_WORKLOAD_ID
          ? { width: 1440, height: 900 }
          : { width: 1280, height: 900 },
      respond: (url, request) =>
        respondToSmokeFixtureRequest(url, request, {
          baseUrl: served.baseUrl,
          mapStreamingDelivery: mapStreamingSmokeDelivery,
          flightFixture,
        }),
      onFulfilled: (event) => {
        flightFixtureDelivery.onFulfilled(event);
        mapStreamingSmokeDelivery?.onFulfilled(event);
      },
    });
    const workerNetworkPreflight = await runSameOriginWorkerPreflight({
      page,
      baseUrl: served.baseUrl,
      verifyNetwork: fixturePage.verifyNetwork,
      resetRequestAudit: () => {
        const snapshot = requestAudit.snapshot();
        const discardedAudit = {
          requestCount: snapshot.requestCount,
          codeRequestCount: snapshot.requests.length,
        };
        return discardedAudit;
      },
    });
    phase = 'preflight-worker-target-disposal';
    const preflightTargetDisposal = await waitForPreflightWorkerTargetsClosed({
      getTargets: () =>
        browser.targets().map((target) => ({
          type: target.type(),
          url: target.url(),
        })),
      // The preflight is the only worker-producing action before app navigation.
      // Require every such target to disappear; don't whitelist its blob URL.
      workerUrls: null,
    });
    workerNetworkPreflight.discardedAudit = {
      requestCount: workerNetworkPreflight.discardedAudit?.requestCount ?? 0,
      codeRequestCount:
        workerNetworkPreflight.discardedAudit?.codeRequestCount ?? 0,
    };
    workerNetworkPreflight.targetDisposal = preflightTargetDisposal;
    if (!preflightTargetDisposal.closed)
      throw new Error(
        `Harness preflight worker target remained after termination (${preflightTargetDisposal.remainingCount}).`,
      );
    preflightPhase.active = false;
    workerTargetUrls.clear();
    workerTargetOverflowCount = 0;
    // Ignore preflight-phase events and begin app collection after its settle
    // window, so harness-only requests cannot enter the app code audit.
    requestAudit.begin();
    await page.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    await page.evaluateOnNewDocument(
      installHeldMonotonicWallClock,
      flightFixture.fixedTimeMs,
    );
    earlyRendererProbeScriptIdentifier =
      await installEarlyCesiumRendererProbe(page);
    phase = 'application-navigation';
    const response = await page.goto(captureUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    if (response && response.status() >= 400)
      throw new Error(
        `Application entry returned status ${response.status()}.`,
      );
    const finalUrl = new URL(page.url());
    const base = new URL(served.baseUrl);
    if (finalUrl.origin !== base.origin || finalUrl.pathname !== base.pathname)
      throw new Error('Application navigation left the verified entry point.');
    phase = 'application-readiness';
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), {
      timeout: 60_000,
      polling: 100,
    });
    if (captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND) {
      const earlyRenderer = await page.evaluate(() => ({
        renderer: window.__gevRecoveryEarlyRendererProbe?.renderer ?? null,
        vendor: window.__gevRecoveryEarlyRendererProbe?.vendor ?? null,
      }));
      nativeRendererEvidence = nativeRendererDiagnosticEvidence({
        renderer: earlyRenderer.renderer,
        vendor: earlyRenderer.vendor,
        graphics: browserGraphics,
      });
      assertVerifiedNativeRendererEvidence(
        nativeRendererEvidence,
        earlyRenderer.renderer,
        earlyRenderer.vendor,
      );
    }
    await page.waitForFunction(
      () => Boolean(window.__godsEyeView?.styleManager?.getVisualState),
      { timeout: 30_000, polling: 100 },
    );
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    const serviceWorkerState = await page.evaluate(() => ({
      controlled: Boolean(navigator.serviceWorker?.controller),
    }));
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    if (serviceWorkerState.controlled)
      throw new Error(
        'Application unexpectedly has a controlling service worker.',
      );

    let expectedLayerCounts = null;
    let denseLayerPopulation = null;
    const smokeWorkloadMode = smokeProviderPreparationMode(providerFixture);
    if (smokeWorkloadMode === 'native-map-streaming') {
      phase = 'native-map-streaming-selected-workload';
      mapLayerPopulationBefore = await page.evaluate(
        observeSmokeLayerPopulationInPage,
      );
    } else {
      phase = 'production-provider-fixture-population';
      expectedLayerCounts = {
        flights: flightFixture.count,
        'local-datacenters': 4362,
        'local-dams': 716,
      };
      await page.evaluate(async (layerIds) => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager)
          throw new Error('Application data manager is unavailable.');
        for (const id of layerIds) {
          if (!manager.layers?.has(id))
            throw new Error(`Dense fixture layer is missing: ${id}`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
      }, Object.keys(expectedLayerCounts));
      await page.waitForFunction(
        (counts) =>
          Object.entries(counts).every(([id, expected]) => {
            const layer = window.__godsEyeView?.dataManager
              ?.getAll?.()
              ?.find((entry) => entry.id === id);
            return layer?.enabled === true && layer?.stats?.count === expected;
          }),
        { timeout: 90_000, polling: 100 },
        expectedLayerCounts,
      );
      const readDenseLayerPopulation = () =>
        page.evaluate((layerIds) => {
          const layers = window.__godsEyeView.dataManager.getAll();
          return Object.fromEntries(
            layerIds.map((id) => {
              const layer = layers.find((entry) => entry.id === id);
              return [id, { enabled: layer.enabled, count: layer.stats.count }];
            }),
          );
        }, Object.keys(expectedLayerCounts));
      denseLayerPopulation = await readDenseLayerPopulation();
      densePopulationObservations.push({
        checkpoint: 'initial',
        layers: denseLayerPopulation,
      });
    }

    phase = 'provider-fixture-clock-start';
    const fixtureClockStart = await page.evaluate(() => {
      const clock = window.__gevHeldMonotonicWallClockV1;
      if (!clock || Date.now() !== clock.snapshot().epochMs)
        throw new Error('Fixture wall clock was not held at the source epoch.');
      return clock.start();
    });

    phase = 'shared-scene-and-route-observation';
    const before = await page.evaluate(observeCommonScene, {
      appCommit: commit,
    });
    if (
      nativeRendererEvidence &&
      before.environment?.renderer !== nativeRendererEvidence.observedRenderer
    )
      throw new Error(
        'Smoke scene renderer differs from its early native diagnostic observation.',
      );
    let after;
    let route;
    let fixtureClockEnd;
    let fixtureAgeMs;
    if (smokeWorkloadMode === 'native-map-streaming') {
      phase = 'native-map-streaming-journey';
      mapStreamingNativeJourney = await runNativeMapJourneyForSmoke({
        page,
        revision: commit,
        fixture: mapStreamingCaptureFixture,
        buildProfile: build.receipt.buildRecipe?.mapFixtureProfile,
        mapStreamingCaptureModule,
      });
      mapStreamingNativeJourney.layerPopulation =
        validateMapSmokeLayerPopulation(
          mapLayerPopulationBefore,
          await page.evaluate(observeSmokeLayerPopulationInPage),
        );
      after = await page.evaluate(observeCommonScene, { appCommit: commit });
      mapStreamingRendering = {
        observedRenderer: after.environment.renderer,
        observedVendor: after.environment.vendor,
        nativeRendererDiagnostic: nativeRendererEvidence,
      };
      route = mapStreamingNativeJourney.journey.route;
      fixtureClockEnd = await page.evaluate(() => ({
        clock: window.__gevHeldMonotonicWallClockV1?.snapshot?.() ?? null,
        wallTimeMs: Date.now(),
      }));
      fixtureAgeMs = fixtureClockEnd.wallTimeMs - flightFixture.fixedTimeMs;
      if (
        !fixtureClockEnd.clock?.started ||
        fixtureClockEnd.clock.startCount !== 1 ||
        fixtureClockEnd.clock.elapsedMs < route.elapsedMs ||
        fixtureAgeMs < 0 ||
        fixtureAgeMs > 120_000
      )
        throw new Error(
          `Native map fixture clock check failed: ${JSON.stringify({ clock: fixtureClockEnd.clock, fixtureAgeMs, routeElapsedMs: route.elapsedMs })}`,
        );
    } else {
      const routeStart = before.camera;
      const routeStartMs = await page.evaluate(() => performance.now());
      await new Promise((resolve) => setTimeout(resolve, 250));
      after = await page.evaluate(observeCommonScene, {
        appCommit: commit,
      });
      const routeEndMs = await page.evaluate(() => performance.now());
      fixtureClockEnd = await page.evaluate(() => ({
        clock: window.__gevHeldMonotonicWallClockV1?.snapshot?.() ?? null,
        wallTimeMs: Date.now(),
        flightStats:
          window.__godsEyeView?.dataManager?.layers
            ?.get('flights')
            ?.module?.getStats?.() ?? null,
      }));
      fixtureAgeMs = fixtureClockEnd.wallTimeMs - flightFixture.fixedTimeMs;
      if (
        !fixtureClockEnd.clock?.started ||
        fixtureClockEnd.clock.startCount !== 1 ||
        fixtureClockEnd.clock.elapsedMs < routeEndMs - routeStartMs ||
        fixtureAgeMs < 0 ||
        fixtureAgeMs > 120_000 ||
        fixtureClockEnd.flightStats?.lastUpdate !== flightFixture.fixedTimeMs ||
        fixtureClockEnd.flightStats?.stale !== false ||
        fixtureClockEnd.flightStats?.count !== flightFixture.count
      )
        throw new Error(
          `Provider fixture clock/freshness check failed: ${JSON.stringify({ clock: fixtureClockEnd.clock, fixtureAgeMs, flightStats: fixtureClockEnd.flightStats })}`,
        );
      route = describeObservedRoute({
        scenario: 'idle',
        start: routeStart,
        durationMs: routeEndMs - routeStartMs,
        measurement: { cameraPath: { id: 'integration-smoke-idle' } },
      });
    }
    if (
      nativeRendererEvidence &&
      (after.environment?.renderer !==
        nativeRendererEvidence.observedRenderer ||
        after.environment?.vendor !==
          nativeRendererEvidence.observedWebglVendor)
    )
      throw new Error(
        'Observed renderer changed during the hosted native diagnostic.',
      );
    const renderer = after.environment.renderer.toLowerCase();
    if (captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND) {
      assertVerifiedNativeRendererEvidence(
        nativeRendererEvidence,
        after.environment.renderer,
        after.environment.vendor,
      );
    } else if (!renderer.includes('swiftshader')) {
      throw new Error('Observed renderer does not identify SwiftShader.');
    }
    phase = 'served-assets-postcheck';
    const postVerification = await provenance.verifyAfterCapture();
    phase = 'final-page-health-and-code-path-audit';
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    for (const worker of page.workers())
      requestAudit.observeWorker(worker.url());
    for (const target of browser.targets())
      if (['worker', 'service_worker'].includes(target.type()))
        requestAudit.observeWorker(target.url());
    const finalAuditSnapshot = requestAudit.snapshot();
    if (finalAuditSnapshot.droppedCodeRequestCount > 0)
      throw new Error(
        'Application code request audit exceeded its bounded event capacity.',
      );
    const terminalPopulation = await page.evaluate(
      observeTerminalViewerState,
      expectedLayerCounts ? 'layer-population' : 'startup-details',
      expectedLayerCounts ? Object.keys(expectedLayerCounts) : [],
    );
    finalDenseLayerPopulation = expectedLayerCounts
      ? terminalPopulation.observation
      : null;
    terminalMapObservation = expectedLayerCounts
      ? null
      : terminalPopulation.observation;
    terminalRenderLoopRetirement = terminalPopulation.renderLoopRetirement;
    if (terminalRenderLoopRetirement.confirmed !== true)
      throw new Error(
        'Smoke viewer render loop retirement at final population observation was not confirmed.',
      );
    if (expectedLayerCounts)
      densePopulationObservations.push({
        checkpoint: 'final-before-code-validation',
        layers: finalDenseLayerPopulation,
        renderLoopRetirement: terminalRenderLoopRetirement,
      });
    const blobCodeRequests = finalAuditSnapshot.requests
      .filter((request) => request.url.startsWith('blob:'))
      .map((request) => request.url);
    for (const worker of page.workers()) rememberWorkerTarget(worker.url());
    for (const target of browser.targets())
      if (
        ['worker', 'service_worker'].includes(target.type()) &&
        target.url().startsWith('blob:')
      )
        rememberWorkerTarget(target.url());
    if (workerTargetOverflowCount > 0)
      throw new Error(
        'Application worker target audit exceeded its bounded capacity.',
      );
    const workerUrls = [...workerTargetUrls];
    phase = 'cesium-worker-blob-collection';
    const blobAudit = await withTimeout(
      page.evaluate(async (urls) => {
        const audit = window.__gevCesiumWorkerBlobAuditV1;
        if (!audit) throw new Error('Cesium worker blob audit is unavailable.');
        return audit.readWorkerBodies(urls);
      }, workerUrls),
      10_000,
      'Cesium worker blob collection',
    );
    workerBlobDiagnostics = summarizeCesiumWorkerBlobEvidence({
      workerUrls,
      observedBlobUrls: [...new Set([...blobCodeRequests, ...workerUrls])],
      blobAudit,
      requests: finalAuditSnapshot.requests,
    });
    phase = 'cesium-worker-blob-validation';
    workerBlobValidation = validateCesiumWorkerBlobs({
      contract: workerContract,
      baseUrl: served.baseUrl,
      workerUrls,
      observedBlobUrls: [...new Set([...blobCodeRequests, ...workerUrls])],
      blobAudit,
    });
    phase = 'receipted-code-request-audit';
    const finalCodeAudit = auditReceiptedCodeRequests({
      requests: finalAuditSnapshot.requests,
      baseUrl: served.baseUrl,
      assets: build.receipt.assets,
      validatedBlobUrls: workerBlobValidation.acceptedBlobUrls,
    });
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    if (expectedLayerCounts)
      for (const [id, expected] of Object.entries(expectedLayerCounts)) {
        if (
          denseLayerPopulation[id]?.enabled !== true ||
          denseLayerPopulation[id]?.count !== expected ||
          finalDenseLayerPopulation[id]?.enabled !== true ||
          finalDenseLayerPopulation[id]?.count !== expected
        )
          throw new Error(`Dense fixture population changed for ${id}.`);
      }
    const flightFixtureObservation = expectedLayerCounts
      ? flightFixtureDelivery.summarize(finalDenseLayerPopulation.flights.count)
      : null;
    let captureCliDiagnostic = null;
    if (label === 'candidate') {
      phase = 'capture-cli-preparation-cleanup';
      const cleanupEvidence = await cleanupEarlyCesiumRendererProbeWithEvidence(
        page,
        earlyRendererProbeScriptIdentifier,
        1_000,
        { retireViewerRenderLoop: true },
      );
      cleanupEvidence.phase = 'candidate-document-retirement';
      cleanupEvidence.registrationRemovalBoundary = 'owned-document-retirement';
      const earlyRendererProbeCleanup =
        recordRendererProbeCleanup(cleanupEvidence);
      if (earlyRendererProbeCleanup.confirmed !== true)
        throw new Error(
          'Early renderer probe cleanup before capture CLI was not confirmed.',
        );
      earlyRendererProbeScriptIdentifier = null;
      await withTimeout(
        page.evaluate(restoreCesiumWorkerBlobAudit),
        3000,
        'Cesium worker blob audit cleanup before capture CLI',
      );
      await withTimeout(
        cleanupFixturePageDiagnostics(page),
        3000,
        'Page diagnostic cleanup before capture CLI',
      );
      if (
        smokeProviderPreparationMode(providerFixture) === 'native-map-streaming'
      ) {
        const finalized = await finalizeMapSmokeFixtureDocument({
          context,
          page,
          fixturePage,
          delivery: mapStreamingSmokeDelivery,
          fixture: mapStreamingCaptureFixture,
          captureModule: mapStreamingCaptureModule,
          documentRole: 'smoke-variant',
          documentId: `${label}-${commit}`,
        });
        mapStreamingInterceptionRelease = finalized.interceptionRelease;
        mapStreamingSmokeEvidence = finalized.deliveryEvidence;
        mapStreamingSmokeDelivery = null;
        if (mapStreamingInterceptionRelease.targetClosed) {
          context = null;
          page = null;
          fixturePage = null;
        }
        if (mapStreamingNativeJourney) {
          mapStreamingNativeJourney.delivery = mapStreamingSmokeEvidence;
          mapStreamingNativeJourney.interceptionRelease =
            mapStreamingInterceptionRelease;
        }
        if (finalized.confirmed !== true)
          throw new Error(
            `Map smoke target, interception, or delivery finalization failed: ${finalized.errors.join('; ')}`,
          );
      } else {
        await withTimeout(
          context.close(),
          5000,
          'Smoke browser context cleanup before capture CLI',
        );
        context = null;
        page = null;
        fixturePage = null;
      }
      if (mapStreamingNativeJourney) {
        mapStreamingNativeJourney.rendering = mapStreamingRendering;
        mapStreamingNativeJourney.renderLoopRetirement =
          terminalRenderLoopRetirement;
        mapStreamingNativeJourney.terminalObservation = terminalMapObservation;
      }
      phase = 'candidate-capture-cli-integration';
      captureCliDiagnostic = await runCandidateCaptureCli({
        build,
        checkout,
        commit,
        harnessCommit,
        served,
        tempRoot,
        fixture:
          providerFixture === 'dense-investigation'
            ? flightFixture
            : infrastructureCaptureFixture ||
              weatherEffectsCaptureFixture ||
              austinOperatingCaptureFixture ||
              mapStreamingCaptureFixture,
        mapStreamingCaptureModule,
        providerFixture,
        workerAuditMode,
        captureRendererBackend,
        sceneFrameDiagnostics,
        firstMotionCpuProfile,
        depthPickAttribution,
        shaderProgramAttribution,
        captureCliReportArtifactPath,
        profileArtifactDirectory,
        startedAt,
        budgetMs,
      });
    }
    result = {
      revision: commit,
      status: 'passed',
      receiptSha256: build.receipt.receiptSha256,
      assetCount: build.receipt.assetCount,
      totalAssetBytes: build.receipt.totalAssetBytes,
      servedBefore: provenance.source.before,
      servedAfter: postVerification,
      loadedCodePathAudit: {
        status: 'receipt-backed-paths-observed',
        paths: finalCodeAudit.paths,
        externalCodeRequestsObserved: finalCodeAudit.externalCodeRequests,
        validatedWorkerBlobCount: finalCodeAudit.validatedWorkerBlobCount,
        cesiumWorkerBlobs: workerBlobValidation.observation,
        requestCount: finalAuditSnapshot.requestCount,
        coverage:
          'receipt-backed request-path audit with smoke-only Cesium worker blob instrumentation; browser response bytes are not independently attested and the smoke is not performance evidence',
      },
      providerInterception: {
        status: 'worker-aware-external-blocking-probe-passed',
        preflight: workerNetworkPreflight,
        sameOriginOnlyStaticServer: true,
      },
      ...(expectedLayerCounts
        ? {
            denseProviderFixture: {
              scope:
                'real production /api/flights source plus bundled infrastructure layers; static-count integration smoke only, not paired timing evidence',
              expectedLayerCounts,
              observedLayerPopulation: finalDenseLayerPopulation,
              flightFixture: flightFixtureObservation,
              captureClock: {
                schema: 'gev-provider-fixture-capture-clock/v1',
                scope:
                  'hosted integration smoke only; one short route check, not a performance measurement',
                fixedTime: flightFixture.fixedTime,
                start: fixtureClockStart,
                end: fixtureClockEnd.clock,
                ageAtEndMs: fixtureAgeMs,
                freshnessWindowMs: 120_000,
                sourceFreshness: 'current',
              },
              comparisonEligible: false,
              comparisonIneligibilityReason:
                'This smoke verifies delivered fixture bytes and populations but does not establish the paired fixed-time measurement contract.',
            },
          }
        : {}),
      ...(mapStreamingNativeJourney ? { mapStreamingNativeJourney } : {}),
      ...(mapStreamingSmokeEvidence
        ? {
            mapStreamingFixtureSetup: {
              fixtureId: mapStreamingCaptureFixture?.id || null,
              manifestSha256:
                mapStreamingCaptureFixture?.manifestSha256 || null,
              delivery: mapStreamingSmokeEvidence,
              comparisonEligible: false,
            },
          }
        : {}),
      ...(captureCliDiagnostic ? { captureCliDiagnostic } : {}),
      terminalRenderLoopRetirement,
      rendererProbeCleanup,
      rendererProbeCleanupOmittedCount,
      serviceWorker: serviceWorkerState,
      browser: {
        requestedBackend: captureRendererBackend,
        softwareRenderingRequested:
          captureRendererBackend === DEFAULT_CAPTURE_RENDERER_BACKEND,
        flags: rendererLaunchArgs(captureRendererBackend),
        observedRenderer: after.environment.renderer,
        observedVendor: after.environment.vendor,
        ...(nativeRendererEvidence
          ? { nativeRendererDiagnostic: nativeRendererEvidence }
          : {}),
      },
      route,
      observerBefore: simplifyObservation(before),
      observerAfter: simplifyObservation(after),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const mapStreamingJourneyFailure =
      projectMapStreamingJourneyFailureForSmoke(
        error,
        mapStreamingCaptureModule,
      );
    error.smokeDiagnostics = {
      phase,
      pageErrors: pageErrors.slice(0, 4),
      interceptionErrors: (fixturePage?.errors || [])
        .slice(0, 4)
        .map(sanitizeError),
      ...(workerBlobDiagnostics ? { workerBlobDiagnostics } : {}),
      ...(phase === 'cesium-worker-blob-validation'
        ? { workerBlobValidationFailure: sanitizeError(error) }
        : {}),
      ...(error.captureCliFailure
        ? { captureCliFailure: error.captureCliFailure }
        : {}),
      ...(mapStreamingNativeJourney ? { mapStreamingNativeJourney } : {}),
      terminalRenderLoopRetirement,
      rendererProbeCleanup,
      rendererProbeCleanupOmittedCount,
      densePopulationObservations,
      ...(nativeRendererEvidence ? { nativeRendererEvidence } : {}),
    };
    attachMapStreamingJourneyFailureEvidence(error, mapStreamingJourneyFailure);
    failure = error;
  } finally {
    if (page) {
      try {
        const cleanupEvidence =
          await cleanupEarlyCesiumRendererProbeWithEvidence(
            page,
            earlyRendererProbeScriptIdentifier,
            1_000,
            { retireViewerRenderLoop: true },
          );
        cleanupEvidence.phase = 'smoke-document-retirement';
        if (earlyRendererProbeScriptIdentifier)
          cleanupEvidence.registrationRemovalBoundary =
            'owned-document-retirement';
        const earlyRendererProbeCleanup =
          recordRendererProbeCleanup(cleanupEvidence);
        if (earlyRendererProbeCleanup.confirmed !== true)
          cleanupErrors.push(
            sanitizeError(
              new Error(
                'Retired smoke document render-loop and probe cleanup was not confirmed.',
              ),
            ),
          );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
      try {
        await withTimeout(
          page.evaluate(restoreCesiumWorkerBlobAudit),
          3000,
          'Cesium worker blob audit cleanup',
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (fixturePage?.page) {
      try {
        await withTimeout(
          cleanupFixturePageDiagnostics(fixturePage.page),
          3000,
          'Page diagnostic cleanup',
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (
      context &&
      smokeProviderPreparationMode(providerFixture) ===
        'native-map-streaming' &&
      !mapStreamingInterceptionRelease
    ) {
      const finalized = await finalizeMapSmokeFixtureDocument({
        context,
        page,
        fixturePage,
        delivery: mapStreamingSmokeDelivery,
        fixture: mapStreamingCaptureFixture,
        captureModule: mapStreamingCaptureModule,
        documentRole: 'smoke-variant',
        documentId: `${label}-${commit}`,
      });
      mapStreamingInterceptionRelease = finalized.interceptionRelease;
      mapStreamingSmokeEvidence = finalized.deliveryEvidence;
      mapStreamingSmokeDelivery = null;
      if (mapStreamingInterceptionRelease.targetClosed) {
        context = null;
        page = null;
        fixturePage = null;
      }
      if (!finalized.confirmed) cleanupErrors.push(...finalized.errors);
      if (mapStreamingNativeJourney) {
        mapStreamingNativeJourney.delivery = mapStreamingSmokeEvidence;
        mapStreamingNativeJourney.interceptionRelease =
          mapStreamingInterceptionRelease;
        mapStreamingNativeJourney.rendering = mapStreamingRendering;
        mapStreamingNativeJourney.renderLoopRetirement =
          terminalRenderLoopRetirement;
        mapStreamingNativeJourney.terminalObservation = terminalMapObservation;
      }
    } else if (context) {
      try {
        await withTimeout(context.close(), 5000, 'Browser context cleanup');
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (mapStreamingSmokeDelivery) {
      try {
        mapStreamingSmokeEvidence = mapStreamingSmokeDelivery.dispose();
        mapStreamingSmokeDelivery = null;
        if (mapStreamingSmokeEvidence.cleanupConfirmed !== true)
          cleanupErrors.push(
            'Map fixture setup interception cleanup was not confirmed.',
          );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    try {
      await closeServer(served.server);
    } catch (error) {
      cleanupErrors.push(sanitizeError(error));
    }
  }
  if (cleanupErrors.length) {
    if (!failure) {
      failure = new Error('Smoke cleanup failed.');
      failure.smokeDiagnostics = {
        phase: 'cleanup',
        pageErrors: pageErrors.slice(0, 4),
        interceptionErrors: (fixturePage?.errors || [])
          .slice(0, 4)
          .map(sanitizeError),
      };
    }
    failure.smokeDiagnostics.cleanupErrors = cleanupErrors.slice(0, 3);
    failure.smokeDiagnostics.rendererProbeCleanup = rendererProbeCleanup;
    failure.smokeDiagnostics.rendererProbeCleanupOmittedCount =
      rendererProbeCleanupOmittedCount;
  }
  if (result && mapStreamingSmokeEvidence) {
    result.mapStreamingFixtureSetup = {
      fixtureId: mapStreamingCaptureFixture?.id || null,
      manifestSha256: mapStreamingCaptureFixture?.manifestSha256 || null,
      delivery: mapStreamingSmokeEvidence,
      comparisonEligible: false,
    };
  }
  if (failure)
    attachFinalizedMapStreamingFailureEvidence(failure, {
      fixture: mapStreamingCaptureFixture,
      deliveryEvidence: mapStreamingSmokeEvidence,
      interceptionRelease: mapStreamingInterceptionRelease,
    });
  if (failure) throw failure;
  return result;
}

async function main() {
  const {
    candidateSha,
    out,
    captureWorkerAuditMode = 'diagnostic',
    providerFixture = 'dense-investigation',
    sceneFrameDiagnostics = false,
    firstMotionCpuProfile = false,
    depthPickAttribution = false,
    shaderProgramAttribution = false,
    captureRendererBackend = DEFAULT_CAPTURE_RENDERER_BACKEND,
  } = parseSmokeArguments(process.argv.slice(2));
  assertSha(candidateSha, 'Candidate SHA');
  assert.notEqual(
    candidateSha,
    BASELINE_SHA,
    'Candidate must differ from baseline.',
  );
  let infrastructureCaptureFixture = null;
  let weatherEffectsCaptureFixture = null;
  let austinOperatingCaptureFixture = null;
  let mapStreamingCaptureFixture = null;
  let mapStreamingCaptureModule = null;
  let createMapStreamingFixtureDelivery = null;
  if (providerFixture.startsWith('infrastructure')) {
    const { createInfrastructureWorkloadFixture } =
      await import('./performance/infrastructureWorkloadFixture.mjs');
    infrastructureCaptureFixture =
      createInfrastructureWorkloadFixture(providerFixture);
  } else if (providerFixture === WEATHER_EFFECTS_WORKLOAD_ID) {
    const { createWeatherEffectsWorkloadFixture } =
      await import('./performance/weatherEffectsWorkloadFixture.mjs');
    weatherEffectsCaptureFixture = createWeatherEffectsWorkloadFixture();
  } else if (providerFixture === AUSTIN_OPERATING_WORKLOAD_ID) {
    const { createAustinOperatingWorkloadFixture } =
      await import('./performance/austinOperatingWorkloadFixture.mjs');
    austinOperatingCaptureFixture = createAustinOperatingWorkloadFixture();
  } else if (providerFixture === MAP_STREAMING_WORKLOAD_ID) {
    mapStreamingCaptureModule =
      await import('./performance/mapStreamingCapture.mjs');
    const { createDeterministicMapStreamingFixture } =
      await import('./performance/mapStreamingFixture.mjs');
    ({ createMapStreamingFixtureDelivery } =
      await import('./performance/mapStreamingFixtureDelivery.mjs'));
    mapStreamingCaptureFixture = await createDeterministicMapStreamingFixture();
  }
  const outputPath = path.resolve(
    out ||
      path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        'performance-build-smoke.json',
      ),
  );
  if (assertInside(ROOT, outputPath))
    throw new Error(
      'Smoke report must be written outside the harness checkout.',
    );
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
  const harnessCommit = git(['rev-parse', 'HEAD']);
  assertSha(harnessCommit, 'Harness SHA');
  for (const commit of [BASELINE_SHA, candidateSha])
    git(['cat-file', '-e', `${commit}^{commit}`]);

  const report = {
    schema: 'gev-performance-build-smoke/v1',
    scope:
      'hosted-browser integration smoke only; no hardware performance result or paired acceptance',
    status: 'running',
    baselineSha: BASELINE_SHA,
    candidateSha,
    harnessSha: harnessCommit,
    captureWorkerAuditMode,
    captureRendererBackend,
    comparisonEligible: false,
    performanceAcceptanceEligible: false,
    sceneFrameDiagnostics,
    firstMotionCpuProfile,
    depthPickAttribution,
    shaderProgramAttribution,
    ...(firstMotionCpuProfile
      ? {
          cpuProfileArtifactDirectory: path.basename(
            `${outputPath}.cpu-profile`,
          ),
        }
      : {}),
    candidateCaptureProviderFixture: providerFixture,
    startedAt: null,
    variants: [],
    limitations: [
      'Local build receipts are unsigned and do not attest hardware or release provenance.',
      'The browser request audit records code paths; it does not independently attest response bytes.',
      providerFixture === MAP_STREAMING_WORKLOAD_ID
        ? 'The map fixture runs its native journey on both exact revisions; the candidate also runs the full capture CLI. This hosted smoke is diagnostic only, not paired timing evidence.'
        : 'The production fixture is verified only for acknowledged delivery and static population counts; this smoke is not paired timing evidence.',
      providerFixture === MAP_STREAMING_WORKLOAD_ID
        ? 'Map-only preparation skips the unrelated dense aircraft, infrastructure and dam populations; other provider-fixture selections retain the dense integration checks.'
        : 'The candidate provider-fixture selection applies to the additional capture CLI; baseline and candidate build-smoke pages still run the dense integration checks.',
      captureRendererBackend === DEFAULT_CAPTURE_RENDERER_BACKEND
        ? 'Software rendering is explicit SwiftShader and cannot support hardware performance claims.'
        : 'Native rendering on a hosted macOS runner is a reachability diagnostic; Metal may be paravirtualized and is not physical desktop or paired performance evidence.',
    ],
    failure: null,
  };
  const configuredStart = process.env.GEV_PERF_SMOKE_STARTED_AT_MS;
  const startedAt = configuredStart ? Number(configuredStart) : Date.now();
  if (!Number.isSafeInteger(startedAt) || startedAt > Date.now())
    throw new Error('Smoke start clock input is invalid.');
  report.startedAt = new Date(startedAt).toISOString();
  await writeReport(report, outputPath);
  const budgetMs = DEFAULT_BUDGET_MS;
  let temporary = null;
  let browser = null;
  let browserGraphics = null;
  const worktrees = [];
  const cleanupErrors = [];
  try {
    if (captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
      validateNativeRendererDiagnosticHost();
    if (Date.now() - startedAt > budgetMs)
      throw new Error('Smoke time budget expired during runner setup.');
    const runnerTemp = await realpath(process.env.RUNNER_TEMP || os.tmpdir());
    temporary = await createOwnedTempRoot();
    assert.equal(temporary.parent, runnerTemp);
    for (const [label, commit] of [
      ['baseline', BASELINE_SHA],
      ['candidate', candidateSha],
    ]) {
      if (Date.now() - startedAt > budgetMs)
        throw new Error('Smoke time budget expired before source checkout.');
      worktrees.push(await addWorktree(temporary.root, label, commit));
    }
    await loadBrowserDependencies();
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 15_000,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        ...rendererLaunchArgs(captureRendererBackend),
      ],
    });
    if (captureRendererBackend === NATIVE_MACOS_DIAGNOSTIC_BACKEND)
      browserGraphics = await readBrowserGraphicsInfo(browser);
    for (const [index, [label, commit]] of [
      ['baseline', BASELINE_SHA],
      ['candidate', candidateSha],
    ].entries()) {
      if (Date.now() - startedAt > budgetMs)
        throw new Error('Smoke time budget expired before the next build.');
      const variant = {
        revision: commit,
        label,
        status: 'running',
      };
      report.variants.push(variant);
      await writeReport(report, outputPath);
      try {
        const result = await runRevision({
          browser,
          checkout: worktrees[index],
          commit,
          label,
          harnessCommit,
          tempRoot: temporary.root,
          startedAt,
          budgetMs,
          workerAuditMode: captureWorkerAuditMode,
          captureRendererBackend,
          browserGraphics,
          sceneFrameDiagnostics,
          firstMotionCpuProfile,
          depthPickAttribution,
          shaderProgramAttribution,
          captureCliReportArtifactPath: `${outputPath}.capture-cli-report-${label}.json`,
          profileArtifactDirectory: firstMotionCpuProfile
            ? path.join(`${outputPath}.cpu-profile`, `candidate-${startedAt}`)
            : null,
          providerFixture,
          infrastructureCaptureFixture,
          weatherEffectsCaptureFixture,
          austinOperatingCaptureFixture,
          mapStreamingCaptureFixture,
          mapStreamingCaptureModule,
          createMapStreamingFixtureDelivery,
        });
        Object.assign(variant, result);
        if (providerFixture === MAP_STREAMING_WORKLOAD_ID && index === 1) {
          const baselineLayerPopulation =
            report.variants[0]?.mapStreamingNativeJourney?.layerPopulation;
          const candidateLayerPopulation =
            variant.mapStreamingNativeJourney?.layerPopulation;
          assert.ok(baselineLayerPopulation && candidateLayerPopulation);
          assert.deepEqual(
            baselineLayerPopulation.enabledLayerIds,
            candidateLayerPopulation.enabledLayerIds,
            'Baseline and candidate map smokes must preserve the same observed application layer selection.',
          );
          assert.deepEqual(
            baselineLayerPopulation.before.map(({ id, enabled }) => [
              id,
              enabled,
            ]),
            candidateLayerPopulation.before.map(({ id, enabled }) => [
              id,
              enabled,
            ]),
            'Baseline and candidate map smokes must start from the same observed layer states.',
          );
        }
      } catch (error) {
        variant.status = 'failed';
        if (error.captureCliReportArtifact)
          variant.captureCliReportArtifact = error.captureCliReportArtifact;
        if (error.shaderProgramAttributionArtifact)
          variant.shaderProgramAttributionArtifact =
            error.shaderProgramAttributionArtifact;
        variant.failure = sanitizeError(error);
        variant.failureDetails = error.smokeDiagnostics || {
          phase: 'clean-build-or-server-start',
          pageErrors: [],
          interceptionErrors: [],
          ...(error.captureCliFailure
            ? { captureCliFailure: error.captureCliFailure }
            : {}),
        };
        throw error;
      }
      await writeReport(report, outputPath);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: sanitizeError(error),
      phase:
        report.variants.find((variant) => variant.status === 'failed')?.label ||
        report.variants.find((variant) => variant.status === 'running')
          ?.label ||
        'setup',
    };
  } finally {
    if (browser) {
      try {
        await withTimeout(browser.close(), 10_000, 'Browser cleanup');
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
        browser.process()?.kill();
      }
    }
    for (const worktree of worktrees.reverse()) {
      try {
        execFileSync(
          'git',
          ['-C', ROOT, 'worktree', 'remove', '--force', worktree],
          {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 15_000,
          },
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (temporary) {
      try {
        const canonical = await realpath(temporary.root);
        if (
          canonical !== temporary.root ||
          path.dirname(canonical) !== temporary.parent ||
          !path
            .basename(canonical)
            .startsWith('gev-performance-build-smoke-') ||
          !(await lstat(canonical)).isDirectory()
        )
          throw new Error(
            'Refusing cleanup outside the generated smoke directory.',
          );
        await rm(canonical, { recursive: true, force: false });
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    if (cleanupErrors.length) {
      report.cleanupErrors = cleanupErrors.slice(0, 4);
      report.status = 'failed';
    }
    await writeReport(report, outputPath);
  }
  process.stdout.write(
    `${JSON.stringify({ status: report.status, output: path.basename(outputPath) })}\n`,
  );
  if (report.status !== 'passed') process.exitCode = 1;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  try {
    await main();
  } catch (error) {
    const argv = process.argv.slice(2);
    const outIndex = argv.indexOf('--out');
    let outputPath = path.resolve(
      outIndex >= 0 && argv[outIndex + 1]
        ? argv[outIndex + 1]
        : path.join(
            process.env.RUNNER_TEMP || os.tmpdir(),
            'performance-build-smoke.json',
          ),
    );
    if (assertInside(ROOT, outputPath))
      outputPath = path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        'performance-build-smoke.json',
      );
    const failure = sanitizeError(error);
    let previous = null;
    try {
      previous = JSON.parse(await readFile(outputPath, 'utf8'));
    } catch {
      // Create a minimal bounded failure artifact when setup failed early.
    }
    const report = {
      ...(previous?.schema === 'gev-performance-build-smoke/v1'
        ? previous
        : {}),
      schema: 'gev-performance-build-smoke/v1',
      scope:
        'hosted-browser integration smoke only; no hardware performance result or paired acceptance',
      status: 'failed',
      failure: { phase: 'setup', message: failure },
      finishedAt: new Date().toISOString(),
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`).catch(
      () => {},
    );
    process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
  }
}
