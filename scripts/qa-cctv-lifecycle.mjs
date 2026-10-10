#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertCctvCameraPose,
  assertCctvCheckpoint,
  assertCctvCycleReuse,
  assertCctvStableDrain,
  assertExpectedCctvProbeResidue,
  cctvLifecycleShareHash,
  cctvGeometryTotals,
  cctvTaskErrorSignature,
  configureCctvLifecycleSceneInPage,
  createCctvLifecycleFixture,
  parseCctvLifecycleArgs,
  readCctvLifecycleCheckpointInPage,
  reinitializeDisabledCctvModuleInPage,
  setCctvLifecycleEnabledInPage,
  validateCctvLifecycleReport,
  waitForCctvLifecycleRenderInPage,
} from './performance/cctvLifecycle.mjs';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  launchFixtureBrowser,
  prepareFixturePage,
} from './qa-application-fixtures.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import {
  installLifecycleDrainObserver,
  installLifecycleRenderWaiter,
} from './performance/importWorkspaceLifecycle.mjs';
import {
  installLifecycleSceneReadinessObserver,
  readWorkerPreflight,
  waitForLifecycleSceneReadiness,
} from './qa-import-workspace-lifecycle.mjs';
import {
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import { readHostEnvironment } from './performance/rendererEvidence.mjs';

const SCRIPT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const BROWSER_CLOSE_TIMEOUT_MS = 5000;
const PAGE_PROTOCOL_TIMEOUT_MS = 5000;
const VIEWPORT = Object.freeze({ width: 1440, height: 1000 });
const CESIUM_VERSION = JSON.parse(
  readFileSync(
    path.join(SCRIPT_ROOT, 'node_modules/cesium/package.json'),
    'utf8',
  ),
).version;

function boundedText(error) {
  return String(error?.message || error || 'Unknown failure')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .slice(0, 500);
}

async function withDeadline(
  operation,
  label,
  timeoutMs = PAGE_PROTOCOL_TIMEOUT_MS,
) {
  let timer;
  const outcome = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(
        (value) => ({ status: 'completed', value }),
        (error) => ({ status: 'failed', error }),
      ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome.status === 'timeout')
    throw new Error(`${label} exceeded its ${timeoutMs}ms protocol deadline.`);
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

export function captureCctvFixtureResponse(fixture, url, baseOrigin) {
  if (!baseOrigin || url.origin !== baseOrigin || url.hash) return null;
  if (url.pathname === '/api/cctv/sources' && !url.search)
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sources: fixture.sources }),
    };
  if (url.pathname === '/api/cctv/health' && !url.search)
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cameras: fixture.health }),
    };
  if (
    url.pathname === `/api/cctv/frame/${encodeURIComponent(fixture.cameraId)}`
  )
    return {
      status: 200,
      contentType: 'image/png',
      headers: { 'cache-control': 'no-store' },
      body: Buffer.from(fixture.framePngBase64, 'base64'),
    };
  return null;
}

function gitIdentity() {
  const commit = execFileSync('git', ['-C', SCRIPT_ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const status = execFileSync(
    'git',
    ['-C', SCRIPT_ROOT, 'status', '--porcelain'],
    { encoding: 'utf8' },
  ).trim();
  const githubSha = process.env.GITHUB_SHA || null;
  return {
    commit,
    clean: status === '',
    githubSha,
    githubMatchesHead: githubSha === null || githubSha === commit,
  };
}

function workerTotals(checkpoint) {
  return cctvGeometryTotals(checkpoint);
}

async function readCheckpoint(
  page,
  {
    includeRenderer = false,
    expectedTaskErrors = null,
    requireSettled = true,
    fixtureView = null,
  } = {},
) {
  const checkpoint = await withDeadline(
    () =>
      page.evaluate(readCctvLifecycleCheckpointInPage, {
        includeRenderer,
        fixtureView,
      }),
    'read CCTV lifecycle checkpoint',
  );
  if (requireSettled) assertCctvCheckpoint(checkpoint, { expectedTaskErrors });
  return checkpoint;
}

function validDrainCandidate(snapshot, expectedTaskErrors) {
  if (!snapshot || snapshot.stats?.error || snapshot.worker?.overflow !== false)
    throw new Error('CCTV diagnostics are invalid while waiting for drain.');
  if (
    !snapshot.diagnostics ||
    !Number.isSafeInteger(snapshot.diagnostics.pendingJobs) ||
    snapshot.diagnostics.pendingJobs < 0 ||
    typeof snapshot.stats?.loading !== 'boolean'
  )
    throw new Error('CCTV owner drain counters are missing or invalid.');
  if (
    !Array.isArray(snapshot.worker?.workers) ||
    snapshot.worker.workers.length > 64
  )
    throw new Error('CCTV worker diagnostics are missing or overflowed.');
  for (const worker of snapshot.worker.workers) {
    for (const key of [
      'submitted',
      'completed',
      'cancelled',
      'pending',
      'taskErrors',
      'workerErrors',
      'postErrors',
    ]) {
      if (!Number.isSafeInteger(worker?.[key]) || worker[key] < 0)
        throw new Error(`CCTV worker counter ${key} is invalid.`);
    }
    if (worker.workerErrors || worker.postErrors)
      throw new Error(
        'CCTV worker reported a failed task during lifecycle drain.',
      );
  }
  const workerPending = snapshot.worker.workers.reduce(
    (sum, worker) => sum + worker.pending,
    0,
  );
  if (
    !Number.isSafeInteger(snapshot.worker.pending) ||
    snapshot.worker.pending < 0 ||
    workerPending !== snapshot.worker.pending
  )
    throw new Error('CCTV worker pending totals are inconsistent.');
  if (
    JSON.stringify(cctvTaskErrorSignature(snapshot)) !==
    JSON.stringify(expectedTaskErrors)
  )
    throw new Error(
      'CCTV worker error history changed during lifecycle drain.',
    );
  for (const worker of snapshot.worker.workers)
    if (
      worker.submitted !==
      worker.completed + worker.cancelled + worker.pending
    )
      throw new Error('CCTV worker task counters do not balance.');
  return (
    snapshot.diagnostics?.pendingJobs === 0 &&
    snapshot.stats?.loading === false &&
    snapshot.worker.pending === 0
  );
}

function cctvDrainSignature(snapshot) {
  return JSON.stringify({
    appCommit: snapshot.appCommit,
    enabled: snapshot.enabled,
    lifecycleState: snapshot.lifecycleState,
    moduleEnabled: snapshot.moduleEnabled,
    stats: snapshot.stats,
    cameras: snapshot.cameras,
    cameraCount: snapshot.cameraCount,
    activeCameraId: snapshot.activeCameraId,
    diagnostics: snapshot.diagnostics,
    scene: snapshot.scene,
    worker: snapshot.worker,
    cameraView: snapshot.cameraView,
    cameraPose: snapshot.cameraPose,
  });
}

export async function waitForCctvLifecycleDrain(
  page,
  timeoutMs,
  {
    expectedTaskErrors = [],
    onObservation = () => {},
    fixtureView = null,
    stableWindowMs = 1000,
    sampleIntervalMs = 100,
  } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new RangeError('CCTV drain timeout must be between 1 and 10000ms.');
  if (
    !Number.isSafeInteger(stableWindowMs) ||
    stableWindowMs < 1000 ||
    stableWindowMs > 5000 ||
    !Number.isSafeInteger(sampleIntervalMs) ||
    sampleIntervalMs < 50 ||
    sampleIntervalMs > 500
  )
    throw new RangeError('CCTV stable drain sampling options are invalid.');
  const startedAt = performance.now();
  let last = null;
  let stableStartedAt = null;
  let stableSignature = null;
  let stableSamples = 0;
  let firstStableFrame = null;
  let lastStableFrame = null;
  let maxPollGapMs = 0;
  let priorSampleAt = null;
  while (performance.now() - startedAt <= timeoutMs) {
    const remaining = timeoutMs - (performance.now() - startedAt);
    if (remaining <= 0) break;
    const renderTimeoutMs = Math.max(1, Math.min(5000, remaining));
    const render = await withDeadline(
      () => page.evaluate(waitForCctvLifecycleRenderInPage, renderTimeoutMs),
      'wait for CCTV drain sample render',
      remaining,
    );
    const afterRenderRemaining = timeoutMs - (performance.now() - startedAt);
    if (afterRenderRemaining <= 0) break;
    last = await withDeadline(
      () => readCheckpoint(page, { requireSettled: false, fixtureView }),
      'read CCTV stable drain sample',
      afterRenderRemaining,
    );
    last.render = render;
    if (fixtureView) assertCctvCameraPose(last, fixtureView);
    const ready = validDrainCandidate(last, expectedTaskErrors);
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const signature = ready ? cctvDrainSignature(last) : null;
    if (!ready || signature !== stableSignature) {
      stableStartedAt = ready ? elapsedMs : null;
      stableSignature = signature;
      stableSamples = ready ? 1 : 0;
      firstStableFrame = ready ? render.frameNumber : null;
      lastStableFrame = ready ? render.frameNumber : null;
      maxPollGapMs = 0;
      priorSampleAt = ready ? elapsedMs : null;
    } else {
      const sampleGapMs =
        priorSampleAt === null ? 0 : elapsedMs - priorSampleAt;
      if (sampleGapMs > 500) {
        stableStartedAt = elapsedMs;
        stableSamples = 1;
        firstStableFrame = render.frameNumber;
        maxPollGapMs = 0;
      } else {
        stableSamples++;
        maxPollGapMs = Math.max(maxPollGapMs, sampleGapMs);
      }
      priorSampleAt = elapsedMs;
      lastStableFrame = render.frameNumber;
    }
    const stableElapsedMs =
      stableStartedAt === null ? 0 : Math.max(0, elapsedMs - stableStartedAt);
    onObservation(
      {
        elapsedMs: Math.round(elapsedMs),
        pendingJobs: last.diagnostics.pendingJobs,
        workerPending: last.worker.pending,
        frameNumber: render.frameNumber,
        stableElapsedMs: Math.round(stableElapsedMs),
        stableSamples,
      },
      last,
    );
    if (
      ready &&
      elapsedMs <= timeoutMs &&
      stableElapsedMs >= stableWindowMs &&
      stableSamples >= Math.ceil(stableWindowMs / sampleIntervalMs)
    ) {
      assertCctvCheckpoint(last, { expectedTaskErrors });
      last.drainStability = {
        status: 'stable',
        windowMs: Math.round(stableElapsedMs),
        sampleCount: stableSamples,
        firstFrameNumber: firstStableFrame,
        lastFrameNumber: lastStableFrame,
        maximumSampleGapMs: Math.round(maxPollGapMs),
      };
      assertCctvStableDrain(last);
      return { checkpoint: last, elapsedMs, stability: last.drainStability };
    }
    const remainingAfterSample = timeoutMs - (performance.now() - startedAt);
    if (remainingAfterSample <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(sampleIntervalMs, remainingAfterSample)),
    );
  }
  const error = new Error(
    `CCTV lifecycle did not drain within ${timeoutMs}ms.`,
  );
  error.lastCheckpoint = last;
  error.drainStability = {
    status: 'timed-out',
    stableWindowMs:
      stableStartedAt === null
        ? 0
        : Math.max(0, performance.now() - startedAt - stableStartedAt),
    sampleCount: stableSamples,
    firstFrameNumber: firstStableFrame,
    lastFrameNumber: lastStableFrame,
    maximumSampleGapMs: Math.round(maxPollGapMs),
  };
  throw error;
}

async function renderAndDrain(
  page,
  report,
  phase,
  drainMs,
  expectedTaskErrors,
  onProgress,
) {
  report.phase = `${phase}:completed-render`;
  onProgress?.({ phase: report.phase }, report);
  const boundaryRender = await withDeadline(
    () => page.evaluate(waitForCctvLifecycleRenderInPage, 5000),
    `${phase} completed render`,
    7000,
  );
  report.phase = `${phase}:drain`;
  onProgress?.({ phase: report.phase }, report);
  const result = await waitForCctvLifecycleDrain(page, drainMs, {
    expectedTaskErrors,
    fixtureView: report.fixture.view,
    onObservation: (observation, lastCheckpoint) =>
      onProgress?.(
        {
          phase: report.phase,
          ...observation,
        },
        report,
        lastCheckpoint,
      ),
  });
  return {
    ...result.checkpoint,
    boundaryRender,
    drainElapsedMs: result.elapsedMs,
    drainStability: result.stability,
  };
}

function captureFixtureDelivery(fixture, counts) {
  return {
    id: fixture.id,
    sha256: fixture.sha256,
    cameraCount: fixture.sources.length,
    cameraId: fixture.cameraId,
    sourceResponses: counts.sources,
    healthResponses: counts.health,
    frameResponses: counts.frames,
    frameSha256: fixture.frameSha256,
    clockPolicy: fixture.clockPolicy,
    healthPolicy: 'fixed-empty-health-snapshot',
  };
}

export async function runCctvLifecycle({
  url,
  cycles = 5,
  drainMs = 10_000,
  expectedCommit,
  onProgress = () => {},
  dependencies = {},
}) {
  const deps = {
    gitIdentity,
    launchFixtureBrowser,
    prepareFixturePage,
    bootFixturePage,
    cleanupFixturePageDiagnostics,
    installWorkerDiagnostics,
    installLifecycleRenderWaiter,
    installLifecycleDrainObserver,
    installLifecycleSceneReadinessObserver,
    waitForLifecycleSceneReadiness,
    readWorkerPreflight,
    closeOwnedRecoveryPage,
    closeRecoveryBrowser,
    stopOwnedRecoveryProcessTree,
    ...dependencies,
  };
  const fixture = createCctvLifecycleFixture();
  const initialIdentity = deps.gitIdentity();
  const report = {
    schema: 'gev-cctv-lifecycle/v1',
    status: 'running',
    validationStatus: 'pending',
    startedAt: new Date().toISOString(),
    phase: 'identity',
    applicationCommit: null,
    applicationSourceCleanAtStart: false,
    applicationCommitAtEnd: null,
    applicationSourceCleanAtEnd: false,
    sourceChangedDuringRun: null,
    harnessCommit: initialIdentity.commit,
    githubSha: initialIdentity.githubSha,
    githubMatchesHeadAtStart: initialIdentity.githubMatchesHead,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      cameraCount: fixture.sources.length,
      cameraId: fixture.cameraId,
      frameSha256: fixture.frameSha256,
      clockPolicy: fixture.clockPolicy,
      view: fixture.view,
    },
    environment: {
      nodeVersion: process.version,
      host: readHostEnvironment(),
      cesiumVersion: CESIUM_VERSION,
      browserVersion: null,
      viewport: VIEWPORT,
    },
    sceneConfiguration: null,
    renderer: null,
    sceneReadiness: null,
    warmup: null,
    cycles: [],
    directReinit: null,
    fixtureDelivery: null,
    pageErrors: [],
    browserClose: null,
    failedPhase: null,
    error: null,
  };
  let browser = null;
  let context = null;
  let page = null;
  let pageErrors = [];
  let browserCloseStarted = false;
  const fixtureCounts = { sources: 0, health: 0, frames: 0 };
  report.applicationCommit = initialIdentity.commit;
  report.applicationSourceCleanAtStart = initialIdentity.clean;
  let primaryError = null;
  const progress = (event, currentReport = report, checkpoint = null) => {
    if (checkpoint) currentReport.lastObservedCheckpoint = checkpoint;
    onProgress(event, currentReport);
  };
  try {
    if (
      !expectedCommit ||
      initialIdentity.commit !== expectedCommit ||
      !initialIdentity.clean ||
      !initialIdentity.githubMatchesHead
    )
      throw new Error(
        'CCTV lifecycle requires the declared clean application/harness commit.',
      );
    const base = new URL(url).origin;
    browser = await deps.launchFixtureBrowser({ protocolTimeout: 15_000 });
    report.environment.browserVersion = await withDeadline(
      () => browser.version(),
      'read browser version',
    );
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.evaluateOnNewDocument(deps.installWorkerDiagnostics);
    const prepared = await deps.prepareFixturePage(browser, base, {
      page,
      viewport: VIEWPORT,
      respond: (requestUrl) =>
        captureCctvFixtureResponse(fixture, requestUrl, base),
      onFulfilled: (event) => {
        let fulfilledUrl;
        try {
          fulfilledUrl = new URL(event.url);
        } catch {
          return;
        }
        const isFrameRoute =
          fulfilledUrl.pathname ===
          `/api/cctv/frame/${encodeURIComponent(fixture.cameraId)}`;
        if (
          fulfilledUrl.origin !== base ||
          fulfilledUrl.hash ||
          (fulfilledUrl.search && !isFrameRoute)
        )
          return;
        if (
          fulfilledUrl.pathname === '/api/cctv/sources' &&
          !fulfilledUrl.search
        )
          fixtureCounts.sources = Math.min(1000, fixtureCounts.sources + 1);
        if (
          fulfilledUrl.pathname === '/api/cctv/health' &&
          !fulfilledUrl.search
        )
          fixtureCounts.health = Math.min(1000, fixtureCounts.health + 1);
        if (
          fulfilledUrl.pathname ===
          `/api/cctv/frame/${encodeURIComponent(fixture.cameraId)}`
        )
          fixtureCounts.frames = Math.min(1000, fixtureCounts.frames + 1);
      },
    });
    pageErrors = prepared.errors;
    report.phase = 'application-boot';
    await deps.bootFixturePage(page, base, {
      hash: cctvLifecycleShareHash(fixture.view),
      onProgress: (phase) => {
        report.phase = `application-boot:${phase}`;
        progress({ phase: report.phase });
      },
    });
    page.setDefaultTimeout(15_000);
    report.phase = 'disable-unrelated-layers';
    await withDeadline(
      () =>
        page.evaluate(async () => {
          const manager = window.__godsEyeView?.dataManager;
          if (!manager?.restoreEnabledLayerIds)
            throw new Error(
              'Public app layer lifecycle controls are unavailable.',
            );
          await manager.restoreEnabledLayerIds([], {
            origin: 'qa-cctv-lifecycle',
          });
          const layers = manager.getAll?.();
          if (!Array.isArray(layers) || layers.some((layer) => layer.enabled))
            throw new Error('Unrelated application layers remain enabled.');
          return layers.map((layer) => layer.id).slice(0, 128);
        }),
      'disable unrelated application layers',
      15_000,
    );
    report.phase = 'configure-cctv-fixture-scene';
    report.sceneConfiguration = await withDeadline(
      () => page.evaluate(configureCctvLifecycleSceneInPage, fixture.view),
      'configure CCTV fixture view',
    );
    await withDeadline(
      () => page.evaluate(deps.installLifecycleRenderWaiter),
      'install native render waiter',
    );
    await withDeadline(
      () => page.evaluate(deps.installLifecycleDrainObserver),
      'install lifecycle drain observer',
    );
    await withDeadline(
      () => page.evaluate(deps.installLifecycleSceneReadinessObserver),
      'install cold-scene observer',
    );
    report.phase = 'cold-scene-readiness';
    report.sceneReadiness = await deps.waitForLifecycleSceneReadiness(page, {
      timeoutMs: 30_000,
      onProgress: (event) => progress({ phase: report.phase, ...event }),
    });
    report.phase = 'worker-aware-fixture-preflight';
    report.workerPreflight = await deps.readWorkerPreflight(
      page,
      prepared.verifyNetwork,
      { quiescenceTimeoutMs: drainMs },
    );

    let initial = await readCheckpoint(page, {
      includeRenderer: true,
      requireSettled: false,
      fixtureView: fixture.view,
    });
    if (initial.enabled)
      throw new Error(
        'CCTV must be disabled at the cold application baseline.',
      );
    const expectedTaskErrors = assertExpectedCctvProbeResidue(initial);
    report.workerPreflight.expectedTaskErrorWorkers = expectedTaskErrors;
    report.servedApplicationCommit = initial.appCommit;
    if (initial.appCommit !== expectedCommit)
      throw new Error(
        'Served application commit does not match the declared source commit.',
      );
    report.renderer = initial.renderer;
    report.fixtureDelivery = captureFixtureDelivery(fixture, fixtureCounts);

    report.phase = 'warmup-enable';
    await withDeadline(
      () => page.evaluate(setCctvLifecycleEnabledInPage, true),
      'enable CCTV warmup',
      20_000,
    );
    const warmEnabled = await renderAndDrain(
      page,
      report,
      'warmup-enable',
      drainMs,
      expectedTaskErrors,
      progress,
    );
    if (
      !warmEnabled.enabled ||
      warmEnabled.cameraCount !== 1 ||
      warmEnabled.cameras[0]?.id !== fixture.cameraId
    )
      throw new Error(
        'CCTV warmup did not materialize the exact synthetic fixture camera.',
      );
    report.phase = 'warmup-disable';
    await withDeadline(
      () => page.evaluate(setCctvLifecycleEnabledInPage, false),
      'disable CCTV warmup',
      20_000,
    );
    const warmDisabled = await renderAndDrain(
      page,
      report,
      'warmup-disable',
      drainMs,
      expectedTaskErrors,
      progress,
    );
    if (
      warmDisabled.enabled ||
      warmDisabled.cameraCount !== 1 ||
      warmDisabled.cameras[0]?.id !== fixture.cameraId
    )
      throw new Error(
        'CCTV disabled warmup checkpoint does not preserve fixture identity.',
      );
    report.warmup = {
      enabled: warmEnabled,
      disabled: warmDisabled,
      createGeometrySubmitted:
        workerTotals(warmEnabled).activeCreateGeometrySubmitted,
      workerTotals: workerTotals(warmEnabled),
    };
    if (
      JSON.stringify(workerTotals(warmEnabled)) !==
      JSON.stringify(workerTotals(warmDisabled))
    )
      throw new Error(
        'CCTV createGeometry work changed while establishing warmup baselines.',
      );
    progress({ phase: 'warmup-complete', enabled: true, disabled: true });

    for (let cycle = 1; cycle <= cycles; cycle++) {
      const row = { cycle, status: 'running', phase: 'enable' };
      report.cycles.push(row);
      report.phase = `cycle-${cycle}:enable`;
      await withDeadline(
        () => page.evaluate(setCctvLifecycleEnabledInPage, true),
        `enable CCTV cycle ${cycle}`,
        20_000,
      );
      row.enabled = await renderAndDrain(
        page,
        report,
        `cycle-${cycle}-enable`,
        drainMs,
        expectedTaskErrors,
        progress,
      );
      row.enabledWorkerTotals = workerTotals(row.enabled);
      row.phase = 'disable';
      report.phase = `cycle-${cycle}:disable`;
      await withDeadline(
        () => page.evaluate(setCctvLifecycleEnabledInPage, false),
        `disable CCTV cycle ${cycle}`,
        20_000,
      );
      row.disabled = await renderAndDrain(
        page,
        report,
        `cycle-${cycle}-disable`,
        drainMs,
        expectedTaskErrors,
        progress,
      );
      row.disabledWorkerTotals = workerTotals(row.disabled);
      row.createGeometrySubmitted =
        row.enabledWorkerTotals.activeCreateGeometrySubmitted;
      row.phase = 'reuse-validation';
      report.phase = `cycle-${cycle}:reuse-validation`;
      assertCctvCycleReuse(row, report.warmup);
      row.status = 'passed';
      report.fixtureDelivery = captureFixtureDelivery(fixture, fixtureCounts);
      if (pageErrors.length)
        throw new Error('CCTV lifecycle browser reported a page error.');
      progress({ phase: report.phase, cycle, status: row.status });
    }

    report.phase = 'disabled-direct-module-reinit';
    report.directReinit = {
      scope: 'disabled-direct-module-init',
      status: 'running',
    };
    await withDeadline(
      () => page.evaluate(reinitializeDisabledCctvModuleInPage),
      'direct CCTV module reinitialization',
      20_000,
    );
    report.directReinit.initializedDisabled = await renderAndDrain(
      page,
      report,
      'direct-reinit-initialized-disabled',
      drainMs,
      expectedTaskErrors,
      progress,
    );
    await withDeadline(
      () => page.evaluate(setCctvLifecycleEnabledInPage, true),
      'enable CCTV after direct reinitialization',
      20_000,
    );
    report.directReinit.rewarmedEnabled = await renderAndDrain(
      page,
      report,
      'direct-reinit-enable',
      drainMs,
      expectedTaskErrors,
      progress,
    );
    await withDeadline(
      () => page.evaluate(setCctvLifecycleEnabledInPage, false),
      'disable CCTV after direct reinitialization',
      20_000,
    );
    report.directReinit.checkpoint = await renderAndDrain(
      page,
      report,
      'direct-reinit-disabled',
      drainMs,
      expectedTaskErrors,
      progress,
    );
    if (
      report.directReinit.checkpoint.enabled ||
      report.directReinit.checkpoint.cameraCount !== 1 ||
      report.directReinit.checkpoint.cameras[0]?.id !== fixture.cameraId
    )
      throw new Error(
        'CCTV direct disabled-module reinitialization changed owner state or fixture identity.',
      );
    if (
      JSON.stringify(workerTotals(report.directReinit.checkpoint)) !==
        JSON.stringify(workerTotals(report.directReinit.rewarmedEnabled)) ||
      workerTotals(report.directReinit.rewarmedEnabled)
        .activeCreateGeometrySubmitted < 1 ||
      JSON.stringify(report.directReinit.rewarmedEnabled.diagnostics) !==
        JSON.stringify(report.warmup.enabled.diagnostics) ||
      JSON.stringify(report.directReinit.checkpoint.diagnostics) !==
        JSON.stringify(report.warmup.disabled.diagnostics) ||
      JSON.stringify(report.directReinit.rewarmedEnabled.scene) !==
        JSON.stringify(report.warmup.enabled.scene) ||
      JSON.stringify(report.directReinit.checkpoint.scene) !==
        JSON.stringify(report.warmup.disabled.scene)
    )
      throw new Error(
        'CCTV direct reinitialization changed warmed worker or scene ownership.',
      );
    report.directReinit.status = 'passed';
    report.fixtureDelivery = captureFixtureDelivery(fixture, fixtureCounts);
    if (
      report.fixtureDelivery.sourceResponses < 2 ||
      report.fixtureDelivery.healthResponses < 2
    )
      throw new Error(
        'CCTV fixture source endpoints were not served for initialization and direct reinitialization.',
      );
    if (report.fixtureDelivery.frameResponses < 1)
      throw new Error(
        'CCTV synthetic frame fixture was not requested after activation.',
      );
    if (pageErrors.length)
      throw new Error('CCTV lifecycle browser reported a page error.');
  } catch (error) {
    primaryError = error;
    report.status = 'failed';
    report.error = boundedText(error);
    report.failedPhase = report.phase;
    if (error?.lastCheckpoint) report.lastCheckpoint = error.lastCheckpoint;
    if (error?.drainStability) report.lastDrainStability = error.drainStability;
    if (error?.sceneReadiness) report.sceneReadiness = error.sceneReadiness;
  } finally {
    if (page) {
      report.pageErrors = pageErrors
        .slice(0, 16)
        .map((error) => boundedText(error));
      try {
        await deps.cleanupFixturePageDiagnostics(page);
      } catch (error) {
        report.pageDiagnosticsCleanupError = boundedText(error);
        report.status = 'failed';
        report.error ||= report.pageDiagnosticsCleanupError;
      }
      if (context) {
        try {
          report.pageClose = await withDeadline(
            () => deps.closeOwnedRecoveryPage(page, context, 2000),
            'close owned CCTV fixture page',
            2500,
          );
          if (
            !report.pageClose.closeCompleted ||
            report.pageClose.openPageCount !== 0
          )
            throw new Error(
              'Owned CCTV page did not close with zero remaining pages.',
            );
          report.pageClose.scope = 'owned-context-only';
        } catch (error) {
          report.pageClose = {
            closeCompleted: false,
            error: boundedText(error),
          };
          report.status = 'failed';
          report.error ||= boundedText(error);
          report.failedPhase ||= 'owned-page-cleanup';
        }
      }
    }
    if (context) {
      try {
        await withDeadline(
          () => context.close(),
          'close owned CCTV browser context',
          2500,
        );
        report.contextClose = { completed: true };
      } catch (error) {
        report.contextClose = { completed: false, error: boundedText(error) };
        report.status = 'failed';
        report.error ||= report.contextClose.error;
        report.failedPhase ||= 'owned-context-cleanup';
      }
    }
    if (browser) {
      browserCloseStarted = true;
      try {
        report.browserClose = await deps.closeRecoveryBrowser(browser, {
          timeoutMs: BROWSER_CLOSE_TIMEOUT_MS,
          forceProcess: () =>
            deps.stopOwnedRecoveryProcessTree(browser.process()),
        });
        if (
          !report.browserClose.closeCompleted ||
          report.browserClose.forcedProcessTermination
        )
          throw new Error('Owned CCTV fixture browser did not close normally.');
      } catch (error) {
        report.status = 'failed';
        report.browserCloseError = boundedText(error);
        report.error ||= report.browserCloseError;
        report.failedPhase ||= 'browser-close';
      }
    } else if (!browserCloseStarted) {
      report.browserClose = { status: 'not-launched', confirmed: null };
    }
    const endingIdentity = deps.gitIdentity();
    report.applicationCommitAtEnd = endingIdentity.commit;
    report.applicationSourceCleanAtEnd = endingIdentity.clean;
    report.githubMatchesHeadAtEnd = endingIdentity.githubMatchesHead;
    report.sourceChangedDuringRun =
      report.applicationCommitAtEnd !== expectedCommit ||
      !report.applicationSourceCleanAtEnd ||
      !endingIdentity.githubMatchesHead;
    report.pageErrors = pageErrors
      .slice(0, 16)
      .map((error) => boundedText(error));
    report.fixtureDelivery = captureFixtureDelivery(fixture, fixtureCounts);
    if (report.sourceChangedDuringRun) {
      report.status = 'failed';
      report.error ||=
        'Application source identity changed during CCTV lifecycle run.';
      report.failedPhase ||= 'source-identity-at-end';
    }
    if (pageErrors.length) {
      report.status = 'failed';
      report.error ||= 'CCTV lifecycle page errors were observed.';
      report.failedPhase ||= report.phase;
    }
    if (report.status !== 'failed') {
      report.phase = 'report-validation';
      try {
        validateCctvLifecycleReport(
          { ...report, status: 'passed', validationStatus: 'passed' },
          { cycles, fixtureSha256: fixture.sha256 },
        );
        report.validationStatus = 'passed';
        report.status = 'passed';
      } catch (error) {
        report.status = 'failed';
        report.validationStatus = 'failed';
        report.error = boundedText(primaryError || error);
        report.failedPhase ||= 'report-validation';
      }
    } else report.validationStatus = 'failed';
    report.endedAt = new Date().toISOString();
  }
  return report;
}

export function writeCctvLifecycleReport(filename, report) {
  if (!filename) return;
  const absolute = path.resolve(filename);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  let options;
  let report = {
    schema: 'gev-cctv-lifecycle/v1',
    status: 'failed',
    validationStatus: 'failed',
    phase: 'arguments',
    cycles: [],
  };
  try {
    options = parseCctvLifecycleArgs(process.argv.slice(2));
    const commit =
      options.expectedCommit ||
      execFileSync('git', ['-C', SCRIPT_ROOT, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    const url = new URL(options.url);
    let lastWriteAt = 0;
    let lastWritePhase = null;
    report = await runCctvLifecycle({
      ...options,
      url: url.origin,
      expectedCommit: commit,
      onProgress: (event, currentReport) => {
        report = currentReport;
        report.phase = event.phase;
        if (Number.isSafeInteger(event.cycle))
          report.progressCycle = event.cycle;
        const now = Date.now();
        if (
          event.phase !== lastWritePhase ||
          now - lastWriteAt >= 1000 ||
          event.status === 'passed'
        ) {
          lastWriteAt = now;
          lastWritePhase = event.phase;
          try {
            writeCctvLifecycleReport(options.out, report);
          } catch (error) {
            report.reportWriteError = boundedText(error);
          }
        }
      },
    });
  } catch (error) {
    report.status = 'failed';
    report.validationStatus = 'failed';
    report.error = boundedText(error);
    report.failedPhase ||= report.phase;
  }
  try {
    writeCctvLifecycleReport(options?.out, report);
  } catch (error) {
    report.status = 'failed';
    report.validationStatus = 'failed';
    report.reportWriteError = boundedText(error);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
