import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import {
  assertInitialRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import {
  assessHostedSourceFinish,
  assessHostedSourceStart,
  inspectTrackedWorktree,
} from './performance/hostedSourceProvenance.mjs';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
import { startImportLoadProfile } from './performance/importLoadProfile.mjs';
import { startImportTraceSession } from './performance/importTraceSession.mjs';
import {
  summarizeGeometryGcOverlap,
  summarizeGeometryLoadProfile,
  validateImportGeometryLoadProfileReport,
} from './performance/importGeometryLoadProfile.mjs';

if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('The geometry profile fixture is hosted-only.');

const commit = process.env.GITHUB_SHA;
const mode = process.env.IMPORT_GEOMETRY_PROFILE_MODE;
const arm = process.env.IMPORT_GEOMETRY_PROFILE_ARM;
const geometryType = process.env.IMPORT_GEOMETRY_PROFILE_TYPE;
if (!['cpu', 'heap'].includes(mode))
  throw new Error('IMPORT_GEOMETRY_PROFILE_MODE must be cpu or heap.');
if (
  !['whole-feature-timer', 'chunked-timer', 'chunked-message-channel'].includes(
    arm,
  )
)
  throw new Error('Unknown geometry profile arm.');
if (!['LineString', 'Polygon'].includes(geometryType))
  throw new Error('Unknown geometry profile type.');

const artifactDirectory = resolve('qa-artifacts/import-geometry-load-profile');
const port = 4191;
const url = `http://127.0.0.1:${port}/scripts/fixtures/import-geometry-wake.html`;
const require = createRequire(import.meta.url);
const hashFile = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const sourcePaths = {
  runtimeLayerSha256: resolve('src/imports/runtimeLayer.js'),
  cooperativeSha256: resolve('src/imports/cooperative.js'),
  fixtureSha256: resolve('scripts/fixtures/import-geometry-wake.js'),
  fixtureHtmlSha256: resolve('scripts/fixtures/import-geometry-wake.html'),
  viteEntryConfigSha256: resolve('vite.config.js'),
  viteConfigSha256: resolve('server/standalone/vite.config.js'),
  runnerSha256: resolve('scripts/qa-import-geometry-load-profile.mjs'),
  profileHelperSha256: resolve(
    'scripts/performance/importGeometryLoadProfile.mjs',
  ),
  cpuHeapHelperSha256: resolve('scripts/performance/importLoadProfile.mjs'),
  traceHelperSha256: resolve('scripts/performance/importTraceSession.mjs'),
  traceSummarySha256: resolve('scripts/performance/importTraceAttribution.mjs'),
  sampledCpuProfileSha256: resolve('scripts/performance/sampledCpuProfile.mjs'),
  rendererEvidenceSha256: resolve('scripts/performance/rendererEvidence.mjs'),
  pageOwnershipSha256: resolve(
    'scripts/performance/profileRecoveryPageOwnership.mjs',
  ),
  sourceProvenanceSha256: resolve(
    'scripts/performance/hostedSourceProvenance.mjs',
  ),
  packageLockSha256: resolve('package-lock.json'),
  cesiumEntrySha256: require.resolve('cesium'),
  cesiumSceneSha256: resolve(
    'node_modules/@cesium/engine/Source/Scene/Scene.js',
  ),
};
const expectedGeometrySha256 = {
  LineString:
    '74fccdb194475b32c4b93fead20e5cb7a92f313243a1a1bd0795c7c733de963f',
  Polygon: 'fcc656d967cc111e8f70ed7fe47f07301d4476256e10583f7ea761d162b88fb7',
}[geometryType];
const report = {
  schema: 'gev-import-geometry-load-profile/v1',
  status: 'pending',
  mode,
  arm,
  geometryType,
  timestamp: new Date().toISOString(),
  performanceAcceptanceEligible: false,
  source: {
    applicationCommit: commit || null,
    harnessCommit: null,
    sourceDirtyAtStart: null,
    harnessDirtyAtStart: null,
    sourceChangedDuringRun: null,
    harnessChangedDuringRun: null,
    hashes: null,
  },
  fixture: {
    applicationCommit: null,
    harnessCommit: null,
    geometry: 's59-50k-line-polygon/v1',
    profileWindow: 'actual-load-async-call-and-runtime-phase-observers',
    captureAfterProfileStop: true,
  },
  environment: null,
  profile: null,
  fixtureResult: null,
  pageErrors: [],
  error: null,
  cleanupError: null,
};
let browser;
let server;
let sourceStartSnapshot;
let primaryError = null;

async function persist() {
  await mkdir(artifactDirectory, { recursive: true });
  const path = resolve(artifactDirectory, 'report.json');
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, path);
}

async function hashSources() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([key, path]) => [
        key,
        await hashFile(path),
      ]),
    ),
  );
}

async function readPageReport(page) {
  return page.$eval('#result', (element) => JSON.parse(element.textContent));
}

async function bounded(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runProfile() {
  const page = await browser.newPage();
  let profileSession;
  let traceSession;
  let startedAt = null;
  let stoppedAt = null;
  try {
    await page.setViewport({ width: 1200, height: 720, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => {
      report.pageErrors.push(String(error?.message || error).slice(0, 400));
      if (report.pageErrors.length > 8) report.pageErrors.shift();
    });
    await page.goto(
      `${url}?diagnostic=geometry-load-profile&arm=${encodeURIComponent(arm)}&geometryType=${encodeURIComponent(geometryType)}&profileMode=${mode}`,
      { waitUntil: 'networkidle0', timeout: 60_000 },
    );
    await page.waitForFunction(
      () => {
        try {
          return (
            JSON.parse(document.querySelector('#result')?.textContent || '{}')
              .status === 'ready'
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000, polling: 100 },
    );
    const prepared = await page.evaluate(() =>
      window.__importGeometryProfileControl.prepare(),
    );
    if (
      prepared.arm !== arm ||
      prepared.geometryType !== geometryType ||
      prepared.profileMode !== mode
    )
      throw new Error('Prepared page identity differs from requested profile.');

    traceSession = await startImportTraceSession(
      await page.createCDPSession(),
      { timeoutMs: 15_000, cleanupTimeoutMs: 2_000 },
    );
    profileSession = await startImportLoadProfile(page, mode, {
      timeoutMs: 30_000,
      cleanupTimeoutMs: 2_000,
    });
    await page.evaluate(() =>
      window.__importGeometryProfileControl.markProfilerStarted(),
    );
    startedAt = Date.now();
    const loadControl = page
      .evaluate(() => window.__importGeometryProfileControl.startLoad())
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await page.waitForFunction(
      () => {
        try {
          return ['loaded', 'load-failed'].includes(
            JSON.parse(document.querySelector('#result')?.textContent || '{}')
              .profileStatus,
          );
        } catch {
          return false;
        }
      },
      { timeout: 180_000, polling: 50 },
    );
    const loadOutcome = await loadControl;
    if (loadOutcome.error) throw loadOutcome.error;
    const loadResult = loadOutcome.value;
    const loadPageReport = await readPageReport(page);
    if (loadPageReport.profileStatus !== 'loaded')
      throw new Error(
        loadPageReport.error ||
          'Profile fixture load failed before completion.',
      );
    const profile = await profileSession.stop();
    profileSession = null;
    stoppedAt = Date.now();
    const trace = await traceSession.stop();
    traceSession = null;
    const fixture = await page.evaluate(() =>
      window.__importGeometryProfileControl.finishCapture(),
    );
    await page.waitForFunction(
      () => {
        try {
          return (
            JSON.parse(document.querySelector('#result')?.textContent || '{}')
              .status === 'passed'
          );
        } catch {
          return false;
        }
      },
      { timeout: 30_000, polling: 50 },
    );
    const pageReport = await readPageReport(page);
    const gc = summarizeGeometryGcOverlap({
      trace,
      anchor: loadResult.anchor,
      startMs: pageReport.samples[0].profile.loadStartedAtMs,
      endMs: pageReport.samples[0].profile.loadCompletedAtMs,
    });
    const profileSummary = summarizeGeometryLoadProfile({ mode, profile });
    profileSummary.profileWindowMs ??=
      pageReport.profileStoppedAtMs - pageReport.profileStartedAtMs;
    const traceInput = {
      events: trace.events,
      relevantCount: trace.relevantCount,
      omittedCount: trace.omittedCount,
      flowEventCount: trace.flowEventCount,
      flowPhaseCounts: trace.flowPhaseCounts,
      omissionReasons: trace.omissionReasons,
      bufferUsagePeak: trace.bufferUsagePeak,
      stopError: trace.stopError,
    };
    const traceInputSha256 = createHash('sha256')
      .update(JSON.stringify(traceInput))
      .digest('hex');
    report.profile = {
      ...profileSummary,
      profileWindowMs: profileSummary.profileWindowMs,
      trace: gc,
      traceInput,
      traceInputSha256,
    };
    report.fixtureResult = pageReport;
    report.fixture = {
      ...report.fixture,
      applicationCommit: pageReport.applicationCommit,
      harnessCommit: pageReport.harnessCommit,
      profileStartedAtMs: pageReport.profileStartedAtMs,
      profileStoppedAtMs: pageReport.profileStoppedAtMs,
      profileWindowMs: profileSummary.profileWindowMs,
      profileControlWallClockMs: stoppedAt - startedAt,
      arm,
      geometryType,
      positionCount: fixture.positionCount,
      geometrySha256: fixture.geometrySha256,
      loadElapsedMs: fixture.loadElapsedMs,
      loadStartedAtMs: fixture.profile?.loadStartedAtMs,
      loadCompletedAtMs: fixture.profile?.loadCompletedAtMs,
      profileStopRequestedBeforeCapture:
        fixture.profile?.profileStopRequestedBeforeCapture === true,
      captureAfterProfileStop:
        fixture.profile?.captureAndTeardownOutsideProfile === true,
      anchor: fixture.profile?.anchor,
      geometryPhaseSummary: fixture.profile?.geometryPhaseSummary,
    };
    report.sample = fixture;
    const graphics = await readBrowserGraphicsInfo(browser);
    report.environment = {
      host: readHostEnvironment(),
      scene: fixture.renderSettings,
      graphics,
      rendererClassification: classifyRenderer(
        fixture.renderSettings?.renderer,
        graphics,
      ),
    };
    if (pageReport.status !== 'passed')
      throw new Error(pageReport.error || 'Profile fixture failed.');
    if (!gc.complete)
      throw new Error(
        `GC trace attribution is incomplete: ${gc.error || 'unknown'}`,
      );
    if (pageReport.renderErrors?.length)
      throw new Error('Cesium reported render errors during the fixture.');
    if (report.pageErrors.length)
      throw new Error('The profile page reported an unhandled error.');
  } catch (error) {
    primaryError = error;
    report.error = String(error?.message || error).slice(0, 1000);
    if (page) {
      await page
        .evaluate(
          (message) => window.__importGeometryProfileControl?.abort(message),
          report.error,
        )
        .catch(() => {});
      report.fixtureResult = await page
        .$eval('#result', (element) => JSON.parse(element.textContent))
        .catch(() => null);
    }
    throw error;
  } finally {
    for (const [key, session] of [
      ['profileCleanupError', profileSession],
      ['traceCleanupError', traceSession],
    ]) {
      if (!session) continue;
      try {
        await session.stop();
      } catch (error) {
        report[key] = String(error?.message || error).slice(0, 400);
      }
    }
    if (report.profileCleanupError || report.traceCleanupError)
      report.cleanupError ||= 'Profiler or trace session cleanup failed.';
    if (page) {
      const cleanup = await closeOwnedRecoveryPage(page, browser, 5000).catch(
        () => ({ closeCompleted: false, openPageCount: null }),
      );
      report.pageCleanup = cleanup;
      if (!cleanup.closeCompleted || cleanup.openPageCount !== 0)
        report.cleanupError = 'Diagnostic page did not close cleanly.';
    }
  }
}

try {
  const sourceSnapshot = inspectTrackedWorktree();
  sourceStartSnapshot = sourceSnapshot;
  const sourceStart = assessHostedSourceStart(sourceSnapshot, commit);
  report.source.harnessCommit = sourceStart.harnessCommit;
  report.source.sourceDirtyAtStart = sourceStart.sourceDirtyAtStart;
  report.source.harnessDirtyAtStart = sourceStart.harnessDirtyAtStart;
  report.source.dirtyAtStart =
    sourceStart.sourceDirtyAtStart === false &&
    sourceStart.harnessDirtyAtStart === false
      ? false
      : sourceStart.sourceDirtyAtStart === true ||
          sourceStart.harnessDirtyAtStart === true
        ? true
        : null;
  report.source.hashes = await hashSources();
  if (!sourceStart.valid)
    throw new Error(sourceStart.error || 'Diagnostic source is not clean.');

  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      env: { ...process.env, GEV_APP_COMMIT: commit },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Vite diagnostic server exited ${server.exitCode}.`);
    ready = await fetch(url)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  if (!ready) throw new Error('Vite diagnostic server did not become ready.');

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    timeout: 30_000,
  });
  const initialPage = assertInitialRecoveryPage(await browser.pages(), url);
  const initialCleanup = await closeOwnedRecoveryPage(
    initialPage,
    browser,
    5000,
  );
  if (!initialCleanup.closeCompleted || initialCleanup.openPageCount !== 0)
    throw new Error('Initial browser page did not close before diagnostic.');
  await runProfile();
  report.status = 'passed';
} catch (error) {
  primaryError = error;
  report.status = 'failed';
  report.error ||= String(error?.message || error).slice(0, 1000);
} finally {
  if (browser) {
    try {
      try {
        const pages = await bounded(
          browser.pages(),
          5000,
          'Browser page inventory timed out.',
        );
        if (pages.length) {
          report.cleanupError ||= `Browser retained ${pages.length} page(s).`;
          for (const page of pages) {
            const cleanup = await closeOwnedRecoveryPage(
              page,
              browser,
              5000,
            ).catch(() => ({ closeCompleted: false, openPageCount: null }));
            if (!cleanup.closeCompleted)
              report.cleanupError ||=
                'An extra browser page did not close cleanly.';
          }
        }
        const remainingPages = await bounded(
          browser.pages(),
          5000,
          'Final browser page inventory timed out.',
        );
        if (remainingPages.length)
          report.cleanupError ||= `Browser retained ${remainingPages.length} page(s).`;
      } catch (error) {
        report.cleanupError ||= String(error?.message || error).slice(0, 400);
      }
    } finally {
      try {
        const cleanup = await closeRecoveryBrowser(browser, {
          timeoutMs: 5000,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        });
        report.browserCleanup = cleanup;
        if (
          !cleanup.closeCompleted ||
          cleanup.forcedProcessTermination !== false
        )
          report.cleanupError ||= 'Browser did not close naturally.';
      } catch (error) {
        report.cleanupError ||= String(error?.message || error).slice(0, 400);
      }
    }
  }
  if (server) {
    try {
      if (server.exitCode === null) {
        server.kill('SIGTERM');
        const exited = await bounded(
          new Promise((resolveExit) =>
            server.once('exit', () => resolveExit(true)),
          ),
          5000,
          'Vite process exit timed out.',
        ).catch(() => false);
        if (!exited) {
          report.serverCleanup = await stopOwnedRecoveryProcessTree(server);
        } else {
          report.serverCleanup = { confirmed: true, reason: 'exit-observed' };
        }
      } else {
        report.serverCleanup = { confirmed: true, reason: 'exit-observed' };
      }
      if (report.serverCleanup?.confirmed !== true)
        report.cleanupError ||= 'Vite process exit was not confirmed.';
    } catch (error) {
      report.cleanupError ||= String(error?.message || error).slice(0, 400);
    }
  }
  try {
    const finish = assessHostedSourceFinish(
      sourceStartSnapshot,
      inspectTrackedWorktree(),
    );
    report.source.sourceChangedDuringRun = finish.sourceChangedDuringRun;
    report.source.harnessChangedDuringRun = finish.harnessChangedDuringRun;
    if (finish.error || finish.sourceChangedDuringRun)
      report.error ||= finish.error || 'Tracked source changed during profile.';
    report.source.hashesAtFinish = await hashSources();
    if (
      Object.entries(report.source.hashes || {}).some(
        ([key, value]) => report.source.hashesAtFinish[key] !== value,
      )
    )
      report.error ||= 'A profiled source file changed during the run.';
  } catch (error) {
    report.source.sourceChangedDuringRun = null;
    report.source.harnessChangedDuringRun = null;
    report.source.finishInspectionError = String(error?.message || error).slice(
      0,
      300,
    );
    report.error ||= 'Tracked source finish inspection failed.';
  }
  if (report.cleanupError) report.error ||= report.cleanupError;
  if (report.status === 'passed') {
    try {
      const fixture = {
        ...report.fixture,
        runtimeLayerSha256: report.source.hashes.runtimeLayerSha256,
        fixtureSha256: report.source.hashes.fixtureSha256,
        runnerSha256: report.source.hashes.runnerSha256,
        packageLockSha256: report.source.hashes.packageLockSha256,
        cesiumEngineSha256: report.source.hashes.cesiumSceneSha256,
        profileHelperSha256: report.source.hashes.profileHelperSha256,
        cpuHeapHelperSha256: report.source.hashes.cpuHeapHelperSha256,
        traceHelperSha256: report.source.hashes.traceHelperSha256,
        traceSummarySha256: report.source.hashes.traceSummarySha256,
        sampledCpuProfileSha256: report.source.hashes.sampledCpuProfileSha256,
        rendererEvidenceSha256: report.source.hashes.rendererEvidenceSha256,
        pageOwnershipSha256: report.source.hashes.pageOwnershipSha256,
        sourceProvenanceSha256: report.source.hashes.sourceProvenanceSha256,
      };
      report.fixture = fixture;
      const validation = validateImportGeometryLoadProfileReport(
        { ...report, fixture },
        { commit, geometrySha256: expectedGeometrySha256 },
      );
      if (!validation.valid)
        throw new Error(
          `Profile report invalid: ${validation.errors.join(', ')}`,
        );
    } catch (error) {
      report.status = 'failed';
      report.error ||= String(error?.message || error).slice(0, 600);
    }
  }
  await persist().catch((error) => {
    report.status = 'failed';
    report.error ||= String(error?.message || error).slice(0, 300);
    console.error(`Could not persist profile report: ${error.message}`);
  });
}
if (report.status !== 'passed') {
  console.error(`Geometry profile failed: ${report.error || 'unknown error'}`);
  process.exitCode = 1;
} else {
  console.log(`Geometry diagnostic profile completed: ${artifactDirectory}`);
}
void primaryError;
