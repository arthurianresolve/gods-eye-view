import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { createServer } from 'vite';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
} from './rendererEvidence.mjs';
import {
  assertInitialRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';
import { interceptFixtureSession } from './fixtureInterception.mjs';
import { CABLE_REFERENCE_RENDER_POPULATION } from '../fixtures/cable-reference-collections-contract.mjs';
import {
  CABLE_BENEFIT_MANIFEST_PATHS,
  CABLE_BENEFIT_MODES,
  CABLE_BENEFIT_PAIRS,
  CABLE_BENEFIT_SCHEMA,
  CABLE_BENEFIT_SOURCE_PATHS,
  summarizeCableBenefit,
  validateCableBenefit,
} from './cableBenefitReport.mjs';

const ROOT = resolve(process.cwd());
const VIEWPORT = Object.freeze({ width: 1200, height: 1000, dpr: 1 });
const CANVAS = Object.freeze({ width: 960, height: 640 });
const FIXED_CLOCK = Object.freeze({
  iso: '2026-10-11T12:34:56.000Z',
  shouldAnimate: false,
});
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function settleWithin(operation, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(operation).then(
      (value) => ({ completed: true, value }),
      (error) => ({ completed: false, error }),
    ),
    new Promise((resolveTimeout) => {
      timer = setTimeout(
        () => resolveTimeout({ completed: false, timeout: true }),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitForState(page, phase, timeoutMs) {
  try {
    await page.waitForFunction(
      (expectedPhase) =>
        window.__cableBenefitState?.phase === expectedPhase ||
        window.__cableBenefitState?.phase === 'failed',
      { timeout: timeoutMs, polling: 50 },
      phase,
    );
  } catch (error) {
    let last = null;
    try {
      last = await page.evaluate(() => window.__cableBenefitState || null);
    } catch {}
    throw new Error(
      `Fixture phase ${phase} timed out: ${JSON.stringify(last).slice(0, 2500)} (${error.message})`,
    );
  }
  const state = await page.evaluate(() => window.__cableBenefitState);
  if (state?.phase === 'failed')
    throw new Error(
      `Fixture failed during ${phase}: ${state.error || 'unknown error'}`,
    );
  return state;
}

async function readHeap(session) {
  await session.send('HeapProfiler.collectGarbage');
  const metrics = await session.send('Performance.getMetrics');
  const bytes = metrics.metrics.find(
    (entry) => entry.name === 'JSHeapUsedSize',
  )?.value;
  assert.ok(
    Number.isFinite(bytes) && bytes >= 0,
    'JSHeapUsedSize unavailable.',
  );
  return Math.round(bytes);
}

function persistPng(output, suite, pairIndex, mode, base64, expected) {
  assert.match(base64 || '', /^[A-Za-z0-9+/]+=*$/);
  const bytes = Buffer.from(base64, 'base64');
  assert.ok(
    bytes.length > PNG_SIGNATURE.length && bytes.length <= 10 * 1024 * 1024,
  );
  assert.deepEqual(bytes.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  assert.equal(bytes.readUInt32BE(16), expected.width);
  assert.equal(bytes.readUInt32BE(20), expected.height);
  const relativePath = `images/${suite}-pair-${String(pairIndex + 1).padStart(2, '0')}-${mode}.png`;
  const absolutePath = resolve(output, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { flag: 'wx' });
  renameSync(temporary, absolutePath);
  return sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      assert.equal(info.width, expected.width);
      assert.equal(info.height, expected.height);
      const pixelSha256 = sha(data);
      assert.equal(pixelSha256, expected.pixelSha256);
      return {
        file: relativePath.slice('images/'.length),
        relativePath,
        pngSha256: sha(bytes),
        pixelSha256,
        width: info.width,
        height: info.height,
        bytes: bytes.length,
      };
    });
}

function requiredSourceFiles(manifests) {
  const cesiumFiles = [
    ...new Map(
      manifests
        .flatMap(({ manifest }) => manifest.files)
        .map((file) => [file.relativePath, file]),
    ).values(),
  ];
  const files = [...CABLE_BENEFIT_SOURCE_PATHS];
  for (const path of files)
    assert.ok(
      existsSync(resolve(ROOT, path)),
      `Missing provenance source ${path}`,
    );
  return { files, cesiumFiles };
}

function extractPairRun(pair, mode) {
  return pair.runs[mode];
}

function equalPickIdentity(left, right) {
  const select = (pick) => ({
    kind: pick.kind,
    ownerVerified: pick.ownerVerified,
    entityId: pick.entityId,
    sourceRecordId: pick.sourceRecordId,
    screen: pick.screen,
  });
  return JSON.stringify(select(left)) === JSON.stringify(select(right));
}

function assertPairParity(pair) {
  const entities = extractPairRun(pair, 'entities');
  const collections = extractPairRun(pair, 'collections');
  for (const key of [
    'source',
    'population',
    'renderClock',
    'settings',
    'environment',
    'camera',
    'geometrySha256',
    'geometryComponents',
  ])
    assert.deepEqual(
      entities[key],
      collections[key],
      `Pair ${pair.index} ${key} differs.`,
    );
  assert.equal(entities.image.pixelSha256, collections.image.pixelSha256);
  assert.equal(entities.image.pngSha256, collections.image.pngSha256);
  assert.ok(equalPickIdentity(entities.pointPick, collections.pointPick));
  assert.ok(equalPickIdentity(entities.stemPick, collections.stemPick));
  pair.sameInputAndOutput = true;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'Run this comparison on hosted CI only.',
  );
  const expectedCommit = process.env.CANDIDATE_SHA;
  assert.match(expectedCommit || '', /^[a-f0-9]{40}$/);
  const outputArg = process.argv[2];
  assert.ok(outputArg, 'Usage: cableBenefitComparison.mjs NEW_OUTPUT_DIR');
  const output = resolve(ROOT, outputArg);
  assert.equal(
    existsSync(output),
    false,
    'Refusing to overwrite benefit evidence.',
  );
  assert.equal(
    git(['rev-parse', 'HEAD']),
    expectedCommit,
    'Wrong candidate commit.',
  );
  assert.equal(
    git(['status', '--porcelain']),
    '',
    'Source tree must be clean.',
  );

  const manifestPaths = [...CABLE_BENEFIT_MANIFEST_PATHS];
  const manifests = manifestPaths.map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')),
  }));
  const { files: immutableFiles, cesiumFiles } = requiredSourceFiles(manifests);
  const hashFile = (path) => sha(readFileSync(resolve(ROOT, path)));
  const sourceHashes = Object.fromEntries(
    immutableFiles.map((path) => [path, hashFile(path)]),
  );
  const packageBytes = readFileSync(
    resolve(ROOT, 'node_modules/cesium/package.json'),
  );
  const engineBytes = readFileSync(
    resolve(ROOT, 'node_modules/@cesium/engine/package.json'),
  );
  const packageInfo = JSON.parse(packageBytes.toString('utf8'));
  const engineInfo = JSON.parse(engineBytes.toString('utf8'));
  assert.equal(packageInfo.version, '1.138.0');
  assert.equal(engineInfo.version, '22.3.0');
  assert.ok(
    manifests.every(
      ({ manifest }) =>
        manifest.cesiumVersion === packageInfo.version &&
        manifest.engineVersion === engineInfo.version,
    ),
  );
  const cesiumHashes = Object.fromEntries(
    cesiumFiles.map((file) => {
      const digest = hashFile(`node_modules/${file.relativePath}`);
      assert.equal(
        digest,
        file.patchedSha256,
        `Patched Cesium bytes mismatch: ${file.relativePath}`,
      );
      return [file.relativePath, digest];
    }),
  );

  const report = {
    schema: CABLE_BENEFIT_SCHEMA,
    status: 'running',
    applicationCommit: expectedCommit,
    harnessCommit: expectedCommit,
    sourceDirty: false,
    sourceChanged: false,
    hardwareRenderingValidated: false,
    benefitAccepted: false,
    startedAt: new Date().toISOString(),
    renderClock: { ...FIXED_CLOCK },
    measurementScope: {
      latency:
        'fresh-browser-context-ready-to-first-three-ready-postRender-frames',
      memory:
        'separate-fresh-browser-context-post-forced-gc-js-heap-used-size-only',
      noBenefitClaim: 'diagnostic-comparison-only-await-independent-review',
      pairCountPerSuite: CABLE_BENEFIT_PAIRS,
      alternation:
        'entities,collections then collections,entities within each suite',
    },
    provenance: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cesiumVersion: packageInfo.version,
      engineVersion: engineInfo.version,
      files: sourceHashes,
      packageLockSha256: sourceHashes['package-lock.json'],
      patchManifests: Object.fromEntries(
        manifests.map(({ path }) => [path, sourceHashes[path]]),
      ),
      installedDependencyBytes: {
        cesiumPackageSha256: sha(packageBytes),
        enginePackageSha256: sha(engineBytes),
        cesiumVersion: packageInfo.version,
        engineVersion: engineInfo.version,
        cesiumFiles: cesiumHashes,
      },
    },
    graphics: null,
    pairs: [],
    cleanup: {
      initialPageClosed: false,
      pagesClosed: false,
      sessionsDetached: false,
      browserClosed: false,
      serverClosed: false,
      sourceTreeUnchanged: false,
    },
  };
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output, { recursive: false });
  const reportPath = resolve(output, 'report.json');
  const save = () => {
    const temp = resolve(output, `.report-${process.pid}.tmp`);
    writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
    renameSync(temp, reportPath);
  };
  const pages = [];
  const sessions = [];
  let server;
  let browser;
  let failure = null;
  save();

  const waitForFixtureState = async (page, phase, timeoutMs) =>
    waitForState(page, phase, timeoutMs);

  const runOne = async (mode, suite, index, orderIndex, pair) => {
    const record = {
      mode,
      suite,
      index,
      orderIndex,
      applicationCommit: expectedCommit,
      harnessCommit: expectedCommit,
      phase: 'new-context',
      status: 'running',
      pageErrors: [],
      externalRequests: [],
      interceptionErrors: [],
      sessionDetached: false,
      contextClosed: false,
    };
    pair.runs[mode] = record;
    const owned = { page: null, context: null, record };
    pages.push(owned);
    let context = null;
    let page = null;
    let session = null;
    let runFailure = null;
    try {
      context = await browser.createBrowserContext();
      owned.context = context;
      page = await context.newPage();
      owned.page = page;
      session = await page.createCDPSession();
      sessions.push({ session, record });
      page.on('pageerror', (error) => {
        if (record.pageErrors.length < 20)
          record.pageErrors.push(String(error.message).slice(0, 500));
      });
      page.on('console', (message) => {
        if (message.type() === 'error' && record.pageErrors.length < 20)
          record.pageErrors.push(message.text().slice(0, 500));
      });
      await page.setViewport({
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        deviceScaleFactor: VIEWPORT.dpr,
      });
      await page.setCacheEnabled(false);
      await session.send('Performance.enable');
      if (suite === 'memory') await session.send('HeapProfiler.enable');
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      await interceptFixtureSession(
        session,
        origin,
        (url) => {
          if (
            ['http:', 'https:'].includes(url.protocol) &&
            url.origin !== origin &&
            record.externalRequests.length < 20
          )
            record.externalRequests.push(url.origin);
          return null;
        },
        (error) => {
          if (record.interceptionErrors.length < 20)
            record.interceptionErrors.push(String(error.message).slice(0, 500));
        },
      );
      const response = await page.goto(
        `${origin}/scripts/fixtures/cable-reference-benefit.html?mode=${mode}`,
        {
          waitUntil: 'networkidle0',
          timeout: 60_000,
        },
      );
      assert.equal(
        response?.status(),
        200,
        'Cable benefit fixture did not load.',
      );
      record.phase = 'ready';
      let state = await waitForFixtureState(page, 'ready', 60_000);
      record.ready = true;
      record.warmup = state.warmup;
      record.environment = {
        ...state.environment,
        graphics: report.graphics,
        rendererClass: classifyRenderer(
          state.environment?.renderer,
          report.graphics,
        ),
      };
      assert.equal(
        record.environment.rendererClass.accelerationVerified,
        true,
        'Acceleration is not verified.',
      );
      if (suite === 'memory') {
        record.memory = {
          gcRequested: true,
          metric: 'Performance.getMetrics.JSHeapUsedSize',
          baseline: await readHeap(session),
        };
      } else record.memory = null;
      record.phase = 'activating';
      await page.click('#run');
      state = await waitForFixtureState(page, 'enabled-settled', 185_000);
      assert.deepEqual(
        record.pageErrors,
        [],
        'Fixture raised page/console errors.',
      );
      assert.deepEqual(
        record.externalRequests,
        [],
        'Fixture requested a remote resource.',
      );
      assert.deepEqual(
        record.interceptionErrors,
        [],
        'Request interception failed.',
      );
      assert.equal(state.applicationCommit, expectedCommit);
      assert.equal(state.harnessCommit, expectedCommit);
      assert.equal(state.mode, mode);
      record.phase = 'enabled-settled';
      for (const key of [
        'source',
        'renderClock',
        'settings',
        'timings',
        'population',
        'readiness',
        'ownership',
        'pointPick',
        'stemPick',
        'geometrySha256',
        'geometryComponents',
        'camera',
        'visibilityCycle',
      ])
        record[key] = state[key];
      record.source = state.source;
      assert.deepEqual(record.renderClock, FIXED_CLOCK);
      const imageData = await page.evaluate(() =>
        window.__cableBenefit.takeImage(),
      );
      record.image = await persistPng(
        output,
        suite,
        index,
        mode,
        imageData,
        state.image,
      );
      // The image bytes and data URL remain in Node only; the fixture clears its
      // retained canvas copy before the memory checkpoint.
      if (suite === 'memory') record.memory.enabled = await readHeap(session);

      record.phase = 'destroying-layer';
      await page.evaluate(() => window.__cableBenefit.destroyLayer());
      state = await waitForFixtureState(page, 'layer-destroyed', 10_000);
      record.teardown = {
        layerDestroyed: true,
        viewerDestroyed: false,
        ownerCountAfterDestroy: state.teardown.collections,
        dataSources: state.teardown.dataSources,
        listeners: state.teardown.listeners,
        collections: state.teardown.collections,
        normalPrimitiveCountAfterDestroy: state.teardown.primitives,
        groundPrimitiveCountAfterDestroy: state.teardown.groundPrimitives,
      };
      if (suite === 'memory') record.memory.destroyed = await readHeap(session);
      record.phase = 'destroying-viewer';
      state = await page.evaluate(() => window.__cableBenefit.destroyViewer());
      assert.equal(state?.phase, 'viewer-destroyed');
      record.teardown.viewerDestroyed = true;
      if (suite === 'memory')
        record.memory.viewerDestroyed = await readHeap(session);
      record.phase = 'viewer-destroyed';
      record.status = 'passed';
    } catch (error) {
      runFailure = error;
      record.status = 'failed';
      record.error = String(error?.stack || error).slice(0, 8000);
      try {
        record.partial = await page.evaluate(
          () => window.__cableBenefitState || null,
        );
      } catch {}
    } finally {
      let cleanupErrors = [];
      if (session) {
        try {
          await session.detach();
          record.sessionDetached = true;
        } catch (error) {
          cleanupErrors.push(`session detach: ${error.message}`);
        }
      } else record.sessionDetached = true;
      if (page) {
        try {
          record.pageCleanup = await closeOwnedRecoveryPage(
            page,
            browser,
            5_000,
          );
        } catch (error) {
          cleanupErrors.push(`page close: ${error.message}`);
        }
      }
      if (context) {
        const closeContext = await settleWithin(context.close(), 5_000);
        record.contextClosed =
          closeContext.completed && closeContext.value !== false;
        if (!record.contextClosed)
          cleanupErrors.push('browser context close timed out or failed');
      }
      record.cleanupErrors = cleanupErrors;
      record.cleanupComplete =
        record.sessionDetached &&
        record.contextClosed &&
        record.pageCleanup?.closeCompleted === true &&
        record.pageCleanup?.openPageCount === 0;
      if (!record.cleanupComplete)
        runFailure ||= new Error(
          `${mode}/${suite} owned context cleanup failed.`,
        );
    }
    if (runFailure) throw runFailure;
    return record;
  };

  try {
    server = await createServer({
      root: ROOT,
      configFile: resolve(ROOT, 'vite.config.js'),
      define: { __GEV_APP_COMMIT__: JSON.stringify(expectedCommit) },
      server: { host: '127.0.0.1', port: 0, hmr: false },
      logLevel: 'warn',
      clearScreen: false,
    });
    await server.listen();
    browser = await puppeteer.launch({
      headless: true,
      timeout: 30_000,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const initialPage = assertInitialRecoveryPage(
      await browser.pages(),
      'http://127.0.0.1',
    );
    const initialClose = await closeOwnedRecoveryPage(
      initialPage,
      browser,
      5_000,
    );
    assert.equal(initialClose.closeCompleted, true);
    assert.equal(initialClose.openPageCount, 0);
    report.cleanup.initialPageClosed = true;
    report.graphics = await readBrowserGraphicsInfo(browser);
    assert.ok(report.graphics, 'Browser GPU information is unavailable.');

    for (const suite of ['latency', 'memory']) {
      for (let index = 0; index < CABLE_BENEFIT_PAIRS; index++) {
        const order =
          index % 2 === 0
            ? [...CABLE_BENEFIT_MODES]
            : [...CABLE_BENEFIT_MODES].reverse();
        const pair = { suite, index, order, runs: {} };
        report.pairs.push(pair);
        save();
        for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
          await runOne(order[orderIndex], suite, index, orderIndex, pair);
          save();
        }
        assertPairParity(pair);
        pair.deltas = {
          populationReadyPercent:
            (pair.runs.collections.timings.populationReadyMs /
              pair.runs.entities.timings.populationReadyMs) *
              100 -
            100,
          readyFramePercent:
            (pair.runs.collections.timings.readyFrameMs /
              pair.runs.entities.timings.readyFrameMs) *
              100 -
            100,
          ...(suite === 'memory'
            ? {
                enabledHeapPercent:
                  ((pair.runs.collections.memory.enabled -
                    pair.runs.collections.memory.baseline) /
                    Math.max(
                      1,
                      pair.runs.entities.memory.enabled -
                        pair.runs.entities.memory.baseline,
                    )) *
                    100 -
                  100,
              }
            : {}),
        };
        save();
      }
    }
    report.summary = summarizeCableBenefit(report);
    report.status = 'passed';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = String(error?.stack || error).slice(0, 8000);
  } finally {
    report.cleanup.pagesClosed = pages.every(
      (item) => item.record.cleanupComplete,
    );
    report.cleanup.sessionsDetached = sessions.every(
      (item) => item.record.sessionDetached,
    );
    if (browser) {
      const close = await closeRecoveryBrowser(browser, {
        timeoutMs: 5_000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      report.browserClose = close;
      report.cleanup.browserClosed =
        close.closeCompleted && !close.forcedProcessTermination;
      if (!report.cleanup.browserClosed)
        failure ||= new Error('Browser did not shut down cleanly.');
    }
    if (server) {
      const close = await settleWithin(server.close(), 5_000);
      report.cleanup.serverClosed = close.completed;
      if (!report.cleanup.serverClosed)
        failure ||= new Error('Vite server did not shut down cleanly.');
    }
    try {
      assert.equal(git(['rev-parse', 'HEAD']), expectedCommit);
      assert.equal(git(['status', '--porcelain']), '');
      for (const [path, digest] of Object.entries(report.provenance.files))
        assert.equal(
          hashFile(path),
          digest,
          `Source changed during run: ${path}`,
        );
      assert.equal(
        hashFile('node_modules/cesium/package.json'),
        report.provenance.installedDependencyBytes.cesiumPackageSha256,
      );
      assert.equal(
        hashFile('node_modules/@cesium/engine/package.json'),
        report.provenance.installedDependencyBytes.enginePackageSha256,
      );
      for (const [path, digest] of Object.entries(cesiumHashes))
        assert.equal(
          hashFile(`node_modules/${path}`),
          digest,
          `Installed engine bytes changed: ${path}`,
        );
      report.cleanup.sourceTreeUnchanged = true;
    } catch (error) {
      failure ||= error;
    }
    report.finishedAt = new Date().toISOString();
    if (!failure) {
      try {
        validateCableBenefit(report, expectedCommit);
      } catch (error) {
        failure = error;
      }
    }
    if (failure) {
      report.status = 'failed';
      report.error ||= String(failure?.stack || failure).slice(0, 8000);
    }
    if (existsSync(output)) save();
  }
  console.log(
    JSON.stringify({
      schema: report.schema,
      status: report.status,
      reportPath: reportPath,
      pairs: report.pairs.length,
      cleanup: report.cleanup,
    }),
  );
  if (failure) process.exitCode = 1;
}
