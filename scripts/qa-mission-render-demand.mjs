#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { launchFixtureBrowser } from './qa-application-fixtures.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import { validateMissionRenderDemandReport } from './performance/missionRenderDemand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = 'qa-artifacts/mission-render-demand.json';
const BASE_URL = 'http://127.0.0.1:4174';
const OVERALL_BUDGET_MS = 9 * 60 * 1000;
const SHA1 = /^[a-f0-9]{40}$/;
const SCENARIOS = ['static-empty', 'unselected-orbit', 'selected-live'];
const INPUT_PATHS = [
  'src',
  'server',
  'scripts',
  'vite.config.js',
  'package.json',
  'package-lock.json',
];
const MAX_PNG_BYTES = 1_000_000;
const MAX_TOTAL_PNG_BYTES = 16_000_000;
const MAX_PAGE_ERRORS = 12;

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function sourceIdentity() {
  const dirty = git(['status', '--porcelain', '--', ...INPUT_PATHS]);
  return {
    commit: git(['rev-parse', 'HEAD']),
    inputTreeClean: dirty === '',
  };
}

function sanitizeError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 600);
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

export function parseMissionRenderDemandArgs(argv) {
  const parsed = { out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out')
      throw new TypeError(`Unknown option: ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError('Missing value for --out.');
    parsed.out = value;
  }
  return parsed;
}

export function validateMissionRenderDemandCleanup(cleanup) {
  if (
    cleanup?.pageClosed !== true ||
    cleanup?.browserClose?.closeCompleted !== true ||
    cleanup?.browserClose?.forcedProcessTermination === true ||
    cleanup?.viteClosed !== true
  )
    throw new Error('Owned browser or fixture server cleanup was incomplete.');
  return true;
}

async function writeReport(filePath, report) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function captureTrial(
  page,
  { scenario, variant, repeat, durationMs, timeoutMs },
) {
  let partial = null;
  let png = null;
  try {
    await page.select('#scenario', scenario);
    await page.select('#variant', variant);
    await page.select('#duration', String(durationMs));
    await page.evaluate(() => {
      window.__missionRenderDemandPngDataUrl = null;
    });
    await page.click('#runTrial');
    await page.waitForFunction(
      () => {
        const status = document.querySelector('#status')?.textContent || '';
        return status.startsWith('Completed ') || status.startsWith('Failed;');
      },
      { timeout: timeoutMs },
    );
    const captured = await page.evaluate(() => ({
      trial: window.__missionRenderDemandResult,
      pngDataUrl: window.__missionRenderDemandPngDataUrl,
    }));
    partial = captured.trial;
    if (partial?.status !== 'passed')
      throw new Error(partial?.error || 'Fixture UI reported a failed trial.');
    if (!/^data:image\/png;base64,/.test(captured.pngDataUrl || ''))
      throw new Error('Fresh endpoint PNG was not produced.');
    png = Buffer.from(
      captured.pngDataUrl.slice(captured.pngDataUrl.indexOf(',') + 1),
      'base64',
    );
    if (png.length < 128 || png.length > MAX_PNG_BYTES)
      throw new Error('Endpoint PNG size was outside its bounded range.');
    const cleanup = await page.evaluate(async () =>
      window.disposeMissionRenderDemandTrial(),
    );
    partial.cleanup = cleanup;
    if (
      cleanup.layerDestroyed !== true ||
      cleanup.viewerDestroyed !== true ||
      cleanup.remainingLayerEntityCount !== 0 ||
      cleanup.remainingViewerDestroyed !== true ||
      cleanup.governorAfterLayerDestroy?.holds?.length !== 0 ||
      cleanup.governorAfterLayerDestroy?.scheduledUpdates?.length !== 0 ||
      cleanup.governorAfterUninstall?.installed !== false ||
      cleanup.governorAfterUninstall?.holds?.length !== 0 ||
      cleanup.governorAfterUninstall?.scheduledUpdates?.length !== 0
    )
      throw new Error(
        'Mission trial did not release its layer and render owners.',
      );
    partial.repeat = repeat;
    partial.cameraPose = partial.after?.camera || null;
    partial.endpointPngSha256 = createHash('sha256').update(png).digest('hex');
    partial.endpointPngBytes = png.length;
    return partial;
  } catch (error) {
    partial ||= await page
      .evaluate(() => window.__missionRenderDemandResult)
      .catch(() => null);
    if (partial && partial.status === 'passed' && !partial.cleanup) {
      const cleanup = await page
        .evaluate(async () => window.disposeMissionRenderDemandTrial())
        .catch(() => null);
      partial.cleanup = cleanup;
    }
    return {
      ...(partial || {}),
      schema: 'gev-mission-render-demand-trial/v1',
      status: 'failed',
      scenario,
      variant,
      repeat,
      durationMs,
      wrapperFailure: sanitizeError(error),
      endpointPngSha256: png
        ? createHash('sha256').update(png).digest('hex')
        : null,
      endpointPngBytes: png?.length || 0,
    };
  }
}

export async function runMissionRenderDemand({ out = DEFAULT_OUT } = {}) {
  const outPath = path.resolve(ROOT, out);
  const initialIdentity = sourceIdentity();
  if (!SHA1.test(initialIdentity.commit))
    throw new Error('Harness commit could not be verified.');
  if (!initialIdentity.inputTreeClean)
    throw new Error(
      'Mission fixture source, harness, or dependency input tree is dirty.',
    );

  const startedAt = Date.now();
  const report = {
    schema: 'gev-mission-render-demand/v1',
    status: 'running',
    scope:
      'isolated real mission layer; full application UI and world overlays are omitted',
    hardwareAcceptance: false,
    source: initialIdentity,
    applicationCommit: initialIdentity.commit,
    harnessCommit: initialIdentity.commit,
    buildRecipe: {
      kind: 'vite-development-server',
      config: 'vite.config.js',
      productionBundle: false,
    },
    fixtureIdentity: 'mission-render-demand-two-launches-per-page-epoch/v1',
    rendererMode: 'native hosted renderer; classification recorded from WebGL',
    desktopForegroundVerification: 'unavailable',
    expectedViewport: { width: 960, height: 640, deviceScaleFactor: 1 },
    repeats: 5,
    trials: [],
    cleanup: {
      pageClosed: false,
      browserClose: null,
      viteClosed: false,
    },
    failure: null,
  };
  let server = null;
  let browser = null;
  let page = null;
  let primaryError = null;
  let serverCloseFailure = null;
  let totalPngBytes = 0;
  report.pngArtifacts = [];
  report.pageErrors = [];
  await writeReport(outPath, report);
  try {
    if (!initialIdentity.inputTreeClean)
      throw new Error(
        'Mission fixture source, harness, or dependency input tree is dirty.',
      );
    if (process.platform !== 'darwin')
      throw new Error(
        'Mission render-demand hosted proof requires the macOS runner.',
      );
    server = await createServer({
      configFile: path.join(ROOT, 'vite.config.js'),
      root: ROOT,
      logLevel: 'error',
      clearScreen: false,
      server: { host: '127.0.0.1', port: 4174, strictPort: true },
    });
    await server.listen();
    browser = await launchFixtureBrowser({ protocolTimeout: 15_000 });
    page = await browser.newPage();
    await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 1 });
    await page.bringToFront();
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(sanitizeError(error));
      if (pageErrors.length > MAX_PAGE_ERRORS) pageErrors.shift();
      report.pageErrors = [...pageErrors];
    });
    await page.goto(`${BASE_URL}/scripts/fixtures/mission-render-demand.html`, {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    });
    await page.waitForSelector('#runTrial', { timeout: 10_000 });
    const browserVersion = await browser.version();
    report.environment = {
      browserVersion: browserVersion.slice(0, 120),
      userAgent: (await page.evaluate(() => navigator.userAgent)).slice(0, 240),
      platform: process.platform,
      nodeVersion: process.version,
    };
    if (!String(report.environment.userAgent).includes('Chrome'))
      throw new Error('Expected a Chromium-based hosted browser.');
    if (report.environment.platform !== 'darwin')
      throw new Error(
        'Mission render-demand fixture is restricted to the macOS hosted runner.',
      );
    report.progress = { phase: 'trials', completed: 0, expected: 30 };
    await writeReport(outPath, report);

    for (const scenario of SCENARIOS) {
      const durationMs = scenario === 'static-empty' ? 10_000 : 3_000;
      for (let repeat = 1; repeat <= 5; repeat += 1) {
        const order =
          repeat % 2 === 1
            ? ['continuous-control', 'demand-candidate']
            : ['demand-candidate', 'continuous-control'];
        for (const variant of order) {
          const remainingBudgetMs =
            OVERALL_BUDGET_MS - (Date.now() - startedAt) - 20_000;
          if (remainingBudgetMs <= 0)
            throw new Error(
              'Overall mission render-demand fixture budget expired.',
            );
          report.progress = {
            phase: 'trial',
            scenario,
            repeat,
            variant,
            completed: report.trials.length,
            expected: 30,
          };
          await writeReport(outPath, report);
          const trial = await captureTrial(page, {
            scenario,
            variant,
            repeat,
            durationMs,
            timeoutMs: Math.min(durationMs + 8_000, remainingBudgetMs),
          });
          report.trials.push(trial);
          if (trial.endpointPngBytes > 0) {
            totalPngBytes += trial.endpointPngBytes;
            if (totalPngBytes > MAX_TOTAL_PNG_BYTES)
              throw new Error(
                'Endpoint image artifact total exceeded its bound.',
              );
            const pngName = `mission-render-demand-${scenario}-r${repeat}-${variant}.png`;
            const pngPath = path.join(path.dirname(outPath), pngName);
            const encoded = await page.evaluate(
              () => window.__missionRenderDemandPngDataUrl || null,
            );
            if (!encoded)
              throw new Error('Endpoint image artifact was unavailable.');
            const png = Buffer.from(
              encoded.slice(encoded.indexOf(',') + 1),
              'base64',
            );
            if (png.length !== trial.endpointPngBytes)
              throw new Error('Endpoint image artifact changed after capture.');
            await writeFile(pngPath, png);
            report.pngArtifacts.push({
              file: pngName,
              scenario,
              repeat,
              variant,
              bytes: png.length,
              sha256: trial.endpointPngSha256,
            });
            await page.evaluate(() => {
              window.__missionRenderDemandPngDataUrl = null;
            });
          }
          report.progress = {
            phase: 'trial-complete',
            scenario,
            repeat,
            variant,
            completed: report.trials.length,
            expected: 30,
          };
          await writeReport(outPath, report);
          if (trial.status !== 'passed')
            throw new Error(
              trial.wrapperFailure || trial.error || 'Fixture trial failed.',
            );
          if (trial.rendererClassification !== 'native-metal')
            throw new Error(
              'Hosted browser did not report a native Metal renderer.',
            );
          if (pageErrors.length)
            throw new Error(`Fixture page error: ${pageErrors.at(-1)}`);
        }
      }
    }
    report.summary = validateMissionRenderDemandReport(report, { repeats: 5 });
    report.status = 'passed';
  } catch (error) {
    primaryError = error;
    report.status = 'failed';
    report.failure = sanitizeError(error);
    report.progress ||= { phase: 'startup', completed: 0, expected: 30 };
    await writeReport(outPath, report).catch(() => {});
  } finally {
    if (page) {
      const pageClose = await closeWithin(
        () => page.close({ runBeforeUnload: false }),
        2_000,
      );
      report.cleanup.pageClosed = pageClose.completed === true;
      if (!pageClose.completed)
        report.cleanup.pageCloseFailure = pageClose.timedOut
          ? 'Page close exceeded the two-second cleanup bound.'
          : sanitizeError(pageClose.error);
    } else {
      report.cleanup.pageClosed = true;
    }
    if (browser) {
      report.cleanup.browserClose = await closeRecoveryBrowser(browser, {
        timeoutMs: 5_000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
    } else {
      report.cleanup.browserClose = {
        closeCompleted: true,
        forcedProcessTermination: false,
      };
    }
    if (server) {
      const serverClose = await closeWithin(() => server.close(), 3_000);
      report.cleanup.viteClosed = serverClose.completed === true;
      if (!serverClose.completed) {
        serverCloseFailure = serverClose.timedOut
          ? 'Vite close exceeded the three-second cleanup bound.'
          : sanitizeError(serverClose.error);
        report.cleanup.serverCloseFailure = serverCloseFailure;
        server.httpServer?.closeAllConnections?.();
      }
    } else {
      report.cleanup.viteClosed = true;
    }
    try {
      validateMissionRenderDemandCleanup(report.cleanup);
    } catch (error) {
      report.status = 'failed';
      report.cleanupFailure = sanitizeError(error);
      if (!primaryError) primaryError = error;
    }
    const finalIdentity = sourceIdentity();
    report.sourceAfter = finalIdentity;
    report.sourceStable =
      finalIdentity.commit === initialIdentity.commit &&
      finalIdentity.inputTreeClean;
    report.elapsedMs = Math.max(0, Date.now() - startedAt);
    if (!report.sourceStable) {
      report.status = 'failed';
      report.sourceFailure =
        'Fixture source changed or became dirty during the run.';
      primaryError ||= new Error(report.sourceFailure);
    }
    if (report.status !== 'failed') report.failure = null;
    await writeReport(outPath, report).catch((error) => {
      primaryError ||= error;
    });
  }
  if (primaryError) throw primaryError;
  return report;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    const options = parseMissionRenderDemandArgs(process.argv.slice(2));
    await runMissionRenderDemand(options);
  } catch (error) {
    console.error(`[mission-render-demand] ${sanitizeError(error)}`);
    process.exitCode = 1;
  }
}
