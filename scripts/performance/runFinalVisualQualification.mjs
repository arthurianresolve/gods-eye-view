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
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  prepareFixturePage,
} from '../../scripts/qa-application-fixtures.mjs';
import { captureCctvFixtureResponse as captureFixtureResponse } from './cctvFixtureResponse.mjs';
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
  validateFinalVisualQualification,
} from './finalVisualQualification.mjs';
import { createWindowsForegroundActivationSession } from './windowsForegroundWindow.mjs';
import { verifyServedBuildAssets } from './buildProvenance.mjs';
import { assertNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';
import { installFrozenWallClock } from './productionFlightFixture.mjs';
import {
  activateQualificationCctvInPage,
  readQualificationStateInPage,
  readVisualSnapshotPhaseInPage,
  isVisualSnapshotReadyToPause,
  describeVisualPauseReadiness,
  requestVisualGuardFrame,
  isReleasedVisualGuardTimeout,
  waitForVisualReadinessInPage,
} from './finalVisualQualificationState.mjs';
import { captureWithDebuggerPause } from './debuggerPausedCapture.mjs';
import {
  createVisualPaintSnapshotReader,
  assertVisualPaintSignature,
} from './visualPaintSignature.mjs';
import { VISIBLE_CONTROL_VARIANCE_POLICY } from './visibleControlVariance.mjs';
import {
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';
import {
  installVisualPresentationBoundaryInPage,
  disposeVisualPresentationBoundaryInPage,
  setExpectedLogoGazeInPage,
  presentationStayedSettled,
  visualReadinessInputsMatch,
} from './visualPresentationBoundary.mjs';
import {
  CANONICAL_POINTER_HISTORY,
  acquireCanonicalPointerHistory,
  assertCanonicalPointerHistory,
  createCanonicalPointerSnapshotReader,
  disposeCanonicalPointerHistoryInPage,
} from './canonicalPointerHistory.mjs';
import {
  FULL_EXTENT_POINTER_SWEEP_POLICY,
  acquireFullExtentPointerSweep,
  assertFullExtentCanonicalContinuity,
  createFullExtentPointerSweepSnapshotReader,
  disposeFullExtentPointerSweepInPage,
} from './fullExtentPointerSweep.mjs';
import {
  DECORATION_QUANTIZATION_POLICY,
  DECORATION_SOURCE_FILES,
  createDecorationQuantizationPlan,
  assertDecorationCaptureProof,
  assertDecorationBoundaryPair,
} from './decorationQuantization.mjs';
import {
  createDecorationSnapshotReader,
  createDecorationFontReader,
  retainDecorationFailureEvidence,
} from './decorationCaptureProof.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 0,
});
const CAPTURE_POINTER = Object.freeze({ x: 1, y: 1 });
const QUALIFICATION_VIEW = Object.freeze({
  longitude: -97.7431,
  latitude: 30.2672,
  heightM: 2000,
  headingRadians: 0,
  pitchRadians: -Math.PI / 2,
  rollRadians: 0,
  autoHop: false,
});
const FIXED_TIME_MS = Date.parse('2026-10-08T12:00:00.000Z');
const STATES = Object.freeze([
  'still-settled',
  'hud-visible',
  'hud-hidden',
  'hud-restored',
]);
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function installQualificationRandom(seed = 0x51a7e) {
  let state = seed >>> 0;
  Math.random = () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 0x100000000;
  };
}

function usage() {
  throw new Error(
    'Usage: node runFinalVisualQualification.mjs --baseline-url URL --candidate-url URL --baseline-app-sha SHA --candidate-app-sha SHA --harness-sha SHA --visual-harness-root DIR --visual-harness-sha SHA --baseline-receipt FILE --candidate-receipt FILE --baseline-checkout DIR --candidate-checkout DIR --harness-root DIR --baseline-build DIR --candidate-build DIR --out DIR',
  );
}

export function parseFinalVisualQualificationArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) usage();
    result[key.slice(2)] = argv[++i];
  }
  for (const key of [
    'baseline-url',
    'candidate-url',
    'baseline-app-sha',
    'candidate-app-sha',
    'harness-sha',
    'visual-harness-sha',
    'baseline-receipt',
    'candidate-receipt',
    'baseline-checkout',
    'candidate-checkout',
    'harness-root',
    'visual-harness-root',
    'baseline-build',
    'candidate-build',
    'out',
  ])
    if (!result[key]) usage();
  for (const key of [
    'baseline-app-sha',
    'candidate-app-sha',
    'harness-sha',
    'visual-harness-sha',
  ])
    if (!SHA1.test(result[key]))
      throw new Error(`${key} must be a full Git SHA.`);
  if (
    result['baseline-app-sha'].toLowerCase() ===
    result['candidate-app-sha'].toLowerCase()
  )
    throw new Error(
      'Baseline and candidate application revisions must differ.',
    );
  if (result['full-extent-timeout-ms'] !== undefined) {
    const timeoutMs = Number(result['full-extent-timeout-ms']);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000)
      throw new Error(
        'full-extent-timeout-ms must be an integer from 100 to 15000.',
      );
  }
  return result;
}

async function readReceipt(filename) {
  const receipt = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (
    !SHA256.test(receipt?.receiptSha256 || '') ||
    !Array.isArray(receipt.assets) ||
    !receipt.assets.length
  )
    throw new Error(`Receipt is incomplete: ${filename}`);
  return receipt;
}

async function verifyReceipt({
  receipt,
  checkout,
  build,
  harnessRoot,
  harnessSha,
  appSha,
  baseUrl,
}) {
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

async function observedState(page, profile, appSha) {
  const checkpoint = await page.evaluate(readCctvLifecycleCheckpointInPage, {
    includeRenderer: true,
    fixtureView: QUALIFICATION_VIEW,
  });
  const state = await page.evaluate(readQualificationStateInPage, {
    checkpointValue: checkpoint,
    profileValue: profile,
  });
  if (
    !state.checkpoint?.cameraPose ||
    !state.checkpoint?.cameraView?.containsFixture
  )
    throw new Error('CCTV checkpoint does not prove the declared camera pose.');
  if (state.checkpoint.appCommit !== appSha)
    throw new Error(
      'CCTV checkpoint application commit differs from the requested side.',
    );
  if (!Number.isInteger(state.populations.cctv) || state.populations.cctv < 1)
    throw new Error('CCTV population is empty.');
  if (
    state.settings.qualityMode !== 'manual' ||
    state.settings.densityPct !== 75
  )
    throw new Error('Manual quality or 75% density is not observed.');
  if (state.hud.mode === null || typeof state.hud.visible !== 'boolean')
    throw new Error('HUD accessibility/visibility state is unavailable.');
  if (
    !state.visualState ||
    state.visualState.hud?.visible !== state.hud.visible
  )
    throw new Error(
      'HUD visual state is not synchronized with its accessible state.',
    );
  const camera = state.checkpoint.cameras.find(
    (item) => item.id === state.checkpoint.activeCameraId,
  );
  if (
    camera?.decodeStatus !== 'ok' ||
    !Number.isFinite(camera.decodeLastSuccessAt)
  )
    throw new Error(
      'CCTV still image decode is not observed for the active camera.',
    );
  if (state.timestampMs !== FIXED_TIME_MS)
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
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
        dpr: window.devicePixelRatio,
      },
      drawingBuffer: { width: canvas.width, height: canvas.height },
    };
  });
  assertNativeSharpnessProfile(
    { environment: { nativeSharpnessProfile: profile } },
    'visual capture',
  );
  return profile;
}
function boundedError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || error)
      .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
      .slice(0, 500),
    ...(error?.pauseDiagnostics
      ? {
          pauseDiagnostics: error.pauseDiagnostics,
          pauseCleanup: error.pauseCleanup,
        }
      : {}),
  };
}

async function deadline(operation, label, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} deadline exceeded.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function savePartial(out, name, report, primaryError) {
  try {
    await fs.writeFile(
      path.join(out, name),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    (primaryError.reportErrors ||= []).push(boundedError(error));
  }
}

async function captureRevision({
  label,
  url,
  appSha,
  receipt,
  out,
  decoration = false,
  fullExtentTimeoutMs = 5000,
}) {
  const fixture = createCctvLifecycleFixture();
  let browser;
  let context;
  let page;
  let prepared;
  let foregroundSession;
  let decorationFontReader;
  let failure = null;
  let stage = 'launch';
  let states = [];
  const teardown = {
    browserClosed: false,
    pageClose: null,
    browserClose: null,
    errors: [],
  };
  const frameDelivery = { count: 0, sha256: null, matchesFixture: false };
  let result = null;
  let observedProfile = null;
  let activation = null;
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        (await puppeteer.executablePath()),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: null,
    });
    const browserPid = browser.process()?.pid;
    if (!Number.isSafeInteger(browserPid))
      throw new Error('Browser PID unavailable for foreground proof.');
    foregroundSession = createWindowsForegroundActivationSession({
      browserPid,
    });
    await foregroundSession.start({ timeoutMs: 15_000 });
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.bringToFront();
    await foregroundSession.request(browserPid, 15_000);
    stage = 'fixture-boot';
    await page.evaluateOnNewDocument(installFrozenWallClock, FIXED_TIME_MS);
    await page.evaluateOnNewDocument(installQualificationRandom, 0x51a7e);
    prepared = await prepareFixturePage(browser, new URL(url).origin, {
      page,
      viewport: VIEWPORT,
      respond: (requestUrl) =>
        captureFixtureResponse(fixture, requestUrl, new URL(url).origin),
      onFulfilled({ url: requestUrl, status, bodyBase64 }) {
        const delivered = new URL(requestUrl);
        if (
          delivered.origin !== new URL(url).origin ||
          delivered.pathname !== `/api/cctv/frame/${fixture.cameraId}`
        )
          return;
        const digest = createHash('sha256')
          .update(Buffer.from(bodyBase64, 'base64'))
          .digest('hex');
        frameDelivery.count++;
        frameDelivery.sha256 = digest;
        frameDelivery.matchesFixture =
          status === 200 && digest === fixture.frameSha256;
      },
    });
    await bootFixturePage(page, new URL(url).origin, {
      hash: cctvLifecycleShareHash(QUALIFICATION_VIEW),
      applicationReadyTimeoutMs: 180_000,
    });
    await page.evaluate(applyNativeSharpnessProfile);
    stage = 'fixture-configuration';
    await page.evaluate(configureCctvLifecycleSceneInPage, QUALIFICATION_VIEW);
    await page.evaluate(async () => {
      const manager = window.__godsEyeView?.dataManager;
      const style = window.__godsEyeView?.styleManager;
      if (!manager?.restoreEnabledLayerIds)
        throw new Error('Layer lifecycle API unavailable.');
      style?._adaptiveQuality?.rememberManualDensity?.(75);
      style?.setDetection?.({ enabled: true, mode: 'DENSE', densityPct: 75 });
      await manager.restoreEnabledLayerIds([], { origin: 'qa-final-visual' });
    });
    stage = 'surface-before-activation';
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer?.scene?.globe?.tilesLoaded === true,
      { timeout: 15_000, polling: 100 },
    );
    const completedSurfaceRender = await page.evaluate(
      waitForCctvLifecycleRenderInPage,
      15_000,
    );
    activation = {
      completedSurfaceRender,
      ...(await page.evaluate(
        activateQualificationCctvInPage,
        fixture.cameraId,
      )),
    };
    stage = 'capture-states';
    await page.waitForFunction(
      () => {
        const module =
          window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
        const camera = module
          ?.getUIState?.()
          ?.cameras?.find((item) => item.active);
        return (
          camera?.id === 'qa-cctv-lifecycle-camera-001' &&
          camera.decodeStatus === 'ok' &&
          Number.isFinite(camera.decodeLastSuccessAt)
        );
      },
      { timeout: 15_000, polling: 100 },
    );
    if (!frameDelivery.matchesFixture)
      throw new Error('Decoded camera has no verified fixture-frame delivery.');
    if (decoration)
      decorationFontReader = await createDecorationFontReader(page);
    await page.evaluate(installVisualPresentationBoundaryInPage);
    for (const id of STATES) {
      stage = id;
      if (id !== 'hud-hidden') {
        const result = await page.evaluate(() =>
          window.__godsEyeView?.styleManager?.setHudVisible?.('on'),
        );
        if (!result?.ok || result.visible !== true)
          throw new Error(`HUD visible state failed: ${id}`);
      } else if (id === 'hud-hidden') {
        const result = await page.evaluate(() =>
          window.__godsEyeView?.styleManager?.setHudVisible?.('off'),
        );
        if (!result?.ok || result.visible !== false)
          throw new Error('HUD hidden state failed.');
      }
      const foregroundReply = await foregroundSession.request(
        browserPid,
        15_000,
      );
      let foreground;
      try {
        foreground = JSON.parse(foregroundReply.stdout);
      } catch (error) {
        throw new Error(`Foreground proof was not valid JSON for ${id}.`, {
          cause: error,
        });
      }
      if (
        foreground.foregroundConfirmed !== true ||
        foreground.foregroundPid !== browserPid ||
        foreground.status !== 'foreground-confirmed'
      )
        throw new Error(`Foreground proof failed for ${id}.`);
      let pointerHistory;
      let fullExtentPointerSweep;
      try {
        fullExtentPointerSweep = await acquireFullExtentPointerSweep(page, {
          timeoutMs: fullExtentTimeoutMs,
        });
        pointerHistory = await acquireCanonicalPointerHistory(page, {
          capturePointer: CAPTURE_POINTER,
        });
        assertFullExtentCanonicalContinuity(
          fullExtentPointerSweep,
          pointerHistory,
        );
      } catch (error) {
        states.push({
          id,
          captureFailed: true,
          pointerHistory: error.pointerHistory || null,
          fullExtentPointerSweep:
            error.fullExtentPointerSweep || fullExtentPointerSweep || null,
        });
        throw error;
      }
      const expectedLogos = pointerHistory.contract.stages[2].logos;
      await page.evaluate(setExpectedLogoGazeInPage, {
        pointer: CAPTURE_POINTER,
        logos: expectedLogos,
      });
      if (!expectedLogos.length)
        throw new Error(`No visible gaze logo was observed for ${id}.`);
      const attempts = [];
      let accepted = null;
      let pngCount = 0;
      for (let attempt = 1; attempt <= 12 && pngCount < 3; attempt++) {
        // Finish the structural observations before waiting for the brief HUD
        // phase. CDP round trips after readiness can outlast the REC indicator's
        // visible interval; only the guarded pause/capture follows readiness.
        const profile = await readNativeProfile(page);
        observedProfile = profile;
        const observed = await observedState(page, profile, appSha);
        if (
          observed.checkpoint.activeCameraId !== fixture.cameraId ||
          observed.cctvParams?.selectedCameraId !== fixture.cameraId ||
          observed.cctvParams?.showProjection !== true ||
          (observed.cctvDiagnostics?.entities || 0) < 1
        )
          throw new Error(
            'Observed scene lacks a selected, materialized CCTV still projection.',
          );
        await page.waitForFunction(
          (expectedHudVisible) => {
            const proof = window.__gevVisualPresentationBoundary?.read();
            return (
              proof?.recordingVisible === true &&
              proof?.hudVisible === expectedHudVisible &&
              proof?.hudDisplay !== 'none' &&
              proof?.hudVisibility ===
                (expectedHudVisible ? 'visible' : 'hidden') &&
              Number.isFinite(proof?.hudOpacity) &&
              (expectedHudVisible
                ? proof.hudOpacity >= 0.999
                : proof.hudOpacity <= 0.001) &&
              proof.summaryTypingComplete &&
              proof.summary.length > 0 &&
              proof.documentVisible &&
              proof.documentFocused &&
              document.fonts.status === 'loaded' &&
              window.__godsEyeView?.viewer?.scene?.globe?.tilesLoaded === true
            );
          },
          { polling: 25, timeout: 15_000 },
          id !== 'hud-hidden',
        );
        const readiness = await page.evaluate(waitForVisualReadinessInPage, {
          expectedHudVisible: id !== 'hud-hidden',
          pointer: CAPTURE_POINTER,
          timeoutMs: 5000,
          stableRenders: 2,
        });
        if (readiness.status !== 'ready') {
          attempts.push({
            attempt,
            accepted: false,
            reason: readiness.reason || 'visual-readiness-unavailable',
            readiness,
          });
          continue;
        }
        const completedRender = readiness.completedRender;
        if (readiness.proof?.gaze?.status !== 'ready') {
          attempts.push({
            attempt,
            accepted: false,
            reason: 'logo-gaze-not-settled',
            gaze: readiness.proof?.gaze || null,
            readiness,
          });
          continue;
        }
        const expectedHudVisible = id !== 'hud-hidden';
        let pausedCapture;
        let decorationFontsBefore;
        let decorationFontsAfter;
        let decorationReadBefore;
        let decorationPaintBefore;
        let snapshotReader = createFullExtentPointerSweepSnapshotReader(
          createCanonicalPointerSnapshotReader(
            createVisualPaintSnapshotReader(readVisualSnapshotPhaseInPage),
          ),
        );
        if (decoration)
          snapshotReader = createDecorationSnapshotReader(snapshotReader);
        const pngCountBeforeCapture = pngCount;
        try {
          pausedCapture = await captureWithDebuggerPause({
            page,
            readCallback: snapshotReader,
            // The atomic guard needs only the scanline and HUD state. Paint,
            // pointer and decoration proofs are read after the debugger pauses;
            // repeating them on every phase-2 poll can consume the deadline.
            guardReadCallback: readVisualSnapshotPhaseInPage,
            readCallbackArgs: { expectedHudVisible },
            pauseWhen: isVisualSnapshotReadyToPause,
            describeGuardFailure: describeVisualPauseReadiness,
            requestNextGuardFrame: requestVisualGuardFrame,
            screenshot: async (readBefore) => {
              decorationReadBefore = readBefore?.decoration;
              decorationPaintBefore = readBefore?.paint;
              assertCanonicalPointerHistory(readBefore?.pointerHistory);
              assertFullExtentCanonicalContinuity(
                readBefore?.fullExtentPointerSweep,
                readBefore.pointerHistory,
              );
              assert.deepEqual(
                readBefore.fullExtentPointerSweep,
                fullExtentPointerSweep,
              );
              assert.deepEqual(
                readBefore.pointerHistory,
                pointerHistory,
                'Canonical pointer history changed after acquisition',
              );
              const settled = presentationStayedSettled(
                readBefore?.hud,
                readBefore?.hud,
                expectedHudVisible,
              );
              if (
                readBefore?.phase !== 0 ||
                !settled ||
                !visualReadinessInputsMatch(
                  readiness.proof,
                  readBefore?.hud,
                  CAPTURE_POINTER,
                )
              )
                return null;
              if (decoration) {
                decorationFontsBefore = await decorationFontReader.read(
                  readBefore.decoration,
                );
                assertDecorationCaptureProof(
                  readBefore.decoration,
                  decorationFontsBefore,
                  readBefore.paint,
                );
              }
              pngCount++;
              const image = await captureQualificationPng(
                page,
                path.join(out, `${id}-${label}-attempt-${pngCount}.png`),
              );
              if (decoration) {
                decorationFontsAfter = await decorationFontReader.read(
                  readBefore.decoration,
                );
                assert.deepEqual(
                  decorationFontsAfter,
                  decorationFontsBefore,
                  'Actual platform fonts changed across screenshot',
                );
              }
              return image;
            },
          });
        } catch (error) {
          const readinessUnavailable = isReleasedVisualGuardTimeout(
            error,
            pngCountBeforeCapture,
            pngCount,
          );
          attempts.push({
            attempt,
            accepted: false,
            reason: readinessUnavailable
              ? 'visual-pause-readiness-timeout'
              : null,
            error: boundedError(error),
            ...(decorationReadBefore
              ? {
                  decorationFailure: retainDecorationFailureEvidence({
                    before: decorationReadBefore,
                    fontsBefore: decorationFontsBefore,
                    fontsAfter: decorationFontsAfter,
                    paintBefore: decorationPaintBefore,
                  }),
                }
              : {}),
          });
          if (readinessUnavailable) continue;
          states.push({ id, captureFailed: true, presentation: { attempts } });
          throw error;
        }
        const before = pausedCapture.readBefore?.hud;
        const after = pausedCapture.readAfter?.hud;
        const beforePhase = pausedCapture.readBefore?.phase;
        const afterPhase = pausedCapture.readAfter?.phase;
        try {
          assertCanonicalPointerHistory(
            pausedCapture.readAfter?.pointerHistory,
          );
          assertFullExtentCanonicalContinuity(
            pausedCapture.readAfter?.fullExtentPointerSweep,
            pausedCapture.readAfter.pointerHistory,
          );
          assert.deepEqual(
            pausedCapture.readBefore.fullExtentPointerSweep,
            pausedCapture.readAfter.fullExtentPointerSweep,
          );
          assert.deepEqual(
            pausedCapture.readBefore.pointerHistory,
            pausedCapture.readAfter.pointerHistory,
            'Canonical pointer history changed during capture',
          );
          assertVisualPaintSignature(pausedCapture.readBefore?.paint);
          assertVisualPaintSignature(pausedCapture.readAfter?.paint);
          assert.deepEqual(
            pausedCapture.readBefore.paint,
            pausedCapture.readAfter.paint,
            'Header paint inputs changed during the paused screenshot',
          );
          if (decoration && pausedCapture.screenshot)
            assertDecorationBoundaryPair(
              {
                before: pausedCapture.readBefore.decoration,
                after: pausedCapture.readAfter.decoration,
                fontsBefore: decorationFontsBefore,
                fontsAfter: decorationFontsAfter,
              },
              {
                before: pausedCapture.readBefore.paint,
                after: pausedCapture.readAfter.paint,
              },
            );
        } catch (error) {
          attempts.push({
            attempt,
            accepted: false,
            error: boundedError(error),
            image: pausedCapture.screenshot,
            ...(decoration
              ? {
                  decorationFailure: retainDecorationFailureEvidence({
                    before: pausedCapture.readBefore?.decoration,
                    after: pausedCapture.readAfter?.decoration,
                    fontsBefore: decorationFontsBefore,
                    fontsAfter: decorationFontsAfter,
                    paintBefore: pausedCapture.readBefore?.paint,
                    paintAfter: pausedCapture.readAfter?.paint,
                  }),
                }
              : {}),
            cleanup: pausedCapture.cleanup,
            paint: {
              before: pausedCapture.readBefore?.paint,
              after: pausedCapture.readAfter?.paint,
            },
          });
          states.push({ id, captureFailed: true, presentation: { attempts } });
          throw error;
        }
        const readinessInputsAtCapture = visualReadinessInputsMatch(
          readiness.proof,
          before,
          CAPTURE_POINTER,
        );
        const unchanged =
          Boolean(pausedCapture.screenshot) &&
          beforePhase === 0 &&
          afterPhase === 0 &&
          presentationStayedSettled(before, after, expectedHudVisible) &&
          readinessInputsAtCapture &&
          visualReadinessInputsMatch(readiness.proof, after, CAPTURE_POINTER);
        const attemptReason = unchanged
          ? null
          : !pausedCapture.screenshot
            ? pausedCapture.readBefore?.reason ||
              (beforePhase !== 0
                ? 'scanline-phase-not-zero'
                : !readinessInputsAtCapture
                  ? 'scroll-layout-or-pointer-changed-after-readiness'
                  : 'presentation-not-settled-before-screenshot')
            : afterPhase !== 0
              ? 'scanline-phase-changed-during-capture'
              : !presentationStayedSettled(before, after, expectedHudVisible) ||
                  !visualReadinessInputsMatch(
                    readiness.proof,
                    after,
                    CAPTURE_POINTER,
                  )
                ? 'presentation-or-scroll-layout-changed-during-capture'
                : 'capture-not-accepted';
        attempts.push({
          attempt,
          before,
          after,
          pause: pausedCapture.pause,
          phaseBefore: beforePhase,
          phaseAfter: afterPhase,
          paint: {
            before: pausedCapture.readBefore.paint,
            after: pausedCapture.readAfter.paint,
          },
          ...(decoration
            ? {
                decoration: {
                  before: pausedCapture.readBefore.decoration,
                  after: pausedCapture.readAfter.decoration,
                  fontsBefore: decorationFontsBefore,
                  fontsAfter: decorationFontsAfter,
                },
              }
            : {}),
          phaseDimensions: {
            before: pausedCapture.readBefore?.dimensions,
            after: pausedCapture.readAfter?.dimensions,
          },
          alphaRows: {
            before: pausedCapture.readBefore?.alphaRows,
            after: pausedCapture.readAfter?.alphaRows,
          },
          cleanup: pausedCapture.cleanup,
          reason: attemptReason,
          accepted: unchanged,
          readiness: {
            status: readiness.status,
            consecutiveStableRenders: readiness.consecutiveStableRenders,
            completedRenders: readiness.completedRenders,
            proof: readiness.proof,
          },
          image: pausedCapture.screenshot,
        });
        if (!unchanged) continue;
        accepted = {
          id,
          completedRender,
          readiness: {
            status: readiness.status,
            consecutiveStableRenders: readiness.consecutiveStableRenders,
            completedRenders: readiness.completedRenders,
            proof: readiness.proof,
          },
          foreground,
          captureMethod: 'debugger-paused-snapshot',
          pointerHistory: {
            acquisition: pointerHistory,
            before: pausedCapture.readBefore.pointerHistory,
            after: pausedCapture.readAfter.pointerHistory,
          },
          fullExtentPointerSweep: {
            acquisition: fullExtentPointerSweep,
            before: pausedCapture.readBefore.fullExtentPointerSweep,
            after: pausedCapture.readAfter.fullExtentPointerSweep,
          },
          pauseCleanup: pausedCapture.cleanup,
          pause: pausedCapture.pause,
          phase: {
            before: beforePhase,
            after: afterPhase,
            dimensions: {
              before: pausedCapture.readBefore?.dimensions,
              after: pausedCapture.readAfter?.dimensions,
            },
            alphaRows: {
              before: pausedCapture.readBefore?.alphaRows,
              after: pausedCapture.readAfter?.alphaRows,
            },
          },
          ...observed,
          observedStatePhase: 'pre-readiness-structural-observation',
          presentation: { before, after, attempts },
          paint: {
            before: pausedCapture.readBefore.paint,
            after: pausedCapture.readAfter.paint,
          },
          ...(decoration
            ? {
                decoration: {
                  before: pausedCapture.readBefore.decoration,
                  after: pausedCapture.readAfter.decoration,
                  fontsBefore: decorationFontsBefore,
                  fontsAfter: decorationFontsAfter,
                },
              }
            : {}),
          frameDelivery: { ...frameDelivery },
          [label]: pausedCapture.screenshot,
        };
        break;
      }
      if (!accepted) {
        states.push({ id, captureFailed: true, presentation: { attempts } });
        throw new Error(
          `No settled, phase-matched snapshot within bounded capture attempts for ${id}.`,
        );
      }
      states.push(accepted);
      await page.evaluate(disposeCanonicalPointerHistoryInPage);
      await page.evaluate(disposeFullExtentPointerSweepInPage);
    }
    stage = 'fixture-network-verification';
    const network = await prepared.verifyNetwork();
    assert.deepEqual(
      prepared.errors,
      [],
      'Visual fixture reported application errors.',
    );
    result = {
      applicationSha: appSha,
      receiptSha256: receipt.receiptSha256,
      profile: observedProfile,
      activation,
      states,
      browserPid,
      browserVersion: await browser.version(),
      network,
    };
  } catch (error) {
    failure = error;
  } finally {
    const clean = async (name, operation) => {
      try {
        await deadline(operation, name);
      } catch (error) {
        teardown.errors.push({ stage: name, ...boundedError(error) });
      }
    };
    if (decorationFontReader)
      await clean('decoration-font-session', () =>
        decorationFontReader.dispose(),
      );
    if (page && !page.isClosed())
      await clean('canonical-pointer-observer', () =>
        page.evaluate(disposeCanonicalPointerHistoryInPage),
      );
    if (page && !page.isClosed())
      await clean('full-extent-pointer-observer', () =>
        page.evaluate(disposeFullExtentPointerSweepInPage),
      );
    if (page && !page.isClosed())
      await clean('presentation-observer', () =>
        page.evaluate(disposeVisualPresentationBoundaryInPage),
      );
    if (page)
      await clean('page-diagnostics', () =>
        cleanupFixturePageDiagnostics(page),
      );
    if (prepared?.interception)
      await clean('fixture-interception-drain', async () => {
        teardown.interceptionDrain = await prepared.interception.stopAndDrain();
        if (!teardown.interceptionDrain.confirmed)
          throw new Error('Fixture interception did not drain.');
      });
    if (page && context)
      await clean('owned-page', async () => {
        teardown.pageClose = await closeOwnedRecoveryPage(page, context, 2000);
        if (
          !teardown.pageClose.closeCompleted ||
          teardown.pageClose.openPageCount !== 0
        )
          throw new Error('Owned visual page did not close.');
      });
    if (context) await clean('owned-context', () => context.close());
    if (prepared?.interception)
      await clean('fixture-interception-release', async () => {
        teardown.interceptionRelease =
          await prepared.interception.releaseSession({
            targetClosed: page?.isClosed() === true,
          });
        if (!teardown.interceptionRelease.confirmed)
          throw new Error('Fixture interception release was not confirmed.');
      });
    if (foregroundSession)
      await clean('foreground-helper', () => foregroundSession.dispose());
    if (browser) {
      try {
        teardown.browserClose = await closeRecoveryBrowser(browser, {
          timeoutMs: 5000,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        });
        teardown.browserClosed =
          teardown.browserClose.closeCompleted === true &&
          teardown.browserClose.observation?.processExit != null &&
          teardown.browserClose.forcedProcessTermination === false;
        if (!teardown.browserClosed)
          throw new Error('Owned browser shutdown was not confirmed.');
      } catch (error) {
        teardown.errors.push({
          stage: 'owned-browser',
          ...boundedError(error),
        });
      }
    }
    if (teardown.errors.length) {
      failure ||= new Error('Visual qualification teardown was not confirmed.');
      failure.cleanupErrors = teardown.errors;
    }
  }
  if (failure) {
    failure.capture = {
      label,
      stage,
      applicationSha: appSha,
      activation,
      completedStates: states,
      teardown,
    };
    await savePartial(
      out,
      `final-visual-${label}-partial.json`,
      {
        schema: 'gev-final-visual-qualification/partial-v1',
        ...failure.capture,
        error: boundedError(failure),
      },
      failure,
    );
    throw failure;
  }
  return { ...result, teardown };
}

async function produceFinalVisualQualificationInternal(
  options,
  progress,
  captureOnly = false,
) {
  const decoration =
    options['raster-policy'] === DECORATION_QUANTIZATION_POLICY;
  assert.ok(
    !decoration || captureOnly,
    'Decoration qualification requires the predeclared six-document batch',
  );
  if (captureOnly) {
    assert.match(
      options.repeatedControlPlan?.planSha256 || '',
      /^[a-f0-9]{64}$/,
    );
    assert.equal(
      options.repeatedControlPlan.policy,
      decoration
        ? DECORATION_QUANTIZATION_POLICY
        : 'repeated-full-image-controls-v1',
    );
    assert.ok([1, 2, 3].includes(options.repeatedControlPlan.pairOrdinal));
  }
  if (process.platform !== 'win32')
    throw new Error('Final visual qualification requires Windows hardware.');
  const out = path.resolve(options.out);
  const visualHarnessRoot = path.resolve(options['visual-harness-root']);
  if (visualHarnessRoot !== ROOT)
    throw new Error(
      'Visual producer must execute from its declared clean checkout.',
    );
  await fs.mkdir(out, { recursive: true });
  if ((await fs.readdir(out)).length)
    throw new Error(
      'Visual evidence output must be empty; existing evidence is never overwritten.',
    );
  progress.stage = 'source-provenance';
  const actualHarnessSha = execFileSync(
    'git',
    ['-C', options['harness-root'], 'rev-parse', 'HEAD'],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  if (actualHarnessSha !== options['harness-sha'])
    throw new Error('Build harness SHA does not match its checkout.');
  if (
    execFileSync(
      'git',
      ['-C', options['harness-root'], 'status', '--porcelain'],
      { encoding: 'utf8', windowsHide: true },
    ).trim()
  )
    throw new Error('Build harness checkout must be clean.');
  const actualVisualHarnessSha = execFileSync(
    'git',
    ['-C', options['visual-harness-root'], 'rev-parse', 'HEAD'],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  if (actualVisualHarnessSha !== options['visual-harness-sha'])
    throw new Error('Visual producer SHA does not match its checkout.');
  if (
    execFileSync(
      'git',
      ['-C', options['visual-harness-root'], 'status', '--porcelain'],
      { encoding: 'utf8', windowsHide: true },
    ).trim()
  )
    throw new Error('Visual producer checkout must be clean.');
  const baselineReceipt = await readReceipt(options['baseline-receipt']);
  const candidateReceipt = await readReceipt(options['candidate-receipt']);
  progress.stage = 'served-byte-preflight';
  await verifyReceipt({
    receipt: baselineReceipt,
    checkout: options['baseline-checkout'],
    build: options['baseline-build'],
    harnessRoot: options['harness-root'],
    harnessSha: options['harness-sha'],
    appSha: options['baseline-app-sha'],
    baseUrl: options['baseline-url'],
  });
  await verifyReceipt({
    receipt: candidateReceipt,
    checkout: options['candidate-checkout'],
    build: options['candidate-build'],
    harnessRoot: options['harness-root'],
    harnessSha: options['harness-sha'],
    appSha: options['candidate-app-sha'],
    baseUrl: options['candidate-url'],
  });
  const readDecorationSources = () =>
    Object.fromEntries(
      ['baseline', 'candidate'].map((side) => {
        const files = Object.fromEntries(
          Object.keys(DECORATION_SOURCE_FILES).map((file) => {
            const bytes = execFileSync(
              'git',
              [
                '-C',
                options[`${side}-checkout`],
                'show',
                `${options[`${side}-app-sha`]}:${file}`,
              ],
              { windowsHide: true },
            );
            return [file, createHash('sha256').update(bytes).digest('hex')];
          }),
        );
        assert.deepEqual(
          files,
          DECORATION_SOURCE_FILES,
          `${side} decoration source changed`,
        );
        return [side, files];
      }),
    );
  const decorationSourceFiles = decoration ? readDecorationSources() : null;
  progress.stage = 'baseline-capture';
  const baseline = await captureRevision({
    label: 'baseline',
    url: options['baseline-url'],
    appSha: options['baseline-app-sha'],
    receipt: baselineReceipt,
    out,
    decoration,
    fullExtentTimeoutMs: Number(options['full-extent-timeout-ms'] || 5000),
  });
  progress.baseline = baseline;
  await fs.writeFile(
    path.join(out, 'baseline-observations.json'),
    `${JSON.stringify(baseline, null, 2)}\n`,
    { flag: 'wx' },
  );
  progress.stage = 'candidate-capture';
  const candidate = await captureRevision({
    label: 'candidate',
    url: options['candidate-url'],
    appSha: options['candidate-app-sha'],
    receipt: candidateReceipt,
    out,
    decoration,
    fullExtentTimeoutMs: Number(options['full-extent-timeout-ms'] || 5000),
  });
  progress.candidate = candidate;
  await fs.writeFile(
    path.join(out, 'candidate-observations.json'),
    `${JSON.stringify(candidate, null, 2)}\n`,
    { flag: 'wx' },
  );
  progress.stage = 'served-byte-postflight';
  await verifyReceipt({
    receipt: baselineReceipt,
    checkout: options['baseline-checkout'],
    build: options['baseline-build'],
    harnessRoot: options['harness-root'],
    harnessSha: options['harness-sha'],
    appSha: options['baseline-app-sha'],
    baseUrl: options['baseline-url'],
  });
  await verifyReceipt({
    receipt: candidateReceipt,
    checkout: options['candidate-checkout'],
    build: options['candidate-build'],
    harnessRoot: options['harness-root'],
    harnessSha: options['harness-sha'],
    appSha: options['candidate-app-sha'],
    baseUrl: options['candidate-url'],
  });
  if (decoration)
    assert.deepEqual(readDecorationSources(), decorationSourceFiles);
  const fixture = createCctvLifecycleFixture();
  if (
    execFileSync('git', ['-C', visualHarnessRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim() !== actualVisualHarnessSha ||
    execFileSync('git', ['-C', visualHarnessRoot, 'status', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  )
    throw new Error('Visual producer checkout changed during qualification.');
  progress.stage = 'paired-observations';
  for (let index = 0; index < STATES.length; index++) {
    const left = baseline.states[index];
    const right = candidate.states[index];
    if (
      JSON.stringify(left.camera) !== JSON.stringify(right.camera) ||
      JSON.stringify(left.populations) !== JSON.stringify(right.populations) ||
      JSON.stringify(left.profile) !== JSON.stringify(right.profile) ||
      JSON.stringify(left.settings) !== JSON.stringify(right.settings) ||
      left.observedStatePhase !== 'pre-readiness-structural-observation' ||
      right.observedStatePhase !== 'pre-readiness-structural-observation'
    )
      throw new Error(
        `Baseline/candidate observed state differs for ${STATES[index]}.`,
      );
  }
  const environment = baseline.states[0];
  if (baseline.browserVersion !== candidate.browserVersion)
    throw new Error('Baseline/candidate browser versions differ.');
  const baselineRenderer = baseline.states[0].checkpoint.renderer;
  const candidateRenderer = candidate.states[0].checkpoint.renderer;
  if (JSON.stringify(baselineRenderer) !== JSON.stringify(candidateRenderer))
    throw new Error('Baseline/candidate renderer identities differ.');
  const report = {
    schema: 'gev-final-visual-qualification/v1',
    fixture: {
      id: 'qa-cctv-still-hud-v1',
      sourceFixtureSha256: fixture.sha256,
      frameSha256: fixture.frameSha256,
      cameraId: fixture.cameraId,
      view: QUALIFICATION_VIEW,
      fixedTimeMs: FIXED_TIME_MS,
      randomSeed: 0x51a7e,
    },
    harness: {
      baselineSha: options['harness-sha'],
      candidateSha: options['harness-sha'],
      buildHarnessCommit: options['harness-sha'],
      visualHarnessCommit: options['visual-harness-sha'],
    },
    application: {
      baselineSha: baseline.applicationSha,
      candidateSha: candidate.applicationSha,
    },
    receipts: {
      baselineSha256: baseline.receiptSha256,
      candidateSha256: candidate.receiptSha256,
    },
    environment: {
      platform: process.platform,
      renderer: {
        vendor: environment.checkpoint.renderer?.vendor,
        device: environment.checkpoint.renderer?.name,
        browserVersion: baseline.browserVersion,
      },
      rendererByRevision: {
        baseline: {
          vendor: baselineRenderer.vendor,
          device: baselineRenderer.name,
          browserVersion: baseline.browserVersion,
        },
        candidate: {
          vendor: candidateRenderer.vendor,
          device: candidateRenderer.name,
          browserVersion: candidate.browserVersion,
        },
      },
      browserPid: {
        baseline: baseline.browserPid,
        candidate: candidate.browserPid,
      },
      nativeSharpnessProfile: environment.profile,
      populations: [
        { id: 'cctv', enabled: true, count: environment.populations.cctv },
      ],
      camera: { id: fixture.cameraId, ...environment.camera },
      foregroundConfirmed:
        baseline.states.every(
          (state) => state.foreground.foregroundConfirmed === true,
        ) &&
        candidate.states.every(
          (state) => state.foreground.foregroundConfirmed === true,
        ),
    },
    masks: [],
    rasterPolicy: captureOnly
      ? decoration
        ? DECORATION_QUANTIZATION_POLICY
        : 'repeated-full-image-controls-v1'
      : VISIBLE_CONTROL_VARIANCE_POLICY,
    ...(decoration
      ? {
          decorationQuantization: createDecorationQuantizationPlan(),
          decorationSourceFiles,
        }
      : {}),
    pointerHistoryPolicy: CANONICAL_POINTER_HISTORY,
    fullExtentPointerSweepPolicy: FULL_EXTENT_POINTER_SWEEP_POLICY,
    states: STATES.map((id, index) => ({
      id,
      pointerHistory: {
        baseline: baseline.states[index].pointerHistory,
        candidate: candidate.states[index].pointerHistory,
      },
      fullExtentPointerSweep: {
        baseline: baseline.states[index].fullExtentPointerSweep,
        candidate: candidate.states[index].fullExtentPointerSweep,
      },
      observedStatePhase: 'pre-readiness-structural-observation',
      completedRender: {
        baseline: baseline.states[index].completedRender,
        candidate: candidate.states[index].completedRender,
      },
      foreground: {
        baseline: baseline.states[index].foreground,
        candidate: candidate.states[index].foreground,
      },
      camera: { id: fixture.cameraId, ...baseline.states[index].camera },
      cameraByRevision: {
        baseline: baseline.states[index].camera,
        candidate: candidate.states[index].camera,
      },
      nativeSharpnessProfile: baseline.states[index].profile,
      nativeSharpnessProfileByRevision: {
        baseline: baseline.states[index].profile,
        candidate: candidate.states[index].profile,
      },
      settings: {
        baseline: baseline.states[index].settings,
        candidate: candidate.states[index].settings,
      },
      populations: {
        baseline: baseline.states[index].populations,
        candidate: candidate.states[index].populations,
      },
      hud: {
        baseline: baseline.states[index].hud,
        candidate: candidate.states[index].hud,
      },
      presentation: {
        baseline: baseline.states[index].presentation,
        candidate: candidate.states[index].presentation,
      },
      paint: {
        baseline: baseline.states[index].paint,
        candidate: candidate.states[index].paint,
      },
      ...(decoration
        ? {
            decoration: {
              baseline: baseline.states[index].decoration,
              candidate: candidate.states[index].decoration,
            },
          }
        : {}),
      captureMethod: {
        baseline: baseline.states[index].captureMethod,
        candidate: candidate.states[index].captureMethod,
      },
      phase: {
        baseline: baseline.states[index].phase,
        candidate: candidate.states[index].phase,
      },
      readiness: {
        baseline: baseline.states[index].readiness,
        candidate: candidate.states[index].readiness,
      },
      pauseCleanup: {
        baseline: baseline.states[index].pauseCleanup,
        candidate: candidate.states[index].pauseCleanup,
      },
      frameDelivery: {
        baseline: baseline.states[index].frameDelivery,
        candidate: candidate.states[index].frameDelivery,
      },
      timestampMs: {
        baseline: baseline.states[index].timestampMs,
        candidate: candidate.states[index].timestampMs,
      },
      baseline: baseline.states[index].baseline,
      candidate: candidate.states[index].candidate,
    })),
    teardown: { baseline: baseline.teardown, candidate: candidate.teardown },
    outputRoot: out,
    ...(captureOnly
      ? {
          repeatedControlPlan: options.repeatedControlPlan,
          comparisonEligible: false,
          evidenceScope: 'repeated-control-acquisition-only',
        }
      : {}),
  };
  await fs.writeFile(
    path.join(out, 'final-visual-qualification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx' },
  );
  if (captureOnly) {
    progress.stage = 'capture-complete-awaiting-repeated-control-validation';
    return report;
  }
  progress.stage = 'pixel-validation';
  const validation = await validateFinalVisualQualification(report, {
    evidenceRoot: out,
  });
  await fs.writeFile(
    path.join(out, 'validation.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
    { flag: 'wx' },
  );
  progress.stage = 'complete';
  return report;
}

async function produceWithFailureEvidence(options, captureOnly) {
  const progress = { stage: 'initialization', baseline: null, candidate: null };
  try {
    return await produceFinalVisualQualificationInternal(
      options,
      progress,
      captureOnly,
    );
  } catch (error) {
    try {
      const out = path.resolve(options.out);
      await fs.mkdir(out, { recursive: true });
      await savePartial(
        out,
        'final-visual-qualification-partial.json',
        {
          schema: 'gev-final-visual-qualification/partial-v1',
          ...progress,
          error: boundedError(error),
          failedCapture: error.capture || null,
          cleanupErrors: error.cleanupErrors || [],
        },
        error,
      );
    } catch (reportError) {
      (error.reportErrors ||= []).push(boundedError(reportError));
    }
    throw error;
  }
}

export async function produceFinalVisualQualification(options) {
  return produceWithFailureEvidence(options, false);
}

/** Acquisition only; no visual pass is emitted without the repeated consumer. */
export async function produceRepeatedVisualPairEvidence(options) {
  return produceWithFailureEvidence(options, true);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await produceFinalVisualQualification(
    parseFinalVisualQualificationArgs(process.argv),
  );
