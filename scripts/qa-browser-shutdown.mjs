#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  rename,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fixtureBrowserArgs,
  launchFixtureBrowser,
} from './qa-application-fixtures.mjs';
import {
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  createRecoveryBrowserCloseTrace,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import { withHostTimeout } from './performance/startupDiagnostics.mjs';
import {
  BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS,
  createBrowserShutdownReport,
  runBrowserShutdownControlMatrix,
  sanitizeShutdownError,
  validateBrowserShutdownReport,
} from './performance/browserShutdownControls.mjs';
import {
  BLANK_DOCUMENT,
  CESIUM_DOCUMENT,
  WEBGL_DOCUMENT,
} from './performance/browserShutdownFixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CESIUM_ROOT = await realpath(
  path.join(ROOT, 'node_modules/cesium/Build/Cesium'),
);
const CESIUM_BUNDLE = path.join(CESIUM_ROOT, 'Cesium.js');
const MAX_STATIC_ASSET_BYTES = 32 * 1024 * 1024;
const LAUNCH_TIMEOUT_MS = 30_000;
const PAGE_SETUP_TIMEOUT_MS = 15_000;
const DOCUMENT_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_OBSERVATION_MS = 1_000;
let activeReport = null;

function parseArgs(argv) {
  let out = 'qa-artifacts/browser-shutdown.json';
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--out') {
      const candidate = argv[++index];
      if (!candidate || candidate.startsWith('--'))
        throw new Error('--out requires a file path.');
      out = candidate;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return { out: path.resolve(ROOT, out) };
}

function gitText(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  }).trim();
}

function safeError(error) {
  return sanitizeShutdownError(error);
}

async function persist(out, report) {
  await mkdir(path.dirname(out), { recursive: true });
  const temporary = `${out}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporary, out);
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.wasm': 'application/wasm',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.bin': 'application/octet-stream',
      '.xml': 'application/xml',
    }[ext] || 'application/octet-stream'
  );
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

async function serveCesium(response, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice('/cesium/'.length));
  } catch {
    response.writeHead(400).end();
    return;
  }
  const file = path.resolve(CESIUM_ROOT, relative);
  if (!isWithin(CESIUM_ROOT, file)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const canonicalFile = await realpath(file);
    if (!isWithin(CESIUM_ROOT, canonicalFile)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(canonicalFile);
    if (!info.isFile() || info.size > MAX_STATIC_ASSET_BYTES) {
      response.writeHead(info.size > MAX_STATIC_ASSET_BYTES ? 413 : 404).end();
      return;
    }
    const body = await readFile(canonicalFile);
    response.writeHead(200, {
      'Content-Type': mimeType(file),
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

async function serveFixture(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/webgl2.html') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(WEBGL_DOCUMENT);
  } else if (pathname === '/blank.html') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(BLANK_DOCUMENT);
  } else if (pathname === '/cesium.html') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(CESIUM_DOCUMENT);
  } else if (pathname.startsWith('/cesium/')) {
    await serveCesium(response, pathname);
  } else {
    response.writeHead(404).end();
  }
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    void serveFixture(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await withHostTimeout(
    () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      }),
    5_000,
  );
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeServer(server) {
  if (!server?.listening) return true;
  return (
    (await withHostTimeout(
      () =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve(true))),
        ),
      2_000,
    )) === true
  );
}

async function waitForChildExit(child, timeoutMs) {
  if (!child) return { confirmed: false, code: null, signal: null };
  if (child.exitCode != null || child.signalCode != null)
    return {
      confirmed: true,
      code: child.exitCode,
      signal: child.signalCode,
      elapsedMs: null,
    };
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let timer;
    const finish = (value) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = (code, signal) =>
      finish({
        confirmed: true,
        code,
        signal,
        elapsedMs: Math.max(0, performance.now() - startedAt),
      });
    child.once('exit', onExit);
    timer = setTimeout(() => {
      finish({
        confirmed: child.exitCode != null || child.signalCode != null,
        code: child.exitCode,
        signal: child.signalCode,
        elapsedMs:
          child.exitCode != null || child.signalCode != null
            ? Math.max(0, performance.now() - startedAt)
            : null,
      });
    }, timeoutMs);
  });
}

export async function setupDocument(page, kind, origin) {
  const pageErrors = [];
  let pageErrorCount = 0;
  const pageHideCounts = new Map();
  await withHostTimeout(
    () =>
      page.exposeFunction('qaObservePageHide', (token) => {
        if (typeof token !== 'string' || token.length > 80) return;
        const previous = pageHideCounts.get(token) || 0;
        pageHideCounts.set(token, Math.min(2, previous + 1));
      }),
    PAGE_SETUP_TIMEOUT_MS,
  );
  const installPageHideObserver = () => {
    if (window.__qaBrowserShutdownPageHideInstalled) return;
    window.__qaBrowserShutdownPageHideInstalled = true;
    const token = `${Date.now()}-${Math.random()}`.slice(0, 80);
    window.__qaBrowserShutdownDocumentToken = token;
    window.addEventListener('pagehide', () => {
      try {
        window.qaObservePageHide(token);
      } catch {}
    });
  };
  await withHostTimeout(
    () => page.evaluateOnNewDocument(installPageHideObserver),
    PAGE_SETUP_TIMEOUT_MS,
  );
  await withHostTimeout(
    () => page.evaluate(installPageHideObserver),
    PAGE_SETUP_TIMEOUT_MS,
  );
  page.on('pageerror', (error) => {
    pageErrorCount++;
    if (pageErrors.length < 8) pageErrors.push(safeError(error));
  });
  await withHostTimeout(
    () => page.setRequestInterception(true),
    PAGE_SETUP_TIMEOUT_MS,
  );
  const readPageHideToken = async () => {
    const token = await withHostTimeout(
      () =>
        page.evaluate(() => window.__qaBrowserShutdownDocumentToken || null),
      PAGE_SETUP_TIMEOUT_MS,
    );
    if (typeof token !== 'string' || token.length > 80)
      throw new Error('Shutdown document pagehide token was unavailable.');
    return token;
  };
  page.on('request', (request) => {
    let allowed = false;
    try {
      allowed = new URL(request.url()).origin === origin;
    } catch {}
    void (allowed ? request.continue() : request.abort()).catch(() => {});
  });
  if (kind === 'blank') {
    await withHostTimeout(
      () =>
        page.goto(`${origin}/blank.html`, {
          waitUntil: 'load',
          timeout: DOCUMENT_TIMEOUT_MS,
        }),
      DOCUMENT_TIMEOUT_MS + 1_000,
    );
    const pageHideToken = await readPageHideToken();
    return {
      documentReady: page.url() === `${origin}/blank.html`,
      pageErrors,
      getPageErrors: () => pageErrors.slice(0, 8),
      getPageErrorCount: () => pageErrorCount,
      getPageErrorsTruncated: () => pageErrorCount > pageErrors.length,
      getPageHideCount: (token = pageHideToken) =>
        pageHideCounts.get(token) || 0,
      getPageHideToken: () => pageHideToken,
      readiness: { blank: true },
    };
  }
  const target = kind === 'webgl2' ? '/webgl2.html' : '/cesium.html';
  await withHostTimeout(
    () =>
      page.goto(`${origin}${target}`, {
        waitUntil: 'load',
        timeout: DOCUMENT_TIMEOUT_MS,
      }),
    DOCUMENT_TIMEOUT_MS + 1_000,
  );
  const ready = await withHostTimeout(
    () =>
      page.waitForFunction(() => window.__shutdownReady?.ready === true, {
        timeout: DOCUMENT_TIMEOUT_MS - 1_000,
      }),
    DOCUMENT_TIMEOUT_MS,
  );
  const readiness = await withHostTimeout(
    () => page.evaluate(() => window.__shutdownReady),
    PAGE_SETUP_TIMEOUT_MS,
  );
  const pageHideToken = await readPageHideToken();
  return {
    documentReady: Boolean(ready) && readiness?.ready === true,
    pageErrors,
    getPageErrors: () => pageErrors.slice(0, 8),
    getPageErrorCount: () => pageErrorCount,
    getPageErrorsTruncated: () => pageErrorCount > pageErrors.length,
    getPageHideCount: (token = pageHideToken) => pageHideCounts.get(token) || 0,
    getPageHideToken: () => pageHideToken,
    readiness: {
      ready: readiness?.ready === true,
      webgl2: readiness?.webgl2 === true,
      cesium: readiness?.cesium === true,
      contextAvailable: readiness?.contextAvailable === true,
      canvasWidth: Number.isSafeInteger(readiness?.canvasWidth)
        ? readiness.canvasWidth
        : null,
      canvasHeight: Number.isSafeInteger(readiness?.canvasHeight)
        ? readiness.canvasHeight
        : null,
      renderingContext: sanitizeRenderingContext(readiness?.renderingContext),
      readyFrameElapsedMs: finiteNonnegative(readiness?.readyFrameElapsedMs),
      errorName:
        typeof readiness?.errorName === 'string'
          ? readiness.errorName.slice(0, 48)
          : null,
    },
  };
}

function sanitizeRenderingContext(value) {
  if (!value || typeof value !== 'object') return null;
  const cleanText = (item) =>
    typeof item === 'string'
      ? item.replace(/[\r\n\t]+/g, ' ').slice(0, 128)
      : null;
  return {
    version: cleanText(value.version),
    vendor: cleanText(value.vendor),
    renderer: cleanText(value.renderer),
    rendererQueryDurationMs: finiteNonnegative(value.rendererQueryDurationMs),
    antialias: typeof value.antialias === 'boolean' ? value.antialias : null,
    alpha: typeof value.alpha === 'boolean' ? value.alpha : null,
  };
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

async function executeControl({
  specification,
  scratch,
  origin,
  expectedBrowserVersion,
}) {
  const startedAt = performance.now();
  const result = {
    ...specification,
    freshProfile: true,
    setupCompleted: false,
    documentReady: false,
    pageHideObserved: false,
    unloadNavigationCompleted: false,
    pageCloseCompleted: false,
    openPageCountAfterClose: null,
    browserCloseCompleted: false,
    forcedProcessTermination: false,
    processExitConfirmed: false,
    processExitScope: 'browser-parent-process-only; descendants-unobserved',
    processExitCode: null,
    processExitSignal: null,
    browserVersion: null,
    browserVersionConsistent: false,
    closeObservation: null,
    readiness: null,
    pageErrors: [],
    pageErrorCount: 0,
    pageErrorsTruncated: false,
    closeTrace: null,
    error: null,
    elapsedMs: null,
  };
  const profileRoot = await realpath(scratch);
  const profileDirectory = path.join(profileRoot, specification.id);
  assert.equal(isWithin(profileRoot, profileDirectory), true);
  await mkdir(profileDirectory, { recursive: false });
  let browser = null;
  let page = null;
  let pageHideReader = () => 0;
  let pageHideTokenReader = () => null;
  let pageErrorCountReader = () => 0;
  let pageErrorsReader = () => [];
  let browserCloseTrace = null;
  let closeOutcome = null;
  let forcedAfterClose = false;
  try {
    browserCloseTrace = createRecoveryBrowserCloseTrace();
    browser = await withHostTimeout(
      () =>
        launchFixtureBrowser({
          userDataDir: profileDirectory,
          timeout: LAUNCH_TIMEOUT_MS,
          protocolTimeout: PAGE_SETUP_TIMEOUT_MS,
          logger: browserCloseTrace.logger,
        }),
      LAUNCH_TIMEOUT_MS + 1_000,
    );
    result.browserVersion = await withHostTimeout(
      () => browser.version(),
      PAGE_SETUP_TIMEOUT_MS,
    );
    result.browserVersionConsistent =
      !expectedBrowserVersion ||
      result.browserVersion === expectedBrowserVersion;
    const pages = await withHostTimeout(
      () => browser.pages(),
      PAGE_SETUP_TIMEOUT_MS,
    );
    if (
      pages.length !== 1 ||
      pages[0].url() !== 'about:blank' ||
      (await browser.targets()).filter((target) => target.type() === 'page')
        .length !== 1
    )
      throw new Error(
        'Fresh browser profile did not start with one blank page.',
      );
    page = pages[0];
    await withHostTimeout(
      () => page.setViewport({ width: 800, height: 600 }),
      PAGE_SETUP_TIMEOUT_MS,
    );
    const prepared = await setupDocument(page, specification.document, origin);
    pageHideReader = prepared.getPageHideCount;
    pageHideTokenReader = prepared.getPageHideToken;
    pageErrorCountReader = prepared.getPageErrorCount;
    pageErrorsReader = prepared.getPageErrors;
    result.documentReady = prepared.documentReady;
    result.readiness = prepared.readiness;
    result.pageErrors = prepared.pageErrors.slice(0, 8);
    result.pageErrorCount = prepared.getPageErrorCount();
    result.pageErrorsTruncated = prepared.getPageErrorsTruncated();
    result.setupCompleted = result.documentReady;
    if (!result.documentReady)
      throw new Error('Control document did not reach its ready state.');
    if (prepared.pageErrors.length)
      throw new Error('Control document emitted a page error.');
    if (specification.treatment === 'unload-first') {
      const pageHideToken = pageHideTokenReader();
      const pageHideBaseline = pageHideReader(pageHideToken);
      await withHostTimeout(
        () =>
          page.goto('about:blank', {
            waitUntil: 'load',
            timeout: DOCUMENT_TIMEOUT_MS,
          }),
        DOCUMENT_TIMEOUT_MS + 1_000,
      );
      result.unloadNavigationCompleted = page.url() === 'about:blank';
      result.pageHideObserved = await waitForPageHide(
        () => pageHideReader(pageHideToken),
        pageHideBaseline,
        1_000,
      );
    }
  } catch (error) {
    result.error = safeError(error);
    if (page) result.pageHideObserved ||= pageHideReader() > 0;
  } finally {
    if (browser) {
      if (page) {
        try {
          const closed = await closeOwnedRecoveryPage(
            page,
            browser,
            BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS,
          );
          result.pageCloseCompleted = closed.closeCompleted;
          result.openPageCountAfterClose = closed.openPageCount;
          result.pageHideObserved ||= pageHideReader() > 0;
          result.pageErrorCount = pageErrorCountReader();
          result.pageErrors = pageErrorsReader();
          result.pageErrorsTruncated =
            result.pageErrorCount > result.pageErrors.length;
          if (result.pageErrorCount > 0)
            result.error ||= 'Control document emitted a page error.';
        } catch (error) {
          result.error ||= safeError(error);
        }
      }
      try {
        closeOutcome = await closeRecoveryBrowser(browser, {
          timeoutMs: BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS,
          closeTrace: browserCloseTrace,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        });
        result.browserCloseCompleted = closeOutcome.closeCompleted;
        result.forcedProcessTermination = closeOutcome.forcedProcessTermination;
        result.closeTrace = closeOutcome.observation.protocolCloseTrace;
        result.closeObservation = closeOutcome.observation;
        result.closeObservation.externalProcessExitWaitMs = 0;
        result.closeObservation.externalProcessExitWaitConfirmed = Boolean(
          closeOutcome.observation.processExit,
        );
        result.closeObservation.externalForceProcessAttempted = false;
        result.closeObservation.externalForceProcessStatus = 'not-needed';
        result.processExitConfirmed = Boolean(
          closeOutcome.observation.processExit,
        );
        result.processExitCode =
          closeOutcome.observation.processExit?.code ?? null;
        result.processExitSignal =
          closeOutcome.observation.processExit?.signal ?? null;
        if (!result.processExitConfirmed) {
          const child = browser.process();
          const exit = await waitForChildExit(
            child,
            PROCESS_EXIT_OBSERVATION_MS,
          );
          result.closeObservation.externalProcessExitWaitMs = exit.elapsedMs;
          result.closeObservation.externalProcessExitWaitConfirmed =
            exit.confirmed;
          result.processExitConfirmed = exit.confirmed;
          result.processExitCode = exit.code;
          result.processExitSignal = exit.signal;
          result.closeObservation.processExit = {
            code: exit.code,
            signal: exit.signal,
            elapsedMs: exit.elapsedMs,
          };
          if (!exit.confirmed) {
            const forced = await stopOwnedRecoveryProcessTree(child);
            result.closeObservation.externalForceProcessAttempted =
              forced.attempted === true;
            result.closeObservation.externalForceProcessStatus =
              /^[a-z-]{1,40}$/.test(forced.reason || '')
                ? forced.reason
                : 'unknown';
            forcedAfterClose = forced.attempted && forced.confirmed;
            result.forcedProcessTermination ||= forcedAfterClose;
            const finalExit = await waitForChildExit(child, 1_500);
            result.closeObservation.externalFinalExitWaitMs =
              finalExit.elapsedMs;
            result.closeObservation.externalFinalExitWaitConfirmed =
              finalExit.confirmed;
            result.processExitConfirmed = finalExit.confirmed;
            result.processExitCode = finalExit.code;
            result.processExitSignal = finalExit.signal;
            result.closeObservation.processExit = {
              code: finalExit.code,
              signal: finalExit.signal,
              elapsedMs: finalExit.elapsedMs,
            };
          }
        }
      } catch (error) {
        result.error ||= safeError(error);
      }
    }
    result.elapsedMs = Math.max(0, performance.now() - startedAt);
  }
  if (result.forcedProcessTermination && !result.error)
    result.error = 'Owned Chrome process required forced cleanup.';
  if (!result.processExitConfirmed && !result.error)
    result.error = 'Owned Chrome process exit was not confirmed.';
  return result;
}

function waitForPageHide(readCount, previousCount, timeoutMs) {
  if (readCount() > previousCount) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (observed) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      resolve(observed);
    };
    const poll = setInterval(() => {
      if (readCount() > previousCount) finish(true);
    }, 20);
    const deadline = setTimeout(
      () => finish(readCount() > previousCount),
      timeoutMs,
    );
  });
}

export async function main() {
  if (process.platform !== 'win32')
    throw new Error('Browser shutdown controls are Windows-only.');
  if (
    process.env.GEV_QA_SOFTWARE_RENDERING !== '1' ||
    process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY !== '1'
  )
    throw new Error(
      'Browser shutdown controls require the declared WebGL-only SwiftShader backend.',
    );
  const { out } = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(out), { recursive: true });
  const sourceCommit = gitText(['rev-parse', 'HEAD']);
  if (process.env.GITHUB_SHA !== sourceCommit)
    throw new Error('GITHUB_SHA must match the checked-out source commit.');
  const sourceCleanAtStart = gitText(['status', '--porcelain']) === '';
  const cesiumPackage = JSON.parse(
    await readFile(path.join(ROOT, 'node_modules/cesium/package.json'), 'utf8'),
  );
  const cesiumBundleSha256 = createHash('sha256')
    .update(await readFile(CESIUM_BUNDLE))
    .digest('hex');
  const fixtureSha256 = createHash('sha256')
    .update(BLANK_DOCUMENT)
    .update('\0')
    .update(WEBGL_DOCUMENT)
    .update('\0')
    .update(CESIUM_DOCUMENT)
    .digest('hex');
  const identity = {
    sourceCommit,
    harnessCommit: sourceCommit,
    sourceCleanAtStart,
    sourceCleanAtEnd: null,
    nodeVersion: process.version,
    platform: process.platform,
    osRelease: os.release().slice(0, 80),
    osVersion: os
      .version()
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 160),
    cesiumVersion: cesiumPackage.version,
    cesiumBundleSha256,
    fixtureSha256,
    fixtureIdentity: 'blank-webgl2-cesium-installed-build-v1',
    fixtureBuildRecipe: 'direct-installed-cesium-static-tree-no-app-build',
    launchFlags: fixtureBrowserArgs(),
    rendererMode: {
      softwareRendering: process.env.GEV_QA_SOFTWARE_RENDERING === '1',
      webglOnly: process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY === '1',
    },
    browserVersion: null,
  };
  if (!sourceCleanAtStart)
    throw new Error(
      'Browser shutdown controls require a clean source checkout.',
    );
  const report = createBrowserShutdownReport(identity);
  activeReport = report;
  await persist(out, report);
  let scratch = null;
  let server = null;
  let origin = null;
  let scratchRetained = false;
  try {
    scratch = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'gev-browser-shutdown-')),
    );
    ({ server, origin } = await startFixtureServer());
    const matrix = await runBrowserShutdownControlMatrix({
      identity,
      runControl: (specification) =>
        executeControl({
          specification,
          scratch,
          origin,
          expectedBrowserVersion: identity.browserVersion,
        }),
      onControl: async (row, partial) => {
        activeReport = partial;
        console.log(
          JSON.stringify({
            phase: 'browser-shutdown-control',
            id: row.id,
            status: row.status,
            processExitConfirmed: row.processExitConfirmed,
            browserCloseCompleted: row.browserCloseCompleted,
            forcedProcessTermination: row.forcedProcessTermination,
          }),
        );
        await persist(out, partial);
      },
    });
    identity.browserVersion = matrix.identity.browserVersion;
    identity.sourceCleanAtEnd = gitText(['status', '--porcelain']) === '';
    const sourceCommitAtEnd = gitText(['rev-parse', 'HEAD']);
    Object.assign(report, matrix);
    activeReport = report;
    report.identity.sourceCleanAtEnd = identity.sourceCleanAtEnd;
    report.identity.sourceCommitAtEnd = sourceCommitAtEnd;
    if (!identity.sourceCleanAtEnd || sourceCommitAtEnd !== sourceCommit) {
      report.status = 'failed';
      report.failure = 'source-checkout-changed-during-controls';
    }
    validateBrowserShutdownReport(report);
    await persist(out, report);
    if (report.status !== 'passed') process.exitCode = 1;
  } finally {
    const allExited =
      report.controls.length > 0 &&
      report.controls.every((row) => row.processExitConfirmed === true);
    if (!allExited) scratchRetained = true;
    try {
      const serverClosed = await closeServer(server);
      if (!serverClosed) {
        report.status = 'failed';
        report.failure = 'fixture-server-close-unconfirmed';
        process.exitCode = 1;
      }
    } catch {
      report.status = 'failed';
      report.failure = 'fixture-server-close-failed';
      process.exitCode = 1;
    }
    report.scratchProfileCleanup = scratchRetained
      ? 'retained-unconfirmed-owned-process'
      : 'removed-after-owned-process-exits';
    if (!scratchRetained && scratch) {
      const root = await realpath(scratch);
      if (root !== scratch || !isWithin(await realpath(os.tmpdir()), root)) {
        report.status = 'failed';
        report.failure = 'temporary-profile-root-escaped';
        process.exitCode = 1;
      } else {
        try {
          await rm(root, { recursive: true, force: false });
        } catch {
          report.status = 'failed';
          report.failure = 'temporary-profile-cleanup-failed';
          process.exitCode = 1;
        }
      }
    }
    await persist(out, report);
  }
  console.log(
    JSON.stringify({
      phase: 'browser-shutdown-complete',
      status: report.status,
      outFile: path.basename(out),
      controls: report.controls.length,
    }),
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly)
  main().catch(async (error) => {
    const out = (() => {
      try {
        return parseArgs(process.argv.slice(2)).out;
      } catch {
        return path.resolve(ROOT, 'qa-artifacts/browser-shutdown.json');
      }
    })();
    try {
      await mkdir(path.dirname(out), { recursive: true });
      const partial = activeReport || {
        schema: 'gev-browser-shutdown-controls/v1',
        status: 'failed',
        scope: 'owned-chrome-close-controls; diagnostic-only',
        closeDeadlineMs: BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS,
        controls: [],
        blockedControls: [],
        failure: sanitizeShutdownError(error),
      };
      partial.status = 'failed';
      partial.failure ||= sanitizeShutdownError(error);
      await persist(out, partial);
    } catch {}
    console.error(
      JSON.stringify({
        phase: 'browser-shutdown-failed',
        error: sanitizeShutdownError(error),
      }),
    );
    process.exitCode = 1;
  });
