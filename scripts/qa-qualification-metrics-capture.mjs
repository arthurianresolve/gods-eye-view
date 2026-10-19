import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSyntheticAircraftFrames } from '../src/recording/syntheticFixture.js';
import { createRenderedSoakDriver } from './qa-rendered-soak-driver.mjs';
import { createWindowsForegroundActivationSession } from './performance/windowsForegroundWindow.mjs';

const SCHEMA = 'gev-qualification-capture/v1';
const INTERACTION_SCHEMA = 'gev-interaction-latency-evidence/v1';
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
  };
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

export function installInteractionObserverInPage() {
  const app = window.__godsEyeView;
  const scene = app?.viewer?.scene;
  if (
    !scene?.postRender?.addEventListener ||
    typeof scene.requestRender !== 'function'
  )
    throw new Error(
      'Qualification probe needs Cesium postRender and requestRender.',
    );
  const observer = {
    pending: null,
    error: null,
    generation: 0,
    disposed: false,
    records: [],
    removeInput: [],
    removeRender: null,
    pollTimer: null,
    isReplayVisualWitness({ selectedRecord, renderedRecord, visualWitness }) {
      return Boolean(
        selectedRecord &&
        renderedRecord &&
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
        visualWitness.screenPosition.y < visualWitness.canvas?.height &&
        renderedRecord.icao24 === selectedRecord.id &&
        renderedRecord.provenance?.positionObservedAtMs ===
          selectedRecord.positionTimeMs &&
        Math.abs(renderedRecord.lat - selectedRecord.latitude) <= 1e-9 &&
        Math.abs(renderedRecord.lon - selectedRecord.longitude) <= 1e-9,
      );
    },
    onEvent(event) {
      if (
        observer.disposed ||
        !observer.pending ||
        observer.pending.inputAtMs != null
      )
        return;
      observer.pending.inputAtMs = performance.now();
      observer.pending.inputEventAtMs = event.timeStamp;
      observer.pending.inputType = event.type;
      observer.pollState();
      observer.pollTimer = setInterval(() => observer.pollState(), 10);
    },
    async pollState() {
      const sample = observer.pending;
      const generation = observer.generation;
      const isCurrent = () =>
        !observer.disposed &&
        observer.pending === sample &&
        observer.generation === generation;
      if (!sample || !isCurrent() || sample.stateAtMs != null) return;
      const appNow = window.__godsEyeView;
      let matched = false;
      if (sample.kind === 'localControl') {
        const button = document.querySelector(sample.selector);
        const layer = appNow.dataManager.layers.get('local-datacenters');
        const records = layer?.module?.getAnalystRecords?.() || [];
        const lod = layer?.module?.getLodDiagnostics?.();
        const renderableCount = Number.isInteger(lod?.active) ? lod.active : 0;
        const renderablesReady = sample.expected
          ? lod?.computed === true && renderableCount > 0
          : renderableCount === 0 && lod?.computed === false;
        matched =
          appNow.dataManager.isEnabled('local-datacenters') ===
            sample.expected &&
          button?.classList.contains('active') === sample.expected &&
          records.length > 0 === sample.expected &&
          renderablesReady;
        if (matched) {
          sample.loadedRecordCount = records.length;
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
        const readout = document.querySelector('.investigation-timeline-times');
        const slider = document.querySelector(
          '.investigation-timeline-slider-control',
        );
        const state = appNow.aircraftSource.getState();
        if (sample.pollingSnapshot) return;
        sample.pollingSnapshot = true;
        let records = [];
        try {
          records = (await appNow.aircraftSource.getSnapshot())?.records || [];
        } catch (error) {
          if (isCurrent()) observer.error = error?.message || String(error);
          return;
        } finally {
          sample.pollingSnapshot = false;
        }
        if (!isCurrent()) return;
        const fixtureAircraft = records.find(
          (record) => record.id === 'SYNTH-001',
        );
        const text = readout?.textContent?.trim() || '';
        const fixtureIndex = sample.expected === 'end' ? 3 : 0;
        const expectedLongitude =
          ((((179.7 + fixtureIndex * 0.01 + 180) % 360) + 360) % 360) - 180;
        const layer = appNow.dataManager.layers.get('flights');
        const renderedRecords = layer?.module?.getAnalystRecords?.() || [];
        const renderedRecord = renderedRecords.find(
          (record) => record.icao24 === fixtureAircraft?.id,
        );
        const visualWitness = window.__qualificationFlightWitnessReader?.(
          fixtureAircraft?.id,
        );
        matched =
          state?.mode === 'recorded' &&
          state?.recordingId === 'recording-rendered-soak' &&
          state?.recordCount === 4 &&
          Boolean(text) &&
          Number.isFinite(Number(slider?.value)) &&
          Number(slider.value) !== sample.previousSliderValue &&
          Number.isFinite(fixtureAircraft?.latitude) &&
          Number.isFinite(fixtureAircraft?.longitude) &&
          fixtureAircraft.positionTimeMs !== sample.previousPositionTimeMs &&
          (fixtureAircraft.latitude !== sample.previousLatitude ||
            fixtureAircraft.longitude !== sample.previousLongitude) &&
          state.targetMs ===
            (sample.expected === 'end'
              ? sample.coverageToMs
              : sample.coverageFromMs) &&
          fixtureAircraft.positionTimeMs === state.targetMs &&
          fixtureAircraft.latitude === Math.sin(fixtureIndex / 10) * 0.02 &&
          fixtureAircraft.longitude === expectedLongitude;
        const visibleReplayMatch = observer.isReplayVisualWitness({
          selectedRecord: fixtureAircraft,
          renderedRecord,
          visualWitness,
        });
        matched = matched && visibleReplayMatch;
        if (matched) {
          sample.selectedTimeText = text;
          sample.selectedSourceMode = state.mode;
          sample.selectedSliderValue = Number(slider.value);
          sample.fixtureAircraftId = fixtureAircraft.id;
          sample.fixtureAircraftLatitude = fixtureAircraft.latitude;
          sample.fixtureAircraftLongitude = fixtureAircraft.longitude;
          sample.positionTimeMs = fixtureAircraft.positionTimeMs;
          sample.recordingId = state.recordingId;
          sample.fixtureRecordCount = state.recordCount;
          sample.coverageFromMs = state.coverage.from;
          sample.coverageToMs = state.coverage.to;
          sample.expectedFixtureIndex = fixtureIndex;
          sample.renderedRecordPositionTimeMs =
            renderedRecord.provenance.positionObservedAtMs;
          sample.renderedRecordLatitude = renderedRecord.lat;
          sample.renderedRecordLongitude = renderedRecord.lon;
          sample.renderedBillboardId = fixtureAircraft.id;
          sample.renderedBillboardLatitude =
            visualWitness.billboardPosition.latitude;
          sample.renderedBillboardLongitude =
            visualWitness.billboardPosition.longitude;
          sample.billboardScreenPosition = visualWitness.screenPosition;
          sample.billboardCanvas = visualWitness.canvas;
          sample.renderedBillboardVisible = visualWitness.billboardVisible;
        }
      }
      if (!matched || !isCurrent()) return;
      sample.stateAtMs = performance.now();
      sample.frameNumberAtState = scene.frameState.frameNumber;
      sample.renderWitnessType = 'requested-post-state-render';
      scene.requestRender();
    },
    onRender() {
      const sample = observer.pending;
      if (
        sample?.stateAtMs == null ||
        scene.frameState.frameNumber <= sample.frameNumberAtState
      )
        return;
      sample.renderedFrameAtMs = performance.now();
      sample.frameNumberAtRendered = scene.frameState.frameNumber;
      observer.records.push({ ...sample });
      if (observer.pollTimer) clearInterval(observer.pollTimer);
      observer.pollTimer = null;
      observer.pending = null;
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
      const selector = '[data-layer-id="local-datacenters"] .data-toggle-btn';
      observer.pending = {
        kind,
        expected,
        selector,
        previousTimeText,
        previousSliderValue,
        previousLatitude,
        previousLongitude,
        previousPositionTimeMs,
        coverageFromMs,
        coverageToMs,
        inputAtMs: null,
        stateAtMs: null,
        renderedFrameAtMs: null,
        frameNumberAtState: null,
        frameNumberAtRendered: null,
      };
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
      if (observer.pollTimer) clearInterval(observer.pollTimer);
      observer.pollTimer = null;
      observer.pending = null;
    },
  };
  for (const [selector, name] of [
    ['[data-layer-id="local-datacenters"] .data-toggle-btn', 'pointerdown'],
    ['.investigation-timeline-slider-control', 'input'],
  ]) {
    const node = document.querySelector(selector);
    if (!node)
      throw new Error(`Qualification interaction control missing: ${selector}`);
    const listener = (event) => observer.onEvent(event);
    node.addEventListener(name, listener, true);
    observer.removeInput.push([node, name, listener]);
  }
  observer.removeRender = scene.postRender.addEventListener(observer.onRender);
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

async function setUnmeasuredCameraPose(page, location, routeId) {
  const frameBefore = await page.evaluate(
    () => window.__godsEyeView.viewer.scene.frameState.frameNumber,
  );
  await page.evaluate((target) => {
    const viewer = window.__godsEyeView.viewer;
    const camera = viewer.camera;
    camera.setView({
      destination: camera.position.constructor.fromDegrees(
        target.longitude,
        target.latitude,
        target.altitude,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender();
  }, location);
  await page.waitForFunction(
    (previousFrame) =>
      window.__godsEyeView.viewer.scene.frameState.frameNumber > previousFrame,
    { timeout: INTERACTION_TIMEOUT_MS },
    frameBefore,
  );
  const pose = await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    const camera = viewer.camera;
    const position = camera.positionCartographic;
    return {
      frameNumber: viewer.scene.frameState.frameNumber,
      latitude: (position.latitude * 180) / Math.PI,
      longitude: (position.longitude * 180) / Math.PI,
      altitude: position.height,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    };
  });
  assert.ok(pose.frameNumber > frameBefore, 'Camera setup needs a fresh frame');
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
    frameNumberBefore: frameBefore,
    frameNumberAfter: pose.frameNumber,
    observedPose: pose,
  };
}

async function installInteractionObserver(page) {
  await page.evaluate(installInteractionObserverInPage);
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
          ?.getAnalystRecords?.()
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
      await installInteractionObserver(page);
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
      assert.equal(initialReplayState.recordingId, 'recording-rendered-soak');
      assert.equal(initialReplayState.recordCount, 4);
      assert.ok(
        initialReplayState.coverage?.from < initialReplayState.coverage?.to,
      );
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
      for (measuredCycle = 1; measuredCycle <= 6; measuredCycle++) {
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
    interactionStatus,
    heapStatus,
    failureReason: operationFailure?.message || null,
    identity: browserIdentity,
    localControlCameraSetup,
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
  outputPath,
}) {
  const [baseline, candidate] = await Promise.all([
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
    sourceCaptures: {
      baseline: { path: baseline.path, sha256: baseline.sha256 },
      candidate: { path: candidate.path, sha256: candidate.sha256 },
    },
    protocol: {
      interactionSamplesPerControlPerBuild: 20,
      controls: ['local-datacenters-toggle', 'loaded-replay-slider-home-end'],
      interactionSemantics:
        'input event to observed state and to the first scene.postRender frame explicitly requested after that state was observed; the fresh-frame witness is conservative and includes request/poll overhead',
      renderWitnessType: 'requested-post-state-render',
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
            identity: report.builds[role]?.identity,
            status: report.builds[role]?.status,
            interactionStatus: report.builds[role]?.interactionStatus,
            browserClose: report.builds[role]?.browserClose,
            foregroundIntegrity: report.builds[role]?.foregroundIntegrity,
            localControlCameraSetup:
              report.builds[role]?.localControlCameraSetup,
            replayCameraSetup: report.builds[role]?.replayCameraSetup,
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
