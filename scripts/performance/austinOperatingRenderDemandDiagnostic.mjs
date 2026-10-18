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
import { fileURLToPath } from 'node:url';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  if (!manager || !viewer) throw new Error('Austin application is unavailable.');
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
  if (!detection?.ok) throw new Error('Austin detection settings were rejected.');
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
    if (layer.enabled && !selected.has(layer.id)) await manager.setEnabled(layer.id, false);
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
    enabledLayerIds: manager.getAll().filter((layer) => manager.isEnabled(layer.id)).map((layer) => layer.id).sort(),
    clock: { dayNumber: clock.currentTime.dayNumber, secondsOfDay: clock.currentTime.secondsOfDay },
  };
}

export function installAustinDiagnosticObserver() {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  if (!viewer?.scene?.postRender) throw new Error('Cesium postRender is unavailable.');
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
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    observer = null;
  }
  window.__gevAustinDiagnosticObserver = {
    read() {
      const state = {
        intervals: intervals.slice(-256),
        longTasks,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      };
      intervals.length = 0;
      longTasks = 0;
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
  const renderGovernor = snapshot?.renderGovernor ?? snapshot?.renderDemand ?? null;
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
    satellites: satellites?.getDiagnostics?.() ?? satellites?.getStats?.() ?? null,
    satelliteParams: satellites?.getParams?.() ?? null,
    requestRenderMode: viewer?.scene?.requestRenderMode ?? null,
    clock: viewer?.clock?.currentTime
      ? { dayNumber: viewer.clock.currentTime.dayNumber, secondsOfDay: viewer.clock.currentTime.secondsOfDay }
      : null,
    viewport: rect ? { width: rect.width, height: rect.height, dpr: window.devicePixelRatio } : null,
    drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
    postRender: window.__gevAustinDiagnosticObserver?.read?.() ?? null,
  };
}

async function captureSide({ label, url, appSha, fixture, foreground }) {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: fixtureBrowserArgs(),
    defaultViewport: null,
  });
  const browserPid = browser.process()?.pid;
  let foregroundSession = null;
  let page = null;
  let prepared = null;
  let delivery = null;
  try {
    if (!Number.isSafeInteger(browserPid) || browserPid < 1) throw new Error('Owned browser PID unavailable.');
    foregroundSession = createWindowsForegroundActivationSession({ browserPid });
    await foregroundSession.start({ timeoutMs: 15_000 });
    const origin = new URL(url).origin;
    page = await browser.newPage();
    await installFixtureWallClockOnPage(page, fixture.fixedTimeMs, { phasedClock: true }, [WARMUP_MS, OBSERVATION_MS, 1000]);
    delivery = createAustinOperatingFixtureDelivery(fixture, origin);
    prepared = await prepareFixturePage(browser, origin, {
      page,
      viewport: VIEWPORT,
      respond: (href, request) => delivery.respond(href, request),
      onFulfilled: (event) => delivery.onFulfilled(event),
    });
    await bootFixturePage(page, origin, { applicationReadyTimeoutMs: 180_000 });
    await foregroundSession.request(browserPid, 15_000);
    await page.evaluate(applyNativeSharpnessProfile);
    const setup = await page.evaluate(configureAustinDiagnosticFixture, fixture);
    await page.evaluate(installAustinDiagnosticObserver);
    await page.evaluate(() => window.__gevPhasedMonotonicWallClockV1?.startWarmup?.(1));
    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
    await page.evaluate(() => window.__gevPhasedMonotonicWallClockV1?.holdWarmupBoundary?.(1));
    await page.evaluate(() => window.__gevPhasedMonotonicWallClockV1?.startMeasurement?.(1));
    const samples = [];
    const started = Date.now();
    while (Date.now() - started < OBSERVATION_MS) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
      samples.push(await page.evaluate(readAustinDiagnosticObservation));
    }
    const profile = await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer;
      const canvas = viewer?.scene?.canvas;
      const globe = viewer?.scene?.globe;
      return {
        id: viewer?.__gevNativeSharpnessProfile ?? null,
        useBrowserRecommendedResolution: viewer?.useBrowserRecommendedResolution,
        resolutionScale: viewer?.resolutionScale,
        maximumScreenSpaceError: globe?.maximumScreenSpaceError,
        viewport: { width: canvas?.clientWidth, height: canvas?.clientHeight, dpr: window.devicePixelRatio },
        drawingBuffer: { width: canvas?.width, height: canvas?.height },
      };
    });
    const final = await page.evaluate(readAustinDiagnosticObservation);
    const summary = delivery.summarize({
      requiredAssetIds: [...AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS, 'installations'],
      requiredAlprTiles: AUSTIN_OPERATING_REQUIRED_ALPR_TILES.map(([z, x, y]) => ({ z, x, y })),
    });
    await page.evaluate(() => window.__gevAustinDiagnosticObserver?.dispose?.());
    return { label, appSha, browserPid, setup, profile, samples, final, delivery: summary, foreground: await foregroundSession.request(browserPid, 15_000) };
  } finally {
    try { await page?.evaluate(() => window.__gevAustinDiagnosticObserver?.dispose?.()); } catch {}
    try { delivery?.dispose?.(); } catch {}
    try { await cleanupFixturePageDiagnostics(page); } catch {}
    try { await foregroundSession?.dispose?.(); } catch {}
    try { await browser.close(); } catch {}
  }
}

export async function runAustinOperatingRenderDemandDiagnostic({ baselineUrl, candidateUrl, baselineSha, candidateSha, out }) {
  const fixture = createAustinOperatingWorkloadFixture(FIXED_TIME);
  const results = [];
  for (const side of [
    { label: 'baseline', url: baselineUrl, appSha: baselineSha },
    { label: 'candidate', url: candidateUrl, appSha: candidateSha },
  ]) results.push(await captureSide({ ...side, fixture }));
  const report = {
    schema: 'gev-austin-operating-render-demand-diagnostic/v1',
    status: 'diagnostic-non-comparable',
    comparable: false,
    fixture: { id: fixture.id, sha256: fixture.sha256, fixedTime: FIXED_TIME, route: fixture.route, visualState: fixture.visualState },
    timing: { warmupMs: WARMUP_MS, observationMs: OBSERVATION_MS, sampleMs: SAMPLE_MS },
    identities: { baselineCommit: baselineSha ?? null, candidateCommit: candidateSha ?? null, diagnosticHarnessCommit: gitSha(), scriptSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))) },
    sides: results,
  };
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  runAustinOperatingRenderDemandDiagnostic({
    baselineUrl: args['baseline-url'],
    candidateUrl: args['candidate-url'],
    baselineSha: args['baseline-sha'] ?? 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256',
    candidateSha: args['candidate-sha'] ?? '19065997a3f6360d68cb9ed5b389c4754856b596',
    out: args.out,
  }).catch((error) => {
    process.stderr.write(`${boundedError(error).message}\n`);
    process.exitCode = 1;
  });
}
