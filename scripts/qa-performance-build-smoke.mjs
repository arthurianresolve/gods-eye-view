#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import {
  cleanupFixturePageDiagnostics,
  prepareFixturePage,
} from './qa-application-fixtures.mjs';
import { createLocalBuildReceipt } from './performance/buildProvenance.mjs';
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
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  installFixedWallClock,
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

const BASELINE_SHA = 'eb8c6828d0d03e1c04bda94c8c4fb99915a577b7';
const ROOT = await realpath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const DEFAULT_BUDGET_MS = 12 * 60 * 1000;
const BUILD_COMMAND_TIMEOUT_MS = 150 * 1000;
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

const OPTION_KEYS = new Map([
  ['--candidate-sha', 'candidateSha'],
  ['--out', 'out'],
]);

export function parseSmokeArguments(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = OPTION_KEYS.get(flag);
    if (!key) throw new TypeError(`Unknown option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError(`Missing value for ${flag}`);
    output[key] = value;
  }
  return output;
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

async function runRevision({
  browser,
  checkout,
  commit,
  label,
  harnessCommit,
  tempRoot,
  startedAt,
  budgetMs,
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
  let provenance = null;
  let fixturePage = null;
  let workerBlobValidation = null;
  let workerBlobDiagnostics = null;
  let densePopulationObservations = [];
  let finalDenseLayerPopulation = null;
  let phase = 'browser-page-setup';
  const pageErrors = [];
  const cleanupErrors = [];
  let failure = null;
  let result = null;
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
    });
    phase = 'budget-check-before-browser';
    if (Date.now() - startedAt > budgetMs)
      throw new Error('Smoke time budget expired before browser load.');

    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
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
    fixturePage = await prepareFixturePage(browser, served.baseUrl, {
      page,
      viewport: { width: 1280, height: 900 },
      respond: (url, request) =>
        respondToWorkerPreflight(url, served.baseUrl) ??
        respondToProductionFlightFixture(
          url,
          request,
          flightFixture,
          served.baseUrl,
        ),
      onFulfilled: flightFixtureDelivery.onFulfilled,
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
      installFixedWallClock,
      flightFixture.fixedTimeMs,
    );
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

    phase = 'production-provider-fixture-population';
    const expectedLayerCounts = {
      flights: flightFixture.count,
      'local-datacenters': 4362,
      'local-dams': 716,
    };
    await page.evaluate(async (layerIds) => {
      const manager = window.__godsEyeView?.dataManager;
      if (!manager) throw new Error('Application data manager is unavailable.');
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
    const denseLayerPopulation = await readDenseLayerPopulation();
    densePopulationObservations.push({
      checkpoint: 'initial',
      layers: denseLayerPopulation,
    });

    phase = 'shared-scene-and-route-observation';
    const before = await page.evaluate(observeCommonScene, {
      appCommit: commit,
    });
    const routeStart = before.camera;
    const routeStartMs = await page.evaluate(() => performance.now());
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await page.evaluate(observeCommonScene, {
      appCommit: commit,
    });
    const routeEndMs = await page.evaluate(() => performance.now());
    const route = describeObservedRoute({
      scenario: 'idle',
      start: routeStart,
      durationMs: routeEndMs - routeStartMs,
      measurement: { cameraPath: { id: 'integration-smoke-idle' } },
    });
    const renderer = after.environment.renderer.toLowerCase();
    if (!renderer.includes('swiftshader'))
      throw new Error('Observed renderer does not identify SwiftShader.');
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
    finalDenseLayerPopulation = await readDenseLayerPopulation();
    densePopulationObservations.push({
      checkpoint: 'final-before-code-validation',
      layers: finalDenseLayerPopulation,
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
    workerBlobValidation = validateCesiumWorkerBlobs({
      contract: workerContract,
      baseUrl: served.baseUrl,
      workerUrls,
      observedBlobUrls: [...new Set([...blobCodeRequests, ...workerUrls])],
      blobAudit,
    });
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
    for (const [id, expected] of Object.entries(expectedLayerCounts)) {
      if (
        denseLayerPopulation[id]?.enabled !== true ||
        denseLayerPopulation[id]?.count !== expected ||
        finalDenseLayerPopulation[id]?.enabled !== true ||
        finalDenseLayerPopulation[id]?.count !== expected
      )
        throw new Error(`Dense fixture population changed for ${id}.`);
    }
    const flightFixtureObservation = flightFixtureDelivery.summarize(
      finalDenseLayerPopulation.flights.count,
    );
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
      denseProviderFixture: {
        scope:
          'real production /api/flights source plus bundled infrastructure layers; static-count integration smoke only, not paired timing evidence',
        expectedLayerCounts,
        observedLayerPopulation: finalDenseLayerPopulation,
        flightFixture: flightFixtureObservation,
        comparisonEligible: false,
        comparisonIneligibilityReason:
          'This smoke verifies delivered fixture bytes and populations but does not establish the paired fixed-time measurement contract.',
      },
      serviceWorker: serviceWorkerState,
      browser: {
        softwareRenderingRequested: true,
        flags: [
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ],
        observedRenderer: after.environment.renderer,
        observedVendor: after.environment.vendor,
      },
      route,
      observerBefore: simplifyObservation(before),
      observerAfter: simplifyObservation(after),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    error.smokeDiagnostics = {
      phase,
      pageErrors: pageErrors.slice(0, 4),
      interceptionErrors: (fixturePage?.errors || [])
        .slice(0, 4)
        .map(sanitizeError),
      ...(workerBlobDiagnostics
        ? {
            workerBlobDiagnostics,
            workerBlobValidationFailure: sanitizeError(error),
          }
        : {}),
      densePopulationObservations,
    };
    failure = error;
  } finally {
    if (page) {
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
    if (context) {
      try {
        await withTimeout(context.close(), 5000, 'Browser context cleanup');
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
  }
  if (failure) throw failure;
  return result;
}

async function main() {
  const { candidateSha, out } = parseSmokeArguments(process.argv.slice(2));
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
  assertSha(candidateSha, 'Candidate SHA');
  assert.notEqual(
    candidateSha,
    BASELINE_SHA,
    'Candidate must differ from baseline.',
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
    startedAt: null,
    variants: [],
    limitations: [
      'Local build receipts are unsigned and do not attest hardware or release provenance.',
      'The browser request audit records code paths; it does not independently attest response bytes.',
      'The production fixture is verified only for acknowledged delivery and static population counts; this smoke is not paired timing evidence.',
      'Software rendering is explicit SwiftShader and cannot support hardware performance claims.',
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
  const worktrees = [];
  const cleanupErrors = [];
  try {
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
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 15_000,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });
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
        });
        Object.assign(variant, result);
      } catch (error) {
        variant.status = 'failed';
        variant.failure = sanitizeError(error);
        variant.failureDetails = error.smokeDiagnostics || {
          phase: 'clean-build-or-server-start',
          pageErrors: [],
          interceptionErrors: [],
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
