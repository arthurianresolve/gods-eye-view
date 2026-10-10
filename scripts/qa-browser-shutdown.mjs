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
const PAGE_HIDE_TOKEN_LIMIT = 6;
const PAGE_HIDE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const PAGE_HIDE_BODY_LIMIT_BYTES = 32;
const PAGE_HIDE_DEADLINE_MS = 1_000;
let activeReport = null;

export function preserveInterruptedShutdownReport(
  initialReport,
  latestReport,
  error,
) {
  const report =
    latestReport && Array.isArray(latestReport.controls)
      ? latestReport
      : initialReport;
  report.status = 'failed';
  report.failure ||= `control-matrix-interrupted: ${safeError(error)}`;
  return report;
}

export async function cleanupScratchProfile(
  scratch,
  {
    retain = false,
    resolvePath = realpath,
    removeOwned = rm,
    tempDirectory = os.tmpdir(),
  } = {},
) {
  if (retain) return { status: 'retained-unconfirmed-owned-process' };
  if (!scratch) return { status: 'not-created' };
  try {
    const canonicalTemp = await resolvePath(tempDirectory);
    const canonicalScratch = await resolvePath(scratch);
    if (
      canonicalScratch !== scratch ||
      !isWithin(canonicalTemp, canonicalScratch)
    )
      return {
        status: 'retained-path-validation-failed',
        failure: 'temporary-profile-root-escaped',
      };
    await removeOwned(canonicalScratch, { recursive: true, force: false });
    return { status: 'removed' };
  } catch {
    return {
      status: 'retained-cleanup-failed',
      failure: 'temporary-profile-cleanup-failed',
    };
  }
}

function recordShutdownCleanupFailure(report, failure) {
  report.status = 'failed';
  report.failure ||= failure;
  if (!Array.isArray(report.cleanupFailures)) report.cleanupFailures = [];
  if (report.cleanupFailures.length < 4) report.cleanupFailures.push(failure);
}

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

async function serveFixture(request, response, pageHideTracker) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/__qa/pagehide') {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const token = url.searchParams.get('token');
    const persistedValue = url.searchParams.get('persisted');
    if (
      !PAGE_HIDE_TOKEN_PATTERN.test(token || '') ||
      !['0', '1'].includes(persistedValue)
    ) {
      response.writeHead(400, { Connection: 'close' }).end(() => {
        request.destroy();
      });
      return;
    }
    const declaredLength = Number(request.headers['content-length'] || 0);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > PAGE_HIDE_BODY_LIMIT_BYTES
    ) {
      response.writeHead(413, { Connection: 'close' }).end(() => {
        request.destroy();
      });
      return;
    }
    let bodyBytes = 0;
    const bodyResult = await new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (status !== 204) request.pause();
        request.removeListener('data', onData);
        request.removeListener('end', onEnd);
        request.removeListener('error', onError);
        resolve(status);
      };
      const timer = setTimeout(() => finish(408), 1_000);
      const onData = (chunk) => {
        bodyBytes += chunk.byteLength;
        finish(bodyBytes > PAGE_HIDE_BODY_LIMIT_BYTES ? 413 : 400);
        request.pause();
      };
      const onEnd = () => finish(bodyBytes === 0 ? 204 : 400);
      const onError = () => finish(400);
      request.on('data', onData);
      request.once('end', onEnd);
      request.once('error', onError);
      request.resume();
    });
    if (bodyResult !== 204) {
      response.writeHead(bodyResult, { Connection: 'close' }).end(() => {
        request.destroy();
      });
      return;
    }
    if (!pageHideTracker.observe(token, persistedValue === '1')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
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

function createPageHideTracker() {
  const records = new Map();
  return {
    register(token) {
      if (
        !PAGE_HIDE_TOKEN_PATTERN.test(token || '') ||
        records.size >= PAGE_HIDE_TOKEN_LIMIT ||
        records.has(token)
      )
        return false;
      records.set(token, {
        count: 0,
        persisted: null,
        deliveryElapsedMs: null,
        receivedWithinDeadline: false,
        startedAt: null,
      });
      return true;
    },
    arm(token, startedAt) {
      const record = records.get(token);
      if (!record || record.startedAt !== null || !Number.isFinite(startedAt))
        return false;
      record.startedAt = startedAt;
      return true;
    },
    observe(token, persisted) {
      const record = records.get(token);
      if (
        !record ||
        record.startedAt === null ||
        record.count >= 2 ||
        typeof persisted !== 'boolean'
      )
        return false;
      const deliveryElapsedMs = Math.max(
        0,
        performance.now() - record.startedAt,
      );
      if (record.count === 0) {
        record.persisted = persisted;
        record.deliveryElapsedMs = deliveryElapsedMs;
        record.receivedWithinDeadline =
          deliveryElapsedMs <= PAGE_HIDE_DEADLINE_MS;
      }
      record.count++;
      return true;
    },
    read(token) {
      const record = records.get(token);
      return record
        ? {
            scope: 'fixture-server-sendBeacon',
            count: record.count,
            persisted: record.persisted,
            deliveryElapsedMs: record.deliveryElapsedMs,
            receivedWithinDeadline: record.receivedWithinDeadline,
            deadlineMs: PAGE_HIDE_DEADLINE_MS,
          }
        : null;
    },
    get size() {
      return records.size;
    },
  };
}

export async function startFixtureServer() {
  const pageHideTracker = createPageHideTracker();
  const server = createServer((request, response) => {
    void serveFixture(request, response, pageHideTracker).catch(() => {
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
    pageHideTracker,
  };
}

export async function closeFixtureServer(server) {
  if (!server?.listening)
    return { completed: true, closeAllConnectionsUsed: false };
  return new Promise((resolve) => {
    let settled = false;
    let closeAllConnectionsUsed = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(deadlineTimer);
      resolve({ completed, closeAllConnectionsUsed });
    };
    const forceTimer = setTimeout(() => {
      if (settled) return;
      if (typeof server.closeAllConnections === 'function') {
        closeAllConnectionsUsed = true;
        try {
          server.closeAllConnections();
        } catch {
          finish(false);
        }
      }
    }, 250);
    const deadlineTimer = setTimeout(() => finish(false), 2_000);
    try {
      server.close((error) => finish(!error));
    } catch {
      finish(false);
    }
  });
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

export function installPageHideBeacon() {
  if (window.__qaBrowserShutdownPageHideInstalled) return;
  window.__qaBrowserShutdownPageHideInstalled = true;
  const token = `${Date.now()}-${Math.random()}`.slice(0, 80);
  window.__qaBrowserShutdownDocumentToken = token;
  window.addEventListener('pagehide', (event) => {
    try {
      const persisted = event?.persisted === true ? '1' : '0';
      navigator.sendBeacon(
        `/__qa/pagehide?token=${encodeURIComponent(token)}&persisted=${persisted}`,
        '',
      );
    } catch {}
  });
}

export function recordPageHideAfterDeadline(
  result,
  observation,
  previousCount,
  deadlineWaitCompleted,
) {
  result.pageHideObservation = observation;
  result.pageHideObservedAfterDeadline =
    deadlineWaitCompleted === true &&
    result.pageHideObserved === false &&
    Number.isSafeInteger(observation?.count) &&
    observation.count > previousCount;
  return result;
}

export async function setupDocument(page, kind, origin, pageHideTracker) {
  const pageErrors = [];
  let pageErrorCount = 0;
  let pageHideToken = null;
  if (!pageHideTracker?.register || !pageHideTracker?.read)
    throw new TypeError(
      'Shutdown fixture requires its owned pagehide tracker.',
    );
  page.on('pageerror', (error) => {
    pageErrorCount++;
    if (pageErrors.length < 8) pageErrors.push(safeError(error));
  });
  await withHostTimeout(
    () => page.setRequestInterception(true),
    PAGE_SETUP_TIMEOUT_MS,
  );
  const installAndReadPageHideToken = async () => {
    await withHostTimeout(
      () => page.evaluate(installPageHideBeacon),
      PAGE_SETUP_TIMEOUT_MS,
    );
    const token = await withHostTimeout(
      () =>
        page.evaluate(() => window.__qaBrowserShutdownDocumentToken || null),
      PAGE_SETUP_TIMEOUT_MS,
    );
    if (typeof token !== 'string' || token.length > 80)
      throw new Error('Shutdown document pagehide token was unavailable.');
    if (!pageHideTracker.register(token))
      throw new Error(
        'Shutdown document pagehide token could not be registered.',
      );
    return token;
  };
  const readPageHideCount = (token) => pageHideTracker.read(token)?.count || 0;
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
    pageHideToken = await installAndReadPageHideToken();
    return {
      documentReady: page.url() === `${origin}/blank.html`,
      pageErrors,
      getPageErrors: () => pageErrors.slice(0, 8),
      getPageErrorCount: () => pageErrorCount,
      getPageErrorsTruncated: () => pageErrorCount > pageErrors.length,
      getPageHideCount: (token = pageHideToken) => readPageHideCount(token),
      getPageHideObservation: (token = pageHideToken) =>
        pageHideTracker.read(token),
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
  pageHideToken = await installAndReadPageHideToken();
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
  return {
    documentReady: Boolean(ready) && readiness?.ready === true,
    pageErrors,
    getPageErrors: () => pageErrors.slice(0, 8),
    getPageErrorCount: () => pageErrorCount,
    getPageErrorsTruncated: () => pageErrorCount > pageErrors.length,
    getPageHideCount: (token = pageHideToken) => readPageHideCount(token),
    getPageHideObservation: (token = pageHideToken) =>
      pageHideTracker.read(token),
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
    debugRendererInfoAvailable:
      typeof value.debugRendererInfoAvailable === 'boolean'
        ? value.debugRendererInfoAvailable
        : null,
    unmaskedVendor: cleanText(value.unmaskedVendor),
    unmaskedRenderer: cleanText(value.unmaskedRenderer),
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
  pageHideTracker,
  expectedBrowserVersion,
}) {
  const startedAt = performance.now();
  const result = {
    ...specification,
    freshProfile: true,
    setupCompleted: false,
    documentReady: false,
    pageHideObserved: false,
    pageHideObservedAfterDeadline: false,
    navigationToBlankCompleted: false,
    pageHideObservation: null,
    pageHideFailureReason: null,
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
  let pageHideObservationReader = () => null;
  let pageHideToken = null;
  let pageHideBaseline = 0;
  let pageHideDeadlineWaitCompleted = false;
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
    const prepared = await setupDocument(
      page,
      specification.document,
      origin,
      pageHideTracker,
    );
    pageHideReader = prepared.getPageHideCount;
    pageHideTokenReader = prepared.getPageHideToken;
    pageHideObservationReader = prepared.getPageHideObservation;
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
    if (specification.treatment === 'navigation-first') {
      pageHideToken = pageHideTokenReader();
      pageHideBaseline = pageHideReader(pageHideToken);
      if (!pageHideTracker.arm(pageHideToken, performance.now()))
        throw new Error('Pagehide observation deadline could not be armed.');
      await withHostTimeout(
        () =>
          page.goto('about:blank', {
            waitUntil: 'load',
            timeout: DOCUMENT_TIMEOUT_MS,
          }),
        DOCUMENT_TIMEOUT_MS + 1_000,
      );
      result.navigationToBlankCompleted = page.url() === 'about:blank';
      result.pageHideObserved = await waitForPageHide(
        () => pageHideObservationReader(pageHideToken),
        pageHideBaseline,
        PAGE_HIDE_DEADLINE_MS,
      );
      pageHideDeadlineWaitCompleted = true;
      result.pageHideObservation = pageHideObservationReader(pageHideToken);
      result.pageHideFailureReason = result.navigationToBlankCompleted
        ? result.pageHideObserved
          ? null
          : 'outgoing-pagehide-beacon-not-observed'
        : 'navigation-to-blank-not-completed';
    }
  } catch (error) {
    result.error = safeError(error);
    if (specification.treatment === 'navigation-first') {
      result.pageHideObservation = pageHideObservationReader(pageHideToken);
      result.pageHideFailureReason = result.navigationToBlankCompleted
        ? result.pageHideObserved
          ? null
          : 'outgoing-pagehide-beacon-not-observed'
        : 'navigation-to-blank-not-completed';
    }
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
          if (specification.treatment === 'navigation-first') {
            recordPageHideAfterDeadline(
              result,
              pageHideObservationReader(pageHideToken),
              pageHideBaseline,
              pageHideDeadlineWaitCompleted,
            );
          } else {
            result.pageHideObserved ||= pageHideReader() > 0;
          }
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

function waitForPageHide(readObservation, previousCount, timeoutMs) {
  const receivedOnTime = () => {
    const observation = readObservation();
    return (
      observation?.count > previousCount &&
      observation.receivedWithinDeadline === true &&
      observation.deliveryElapsedMs <= timeoutMs
    );
  };
  if (receivedOnTime()) return Promise.resolve(true);
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
      if (receivedOnTime()) finish(true);
    }, 20);
    const deadline = setTimeout(() => finish(receivedOnTime()), timeoutMs);
  });
}

export async function main() {
  activeReport = null;
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
  let pageHideTracker = null;
  let scratchRetained = false;
  let primaryFailure = null;
  try {
    scratch = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'gev-browser-shutdown-')),
    );
    ({ server, origin, pageHideTracker } = await startFixtureServer());
    let matrix;
    try {
      matrix = await runBrowserShutdownControlMatrix({
        identity,
        runControl: (specification) =>
          executeControl({
            specification,
            scratch,
            origin,
            pageHideTracker,
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
    } catch (error) {
      activeReport = preserveInterruptedShutdownReport(
        report,
        activeReport,
        error,
      );
      throw error;
    }
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
  } catch (error) {
    primaryFailure = error;
    activeReport = preserveInterruptedShutdownReport(
      report,
      activeReport,
      error,
    );
    throw error;
  } finally {
    const finalReport = activeReport || report;
    const allExited =
      finalReport.controls.length > 0 &&
      finalReport.controls.every((row) => row.processExitConfirmed === true);
    if (!allExited) scratchRetained = true;
    try {
      const serverClose = await closeFixtureServer(server);
      finalReport.fixtureServerClose = serverClose;
      if (!serverClose.completed) {
        recordShutdownCleanupFailure(
          finalReport,
          'fixture-server-close-unconfirmed',
        );
        process.exitCode = 1;
      }
    } catch {
      recordShutdownCleanupFailure(finalReport, 'fixture-server-close-failed');
      process.exitCode = 1;
    }
    const scratchCleanup = await cleanupScratchProfile(scratch, {
      retain: scratchRetained,
    });
    finalReport.scratchProfileCleanup = scratchCleanup.status;
    if (scratchCleanup.failure) {
      recordShutdownCleanupFailure(finalReport, scratchCleanup.failure);
      process.exitCode = 1;
    }
    activeReport = finalReport;
    try {
      await persist(out, finalReport);
    } catch (error) {
      recordShutdownCleanupFailure(
        finalReport,
        'shutdown-report-final-persist-failed',
      );
      process.exitCode = 1;
      if (!primaryFailure) throw error;
    }
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
        schema: 'gev-browser-shutdown-controls/v2',
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
