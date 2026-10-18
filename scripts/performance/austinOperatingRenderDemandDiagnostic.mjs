#!/usr/bin/env node
/**
 * Bounded, non-comparable Austin render-demand diagnostic.
 *
 * This is deliberately separate from capture-scene-performance.mjs: it makes
 * one 10 s warmup and one 20 s observation for each supplied build and records
 * demand owners rather than producing an acceptance result.  It never calls
 * viewer.render(), changes quality after fixture setup, or intercepts a route
 * outside the pinned Austin delivery.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  fixtureBrowserArgs,
  prepareFixturePage,
} from '../qa-application-fixtures.mjs';
import {
  createAustinOperatingFixtureDelivery,
  createAustinOperatingWorkloadFixture,
} from './austinOperatingWorkloadFixture.mjs';
import {
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
} from './austinOperatingWorkloadContract.mjs';
import { applyNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';
import { installFixtureWallClockOnPage } from './productionFlightFixture.mjs';
import { createWindowsForegroundActivationSession } from './windowsForegroundWindow.mjs';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
} from './rendererEvidence.mjs';
import {
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const FIXED_TIME = '2026-10-12T18:00:00.000Z';
const WARMUP_MS = 10_000;
const OBSERVATION_MS = 20_000;
const SAMPLE_MS = 2_000;
const VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 0,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitSha(root = ROOT) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || !argv[i + 1])
      throw new Error('Arguments are pairs such as --baseline-url URL.');
    args[key.slice(2)] = argv[i + 1];
  }
  if (!args['baseline-url'] || !args['candidate-url'] || !args.out)
    throw new Error(
      'Usage: node austinOperatingRenderDemandDiagnostic.mjs --baseline-url URL --candidate-url URL --out FILE [--baseline-sha SHA --candidate-sha SHA]',
    );
  return args;
}

function boundedError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || error)
      .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
      .slice(0, 400),
  };
}

/** Serialised page setup: exact Austin route/settings/layer population. */
export async function configureAustinDiagnosticFixture(fixture) {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const viewer = app?.viewer;
  if (!manager || !viewer)
    throw new Error('Austin application is unavailable.');
  const controller = app.styleManager?._adaptiveQuality;
  const services = app.styleManager?.services;
  const quality = document.getElementById('presentation-quality-mode');
  const density = document.getElementById('detection-density-slider');
  if (!controller?.setMode || !services || !quality || !density)
    throw new Error('Austin quality controls are unavailable.');
  quality.value = fixture.visualState.qualityMode;
  quality.dispatchEvent(new Event('change', { bubbles: true }));
  const detection = app.styleManager?.setDetection?.({
    enabled: true,
    mode: fixture.visualState.detectionMode,
    densityPct: fixture.visualState.densityPct,
  });
  if (!detection?.ok)
    throw new Error('Austin detection settings were rejected.');
  const clock = viewer.clock;
  clock.shouldAnimate = false;
  clock.multiplier = 0;
  clock.currentTime.dayNumber = fixture.clock.dayNumber;
  clock.currentTime.secondsOfDay = fixture.clock.secondsOfDay;
  const route = fixture.route;
  const destination = viewer.scene.globe.ellipsoid.cartographicToCartesian({
    longitude: (route.center.longitude * Math.PI) / 180,
    latitude: (route.center.latitude * Math.PI) / 180,
    height: route.altitudeM,
  });
  viewer.camera.cancelFlight?.();
  viewer.camera.setView({
    destination,
    orientation: {
      heading: (route.headingDeg * Math.PI) / 180,
      pitch: (route.pitchDeg * Math.PI) / 180,
      roll: 0,
    },
  });
  const selected = new Set(fixture.selectedLayerIds);
  for (const layer of manager.getAll())
    if (layer.enabled && !selected.has(layer.id))
      await manager.setEnabled(layer.id, false);
  for (const id of fixture.selectedLayerIds) {
    const entry = manager.layers?.get(id);
    if (!entry?.module) throw new Error(`Austin layer ${id} is unavailable.`);
    if (id === 'wind') entry.module.setParams(fixture.visualState.wind);
    if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
  }
  window.__gevAustinDiagnosticHome = {
    position: viewer.camera.position.clone(),
    direction: viewer.camera.direction.clone(),
    up: viewer.camera.up.clone(),
  };
  viewer.scene.requestRender();
  return {
    qualityMode: controller.getMode(),
    densityPct: services.getDetectionTuning?.()?.densityPct ?? null,
    detectionMode: services.getDetectionMode?.() ?? null,
    enabledLayerIds: manager
      .getAll()
      .filter((layer) => manager.isEnabled(layer.id))
      .map((layer) => layer.id)
      .sort(),
    clock: {
      dayNumber: clock.currentTime.dayNumber,
      secondsOfDay: clock.currentTime.secondsOfDay,
    },
  };
}

export function installAustinDiagnosticObserver() {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  if (!viewer?.scene?.postRender)
    throw new Error('Cesium postRender is unavailable.');
  const intervals = [];
  let last = null;
  const listener = () => {
    const now = performance.now();
    if (last !== null && intervals.length < 2048) intervals.push(now - last);
    last = now;
  };
  viewer.scene.postRender.addEventListener(listener);
  let longTasks = 0;
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      longTasks = Math.min(2048, longTasks + list.getEntries().length);
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    observer = null;
  }
  window.__gevAustinDiagnosticObserver = {
    readWindPhase() {
      const queue = [{ value: viewer.scene.primitives, depth: 0 }];
      const seen = new Set();
      for (let cursor = 0; cursor < queue.length && cursor < 2048; cursor++) {
        const { value, depth } = queue[cursor];
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const uniforms = value.appearance?.material?.uniforms;
        if (
          Number.isFinite(uniforms?.phaseTime) &&
          Number.isFinite(uniforms?.heightFade)
        )
          return {
            phaseTime: uniforms.phaseTime,
            heightFade: uniforms.heightFade,
          };
        if (
          depth < 4 &&
          typeof value.get === 'function' &&
          Number.isInteger(value.length)
        )
          for (
            let index = 0;
            index < value.length && queue.length < 2048;
            index++
          )
            queue.push({ value: value.get(index), depth: depth + 1 });
      }
      return null;
    },
    read() {
      const state = {
        intervals: intervals.slice(-256),
        longTasks,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      };
      intervals.length = 0;
      longTasks = 0;
      last = null;
      return state;
    },
    dispose() {
      viewer.scene.postRender.removeEventListener(listener);
      observer?.disconnect?.();
      delete window.__gevAustinDiagnosticObserver;
    },
  };
  return true;
}

export function readAustinDiagnosticObservation() {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const viewer = app?.viewer;
  const layer = (id) => manager?.layers?.get(id)?.module ?? null;
  const snapshot = app?.getPerformanceSnapshot?.() ?? null;
  const renderGovernor =
    app?.getRenderGovernorDiagnostics?.() ??
    snapshot?.renderGovernor ??
    snapshot?.renderDemand ??
    null;
  const wind = layer('wind');
  const cctv = layer('cctv');
  const satellites = layer('satellites');
  const canvas = viewer?.scene?.canvas;
  const rect = canvas?.getBoundingClientRect?.();
  return {
    at: performance.now(),
    wallClockMs: Date.now(),
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    renderGovernor,
    renderDemand: snapshot?.renderDemand ?? null,
    performanceSnapshot: snapshot,
    wind: wind?.getDiagnostics?.() ?? null,
    windParams: wind?.getParams?.() ?? null,
    cctv: cctv?.getPerformanceDiagnostics?.() ?? null,
    cctvParams: cctv?.getParams?.() ?? null,
    satellites:
      satellites?.getDiagnostics?.() ?? satellites?.getStats?.() ?? null,
    satelliteParams: satellites?.getParams?.() ?? null,
    satelliteWitness: (() => {
      try {
        const row = satellites
          ?.getAllPositions?.(1000)
          ?.find?.((item) => Number(item?.noradId ?? item?.id) === 25544);
        return row
          ? {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              altitudeM: Number.isFinite(row.altitudeM) ? row.altitudeM : null,
            }
          : null;
      } catch {
        return null;
      }
    })(),
    requestRenderMode: viewer?.scene?.requestRenderMode ?? null,
    clock: viewer?.clock?.currentTime
      ? {
          dayNumber: viewer.clock.currentTime.dayNumber,
          secondsOfDay: viewer.clock.currentTime.secondsOfDay,
        }
      : null,
    viewport: rect
      ? { width: rect.width, height: rect.height, dpr: window.devicePixelRatio }
      : null,
    drawingBuffer: canvas
      ? { width: canvas.width, height: canvas.height }
      : null,
    windMaterial:
      window.__gevAustinDiagnosticObserver?.readWindPhase?.() ?? null,
    postRender: window.__gevAustinDiagnosticObserver?.read?.() ?? null,
  };
}

async function captureSide({ label, url, appSha, fixture }) {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: fixtureBrowserArgs({ softwareRendering: false, webglOnly: false }),
    defaultViewport: null,
  });
  const browserPid = browser.process()?.pid;
  let foregroundSession = null;
  let page = null;
  let context = null;
  let prepared = null;
  let delivery = null;
  const cleanupErrors = [];
  const observations = { label, appSha, samples: [] };
  let primaryError = null;
  try {
    if (!Number.isSafeInteger(browserPid) || browserPid < 1)
      throw new Error('Owned browser PID unavailable.');
    foregroundSession = createWindowsForegroundActivationSession({
      browserPid,
    });
    await foregroundSession.start({ timeoutMs: 15_000 });
    const origin = new URL(url).origin;
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await installFixtureWallClockOnPage(
      page,
      fixture.fixedTimeMs,
      { phasedClock: true },
      [WARMUP_MS, OBSERVATION_MS, 1000],
    );
    delivery = createAustinOperatingFixtureDelivery(fixture, origin);
    prepared = await prepareFixturePage(browser, origin, {
      page,
      viewport: VIEWPORT,
      respond: (href, request) => delivery.respond(href, request),
      onFulfilled: (event) => delivery.onFulfilled(event),
    });
    await page.bringToFront();
    await foregroundSession.request(browserPid, 15_000);
    await bootFixturePage(page, origin, {
      applicationReadyTimeoutMs: 180_000,
      hash: '#v=2&lat=30.2672&lon=-97.7431&alt=12000&heading=20&pitch=-45&roll=0&style=normal&map=osm&dm=DENSE&dd=75&l=',
    });
    await foregroundSession.request(browserPid, 15_000);
    await page.evaluate(applyNativeSharpnessProfile);
    const setup = await page.evaluate(
      configureAustinDiagnosticFixture,
      fixture,
    );
    const environment = await page.evaluate(
      () => window.__godsEyeView?.getPerformanceEnvironment?.() ?? null,
    );
    const observedAppCommit =
      environment?.source?.appCommit ?? environment?.appCommit ?? null;
    Object.assign(observations, { setup, environment });
    if (!observedAppCommit || observedAppCommit !== appSha)
      throw new Error(
        `${label} application environment commit differs from requested revision.`,
      );
    await page.waitForFunction(
      (expected) => {
        const manager = window.__godsEyeView?.dataManager;
        return expected.every((id) => {
          const entry = manager?.layers?.get(id);
          const stats = entry?.module?.getStats?.() ?? entry?.stats ?? null;
          return (
            manager?.isEnabled?.(id) === true &&
            Number.isSafeInteger(stats?.count) &&
            stats.count >= 1 &&
            stats.loading !== true &&
            !stats.error
          );
        });
      },
      { timeout: 30_000, polling: 100 },
      fixture.selectedLayerIds,
    );
    await page.evaluate(installAustinDiagnosticObserver);
    await page.evaluate(() => {
      const clock = window.__gevPhasedMonotonicWallClockV1;
      if (
        !clock ||
        typeof clock.startWarmup !== 'function' ||
        typeof clock.holdWarmupBoundary !== 'function' ||
        typeof clock.startMeasurement !== 'function' ||
        typeof clock.finishMeasurement !== 'function'
      )
        throw new Error('Phased wall-clock contract is unavailable.');
      clock.startWarmup(1);
    });
    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
    await page.evaluate(() =>
      window.__gevPhasedMonotonicWallClockV1.holdWarmupBoundary(1),
    );
    observations.warmupEnd = await page.evaluate(
      readAustinDiagnosticObservation,
    );
    await page.evaluate(() =>
      window.__gevPhasedMonotonicWallClockV1.startMeasurement(1),
    );
    const samples = observations.samples;
    const started = Date.now();
    while (Date.now() - started < OBSERVATION_MS) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
      samples.push(await page.evaluate(readAustinDiagnosticObservation));
    }
    await page.evaluate(() =>
      window.__gevPhasedMonotonicWallClockV1.finishMeasurement(1),
    );
    const graphics = await readBrowserGraphicsInfo(browser);
    const renderer =
      environment?.renderer ??
      (await page.evaluate(() => {
        const canvas = window.__godsEyeView?.viewer?.scene?.canvas;
        const gl =
          window.__godsEyeView?.viewer?.scene?.context?._gl ??
          canvas?.getContext?.('webgl') ??
          canvas?.getContext?.('webgl2');
        return gl
          ? {
              renderer: gl.getParameter(gl.RENDERER),
              vendor: gl.getParameter(gl.VENDOR),
            }
          : null;
      }));
    const rendererName =
      typeof renderer === 'string' ? renderer : renderer?.renderer;
    const rendererClassification = classifyRenderer(rendererName, graphics);
    if (!rendererClassification.accelerationVerified)
      throw new Error(`${label} native hardware WebGL proof is unavailable.`);
    observations.naturalEnd = await page.evaluate(
      readAustinDiagnosticObservation,
    );
    const windVisibilityProbe = await page.evaluate(async () => {
      const viewer = window.__godsEyeView?.viewer;
      const home = window.__gevAustinDiagnosticHome;
      if (!viewer?.camera || !home)
        return { status: 'unavailable', reason: 'camera-home-missing' };
      const globe = viewer.scene.globe;
      const phase = () => window.__gevAustinDiagnosticObserver.readWindPhase();
      const current = globe.ellipsoid.cartesianToCartographic(
        viewer.camera.position,
      );
      const elevated = globe.ellipsoid.cartographicToCartesian({
        longitude: current.longitude,
        latitude: current.latitude,
        height: 60000,
      });
      try {
        viewer.camera.setView({
          destination: elevated,
          orientation: {
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const wind =
          window.__godsEyeView?.dataManager?.layers?.get('wind')?.module;
        const first = {
          at: performance.now(),
          diagnostics: wind?.getDiagnostics?.() ?? null,
          material: phase(),
        };
        window.__gevAustinDiagnosticObserver.read();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const second = {
          at: performance.now(),
          diagnostics: wind?.getDiagnostics?.() ?? null,
          material: phase(),
          postRender: window.__gevAustinDiagnosticObserver.read(),
        };
        return {
          status: 'observed',
          first,
          second,
          intervention: 'elevated-60000m-after-natural-observation',
          clockScope:
            'wall clock held at completed measurement; native animation time continues',
        };
      } finally {
        viewer.camera.setView({
          destination: home.position,
          orientation: { direction: home.direction, up: home.up },
        });
      }
    });
    const profile = await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer;
      const canvas = viewer?.scene?.canvas;
      const globe = viewer?.scene?.globe;
      return {
        id: viewer?.__gevNativeSharpnessProfile ?? null,
        useBrowserRecommendedResolution:
          viewer?.useBrowserRecommendedResolution,
        resolutionScale: viewer?.resolutionScale,
        maximumScreenSpaceError: globe?.maximumScreenSpaceError,
        viewport: {
          width: canvas?.clientWidth,
          height: canvas?.clientHeight,
          dpr: window.devicePixelRatio,
        },
        drawingBuffer: { width: canvas?.width, height: canvas?.height },
      };
    });
    const final = await page.evaluate(readAustinDiagnosticObservation);
    const summary = delivery.summarize({
      requiredAssetIds: [
        ...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
        'installations',
      ],
      requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(
        ([z, x, y]) => ({ z, x, y }),
      ),
    });
    await page.evaluate(() =>
      window.__gevAustinDiagnosticObserver?.dispose?.(),
    );
    Object.assign(observations, {
      browserPid,
      graphics,
      renderer,
      rendererClassification,
      profile,
      final,
      windVisibilityProbe,
      delivery: summary,
      foreground: await foregroundSession.request(browserPid, 15_000),
    });
    if (prepared.errors.length)
      throw new Error('Diagnostic fixture reported application errors.');
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await page?.evaluate(() =>
        window.__gevAustinDiagnosticObserver?.dispose?.(),
      );
    } catch {}
    if (prepared?.interception) {
      try {
        const drained = await prepared.interception.stopAndDrain();
        if (!drained?.confirmed)
          throw new Error('Fixture interception did not drain.');
      } catch (error) {
        cleanupErrors.push(boundedError(error));
      }
    }
    try {
      if (page && context && !page.isClosed()) {
        const closed = await closeOwnedRecoveryPage(page, context, 5000);
        if (!closed?.closeCompleted || closed.openPageCount !== 0)
          throw new Error('Owned diagnostic page did not close.');
      }
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
    try {
      await cleanupFixturePageDiagnostics(page);
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
    try {
      delivery?.dispose?.();
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
    if (prepared?.interception) {
      try {
        const released = await prepared.interception.releaseSession({
          targetClosed: page?.isClosed() === true,
        });
        if (!released?.confirmed)
          throw new Error('Fixture interception release was not confirmed.');
      } catch (error) {
        cleanupErrors.push(boundedError(error));
      }
    }
    try {
      await context?.close?.();
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
    try {
      await foregroundSession?.dispose?.();
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
    try {
      const closed = await closeRecoveryBrowser(browser, {
        timeoutMs: 5000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      if (!closed?.closeCompleted || closed.forcedProcessTermination === true)
        throw new Error('Owned browser shutdown was not confirmed.');
    } catch (error) {
      cleanupErrors.push(boundedError(error));
    }
  }
  observations.teardown = { cleanupErrors };
  if (primaryError || cleanupErrors.length) {
    observations.status = 'failed';
    observations.error = boundedError(
      primaryError || new Error('Diagnostic cleanup failed.'),
    );
  } else observations.status = 'observed';
  return observations;
}

export async function runAustinOperatingRenderDemandDiagnostic({
  baselineUrl,
  candidateUrl,
  baselineSha,
  candidateSha,
  out,
}) {
  for (const [label, value] of [
    ['baseline', baselineUrl],
    ['candidate', candidateUrl],
  ]) {
    const parsed = new URL(value);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '')
    )
      throw new Error(`${label} URL must be a loopback HTTP(S) origin.`);
  }
  if (
    !/^[a-f0-9]{40}$/i.test(baselineSha) ||
    !/^[a-f0-9]{40}$/i.test(candidateSha) ||
    baselineSha.toLowerCase() === candidateSha.toLowerCase()
  )
    throw new Error(
      'Baseline and candidate application SHAs must be distinct full Git SHAs.',
    );
  if (
    await fs
      .stat(path.resolve(out))
      .then(() => true)
      .catch(() => false)
  )
    throw new Error(`Diagnostic output already exists: ${out}`);
  const fixture = createAustinOperatingWorkloadFixture(FIXED_TIME);
  const results = [];
  for (const side of [
    { label: 'baseline', url: baselineUrl, appSha: baselineSha },
    { label: 'candidate', url: candidateUrl, appSha: candidateSha },
  ]) {
    console.log(
      `Observing ${side.label} production render demand (diagnostic only).`,
    );
    try {
      results.push(await captureSide({ ...side, fixture }));
    } catch (error) {
      results.push({
        label: side.label,
        appSha: side.appSha,
        status: 'failed',
        error: boundedError(error),
      });
    }
  }
  const report = {
    schema: 'gev-austin-operating-render-demand-diagnostic/v1',
    status: results.every((result) => result.status !== 'failed')
      ? 'diagnostic-non-comparable'
      : 'diagnostic-failed',
    comparable: false,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      fixedTime: FIXED_TIME,
      route: fixture.route,
      visualState: fixture.visualState,
    },
    timing: {
      warmupMs: WARMUP_MS,
      observationMs: OBSERVATION_MS,
      sampleMs: SAMPLE_MS,
    },
    identities: {
      baselineCommit: baselineSha ?? null,
      candidateCommit: candidateSha ?? null,
      diagnosticHarnessCommit: gitSha(),
      scriptSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    },
    sides: results,
  };
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv);
  runAustinOperatingRenderDemandDiagnostic({
    baselineUrl: args['baseline-url'],
    candidateUrl: args['candidate-url'],
    baselineSha:
      args['baseline-sha'] ?? 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256',
    candidateSha:
      args['candidate-sha'] ?? '19065997a3f6360d68cb9ed5b389c4754856b596',
    out: args.out,
  })
    .then((report) => {
      console.log(
        JSON.stringify({
          status: report.status,
          sides: report.sides.map((side) => ({
            label: side.label,
            status: side.status,
            error: side.error,
          })),
        }),
      );
      if (report.status === 'diagnostic-failed') process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${boundedError(error).message}\n`);
      process.exitCode = 1;
    });
}
