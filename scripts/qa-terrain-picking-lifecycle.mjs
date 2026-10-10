#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { launchFixtureBrowser } from './qa-application-fixtures.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import {
  parseTerrainPickingLifecycleArgs,
  validateTerrainPickingLifecycleReport,
} from './performance/terrainPickingLifecycle.mjs';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://127.0.0.1:4174';
const PAGE_WAIT_MS = 8 * 60_000;
const SHA1 = /^[a-f0-9]{40}$/;

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function sourceIdentity() {
  return {
    commit: git(['rev-parse', 'HEAD']),
    cleanAtStart: git(['status', '--porcelain']) === '',
  };
}

function sanitize(error) {
  return String(error?.message || error || 'Unknown failure')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

function errorDetails(error, depth = 0) {
  if (!error || depth > 2) return null;
  const detail = {
    name: String(error.name || 'Error').slice(0, 80),
    message: sanitize(error),
  };
  if (error.cause) detail.cause = errorDetails(error.cause, depth + 1);
  return detail;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTerrainFixtureCompletion(
  page,
  timeoutMs = PAGE_WAIT_MS,
  { pollIntervalMs = 250, now = () => performance.now(), pause = sleep } = {},
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PAGE_WAIT_MS ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 1000
  )
    throw new RangeError('Fixture polling bounds are invalid.');
  const started = now();
  let lastProgress = null;
  while (now() - started < timeoutMs) {
    try {
      lastProgress = await page.evaluate(
        () => window.__terrainPickingLifecycleProgress || null,
      );
    } catch (error) {
      error.fixtureProgress = lastProgress;
      throw error;
    }
    if (
      lastProgress?.status === 'passed' ||
      lastProgress?.status === 'failed'
    ) {
      return {
        progress: lastProgress,
        report: await page.evaluate(
          () => window.__terrainPickingLifecycleResult || null,
        ),
      };
    }
    await pause(
      Math.min(pollIntervalMs, Math.max(0, timeoutMs - (now() - started))),
    );
  }
  throw Object.assign(
    new Error(
      `Terrain fixture did not report completion within ${timeoutMs}ms.`,
    ),
    {
      name: 'TerrainFixtureCompletionTimeout',
      progress: lastProgress,
    },
  );
}

export function assertServedBuildIdentity(servedIdentity, expectedCommit) {
  if (
    !servedIdentity ||
    servedIdentity.applicationCommit !== expectedCommit ||
    servedIdentity.harnessCommit !== expectedCommit
  )
    throw new Error(
      'Served fixture build identity does not match the clean source commit.',
    );
}

async function closeWithin(operation, timeoutMs) {
  let timer;
  const pending = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ completed: true, value }),
      (error) => ({ completed: false, error }),
    );
  try {
    return await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ completed: false, timedOut: true }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeReport(outPath, report) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function runTerrainPickingLifecycle({
  out = 'qa-artifacts/terrain-picking-lifecycle.json',
  cycles = 5,
  drainMs = 10_000,
  deps = {},
} = {}) {
  const serverFactory = deps.createServer || createServer;
  const launchBrowser = deps.launchBrowser || launchFixtureBrowser;
  const closeBrowser =
    deps.closeBrowser ||
    ((ownedBrowser) =>
      closeRecoveryBrowser(ownedBrowser, {
        timeoutMs: 5000,
        forceProcess: () =>
          stopOwnedRecoveryProcessTree(ownedBrowser.process()),
      }));
  const getSourceIdentity = deps.sourceIdentity || sourceIdentity;
  const writeReportFile = deps.writeReport || writeReport;
  const hostEnvironment = deps.readHostEnvironment || readHostEnvironment;
  const browserGraphicsInfo =
    deps.readBrowserGraphicsInfo || readBrowserGraphicsInfo;
  const rendererClassifier = deps.classifyRenderer || classifyRenderer;
  const initialSource = getSourceIdentity();
  const outPath = path.resolve(ROOT, out);
  const report = {
    schema: 'gev-terrain-picking-lifecycle/v1',
    status: 'running',
    applicationCommit: null,
    expectedApplicationCommit: initialSource.commit || null,
    source: { ...initialSource, cleanAtEnd: null },
    fixtureIdentity: 'local-geojson-custom-heightmap-v1',
    environment: null,
    hostEnvironment: hostEnvironment(),
    graphics: null,
    rendererClassification: null,
    servedBuildIdentity: null,
    pageErrors: [],
    externalRequestCount: 0,
    progress: { phase: 'startup' },
    cycles: [],
    cleanup: {
      pageClosed: false,
      browserClose: null,
      serverClosed: false,
    },
    error: null,
  };
  let server = null;
  let browser = null;
  let page = null;
  let primaryError = null;
  const errors = [];
  await writeReportFile(outPath, report);
  try {
    if (
      !SHA1.test(initialSource.commit || '') ||
      initialSource.cleanAtStart !== true
    )
      throw new Error('Fixture source must have a clean, exact Git commit.');
    server = await serverFactory({
      configFile: path.join(ROOT, 'vite.config.js'),
      root: ROOT,
      logLevel: 'error',
      clearScreen: false,
      server: { host: '127.0.0.1', port: 4174, strictPort: true },
    });
    await server.listen();
    report.progress = { phase: 'server-ready' };
    await writeReportFile(outPath, report);
    browser = await launchBrowser({ protocolTimeout: 15_000 });
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 760, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => {
      if (errors.length < 12) errors.push(sanitize(error));
      report.pageErrors = [...errors];
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      let local = false;
      try {
        const url = new URL(request.url());
        local =
          url.protocol === 'data:' ||
          url.protocol === 'blob:' ||
          url.origin === ORIGIN;
      } catch {}
      if (!local) {
        report.externalRequestCount = Math.min(
          1000,
          report.externalRequestCount + 1,
        );
        void request.abort().catch(() => {});
      } else void request.continue().catch(() => {});
    });
    report.progress = { phase: 'fixture-navigation' };
    await page.goto(
      `${ORIGIN}/scripts/fixtures/terrain-picking-lifecycle.html`,
      {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      },
    );
    await page.waitForSelector('#run', { timeout: 10_000 });
    report.environment = {
      browserVersion: (await browser.version()).slice(0, 120),
      userAgent: (await page.evaluate(() => navigator.userAgent)).slice(0, 240),
      nodeVersion: process.version,
      platform: process.platform,
    };
    report.graphics = await browserGraphicsInfo(browser);
    report.progress = { phase: 'terrain-picking-fixture', cycles };
    await writeReportFile(outPath, report);
    const servedIdentity = await page.evaluate(
      () => window.__terrainPickingBuildIdentity || null,
    );
    report.servedBuildIdentity = {
      applicationCommit: SHA1.test(servedIdentity?.applicationCommit || '')
        ? servedIdentity.applicationCommit
        : null,
      harnessCommit: SHA1.test(servedIdentity?.harnessCommit || '')
        ? servedIdentity.harnessCommit
        : null,
    };
    assertServedBuildIdentity(servedIdentity, initialSource.commit);
    await page.evaluate(
      (options) => {
        window.__terrainPickingLifecycleOptions = options;
      },
      { cycles, drainMs },
    );
    await page.click('#run');
    let completion;
    try {
      completion = await waitForTerrainFixtureCompletion(page, PAGE_WAIT_MS);
    } catch (error) {
      const fixtureProgress = error?.progress || error?.fixtureProgress;
      if (fixtureProgress)
        report.progress = {
          phase: fixtureProgress.phase || 'fixture-wait-failure',
          fixtureStatus: fixtureProgress.status || 'unknown',
          currentObservation: fixtureProgress.currentObservation || null,
        };
      throw error;
    }
    const result = completion.report;
    if (!result)
      throw new Error('Fixture finished without a lifecycle report.');
    if (
      result.applicationCommit !== initialSource.commit ||
      result.harnessCommit !== initialSource.commit
    )
      throw new Error(
        'Fixture report identity changed from the expected application commit.',
      );
    const harnessCleanup = report.cleanup;
    Object.assign(report, result, {
      expectedApplicationCommit: initialSource.commit,
      source: report.source,
      environment: report.environment,
      externalRequestCount: report.externalRequestCount,
      pageErrors: [...errors],
      progress: { phase: 'fixture-complete', cycles },
      fixtureCleanup: result.cleanup,
      cleanup: harnessCleanup,
    });
    const observedRenderer =
      result.initialReadiness?.scene?.renderer?.unmaskedRenderer ||
      result.initialReadiness?.scene?.renderer?.renderer ||
      null;
    report.rendererClassification = rendererClassifier(
      observedRenderer,
      report.graphics,
    );
    report.fixture.externalProviderCalls = report.externalRequestCount;
    if (report.status !== 'passed')
      throw new Error(report.error || 'Real Cesium fixture reported failure.');
    if (errors.length) throw new Error(`Fixture page error: ${errors.at(-1)}`);
  } catch (error) {
    primaryError = error;
    report.status = 'failed';
    report.error ||= sanitize(error);
    report.errorDetails = errorDetails(error);
    const observedProgress = error?.progress || error?.fixtureProgress || null;
    report.progress ||= observedProgress
      ? {
          phase: observedProgress.phase || 'fixture-wait-failure',
          fixtureStatus: observedProgress.status || 'unknown',
          currentObservation: observedProgress.currentObservation || null,
        }
      : { phase: 'startup' };
    report.failedPhase ||= observedProgress?.phase || null;
    if (page) {
      const partial = await page
        .evaluate(() => window.__terrainPickingLifecycleResult || null)
        .catch(() => null);
      if (partial) {
        Object.assign(report, partial, {
          status: 'failed',
          expectedApplicationCommit: initialSource.commit,
          source: report.source,
          environment: report.environment,
          externalRequestCount: report.externalRequestCount,
          pageErrors: [...errors],
          error: report.error || partial.error || sanitize(error),
          errorDetails: errorDetails(error),
          failedPhase:
            partial.failedPhase ||
            observedProgress?.phase ||
            partial.phase ||
            null,
          progress: {
            phase: partial.phase || partial.failedPhase || 'fixture-failure',
            fixtureStatus: partial.status || 'unknown',
            currentObservation: partial.currentObservation || null,
          },
          fixtureCleanup: partial.cleanup || report.fixtureCleanup || null,
          cleanup: report.cleanup,
        });
        if (report.fixture)
          report.fixture.externalProviderCalls = report.externalRequestCount;
      }
    }
  } finally {
    if (page) {
      const pageClose = await closeWithin(() => page.close(), 2000);
      report.cleanup.pageClosed = pageClose.completed === true;
      if (!pageClose.completed)
        report.cleanup.pageCloseError = pageClose.timedOut
          ? 'Owned page close exceeded 2000ms.'
          : sanitize(pageClose.error);
    } else report.cleanup.pageClosed = true;
    if (browser) {
      const browserClose = await closeWithin(() => closeBrowser(browser), 7000);
      if (browserClose.completed)
        report.cleanup.browserClose = browserClose.value;
      else {
        report.cleanup.browserClose = {
          closeCompleted: false,
          forcedProcessTermination: false,
          error: browserClose.timedOut
            ? 'Owned browser close exceeded 7000ms.'
            : sanitize(browserClose.error),
        };
        report.status = 'failed';
        report.error ||= report.cleanup.browserClose.error;
        primaryError ||= browserClose.error || new Error(report.error);
      }
    } else {
      report.cleanup.browserClose = {
        closeCompleted: true,
        forcedProcessTermination: false,
      };
    }
    if (server) {
      const closed = await closeWithin(() => server.close(), 3000);
      report.cleanup.serverClosed = closed.completed === true;
      if (!closed.completed) {
        report.cleanup.serverCloseError = closed.timedOut
          ? 'Owned Vite server close exceeded 3000ms.'
          : sanitize(closed.error);
        server.httpServer?.closeAllConnections?.();
      }
    } else report.cleanup.serverClosed = true;
    const finalSource = getSourceIdentity();
    report.source.cleanAtEnd = finalSource.cleanAtStart === true;
    if (
      finalSource.commit !== initialSource.commit ||
      !report.source.cleanAtEnd
    ) {
      report.status = 'failed';
      report.error ||= 'Source identity changed during fixture execution.';
      primaryError ||= new Error(report.error);
    }
    if (
      !report.cleanup.pageClosed ||
      report.cleanup.browserClose?.closeCompleted !== true ||
      report.cleanup.browserClose?.forcedProcessTermination === true ||
      !report.cleanup.serverClosed
    ) {
      report.status = 'failed';
      report.error ||= 'Owned browser/server cleanup was incomplete.';
      primaryError ||= new Error(report.error);
    }
    if (report.status === 'passed') {
      try {
        report.summary = validateTerrainPickingLifecycleReport(report, {
          expectedCycles: cycles,
        });
      } catch (error) {
        report.status = 'failed';
        report.error = sanitize(error);
        primaryError ||= error;
      }
    }
    report.progress = {
      ...(report.progress || {}),
      phase: report.status === 'passed' ? 'complete' : 'failed',
    };
    await writeReportFile(outPath, report).catch((error) => {
      report.status = 'failed';
      report.error ||= `Final evidence report write failed: ${sanitize(error)}`;
      primaryError ||= error;
    });
  }
  if (primaryError) throw primaryError;
  return report;
}

async function main() {
  const options = parseTerrainPickingLifecycleArgs(process.argv.slice(2));
  await runTerrainPickingLifecycle(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${sanitize(error)}\n`);
    process.exitCode = 1;
  });
}
