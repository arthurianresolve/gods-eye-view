import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSyntheticAircraftFrames } from '../src/recording/syntheticFixture.js';
import { createRenderedSoakDriver } from './qa-rendered-soak-driver.mjs';
import { createWindowsForegroundActivationSession } from './performance/windowsForegroundWindow.mjs';
import { readWeatherBalancedIdentityCapturePair } from './performance/qualificationMetrics.mjs';

const SCHEMA = 'gev-qualification-capture/v1';
const INTERACTION_SCHEMA = 'gev-interaction-latency-evidence/v3';
const INTERACTION_PROTOCOL =
  'trusted-click-activation-prerender-postrender-witness-v5';
const LOCAL_RENDER_WITNESS = 'natural-prerender-postrender-pair-v1';
const REPLAY_RENDER_WITNESS = 'natural-replay-prerender-postrender-v1';
const HEAP_SCHEMA = 'gev-sampled-heap-evidence/v1';
const WORK_PLAN = Object.freeze({
  warmupCycles: 2,
  measuredCycles: 6,
  operationsPerCycle: Object.freeze({
    sourceToggles: 8,
    replaySeeks: 1,
    imports: 1,
    workspaceReloads: 2,
    archiveFailures: 1,
    cameraRecoveries: 1,
  }),
  phaseIds: Object.freeze(['mixed-use-cycle']),
});
const SAMPLE_CADENCE_MS = 1000;
const SAMPLE_MAX_GAP_MS = 5000;
const INTERACTION_TIMEOUT_MS = 15_000;
const LOCAL_CONTROL_CAMERA_ROUTE_ID =
  'rendered-soak-driver-default-location-v1';
const LOCAL_CONTROL_CAMERA_LOCATION = Object.freeze({
  latitude: 40.7,
  longitude: -73.9,
  altitude: 1000,
});

function circularAngleDifference(left, right) {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

function cliArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1])
      throw new Error(`Expected --name value near ${key}`);
    args[key.slice(2)] = argv[index + 1];
  }
  for (const key of [
    'baseline-url',
    'candidate-url',
    'baseline-capture',
    'candidate-capture',
    'out',
  ])
    if (!args[key]) throw new Error(`Missing --${key}`);
  return args;
}

function isMain() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getCaptureIdentity(report, role) {
  const capture = report?.captures?.[0];
  const condition = capture?.conditions?.before?.environment;
  const conditionAfter = capture?.conditions?.after?.environment;
  const settingsBefore = capture?.settings?.before;
  const settingsAfter = capture?.settings?.after;
  const conditionSettingsBefore = capture?.conditions?.before?.settings;
  const conditionSettingsAfter = capture?.conditions?.after?.settings;
  const profile = condition?.nativeSharpnessProfile;
  const identity = {
    applicationCommit: report?.source?.appCommit,
    browserVersion: report?.graphics?.browserVersion,
    renderer: report?.environment?.renderer,
    userAgent: report?.environment?.userAgent,
    platform: report?.environment?.platform,
    sourceProfile: profile,
  };
  for (const [key, value] of Object.entries(identity))
    assert.ok(value != null, `${role} raw capture has no ${key}`);
  assert.match(identity.applicationCommit, /^[a-f0-9]{40}$/);
  assert.equal(profile.id, 'native-sharpness-v1');
  assert.equal(profile.resolutionScale, 1);
  assert.equal(settingsBefore?.resolutionScale, 1);
  assert.equal(settingsAfter?.resolutionScale, 1);
  assert.equal(conditionSettingsBefore?.resolutionScale, 1);
  assert.equal(conditionSettingsAfter?.resolutionScale, 1);
  assert.deepEqual(profile, settingsBefore?.nativeSharpnessProfile);
  assert.deepEqual(profile, conditionAfter?.nativeSharpnessProfile);
  assert.deepEqual(profile, settingsAfter?.nativeSharpnessProfile);
  assert.deepEqual(profile, conditionSettingsBefore?.nativeSharpnessProfile);
  assert.deepEqual(profile, conditionSettingsAfter?.nativeSharpnessProfile);
  assert.deepEqual(profile.viewport, report.environment.viewport);
  assert.deepEqual(profile.drawingBuffer, report.environment.drawingBuffer);
  assert.deepEqual(condition?.viewport, report.environment.viewport);
  assert.deepEqual(condition?.drawingBuffer, report.environment.drawingBuffer);
  assert.deepEqual(conditionAfter?.viewport, report.environment.viewport);
  assert.deepEqual(
    conditionAfter?.drawingBuffer,
    report.environment.drawingBuffer,
  );
  return identity;
}

export const QUALIFICATION_REPLAY_FIXTURE_CONTRACT = Object.freeze({
  recordingId: 'recording-rendered-soak',
  snapshotCount: 4,
  expectedRecordCount: 5,
  expectedCoverageDurationMs: 3000,
});

function fixtureIdentity() {
  const frames = createSyntheticAircraftFrames({
    startAt: 0,
    sampleCount: 4,
    intervalMs: 1000,
  });
  return {
    fixtureId: 'rendered-soak-four-snapshot-recording-v1',
    fixtureSha256: sha256(JSON.stringify(frames)),
    routeId: 'rendered-soak-local-control-and-recording-seek-v1',
    ...QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
  };
}

export function assertQualificationReplayFixtureState(state, fixture) {
  assert.equal(state?.recordingId, fixture.recordingId);
  assert.equal(state?.recordCount, fixture.expectedRecordCount);
  assert.ok(Number.isFinite(state?.coverage?.from));
  assert.ok(Number.isFinite(state?.coverage?.to));
  assert.equal(
    state.coverage.to - state.coverage.from,
    fixture.expectedCoverageDurationMs,
  );
}

async function readCapture(path, role) {
  const bytes = await readFile(path);
  const parsed = JSON.parse(bytes.toString('utf8'));
  assert.equal(
    parsed?.integrity?.status,
    'passed',
    `${role} capture integrity must pass`,
  );
  assert.equal(
    parsed?.comparisonEligible,
    true,
    `${role} capture must be comparable`,
  );
  return {
    report: parsed,
    identity: getCaptureIdentity(parsed, role),
    path: resolve(path),
    sha256: sha256(bytes),
  };
}

export function buildQualificationIdentity(expected, actual, fixture = {}) {
  assert.equal(actual.applicationCommit, expected.applicationCommit);
  assert.equal(actual.browserVersion, expected.browserVersion);
  assert.equal(actual.renderer, expected.renderer);
  assert.equal(actual.userAgent, expected.userAgent);
  assert.equal(actual.platform, expected.platform);
  assert.equal(actual.nativeSharpnessProfile.id, 'native-sharpness-v1');
  assert.equal(
    actual.nativeSharpnessProfile.useBrowserRecommendedResolution,
    false,
  );
  assert.equal(actual.nativeSharpnessProfile.resolutionScale, 1);
  assert.equal(actual.nativeSharpnessProfile.maximumScreenSpaceError, 1);
  assert.deepEqual(actual.viewport, {
    width: 1440,
    height: 1000,
    dpr: expected.sourceProfile.viewport.dpr,
  });
  assert.deepEqual(actual.drawingBuffer, {
    width: Math.floor(1440 * expected.sourceProfile.viewport.dpr),
    height: Math.floor(1000 * expected.sourceProfile.viewport.dpr),
  });
  assert.deepEqual(actual.nativeSharpnessProfile.viewport, actual.viewport);
  assert.deepEqual(
    actual.nativeSharpnessProfile.drawingBuffer,
    actual.drawingBuffer,
  );
  assert.equal(actual.settings?.qualityMode, 'manual');
  assert.equal(actual.settings?.detectionMode, 'DENSE');
  assert.equal(actual.settings?.densityPct, 75);
  assert.equal(actual.settings?.resolutionScale, 1);
  assert.equal(typeof actual.settings?.antialias, 'boolean');
  assert.ok(Number.isFinite(actual.settings?.msaaSamples));
  assert.equal(typeof actual.settings?.fxaa, 'boolean');
  return {
    applicationCommit: actual.applicationCommit,
    browserVersion: actual.browserVersion,
    renderer: actual.renderer,
    userAgent: actual.userAgent,
    platform: actual.platform,
    viewport: actual.viewport,
    drawingBuffer: actual.drawingBuffer,
    nativeSharpnessProfile: actual.nativeSharpnessProfile,
    settings: actual.settings,
    nativeSharpnessProfileAfter: actual.nativeSharpnessProfile,
    settingsAfter: actual.settings,
    ...fixture,
  };
}

function assertCycleOperations(result, label) {
  assert.deepEqual(
    result,
    WORK_PLAN.operationsPerCycle,
    `${label} actual runCycle operation counts differ from the plan`,
  );
}

export function readEffectiveMeasurementStateInPage(driverNativeEvidence) {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const scene = viewer?.scene;
  const style = app?.styleManager;
  const canvas = scene?.canvas;
  if (!viewer || !style || !canvas)
    throw new Error(
      'Qualification capture needs a live viewer and style manager.',
    );
  const tuning = style.services?.getDetectionTuning?.() || {};
  const visualState = style.getVisualState?.();
  const viewport = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    dpr: window.devicePixelRatio,
  };
  const drawingBuffer = {
    width: scene.drawingBufferWidth,
    height: scene.drawingBufferHeight,
  };
  const native = driverNativeEvidence?.initial;
  const profile = {
    id: viewer.__gevNativeSharpnessProfile || 'native-sharpness-v1',
    useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
    resolutionScale: viewer.resolutionScale,
    maximumScreenSpaceError: scene.globe?.maximumScreenSpaceError,
    viewport,
    drawingBuffer,
  };
  if (
    !visualState ||
    profile.id !== 'native-sharpness-v1' ||
    profile.useBrowserRecommendedResolution !== false ||
    profile.resolutionScale !== 1 ||
    profile.maximumScreenSpaceError !== 1 ||
    !Number.isFinite(viewport.dpr) ||
    !native ||
    !Number.isFinite(driverNativeEvidence?.observedDpr) ||
    Math.abs(driverNativeEvidence?.observedDpr - viewport.dpr) > 0.01 ||
    native.devicePixelRatio !== viewport.dpr ||
    native.canvas?.clientWidth !== viewport.width ||
    native.canvas?.clientHeight !== viewport.height ||
    native.canvas?.width !== drawingBuffer.width ||
    native.canvas?.height !== drawingBuffer.height ||
    native.sceneDrawingBuffer?.width !== drawingBuffer.width ||
    native.sceneDrawingBuffer?.height !== drawingBuffer.height ||
    native.useBrowserRecommendedResolution !== false ||
    native.resolutionScale !== 1 ||
    native.maximumScreenSpaceError !== 1 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    drawingBuffer.width !== Math.floor(viewport.width * viewport.dpr) ||
    drawingBuffer.height !== Math.floor(viewport.height * viewport.dpr)
  )
    throw new Error('Qualification capture lacks native settings evidence.');
  return {
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    viewport,
    drawingBuffer,
    nativeSharpnessProfile: profile,
    settings: {
      qualityMode: style._adaptiveQuality?.getMode?.(),
      densityPct: tuning.densityPct,
      detectionMode: style.services?.getDetectionMode?.(),
      resolutionScale: viewer.resolutionScale,
      antialias: scene.context?._gl?.getContextAttributes?.()?.antialias,
      msaaSamples: scene.msaaSamples,
      fxaa: scene.postProcessStages?.fxaa?.enabled,
      bloom: visualState.bloom?.enabled,
      bloomIntensity: visualState.bloom?.intensity,
      sharpen: visualState.sharpen?.enabled,
      sharpenIntensity: visualState.sharpen?.intensity,
      visual: {
        style: visualState.style,
        bloomEnabled: visualState.bloom?.enabled,
        bloomIntensity: visualState.bloom?.intensity,
        sharpenEnabled: visualState.sharpen?.enabled,
        sharpenIntensity: visualState.sharpen?.intensity,
        detectionMode: visualState.detection?.mode,
        detectionDensityPct: visualState.detection?.density,
        detectionAllocation: visualState.detection?.allocation,
        detectionFadePct: visualState.detection?.fadePct,
        detectionOutsideOpacityPct: visualState.detection?.outsideOpacityPct,
        scopeEnabled: visualState.scope?.enabled,
        scopeFeatherPct: visualState.scope?.featherPct,
        mapStack: visualState.mapStack,
      },
    },
  };
}

export async function readAndAssertPageForeground(page, label) {
  const state = await page.evaluate(() => ({
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
  }));
  assert.equal(state?.visibilityState, 'visible', `${label} page is hidden`);
  assert.equal(state?.focused, true, `${label} page is not focused`);
  return state;
}

export async function disposeQualificationObserver(page) {
  return page.evaluate(() => {
    const observer = window.__qualificationMetricsObserver;
    try {
      observer?.dispose();
    } finally {
      delete window.__qualificationMetricsObserver;
      delete window.__qualificationFlightWitnessReader;
    }
    return !window.__qualificationMetricsObserver;
  });
}

function readForegroundActivation(reply, browserPid) {
  const evidence = JSON.parse(reply?.stdout || 'null');
  assert.equal(
    evidence?.schema,
    'gev-windows-owned-browser-foreground-activation/v1',
  );
  assert.equal(evidence?.status, 'foreground-confirmed');
  assert.equal(evidence?.foregroundConfirmed, true);
  assert.equal(evidence?.browserPid, browserPid);
  assert.equal(evidence?.foregroundPid, browserPid);
  assert.equal(evidence?.desktopState, 'interactive');
  return evidence;
}

export function installInteractionObserverInPage(fixtureContract) {
  // This function is serialized into the page realm by Puppeteer evaluate;
  // keep its witness identifiers local so it has no module-scope closures.
  const localRenderWitnessType = 'natural-prerender-postrender-pair-v1';
  const replayRenderWitnessType = 'natural-replay-prerender-postrender-v1';
  const app = window.__godsEyeView;
  const scene = app?.viewer?.scene;
  if (
    !scene?.preRender?.addEventListener ||
    !scene?.postRender?.addEventListener
  )
    throw new Error(
      'Qualification probe needs Cesium preRender and postRender.',
    );
  const observer = {
    pending: null,
    error: null,
    generation: 0,
    disposed: false,
    armedTarget: null,
    records: [],
    removeInput: [],
    removeRender: null,
    removePreRender: null,
    removeVisibilityRequest: null,
    removeLifecycleEvent: null,
    preRenderWitness: null,
    pollTimer: null,
    pollPromise: null,
    feedbackAnimationFrame: null,
    isReplayBillboardWitness({ selectedRecord, visualWitness }) {
      return Boolean(
        selectedRecord &&
        visualWitness?.billboardVisible === true &&
        visualWitness.billboardId === selectedRecord.id &&
        Number.isFinite(visualWitness.billboardPosition?.latitude) &&
        Number.isFinite(visualWitness.billboardPosition?.longitude) &&
        Math.abs(
          visualWitness.billboardPosition.latitude - selectedRecord.latitude,
        ) <= 1e-9 &&
        Math.abs(
          visualWitness.billboardPosition.longitude - selectedRecord.longitude,
        ) <= 1e-9 &&
        Number.isFinite(visualWitness.screenPosition?.x) &&
        Number.isFinite(visualWitness.screenPosition?.y) &&
        visualWitness.screenPosition.x >= 0 &&
        visualWitness.screenPosition.y >= 0 &&
        visualWitness.screenPosition.x < visualWitness.canvas?.width &&
        visualWitness.screenPosition.y < visualWitness.canvas?.height,
      );
    },
    isReplayVisualWitness({ selectedRecord, renderedRecord, visualWitness }) {
      return Boolean(
        observer.isReplayBillboardWitness({ selectedRecord, visualWitness }) &&
        renderedRecord?.icao24 === selectedRecord.id &&
        renderedRecord.provenance?.positionObservedAtMs ===
          selectedRecord.positionTimeMs &&
        Math.abs(renderedRecord.lat - selectedRecord.latitude) <= 1e-9 &&
        Math.abs(renderedRecord.lon - selectedRecord.longitude) <= 1e-9,
      );
    },
    readLocalControlFrameState(sample, frameNumber) {
      const appNow = window.__godsEyeView;
      const button = document.querySelector(sample.selector);
      const layer = appNow.dataManager.layers.get('local-datacenters');
      const lod = layer?.module?.getLodDiagnostics?.();
      const total = Number.isInteger(lod?.total) ? lod.total : 0;
      const active = Number.isInteger(lod?.active) ? lod.active : 0;
      const enabled =
        appNow.dataManager.isEnabled('local-datacenters') === true;
      const buttonActive = button?.classList.contains('active') === true;
      const ready = sample.expected
        ? lod?.computed === true && total === 8 && active > 0
        : lod?.computed === false && total === 0 && active === 0;
      return {
        frameNumber,
        enabled,
        buttonActive,
        computed: lod?.computed === true,
        total,
        active,
        matched:
          enabled === sample.expected &&
          buttonActive === sample.expected &&
          ready,
      };
    },
    readReplayFrameState(sample, frameNumber) {
      const appNow = window.__godsEyeView;
      const state = appNow.aircraftSource.getState();
      const slider = document.querySelector(sample.selector);
      const sliderValue = Number(slider?.value);
      const targetMs =
        sample.expected === 'end' ? sample.coverageToMs : sample.coverageFromMs;
      const fixtureIndex = sample.expected === 'end' ? 3 : 0;
      const selectedRecord = {
        id: 'SYNTH-001',
        positionTimeMs: targetMs,
        latitude: Math.sin(fixtureIndex / 10) * 0.02,
        longitude:
          ((((179.7 + fixtureIndex * 0.01 + 180) % 360) + 360) % 360) - 180,
      };
      const renderedRecord = appNow.dataManager.layers
        .get('flights')
        ?.module?.getAnalystRecords?.(8)
        ?.find((record) => record.icao24 === selectedRecord.id);
      const visualWitness = window.__qualificationFlightWitnessReader?.(
        selectedRecord.id,
      );
      const stateMatches =
        state?.mode === 'recorded' &&
        state?.recordingId === fixtureContract.recordingId &&
        state?.recordCount === fixtureContract.expectedRecordCount &&
        state?.targetMs === targetMs &&
        state?.coverage?.from === sample.coverageFromMs &&
        state?.coverage?.to === sample.coverageToMs &&
        Number.isFinite(sliderValue) &&
        sliderValue !== sample.previousSliderValue &&
        selectedRecord.positionTimeMs !== sample.previousPositionTimeMs &&
        (selectedRecord.latitude !== sample.previousLatitude ||
          selectedRecord.longitude !== sample.previousLongitude);
      const renderedRecordMatches = observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord,
        visualWitness,
      });
      return {
        frameNumber,
        targetMs,
        recordingId: state?.recordingId ?? null,
        recordCount: state?.recordCount ?? null,
        sliderValue: Number.isFinite(sliderValue) ? sliderValue : null,
        selectedRecord,
        renderedRecord: renderedRecord
          ? {
              id: renderedRecord.icao24,
              positionTimeMs:
                renderedRecord.provenance?.positionObservedAtMs ?? null,
              latitude: renderedRecord.lat,
              longitude: renderedRecord.lon,
            }
          : null,
        visualWitness,
        matched: stateMatches && renderedRecordMatches,
      };
    },
    isFreshTrustedEvent(event, sample, expectedType, receivedAtMs) {
      const targetMatches =
        event.currentTarget === observer.armedTarget &&
        (event.target === observer.armedTarget ||
          observer.armedTarget?.contains?.(event.target) === true);
      return Boolean(
        event.isTrusted === true &&
        event.type === expectedType &&
        targetMatches &&
        Number.isFinite(event.timeStamp) &&
        event.timeStamp >= sample.armedAtMs &&
        event.timeStamp <= receivedAtMs,
      );
    },
    onVisibilityRequest(change) {
      const sample = observer.pending;
      const entry =
        window.__godsEyeView?.dataManager?.layers?.get?.('local-datacenters');
      if (
        observer.disposed ||
        sample?.kind !== 'localControl' ||
        sample.inputAtMs == null ||
        sample.acceptedIntentAtMs != null ||
        change?.type !== 'visibility-requested' ||
        change.layerId !== 'local-datacenters' ||
        change.enabled !== sample.expected ||
        change.origin !== 'user' ||
        !Number.isSafeInteger(change.intentEpoch) ||
        entry?.visibilityIntentEpoch !== change.intentEpoch ||
        entry.visibilityIntentEnabled !== change.enabled
      )
        return;
      sample.acceptedIntentAtMs = performance.now();
      sample.acceptedIntentEpoch = change.intentEpoch;
    },
    onVisibilityTransition(change) {
      const sample = observer.pending;
      if (
        observer.disposed ||
        sample?.kind !== 'localControl' ||
        sample.acceptedIntentEpoch == null ||
        change?.type !== 'visibility-transition' ||
        change.layerId !== 'local-datacenters' ||
        change.enabled !== sample.expected ||
        change.origin !== 'user' ||
        change.intentEpoch !== sample.acceptedIntentEpoch
      )
        return;
      sample.transitionAtMs = performance.now();
      sample.transitionIntentEpoch = change.intentEpoch;
    },
    finalizeSampleIfReady(sample) {
      if (
        observer.disposed ||
        observer.pending !== sample ||
        sample.generation !== observer.generation ||
        !sample.fullReadyFrameObserved ||
        sample.buttonFeedbackAtMs == null ||
        sample.acceptedIntentAtMs == null
      )
        return false;
      observer.records.push({ ...sample });
      if (observer.pollTimer) clearInterval(observer.pollTimer);
      observer.pollTimer = null;
      observer.pending = null;
      observer.armedTarget = null;
      observer.pollPromise = null;
      return true;
    },
    observeVisibleButtonFrame(sample, timestamp) {
      observer.feedbackAnimationFrame = null;
      if (
        observer.disposed ||
        observer.pending !== sample ||
        sample.generation !== observer.generation ||
        sample.buttonFeedbackAtMs != null
      )
        return;
      const observedAtMs = performance.now();
      if (!Number.isFinite(timestamp)) {
        sample.buttonFeedbackConsecutiveFrames = 0;
        sample.buttonFeedbackFirstFrameAtMs = null;
        sample.buttonFeedbackFirstRafTimestampMs = null;
        return;
      }
      const button = document.querySelector(sample.selector);
      const rect = button?.getBoundingClientRect?.();
      const style = button ? window.getComputedStyle(button) : null;
      const visible = Boolean(
        document.visibilityState === 'visible' &&
        document.hasFocus?.() === true &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight &&
        style?.display !== 'none' &&
        style?.visibility !== 'hidden' &&
        Number(style?.opacity) > 0 &&
        button.disabled === false &&
        typeof button.textContent === 'string' &&
        button.textContent.trim().length > 0,
      );
      const appNow = window.__godsEyeView;
      const dataManager = appNow?.dataManager;
      const entry = dataManager?.layers?.get?.('local-datacenters');
      const currentIntentMatches = Boolean(
        sample.acceptedIntentEpoch != null &&
        entry?.visibilityIntentEpoch === sample.acceptedIntentEpoch &&
        entry.visibilityIntentEnabled === sample.expected,
      );
      const transitionState = sample.expected ? 'enabling' : 'disabling';
      const transitionVisible = Boolean(
        visible &&
        currentIntentMatches &&
        sample.transitionIntentEpoch === sample.acceptedIntentEpoch &&
        button.dataset?.feedState === transitionState &&
        button.classList.contains('transitioning') &&
        button.classList.contains(transitionState) &&
        button.getAttribute('aria-busy') === 'true' &&
        button.getAttribute('aria-disabled') === 'true',
      );
      const settledVisible = Boolean(
        visible &&
        currentIntentMatches &&
        dataManager.isEnabled('local-datacenters') === sample.expected &&
        button.classList.contains('active') === sample.expected &&
        !button.classList.contains('transitioning'),
      );
      const visibleState = transitionVisible
        ? 'transition'
        : settledVisible
          ? 'settled'
          : null;
      if (visibleState) {
        if (sample.buttonFeedbackFirstState !== visibleState) {
          sample.buttonFeedbackConsecutiveFrames = 0;
          sample.buttonFeedbackFirstFrameAtMs = null;
          sample.buttonFeedbackFirstRafTimestampMs = null;
        }
        if (
          sample.buttonFeedbackFirstRafTimestampMs != null &&
          timestamp <= sample.buttonFeedbackFirstRafTimestampMs
        ) {
          sample.buttonFeedbackConsecutiveFrames = 0;
          sample.buttonFeedbackFirstFrameAtMs = null;
          sample.buttonFeedbackFirstRafTimestampMs = null;
        }
        sample.buttonFeedbackConsecutiveFrames =
          (sample.buttonFeedbackConsecutiveFrames || 0) + 1;
        sample.buttonFeedbackFirstFrameAtMs ??= observedAtMs;
        sample.buttonFeedbackFirstRafTimestampMs ??= timestamp;
        sample.buttonFeedbackFirstState = visibleState;
        if (sample.buttonFeedbackConsecutiveFrames >= 2) {
          sample.buttonFeedbackAtMs = observedAtMs;
          sample.buttonFeedbackSecondRafTimestampMs = timestamp;
          sample.buttonFeedbackState = visibleState;
          sample.buttonFeedbackIntentEpoch = entry.visibilityIntentEpoch;
          sample.buttonFeedbackTransitionAtMs =
            visibleState === 'transition' ? sample.transitionAtMs : null;
          sample.buttonFeedbackWitnessType =
            'visible-button-two-distinct-raf-v3';
          observer.finalizeSampleIfReady(sample);
          return;
        }
      } else {
        sample.buttonFeedbackConsecutiveFrames = 0;
        sample.buttonFeedbackFirstFrameAtMs = null;
        sample.buttonFeedbackFirstRafTimestampMs = null;
        sample.buttonFeedbackFirstState = null;
      }
      if (typeof requestAnimationFrame === 'function')
        observer.feedbackAnimationFrame = requestAnimationFrame(
          (nextTimestamp) =>
            observer.observeVisibleButtonFrame(sample, nextTimestamp),
        );
    },
    onEvent(event) {
      const sample = observer.pending;
      if (observer.disposed || !sample) return;
      if (sample.generation !== observer.generation) {
        observer.error =
          'Stale interaction generation received an input event.';
        return;
      }
      if (sample.inputAtMs != null) {
        observer.error =
          'Duplicate input event for an armed interaction sample.';
        return;
      }
      const receivedAtMs = performance.now();
      if (sample.kind === 'localControl' && event.type !== 'input') {
        if (
          !this.isFreshTrustedEvent(event, sample, event.type, receivedAtMs)
        ) {
          observer.error =
            'Interaction input event failed freshness validation.';
          return;
        }
        if (event.type === 'pointerdown') {
          if (sample.pointerDownAtMs != null || sample.clickAtMs != null) {
            observer.error = 'Duplicate or stale pointerdown event.';
            return;
          }
          sample.pointerDownAtMs = event.timeStamp;
          sample.pointerDownReceivedAtMs = receivedAtMs;
          return;
        }
        if (event.type === 'pointerup') {
          if (
            sample.pointerDownAtMs == null ||
            sample.pointerUpAtMs != null ||
            event.timeStamp < sample.pointerDownAtMs
          ) {
            observer.error = 'Pointerup did not follow the armed pointerdown.';
            return;
          }
          sample.pointerUpAtMs = event.timeStamp;
          sample.pointerUpReceivedAtMs = receivedAtMs;
          return;
        }
        if (
          event.type !== 'click' ||
          sample.pointerDownAtMs == null ||
          sample.pointerUpAtMs == null ||
          event.timeStamp < sample.pointerUpAtMs
        ) {
          observer.error =
            'Local control requires a fresh trusted click after pointerdown and pointerup.';
          return;
        }
      }
      const expectedType = sample.kind === 'localControl' ? 'click' : 'input';
      if (
        !this.isFreshTrustedEvent(event, sample, expectedType, receivedAtMs)
      ) {
        observer.error = 'Interaction input event failed freshness validation.';
        return;
      }
      if (sample.inputAtMs != null) {
        observer.error =
          'Duplicate input event for an armed interaction sample.';
        return;
      }
      sample.inputAtMs = event.timeStamp;
      sample.inputEventAtMs = event.timeStamp;
      sample.handlerReceivedAtMs = receivedAtMs;
      sample.inputEventType = event.type;
      sample.inputTrusted = event.isTrusted;
      sample.inputTargetMatched = true;
      sample.inputClockSource =
        sample.kind === 'localControl'
          ? 'trusted-click-event-timeStamp'
          : 'trusted-event-timeStamp';
      sample.inputDeliveryDelayMs = receivedAtMs - event.timeStamp;
      if (sample.kind === 'localControl') {
        sample.clickAtMs = event.timeStamp;
        sample.clickReceivedAtMs = receivedAtMs;
        sample.pointerDownToClickMs = event.timeStamp - sample.pointerDownAtMs;
        if (typeof requestAnimationFrame === 'function')
          observer.feedbackAnimationFrame = requestAnimationFrame((timestamp) =>
            observer.observeVisibleButtonFrame(sample, timestamp),
          );
        observer.pollPromise = observer.pollState();
        observer.pollTimer = setInterval(() => observer.pollState(), 10);
      }
    },
    async pollState() {
      const sample = observer.pending;
      const generation = observer.generation;
      const isCurrent = () =>
        !observer.disposed &&
        observer.pending === sample &&
        observer.generation === generation;
      if (
        !sample ||
        !isCurrent() ||
        sample.inputAtMs == null ||
        sample.stateAtMs != null
      )
        return;
      const appNow = window.__godsEyeView;
      let matched = false;
      if (sample.kind === 'localControl') {
        const button = document.querySelector(sample.selector);
        const layer = appNow.dataManager.layers.get('local-datacenters');
        const lod = layer?.module?.getLodDiagnostics?.();
        const materializedRecordCount = Number.isInteger(lod?.total)
          ? lod.total
          : 0;
        const renderableCount = Number.isInteger(lod?.active) ? lod.active : 0;
        const renderablesReady = sample.expected
          ? lod?.computed === true &&
            materializedRecordCount > 0 &&
            renderableCount > 0
          : materializedRecordCount === 0 &&
            renderableCount === 0 &&
            lod?.computed === false;
        matched =
          appNow.dataManager.isEnabled('local-datacenters') ===
            sample.expected &&
          button?.classList.contains('active') === sample.expected &&
          renderablesReady;
        if (matched) {
          sample.materializedRecordCount = materializedRecordCount;
          sample.renderableCount = renderableCount;
          sample.layerRenderablesObserved = renderableCount > 0;
          sample.expectedLayerEnabled = sample.expected;
          sample.layerEnabledObserved =
            appNow.dataManager.isEnabled('local-datacenters');
          sample.layerVisibleObserved = Boolean(
            button?.classList.contains('active'),
          );
        }
      } else if (sample.kind === 'loadedReplaySeek') {
        return;
      }
      if (!matched || !isCurrent()) return;
      return;
    },
    onPreRender() {
      try {
        const sample = observer.pending;
        const frameNumber = scene.frameState.frameNumber;
        const atMs = performance.now();
        const localControl =
          sample?.kind === 'localControl'
            ? observer.readLocalControlFrameState(sample, frameNumber)
            : null;
        const replay =
          sample?.kind === 'loadedReplaySeek' &&
          sample.inputAtMs != null &&
          sample.stateAtMs == null
            ? observer.readReplayFrameState(sample, frameNumber)
            : null;
        observer.preRenderWitness = {
          generation: observer.generation,
          frameNumber,
          atMs,
          localControl,
          replay,
        };
        if (
          !observer.disposed &&
          sample?.generation === observer.generation &&
          sample.inputAtMs != null &&
          sample.stateAtMs == null &&
          localControl?.matched
        ) {
          sample.materializedRecordCount = localControl.total;
          sample.renderableCount = localControl.active;
          sample.layerRenderablesObserved = localControl.active > 0;
          sample.expectedLayerEnabled = sample.expected;
          sample.layerEnabledObserved = localControl.enabled;
          sample.layerVisibleObserved = localControl.buttonActive;
          sample.stateAtMs = atMs;
          sample.frameNumberAtState = frameNumber;
        }
        if (
          !observer.disposed &&
          sample?.generation === observer.generation &&
          sample.kind === 'loadedReplaySeek' &&
          sample.inputAtMs != null &&
          sample.stateAtMs == null &&
          replay?.matched
        ) {
          const selected = replay.selectedRecord;
          const rendered = replay.renderedRecord;
          const visual = replay.visualWitness;
          sample.selectedRecordWitness = selected;
          sample.selectedSliderValue = replay.sliderValue;
          sample.selectedSourceMode = 'recorded';
          sample.fixtureAircraftId = selected.id;
          sample.fixtureAircraftLatitude = selected.latitude;
          sample.fixtureAircraftLongitude = selected.longitude;
          sample.positionTimeMs = selected.positionTimeMs;
          sample.recordingId = replay.recordingId;
          sample.fixtureRecordCount = replay.recordCount;
          sample.expectedFixtureIndex = sample.expected === 'end' ? 3 : 0;
          sample.renderedRecordPositionTimeMs = rendered.positionTimeMs;
          sample.renderedRecordLatitude = rendered.latitude;
          sample.renderedRecordLongitude = rendered.longitude;
          sample.renderedBillboardId = selected.id;
          sample.renderedBillboardLatitude = visual.billboardPosition.latitude;
          sample.renderedBillboardLongitude =
            visual.billboardPosition.longitude;
          sample.billboardScreenPosition = visual.screenPosition;
          sample.billboardCanvas = visual.canvas;
          sample.renderedBillboardVisible = visual.billboardVisible;
          sample.frameSelectedTimeMs = replay.targetMs;
          sample.framePositionTimeMs = selected.positionTimeMs;
          sample.stateAtMs = atMs;
          sample.frameNumberAtState = frameNumber;
        }
      } catch (error) {
        observer.error = error?.message || String(error);
      }
    },
    onRender() {
      const sample = observer.pending;
      const frameNumber = scene.frameState.frameNumber;
      const preRenderWitness = observer.preRenderWitness;
      if (
        observer.error ||
        !sample ||
        sample.generation !== observer.generation ||
        sample.fullReadyFrameObserved
      )
        return;
      if (sample.kind === 'localControl') {
        if (
          sample.inputAtMs == null ||
          !preRenderWitness ||
          preRenderWitness.generation !== sample.generation ||
          preRenderWitness.frameNumber !== frameNumber ||
          preRenderWitness.atMs < sample.inputAtMs ||
          !preRenderWitness.localControl?.matched ||
          preRenderWitness.localControl.frameNumber !== frameNumber ||
          sample.stateAtMs == null ||
          sample.frameNumberAtState !== frameNumber
        )
          return;
      } else if (
        sample.stateAtMs == null ||
        !observer.preRenderWitness?.replay?.matched ||
        observer.preRenderWitness.frameNumber !== frameNumber ||
        sample.frameNumberAtState !== frameNumber
      ) {
        return;
      }
      try {
        const appNow = window.__godsEyeView;
        let frameMatches = false;
        if (sample.kind === 'localControl') {
          const preRenderState = preRenderWitness.localControl;
          const postRenderState = observer.readLocalControlFrameState(
            sample,
            frameNumber,
          );
          frameMatches =
            postRenderState.matched &&
            postRenderState.enabled === preRenderState.enabled &&
            postRenderState.buttonActive === preRenderState.buttonActive &&
            postRenderState.computed === preRenderState.computed &&
            postRenderState.total === preRenderState.total &&
            postRenderState.active === preRenderState.active;
        } else if (sample.kind === 'loadedReplaySeek') {
          const preReplay = observer.preRenderWitness.replay;
          const postReplay = observer.readReplayFrameState(sample, frameNumber);
          frameMatches =
            postReplay.matched &&
            postReplay.frameNumber === preReplay.frameNumber &&
            postReplay.targetMs === preReplay.targetMs &&
            postReplay.recordingId === preReplay.recordingId &&
            postReplay.recordCount === preReplay.recordCount &&
            postReplay.sliderValue === preReplay.sliderValue &&
            postReplay.selectedRecord.positionTimeMs ===
              preReplay.selectedRecord.positionTimeMs &&
            postReplay.selectedRecord.latitude ===
              preReplay.selectedRecord.latitude &&
            postReplay.selectedRecord.longitude ===
              preReplay.selectedRecord.longitude &&
            postReplay.renderedRecord?.positionTimeMs ===
              preReplay.renderedRecord?.positionTimeMs &&
            postReplay.renderedRecord?.latitude ===
              preReplay.renderedRecord?.latitude &&
            postReplay.renderedRecord?.longitude ===
              preReplay.renderedRecord?.longitude &&
            postReplay.visualWitness?.billboardId ===
              preReplay.visualWitness?.billboardId &&
            postReplay.visualWitness?.billboardPosition?.latitude ===
              preReplay.visualWitness?.billboardPosition?.latitude &&
            postReplay.visualWitness?.billboardPosition?.longitude ===
              preReplay.visualWitness?.billboardPosition?.longitude &&
            postReplay.visualWitness?.screenPosition?.x ===
              preReplay.visualWitness?.screenPosition?.x &&
            postReplay.visualWitness?.screenPosition?.y ===
              preReplay.visualWitness?.screenPosition?.y;
          if (frameMatches) {
            sample.preRenderFrameNumber = frameNumber;
          }
        }
        if (!frameMatches) {
          if (
            sample.kind === 'localControl' &&
            observer.preRenderWitness?.localControl?.matched &&
            observer.preRenderWitness.frameNumber === frameNumber
          ) {
            sample.stateAtMs = null;
            sample.frameNumberAtState = null;
          } else if (
            sample.kind === 'loadedReplaySeek' &&
            observer.preRenderWitness?.replay?.matched &&
            observer.preRenderWitness.frameNumber === frameNumber
          ) {
            sample.stateAtMs = null;
            sample.frameNumberAtState = null;
          }
          return;
        }
        sample.preRenderFrameNumber = preRenderWitness.frameNumber;
        sample.renderWitnessType =
          sample.kind === 'localControl'
            ? localRenderWitnessType
            : replayRenderWitnessType;
        sample.renderedFrameAtMs = performance.now();
        sample.frameNumberAtRendered = frameNumber;
        if (sample.kind === 'localControl') {
          sample.fullReadyFrameObserved = true;
          observer.finalizeSampleIfReady(sample);
        } else {
          observer.records.push({ ...sample });
          if (observer.pollTimer) clearInterval(observer.pollTimer);
          observer.pollTimer = null;
          observer.pending = null;
          observer.armedTarget = null;
          observer.pollPromise = null;
        }
      } catch (error) {
        observer.error = error?.message || String(error);
      }
    },
    arm(
      kind,
      expected,
      previousTimeText,
      previousSliderValue,
      previousLatitude,
      previousLongitude,
      previousPositionTimeMs,
      coverageFromMs,
      coverageToMs,
    ) {
      if (observer.disposed)
        throw new Error('Interaction observer has been disposed.');
      if (observer.pending)
        throw new Error('Previous interaction sample is still pending.');
      const selector =
        kind === 'localControl'
          ? '[data-layer-id="local-datacenters"] .data-toggle-btn'
          : '.investigation-timeline-slider-control';
      const inputTarget = document.querySelector(selector);
      if (!inputTarget)
        throw new Error(
          `Qualification interaction control missing: ${selector}`,
        );
      observer.generation++;
      observer.pending = {
        generation: observer.generation,
        kind,
        expected,
        selector,
        armedAtMs: performance.now(),
        previousTimeText,
        previousSliderValue,
        previousLatitude,
        previousLongitude,
        previousPositionTimeMs,
        coverageFromMs,
        coverageToMs,
        inputAtMs: null,
        pointerDownAtMs: null,
        pointerUpAtMs: null,
        clickAtMs: null,
        acceptedIntentAtMs: null,
        acceptedIntentEpoch: null,
        transitionAtMs: null,
        transitionIntentEpoch: null,
        buttonFeedbackFirstFrameAtMs: null,
        buttonFeedbackFirstRafTimestampMs: null,
        buttonFeedbackSecondRafTimestampMs: null,
        buttonFeedbackAtMs: null,
        buttonFeedbackState: null,
        buttonFeedbackFirstState: null,
        buttonFeedbackIntentEpoch: null,
        buttonFeedbackTransitionAtMs: null,
        buttonFeedbackConsecutiveFrames: 0,
        stateAtMs: null,
        renderedFrameAtMs: null,
        frameNumberAtState: null,
        frameNumberAtRendered: null,
      };
      observer.armedTarget = inputTarget;
    },
    take() {
      const value = observer.records.shift();
      if (!value) throw new Error('Interaction sample is not complete.');
      return value;
    },
    dispose() {
      if (observer.disposed) return;
      observer.disposed = true;
      observer.generation++;
      for (const [node, name, listener] of observer.removeInput)
        node.removeEventListener(name, listener, true);
      observer.removeInput.length = 0;
      observer.removeRender?.();
      observer.removeRender = null;
      observer.removePreRender?.();
      observer.removePreRender = null;
      observer.removeVisibilityRequest?.();
      observer.removeVisibilityRequest = null;
      observer.removeLifecycleEvent?.();
      observer.removeLifecycleEvent = null;
      observer.preRenderWitness = null;
      if (
        observer.feedbackAnimationFrame != null &&
        typeof cancelAnimationFrame === 'function'
      )
        cancelAnimationFrame(observer.feedbackAnimationFrame);
      observer.feedbackAnimationFrame = null;
      if (observer.pollTimer) clearInterval(observer.pollTimer);
      observer.pollTimer = null;
      observer.pending = null;
      observer.armedTarget = null;
      observer.pollPromise = null;
    },
  };
  for (const [selector, name] of [
    ['[data-layer-id="local-datacenters"] .data-toggle-btn', 'pointerdown'],
    ['[data-layer-id="local-datacenters"] .data-toggle-btn', 'pointerup'],
    ['[data-layer-id="local-datacenters"] .data-toggle-btn', 'click'],
    ['.investigation-timeline-slider-control', 'input'],
  ]) {
    const node = document.querySelector(selector);
    if (!node)
      throw new Error(`Qualification interaction control missing: ${selector}`);
    const listener = (event) => observer.onEvent(event);
    node.addEventListener(name, listener, true);
    observer.removeInput.push([node, name, listener]);
  }
  observer.removePreRender = scene.preRender?.addEventListener?.(
    observer.onPreRender,
  );
  observer.removeRender = scene.postRender.addEventListener(observer.onRender);
  const dataManager = window.__godsEyeView?.dataManager;
  if (typeof dataManager?.subscribeVisibilityRequests === 'function')
    observer.removeVisibilityRequest = dataManager.subscribeVisibilityRequests(
      (change) => observer.onVisibilityRequest(change),
    );
  if (typeof dataManager?.subscribe === 'function')
    observer.removeLifecycleEvent = dataManager.subscribe((change) =>
      observer.onVisibilityTransition(change),
    );
  window.__qualificationMetricsObserver = observer;
}

export function installRenderedFlightWitnessReaderInPage() {
  const app = window.__godsEyeView;
  const scene = app?.viewer?.scene;
  if (!scene?.primitives)
    throw new Error('Rendered replay witness needs the Cesium scene.');
  function find(collection, id, parentVisible) {
    if (!collection || !Number.isInteger(collection.length)) return null;
    for (let index = 0; index < collection.length; index++) {
      let primitive;
      try {
        primitive = collection.get(index);
      } catch {
        continue;
      }
      if (!primitive) continue;
      const visible = parentVisible && primitive.show !== false;
      if (
        primitive.id === id &&
        typeof primitive.computeScreenSpacePosition === 'function'
      )
        return { billboard: primitive, collectionVisible: visible };
      if (
        typeof primitive.get === 'function' &&
        Number.isInteger(primitive.length)
      ) {
        const nested = find(primitive, id, visible);
        if (nested) return nested;
      }
    }
    return null;
  }
  window.__qualificationFlightWitnessReader = (id) => {
    if (typeof id !== 'string' || !id) return null;
    const match = find(scene.primitives, id, true);
    if (!match) return null;
    const billboard = match.billboard;
    const screenPosition = billboard.computeScreenSpacePosition(scene);
    const cartographic = scene.globe.ellipsoid.cartesianToCartographic(
      billboard.position,
    );
    return {
      billboardId: billboard.id,
      billboardVisible: billboard.show === true && match.collectionVisible,
      billboardPosition: cartographic
        ? {
            latitude: (cartographic.latitude * 180) / Math.PI,
            longitude: (cartographic.longitude * 180) / Math.PI,
          }
        : null,
      screenPosition: screenPosition
        ? { x: screenPosition.x, y: screenPosition.y }
        : null,
      canvas: {
        width: scene.canvas.clientWidth,
        height: scene.canvas.clientHeight,
      },
    };
  };
}

export function applyUnmeasuredCameraPoseInPage(target) {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  if (
    !camera ||
    !scene?.postRender?.addEventListener ||
    typeof app?.styleManager?.runImmediateLocationNavigation !== 'function'
  )
    throw new Error('Camera setup navigation/render ownership is unavailable.');

  const frameBefore = scene.frameState.frameNumber;
  const poseMatches = () => {
    const position = camera.positionCartographic;
    if (!position) return null;
    return {
      frameNumber: scene.frameState.frameNumber,
      latitude: (position.latitude * 180) / Math.PI,
      longitude: (position.longitude * 180) / Math.PI,
      altitude: position.height,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    };
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let matchingFrames = 0;
    let removePostRender = () => {};
    const timer = setTimeout(() => {
      finish(
        new Error('Camera pose did not settle on completed rendered frames.'),
      );
    }, 15_000);
    const finish = (error, pose = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removePostRender();
      if (error) reject(error);
      else resolve({ frameNumberBefore: frameBefore, observedPose: pose });
    };
    const onPostRender = () => {
      const pose = poseMatches();
      if (!pose || pose.frameNumber <= frameBefore) {
        matchingFrames = 0;
      } else if (
        Math.abs(pose.latitude - target.latitude) <= 1e-6 &&
        Math.abs(pose.longitude - target.longitude) <= 1e-6 &&
        Math.abs(pose.altitude - target.altitude) <= 1 &&
        Math.abs(Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading))) <=
          1e-6 &&
        Math.abs(
          Math.atan2(
            Math.sin(pose.pitch + Math.PI / 2),
            Math.cos(pose.pitch + Math.PI / 2),
          ),
        ) <= 1e-6 &&
        Math.abs(Math.atan2(Math.sin(pose.roll), Math.cos(pose.roll))) <= 1e-6
      ) {
        matchingFrames += 1;
        if (matchingFrames >= 2) {
          finish(null, pose);
          return;
        }
      } else {
        matchingFrames = 0;
      }
      // Ask for the next completed render while setup is unmeasured. This is
      // a render-boundary witness, not a timed wait or an interaction sample.
      try {
        scene.requestRender();
      } catch (error) {
        finish(error);
      }
    };
    try {
      removePostRender =
        scene.postRender.addEventListener(onPostRender) || (() => {});
      const navigationAccepted =
        app.styleManager.runImmediateLocationNavigation(() => {
          camera.setView({
            destination: camera.position.constructor.fromDegrees(
              target.longitude,
              target.latitude,
              target.altitude,
            ),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          });
          return true;
        });
      if (navigationAccepted !== true) {
        finish(new Error('Camera setup navigation did not acquire ownership.'));
        return;
      }
      scene.requestRender();
    } catch (error) {
      finish(error);
    }
  });
}

async function setUnmeasuredCameraPose(page, location, routeId) {
  const { frameNumberBefore, observedPose: pose } = await page.evaluate(
    applyUnmeasuredCameraPoseInPage,
    location,
  );
  const frameNumberAfter = pose.frameNumber;
  assert.ok(
    frameNumberAfter > frameNumberBefore,
    'Camera setup needs a fresh frame',
  );
  assert.ok(Math.abs(pose.latitude - location.latitude) <= 1e-6);
  assert.ok(Math.abs(pose.longitude - location.longitude) <= 1e-6);
  assert.ok(Math.abs(pose.altitude - location.altitude) <= 1);
  assert.ok(Math.abs(circularAngleDifference(pose.heading, 0)) <= 1e-6);
  assert.ok(
    Math.abs(circularAngleDifference(pose.pitch, -Math.PI / 2)) <= 1e-6,
  );
  assert.ok(Math.abs(circularAngleDifference(pose.roll, 0)) <= 1e-6);
  return {
    routeId,
    requestedLocation: location,
    frameNumberBefore,
    frameNumberAfter,
    observedPose: pose,
  };
}

async function installInteractionObserver(page, fixture) {
  await page.evaluate(installInteractionObserverInPage, fixture);
}

async function collectInteraction(
  page,
  kind,
  expected,
  sampleId,
  previous = {},
) {
  await page.evaluate(
    ({
      kind,
      expected,
      previousTimeText,
      previousSliderValue,
      previousLatitude,
      previousLongitude,
      previousPositionTimeMs,
      coverageFromMs,
      coverageToMs,
    }) =>
      window.__qualificationMetricsObserver.arm(
        kind,
        expected,
        previousTimeText,
        previousSliderValue,
        previousLatitude,
        previousLongitude,
        previousPositionTimeMs,
        coverageFromMs,
        coverageToMs,
      ),
    { kind, expected, ...previous },
  );
  if (kind === 'localControl') {
    await page.click('[data-layer-id="local-datacenters"] .data-toggle-btn');
  } else {
    await page.focus('.investigation-timeline-slider-control');
    await page.keyboard.press(expected === 'end' ? 'End' : 'Home');
  }
  await page.waitForFunction(
    () => {
      const observer = window.__qualificationMetricsObserver;
      if (observer?.error) throw new Error(observer.error);
      return observer?.records?.length > 0;
    },
    { timeout: INTERACTION_TIMEOUT_MS },
  );
  const sample = await page.evaluate(() =>
    window.__qualificationMetricsObserver.take(),
  );
  const foreground = await readAndAssertPageForeground(
    page,
    `${sampleId} interaction`,
  );
  return {
    ...sample,
    sampleId,
    stateObserved: true,
    renderedFrameObserved: true,
    ...foreground,
  };
}

async function loadReplay(page) {
  await page.select(
    '.investigation-timeline-aircraft-select',
    'recording-rendered-soak',
  );
  await page.waitForFunction(
    () => window.__godsEyeView.aircraftSource.getState()?.mode === 'recorded',
    { timeout: INTERACTION_TIMEOUT_MS },
  );
  await page.waitForFunction(
    async () => {
      const records =
        (await window.__godsEyeView.aircraftSource.getSnapshot())?.records ||
        [];
      return records.some((record) => record.id === 'SYNTH-001');
    },
    { timeout: INTERACTION_TIMEOUT_MS },
  );
  return setUnmeasuredCameraPose(
    page,
    { latitude: 0, longitude: 179.7, altitude: 500_000 },
    'rendered-soak-recording-region-v1',
  ).then(async (replayCameraSetup) => {
    await page.evaluate(async () => {
      const app = window.__godsEyeView;
      await app.dataManager.setEnabled('flights', true, {
        origin: 'programmatic',
      });
      await app.dataManager.refreshLayer('flights');
      app.viewer.scene.requestRender();
    });
    await page.waitForFunction(
      async () => {
        const app = window.__godsEyeView;
        const selected = await app.aircraftSource.getSnapshot();
        const aircraft = selected.records?.find(
          (record) => record.id === 'SYNTH-001',
        );
        const module = app.dataManager.layers.get('flights')?.module;
        const rendered = module
          ?.getAnalystRecords?.(8)
          ?.find((record) => record.icao24 === aircraft?.id);
        const visual = window.__qualificationFlightWitnessReader?.(
          aircraft?.id,
        );
        return Boolean(
          aircraft &&
          rendered?.provenance?.positionObservedAtMs ===
            aircraft.positionTimeMs &&
          Math.abs(rendered.lat - aircraft.latitude) <= 1e-9 &&
          Math.abs(rendered.lon - aircraft.longitude) <= 1e-9 &&
          visual?.billboardVisible &&
          Math.abs(visual.billboardPosition?.latitude - aircraft.latitude) <=
            1e-9 &&
          Math.abs(visual.billboardPosition?.longitude - aircraft.longitude) <=
            1e-9 &&
          visual.screenPosition?.x >= 0 &&
          visual.screenPosition?.y >= 0 &&
          visual.screenPosition.x < visual.canvas.width &&
          visual.screenPosition.y < visual.canvas.height,
        );
      },
      { timeout: INTERACTION_TIMEOUT_MS },
    );
    return replayCameraSetup;
  });
}

async function collectForBuild({ role, url, expected, fixture }) {
  let driver;
  let closeEvidence = null;
  let operationFailure = null;
  let interactionStatus = 'failed';
  let heapStatus = 'failed';
  const localControl = [];
  const loadedReplaySeek = [];
  const heapSamples = [];
  const completedCycleOperations = [];
  const warmupCycleOperations = [];
  const consoleHandleOwnership = [];
  let heapActualDurationMs = null;
  let browserIdentity = null;
  let localControlCameraSetup = null;
  let datacenterFixtureReceipt = null;
  let replayCameraSetup = null;
  let foregroundSession = null;
  let browserPid = null;
  let hostActivation = null;
  let foregroundFailure = null;
  const foregroundObservations = [];
  let sampling = false;
  let samplerPromise = null;
  try {
    driver = await createRenderedSoakDriver(url, {
      expectedCommit: expected.applicationCommit,
      nativeResolution: true,
      prewarmApplication: false,
      browserOptions: { headless: false },
    });
    if (process.env.GEV_QA_SOFTWARE_RENDERING === '1')
      throw new Error('Qualification capture refuses software rendering.');
    assert.equal(
      driver.hardwareRenderingValidated,
      true,
      'Qualification capture requires independently validated hardware rendering',
    );
    const page = driver.page;
    const version = driver.browserVersion;
    const renderer = driver.renderer;
    const settings = await page.evaluate(
      readEffectiveMeasurementStateInPage,
      driver.nativeResolution,
    );
    const actual = {
      applicationCommit: driver.applicationCommit,
      browserVersion: version,
      renderer: renderer?.renderer,
      ...settings,
    };
    const identity = buildQualificationIdentity(expected, actual, fixture);
    browserIdentity = identity;

    if (process.platform !== 'win32')
      throw new Error(
        'Qualification capture requires a Windows foreground witness.',
      );
    browserPid = page.browser()?.process()?.pid;
    assert.ok(Number.isSafeInteger(browserPid) && browserPid > 0);
    foregroundSession = createWindowsForegroundActivationSession({
      browserPid,
    });
    await foregroundSession.start({ timeoutMs: 15_000 });
    await page.bringToFront();
    hostActivation = readForegroundActivation(
      await foregroundSession.request(browserPid, 15_000),
      browserPid,
    );
    foregroundObservations.push({
      phase: 'interaction-start',
      ...(await readAndAssertPageForeground(page, `${role} capture start`)),
    });

    try {
      await page.evaluate(() => {
        window.__godsEyeView.styleManager.setPanelCollapsed(
          'data-panel',
          false,
          { persist: false, syncShare: false },
        );
      });
      assert.deepEqual(driver.location, LOCAL_CONTROL_CAMERA_LOCATION);
      localControlCameraSetup = await setUnmeasuredCameraPose(
        page,
        driver.location,
        LOCAL_CONTROL_CAMERA_ROUTE_ID,
      );
      datacenterFixtureReceipt = await driver.validateDatacenterSoakFixture();
      const layerSelector =
        '[data-layer-id="local-datacenters"] .data-toggle-btn';
      await page.waitForSelector(layerSelector, {
        timeout: INTERACTION_TIMEOUT_MS,
      });
      await page.waitForFunction(() => {
        const panel = document.querySelector('#data-panel');
        const control = document.querySelector(
          '[data-layer-id="local-datacenters"] .data-toggle-btn',
        );
        const rect = control?.getBoundingClientRect();
        return Boolean(
          panel &&
          !panel.classList.contains('collapsed') &&
          rect?.width > 0 &&
          rect?.height > 0,
        );
      });
      await page.evaluate(installRenderedFlightWitnessReaderInPage);
      await installInteractionObserver(page, fixture);
      for (let index = 0; index < 20; index++) {
        const desired = index % 2 === 0;
        const enabled = await page.evaluate(() =>
          window.__godsEyeView.dataManager.isEnabled('local-datacenters'),
        );
        assert.equal(
          enabled,
          !desired,
          'Datacenter UI toggle must alternate from known state',
        );
        localControl.push(
          await collectInteraction(
            page,
            'localControl',
            desired,
            `${role}-local-${String(index + 1).padStart(2, '0')}`,
          ),
        );
        foregroundObservations.push({
          phase: 'interaction',
          ...(await readAndAssertPageForeground(
            page,
            `${role} local interaction ${index + 1}`,
          )),
        });
      }

      replayCameraSetup = await loadReplay(page);
      const slider = '.investigation-timeline-slider-control';
      const initialReplayState = await page.evaluate(() =>
        window.__godsEyeView.aircraftSource.getState(),
      );
      assertQualificationReplayFixtureState(initialReplayState, fixture);
      for (let index = 0; index < 20; index++) {
        const previous = await page.evaluate(async (selector) => {
          const records =
            (await window.__godsEyeView.aircraftSource.getSnapshot())
              ?.records || [];
          const aircraft = records.find((record) => record.id === 'SYNTH-001');
          return {
            previousTimeText:
              document
                .querySelector('.investigation-timeline-times')
                ?.textContent?.trim() || '',
            previousSliderValue: Number(
              document.querySelector(selector)?.value,
            ),
            previousLatitude: aircraft?.latitude,
            previousLongitude: aircraft?.longitude,
            previousPositionTimeMs: aircraft?.positionTimeMs,
            coverageFromMs:
              window.__godsEyeView.aircraftSource.getState()?.coverage?.from,
            coverageToMs:
              window.__godsEyeView.aircraftSource.getState()?.coverage?.to,
          };
        }, slider);
        const expectedEnd = index % 2 === 0;
        loadedReplaySeek.push(
          await collectInteraction(
            page,
            'loadedReplaySeek',
            expectedEnd ? 'end' : 'home',
            `${role}-replay-${String(index + 1).padStart(2, '0')}`,
            previous,
          ),
        );
        foregroundObservations.push({
          phase: 'interaction',
          ...(await readAndAssertPageForeground(
            page,
            `${role} replay interaction ${index + 1}`,
          )),
        });
      }

      const cleanupObserver = await disposeQualificationObserver(page);
      assert.equal(
        cleanupObserver,
        true,
        'Interaction observers must be disposed before heap sampling',
      );
      interactionStatus = 'completed';
      consoleHandleOwnership.push(await driver.metrics());

      for (let index = 0; index < 2; index++)
        warmupCycleOperations.push(await driver.runCycle());
      warmupCycleOperations.forEach((operations, index) =>
        assertCycleOperations(operations, `${role} warmup cycle ${index + 1}`),
      );
      let measuredCycle = 0;
      sampling = true;
      const sampleErrors = [];
      const samplerStarted = performance.now();
      let previousSampleAt = null;
      samplerPromise = (async () => {
        while (sampling) {
          try {
            const metrics = await driver.metrics();
            const pageForeground = await page.evaluate(() => ({
              visibilityState: document.visibilityState,
              focused: document.hasFocus(),
            }));
            foregroundObservations.push({ phase: 'heap', ...pageForeground });
            const sampledAt = performance.now();
            if (
              pageForeground.visibilityState !== 'visible' ||
              pageForeground.focused !== true
            )
              sampleErrors.push('heap sample was not foreground');
            if (previousSampleAt != null) {
              const gap = sampledAt - previousSampleAt;
              if (gap > SAMPLE_MAX_GAP_MS)
                sampleErrors.push(
                  `heap sample gap ${gap.toFixed(1)}ms exceeded ${SAMPLE_MAX_GAP_MS}ms`,
                );
            }
            previousSampleAt = sampledAt;
            assert.ok(
              Number.isSafeInteger(metrics.JSHeapUsedSize) &&
                metrics.JSHeapUsedSize > 0,
            );
            consoleHandleOwnership.push(metrics.consoleHandleOwnership);
            if (measuredCycle > 0)
              heapSamples.push({
                sampleId: `${role}-heap-${String(heapSamples.length + 1).padStart(4, '0')}`,
                sampleOrdinal: heapSamples.length + 1,
                capturedAt: new Date().toISOString(),
                elapsedMs: sampledAt - samplerStarted,
                heapUsedBytes: metrics.JSHeapUsedSize,
                phaseId: 'mixed-use-cycle',
                cycle: measuredCycle,
                ...pageForeground,
              });
          } catch (error) {
            sampleErrors.push(error.message);
          }
          await new Promise((resolve) =>
            setTimeout(resolve, SAMPLE_CADENCE_MS),
          );
        }
      })();
      for (let cycle = 1; cycle <= 6; cycle++) {
        measuredCycle = cycle;
        const operations = await driver.runCycle();
        assertCycleOperations(
          operations,
          `${role} measured cycle ${measuredCycle}`,
        );
        completedCycleOperations.push({ cycle: measuredCycle, operations });
      }
      const endState = await page.evaluate(
        readEffectiveMeasurementStateInPage,
        driver.nativeResolution,
      );
      assert.deepEqual(
        endState.settings,
        identity.settings,
        'Effective settings changed during the measured workload',
      );
      assert.deepEqual(
        endState.nativeSharpnessProfile,
        identity.nativeSharpnessProfile,
        'Native rendering profile changed during the measured workload',
      );
      identity.settingsAfter = endState.settings;
      identity.nativeSharpnessProfileAfter = endState.nativeSharpnessProfile;
      measuredCycle = 6;
      await new Promise((resolve) => setTimeout(resolve, 25));
      sampling = false;
      await samplerPromise;
      samplerPromise = null;
      heapActualDurationMs = performance.now() - samplerStarted;
      assert.deepEqual(
        sampleErrors,
        [],
        'Sampled heap collection must complete without errors or long gaps',
      );
      assert.ok(
        heapSamples.length >= 10,
        'Heap sample series must contain at least ten raw samples',
      );
      for (let cycle = 1; cycle <= 6; cycle++)
        assert.ok(
          heapSamples.some((sample) => sample.cycle === cycle),
          `Heap series missed measured cycle ${cycle}`,
        );
      heapStatus = 'completed';
    } finally {
      await disposeQualificationObserver(page).catch(() => {});
    }
  } catch (error) {
    operationFailure = error;
  } finally {
    if (driver && !datacenterFixtureReceipt)
      datacenterFixtureReceipt = driver.readDatacenterSoakFixtureReceipt();
    sampling = false;
    if (samplerPromise) await samplerPromise.catch(() => {});
    if (foregroundSession) {
      try {
        const finalPageState = await readAndAssertPageForeground(
          driver.page,
          `${role} capture completion`,
        );
        foregroundObservations.push({
          phase: 'capture-end',
          ...finalPageState,
        });
      } catch (error) {
        foregroundFailure = error.message;
        operationFailure ||= error;
        interactionStatus = 'failed';
        heapStatus = 'failed';
      }
      try {
        await foregroundSession.dispose();
      } catch (error) {
        foregroundFailure ||= error.message;
        operationFailure ||= error;
        interactionStatus = 'failed';
        heapStatus = 'failed';
      }
    }
    if (driver) {
      try {
        closeEvidence = await driver.close();
        assert.equal(
          closeEvidence?.closeCompleted,
          true,
          'Owned browser must close normally',
        );
        assert.equal(
          closeEvidence?.forcedProcessTermination,
          false,
          'Browser cleanup must not force-kill the owned browser',
        );
      } catch (error) {
        closeEvidence = error.browserClose || {
          closeCompleted: false,
          error: error.message,
        };
        operationFailure ||= error;
        interactionStatus = 'failed';
        heapStatus = 'failed';
      }
    }
  }
  return {
    status: operationFailure ? 'failed' : 'completed',
    interactionProtocol: INTERACTION_PROTOCOL,
    interactionStatus,
    heapStatus,
    failureReason: operationFailure?.message || null,
    identity: browserIdentity,
    localControlCameraSetup,
    datacenterFixtureReceipt,
    replayCameraSetup,
    browserClose: closeEvidence,
    foregroundIntegrity: {
      status:
        hostActivation &&
        foregroundObservations.length > 0 &&
        !foregroundFailure
          ? 'completed'
          : 'failed',
      failureReason: foregroundFailure,
      browserPid,
      hostActivation,
      observations: foregroundObservations,
    },
    localControl,
    loadedReplaySeek,
    heapSamples,
    completedCycleOperations,
    warmupCycleOperations,
    consoleHandleOwnership,
    heapActualDurationMs,
  };
}

export async function runQualificationMetricsCapture({
  baselineUrl,
  candidateUrl,
  baselineCapturePath,
  candidateCapturePath,
  weatherIdentityEnvelopePath,
  outputPath,
}) {
  const weatherIdentityPair = weatherIdentityEnvelopePath
    ? readWeatherBalancedIdentityCapturePair({
        envelopePath: weatherIdentityEnvelopePath,
        baselinePath: baselineCapturePath,
        candidatePath: candidateCapturePath,
      })
    : null;
  const [baseline, candidate] = weatherIdentityPair
    ? [weatherIdentityPair.baseline, weatherIdentityPair.candidate]
    : await Promise.all([
        readCapture(baselineCapturePath, 'baseline'),
        readCapture(candidateCapturePath, 'candidate'),
      ]);
  assert.notEqual(
    baseline.identity.applicationCommit,
    candidate.identity.applicationCommit,
  );
  const fixture = fixtureIdentity();
  const report = {
    schema: SCHEMA,
    status: 'running',
    acceptanceEligible: false,
    createdAt: new Date().toISOString(),
    captureProducer: {
      scriptSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      soakDriverSha256: sha256(
        await readFile(
          new URL('./qa-rendered-soak-driver.mjs', import.meta.url),
        ),
      ),
    },
    sourceCaptures: weatherIdentityPair
      ? {
          purpose: 'identity-only-from-validated-weather-balanced-pair',
          coldStartupEligible: false,
          pairIndex: weatherIdentityPair.pairIndex,
          envelope: weatherIdentityPair.envelope,
          baseline: {
            path: baseline.path,
            sha256: baseline.sha256,
            role: baseline.role,
            pairIndex: baseline.pairIndex,
            comparisonEligible: false,
          },
          candidate: {
            path: candidate.path,
            sha256: candidate.sha256,
            role: candidate.role,
            pairIndex: candidate.pairIndex,
            comparisonEligible: false,
          },
        }
      : {
          baseline: { path: baseline.path, sha256: baseline.sha256 },
          candidate: { path: candidate.path, sha256: candidate.sha256 },
        },
    protocol: {
      interactionSamplesPerControlPerBuild: 20,
      interactionProtocol: INTERACTION_PROTOCOL,
      controls: ['local-datacenters-toggle', 'loaded-replay-slider-home-end'],
      datacenterFixture: {
        schema: 'gev-soak-datacenter-fixture/v2',
        featureCount: 8,
        assetSha256Semantics: 'SHA-256 of the served NDJSON fixture bytes',
        fulfillmentReceipt: 'cdp-fetch-fulfilled-hash-count-v1',
        materializationGate:
          'the prepared same-origin response is acknowledged after successful Fetch.fulfillRequest; its delivered bytes/hash/count and exactly eight materialized features are verified by an unmeasured enable-disable preflight before interaction timing',
      },
      interactionSemantics:
        'v3 local controls start at trusted click event.timeStamp after a recorded trusted pointerdown/up sequence; accepted visibility intent and two consecutive visible-button requestAnimationFrame observations are separate acknowledgements; full active-LOD readiness and same-frame postRender remain separately reported. Replay seeks retain trusted input event timestamps and their same-frame rendered-aircraft witness.',
      inputClockSource:
        'trusted-click-event-timeStamp for local controls; trusted-event-timeStamp for replay',
      renderWitnessTypes: {
        localControl: LOCAL_RENDER_WITNESS,
        loadedReplaySeek: REPLAY_RENDER_WITNESS,
      },
      cameraSetup: {
        localControl: {
          routeId: LOCAL_CONTROL_CAMERA_ROUTE_ID,
          location: LOCAL_CONTROL_CAMERA_LOCATION,
          setupTiming: 'unmeasured-before-local-control-interactions',
        },
        loadedReplay: {
          routeId: 'rendered-soak-recording-region-v1',
          location: { latitude: 0, longitude: 179.7, altitude: 500_000 },
          setupTiming: 'unmeasured-before-replay-seek-interactions',
        },
      },
      measurementEnvironment: {
        viewport: { width: 1440, height: 1000 },
        browserVersion: baseline.identity.browserVersion,
        renderer: baseline.identity.renderer,
        nativeSharpnessProfile: {
          id: 'native-sharpness-v1',
          useBrowserRecommendedResolution: false,
          resolutionScale: 1,
          maximumScreenSpaceError: 1,
          dpr: baseline.identity.sourceProfile.viewport.dpr,
        },
        settingsSemantics:
          'effective application settings are read from the live viewer before and after this dedicated workload; each build must preserve its settings and both builds must match; matrix-workload settings are not copied',
        foregroundSemantics:
          'Windows-owned browser PID confirmation at start plus visible/focused page state at each interaction and heap sample',
      },
      heap: {
        warmupCycles: 2,
        measuredCycles: 6,
        operationsPerCycle: WORK_PLAN.operationsPerCycle,
        phaseIds: WORK_PLAN.phaseIds,
        cadenceMs: SAMPLE_CADENCE_MS,
        maxGapMs: SAMPLE_MAX_GAP_MS,
        forcedGc: false,
        samplingScope:
          'raw page.metrics().JSHeapUsedSize time series across six measured mixed-use cycles; not a continuous peak or retention measure',
      },
    },
    builds: {},
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  const persistProgress = () =>
    writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'w',
    });
  try {
    report.builds.baseline = await collectForBuild({
      role: 'baseline',
      url: baselineUrl,
      expected: baseline.identity,
      fixture,
    });
    await persistProgress();
    report.builds.candidate = await collectForBuild({
      role: 'candidate',
      url: candidateUrl,
      expected: candidate.identity,
      fixture,
    });
    await persistProgress();
    report.status =
      report.builds.baseline.status === 'completed' &&
      report.builds.candidate.status === 'completed'
        ? 'completed'
        : 'failed';
    report.failureReason =
      [
        report.builds.baseline.failureReason,
        report.builds.candidate.failureReason,
      ]
        .filter(Boolean)
        .join('; ') || null;
  } catch (error) {
    report.status = 'failed';
    report.failureReason = error.message;
  } finally {
    report.interactionEvidence = {
      schema: INTERACTION_SCHEMA,
      status: ['baseline', 'candidate'].every(
        (role) => report.builds[role]?.interactionStatus === 'completed',
      )
        ? 'completed'
        : 'failed',
      pairing: fixture,
      builds: Object.fromEntries(
        ['baseline', 'candidate'].map((role) => [
          role,
          {
            applicationCommit: report.builds[role]?.identity?.applicationCommit,
            interactionProtocol: report.builds[role]?.interactionProtocol,
            identity: report.builds[role]?.identity,
            status: report.builds[role]?.status,
            interactionStatus: report.builds[role]?.interactionStatus,
            browserClose: report.builds[role]?.browserClose,
            foregroundIntegrity: report.builds[role]?.foregroundIntegrity,
            localControlCameraSetup:
              report.builds[role]?.localControlCameraSetup,
            replayCameraSetup: report.builds[role]?.replayCameraSetup,
            datacenterFixtureReceipt:
              report.builds[role]?.datacenterFixtureReceipt,
            localControl: report.builds[role]?.localControl,
            loadedReplaySeek: report.builds[role]?.loadedReplaySeek,
          },
        ]),
      ),
    };
    report.sampledHeapEvidence = {
      schema: HEAP_SCHEMA,
      status: ['baseline', 'candidate'].every(
        (role) => report.builds[role]?.heapStatus === 'completed',
      )
        ? 'completed'
        : 'failed',
      failureReason: report.failureReason,
      workPlan: WORK_PLAN,
      sampling: {
        cadenceMs: SAMPLE_CADENCE_MS,
        maxGapMs: SAMPLE_MAX_GAP_MS,
        forcedGc: false,
      },
      builds: Object.fromEntries(
        ['baseline', 'candidate'].map((role) => [
          role,
          {
            applicationCommit: report.builds[role]?.identity?.applicationCommit,
            interactionStatus: report.builds[role]?.interactionStatus,
            status: report.builds[role]?.status,
            heapStatus: report.builds[role]?.heapStatus,
            identity: report.builds[role]?.identity,
            completedCycles:
              report.builds[role]?.heapStatus === 'completed'
                ? [1, 2, 3, 4, 5, 6]
                : [],
            completedCycleOperations:
              report.builds[role]?.completedCycleOperations || [],
            warmupCycleOperations:
              report.builds[role]?.warmupCycleOperations || [],
            phaseIds: WORK_PLAN.phaseIds,
            operationsPerCycle: WORK_PLAN.operationsPerCycle,
            actualDurationMs: report.builds[role]?.heapActualDurationMs,
            samples: report.builds[role]?.heapSamples || [],
            browserClose: report.builds[role]?.browserClose,
            foregroundIntegrity: report.builds[role]?.foregroundIntegrity,
            consoleHandleOwnership: report.builds[role]?.consoleHandleOwnership,
          },
        ]),
      ),
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'w',
    });
  }
  return report;
}

if (isMain()) {
  const args = cliArgs(process.argv);
  const report = await runQualificationMetricsCapture({
    baselineUrl: args['baseline-url'],
    candidateUrl: args['candidate-url'],
    baselineCapturePath: args['baseline-capture'],
    candidateCapturePath: args['candidate-capture'],
    weatherIdentityEnvelopePath: args['weather-identity-envelope'],
    outputPath: args.out,
  });
  if (report.status !== 'completed') process.exitCode = 1;
  console.log(
    JSON.stringify({
      status: report.status,
      outputPath: args.out,
      failureReason: report.failureReason,
    }),
  );
}
