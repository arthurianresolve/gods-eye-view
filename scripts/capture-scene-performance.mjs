#!/usr/bin/env node
/** Capture comparable scene timings from an already running app. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { evaluateMotionFrameBudget } from './performance/motionBudget.mjs';
import { assertCaptureIntegrity } from './performance/captureIntegrity.mjs';
import { routeDescriptorsEquivalent } from './performance/routeEquivalence.mjs';
import { beginCaptureBuildProvenance } from './performance/captureBuildProvenance.mjs';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import {
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  installFixedWallClock,
  installHeldMonotonicWallClock,
  installPhasedMonotonicWallClock,
  settleCompletedRender,
  assertObservedTrackingRoute,
  respondToProductionFlightFixture,
} from './performance/productionFlightFixture.mjs';
import {
  describeObservedRoute,
  observeCommonScene,
} from './performance/commonSceneObserver.mjs';
import {
  createEntityFollowRoute,
  observeTrackedEntityBoundary,
} from './performance/trackingRoute.mjs';
import {
  deriveCesiumEmbeddedWorkerContract,
  installCesiumWorkerBlobAudit,
  MAX_WORKER_BLOB_RECORDS,
  MAX_WORKER_TARGETS,
  restoreCesiumWorkerBlobAudit,
  validateCesiumWorkerBlobs,
} from './performance/cesiumWorkerBlobContract.mjs';
import { createCaptureFailureReport } from './performance/captureFailureReport.mjs';
import { disableOptionalPerformanceDiagnostics } from './performance/captureDiagnosticsControl.mjs';
import {
  createObservedDenseComparisonContract,
  getCaptureComparisonIneligibilityReasons,
} from './performance/captureComparisonContract.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://localhost:4173');
// The default is the release-comparison workload from S47. Short exploratory
// captures remain available by passing --seconds/--warmup-ms/--runs explicitly.
const seconds = Math.max(1, Number(option('--seconds', '60')) || 60);
const warmupMs = Math.max(0, Number(option('--warmup-ms', '30000')) || 0);
const runs = Math.max(1, Math.min(10, Number(option('--runs', '5')) || 5));
const delayMs = Math.max(0, Number(option('--inject-delay-ms', '0')) || 0);
const maxP95Ms = Number(option('--max-p95-ms', '0')) || 0;
const fixtureAircraftCount = Number(option('--fixture-aircraft', '0'));
const providerFixtureMode = option('--provider-fixture', null);
const providerFixtureTime = option(
  '--provider-fixture-time',
  '2026-10-08T12:00:00.000Z',
);
if (providerFixtureMode && providerFixtureMode !== 'dense-investigation')
  throw new Error('--provider-fixture supports only dense-investigation');
if (
  providerFixtureMode &&
  (fixtureAircraftCount !== 0 || !args.includes('--mixed-layers'))
)
  throw new Error(
    'The dense provider fixture requires --mixed-layers and must not use --fixture-aircraft.',
  );
const productionFlightFixture = providerFixtureMode
  ? createProductionFlightFixture({
      count: 2500,
      fixedTime: providerFixtureTime,
    })
  : null;
const qualityMode = option('--quality-mode', 'manual');
const detectionMode = String(option('--detection-mode', 'DENSE')).toUpperCase();
const mixedLayers = args.includes('--mixed-layers');
const effectiveFixtureAircraftCount = productionFlightFixture
  ? productionFlightFixture.count
  : fixtureAircraftCount || (mixedLayers ? 2500 : 0);
const expectedDensityPct = Number(
  option(
    '--expected-density',
    effectiveFixtureAircraftCount && qualityMode === 'manual' ? '75' : 'NaN',
  ),
);
const startupRuns = Math.max(
  1,
  Math.min(5, Number(option('--startup-runs', String(runs))) || runs),
);
const protocolTimeoutMs = Math.max(
  10_000,
  Math.min(
    600_000,
    Number(option('--protocol-timeout-ms', '300000')) || 300_000,
  ),
);
const fixtureTimeoutMs = Math.max(
  1_000,
  Math.min(180_000, Number(option('--fixture-timeout-ms', '90000')) || 90_000),
);
const out = option('--out', null);
const ownedBrowserPidFile = option('--owned-browser-pid-file', null);
const hardwareRequired = args.includes('--hardware-required');
const softwareRendering = args.includes('--software-rendering');
const hostedFixture = args.includes('--hosted-fixture');
if (hardwareRequired && softwareRendering)
  throw new Error(
    '--hardware-required cannot be combined with --software-rendering',
  );
const appCommitOverride = option('--app-commit', null);
const appWorktreeStateOverride = option('--app-worktree-state', null);
const buildProvenanceOptions = {
  receipt: option('--build-receipt', null),
  checkoutRoot: option('--app-checkout', null),
  harnessRoot: option('--harness-checkout', null),
  buildRoot: option('--build-root', null),
  expectedAppCommit: option('--expected-app-sha', null),
  expectedHarnessCommit: option('--expected-harness-sha', null),
  baseUrl: option('--served-base-url', null),
};
const buildProvenanceEnabled = Object.values(buildProvenanceOptions).some(
  Boolean,
);
if (
  buildProvenanceEnabled &&
  Object.values(buildProvenanceOptions).some((value) => !value)
)
  throw new Error(
    'Verified capture requires --build-receipt, --app-checkout, --harness-checkout, --build-root, --expected-app-sha, --expected-harness-sha and --served-base-url together.',
  );
if (productionFlightFixture && !buildProvenanceEnabled)
  throw new Error(
    'The production flight fixture requires verified build provenance options.',
  );
if (
  hostedFixture &&
  (!productionFlightFixture || !softwareRendering || !buildProvenanceEnabled)
)
  throw new Error(
    '--hosted-fixture requires the verified production fixture and explicit software rendering.',
  );
const actualHarnessRoot = await fs.realpath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
function harnessSourceRevision(root) {
  try {
    const runGit = (gitArgs) =>
      execFileSync('git', ['-C', root, ...gitArgs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return {
      commit: runGit(['rev-parse', 'HEAD']) || null,
      dirtyWorktree: Boolean(runGit(['status', '--porcelain'])),
      reason: null,
    };
  } catch {
    return {
      commit: null,
      dirtyWorktree: null,
      reason: 'Git revision is unavailable outside a readable repository.',
    };
  }
}
const harnessSource = harnessSourceRevision(actualHarnessRoot);
let captureProvenance = null;
let captureWorkerContract = null;
if (buildProvenanceEnabled) {
  const receipt = JSON.parse(
    await fs.readFile(buildProvenanceOptions.receipt, 'utf8'),
  );
  const requestedHarnessRoot = await fs.realpath(
    buildProvenanceOptions.harnessRoot,
  );
  if (requestedHarnessRoot !== actualHarnessRoot)
    throw new Error(
      'Explicit harness checkout is not the checkout containing this capture script.',
    );
  if (buildProvenanceOptions.expectedHarnessCommit !== harnessSource.commit)
    throw new Error(
      'Expected harness SHA does not match the capture checkout.',
    );
  if (harnessSource.dirtyWorktree !== false)
    throw new Error('Verified capture requires a clean harness checkout.');
  if (
    appCommitOverride &&
    appCommitOverride !== buildProvenanceOptions.expectedAppCommit
  )
    throw new Error(
      '--app-commit differs from the verified build receipt SHA.',
    );
  captureProvenance = await beginCaptureBuildProvenance({
    ...buildProvenanceOptions,
    receipt,
    harnessRoot: requestedHarnessRoot,
    actualHarnessRoot,
    captureUrl: url,
  });
  const bundlePath = 'cesium/Cesium.js';
  if (!receipt.assets.some((asset) => asset.path === bundlePath))
    throw new Error('Verified build receipt is missing the Cesium bundle.');
  captureWorkerContract = deriveCesiumEmbeddedWorkerContract({
    bundlePath,
    bundleBytes: await fs.readFile(
      path.join(buildProvenanceOptions.buildRoot, ...bundlePath.split('/')),
    ),
    assets: receipt.assets,
  });
  if (effectiveFixtureAircraftCount && !productionFlightFixture)
    throw new Error(
      'The aircraft fixture uses a Vite development-only injection seam and is not comparable with a local production build receipt.',
    );
}
const source = {
  harnessCommit: harnessSource.commit,
  harnessDirtyWorktree: harnessSource.dirtyWorktree,
  appCommit:
    captureProvenance?.source.appCommit ||
    appCommitOverride ||
    harnessSource.commit,
  appWorktreeState:
    (captureProvenance ? 'clean' : null) ||
    appWorktreeStateOverride ||
    (appCommitOverride && appCommitOverride !== harnessSource.commit
      ? 'unknown'
      : harnessSource.dirtyWorktree == null
        ? 'unknown'
        : harnessSource.dirtyWorktree
          ? 'dirty'
          : 'clean'),
  buildProvenance: captureProvenance?.source || null,
  provenanceStatus: captureProvenance
    ? captureProvenance.source.status
    : 'unverified-exploratory-capture',
  reason: harnessSource.reason,
};
const failureProgress = {
  phase: 'browser-startup',
  scenario: null,
  run: null,
  current: null,
  startupSamples: [],
  completedSamples: [],
  fixture: productionFlightFixture,
  fixtureDelivery: null,
  workload: {
    warmupMs,
    durationPerSampleMs: seconds * 1000,
    runsPerScenario: runs,
    startupRuns,
    qualityMode,
    expectedDensityPct: Number.isFinite(expectedDensityPct)
      ? expectedDensityPct
      : null,
    detectionMode,
    mixedLayers,
  },
};
let captureFailure = null;
let failureReportWritten = false;
async function writeCaptureFailure(error) {
  const report = createCaptureFailureReport({
    source,
    fixture: failureProgress.fixture,
    workload: {
      ...failureProgress.workload,
      scenarios: failureProgress.scenarios || [],
    },
    phase: failureProgress.current?.phase || failureProgress.phase,
    scenario: failureProgress.current?.scenario || failureProgress.scenario,
    run: failureProgress.current?.run || failureProgress.run,
    error,
    errorActual: error?.actual,
    errorExpected: error?.expected,
    errorOperator: error?.operator,
    current: performanceDiagnosticsDocuments.length
      ? {
          ...(failureProgress.current || {}),
          performanceDiagnosticsDocuments,
        }
      : failureProgress.current,
    startupSamples: failureProgress.startupSamples,
    completedSamples: failureProgress.completedSamples,
    fixtureDelivery: failureProgress.fixtureDelivery,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, json, 'utf8');
    process.stderr.write('Wrote bounded failed-capture evidence.\n');
  } else process.stdout.write(json);
  process.stderr.write(
    `Capture failed during ${report.failure.phase}: ${report.failure.message}\n`,
  );
}
if (
  !Number.isInteger(fixtureAircraftCount) ||
  fixtureAircraftCount < 0 ||
  fixtureAircraftCount > 20_000
)
  throw new Error('--fixture-aircraft must be an integer from 0 to 20000');
if (!['manual', 'auto', 'quality', 'performance'].includes(qualityMode))
  throw new Error(
    '--quality-mode must be manual, auto, quality or performance',
  );
if (!['SPARSE', 'BALANCED', 'DENSE'].includes(detectionMode))
  throw new Error('--detection-mode must be SPARSE, BALANCED or DENSE');
if (
  args.includes('--expected-density') &&
  (!Number.isFinite(expectedDensityPct) ||
    expectedDensityPct < 0 ||
    expectedDensityPct > 100)
)
  throw new Error('--expected-density must be a number from 0 to 100');

const browser = await puppeteer.launch({
  headless: args.includes('--headless') ? 'new' : false,
  protocolTimeout: protocolTimeoutMs,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  args: [
    '--window-size=1440,900',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(hostedFixture ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ...(softwareRendering
      ? [
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ]
      : []),
  ],
});
if (ownedBrowserPidFile) {
  const browserPid = browser.process()?.pid;
  try {
    if (!Number.isInteger(browserPid) || browserPid < 1)
      throw new Error('Owned browser process ID is unavailable.');
    await fs.writeFile(ownedBrowserPidFile, `${browserPid}\n`, 'utf8');
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

const fixtureInterceptionSessions = [];
const fixtureInterceptionErrors = [];
const performanceDiagnosticsDocuments = [];
async function disableCaptureDiagnostics(targetPage, documentRole) {
  const status = await targetPage.evaluate(
    disableOptionalPerformanceDiagnostics,
  );
  performanceDiagnosticsDocuments.push({ documentRole, ...status });
  failureProgress.performanceDiagnosticsDocuments = [
    ...performanceDiagnosticsDocuments,
  ];
  return status;
}

async function configureFlightFixturePage(
  page,
  deliveryObserver = null,
  { holdClockUntilCapture = false, phasedClock = false } = {},
) {
  if (!productionFlightFixture) return;
  await page.evaluateOnNewDocument(
    phasedClock
      ? installPhasedMonotonicWallClock
      : holdClockUntilCapture
        ? installHeldMonotonicWallClock
        : installFixedWallClock,
    productionFlightFixture.fixedTimeMs,
    ...(phasedClock ? [warmupMs, seconds * 1000] : []),
  );
  const session = await page.createCDPSession();
  fixtureInterceptionSessions.push(session);
  await interceptFixtureSession(
    session,
    new URL(url).origin + '/',
    (requestUrl, request) =>
      respondToProductionFlightFixture(
        requestUrl,
        request,
        productionFlightFixture,
        new URL(url).origin + '/',
      ),
    (error) => {
      if (fixtureInterceptionErrors.length < 8)
        fixtureInterceptionErrors.push(
          String(error?.message || 'Fixture interception failed').slice(0, 240),
        );
    },
    deliveryObserver
      ? { onFulfilled: deliveryObserver.onFulfilled }
      : undefined,
  );
  return session;
}

async function settleProviderRenderAtBoundary(
  targetPage,
  label,
  timeoutMs = 5000,
) {
  let timer;
  try {
    return await Promise.race([
      targetPage.evaluate(settleCompletedRender, timeoutMs),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label}: host did not observe a completed render within ${timeoutMs}ms.`,
              ),
            ),
          timeoutMs + 1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function releaseFlightFixtureSession(session) {
  if (!session) return;
  const index = fixtureInterceptionSessions.indexOf(session);
  if (index >= 0) fixtureInterceptionSessions.splice(index, 1);
  await session.send('Fetch.disable').catch(() => {});
  await session.detach().catch(() => {});
}

try {
  failureProgress.phase = 'startup-navigation';
  const startupUrl = new URL(url);
  startupUrl.searchParams.set('welcome', '0');
  const startupSamples = [];
  failureProgress.startupSamples = startupSamples;
  const loadedScriptAssets = new Set();
  const unexpectedScriptAssets = new Set();
  const workerBlobObservations = [];
  let providerSampleWorkerAuditComplete = false;
  let scriptRequestCount = 0;
  const auditPageCodeRequests = (auditPage) => {
    if (!captureProvenance)
      return { workerUrls: new Set(), blobUrls: new Set() };
    const workerUrls = new Set();
    const blobUrls = new Set();
    let workerUrlOverflow = 0;
    let blobUrlOverflow = 0;
    const rememberWorker = (workerUrl) => {
      if (workerUrls.has(workerUrl)) return;
      if (workerUrls.size >= MAX_WORKER_TARGETS) workerUrlOverflow += 1;
      else workerUrls.add(workerUrl);
    };
    const rememberBlob = (blobUrl) => {
      if (blobUrls.has(blobUrl)) return;
      if (blobUrls.size >= MAX_WORKER_BLOB_RECORDS) blobUrlOverflow += 1;
      else blobUrls.add(blobUrl);
    };
    const base = new URL(buildProvenanceOptions.baseUrl);
    const prefix = base.pathname.endsWith('/')
      ? base.pathname
      : `${base.pathname}/`;
    const expected = new Set(captureProvenance.source.expectedAssetPaths);
    auditPage.on('request', (request) => {
      if (
        !['script', 'worker', 'serviceworker'].includes(request.resourceType())
      )
        return;
      let requested;
      try {
        requested = new URL(request.url());
      } catch {
        return;
      }
      if (requested.protocol === 'blob:') {
        rememberBlob(request.url());
        return;
      }
      if (requested.origin !== base.origin) return;
      let relative = '';
      if (requested.pathname.startsWith(prefix)) {
        try {
          relative = decodeURIComponent(
            requested.pathname.slice(prefix.length),
          );
        } catch {
          relative = '';
        }
      }
      if (relative && expected.has(relative)) {
        scriptRequestCount += 1;
        loadedScriptAssets.add(relative);
      } else unexpectedScriptAssets.add(requested.pathname);
    });
    auditPage.on('workercreated', (worker) => {
      rememberWorker(worker.url());
      if (worker.url().startsWith('blob:')) rememberBlob(worker.url());
    });
    return {
      workerUrls,
      blobUrls,
      getOverflow: () => ({ workerUrlOverflow, blobUrlOverflow }),
    };
  };
  const auditPageWorkerBlobs = async (auditPage, auditState) => {
    if (!captureProvenance) return null;
    for (const worker of auditPage.workers()) {
      if (!auditState.workerUrls.has(worker.url()))
        throw new Error(
          'Capture worker targets exceeded the observed creation audit.',
        );
    }
    const overflow = auditState.getOverflow();
    if (overflow.workerUrlOverflow || overflow.blobUrlOverflow)
      throw new Error(
        'Capture worker target audit exceeded its bounded capacity.',
      );
    const workerUrls = [...auditState.workerUrls].filter((value) =>
      value.startsWith('blob:'),
    );
    try {
      const metadata = await auditPage.evaluate(
        () => window.__gevCesiumWorkerBlobAuditV1?.metadata() || null,
      );
      if (!metadata)
        throw new Error('Receipt-verified page worker blob audit is missing.');
      if (
        metadata.createdBlobCount === 0 &&
        workerUrls.length === 0 &&
        auditState.blobUrls.size === 0
      )
        return null;
      const blobAudit = await auditPage.evaluate(async (urls) => {
        const audit = window.__gevCesiumWorkerBlobAuditV1;
        if (!audit)
          throw new Error('Receipt-verified page worker audit disappeared.');
        return audit.readWorkerBodies(urls);
      }, workerUrls);
      const validation = validateCesiumWorkerBlobs({
        contract: captureWorkerContract,
        baseUrl: buildProvenanceOptions.baseUrl,
        workerUrls,
        observedBlobUrls: [...auditState.blobUrls],
        blobAudit,
      });
      workerBlobObservations.push(validation.observation);
      return validation.observation;
    } finally {
      await auditPage.evaluate(restoreCesiumWorkerBlobAudit);
    }
  };
  async function attachMeasuredPage(auditPage, deliveryObserver = null) {
    await auditPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    await auditPage.setCacheEnabled(false);
    await auditPage.setBypassServiceWorker(true);
    const fixtureSession = await configureFlightFixturePage(
      auditPage,
      deliveryObserver,
      {
        phasedClock: Boolean(productionFlightFixture),
        holdClockUntilCapture: Boolean(productionFlightFixture),
      },
    );
    if (captureProvenance)
      await auditPage.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    return {
      fixtureSession,
      auditState: auditPageCodeRequests(auditPage),
    };
  }
  for (let run = 1; run <= startupRuns; run += 1) {
    failureProgress.phase = 'startup-navigation';
    failureProgress.run = run;
    process.stdout.write(`[performance] startup ${run}/${startupRuns}\n`);
    const context = await browser.createBrowserContext();
    const startupPage = await context.newPage();
    await startupPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    await startupPage.setCacheEnabled(false);
    await startupPage.setBypassServiceWorker(true);
    const startupFixtureSession = await configureFlightFixturePage(startupPage);
    if (captureProvenance)
      await startupPage.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    const startupAuditState = auditPageCodeRequests(startupPage);
    const startedAt = Date.now();
    await startupPage.goto(startupUrl.href, { waitUntil: 'domcontentloaded' });
    if (captureProvenance) {
      const servedBase = new URL(buildProvenanceOptions.baseUrl);
      const actualPage = new URL(startupPage.url());
      if (
        actualPage.origin !== servedBase.origin ||
        !captureProvenance.source.entryPaths.includes(actualPage.pathname)
      )
        throw new Error(
          'Startup navigation redirected outside the verified application entry point.',
        );
    }
    await startupPage.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    await disableCaptureDiagnostics(startupPage, `startup-${run}`);
    const appReadyMs = Date.now() - startedAt;
    await startupPage.waitForFunction(
      () =>
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    if (
      captureProvenance &&
      (await startupPage.evaluate(() =>
        Boolean(navigator.serviceWorker?.controller),
      ))
    )
      throw new Error(
        'Verified startup page is controlled by a service worker.',
      );
    const initialSettleMs = Date.now() - startedAt;
    const details = await startupPage.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const gl =
        viewer.scene.context?._gl ||
        viewer.scene.canvas.getContext('webgl2') ||
        viewer.scene.canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        renderer: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : gl?.getParameter(gl.RENDERER) || null,
        viewport: {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        },
        drawingBuffer: {
          width: viewer.scene.canvas.width,
          height: viewer.scene.canvas.height,
        },
        focused: document.hasFocus(),
        visible: !document.hidden,
        navigationMs:
          performance.getEntriesByType('navigation')[0]?.duration ?? null,
        memory: performance.memory
          ? { usedJsHeapBytes: performance.memory.usedJSHeapSize, reason: null }
          : {
              usedJsHeapBytes: null,
              reason: 'performance.memory is unavailable in this browser',
            },
      };
    });
    startupSamples.push({
      run,
      cacheDisabled: true,
      appReadyMs,
      initialSettleMs,
      ...details,
    });
    await auditPageWorkerBlobs(startupPage, startupAuditState);
    await context.close();
    await releaseFlightFixtureSession(startupFixtureSession);
  }

  process.stdout.write('[performance] preparing measured scene\n');
  failureProgress.phase = 'main-navigation';
  failureProgress.scenario = null;
  failureProgress.run = null;
  let page = await browser.newPage();
  let providerContext = null;
  let flightFixtureDelivery = productionFlightFixture
    ? createFlightFixtureDeliveryObserver(
        productionFlightFixture,
        new URL(url).origin + '/',
      )
    : null;
  const initialPageAttachment = await attachMeasuredPage(
    page,
    flightFixtureDelivery,
  );
  let activeFixtureSession = initialPageAttachment.fixtureSession;
  let captureAuditState = initialPageAttachment.auditState;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (captureProvenance) {
    const servedBase = new URL(buildProvenanceOptions.baseUrl);
    const actualPage = new URL(page.url());
    if (
      actualPage.origin !== servedBase.origin ||
      !captureProvenance.source.entryPaths.includes(actualPage.pathname)
    )
      throw new Error(
        'Capture navigation redirected outside the verified application entry point.',
      );
  }
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
    timeout: 90_000,
  });
  await disableCaptureDiagnostics(page, 'main-setup');
  const readyMs = Date.now();
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  if (
    captureProvenance &&
    (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
  )
    throw new Error('Verified capture page is controlled by a service worker.');
  const mainStartupElapsedMs = Date.now() - readyMs;

  const fixture = effectiveFixtureAircraftCount
    ? await page.evaluate(
        async ({
          count,
          mode,
          detectionMode,
          productionProvider,
          fixtureId,
          fixtureSha256,
          fixedTime,
        }) => {
          const app = window.__godsEyeView;
          const manager = app?.dataManager;
          const entry = manager?.layers?.get('flights');
          if (!entry)
            throw new Error(
              'Aircraft fixture requires the registered flights layer',
            );
          if (!manager.isEnabled('flights'))
            await manager.setEnabled('flights', true);
          if (!productionProvider) {
            const layer = manager.layers.get('flights')?.module;
            const inject = layer?.__focusEvidence?.setAircraft;
            if (typeof inject !== 'function')
              throw new Error(
                'Aircraft fixture injection is available only in a Vite development build',
              );
            const records = Array.from({ length: count }, (_, index) => {
              const angle = index * 2.399963229728653;
              const radius = Math.sqrt((index + 0.5) / count);
              return {
                id: (index + 1).toString(16).padStart(6, '0'),
                callsign: `FX${String(index + 1).padStart(5, '0')}`,
                latitude: 30.2672 + Math.sin(angle) * radius * 0.14,
                longitude: -97.7431 + Math.cos(angle) * radius * 0.18,
                altitudeM: 1_500 + (index % 16) * 850,
                velocityMps: 70 + (index % 90),
                trackDeg: index % 360,
              };
            });
            const result = inject(records);
            if (!result?.ok || result.count !== count)
              throw new Error(
                `Fixture injection failed: ${JSON.stringify(result)}`,
              );
            if (entry.intervalId != null) clearInterval(entry.intervalId);
            entry.intervalId = null;
          }
          const controller = app.styleManager?._adaptiveQuality;
          if (controller && !controller.setMode(mode))
            throw new Error('Presentation quality controller is unavailable');
          if (!controller && mode !== 'manual')
            throw new Error(
              'Auto/Quality/Performance profiles are unavailable in this app revision',
            );
          const services = app.styleManager?.services;
          if (
            typeof services?.setDetectionModeByLabel !== 'function' ||
            typeof services?.getDetectionMode !== 'function' ||
            typeof services?.readDetectionDiagnostics !== 'function'
          )
            throw new Error('Detection workload controls are unavailable');
          services.setDetectionModeByLabel(detectionMode);
          if (services.getDetectionMode() !== detectionMode)
            throw new Error(`Detection mode did not become ${detectionMode}`);
          const viewer = app.viewer;
          const center = { latitude: 30.2672, longitude: -97.7431 };
          const radians = Math.PI / 180;
          const destination =
            viewer.scene.globe.ellipsoid.cartographicToCartesian({
              longitude: center.longitude * radians,
              latitude: center.latitude * radians,
              height: 130_000,
            });
          viewer.camera.cancelFlight?.();
          viewer.camera.setView({
            destination,
            orientation: {
              heading: 0,
              pitch: -Math.PI / 2,
              roll: 0,
            },
          });
          viewer.scene.requestRender();
          return {
            id: productionProvider ? fixtureId : 'synthetic-aircraft-ring-v1',
            count,
            center,
            ...(productionProvider ? { sha256: fixtureSha256, fixedTime } : {}),
            cameraPath: {
              id: 'austin-overhead-v1',
              altitudeM: 130_000,
              headingDeg: 0,
              pitchDeg: -90,
            },
            seed: 1,
            detectionMode,
          };
        },
        {
          count: effectiveFixtureAircraftCount,
          mode: qualityMode,
          detectionMode,
          productionProvider: Boolean(productionFlightFixture),
          fixtureId: productionFlightFixture?.id || null,
          fixtureSha256: productionFlightFixture?.sha256 || null,
          fixedTime: productionFlightFixture?.fixedTime || null,
        },
      )
    : null;
  failureProgress.fixture = productionFlightFixture || fixture;

  const summarizeFlightFixtureDelivery = async () => {
    if (!productionFlightFixture) return null;
    if (fixtureInterceptionErrors.length)
      throw new Error(
        `Provider fixture interception reported ${fixtureInterceptionErrors.length} bounded errors.`,
      );
    const observedCount = await page.evaluate(
      () =>
        window.__godsEyeView?.dataManager
          ?.getAll?.()
          ?.find((entry) => entry.id === 'flights')?.stats?.count ?? null,
    );
    return flightFixtureDelivery.summarize(observedCount);
  };
  let fixtureDelivery = null;
  failureProgress.phase = productionFlightFixture
    ? 'wait-for-initial-provider-fixture'
    : 'prepare-measured-scene';
  if (productionFlightFixture) {
    await page.waitForFunction(
      (count) => {
        const layer = window.__godsEyeView?.dataManager
          ?.getAll?.()
          ?.find((entry) => entry.id === 'flights');
        return layer?.enabled === true && layer?.stats?.count === count;
      },
      { timeout: fixtureTimeoutMs, polling: 100 },
      productionFlightFixture.count,
    );
    fixtureDelivery = await summarizeFlightFixtureDelivery();
    failureProgress.fixtureDelivery = fixtureDelivery;
  }

  failureProgress.phase = 'configure-aircraft-fixture';
  if (fixture) {
    try {
      await page.waitForFunction(
        () => {
          const diagnostics =
            window.__godsEyeView?.styleManager?.services?.readDetectionDiagnostics?.();
          return (
            diagnostics &&
            diagnostics.observationCount > 0 &&
            diagnostics.candidateCount > 0 &&
            Object.values(diagnostics.labelsByLayer || {}).some(
              (count) => count > 0,
            )
          );
        },
        { timeout: fixtureTimeoutMs },
      );
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => {
          const app = window.__godsEyeView;
          const camera = app?.viewer?.camera;
          const position = camera?.positionCartographic;
          return {
            detection:
              app?.styleManager?.services?.readDetectionDiagnostics?.() ?? null,
            camera: position
              ? {
                  latitudeDeg: (position.latitude * 180) / Math.PI,
                  longitudeDeg: (position.longitude * 180) / Math.PI,
                  heightM: position.height,
                  pitchDeg: (camera.pitch * 180) / Math.PI,
                }
              : null,
          };
        })
        .catch(() => null);
      throw new Error(
        `Aircraft fixture did not produce visible labels within ${fixtureTimeoutMs} ms; diagnostics=${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }
  }

  failureProgress.phase = 'configure-mixed-layers';
  const mixedLayerFixture = mixedLayers
    ? await page.evaluate(async () => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager)
          throw new Error('Mixed-layer fixture needs the data manager');
        const ids = ['local-datacenters', 'local-dams'];
        for (const id of ids) {
          if (!manager.layers?.has(id))
            throw new Error(`Mixed-layer fixture is missing ${id}`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        return ids;
      })
    : null;
  if (mixedLayerFixture) {
    await page.waitForFunction(
      (ids) =>
        ids.every((id) => {
          const layer = window.__godsEyeView?.dataManager
            ?.getAll?.()
            ?.find((entry) => entry.id === id);
          return Number.isFinite(layer?.stats?.count) && layer.stats.count > 0;
        }),
      { timeout: 90_000 },
      mixedLayerFixture,
    );
  }
  if (!fixture) {
    const modeSet = await page.evaluate((mode) => {
      const controller = window.__godsEyeView?.styleManager?._adaptiveQuality;
      return controller?.setMode(mode) || false;
    }, qualityMode);
    if (!modeSet)
      throw new Error('Presentation quality controller is unavailable');
  }

  await page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    window.__gevPerformanceHome = {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      transform: camera.transform.clone(),
    };
  });
  const commonScene = await page.evaluate(observeCommonScene, {
    appCommit: source.appCommit,
  });
  const environment = commonScene.environment;
  environment.startup = {
    runs: startupSamples,
    runCount: startupSamples.length,
    measurement: 'cache-disabled fresh browser contexts',
    performancePageInitialSettleMs: mainStartupElapsedMs,
  };
  const softwareRenderer =
    /swiftshader|software|llvmpipe|mesa offscreen|angle \(.*software/i.test(
      environment.renderer || '',
    );
  environment.hardwareEligible =
    Boolean(environment.renderer) && !softwareRenderer;

  const scenarios = ['idle', 'scripted-motion'];
  if (fixture) scenarios.push('selected-aircraft-tracking');
  failureProgress.scenarios = scenarios;
  const captures = [];
  failureProgress.completedSamples = captures;
  failureProgress.phase = 'verify-dense-populations';
  const mixedLayerCounts = productionFlightFixture
    ? await page.evaluate(() => {
        const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
        return {
          datacenters:
            layers.find((entry) => entry.id === 'local-datacenters')?.stats
              ?.count ?? null,
          dams:
            layers.find((entry) => entry.id === 'local-dams')?.stats?.count ??
            null,
        };
      })
    : null;
  if (
    productionFlightFixture &&
    (mixedLayerCounts.datacenters !== 4362 || mixedLayerCounts.dams !== 716)
  )
    throw new Error(
      `Provider-fixture mixed populations are incomplete: ${JSON.stringify(mixedLayerCounts)}`,
    );

  let providerSampleDocumentIndex = 0;
  async function prepareFreshProviderDocument() {
    providerSampleDocumentIndex += 1;
    if (!providerSampleWorkerAuditComplete)
      await auditPageWorkerBlobs(page, captureAuditState);
    await releaseFlightFixtureSession(activeFixtureSession);
    if (providerContext) await providerContext.close();
    else await page.close();
    providerContext = await browser.createBrowserContext();
    page = await providerContext.newPage();
    flightFixtureDelivery = createFlightFixtureDeliveryObserver(
      productionFlightFixture,
      new URL(url).origin + '/',
    );
    const pageAttachment = await attachMeasuredPage(
      page,
      flightFixtureDelivery,
    );
    activeFixtureSession = pageAttachment.fixtureSession;
    captureAuditState = pageAttachment.auditState;
    captureAuditState.workerUrls.clear();
    captureAuditState.blobUrls.clear();
    providerSampleWorkerAuditComplete = false;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (captureProvenance) {
      const servedBase = new URL(buildProvenanceOptions.baseUrl);
      const actualPage = new URL(page.url());
      if (
        actualPage.origin !== servedBase.origin ||
        !captureProvenance.source.entryPaths.includes(actualPage.pathname)
      )
        throw new Error(
          'Provider-fixture navigation redirected outside the verified application entry point.',
        );
    }
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    await disableCaptureDiagnostics(
      page,
      `provider-sample-${providerSampleDocumentIndex}`,
    );
    await page.waitForFunction(
      () =>
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
      throw new Error(
        'Provider-fixture page is controlled by a service worker.',
      );
    const initialEpoch = await page.evaluate(() => ({
      now: Date.now(),
      clock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
    }));
    if (
      initialEpoch.now !== productionFlightFixture.fixedTimeMs ||
      initialEpoch.clock?.phase !== 'setup'
    )
      throw new Error(
        `Provider-fixture document did not start at the held epoch: ${JSON.stringify(initialEpoch)}`,
      );
    await page.evaluate(
      async ({ qualityMode: mode, detectionMode: requestedDetectionMode }) => {
        const app = window.__godsEyeView;
        const manager = app.dataManager;
        if (!manager.isEnabled('flights'))
          await manager.setEnabled('flights', true);
        const controller = app.styleManager?._adaptiveQuality;
        if (controller && !controller.setMode(mode))
          throw new Error('Presentation quality controller is unavailable');
        if (!controller && mode !== 'manual')
          throw new Error('Requested quality profile is unavailable');
        const services = app.styleManager?.services;
        if (typeof services?.setDetectionModeByLabel !== 'function')
          throw new Error('Detection workload controls are unavailable');
        services.setDetectionModeByLabel(requestedDetectionMode);
        if (services.getDetectionMode() !== requestedDetectionMode)
          throw new Error('Detection workload mode did not match the request');
        for (const id of ['local-datacenters', 'local-dams']) {
          const entry = manager.layers.get(id);
          if (!entry) throw new Error(`Missing required mixed layer ${id}`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        const viewer = app.viewer;
        const destination =
          viewer.scene.globe.ellipsoid.cartographicToCartesian({
            longitude: (-97.7431 * Math.PI) / 180,
            latitude: (30.2672 * Math.PI) / 180,
            height: 130_000,
          });
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
          destination,
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        });
        viewer.scene.requestRender();
      },
      { qualityMode, detectionMode },
    );
    await page.waitForFunction(
      (counts) => {
        const layers = window.__godsEyeView?.dataManager?.getAll?.() || [];
        const getLayer = (id) => layers.find((entry) => entry.id === id);
        return (
          ['flights', 'local-datacenters', 'local-dams'].every(
            (id) => getLayer(id)?.enabled === true,
          ) &&
          getLayer('flights')?.stats?.count === counts.flights &&
          getLayer('local-datacenters')?.stats?.count === counts.datacenters &&
          getLayer('local-dams')?.stats?.count === counts.dams
        );
      },
      { timeout: fixtureTimeoutMs, polling: 100 },
      {
        flights: productionFlightFixture.count,
        datacenters: mixedLayerCounts.datacenters,
        dams: mixedLayerCounts.dams,
      },
    );
    fixtureDelivery = await summarizeFlightFixtureDelivery();
    failureProgress.fixtureDelivery = fixtureDelivery;
    await page.evaluate(() => {
      const camera = window.__godsEyeView.viewer.camera;
      window.__gevPerformanceHome = {
        position: camera.position.clone(),
        direction: camera.direction.clone(),
        up: camera.up.clone(),
        transform: camera.transform.clone(),
      };
    });
  }

  for (const scenario of scenarios) {
    for (let run = 1; run <= runs; run += 1) {
      failureProgress.phase = 'prepare-sample-context';
      failureProgress.scenario = scenario;
      failureProgress.run = run;
      failureProgress.current = { phase: failureProgress.phase, scenario, run };
      process.stdout.write(`[performance] ${scenario} ${run}/${runs}\n`);
      if (productionFlightFixture) {
        failureProgress.phase = 'prepare-fresh-provider-document';
        failureProgress.current.phase = failureProgress.phase;
        await prepareFreshProviderDocument();
      }
      failureProgress.phase = 'configure-scenario-route';
      failureProgress.current.phase = failureProgress.phase;
      const trackingResult = await page.evaluate(
        async ({ scenarioName, hasFixture }) => {
          const fixtureClock = window.__gevPhasedMonotonicWallClockV1;
          const app = window.__godsEyeView;
          const viewer = app.viewer;
          const flights = app.dataManager.layers.get('flights')?.module;
          let trackedAircraftId = null;
          if (viewer.trackedEntity) flights?.stopTracking?.();
          if (scenarioName === 'selected-aircraft-tracking') {
            if (!hasFixture || typeof flights?.trackById !== 'function')
              throw new Error(
                'Selected-aircraft workload requires an injected flight fixture',
              );
            if (!flights.trackById('000001'))
              throw new Error('Selected-aircraft fixture could not be tracked');
            if (viewer.trackedEntity?.gevTrackedId !== 'flights:000001')
              throw new Error(
                'Selected-aircraft tracker did not claim the camera',
              );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            trackedAircraftId = viewer.trackedEntity.gevTrackedId;
          } else {
            viewer.camera.cancelFlight?.();
            const home = window.__gevPerformanceHome;
            viewer.camera.setView({
              destination: home.position,
              orientation: { direction: home.direction, up: home.up },
              endTransform: home.transform,
            });
            viewer.scene.requestRender();
          }
          // Release wall time only after fixture/tracking/camera setup has
          // settled. Warmup and capture then share one monotonic epoch.
          const clockStart = fixtureClock?.startWarmup?.() ?? null;
          return { trackedAircraftId, clockStart };
        },
        { scenarioName: scenario, hasFixture: Boolean(fixture) },
      );
      const trackingSetup = trackingResult?.trackedAircraftId ?? null;
      failureProgress.current.trackingSetup = trackingSetup;
      failureProgress.current.clockStart = trackingResult?.clockStart ?? null;
      // Each workload/run receives the declared warmup, including tracking.
      if (warmupMs)
        await new Promise((resolve) => setTimeout(resolve, warmupMs));
      const fixtureBoundaryStart = productionFlightFixture
        ? await page.evaluate(async () => {
            const clock = window.__gevPhasedMonotonicWallClockV1;
            const held = clock?.holdWarmupBoundary?.();
            if (!held || held.phase !== 'warmup-held')
              throw new Error(
                'Provider fixture warmup did not reach its declared boundary.',
              );
            return window.__gevPhasedMonotonicWallClockV1.snapshot();
          })
        : null;
      const warmupBoundarySettle = productionFlightFixture
        ? await settleProviderRenderAtBoundary(page, 'Warmup boundary', 5000)
        : null;
      const trackingStart =
        scenario === 'selected-aircraft-tracking'
          ? await page.evaluate(observeTrackedEntityBoundary, 'flights:000001')
          : null;
      failureProgress.current.warmupBoundary = fixtureBoundaryStart;
      failureProgress.current.warmupBoundarySettle = warmupBoundarySettle;
      if (trackingStart) failureProgress.current.trackingStart = trackingStart;
      const fixtureMeasurementStart = productionFlightFixture
        ? await page.evaluate(() => ({
            clock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
            wallTimeMs: Date.now(),
            flightStats:
              window.__godsEyeView?.dataManager?.layers
                ?.get('flights')
                ?.module?.getStats?.() ?? null,
            documentVisible: !document.hidden,
            documentFocused: document.hasFocus(),
          }))
        : null;
      failureProgress.phase = 'validate-measurement-start';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.measurementStart = fixtureMeasurementStart;
      if (
        productionFlightFixture &&
        (fixtureMeasurementStart.clock.phase !== 'warmup-held' ||
          fixtureMeasurementStart.clock.startCount !== 1 ||
          fixtureMeasurementStart.clock.elapsedMs !== warmupMs ||
          fixtureMeasurementStart.wallTimeMs <
            productionFlightFixture.fixedTimeMs ||
          fixtureMeasurementStart.wallTimeMs -
            productionFlightFixture.fixedTimeMs >
            120_000 ||
          fixtureMeasurementStart.flightStats?.lastUpdate !==
            productionFlightFixture.fixedTimeMs ||
          fixtureMeasurementStart.flightStats?.stale !== false ||
          fixtureMeasurementStart.flightStats?.count !==
            productionFlightFixture.count ||
          !fixtureMeasurementStart.documentVisible ||
          !fixtureMeasurementStart.documentFocused)
      )
        throw new Error(
          `Provider fixture was stale or unfocused at measurement start: ${JSON.stringify(fixtureMeasurementStart)}`,
        );
      const sceneBefore = await page.evaluate(observeCommonScene, {
        appCommit: source.appCommit,
      });
      failureProgress.phase = 'measure-scene';
      failureProgress.current.phase = failureProgress.phase;
      failureProgress.current.before = sceneBefore;
      const sample = await page.evaluate(
        async ({ durationMs, scenarioName, delay }) => {
          const viewer = window.__godsEyeView.viewer;
          const scene = viewer.scene;
          const stagedClock = window.__gevPhasedMonotonicWallClockV1;
          let foregroundThroughout = document.hasFocus() && !document.hidden;
          const onBackground = () => {
            foregroundThroughout = false;
          };
          const onVisibility = () => {
            if (document.hidden) onBackground();
          };
          window.addEventListener('blur', onBackground);
          document.addEventListener('visibilitychange', onVisibility);
          const intervals = [];
          const longTasks = [];
          let previous = null;
          let renderedFrameCount = 0;
          const onRender = () => {
            renderedFrameCount += 1;
            const now = performance.now();
            if (previous != null) intervals.push(now - previous);
            previous = now;
          };
          scene.postRender.addEventListener(onRender);
          let observer = null;
          if (typeof PerformanceObserver !== 'undefined') {
            try {
              observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries())
                  longTasks.push(entry.duration);
              });
              observer.observe({ type: 'longtask', buffered: false });
            } catch {
              observer = null;
            }
          }
          let active = true;
          let motionStartedAt = null;
          let motionDistance = 0;
          let measurementTimer = null;
          let delayTimer = null;
          let motionFinished = Promise.resolve();
          let finishMotion = () => {};
          try {
            if (stagedClock) stagedClock.startMeasurement();
            const startedAt = performance.now();
            const measurementWait = new Promise((resolve) => {
              measurementTimer = setTimeout(resolve, durationMs);
            });
            if (scenarioName === 'scripted-motion') {
              // Rebuild the pose from one elapsed-time sample on every frame.
              // A timer-step route accumulates missed callbacks and makes a slow
              // machine travel a different distance from a fast one.
              const home = window.__gevPerformanceHome;
              const applyDistance = (distance) => {
                viewer.camera.setView({
                  destination: home.position,
                  orientation: { direction: home.direction, up: home.up },
                  endTransform: home.transform,
                });
                viewer.camera.moveRight(distance);
                motionDistance = distance;
              };
              finishMotion = () => applyDistance((durationMs * 16) / 50);
              motionStartedAt = performance.now();
              motionFinished = new Promise((resolve) => {
                const move = () => {
                  if (!active) {
                    resolve();
                    return;
                  }
                  const elapsed = Math.min(
                    durationMs,
                    Math.max(0, performance.now() - motionStartedAt),
                  );
                  const distance = (elapsed * 16) / 50;
                  applyDistance(distance);
                  if (elapsed >= durationMs) {
                    resolve();
                    return;
                  }
                  requestAnimationFrame(move);
                };
                move();
              });
            }
            if (delay > 0) {
              delayTimer = setInterval(() => {
                const start = performance.now();
                while (performance.now() - start < delay) {}
              }, 1000);
            }
            await measurementWait;
            const clockEnd = stagedClock?.finishMeasurement?.() ?? null;
            active = false;
            await motionFinished;
            clearInterval(delayTimer);
            // Slow frames must still reach the same absolute route endpoint.
            finishMotion();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const renderCount = intervals.length;
            const sorted = [...intervals].sort((a, b) => a - b);
            const pick = (p) =>
              sorted.length
                ? sorted[
                    Math.min(
                      sorted.length - 1,
                      Math.ceil(sorted.length * p) - 1,
                    )
                  ]
                : null;
            const memory = performance.memory
              ? { usedJsHeapBytes: performance.memory.usedJSHeapSize }
              : {
                  usedJsHeapBytes: null,
                  reason: 'performance.memory is unavailable in this browser',
                };
            window.removeEventListener('blur', onBackground);
            document.removeEventListener('visibilitychange', onVisibility);
            observer
              ?.takeRecords?.()
              .forEach((entry) => longTasks.push(entry.duration));
            observer?.disconnect();
            scene.postRender.removeEventListener(onRender);
            return {
              durationMs: performance.now() - startedAt,
              renderedFrameCount,
              frameCount: renderCount,
              frameIntervalMs: {
                p50: pick(0.5),
                p95: pick(0.95),
                max: sorted.at(-1) ?? null,
                samples: sorted.length,
                reason: sorted.length
                  ? null
                  : 'no scene postRender samples in this window',
              },
              longTasks: {
                count: longTasks.length,
                maxMs: longTasks.length ? Math.max(...longTasks) : null,
              },
              memory,
              layers: [],
              totalObjects: null,
              focused: document.hasFocus(),
              visible: !document.hidden,
              trackedAircraftId: viewer.trackedEntity?.gevTrackedId || null,
              injectedDelayMs: delay || 0,
              quality: null,
              detection: {
                mode: null,
                reason:
                  'Candidate-only detection diagnostics are disabled for comparable capture.',
              },
              performanceSnapshot: null,
              performanceSnapshotReason:
                'Candidate-only runtime snapshots are disabled for comparable capture.',
              foregroundThroughout,
              cameraPath: {
                id:
                  scenarioName === 'scripted-motion'
                    ? 'elapsed-move-right-v1'
                    : 'parked-v1',
                motionDistancePx: motionDistance,
                motionDistanceM: motionDistance,
              },
              phasedClockEnd: clockEnd,
            };
          } finally {
            active = false;
            clearTimeout(measurementTimer);
            clearInterval(delayTimer);
            observer?.disconnect();
            scene.postRender.removeEventListener(onRender);
            window.removeEventListener('blur', onBackground);
            document.removeEventListener('visibilitychange', onVisibility);
          }
        },
        { durationMs: seconds * 1000, scenarioName: scenario, delay: delayMs },
      );
      failureProgress.current.measurement = sample;
      if (productionFlightFixture) {
        failureProgress.phase = 'validate-provider-fixture-clock';
        failureProgress.current.phase = failureProgress.phase;
        const clockEnd = await page.evaluate(() => ({
          clock: window.__gevPhasedMonotonicWallClockV1?.snapshot?.() ?? null,
          wallTimeMs: Date.now(),
          documentVisible: !document.hidden,
          documentFocused: document.hasFocus(),
          flightStats:
            window.__godsEyeView?.dataManager?.layers
              ?.get('flights')
              ?.module?.getStats?.() ?? null,
        }));
        const fixtureAgeMs =
          clockEnd.wallTimeMs - productionFlightFixture.fixedTimeMs;
        if (
          clockEnd.clock.startCount !== 1 ||
          clockEnd.clock.phase !== 'complete' ||
          clockEnd.clock.elapsedMs !== warmupMs + seconds * 1000 ||
          fixtureAgeMs < 0 ||
          fixtureAgeMs > 120_000 ||
          clockEnd.flightStats?.lastUpdate !==
            productionFlightFixture.fixedTimeMs ||
          clockEnd.flightStats?.stale !== false ||
          clockEnd.flightStats?.count !== productionFlightFixture.count ||
          !sample.foregroundThroughout ||
          !clockEnd.documentVisible ||
          !clockEnd.documentFocused
        )
          throw new Error(
            `Provider-fixture capture clock/freshness/foreground contract failed: ${JSON.stringify({ clock: clockEnd.clock, fixtureAgeMs, flightStats: clockEnd.flightStats, documentVisible: clockEnd.documentVisible, documentFocused: clockEnd.documentFocused })}`,
          );
        const measurementBoundarySettle = await settleProviderRenderAtBoundary(
          page,
          'Measurement boundary',
          5000,
        );
        const trackingEnd =
          scenario === 'selected-aircraft-tracking'
            ? await page.evaluate(
                observeTrackedEntityBoundary,
                'flights:000001',
              )
            : null;
        if (trackingEnd) {
          sample.trackingObservation = {
            start: trackingStart,
            end: trackingEnd,
          };
          failureProgress.current.trackingEnd = trackingEnd;
        }
        sample.fixtureClock = {
          schema: 'gev-provider-fixture-capture-clock/v1',
          fixedTime: productionFlightFixture.fixedTime,
          start: trackingResult.clockStart,
          measurementStart: fixtureMeasurementStart.clock,
          warmupBoundary: fixtureBoundaryStart,
          actualWarmupElapsedMs: fixtureBoundaryStart.warmupNativeElapsedMs,
          warmupBoundarySettleNativeMs: warmupBoundarySettle.settleElapsedMs,
          ageAtMeasurementStartMs:
            fixtureMeasurementStart.wallTimeMs -
            productionFlightFixture.fixedTimeMs,
          end: clockEnd.clock,
          configuredMeasurementMs: seconds * 1000,
          measurementPhaseNativeElapsedMs:
            sample.phasedClockEnd?.measurementNativeElapsedMs ?? null,
          measuredWindowElapsedMs:
            sample.phasedClockEnd?.measurementNativeElapsedMs ?? null,
          measurementClockElapsedMs: seconds * 1000,
          measurementBoundarySettleNativeMs:
            measurementBoundarySettle.settleElapsedMs,
          ageAtEndMs: fixtureAgeMs,
          sourceFreshness: 'current',
          freshnessWindowMs: 120_000,
          appDocumentReinitialized: true,
          freshBrowserContext: true,
        };
        if (scenario === 'selected-aircraft-tracking') {
          const cameraPose = (boundary) => ({
            dateEpochMs: boundary.dateEpochMs,
            position: boundary.camera?.position,
            direction: boundary.camera?.direction,
            up: boundary.camera?.up,
            transform: boundary.camera?.transform,
          });
          const route = createEntityFollowRoute({
            fixtureId: productionFlightFixture.id,
            fixtureSha256: productionFlightFixture.sha256,
            fixedTime: productionFlightFixture.fixedTime,
            fixtureCount: productionFlightFixture.count,
            warmupMs,
            measurementMs: seconds * 1000,
            start: { ...trackingStart, camera: cameraPose(trackingStart) },
            end: { ...trackingEnd, camera: cameraPose(trackingEnd) },
          });
          sample.cameraPath = route;
          failureProgress.current.trackingRoute = route;
          assertObservedTrackingRoute(route, {
            fixtureId: productionFlightFixture.id,
            fixtureSha256: productionFlightFixture.sha256,
            fixedTime: productionFlightFixture.fixedTime,
            warmupMs,
            measurementMs: seconds * 1000,
          });
        }
        fixtureDelivery = await summarizeFlightFixtureDelivery();
        failureProgress.fixtureDelivery = fixtureDelivery;
        sample.fixtureDelivery = fixtureDelivery;
        await auditPageWorkerBlobs(page, captureAuditState);
        providerSampleWorkerAuditComplete = true;
      }
      const sceneAfter = await page.evaluate(observeCommonScene, {
        appCommit: source.appCommit,
      });
      failureProgress.current.after = sceneAfter;
      failureProgress.phase = 'validate-sample-integrity';
      failureProgress.current.phase = failureProgress.phase;
      sample.layers = sceneAfter.environment.layers;
      sample.totalObjects = sceneAfter.environment.totalObjects;
      sample.quality = {
        mode: sceneAfter.settings.qualityMode,
        densityPct: sceneAfter.settings.densityPct,
        p95FrameMs: null,
      };
      sample.settings = {
        before: sceneBefore.settings,
        after: sceneAfter.settings,
      };
      sample.conditions = {
        before: {
          environment: sceneBefore.environment,
          settings: sceneBefore.settings,
          focused: sceneBefore.environment.focused,
          visible: sceneBefore.environment.visible,
        },
        after: {
          environment: sceneAfter.environment,
          settings: sceneAfter.settings,
          focused: sceneAfter.environment.focused,
          visible: sceneAfter.environment.visible,
        },
      };
      if (scenario !== 'selected-aircraft-tracking' || !productionFlightFixture)
        sample.cameraPath = describeObservedRoute({
          scenario,
          start: sceneBefore.camera,
          durationMs: seconds * 1000,
          measurement: sample,
          fixture,
        });
      if (
        scenario === 'selected-aircraft-tracking' &&
        (trackingSetup !== 'flights:000001' ||
          sample.trackedAircraftId !== 'flights:000001')
      )
        throw new Error(
          `Selected-aircraft workload lost camera tracking: ${JSON.stringify({ trackingSetup, trackedAircraftId: sample.trackedAircraftId })}`,
        );
      captures.push({ scenario, run, ...sample });
      failureProgress.current = null;
    }
  }

  for (const sample of captures) {
    const before = sample.settings?.before;
    const after = sample.settings?.after;
    if (!before || !after || before.qualityMode !== after.qualityMode) {
      throw new Error(
        `Performance sample changed quality mode during capture: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, before, after })}`,
      );
    }
    if (fixture && before.detectionMode !== detectionMode) {
      throw new Error(
        `Performance sample used the wrong detection mode: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, expected: detectionMode, actual: before.detectionMode })}`,
      );
    }
    if (sample.quality?.mode !== qualityMode) {
      throw new Error(
        `Performance sample used the wrong quality mode: ${JSON.stringify({ scenario: sample.scenario, run: sample.run, expected: qualityMode, actual: sample.quality?.mode })}`,
      );
    }
  }

  if (captureProvenance) {
    source.buildProvenance.after = await captureProvenance.verifyAfterCapture();
    if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
      throw new Error(
        'Verified capture page became controlled by a service worker.',
      );
    if (unexpectedScriptAssets.size)
      throw new Error(
        `Capture requested same-origin code outside its build receipt: ${JSON.stringify([...unexpectedScriptAssets].sort())}`,
      );
    if (!loadedScriptAssets.size)
      throw new Error(
        'Capture did not request any receipted same-origin code assets.',
      );
    if (!providerSampleWorkerAuditComplete)
      await auditPageWorkerBlobs(page, captureAuditState);
    source.buildProvenance.pageAssetAudit = {
      scope:
        'receipt-backed page paths plus receipt-derived Cesium embedded-worker blobs; blob observer ran during capture and is diagnostic instrumentation, not timing evidence',
      scriptRequestCount,
      loadedAssetPaths: [...loadedScriptAssets].sort(),
      cesiumWorkerBlobAudits: workerBlobObservations,
      unexpectedAssetPaths: [],
    };
    delete source.buildProvenance.expectedAssetPaths;
    delete source.buildProvenance.entryPaths;
    source.provenanceStatus = source.buildProvenance.status;
  }

  const stableWithinScenario = (
    read,
    equivalent = (left, right) =>
      JSON.stringify(left) === JSON.stringify(right),
  ) => {
    const firstByScenario = new Map();
    for (const sample of captures) {
      const value = read(sample);
      if (firstByScenario.has(sample.scenario)) {
        if (!equivalent(value, firstByScenario.get(sample.scenario)))
          return false;
      } else firstByScenario.set(sample.scenario, value);
    }
    return true;
  };
  // Idle, scripted motion, and tracking intentionally have different routes.
  // Compare repeated runs within each workload rather than declaring the
  // entire report mismatched because two different workloads were collected.
  const populationStableAcrossSamples = stableWithinScenario(
    (sample) => sample.layers,
  );
  const cameraPathStableAcrossSamples = stableWithinScenario(
    (sample) => sample.cameraPath,
    routeDescriptorsEquivalent,
  );
  // Recheck delivery after all samples so a late failed/mismatched fulfillment
  // cannot leave an earlier pre-measurement observation looking complete.
  failureProgress.phase = 'final-integrity-check';
  failureProgress.scenario = null;
  failureProgress.run = null;
  failureProgress.current = null;
  fixtureDelivery = await summarizeFlightFixtureDelivery();
  failureProgress.fixtureDelivery = fixtureDelivery;
  if (productionFlightFixture) {
    const perSampleResponseCounts = captures.map((sample) => ({
      scenario: sample.scenario,
      run: sample.run,
      fulfilledResponseCount:
        sample.fixtureDelivery?.fulfilledResponseCount ?? null,
    }));
    fixtureDelivery = {
      ...fixtureDelivery,
      fulfilledResponseCount: perSampleResponseCounts.reduce(
        (total, row) => total + (row.fulfilledResponseCount || 0),
        0,
      ),
      perSampleResponseCounts,
    };
    failureProgress.fixtureDelivery = fixtureDelivery;
  }
  const motionBudget = evaluateMotionFrameBudget(captures, maxP95Ms);
  const integrity = assertCaptureIntegrity(captures, {
    expectedCommit: source.appCommit,
    qualityMode,
    expectedDensityPct,
    expectedCounts: {
      ...(fixture ? { flights: effectiveFixtureAircraftCount } : {}),
      ...(mixedLayers ? { 'local-datacenters': 4362, 'local-dams': 716 } : {}),
    },
    ...(productionFlightFixture
      ? {
          expectedFixture: productionFlightFixture,
          expectedWarmupMs: warmupMs,
          expectedMeasurementMs: seconds * 1000,
        }
      : {}),
  });
  const comparisonContract = productionFlightFixture
    ? createObservedDenseComparisonContract({
        fixture: productionFlightFixture,
        fixtureDelivery,
        environment,
        captures,
        scenarios,
      })
    : null;
  const comparisonReadinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: comparisonContract,
    fixture: productionFlightFixture,
    fixtureDelivery,
    source,
    environment,
    workload: {
      warmupMs,
      durationPerSampleMs: seconds * 1000,
      runsPerScenario: runs,
      startupRuns: startupSamples.length,
      injectedDelayMs: delayMs,
      scenarios,
      hardwareRequired,
    },
    captures,
    diagnosticsDocuments: performanceDiagnosticsDocuments,
    workerBlobAuditInstrumented: Boolean(captureProvenance),
    hardwareRequired,
  });
  const report = {
    schema: 'gev-performance-capture/v1',
    performanceDiagnostics: {
      requested:
        'disabled-after-app-ready-before-warmup-when-supported-per-document',
      documents: performanceDiagnosticsDocuments,
    },
    capturedAt: new Date().toISOString(),
    source,
    url: new URL(url).origin,
    comparisonEligible: false,
    ...(comparisonContract ? { comparisonContract } : {}),
    comparisonReadiness: {
      status: 'not-ready',
      reasons:
        comparisonReadinessReasons.length > 0
          ? comparisonReadinessReasons
          : ['comparison-eligibility-is-not-enabled-by-this-capture-path'],
      reason:
        comparisonReadinessReasons.join('; ') ||
        'comparison-eligibility-is-not-enabled-by-this-capture-path',
    },
    ...(fixtureDelivery ? { fixtureDelivery } : {}),
    environment,
    integrity,
    workload: {
      warmupMs,
      durationPerSampleMs: seconds * 1000,
      runsPerScenario: runs,
      startupRuns: startupSamples.length,
      scenarios,
      fixture,
      ...(productionFlightFixture
        ? {
            providerFixtureLifecycle: {
              scope:
                'each measured scenario/repetition uses a newly created browser context; the earlier setup page contributes environment metadata only, not a capture sample',
              clock:
                'fixture wall time is held during setup, advances monotonically within configured warmup/measurement phases, then stays capped at each declared boundary; native timers, RAF and performance.now are unchanged',
              boundarySettling:
                'one completed Cesium postRender is observed at each capped boundary outside the measured interval, with host and page timeout bounds',
              trackingRoute:
                'entity-follow-v1 observes the public trackedEntity position, camera pose and Cesium clock state at both fixture epochs',
              fixtureTimeAlignment:
                'whole-second UTC; OpenSky source and position epochs agree exactly',
              sourceFreshnessWindowMs: 120_000,
            },
          }
        : {}),
      mixedLayers: mixedLayerFixture,
      qualityMode,
      expectedDensityPct: Number.isFinite(expectedDensityPct)
        ? expectedDensityPct
        : null,
      cameraPath:
        'elapsed-move-right-v1 for scripted motion; parked-v1 for idle; entity-follow-v1 for provider-backed tracking',
      detectionMode: fixture ? detectionMode : null,
      injectedDelayMs: delayMs,
      populationStableAcrossSamples,
      cameraPathStableAcrossSamples,
      note: 'Repeat base and candidate with the same browser, renderer, source population, camera path, viewport, warmup and foreground state.',
    },
    motionBudget: {
      ...motionBudget,
      note: 'Idle rendering is intentionally sparse and is excluded from motion frame budgets.',
    },
    captures,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, json, 'utf8');
    process.stdout.write(`Wrote ${path.resolve(out)}\n`);
  } else {
    process.stdout.write(json);
  }
  if (hardwareRequired && !environment.hardwareEligible) process.exitCode = 2;
  // Idle governor frames are intentionally sparse and are not a motion
  // performance failure. Apply an explicit frame budget only to the moving
  // workload, as required by the performance acceptance contract.
  if (motionBudget.status === 'failed' || motionBudget.status === 'incomplete')
    process.exitCode = 1;
} catch (error) {
  captureFailure = error;
  if (failureProgress.phase === 'final-integrity-check') {
    const failedSample = String(error?.message || '').match(
      /^(idle|scripted-motion|selected-aircraft-tracking) run (\d+):/,
    );
    if (failedSample) {
      failureProgress.scenario = failedSample[1];
      failureProgress.run = Number(failedSample[2]);
    }
  }
  process.exitCode = 1;
  try {
    await writeCaptureFailure(error);
    failureReportWritten = true;
  } catch {
    process.stderr.write('Could not write bounded failed-capture evidence.\n');
  }
} finally {
  for (const session of fixtureInterceptionSessions) {
    await session.send('Fetch.disable').catch(() => {});
    await session.detach().catch(() => {});
  }
  try {
    await browser.close();
  } catch (error) {
    captureFailure ||= error;
    process.exitCode = 1;
  } finally {
    if (ownedBrowserPidFile)
      await fs.rm(ownedBrowserPidFile, { force: true }).catch(() => {});
  }
}
if (captureFailure && !failureReportWritten) {
  try {
    await writeCaptureFailure(captureFailure);
  } catch {
    process.stderr.write('Could not write bounded failed-capture evidence.\n');
  }
}
