import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import {
  closeOwnedRecoveryPage,
  assertInitialRecoveryPage,
  stopOwnedRecoveryProcessTree,
  closeRecoveryBrowser,
} from './performance/profileRecoveryPageOwnership.mjs';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
import {
  assessHostedSourceFinish,
  assessHostedSourceStart,
  inspectTrackedWorktree,
} from './performance/hostedSourceProvenance.mjs';
import {
  IMPORT_GEOMETRY_WAKE_ARMS,
  IMPORT_GEOMETRY_WAKE_PAIR_COUNT,
  createImportGeometryWakeRunRecord,
  validateImportGeometryWakeReport,
  summarizeImportGeometryWakeReport,
} from './performance/importGeometryWakeComparison.mjs';

if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('This large-geometry fixture is hosted-only.');

const commit = process.env.GITHUB_SHA;
const artifactDirectory = resolve('qa-artifacts/import-geometry-wake');
const port = 4186;
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
  schedulerSha256: resolve('scripts/performance/geometryWakeScheduler.mjs'),
  packageLockSha256: resolve('package-lock.json'),
  cesiumEntrySha256: require.resolve('cesium'),
  cesiumSceneSha256: resolve(
    'node_modules/@cesium/engine/Source/Scene/Scene.js',
  ),
  runnerSha256: resolve('scripts/qa-import-geometry-wake.mjs'),
  validatorSha256: resolve(
    'scripts/performance/importGeometryWakeComparison.mjs',
  ),
};
const report = {
  schema: 'gev-import-geometry-wake/v1',
  commit,
  status: 'pending',
  performanceAccepted: false,
  batchBudgetAcceptance: 'not-evaluated',
  timestamp: new Date().toISOString(),
  environment: readHostEnvironment(),
  contextIsolation: 'fresh-page-and-viewer-per-arm-run;shared-browser-process',
  source: {
    applicationCommit: null,
    harnessCommit: null,
    dirtyAtStart: null,
    changedDuringRun: null,
    hashes: null,
  },
  renderer: null,
  renderingEvidence: null,
  pairCount: IMPORT_GEOMETRY_WAKE_PAIR_COUNT,
  pairs: [],
};
let browser;
let server;
let serverError = null;
let sourceStart;
let sourceSnapshotAtStart;
let primaryError = null;

async function persist() {
  await mkdir(artifactDirectory, { recursive: true });
  const path = resolve(artifactDirectory, 'report.json');
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, path);
}

async function inspectHashes() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([key, path]) => [
        key,
        await hashFile(path),
      ]),
    ),
  );
}

async function readFixtureResult(page) {
  return page.$eval('#result', (element) => JSON.parse(element.textContent));
}

async function runArm(arm, pairIndex) {
  const run = {
    arm,
    status: 'running',
    applicationCommit: commit,
    harnessCommit: report.source.harnessCommit,
    pairIndex,
    pageErrors: [],
  };
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 720, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => {
      run.pageErrors.push(String(error?.message || error).slice(0, 400));
      if (run.pageErrors.length > 8) run.pageErrors.shift();
    });
    await page.goto(`${url}?arm=${encodeURIComponent(arm)}`, {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const text = document.querySelector('#result')?.textContent;
        return text && text !== 'starting';
      },
      { timeout: 300_000, polling: 100 },
    );
    const fixture = await readFixtureResult(page);
    Object.assign(
      run,
      createImportGeometryWakeRunRecord(fixture, {
        pairIndex,
        pageErrors: run.pageErrors,
      }),
    );
    if (
      fixture.applicationCommit !== commit ||
      fixture.harnessCommit !== report.source.harnessCommit ||
      fixture.arm !== arm ||
      fixture.status !== 'passed' ||
      run.pageErrors.length > 0
    )
      throw new Error(
        `Fixture ${arm} failed: ${fixture.error || run.pageErrors[0] || fixture.status}`,
      );
    return run;
  } catch (error) {
    run.status = 'failed';
    run.error = String(error?.message || error).slice(0, 800);
    if (page) {
      run.partialFixture = await page
        .$eval('#result', (element) => element.textContent.slice(0, 24_000))
        .catch(() => null);
    }
    throw Object.assign(error, { run });
  } finally {
    if (page) {
      const cleanup = await closeOwnedRecoveryPage(page, browser, 5000).catch(
        () => ({ closeCompleted: false, openPageCount: null }),
      );
      run.pageCleanup = cleanup;
      if (!cleanup.closeCompleted || cleanup.openPageCount !== 0) {
        run.status = 'failed';
        run.cleanupError = 'Owned comparison page did not close cleanly.';
      }
    }
  }
}

try {
  sourceSnapshotAtStart = inspectTrackedWorktree();
  sourceStart = assessHostedSourceStart(sourceSnapshotAtStart, commit);
  Object.assign(report.source, {
    applicationCommit: commit || null,
    harnessCommit: sourceStart.harnessCommit,
    sourceDirtyAtStart: sourceStart.sourceDirtyAtStart,
    harnessDirtyAtStart: sourceStart.harnessDirtyAtStart,
    dirtyAtStart:
      sourceStart.sourceDirtyAtStart === false &&
      sourceStart.harnessDirtyAtStart === false
        ? false
        : sourceStart.sourceDirtyAtStart === true ||
            sourceStart.harnessDirtyAtStart === true
          ? true
          : null,
  });
  Object.assign(report.source, await inspectHashes());
  if (!sourceStart.valid)
    throw new Error(
      sourceStart.error || 'Hosted source must be a clean exact commit.',
    );

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
  server.on('error', (error) => {
    serverError = error;
  });
  const readyDeadline = Date.now() + 90_000;
  while (Date.now() < readyDeadline) {
    if (serverError) throw serverError;
    if (server.exitCode !== null)
      throw new Error(`Vite fixture server exited ${server.exitCode}.`);
    if (
      await fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  if (
    !(await fetch(url)
      .then((response) => response.ok)
      .catch(() => false))
  )
    throw new Error('Vite fixture server did not become ready.');

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    timeout: 30_000,
  });
  const initialPage = assertInitialRecoveryPage(await browser.pages(), url);
  const initialPageCleanup = await closeOwnedRecoveryPage(
    initialPage,
    browser,
    5000,
  );
  if (
    !initialPageCleanup.closeCompleted ||
    initialPageCleanup.openPageCount !== 0
  )
    throw new Error('Initial browser page could not be closed before trials.');
  const webglProbe = await (async () => {
    const page = await browser.newPage();
    try {
      return await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2');
        const available = Boolean(context);
        const extension = context?.getExtension('WEBGL_debug_renderer_info');
        const renderer = context
          ? context.getParameter(
              extension?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER,
            )
          : null;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
        return { available, renderer };
      });
    } finally {
      const cleanup = await closeOwnedRecoveryPage(page, browser, 5000);
      if (!cleanup.closeCompleted || cleanup.openPageCount !== 0)
        throw new Error('WebGL probe page cleanup failed.');
    }
  })();
  report.webglAvailable = webglProbe.available;
  report.graphics = await readBrowserGraphicsInfo(browser);
  report.rendererProbe = webglProbe.renderer;
  if (!webglProbe.available)
    throw new Error('Hosted browser has no WebGL 2 renderer.');

  for (
    let pairIndex = 0;
    pairIndex < IMPORT_GEOMETRY_WAKE_PAIR_COUNT;
    pairIndex++
  ) {
    const order = IMPORT_GEOMETRY_WAKE_ARMS.map(
      (_, offset) =>
        IMPORT_GEOMETRY_WAKE_ARMS[
          (pairIndex + offset) % IMPORT_GEOMETRY_WAKE_ARMS.length
        ],
    );
    const pair = { index: pairIndex, order, runs: {} };
    report.pairs.push(pair);
    report.currentPair = pairIndex;
    report.currentArm = order[0];
    await persist();
    for (const arm of order) {
      report.currentArm = arm;
      await persist();
      try {
        pair.runs[arm] = await runArm(arm, pairIndex);
      } catch (error) {
        if (error.run) pair.runs[arm] = error.run;
        throw error;
      }
      await persist();
    }
  }
  const sceneEnvironments = report.pairs.flatMap((pair) =>
    IMPORT_GEOMETRY_WAKE_ARMS.map((arm) => pair.runs[arm]?.environment),
  );
  const sceneRenderer = sceneEnvironments[0];
  if (
    !sceneRenderer?.renderer ||
    !sceneRenderer.vendor ||
    !sceneRenderer.cesiumVersion ||
    sceneEnvironments.some(
      (environment) =>
        environment?.renderer !== sceneRenderer.renderer ||
        environment?.vendor !== sceneRenderer.vendor ||
        environment?.cesiumVersion !== sceneRenderer.cesiumVersion ||
        environment?.contextLost !== false,
    )
  )
    throw new Error(
      'Actual viewer renderer identity changed or was unavailable.',
    );
  report.renderer = sceneRenderer.renderer;
  report.cesiumVersion = sceneRenderer.cesiumVersion;
  report.renderingEvidence = classifyRenderer(
    sceneRenderer.renderer,
    report.graphics,
  );
  if (report.renderingEvidence.accelerationVerified !== true)
    throw new Error('Fixture scenes used an unverified accelerated renderer.');
  delete report.currentPair;
  delete report.currentArm;
  report.summary = summarizeImportGeometryWakeReport(report);
  report.status = 'passed';
} catch (error) {
  primaryError = error;
  report.status = 'failed';
  report.error = String(error?.message || error).slice(0, 1000);
  if (error.run) {
    const pair = report.pairs.at(-1);
    pair.runs[error.run.arm] = error.run;
  }
} finally {
  try {
    if (browser) {
      const pages = await browser.pages();
      if (pages.length !== 0) {
        report.cleanupError = `Browser retained ${pages.length} page(s).`;
        for (const page of pages)
          await page.close({ runBeforeUnload: false }).catch(() => {});
      }
      const cleanup = await closeRecoveryBrowser(browser, {
        timeoutMs: 5000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      report.browserCleanup = cleanup;
      if (!cleanup.closeCompleted)
        report.cleanupError ||= 'Browser close was not confirmed.';
    }
  } catch (error) {
    report.cleanupError ||= String(error?.message || error).slice(0, 400);
  }
  try {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      const exited = await Promise.race([
        new Promise((resolveExit) =>
          server.once('exit', () => resolveExit(true)),
        ),
        new Promise((resolveExit) =>
          setTimeout(() => resolveExit(false), 5000),
        ),
      ]);
      if (!exited) {
        const stopped = await stopOwnedRecoveryProcessTree(server);
        report.serverCleanup = stopped;
        if (!stopped.confirmed)
          report.cleanupError ||= 'Vite process exit was not confirmed.';
      } else
        report.serverCleanup = { confirmed: true, reason: 'exit-observed' };
    } else report.serverCleanup = { confirmed: true, reason: 'already-exited' };
  } catch (error) {
    report.cleanupError ||= String(error?.message || error).slice(0, 400);
  }
  try {
    const finishSnapshot = inspectTrackedWorktree();
    const finish = assessHostedSourceFinish(
      sourceSnapshotAtStart,
      finishSnapshot,
    );
    report.source.changedDuringRun = finish.sourceChangedDuringRun;
    if (finish.error) report.source.finishInspectionError = finish.error;
    const hashesAtFinish = await inspectHashes();
    const hashesChanged = Object.entries(report.source)
      .filter(([key]) => key.endsWith('Sha256'))
      .some(([key, value]) => hashesAtFinish[key] !== value);
    report.source.hashesAtFinish = hashesAtFinish;
    if (finish.error || finish.sourceChangedDuringRun || hashesChanged) {
      report.status = 'failed';
      report.error ||=
        finish.error || 'Tracked source changed during the comparison.';
    }
  } catch (error) {
    report.source.changedDuringRun = null;
    report.source.finishInspectionError = String(error?.message || error).slice(
      0,
      300,
    );
    report.status = 'failed';
  }
  if (report.cleanupError) report.status = 'failed';
  if (report.status === 'passed') {
    try {
      validateImportGeometryWakeReport(report, {
        expectedCommit: commit,
        expectedHarnessCommit: report.source.harnessCommit,
      });
    } catch (error) {
      report.status = 'failed';
      report.error ||= String(error?.message || error).slice(0, 600);
    }
  }
  report.performanceAccepted = false;
  report.batchBudgetAcceptance = 'not-evaluated';
  await persist().catch((error) => {
    report.status = 'failed';
    report.error ||= String(error?.message || error).slice(0, 300);
    console.error(`Could not persist comparison report: ${error.message}`);
  });
}
if (report.status !== 'passed') {
  console.error(
    `Large-geometry comparison failed: ${report.error || 'cleanup failure'}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Large-geometry comparison passed correctness: ${artifactDirectory}`,
  );
}
void primaryError;
