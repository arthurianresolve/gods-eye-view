#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertOwnedLifecycleCheckpoint,
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
  prepareFixturePage,
  seedPersistentWorkspace,
} from './qa-application-fixtures.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';

const DEFAULT_CYCLES = 5;
const FEATURE_COUNT = 512;
const SHA1 = /^[a-f0-9]{40}$/i;

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

async function closeOwnedPageAndContext(page, context) {
  const errors = [];
  try {
    if (page && !page.isClosed())
      await page.evaluate(() => window.__qaLifecycleCancelAll?.());
  } catch (error) {
    errors.push(error);
  }
  try {
    if (page) await cleanupFixturePageDiagnostics(page);
  } catch (error) {
    errors.push(error);
  }
  try {
    if (page && !page.isClosed()) await page.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    if (context) await context.close();
  } catch (error) {
    errors.push(error);
  }
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
  return page.evaluate(
    (options) => window.__qaLifecycleStartRenderWait(options),
    { workspaceId, count, timeoutMs, requireRestoreTransition },
  );
}

async function finishRenderedPopulationWait(page, id) {
  try {
    return await page.evaluate(
      (waitId) => window.__qaLifecycleWaitForRender(waitId),
      id,
    );
  } finally {
    await page
      .evaluate((waitId) => window.__qaLifecycleCancelRenderWait(waitId), id)
      .catch(() => {});
  }
}

function assertWorkerPreflight(value) {
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
    value.diagnostics.pending !== 0 ||
    !Array.isArray(value.diagnostics.workers) ||
    value.diagnostics.workers.length > 64 ||
    value.diagnostics.workers.some(
      (worker) =>
        !Number.isSafeInteger(worker.submitted) ||
        !Number.isSafeInteger(worker.completed) ||
        !Number.isSafeInteger(worker.pending) ||
        !Number.isSafeInteger(worker.workerErrors) ||
        !Number.isSafeInteger(worker.postErrors) ||
        worker.pending !== 0 ||
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

async function readWorkerPreflight(page, verifyNetwork) {
  const network = await verifyNetwork();
  const value = await page.evaluate(async () => {
    const { runCesiumWorkerProbe } =
      await import('/scripts/fixtures/cesium-worker-probe.js');
    const probe = await runCesiumWorkerProbe();
    return { probe, diagnostics: window.__gevSoakWorkers?.snapshot() || null };
  });
  return assertWorkerPreflight({ ...value, network });
}

async function setupOwnedPage(browser, base, { expectedCommit, role }) {
  const context = await browser.createBrowserContext();
  let page = null;
  try {
    page = await context.newPage();
    await page.evaluateOnNewDocument(installWorkerDiagnostics);
    const prepared = await prepareFixturePage(browser, base, { page });
    const progress = [];
    await bootFixturePage(page, base, {
      onProgress: (phase) => progress.push(phase),
      hash: `#qa-lifecycle-${role}`,
    });
    const disabledLayers = await page.evaluate(async () => {
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
    });
    await page.evaluate(installLifecycleRenderWaiter);
    const identity = await page.evaluate(
      () =>
        window.__godsEyeView?.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (!SHA1.test(identity || '') || identity !== expectedCommit)
      throw new Error(
        'Served application commit does not match the expected build.',
      );
    const workerPreflight = await readWorkerPreflight(
      page,
      prepared.verifyNetwork,
    );
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
    try {
      await closeOwnedPageAndContext(page, context);
    } catch (cleanupError) {
      error.message += `; cleanup failed: ${boundedText(cleanupError)}`;
    }
    throw error;
  }
}

async function pageSnapshot(page) {
  const snapshot = await page.evaluate(() => {
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
  });
  const metrics = await page.metrics();
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

function makeImportDriver(
  page,
  fixture,
  drainMs,
  workerPreflight,
  applicationCommit,
) {
  return {
    async checkpoint() {
      return pageSnapshot(page);
    },
    async load({ kind, cycle }) {
      const workspaceId =
        kind === 'warmup' ? 'lifecycle-warmup' : `lifecycle-measured-${cycle}`;
      return page.evaluate(
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
      const result = await page.evaluate(
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
      const result = await page.evaluate(
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
      try {
        await page.evaluate(() => {
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
        return { ...(await pageSnapshot(page)), renderedPopulation };
      } catch (error) {
        await page
          .evaluate((id) => window.__qaLifecycleCancelRenderWait(id), waitId)
          .catch(() => {});
        throw error;
      }
    },
    async workerCounters() {
      return page.evaluate(() => {
        const value = window.__gevSoakWorkers?.snapshot() || null;
        return value ? { ...value, scope: 'cumulative-per-document' } : null;
      });
    },
    async close() {
      await closeOwnedPageAndContext(page, page.browserContext());
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
) {
  return {
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
        return { ...(await pageSnapshot(page)), renderedPopulation };
      } catch (error) {
        await page
          .evaluate((id) => window.__qaLifecycleCancelRenderWait(id), waitId)
          .catch(() => {});
        throw error;
      }
    },
    async workerCounters() {
      return page.evaluate(() => {
        const value = window.__gevSoakWorkers?.snapshot() || null;
        return value ? { ...value, scope: 'cumulative-per-document' } : null;
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
  let ownsBrowser = !browser;
  browser ||= await launchFixtureBrowser({ timeout: 30_000 });
  const report = {
    schema: 'gev-import-workspace-lifecycle/v1',
    status: 'pending',
    applicationCommit: expectedCommit,
    harnessCommit: actualHarnessCommit,
    harnessSourceClean,
    applicationSourceClean,
    browserVersion: null,
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
      workspaceImportSha256,
    },
    cases: [],
  };
  try {
    report.browserVersion = await browser.version();
    for (const id of ['cooperative-import', 'workspace-replacement']) {
      let owned = null;
      try {
        owned = await setupOwnedPage(browser, url, {
          expectedCommit,
          role: id,
        });
        const driver =
          id === 'cooperative-import'
            ? makeImportDriver(
                owned.page,
                fixture,
                drainMs,
                owned.workerPreflight,
                owned.applicationCommit,
              )
            : makeWorkspaceDriver(
                owned.page,
                drainMs,
                owned.workerPreflight,
                owned.applicationCommit,
              );
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
      } catch (error) {
        report.cases.push({
          id,
          status: 'failed',
          error: boundedText(error),
          bootProgress: owned?.progress?.slice(0, 16) || [],
          disabledLayers: owned?.disabledLayers || [],
          allLayersDisabled: owned?.allLayersDisabled === true,
          workerPreflight: owned?.workerPreflight || null,
          pageErrors: owned?.errors?.slice(0, 8).map(boundedText) || [],
        });
        if (owned) {
          await cleanupFixturePageDiagnostics(owned.page).catch(() => {});
          await owned.page.close().catch(() => {});
          await owned.context.close().catch(() => {});
        }
      }
    }
    if (
      report.cases.length !== 2 ||
      report.cases.some((row) => row.status !== 'passed')
    ) {
      report.status = 'failed';
      report.error = 'One or more isolated lifecycle cases failed.';
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
      report.status = 'passed';
      validateImportWorkspaceLifecycleReport(report, {
        expectedCommit,
        expectedImportFixtureSha256: fixture.sha256,
        expectedWorkspaceFixtureSha256: workspaceFixtureSha256,
      });
    }
  } catch (error) {
    report.status = 'failed';
    report.error = boundedText(error);
  } finally {
    if (ownsBrowser) {
      try {
        await browser.close();
      } catch (error) {
        report.status = 'failed';
        report.browserCloseError = boundedText(error);
        report.error ||= report.browserCloseError;
      }
    }
  }
  return report;
}

export async function writeLifecycleReport(filename, report) {
  if (!filename) return;
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
