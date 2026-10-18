#!/usr/bin/env node
/**
 * Standalone, headed producer for the narrow S65/S66 visual qualification.
 *
 * This deliberately lives beside (and does not modify) the performance matrix.
 * Each revision is served by its caller, intercepted with the existing CCTV
 * fixture, and observed through the same public app/debug APIs used by the
 * lifecycle qualification.  The output is subsequently checked by
 * finalVisualQualification.mjs.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  prepareFixturePage,
} from '../../scripts/qa-application-fixtures.mjs';
import {
  captureCctvFixtureResponse,
} from '../../scripts/qa-cctv-lifecycle.mjs';
import {
  configureCctvLifecycleSceneInPage,
  createCctvLifecycleFixture,
  cctvLifecycleShareHash,
  readCctvLifecycleCheckpointInPage,
  waitForCctvLifecycleRenderInPage,
} from './cctvLifecycle.mjs';
import { applyNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';
import {
  captureQualificationPng,
} from './finalVisualQualification.mjs';
import { focusOwnedWindowsBrowserWindow } from './windowsForegroundWindow.mjs';
import { verifyServedBuildAssets } from './buildProvenance.mjs';
import { assertNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const STATES = Object.freeze(['still-settled', 'hud-visible', 'hud-hidden', 'hud-restored']);
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function usage() {
  throw new Error(
    'Usage: node runFinalVisualQualification.mjs --baseline-url URL --candidate-url URL --baseline-app-sha SHA --candidate-app-sha SHA --harness-sha SHA --baseline-receipt FILE --candidate-receipt FILE --baseline-checkout DIR --candidate-checkout DIR --harness-root DIR --baseline-build DIR --candidate-build DIR --out DIR',
  );
}

function args(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) usage();
    result[key.slice(2)] = argv[++i];
  }
  for (const key of [
    'baseline-url', 'candidate-url', 'baseline-app-sha', 'candidate-app-sha',
    'harness-sha', 'baseline-receipt', 'candidate-receipt', 'baseline-checkout',
    'candidate-checkout', 'harness-root', 'baseline-build', 'candidate-build', 'out',
  ]) if (!result[key]) usage();
  for (const key of ['baseline-app-sha', 'candidate-app-sha', 'harness-sha'])
    if (!SHA1.test(result[key])) throw new Error(`${key} must be a full Git SHA.`);
  if (result['baseline-app-sha'].toLowerCase() === result['candidate-app-sha'].toLowerCase())
    throw new Error('Baseline and candidate application revisions must differ.');
  return result;
}

async function readReceipt(filename) {
  const receipt = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (!SHA256.test(receipt?.receiptSha256 || '') || !Array.isArray(receipt.assets) || !receipt.assets.length)
    throw new Error(`Receipt is incomplete: ${filename}`);
  return receipt;
}

async function verifyReceipt({ receipt, checkout, build, harnessRoot, harnessSha, appSha, baseUrl }) {
  return verifyServedBuildAssets({
    receipt,
    checkoutRoot: checkout,
    harnessRoot,
    buildRoot: build,
    expectedAppCommit: appSha,
    expectedHarnessCommit: harnessSha,
    baseUrl,
  });
}

async function observedState(page, profile) {
  const checkpoint = await page.evaluate(readCctvLifecycleCheckpointInPage, {
    fixtureView: {
      longitude: -97.7431, latitude: 30.2672, heightM: 25000,
      headingRadians: 0, pitchRadians: -1.2, rollRadians: 0,
    },
  });
  const state = await page.evaluate(({ checkpointValue, profileValue }) => {
    const app = window.__godsEyeView;
    const tuning = app?.styleManager?.services?.getDetectionTuning?.() || {};
    const settings = {
      qualityMode: app?.styleManager?._adaptiveQuality?.getMode?.() || null,
      densityPct: Number.isFinite(tuning.densityPct) ? tuning.densityPct : null,
      detectionMode: app?.styleManager?.services?.getDetectionMode?.() || null,
      resolutionScale: app?.viewer?.resolutionScale ?? null,
      antialias: app?.viewer?.scene?.context?._gl?.getContextAttributes?.()?.antialias ?? null,
      msaaSamples: app?.viewer?.scene?.msaaSamples ?? null,
      fxaa: app?.viewer?.scene?.postProcessStages?.fxaa?.enabled ?? null,
      visualState: app?.styleManager?.getVisualState?.() || null,
    };
    const visual = app?.styleManager?.getVisualState?.() || null;
    const hud = app?.styleManager?.hud;
    const hudElement = document.getElementById('intel-hud');
    return {
      checkpoint: checkpointValue,
      settings,
      visualState: visual,
      cctvParams: app?.dataManager?.layers?.get('cctv')?.module?.getParams?.() || null,
      cctvDiagnostics: app?.dataManager?.layers?.get('cctv')?.module?.getPerformanceDiagnostics?.() || null,
      populations: {
        cctv: checkpoint.cameraCount,
        entities: checkpoint.scene.entities,
        dataSources: checkpoint.scene.dataSources,
      },
      camera: checkpoint.cameraPose,
      hud: {
        mode: hud?.getMode?.() || null,
        visible: hud?.visible === true,
        variant: hud?.getVariant?.() || null,
        ariaHidden: hudElement?.getAttribute('aria-hidden') || null,
        display: hudElement ? getComputedStyle(hudElement).display : null,
        visibility: hudElement ? getComputedStyle(hudElement).visibility : null,
      },
      timestampMs: Date.now(),
      profile: profileValue,
    };
  }, { checkpointValue: checkpoint, profileValue: profile });
  if (!state.checkpoint?.cameraPose || !state.checkpoint?.cameraView?.containsFixture)
    throw new Error('CCTV checkpoint does not prove the declared camera pose.');
  if (!Number.isInteger(state.populations.cctv) || state.populations.cctv < 1)
    throw new Error('CCTV population is empty.');
  if (state.settings.qualityMode !== 'manual' || state.settings.densityPct !== 75)
    throw new Error('Manual quality or 75% density is not observed.');
  if (state.hud.mode === null || typeof state.hud.visible !== 'boolean')
    throw new Error('HUD accessibility/visibility state is unavailable.');
  if (!state.visualState || state.visualState.hudVisible !== state.hud.visible)
    throw new Error('HUD visual state is not synchronized with its accessible state.');
  if (!Number.isSafeInteger(state.timestampMs) || state.timestampMs < Date.parse('2026-10-08T12:00:00.000Z'))
    throw new Error('Fixed qualification timestamp is unavailable.');
  return state;
}

async function readNativeProfile(page) {
  const profile = await page.evaluate(() => {
    const viewer = window.__godsEyeView?.viewer;
    const globe = viewer?.scene?.globe;
    const canvas = viewer?.scene?.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    if (!viewer || !globe || !canvas || !rect)
      throw new Error('Native profile surfaces are unavailable after render.');
    return {
      id: viewer.__gevNativeSharpnessProfile || null,
      useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
      resolutionScale: viewer.resolutionScale,
      maximumScreenSpaceError: globe.maximumScreenSpaceError,
      viewport: {
        width: Math.floor(rect.width), height: Math.floor(rect.height),
        dpr: window.devicePixelRatio,
      },
      drawingBuffer: { width: canvas.width, height: canvas.height },
    };
  });
  assertNativeSharpnessProfile({ environment: { nativeSharpnessProfile: profile } }, 'visual capture');
  return profile;
}

async function captureRevision({ label, url, appSha, receipt, checkout, build, harness, out }) {
  const fixture = createCctvLifecycleFixture();
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: null,
  });
  let page;
  let prepared;
  try {
    const context = await browser.createBrowserContext();
    page = await context.newPage();
    const clock = await page.createCDPSession();
    await clock.send('Emulation.setVirtualTimePolicy', {
      policy: 'advance',
      initialVirtualTime: Date.parse('2026-10-08T12:00:00.000Z'),
      budget: 300_000,
    });
    prepared = await prepareFixturePage(browser, new URL(url).origin, {
      page,
      viewport: VIEWPORT,
      respond: (requestUrl) => captureCctvFixtureResponse(fixture, requestUrl, new URL(url).origin),
    });
    await bootFixturePage(page, new URL(url).origin, {
      hash: cctvLifecycleShareHash(fixture.view),
      applicationReadyTimeoutMs: 180_000,
    });
    await page.evaluate(applyNativeSharpnessProfile);
    await page.evaluate(configureCctvLifecycleSceneInPage, fixture.view);
    await page.evaluate(async () => {
      const manager = window.__godsEyeView?.dataManager;
      if (!manager?.restoreEnabledLayerIds) throw new Error('Layer lifecycle API unavailable.');
      await manager.restoreEnabledLayerIds([], { origin: 'qa-final-visual' });
      const result = await manager.setEnabled('cctv', true, { origin: 'qa-final-visual' });
      if (result === false || !manager.isEnabled('cctv')) throw new Error('CCTV could not be enabled.');
      const module = manager.layers.get('cctv')?.module;
      if (!module?.setParams)
        throw new Error('CCTV fixture camera/projection selection API is unavailable.');
      module.setParams({ selectedCameraId: 'qa-cctv-lifecycle-camera-001', showProjection: true, autoHop: false });
      const params = module.getParams?.();
      if (params?.selectedCameraId !== 'qa-cctv-lifecycle-camera-001' || params.showProjection !== true)
        throw new Error('CCTV fixture still projection did not settle selected.');
    });
    const browserPid = browser.process()?.pid;
    if (!Number.isSafeInteger(browserPid)) throw new Error('Browser PID unavailable for foreground proof.');
    const foreground = await focusOwnedWindowsBrowserWindow({ browserPid, enabled: true });
    if (foreground.foregroundConfirmed !== true) throw new Error('Foreground proof failed.');
    const states = [];
    for (const id of STATES) {
      if (id === 'hud-visible' || id === 'hud-restored') {
        const result = await page.evaluate(() => window.__godsEyeView?.styleManager?.setHudVisible?.('on'));
        if (!result?.ok || result.visible !== true) throw new Error(`HUD visible state failed: ${id}`);
      } else if (id === 'hud-hidden') {
        const result = await page.evaluate(() => window.__godsEyeView?.styleManager?.setHudVisible?.('off'));
        if (!result?.ok || result.visible !== false) throw new Error('HUD hidden state failed.');
      }
      const completedRender = await page.evaluate(waitForCctvLifecycleRenderInPage, 15_000);
      const profile = await readNativeProfile(page);
      const observed = await observedState(page, profile);
      if (observed.checkpoint.activeCameraId !== fixture.cameraId || observed.cctvParams?.selectedCameraId !== fixture.cameraId || observed.cctvParams?.showProjection !== true || (observed.cctvDiagnostics?.entities || 0) < 1)
        throw new Error('Completed render lacks a selected, materialized CCTV still projection.');
      const png = await captureQualificationPng(page, path.join(out, `${id}-${label}.png`));
      states.push({ id, completedRender, foreground, ...observed, [label]: png });
    }
    return { applicationSha: appSha, receiptSha256: receipt.receiptSha256, profile, states, browserClosed: false };
  } finally {
    if (page) await cleanupFixturePageDiagnostics(page).catch(() => {});
    await browser.close();
  }
}

export async function produceFinalVisualQualification(options) {
  if (process.platform !== 'win32') throw new Error('Final visual qualification requires Windows hardware.');
  const out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  const baselineReceipt = await readReceipt(options['baseline-receipt']);
  const candidateReceipt = await readReceipt(options['candidate-receipt']);
  await verifyReceipt({ receipt: baselineReceipt, checkout: options['baseline-checkout'], build: options['baseline-build'], harnessRoot: options['harness-root'], harnessSha: options['harness-sha'], appSha: options['baseline-app-sha'], baseUrl: options['baseline-url'] });
  await verifyReceipt({ receipt: candidateReceipt, checkout: options['candidate-checkout'], build: options['candidate-build'], harnessRoot: options['harness-root'], harnessSha: options['harness-sha'], appSha: options['candidate-app-sha'], baseUrl: options['candidate-url'] });
  const baseline = await captureRevision({ label: 'baseline', url: options['baseline-url'], appSha: options['baseline-app-sha'], receipt: baselineReceipt, checkout: options['baseline-checkout'], build: options['baseline-build'], harness: options['harness-root'], out });
  const candidate = await captureRevision({ label: 'candidate', url: options['candidate-url'], appSha: options['candidate-app-sha'], receipt: candidateReceipt, checkout: options['candidate-checkout'], build: options['candidate-build'], harness: options['harness-root'], out });
  for (let index = 0; index < STATES.length; index++) {
    const left = baseline.states[index];
    const right = candidate.states[index];
    if (JSON.stringify(left.camera) !== JSON.stringify(right.camera) ||
        JSON.stringify(left.populations) !== JSON.stringify(right.populations) ||
        JSON.stringify(left.profile) !== JSON.stringify(right.profile) ||
        JSON.stringify(left.settings) !== JSON.stringify(right.settings))
      throw new Error(`Baseline/candidate observed state differs for ${STATES[index]}.`);
  }
  const environment = baseline.states[0];
  const report = {
    schema: 'gev-final-visual-qualification/v1',
    harness: { baselineSha: options['harness-sha'], candidateSha: options['harness-sha'] },
    application: { baselineSha: baseline.applicationSha, candidateSha: candidate.applicationSha },
    receipts: { baselineSha256: baseline.receiptSha256, candidateSha256: candidate.receiptSha256 },
    environment: {
      platform: process.platform,
      renderer: {
        vendor: environment.checkpoint.renderer?.vendor,
        device: environment.checkpoint.renderer?.name,
      },
      nativeSharpnessProfile: environment.profile,
      populations: environment.populations,
      camera: environment.camera,
      foregroundConfirmed: true,
    },
    masks: [],
    states: STATES.map((id, index) => ({
      id,
      completedRender: { baseline: true, candidate: true, baselineFrame: baseline.states[index].completedRender.frameNumber, candidateFrame: candidate.states[index].completedRender.frameNumber },
      foreground: { baseline: true, candidate: true },
      camera: baseline.states[index].camera,
      cameraByRevision: { baseline: baseline.states[index].camera, candidate: candidate.states[index].camera },
      nativeSharpnessProfile: baseline.states[index].profile,
      nativeSharpnessProfileByRevision: { baseline: baseline.states[index].profile, candidate: candidate.states[index].profile },
      settings: { baseline: baseline.states[index].settings, candidate: candidate.states[index].settings },
      populations: { baseline: baseline.states[index].populations, candidate: candidate.states[index].populations },
      hud: { baseline: baseline.states[index].hud, candidate: candidate.states[index].hud },
      timestampMs: { baseline: baseline.states[index].timestampMs, candidate: candidate.states[index].timestampMs },
      baseline: baseline.states[index].baseline,
      candidate: candidate.states[index].candidate,
    })),
    teardown: { baseline: { browserClosed: true }, candidate: { browserClosed: true } },
    outputRoot: out,
  };
  await fs.writeFile(path.join(out, 'final-visual-qualification.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await produceFinalVisualQualification(args(process.argv));
