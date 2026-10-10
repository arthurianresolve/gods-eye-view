#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertOwnedLifecycleCheckpoint,
  createLifecycleFailureEvidence,
  installLifecycleRenderWaiter,
  parseImportWorkspaceLifecycleArgs,
  runCooperativeImportLifecycleCase,
  runWorkspaceReplacementLifecycleCase,
  validateImportWorkspaceLifecycleReport,
} from './performance/importWorkspaceLifecycle.mjs';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  clickControl,
  launchFixtureBrowser,
  openWorkspace,
  readFixturePageDiagnostics,
  prepareFixturePage,
  seedPersistentWorkspace,
} from './qa-application-fixtures.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';

const DEFAULT_CYCLES = 5;
const FEATURE_COUNT = 512;
const SHA1 = /^[a-f0-9]{40}$/i;
const HOST_PROTOCOL_TIMEOUT_MS = 15_000;
const PAGE_CONTEXT_CLEANUP_TIMEOUT_MS = 2_000;
const FAILURE_OBSERVATION_TIMEOUT_MS = 1_500;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const PROGRESS_EVENT_CAP = 64;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createLifecycleImportFixture(count = FEATURE_COUNT) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000)
    throw new RangeError('Import fixture count must be between 1 and 5000.');
  const records = Array.from({ length: count }, (_, index) => ({
    id: `lifecycle-${String(index + 1).padStart(5, '0')}`,
    properties: { name: `Lifecycle fixture ${index + 1}` },
    geometry: {
      type: 'Point',
      coordinates: [
        -73.9 + (index % 32) * 0.001,
        40.7 + Math.floor(index / 32) * 0.001,
      ],
    },
  }));
  const imports = [
    {
      id: 'lifecycle-fixture',
      kind: 'geojson',
      attribution: 'Synthetic lifecycle fixture',
      records,
    },
  ];
  return Object.freeze({
    id: 'cooperative-import-v1',
    count,
    sha256: sha256(JSON.stringify(imports)),
    imports,
  });
}

export const WORKSPACE_IMPORT_FIXTURE_SHA256 = sha256(
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'fixture-point',
        properties: { name: 'Persistent fixture' },
        geometry: { type: 'Point', coordinates: [-73.9, 40.7] },
      },
    ],
  }),
);

function boundedText(value, limit = 500) {
  return String(value?.message || value || 'Unknown failure')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .slice(0, limit);
}

async function withProtocolDeadline(
  operation,
  label,
  timeoutMs = HOST_PROTOCOL_TIMEOUT_MS,
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
      timer = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome.status === 'timed-out')
    throw new Error(`Browser protocol ${label} exceeded ${timeoutMs}ms.`);
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

function evaluateWithDeadline(page, label, ...args) {
  return withProtocolDeadline(() => page.evaluate(...args), label);
}

async function closeOwnedPageAndContext(page, context) {
  const errors = [];
  const attempt = async (label, operation) => {
    let timer;
    const result = await Promise.race([
      Promise.resolve()
        .then(operation)
        .then(
          (value) => ({ status: 'completed', value }),
          (error) => ({ status: 'failed', error }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'timed-out' }),
          PAGE_CONTEXT_CLEANUP_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (result.status !== 'completed') {
      errors.push(
        new Error(
          `${label} ${result.status === 'timed-out' ? 'timed out' : boundedText(result.error)}`,
        ),
      );
    }
  };
  try {
    if (page && !page.isClosed())
      await attempt('Cancel page-owned render waiters', () =>
        page.evaluate(() => window.__qaLifecycleCancelAll?.()),
      );
  } catch (error) {
    errors.push(error);
  }
  if (page)
    await attempt('Remove page diagnostics', () =>
      cleanupFixturePageDiagnostics(page),
    );
  if (page && !page.isClosed())
    await attempt('Close owned lifecycle page', () => page.close());
  if (context)
    await attempt('Close owned lifecycle context', () => context.close());
  if (errors.length)
    throw new AggregateError(
      errors,
      'Owned lifecycle browser context cleanup failed.',
    );
}

async function startRenderedPopulationWait(
  page,
  workspaceId,
  count,
  timeoutMs,
  requireRestoreTransition = false,
) {
  return evaluateWithDeadline(
    page,
    'start-render-wait',
    (options) => window.__qaLifecycleStartRenderWait(options),
    { workspaceId, count, timeoutMs, requireRestoreTransition },
  );
}

async function finishRenderedPopulationWait(page, id) {
  try {
    return await evaluateWithDeadline(
      page,
      'finish-render-wait',
      (waitId) => window.__qaLifecycleWaitForRender(waitId),
      id,
    );
  } finally {
    await withProtocolDeadline(
      () =>
        page.evaluate(
          (waitId) => window.__qaLifecycleCancelRenderWait(waitId),
          id,
        ),
      'cancel-render-wait',
      1000,
    ).catch(() => {});
  }
}

function assertWorkerPreflight(value, { allowPending = false } = {}) {
  const expectedTasks = [
    ['geometry-cold', 'resolved'],
    ['geometry-reuse', 'resolved'],
    ['geometry-error', 'rejected-as-expected'],
    ['geometry-recovery', 'resolved'],
  ];
  if (
    value?.network?.status !== 'passed' ||
    value?.probe?.status !== 'passed' ||
    value?.probe?.tasks?.length !== expectedTasks.length ||
    expectedTasks.some(
      ([id, outcome], index) =>
        value.probe.tasks[index]?.id !== id ||
        value.probe.tasks[index]?.outcome !== outcome,
    ) ||
    value?.diagnostics?.instrumented !== true ||
    value.diagnostics.overflow !== false ||
    !Number.isSafeInteger(value.diagnostics.pending) ||
    value.diagnostics.pending < 0 ||
    (!allowPending && value.diagnostics.pending !== 0) ||
    !Array.isArray(value.diagnostics.workers) ||
    value.diagnostics.workers.length > 64 ||
    value.diagnostics.workers.reduce(
      (sum, worker) =>
        sum + (Number.isSafeInteger(worker?.pending) ? worker.pending : 0),
      0,
    ) !== value.diagnostics.pending ||
    value.diagnostics.workers.reduce(
      (sum, worker) =>
        sum +
        (Number.isSafeInteger(worker?.taskErrors) ? worker.taskErrors : 0),
      0,
    ) > 1 ||
    value.diagnostics.workers.some(
      (worker) =>
        worker?.kind !== 'createGeometry.js' && worker?.taskErrors !== 0,
    ) ||
    value.diagnostics.workers.some(
      (worker) =>
        worker?.taskErrors > 0 &&
        (worker.kind !== 'createGeometry.js' || worker.terminated !== true),
    ) ||
    value.diagnostics.workers.some(
      (worker) =>
        !Number.isSafeInteger(worker.submitted) ||
        !Number.isSafeInteger(worker.completed) ||
        !Number.isSafeInteger(worker.taskErrors) ||
        worker.taskErrors < 0 ||
        !Number.isSafeInteger(worker.pending) ||
        worker.pending < 0 ||
        !Number.isSafeInteger(worker.workerErrors) ||
        !Number.isSafeInteger(worker.postErrors) ||
        (!allowPending && worker.pending !== 0) ||
        worker.workerErrors !== 0 ||
        worker.postErrors !== 0,
    )
  )
    throw new Error('Worker network/MIME/completion preflight did not pass.');
  return {
    scope: 'cumulative-per-document',
    status: 'passed',
    network: value.network,
    taskCount: value.probe.tasks.length,
    cumulativeSubmitted: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.submitted,
      0,
    ),
    cumulativeCompleted: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.completed,
      0,
    ),
    cumulativeCancelled: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.cancelled,
      0,
    ),
    pendingAtPreflight: value.diagnostics.pending,
    overflow: value.diagnostics.overflow,
  };
}

export async function readWorkerPreflight(
  page,
  verifyNetwork,
  { quiescenceTimeoutMs = 10_000 } = {},
) {
  if (
    !Number.isSafeInteger(quiescenceTimeoutMs) ||
    quiescenceTimeoutMs < 1 ||
    quiescenceTimeoutMs > 10_000
  )
    throw new RangeError('Worker preflight quiescence limit is invalid.');
  let network = null;
  let value = null;
  let diagnosticsAtProbeCompletion = null;
  let pendingAtProbeCompletion = null;
  let quiescenceWaitMs = 0;
  let quiescenceStartedAt = null;
  let phase = 'network-probe';
  let networkError = null;
  let probeError = null;
  let diagnosticSnapshotError = null;
  try {
    try {
      network = await verifyNetwork();
    } catch (error) {
      networkError = error;
      throw error;
    }
    phase = 'worker-probe';
    try {
      value = await evaluateWithDeadline(page, 'worker-preflight', async () => {
        const { runCesiumWorkerProbe } =
          await import('/scripts/fixtures/cesium-worker-probe.js');
        const probe = await runCesiumWorkerProbe();
        return {
          probe,
          diagnostics: window.__gevSoakWorkers?.snapshot() || null,
        };
      });
    } catch (error) {
      probeError = error;
      throw error;
    }
    phase = 'worker-preflight-validation';
    pendingAtProbeCompletion = value?.diagnostics?.pending ?? null;
    diagnosticsAtProbeCompletion = value?.diagnostics || null;
    assertWorkerPreflight({ ...value, network }, { allowPending: true });
    if (pendingAtProbeCompletion > 0) {
      phase = 'worker-quiescence';
      quiescenceStartedAt = performance.now();
      await page.waitForFunction(
        () => {
          const diagnostics = window.__gevSoakWorkers?.snapshot?.();
          if (!diagnostics?.instrumented) return true;
          if (diagnostics.overflow) return true;
          if (!Array.isArray(diagnostics.workers)) return true;
          if (
            diagnostics.workers.some(
              (worker) =>
                worker.workerErrors > 0 ||
                worker.postErrors > 0 ||
                !Number.isSafeInteger(worker.taskErrors) ||
                worker.taskErrors < 0,
            )
          )
            return true;
          if (
            diagnostics.workers.reduce(
              (sum, worker) => sum + worker.taskErrors,
              0,
            ) > 1
          )
            return true;
          if (
            diagnostics.workers.some(
              (worker) =>
                worker.kind !== 'createGeometry.js' && worker.taskErrors !== 0,
            )
          )
            return true;
          if (
            diagnostics.workers.some(
              (worker) =>
                worker.taskErrors > 0 &&
                (worker.kind !== 'createGeometry.js' ||
                  worker.terminated !== true),
            )
          )
            return true;
          return diagnostics.pending === 0;
        },
        { timeout: quiescenceTimeoutMs, polling: 50 },
      );
      quiescenceWaitMs = Math.max(0, performance.now() - quiescenceStartedAt);
      quiescenceStartedAt = null;
      const diagnosticsAfterQuiescence = await evaluateWithDeadline(
        page,
        'read-worker-preflight-quiescence',
        () => window.__gevSoakWorkers?.snapshot() || null,
      );
      value = { ...value, diagnostics: diagnosticsAfterQuiescence };
      phase = 'worker-preflight-validation';
    }
    const result = assertWorkerPreflight({ ...value, network });
    return {
      ...result,
      pendingAtProbeCompletion,
      quiescenceWaitMs,
      quiescenceTimeoutMs,
    };
  } catch (error) {
    let diagnostics = value?.diagnostics || null;
    if (!diagnostics || phase === 'worker-quiescence') {
      try {
        diagnostics = await withProtocolDeadline(
          () =>
            page.evaluate(() => window.__gevSoakWorkers?.snapshot() || null),
          'read-preflight-failure-workers',
          FAILURE_OBSERVATION_TIMEOUT_MS,
        );
      } catch (snapshotError) {
        diagnosticSnapshotError = snapshotError;
      }
    }
    if (quiescenceStartedAt !== null)
      quiescenceWaitMs = Math.max(0, performance.now() - quiescenceStartedAt);
    error.lifecycleFailureEvidence = createLifecycleFailureEvidence({
      caseId: 'worker-preflight',
      phase,
      error,
      workerPreflight: {
        network,
        probe: value?.probe || null,
        diagnostics,
        diagnosticsAtProbeCompletion,
        pendingAtProbeCompletion,
        quiescenceWaitMs,
        quiescenceTimeoutMs,
        networkError,
        probeError,
        diagnosticSnapshotError,
      },
    });
    throw error;
  }
}

async function setupOwnedPage(
  browser,
  base,
  { expectedCommit, role, quiescenceTimeoutMs = 10_000, onProgress = () => {} },
) {
  onProgress(`create-context:${role}`);
  let context = null;
  let page = null;
  let setupPhase = 'create-context';
  const progress = [];
  try {
    context = await browser.createBrowserContext();
    setupPhase = 'create-page';
    onProgress(`create-page:${role}`);
    page = await context.newPage();
    await page.evaluateOnNewDocument(installWorkerDiagnostics);
    setupPhase = 'prepare-page';
    onProgress(`prepare-page:${role}`);
    const prepared = await prepareFixturePage(browser, base, { page });
    setupPhase = 'boot';
    await bootFixturePage(page, base, {
      onProgress: (phase) => {
        progress.push(phase);
        onProgress(`boot:${role}:${phase}`);
      },
      hash: `#qa-lifecycle-${role}`,
    });
    page.setDefaultTimeout(HOST_PROTOCOL_TIMEOUT_MS);
    setupPhase = 'disable-unrelated-layers';
    onProgress(`disable-unrelated-layers:${role}`);
    const disabledLayers = await evaluateWithDeadline(
      page,
      'disable-layers',
      async () => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager || typeof manager.restoreEnabledLayerIds !== 'function')
          throw new Error('Public layer lifecycle controls are unavailable.');
        await manager.restoreEnabledLayerIds([], {
          origin: 'qa-import-workspace-lifecycle',
        });
        const layers = manager.getAll?.();
        if (!Array.isArray(layers) || layers.some((layer) => layer.enabled))
          throw new Error('Unrelated application layers remain enabled.');
        return layers.map((layer) => layer.id).slice(0, 128);
      },
    );
    await evaluateWithDeadline(
      page,
      'install-render-waiter',
      installLifecycleRenderWaiter,
    );
    setupPhase = 'read-application-identity';
    const identity = await evaluateWithDeadline(
      page,
      'read-application-identity',
      () =>
        window.__godsEyeView?.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (!SHA1.test(identity || '') || identity !== expectedCommit)
      throw new Error(
        'Served application commit does not match the expected build.',
      );
    setupPhase = 'worker-preflight';
    onProgress(`worker-preflight:${role}`);
    const workerPreflight = await readWorkerPreflight(
      page,
      prepared.verifyNetwork,
      { quiescenceTimeoutMs },
    );
    onProgress(`ready:${role}`);
    return {
      context,
      page,
      errors: prepared.errors,
      progress,
      disabledLayers,
      allLayersDisabled: true,
      applicationCommit: identity,
      workerPreflight,
    };
  } catch (error) {
    const existingEvidence = error.lifecycleFailureEvidence;
    const failureEvidence = createLifecycleFailureEvidence({
      caseId: role,
      phase: existingEvidence?.failedPhase || setupPhase,
      error,
      workerPreflight: existingEvidence?.workerPreflight || null,
      pageDiagnostics: page ? readFixturePageDiagnostics(page) : null,
    });
    failureEvidence.setupPhase = setupPhase;
    failureEvidence.bootProgress = progress.slice(0, 16);
    error.lifecycleFailureEvidence = failureEvidence;
    try {
      await closeOwnedPageAndContext(page, context);
    } catch (cleanupError) {
      failureEvidence.cleanupError = boundedText(cleanupError);
      error.message += `; cleanup failed: ${boundedText(cleanupError)}`;
    }
    throw error;
  }
}

export function createLifecycleReport({
  expectedCommit,
  actualHarnessCommit,
  harnessSourceClean,
  applicationSourceClean,
  fixture,
  cycles,
  drainMs,
  startedAt = performance.now(),
}) {
  const report = {
    schema: 'gev-import-workspace-lifecycle/v1',
    status: 'pending',
    phase: 'initialize',
    elapsedMs: 0,
    applicationCommit: expectedCommit,
    harnessCommit: actualHarnessCommit,
    harnessSourceClean,
    applicationSourceClean,
    browserVersion: null,
    browserClose: null,
    environment: {
      platform: process.platform,
      nodeVersion: process.versions.node,
      softwareRenderingRequested: process.env.GEV_QA_SOFTWARE_RENDERING === '1',
      webglOnlyRequested: process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY === '1',
    },
    cycles,
    drainLimitMs: drainMs,
    fixtures: {
      cooperativeImportId: fixture.id,
      cooperativeImportSourceId: fixture.imports[0].id,
      cooperativeImportCount: fixture.count,
      cooperativeImportRecordIds: fixture.imports[0].records.map(
        (record) => record.id,
      ),
      cooperativeImportSha256: fixture.sha256,
      workspaceImportId: 'workspace-synthetic-point-v1',
      workspaceImportCount: 1,
      workspaceImportSha256: WORKSPACE_IMPORT_FIXTURE_SHA256,
    },
    cases: [],
    progressEvents: [],
  };
  Object.defineProperty(report, '_startedAt', { value: startedAt });
  return report;
}

export function validateLifecycleCandidate(report, expected) {
  return validateImportWorkspaceLifecycleReport(
    { ...report, status: 'passed' },
    expected,
  );
}

export function finalizeLifecycleReportStatus(report, { ownsBrowser }) {
  if (report.status === 'failed') return report.status;
  if (
    report.validationStatus === 'passed' &&
    (!ownsBrowser || report.browserClose?.closeCompleted === true)
  ) {
    report.status = 'passed';
  } else {
    report.status = 'failed';
    report.error ||= 'Lifecycle validation or owned cleanup was incomplete.';
  }
  return report.status;
}

function recordLifecycleProgress(report, phase, caseId = null) {
  report.phase = String(phase).slice(0, 120);
  report.currentCase = caseId;
  report.elapsedMs = Math.max(0, performance.now() - report._startedAt);
  const events = report.progressEvents;
  events.push({ phase: report.phase, caseId, elapsedMs: report.elapsedMs });
  if (events.length > PROGRESS_EVENT_CAP) events.shift();
}

async function pageSnapshot(page) {
  const snapshot = await evaluateWithDeadline(
    page,
    'read-page-snapshot',
    () => {
      const app = window.__godsEyeView;
      const layer = app?.importedGeometryLayer;
      const importState = layer?.getState?.();
      const importDiagnostics = layer?.getPerformanceDiagnostics?.();
      const scene = app?.viewer?.scene;
      const importEntities =
        app?.viewer?.entities?.values?.filter((entity) =>
          String(entity.id).startsWith('gev-import:'),
        ) || [];
      const worker = window.__gevSoakWorkers?.snapshot?.() || null;
      return {
        imports: {
          featureCount: importState?.featureCount ?? null,
          pendingJobs: importState?.pendingJobs ?? null,
          cacheEntries: importDiagnostics?.cacheEntries ?? null,
        },
        importEntityIds:
          app?.viewer?.entities?.values
            ?.filter((entity) => String(entity.id).startsWith('gev-import:'))
            .map((entity) => String(entity.id))
            .slice(0, 5000) ?? null,
        importEntityRecords: importEntities.slice(0, 5000).map((entity) => {
          const position = entity.position?.getValue(
            app.viewer.clock.currentTime,
          );
          return {
            id: String(entity.id),
            name: String(entity.name || ''),
            position: position ? [position.x, position.y, position.z] : null,
          };
        }),
        scene: {
          entities: app?.viewer?.entities?.values?.length ?? null,
          dataSources: app?.viewer?.dataSources?.length ?? null,
          primitives: scene?.primitives?.length ?? null,
          groundPrimitives: scene?.groundPrimitives?.length ?? null,
        },
        restore: app?.workspaceLibraryPanel?.restore?.getState?.() || null,
        workerCounters: worker
          ? {
              scope: 'cumulative-per-document',
              instrumented: worker.instrumented,
              overflow: worker.overflow,
              pending: worker.pending,
              workers: worker.workers.slice(0, 64).map((entry) => ({
                kind: entry.kind,
                submitted: entry.submitted,
                completed: entry.completed,
                taskErrors: entry.taskErrors,
                workerErrors: entry.workerErrors,
                postErrors: entry.postErrors,
                cancelled: entry.cancelled,
                pending: entry.pending,
                oldestPendingMs: entry.oldestPendingMs,
                terminated: entry.terminated,
              })),
            }
          : null,
        diagnostics: {
          scope: 'point-in-time-no-forced-gc-no-plateau-claim',
          jsHeapUsedBytes: Number.isFinite(performance.memory?.usedJSHeapSize)
            ? performance.memory.usedJSHeapSize
            : null,
          browserEventListeners: null,
        },
      };
    },
  );
  const metrics = await withProtocolDeadline(
    () => page.metrics(),
    'read-page-metrics',
  );
  snapshot.diagnostics.browserEventListeners = Number.isFinite(
    metrics.JSEventListeners,
  )
    ? metrics.JSEventListeners
    : null;
  snapshot.diagnostics.jsHeapUsedBytes = Number.isFinite(metrics.JSHeapUsedSize)
    ? metrics.JSHeapUsedSize
    : snapshot.diagnostics.jsHeapUsedBytes;
  return snapshot;
}

async function readFailureObservation(page) {
  return withProtocolDeadline(
    () =>
      page.evaluate(() => {
        const app = window.__godsEyeView;
        const layer = app?.importedGeometryLayer;
        const importState = layer?.getState?.();
        const importDiagnostics = layer?.getPerformanceDiagnostics?.();
        const scene = app?.viewer?.scene;
        const workers = window.__gevSoakWorkers?.snapshot?.() || null;
        const safeInteger = (value) =>
          Number.isSafeInteger(value) && value >= 0 ? value : null;
        return {
          imports: {
            featureCount: safeInteger(importState?.featureCount),
            pendingJobs: safeInteger(importState?.pendingJobs),
            cacheEntries: safeInteger(importDiagnostics?.cacheEntries),
          },
          workerCounters: workers
            ? {
                scope: 'cumulative-per-document',
                instrumented: workers.instrumented,
                overflow: workers.overflow,
                pending: safeInteger(workers.pending),
                workerCount: Array.isArray(workers.workers)
                  ? workers.workers.length
                  : 0,
                workers: (Array.isArray(workers.workers) ? workers.workers : [])
                  .slice(0, 64)
                  .map((worker) => ({
                    kind: worker.kind,
                    submitted: worker.submitted,
                    completed: worker.completed,
                    taskErrors: worker.taskErrors,
                    workerErrors: worker.workerErrors,
                    postErrors: worker.postErrors,
                    cancelled: worker.cancelled,
                    pending: worker.pending,
                    oldestPendingMs: Number.isFinite(worker.oldestPendingMs)
                      ? worker.oldestPendingMs
                      : null,
                    terminated: worker.terminated,
                  })),
                workersTruncated:
                  Array.isArray(workers.workers) && workers.workers.length > 64,
              }
            : null,
          frame: {
            frameNumber: safeInteger(scene?.frameState?.frameNumber),
            requestRenderMode:
              typeof scene?.requestRenderMode === 'boolean'
                ? scene.requestRenderMode
                : null,
            renderRequested:
              typeof scene?._renderRequested === 'boolean'
                ? scene._renderRequested
                : null,
            renderWaiters:
              window.__qaLifecycleRenderWaitSnapshot?.().slice(0, 8) || null,
          },
          scene: {
            entities: safeInteger(app?.viewer?.entities?.values?.length),
            dataSources: safeInteger(app?.viewer?.dataSources?.length),
            primitives: safeInteger(scene?.primitives?.length),
            groundPrimitives: safeInteger(scene?.groundPrimitives?.length),
          },
        };
      }),
    'read-lifecycle-failure-observation',
    FAILURE_OBSERVATION_TIMEOUT_MS,
  );
}

function makeImportDriver(
  page,
  fixture,
  drainMs,
  workerPreflight,
  applicationCommit,
  onPhase,
) {
  let failureOperation = null;
  let lastFailureObservation = null;
  let failureObservationAttempted = false;
  let failureObservationError = null;
  const captureFailureObservation = async () => {
    if (failureObservationAttempted) return;
    failureObservationAttempted = true;
    try {
      lastFailureObservation = await readFailureObservation(page);
    } catch (error) {
      failureObservationError = error;
    }
  };
  return {
    onPhase,
    async checkpoint() {
      return pageSnapshot(page);
    },
    async load({ kind, cycle }) {
      const workspaceId =
        kind === 'warmup' ? 'lifecycle-warmup' : `lifecycle-measured-${cycle}`;
      return evaluateWithDeadline(
        page,
        `load-import-${kind}-${cycle ?? 'warmup'}`,
        async ({ imports, workspaceId, timeoutMs }) => {
          const app = window.__godsEyeView;
          const waitId = window.__qaLifecycleStartRenderWait({
            workspaceId,
            count: imports[0].records.length,
            timeoutMs,
          });
          try {
            const result = await app.importedGeometryLayer.loadAsync(imports, {
              workspaceId,
            });
            const renderedPopulation =
              await window.__qaLifecycleWaitForRender(waitId);
            return {
              ...result,
              renderedPopulation,
              importEntityIds: app.viewer.entities.values
                .filter((entity) => String(entity.id).startsWith('gev-import:'))
                .map((entity) => String(entity.id))
                .slice(0, 5000),
            };
          } finally {
            window.__qaLifecycleCancelRenderWait(waitId);
          }
        },
        { imports: fixture.imports, workspaceId, timeoutMs: drainMs },
      );
    },
    async cancelQueued({ cycle }) {
      const result = await evaluateWithDeadline(
        page,
        `cancel-queued-import-${cycle}`,
        async ({ imports, cycle }) => {
          const layer = window.__godsEyeView.importedGeometryLayer;
          const controller = new AbortController();
          const pending = layer.loadAsync(imports, {
            workspaceId: `cancel-${cycle}`,
            signal: controller.signal,
          });
          const queuedObserved =
            layer.getState().pendingJobs === 1 &&
            layer.getState().featureCount < imports[0].records.length;
          if (!queuedObserved) {
            controller.abort();
            await pending.catch(() => {});
            return {
              status: 'not-queued',
              queuedObserved: false,
              snapshot: null,
            };
          }
          controller.abort('lifecycle-cancel');
          let status = 'unexpected-resolve';
          try {
            await pending;
          } catch (error) {
            status = error.name === 'AbortError' ? 'cancelled' : 'failed';
          }
          return {
            status,
            queuedObserved,
            snapshot: null,
          };
        },
        { imports: fixture.imports, cycle },
      );
      return { ...result, snapshot: await pageSnapshot(page) };
    },
    async supersedeQueued({ cycle }) {
      const result = await evaluateWithDeadline(
        page,
        `supersede-queued-import-${cycle}`,
        async ({ imports, cycle, timeoutMs }) => {
          const layer = window.__godsEyeView.importedGeometryLayer;
          const replacementWorkspaceId = `lifecycle-replacement-${cycle}`;
          const waitId = window.__qaLifecycleStartRenderWait({
            workspaceId: replacementWorkspaceId,
            count: imports[0].records.length,
            timeoutMs,
          });
          try {
            const oldPending = layer.loadAsync(imports, {
              workspaceId: `superseded-${cycle}`,
            });
            const queuedObserved =
              layer.getState().pendingJobs === 1 &&
              layer.getState().featureCount < imports[0].records.length;
            let oldStatus = 'unexpected-resolve';
            const oldSettled = oldPending.then(
              () => oldStatus,
              (error) =>
                (oldStatus =
                  error.name === 'AbortError' ? 'cancelled' : 'failed'),
            );
            const replacementPending = layer.loadAsync(imports, {
              workspaceId: replacementWorkspaceId,
            });
            const replacement = await replacementPending;
            await oldSettled;
            const renderedPopulation =
              await window.__qaLifecycleWaitForRender(waitId);
            const allIds = window.__godsEyeView.viewer.entities.values
              .filter((entity) => String(entity.id).startsWith('gev-import:'))
              .map((entity) => String(entity.id))
              .slice(0, 5000);
            return {
              oldStatus,
              queuedObserved,
              oldIdsStillPresent: allIds.some((id) =>
                id.startsWith(`gev-import:superseded-${cycle}:`),
              ),
              replacement: {
                ...replacement,
                renderedPopulation,
                importEntityIds: allIds,
              },
            };
          } finally {
            window.__qaLifecycleCancelRenderWait(waitId);
          }
        },
        { imports: fixture.imports, cycle, timeoutMs: drainMs },
      );
      return { ...result, snapshot: await pageSnapshot(page) };
    },
    async clearAndDrain() {
      const waitId = await startRenderedPopulationWait(
        page,
        '__empty__',
        0,
        drainMs,
      );
      failureOperation = {
        name: 'clear-and-drain',
        status: 'waiting-for-empty-import-and-idle-workers',
        renderWaitId: waitId,
        renderWaitStatus: 'pending',
      };
      lastFailureObservation = null;
      failureObservationAttempted = false;
      failureObservationError = null;
      try {
        await evaluateWithDeadline(page, 'clear-import-and-drain', () => {
          const app = window.__godsEyeView;
          app.importedGeometryLayer.clear();
          app.viewer.scene.requestRender();
        });
        await page.waitForFunction(
          () => {
            const state =
              window.__godsEyeView?.importedGeometryLayer?.getState?.();
            const workers = window.__gevSoakWorkers?.snapshot?.();
            return (
              state?.pendingJobs === 0 &&
              state.featureCount === 0 &&
              workers?.pending === 0 &&
              workers.overflow === false
            );
          },
          { timeout: drainMs, polling: 50 },
        );
        const renderedPopulation = await finishRenderedPopulationWait(
          page,
          waitId,
        );
        const result = { ...(await pageSnapshot(page)), renderedPopulation };
        failureOperation.status = 'completed';
        failureOperation.renderWaitStatus = 'completed';
        failureOperation = null;
        return result;
      } catch (error) {
        failureOperation.status = /timed out|timeout|\b\d+ms exceeded\b/i.test(
          String(error?.message || error),
        )
          ? 'timed-out'
          : 'failed';
        failureOperation.error = error;
        await captureFailureObservation();
        const waiter = lastFailureObservation?.frame?.renderWaiters?.find(
          (item) => item.id === waitId,
        );
        failureOperation.renderWaitStatus =
          waiter?.status || 'not-observed-before-cancel';
        await withProtocolDeadline(
          () =>
            page.evaluate(
              (id) => window.__qaLifecycleCancelRenderWait(id),
              waitId,
            ),
          'cancel-render-wait-after-clear-failure',
          1000,
        ).catch(() => {});
        throw error;
      }
    },
    async workerCounters() {
      return evaluateWithDeadline(page, 'read-import-worker-counters', () => {
        const value = window.__gevSoakWorkers?.snapshot() || null;
        return value ? { ...value, scope: 'cumulative-per-document' } : null;
      });
    },
    async close() {
      await closeOwnedPageAndContext(page, page.browserContext());
    },
    async failureEvidence({ phase, error }) {
      await captureFailureObservation();
      return createLifecycleFailureEvidence({
        caseId: 'cooperative-import',
        phase,
        error,
        operation: failureOperation,
        observation: lastFailureObservation,
        observationError: failureObservationError,
      });
    },
    workerPreflight,
    applicationCommit,
  };
}

function makeWorkspaceDriver(
  page,
  drainMs,
  workerPreflight,
  applicationCommit,
  onPhase,
) {
  let failureOperation = null;
  let lastFailureObservation = null;
  let failureObservationError = null;
  return {
    onPhase,
    async seed() {
      const baseline = await seedPersistentWorkspace(page);
      const initialId = baseline.id;
      await clickControl(page, '.workspace-library [data-action="duplicate"]');
      await page.waitForFunction(
        (id) => {
          const selected = document.querySelector(
            '.workspace-library [data-workspace-select]',
          )?.value;
          return selected && selected !== id;
        },
        { timeout: 30_000, polling: 50 },
        initialId,
      );
      const alternateId = await page.$eval(
        '.workspace-library [data-workspace-select]',
        (select) => select.value,
      );
      return {
        baselineId: initialId,
        alternateId,
        featureCount: 1,
        fixtureSha256: baseline.sha256,
      };
    },
    async open(id) {
      const waitId = await startRenderedPopulationWait(
        page,
        id,
        1,
        drainMs,
        true,
      );
      failureOperation = {
        name: 'open-workspace',
        status: 'waiting-for-workspace-restore',
        renderWaitId: waitId,
        renderWaitStatus: 'pending',
        workspaceId: id,
      };
      lastFailureObservation = null;
      failureObservationError = null;
      try {
        await openWorkspace(page, id, { timeoutMs: drainMs });
        await page.waitForFunction(
          (workspaceId) => {
            const app = window.__godsEyeView;
            const state = app?.importedGeometryLayer?.getState?.();
            const restore = app?.workspaceLibraryPanel?.restore?.getState?.();
            return (
              restore?.status === 'applied' &&
              restore.workspaceId === workspaceId &&
              state?.pendingJobs === 0 &&
              state?.featureCount === 1 &&
              window.__gevSoakWorkers?.snapshot?.()?.pending === 0
            );
          },
          { timeout: drainMs, polling: 50 },
          id,
        );
        const renderedPopulation = await finishRenderedPopulationWait(
          page,
          waitId,
        );
        const result = { ...(await pageSnapshot(page)), renderedPopulation };
        failureOperation = null;
        return result;
      } catch (error) {
        failureOperation.status = /timed out|timeout|\b\d+ms exceeded\b/i.test(
          String(error?.message || error),
        )
          ? 'timed-out'
          : 'failed';
        failureOperation.error = error;
        try {
          lastFailureObservation = await readFailureObservation(page);
        } catch (snapshotError) {
          failureObservationError = snapshotError;
        }
        throw error;
      } finally {
        if (failureOperation) {
          const waitIdToCancel = failureOperation.renderWaitId;
          failureOperation.renderWaitStatus =
            'cancelled-after-operation-failure';
          await withProtocolDeadline(
            () =>
              page.evaluate(
                (id) => window.__qaLifecycleCancelRenderWait(id),
                waitIdToCancel,
              ),
            'cancel-render-wait-after-workspace-failure',
            1000,
          ).catch(() => {});
        }
      }
    },
    async workerCounters() {
      return evaluateWithDeadline(
        page,
        'read-workspace-worker-counters',
        () => {
          const value = window.__gevSoakWorkers?.snapshot() || null;
          return value ? { ...value, scope: 'cumulative-per-document' } : null;
        },
      );
    },
    async failureEvidence({ phase, error }) {
      let observation = null;
      if (lastFailureObservation) {
        observation = lastFailureObservation;
      } else if (!failureObservationError) {
        try {
          observation = await readFailureObservation(page);
        } catch (snapshotError) {
          failureObservationError = snapshotError;
        }
      }
      return createLifecycleFailureEvidence({
        caseId: 'workspace-replacement',
        phase,
        error,
        operation: failureOperation,
        observation,
        observationError: failureObservationError,
      });
    },
    async close() {
      await closeOwnedPageAndContext(page, page.browserContext());
    },
    workerPreflight,
    applicationCommit,
  };
}

function addWorkerAndHeapDiagnostics(snapshot) {
  if (!snapshot || !snapshot.workerCounters)
    throw new Error('Worker diagnostics are missing from a checkpoint.');
  if (
    snapshot.workerCounters.instrumented !== true ||
    typeof snapshot.workerCounters.overflow !== 'boolean' ||
    !Number.isSafeInteger(snapshot.workerCounters.pending) ||
    snapshot.workerCounters.pending < 0 ||
    !Array.isArray(snapshot.workerCounters.workers) ||
    snapshot.workerCounters.workers.length > 64
  )
    throw new Error('Worker counters are malformed or exceeded their bound.');
  assertOwnedLifecycleCheckpoint(snapshot, {
    featureCount: snapshot.imports.featureCount,
    pendingJobs: snapshot.imports.pendingJobs,
  });
  return {
    ...snapshot,
    workerCounters: {
      ...snapshot.workerCounters,
      workers: snapshot.workerCounters.workers.map((worker) => ({
        ...worker,
        submitted: Number.isSafeInteger(worker.submitted)
          ? worker.submitted
          : -1,
        completed: Number.isSafeInteger(worker.completed)
          ? worker.completed
          : -1,
        cancelled: Number.isSafeInteger(worker.cancelled)
          ? worker.cancelled
          : -1,
        pending: Number.isSafeInteger(worker.pending) ? worker.pending : -1,
      })),
    },
  };
}

export async function runImportWorkspaceLifecycle({
  url,
  expectedCommit,
  cycles = DEFAULT_CYCLES,
  drainMs = 10_000,
  featureCount = FEATURE_COUNT,
  harnessCommit = null,
  browser = null,
  launchBrowser = launchFixtureBrowser,
  onProgress = () => {},
} = {}) {
  if (!SHA1.test(expectedCommit || ''))
    throw new TypeError('A full expected application commit is required.');
  const fixture = createLifecycleImportFixture(featureCount);
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10)
    throw new RangeError('Lifecycle cycles must be between 1 and 10.');
  if (!Number.isSafeInteger(drainMs) || drainMs < 1 || drainMs > 10_000)
    throw new RangeError(
      'Lifecycle drain limit must be between 1 and 10000ms.',
    );
  const scriptRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const actualHarnessCommit =
    harnessCommit ||
    execFileSync('git', ['-C', scriptRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  if (!SHA1.test(actualHarnessCommit))
    throw new Error('Harness checkout commit could not be verified.');
  const harnessSourceClean =
    execFileSync(
      'git',
      [
        '-C',
        scriptRoot,
        'status',
        '--porcelain',
        '--',
        'scripts/qa-import-workspace-lifecycle.mjs',
        'scripts/performance/importWorkspaceLifecycle.mjs',
      ],
      { encoding: 'utf8' },
    ).trim() === '';
  const applicationSourceClean =
    execFileSync(
      'git',
      [
        '-C',
        scriptRoot,
        'status',
        '--porcelain',
        '--',
        'src',
        'public',
        'build/vite.js',
        'index.html',
        'package.json',
        'package-lock.json',
        'vite.config.js',
      ],
      { encoding: 'utf8' },
    ).trim() === '';
  const workspaceFixtureSha256 = WORKSPACE_IMPORT_FIXTURE_SHA256;
  const ownsBrowser = !browser;
  const report = createLifecycleReport({
    expectedCommit,
    actualHarnessCommit,
    harnessSourceClean,
    applicationSourceClean,
    fixture,
    cycles,
    drainMs,
  });
  const emitProgress = (phase, caseId = null, caseProgress = null) => {
    if (report.status === 'pending') report.status = 'running';
    recordLifecycleProgress(report, phase, caseId);
    if (caseProgress) {
      report.activeCase = {
        id: caseId,
        phase: String(caseProgress.phase || phase).slice(0, 120),
        operations: { ...caseProgress.operations },
        checkpointCount: Array.isArray(caseProgress.checkpoints)
          ? caseProgress.checkpoints.length
          : 0,
      };
    } else if (caseId === null) {
      delete report.activeCase;
    }
    try {
      onProgress(report);
    } catch (error) {
      report.progressWriteError = boundedText(error);
    }
  };
  let caseId = null;
  let browserCloseStarted = false;
  let browserLaunchAttempted = Boolean(browser);
  emitProgress('launch-browser');
  try {
    if (!browser) {
      browserLaunchAttempted = true;
      browser = await launchBrowser({
        timeout: 30_000,
        protocolTimeout: HOST_PROTOCOL_TIMEOUT_MS,
      });
    }
    emitProgress('read-browser-version');
    report.browserVersion = await withProtocolDeadline(
      () => browser.version(),
      'read-browser-version',
    );
    for (const id of ['cooperative-import', 'workspace-replacement']) {
      caseId = id;
      emitProgress(`setup:${id}`, id);
      let owned = null;
      try {
        owned = await setupOwnedPage(browser, url, {
          expectedCommit,
          role: id,
          quiescenceTimeoutMs: drainMs,
          onProgress: (phase) => emitProgress(phase, id),
        });
        const onPhase = (phase, caseProgress) =>
          emitProgress(`case:${id}:${phase}`, id, caseProgress);
        const driver =
          id === 'cooperative-import'
            ? makeImportDriver(
                owned.page,
                fixture,
                drainMs,
                owned.workerPreflight,
                owned.applicationCommit,
                onPhase,
              )
            : makeWorkspaceDriver(
                owned.page,
                drainMs,
                owned.workerPreflight,
                owned.applicationCommit,
                onPhase,
              );
        emitProgress(`run-case:${id}`, id);
        const result =
          id === 'cooperative-import'
            ? await runCooperativeImportLifecycleCase({
                driver,
                cycles,
                featureCount,
                featureIds: fixture.imports[0].records.map(
                  (record) => record.id,
                ),
                importId: fixture.imports[0].id,
              })
            : await runWorkspaceReplacementLifecycleCase({ driver, cycles });
        if (result.status === 'passed' && owned.errors.length)
          throw new Error('Application page emitted uncaught errors.');
        const snapshots = [result.baseline, result.final].filter(Boolean);
        for (const item of snapshots) addWorkerAndHeapDiagnostics(item);
        report.cases.push({
          ...result,
          applicationCommit: owned.applicationCommit,
          disabledLayers: owned.disabledLayers,
          allLayersDisabled: owned.allLayersDisabled,
          bootProgress: owned.progress.slice(0, 16),
          workerPreflight: owned.workerPreflight,
          pageErrors: owned.errors.slice(0, 8).map(boundedText),
        });
        emitProgress(`case-${result.status}:${id}`, id);
      } catch (error) {
        report.cases.push({
          id,
          status: 'failed',
          failedPhase: report.activeCase?.phase || report.phase,
          error: boundedText(error),
          failureEvidence: error.lifecycleFailureEvidence || null,
          bootProgress: owned?.progress?.slice(0, 16) || [],
          disabledLayers: owned?.disabledLayers || [],
          allLayersDisabled: owned?.allLayersDisabled === true,
          workerPreflight: owned?.workerPreflight || null,
          pageErrors: owned?.errors?.slice(0, 8).map(boundedText) || [],
        });
        if (owned) {
          try {
            await closeOwnedPageAndContext(owned.page, owned.context);
          } catch (cleanupError) {
            report.cases.at(-1).cleanupError = boundedText(cleanupError);
          }
        }
        emitProgress(`case-failed:${id}`, id);
      }
      caseId = null;
      delete report.activeCase;
    }
    if (
      report.cases.length !== 2 ||
      report.cases.some((row) => row.status !== 'passed')
    ) {
      report.status = 'failed';
      report.error = 'One or more isolated lifecycle cases failed.';
      const failedCase = report.cases.find((row) => row.status !== 'passed');
      report.failedPhase = failedCase?.failedPhase || failedCase?.phase || null;
    } else {
      report.applicationCommitAtEnd = execFileSync(
        'git',
        ['-C', scriptRoot, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' },
      ).trim();
      report.applicationSourceCleanAtEnd =
        execFileSync(
          'git',
          [
            '-C',
            scriptRoot,
            'status',
            '--porcelain',
            '--',
            'src',
            'public',
            'build/vite.js',
            'index.html',
            'package.json',
            'package-lock.json',
            'vite.config.js',
          ],
          { encoding: 'utf8' },
        ).trim() === '';
      report.sourceChangedDuringRun =
        report.applicationCommitAtEnd !== expectedCommit ||
        report.applicationSourceCleanAtEnd !== true;
      if (report.sourceChangedDuringRun)
        throw new Error(
          'Application source identity changed during lifecycle run.',
        );
      validateLifecycleCandidate(report, {
        expectedCommit,
        expectedImportFixtureSha256: fixture.sha256,
        expectedWorkspaceFixtureSha256: workspaceFixtureSha256,
      });
      report.validationStatus = 'passed';
    }
  } catch (error) {
    report.status = 'failed';
    report.error = boundedText(error);
    report.failedPhase = report.phase;
  } finally {
    if (ownsBrowser && browser) {
      browserCloseStarted = true;
      emitProgress('close-owned-browser', caseId);
      try {
        report.browserClose = await closeRecoveryBrowser(browser, {
          timeoutMs: BROWSER_CLOSE_TIMEOUT_MS,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        });
        if (!report.browserClose.closeCompleted) {
          report.status = 'failed';
          report.browserCloseError =
            report.browserClose.observation?.closeStatus ||
            'Owned browser did not close cleanly.';
          report.error ||= report.browserCloseError;
        }
        if (
          report.browserClose.forcedProcessTermination ||
          report.browserClose.observation?.forceProcessStatus ===
            'unconfirmed' ||
          report.browserClose.observation?.forceProcessStatus === 'timed-out'
        ) {
          report.status = 'failed';
          report.error ||= 'Owned browser required process-tree cleanup.';
        }
      } catch (error) {
        report.status = 'failed';
        report.browserCloseError = boundedText(error);
        report.error ||= report.browserCloseError;
      }
    }
    if (ownsBrowser && !browser && !browserCloseStarted)
      report.browserClose = {
        status: browserLaunchAttempted ? 'launch-failed' : 'not-launched',
        confirmed: null,
      };
    report.elapsedMs = Math.max(0, performance.now() - report._startedAt);
    finalizeLifecycleReportStatus(report, { ownsBrowser });
    emitProgress(report.status === 'passed' ? 'complete' : 'failed', caseId);
  }
  return report;
}

export async function writeLifecycleReport(filename, report) {
  if (!filename) return;
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function writeLifecycleReportSync(filename, report) {
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
  let report;
  try {
    options = parseImportWorkspaceLifecycleArgs(process.argv.slice(2));
    const commit =
      options.expectedCommit ||
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const url = new URL(options.url);
    if (url.username || url.password || url.search || url.hash)
      throw new TypeError(
        '--url cannot contain credentials, query, or fragment.',
      );
    report = await runImportWorkspaceLifecycle({
      ...options,
      url: url.origin,
      expectedCommit: commit,
      onProgress: (current) => {
        report = current;
        writeLifecycleReportSync(options?.out, current);
      },
    });
  } catch (error) {
    report = {
      schema: 'gev-import-workspace-lifecycle/v1',
      status: 'failed',
      error: boundedText(error),
      cases: [],
    };
  }
  await writeLifecycleReport(options?.out, report).catch((error) => {
    report.status = 'failed';
    report.reportWriteError = boundedText(error);
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
