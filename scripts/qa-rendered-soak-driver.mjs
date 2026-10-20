import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
export { isSoftwareRenderer } from './performance/rendererEvidence.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import { createOwnedSoakCloser } from './performance/hostedSoakSession.mjs';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  cleanupFixturePageDiagnostics,
  flushFixturePageConsoleOwnership,
  bootFixturePage,
  clickControl,
  openWorkspace,
  importFixtureGeometry,
  runWorkspaceFixturePhase,
} from './qa-application-fixtures.mjs';
import { closeTargetBeforeFixtureInterceptionRelease } from './performance/fixtureInterception.mjs';
import { runCesiumWorkerProbeInPage } from './performance/cesiumWorkerProbeInPage.mjs';
import { createSyntheticAircraftFrames } from '../src/recording/syntheticFixture.js';
import { createRecordingBundle } from '../src/recording/bundle.js';

const RENDERED_WORKSPACE_TIMEOUT_MS = 120_000;
export const SOAK_DATACENTER_FEATURE_COUNT = 8;
const SOAK_DATACENTER_FIXTURE_SCHEMA = 'gev-soak-datacenter-fixture/v2';
const DEFAULT_SOAK_LOCATION = Object.freeze({
  latitude: 40.7,
  longitude: -73.9,
  altitude: 1000,
});

// The rendered soak starts its controlled view on the OSM map with DENSE 75.
// Keep those fixture settings explicit while using the share codec to suppress
// the default Austin fly-in at both measured-page navigations.
export function createSoakFixtureShareHash(location) {
  const resolved = resolveRenderedSoakLocation(location);
  const params = new URLSearchParams({
    v: '2',
    lat: String(resolved.latitude),
    lon: String(resolved.longitude),
    alt: String(resolved.altitude),
    heading: '0',
    pitch: '-90',
    roll: '0',
    map: 'osm',
    dm: 'DENSE',
    dd: '75',
    // Absent fields use legacy link defaults, not fresh-profile defaults.
    bi: '0',
    bv: '2',
    kf: '7',
    ko: '1',
    scf: '11',
  });
  return `#${params.toString()}`;
}

export function isSoakDatacenterAssetRequest(requestUrl, appBase) {
  let request;
  let base;
  try {
    request = new URL(String(requestUrl), appBase);
    base = new URL(appBase);
  } catch {
    return false;
  }
  if (request.origin !== base.origin) return false;
  return (
    /(?:^|\/)assets\/datacenters-[A-Za-z0-9_-]{8}\.geojsonl$/.test(
      request.pathname,
    ) ||
    request.pathname.endsWith(
      '/src/data/local_data/datacenters/datacenters.geojsonl',
    )
  );
}

/** Return a bounded snapshot of fixture delivery state for persisted evidence. */
export function createSoakDatacenterFixtureReceipt(validation, requests) {
  return {
    ...validation,
    requests: (Array.isArray(requests) ? requests : [])
      .slice(0, 4)
      .map((request) => ({
        origin: request.origin,
        pathname: request.pathname,
        prepared: request.prepared === true,
        fulfilled: request.fulfilled === true,
        responseStatus: request.responseStatus ?? null,
        bodySha256: request.bodySha256 ?? null,
        deliveredFeatureCount: request.deliveredFeatureCount ?? null,
      })),
  };
}

export function createSoakDatacenterFixture(location) {
  const body = Array.from({ length: SOAK_DATACENTER_FEATURE_COUNT }, (_, n) =>
    JSON.stringify({
      type: 'Feature',
      id: 'way/' + (n + 1),
      properties: { name: 'Synthetic datacenter ' + n },
      geometry: {
        type: 'Point',
        coordinates: [location.longitude + n * 0.002, location.latitude],
      },
    }),
  ).join('\n');
  return {
    body,
    featureCount: SOAK_DATACENTER_FEATURE_COUNT,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  };
}

/** Put the camera over the synthetic fixture and witness two fresh frames. */
export async function prepareSoakDatacenterFixtureViewInPage(location) {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  const runImmediateNavigation =
    app?.styleManager?.runImmediateLocationNavigation;
  if (
    !camera?.position?.constructor?.fromDegrees ||
    !scene?.postRender?.addEventListener ||
    typeof runImmediateNavigation !== 'function'
  )
    throw new Error('Datacenter fixture camera is unavailable.');
  const applyPose = () => {
    const destination = camera.position.constructor.fromDegrees(
      location.longitude,
      location.latitude,
      location.altitude,
    );
    camera.setView({
      destination,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    return true;
  };
  const firstNavigationAccepted = runImmediateNavigation.call(
    app.styleManager,
    applyPose,
  );
  if (firstNavigationAccepted !== true)
    throw new Error('Datacenter fixture camera did not acquire navigation.');

  const frameBefore = scene.frameState?.frameNumber;
  if (!Number.isFinite(frameBefore))
    throw new Error('Datacenter fixture camera frame counter is unavailable.');
  const poseMatches = () => {
    const cartographic = camera.positionCartographic;
    const frameNumber = scene.frameState?.frameNumber;
    return cartographic && Number.isFinite(frameNumber)
      ? {
          frameNumber,
          latitude: (cartographic.latitude * 180) / Math.PI,
          longitude: (cartographic.longitude * 180) / Math.PI,
          altitude: cartographic.height,
          heading: camera.heading,
          pitch: camera.pitch,
          roll: camera.roll,
        }
      : null;
  };
  const poseMatchesTarget = (pose) =>
    pose &&
    pose.frameNumber > frameBefore &&
    Math.abs(pose.latitude - location.latitude) <= 1e-6 &&
    Math.abs(pose.longitude - location.longitude) <= 1e-6 &&
    Math.abs(pose.altitude - location.altitude) <= 1 &&
    Math.abs(Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading))) <=
      1e-6 &&
    Math.abs(
      Math.atan2(
        Math.sin(pose.pitch + Math.PI / 2),
        Math.cos(pose.pitch + Math.PI / 2),
      ),
    ) <= 1e-6 &&
    Math.abs(Math.atan2(Math.sin(pose.roll), Math.cos(pose.roll))) <= 1e-6;
  let lastObservedPose = null;
  const observedPose = await new Promise((resolve, reject) => {
    let settled = false;
    let matchingFrames = 0;
    let lastMatchingFrameNumber = null;
    let removePostRender = () => {};
    const timer = setTimeout(() => {
      const error = new Error(
        'Datacenter fixture camera pose did not settle; last observed pose: ' +
          JSON.stringify(lastObservedPose),
      );
      error.cameraPose = lastObservedPose || poseMatches();
      finish(error);
    }, 15_000);
    const finish = (error, pose = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removePostRender();
      if (error) reject(error);
      else resolve(pose);
    };
    const onPostRender = () => {
      if (settled) return;
      const pose = poseMatches();
      lastObservedPose = pose;
      if (!poseMatchesTarget(pose)) {
        matchingFrames = 0;
        lastMatchingFrameNumber = null;
      } else if (pose.frameNumber !== lastMatchingFrameNumber) {
        matchingFrames++;
        lastMatchingFrameNumber = pose.frameNumber;
      }
      if (matchingFrames >= 2) {
        finish(null, pose);
        return;
      }
      try {
        scene.requestRender?.();
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        failure.cameraPose = lastObservedPose || poseMatches();
        finish(failure);
      }
    };
    try {
      removePostRender =
        scene.postRender.addEventListener(onPostRender) || (() => {});
      scene.requestRender?.();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.cameraPose = lastObservedPose || poseMatches();
      finish(failure);
    }
  });
  return {
    requested: {
      latitude: location.latitude,
      longitude: location.longitude,
      altitude: location.altitude,
    },
    observed: {
      latitude: observedPose.latitude,
      longitude: observedPose.longitude,
      altitude: observedPose.altitude,
    },
    heading: observedPose.heading,
    pitch: observedPose.pitch,
    roll: observedPose.roll,
    frameNumber: observedPose.frameNumber,
  };
}

export function readSoakDatacenterCameraPoseInPage() {
  const camera = window.__godsEyeView?.viewer?.camera;
  const cartographic = camera?.positionCartographic;
  const frameNumber =
    window.__godsEyeView?.viewer?.scene?.frameState?.frameNumber;
  if (!cartographic || !Number.isFinite(frameNumber)) return null;
  const pose = {
    latitude: (cartographic.latitude * 180) / Math.PI,
    longitude: (cartographic.longitude * 180) / Math.PI,
    altitude: cartographic.height,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
    frameNumber,
  };
  return Object.values(pose).every(Number.isFinite) ? pose : null;
}

export function installSoakDatacenterPostRenderWitnessInPage() {
  const scene = window.__godsEyeView?.viewer?.scene;
  if (!scene?.postRender?.addEventListener)
    throw new Error('Datacenter fixture postRender boundary is unavailable.');
  window.__soakRenderedFrames = 0;
  window.__soakDatacenterPreflightActive = false;
  window.__soakDatacenterRenderWitness = null;
  scene.postRender.addEventListener(() => {
    window.__soakRenderedFrames++;
    if (!window.__soakDatacenterPreflightActive) return;
    const app = window.__godsEyeView;
    const module = app.dataManager.layers.get('local-datacenters')?.module;
    const lod = module?.getLodDiagnostics?.();
    window.__soakDatacenterRenderWitness = {
      renderedFrames: window.__soakRenderedFrames,
      frameNumber: scene.frameState?.frameNumber ?? null,
      enabled: app.dataManager.isEnabled('local-datacenters'),
      computed: lod?.computed === true,
      total: Number.isInteger(lod?.total) ? lod.total : null,
      active: Number.isInteger(lod?.active) ? lod.active : null,
    };
  });
}

export function startSoakDatacenterPreflightWitnessInPage() {
  window.__soakDatacenterPreflightActive = true;
  window.__soakDatacenterRenderWitness = null;
  return window.__soakRenderedFrames ?? null;
}

export function stopSoakDatacenterPreflightWitnessInPage() {
  window.__soakDatacenterPreflightActive = false;
}

export async function stopSoakDatacenterPreflightWitness(page, validation) {
  try {
    await page.evaluate(stopSoakDatacenterPreflightWitnessInPage);
    validation.preloadWitnessCollectionStopped = true;
  } catch (cleanupError) {
    validation.preloadWitnessCollectionStopped = false;
    if (validation.status === 'validated') {
      validation.status = 'failed';
      validation.failureReason =
        cleanupError?.message || 'Datacenter preflight witness cleanup failed.';
      throw cleanupError;
    }
    validation.failureReason +=
      '; preflight witness cleanup failed: ' +
      (cleanupError?.message || String(cleanupError));
  }
}

export function evaluateSoakDatacenterEnabledState(
  state,
  expectedFeatureCount,
) {
  const enabled = state?.enabled === true;
  const lod = state?.lod;
  const computed = lod?.computed === true;
  const total = Number.isInteger(lod?.total) ? lod.total : null;
  const active = Number.isInteger(lod?.active) ? lod.active : null;
  const populationObserved = total === expectedFeatureCount;
  const renderableObserved = active !== null && active > 0;
  const renderedFrameObserved = state?.renderedFrameObserved === true;
  return {
    enabled,
    computed,
    total,
    active,
    populationObserved,
    renderableObserved,
    renderedFrameObserved,
    observed:
      enabled &&
      computed &&
      populationObserved &&
      renderableObserved &&
      renderedFrameObserved,
    failureReason: !enabled
      ? 'layer-not-enabled'
      : !computed
        ? 'lod-not-computed'
        : !populationObserved
          ? 'materialized-population-mismatch'
          : !renderableObserved
            ? 'no-renderable-feature-in-view'
            : !renderedFrameObserved
              ? 'no-completed-visible-frame'
              : null,
  };
}

async function assertSoakConsoleOwnership(page) {
  const ownership = await flushFixturePageConsoleOwnership(page);
  if (
    !ownership ||
    ownership.pending !== 0 ||
    ownership.skipped !== 0 ||
    ownership.errors !== 0
  )
    throw new Error(
      'Rendered soak console handle ownership did not drain cleanly: ' +
        JSON.stringify(ownership),
    );
  return ownership;
}

export function readNativeResolutionEvidenceInPage() {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const canvas = viewer?.scene?.canvas;
  const globe = viewer?.scene?.globe;
  if (!viewer || !canvas || !globe)
    throw new Error('Native resolution evidence needs an active viewer.');
  return {
    devicePixelRatio: window.devicePixelRatio,
    canvas: {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      width: canvas.width,
      height: canvas.height,
    },
    sceneDrawingBuffer: {
      width: viewer.scene.drawingBufferWidth,
      height: viewer.scene.drawingBufferHeight,
    },
    resolutionScale: viewer.resolutionScale,
    useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
    maximumScreenSpaceError: globe.maximumScreenSpaceError,
  };
}

export function assertNativeResolutionEvidence(
  evidence,
  expectedDpr,
  label,
  expectedGeometry = null,
) {
  if (
    typeof expectedDpr !== 'number' ||
    !Number.isFinite(expectedDpr) ||
    expectedDpr <= 0
  )
    throw new TypeError('Native device pixel ratio is invalid.');
  if (
    typeof evidence?.devicePixelRatio !== 'number' ||
    !Number.isFinite(evidence.devicePixelRatio) ||
    evidence.devicePixelRatio <= 0 ||
    Math.abs(evidence.devicePixelRatio - expectedDpr) > 0.01
  )
    throw new Error(`${label} native device pixel ratio changed.`);
  if (
    typeof evidence?.useBrowserRecommendedResolution !== 'boolean' ||
    !Number.isFinite(evidence?.resolutionScale) ||
    !Number.isFinite(evidence?.maximumScreenSpaceError)
  )
    throw new Error(`${label} native sharpness settings are unavailable.`);
  const expectedSettings = expectedGeometry || {
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
  };
  if (
    evidence.useBrowserRecommendedResolution !==
      expectedSettings.useBrowserRecommendedResolution ||
    evidence.resolutionScale !== expectedSettings.resolutionScale ||
    evidence.maximumScreenSpaceError !==
      expectedSettings.maximumScreenSpaceError
  )
    throw new Error(`${label} native sharpness settings changed.`);
  const canvas = evidence?.canvas;
  const expectedCanvas = expectedGeometry?.canvas || {
    clientWidth: 1440,
    clientHeight: 1000,
    width: Math.floor(1440 * expectedDpr),
    height: Math.floor(1000 * expectedDpr),
  };
  if (
    !Number.isInteger(canvas?.clientWidth) ||
    !Number.isInteger(canvas?.clientHeight) ||
    canvas.clientWidth <= 0 ||
    canvas.clientHeight <= 0 ||
    canvas.clientWidth !== expectedCanvas.clientWidth ||
    canvas.clientHeight !== expectedCanvas.clientHeight ||
    canvas.width !== expectedCanvas.width ||
    canvas.height !== expectedCanvas.height ||
    evidence.sceneDrawingBuffer?.width !== canvas.width ||
    evidence.sceneDrawingBuffer?.height !== canvas.height
  )
    throw new Error(`${label} native drawing buffer differs from CSS size.`);
  return evidence;
}

export function resolveNativeSoakViewport(nativeDpr) {
  if (!Number.isFinite(nativeDpr) || nativeDpr <= 0)
    throw new TypeError('Native device pixel ratio is invalid.');
  return { width: 1440, height: 1000, deviceScaleFactor: nativeDpr };
}

/** Normalize the fixture's geographic center so soak evidence names its view. */
export function resolveRenderedSoakLocation(location = {}) {
  const normalized = {
    latitude: Number(location.latitude ?? DEFAULT_SOAK_LOCATION.latitude),
    longitude: Number(location.longitude ?? DEFAULT_SOAK_LOCATION.longitude),
    altitude: Number(location.altitude ?? DEFAULT_SOAK_LOCATION.altitude),
  };
  if (
    !Number.isFinite(normalized.latitude) ||
    normalized.latitude < -90 ||
    normalized.latitude > 90 ||
    !Number.isFinite(normalized.longitude) ||
    normalized.longitude < -180 ||
    normalized.longitude > 180 ||
    !Number.isFinite(normalized.altitude) ||
    normalized.altitude <= 0
  )
    throw new TypeError('Rendered soak location is invalid.');
  return normalized;
}

export function isRecoverableApplicationPrewarmFailure(error) {
  const state = error?.fixtureStartupDiagnostics?.state;
  return Boolean(
    /timeout/i.test(error?.name || error?.message || '') &&
    state &&
    ['interactive', 'complete'].includes(state.readyState) &&
    state.applicationPresent === false &&
    state.workspacePanelPresent === false,
  );
}

async function prewarmRenderedApplication(browser, base) {
  const startedAt = Date.now();
  let fixture;
  let outcome = { status: 'passed' };
  try {
    fixture = await prepareFixturePage(browser, base);
    await bootFixturePage(fixture.page, base);
  } catch (error) {
    if (!isRecoverableApplicationPrewarmFailure(error)) throw error;
    outcome = {
      status: 'timed-out',
      reason: 'cold-module-graph-application-not-ready',
      diagnostics: error.fixtureStartupDiagnostics,
    };
  } finally {
    if (fixture) {
      await cleanupFixturePageDiagnostics(fixture.page);
      const cleanup = await closeTargetBeforeFixtureInterceptionRelease(
        fixture.page,
        fixture.interception,
      );
      if (!cleanup.confirmed) {
        const error =
          cleanup.error || new Error('Application prewarm cleanup failed.');
        error.message +=
          '; prewarm cleanup: ' +
          JSON.stringify({
            targetClosed: cleanup.targetClosed,
            release: cleanup.release,
          });
        throw error;
      }
    }
  }
  return { ...outcome, durationMs: Date.now() - startedAt };
}

/** Exercise the actual application, renderer, layer lifecycle and UI controllers. */
export async function createRenderedSoakDriver(
  base,
  {
    browserOptions = {},
    expectedCommit,
    prewarmApplication = false,
    location,
    nativeResolution = false,
  } = {},
) {
  const soakLocation = resolveRenderedSoakLocation(location);
  const soakShareHash = createSoakFixtureShareHash(soakLocation);
  const browser = await launchFixtureBrowser({
    ...browserOptions,
    ...(nativeResolution ? { defaultViewport: null } : {}),
  });
  const closeBrowser = createOwnedSoakCloser(browser);
  let diagnosticsPage = null;
  let closePromise = null;
  const closeSoak = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      let diagnosticsError = null;
      try {
        if (diagnosticsPage)
          await cleanupFixturePageDiagnostics(diagnosticsPage);
      } catch (error) {
        diagnosticsError = error;
      }
      let browserClose;
      let browserCloseError = null;
      try {
        browserClose = await closeBrowser();
      } catch (error) {
        browserCloseError = error;
        browserClose = error.browserClose || { closeCompleted: false };
      }
      if (diagnosticsError) {
        diagnosticsError.browserClose = browserClose;
        if (browserCloseError)
          diagnosticsError.cleanupError = browserCloseError;
        throw diagnosticsError;
      }
      if (browserCloseError) throw browserCloseError;
      return browserClose;
    })();
    return closePromise;
  };
  let startupPrewarm = null;
  let cameraFailure = true;
  let cameraHealthCalls = 0;
  let cameraFrameCalls = 0;
  const cameraHealthHistory = [];
  let archiveFailure = true;
  let archiveCalls = 0;
  const datacenterFixture = createSoakDatacenterFixture(soakLocation);
  const datacenterAssetRequests = [];
  const datacenterPreparedRequests = new Map();
  const datacenterFixtureValidation = {
    schema: SOAK_DATACENTER_FIXTURE_SCHEMA,
    fulfillmentProtocol: 'cdp-fetch-fulfilled-hash-count-v1',
    status: 'pending',
    requestCount: 0,
    preparedRequestCount: 0,
    fulfilledRequestCount: 0,
    applicationOrigin: new URL(base).origin,
    assetOrigin: null,
    assetPath: null,
    responseStatus: null,
    expectedBodySha256: datacenterFixture.bodySha256,
    expectedFeatureCount: datacenterFixture.featureCount,
    bodySha256: null,
    deliveredFeatureCount: null,
    materializedFeatureCount: null,
    disabledMaterializedFeatureCount: null,
    disabledRenderableCount: null,
    setupTiming: 'unmeasured-before-interaction-samples',
    preloadEnabledObserved: false,
    preloadEnabledState: null,
    preloadCameraPose: null,
    preloadFailureCameraPose: null,
    preloadRenderedFrameStart: null,
    preloadRenderedFrameEnd: null,
    preloadRenderWitness: null,
    preloadRenderedFrameObserved: false,
    preloadWitnessCollectionStopped: false,
    preloadDisabledObserved: false,
    failureReason: null,
  };
  let datacenterFixtureValidationPromise = null;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const json = (payload, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
  try {
    if (prewarmApplication) {
      console.log('SOAK prewarm application');
      startupPrewarm = await prewarmRenderedApplication(browser, base);
      console.log(`SOAK prewarm ${startupPrewarm.status}`);
    }
    const nativePage = nativeResolution ? await browser.newPage() : null;
    const nativeDpr = nativePage
      ? await nativePage.evaluate(() => window.devicePixelRatio)
      : null;
    if (nativeResolution && (!Number.isFinite(nativeDpr) || nativeDpr <= 0))
      throw new Error('Native device pixel ratio could not be observed.');
    const { page, errors, verifyNetwork } = await prepareFixturePage(
      browser,
      base,
      {
        exclusiveConsoleHandleOwnership: true,
        ...(nativePage
          ? {
              page: nativePage,
              viewport: resolveNativeSoakViewport(nativeDpr),
            }
          : {}),
        onFulfilled({ requestId, url, status, bodyBase64 }) {
          let fulfilledUrl;
          try {
            fulfilledUrl = new URL(url);
          } catch {
            return;
          }
          if (!isSoakDatacenterAssetRequest(fulfilledUrl.href, base)) return;
          const bytes = Buffer.from(bodyBase64, 'base64');
          const body = bytes.toString('utf8');
          const rows = body.split(/\r?\n/).filter(Boolean);
          const bodySha256 = createHash('sha256').update(bytes).digest('hex');
          const prepared = datacenterPreparedRequests.get(requestId);
          datacenterFixtureValidation.fulfilledRequestCount++;
          datacenterFixtureValidation.responseStatus = status;
          datacenterFixtureValidation.bodySha256 = bodySha256;
          datacenterFixtureValidation.deliveredFeatureCount = rows.length;
          if (prepared) {
            const record = prepared.record;
            record.fulfilled = true;
            record.responseStatus = status;
            record.bodySha256 = bodySha256;
            record.deliveredFeatureCount = rows.length;
            datacenterPreparedRequests.delete(requestId);
          } else {
            datacenterFixtureValidation.failureReason =
              'Fulfilled fixture response did not match a prepared request.';
          }
        },
        respond(url, request) {
          if (url.hostname === 'terrain.reearth.land')
            return {
              status: 404,
              contentType: 'text/plain',
              body: 'fixture terrain unavailable',
            };
          // Keep the hermetic soak representative of the real infrastructure
          // layer while bounding Cesium's data-source lifecycle. Vite emits
          // this imported asset as /assets/datacenters-<hash>.geojsonl.
          if (isSoakDatacenterAssetRequest(url.href, base)) {
            const prepared = {
              origin: url.origin,
              pathname: url.pathname,
              prepared: true,
              fulfilled: false,
              responseStatus: null,
              bodySha256: null,
              deliveredFeatureCount: null,
            };
            if (datacenterAssetRequests.length < 4)
              datacenterAssetRequests.push(prepared);
            if (datacenterPreparedRequests.size < 4)
              datacenterPreparedRequests.set(request.requestId, {
                record: prepared,
              });
            datacenterFixtureValidation.requestCount++;
            datacenterFixtureValidation.preparedRequestCount++;
            datacenterFixtureValidation.assetOrigin = url.origin;
            datacenterFixtureValidation.assetPath = url.pathname;
            return {
              status: 200,
              contentType: 'application/x-ndjson',
              body: datacenterFixture.body,
            };
          }
          if (url.pathname === '/api/cctv/sources')
            return json({
              sources: [0, 1].map((n) => ({
                id: 'fixture-camera-' + n,
                name: 'Synthetic agency camera ' + n,
                provider: 'Synthetic public-agency fixture',
                sourceKind: 'configured',
                url: 'https://example.test/frame',
                credit: 'https://example.test/camera',
                lat: soakLocation.latitude,
                lon: soakLocation.longitude + n * 0.001,
                feedType: 'image',
                headingDeg: 90,
                fovDeg: 60,
                rangeM: 145,
              })),
            });
          if (url.pathname === '/api/cctv/health') {
            cameraHealthCalls++;
            cameraHealthHistory.push({
              at: Date.now(),
              cameraFailure,
            });
            if (cameraHealthHistory.length > 16) cameraHealthHistory.shift();
          }
          if (url.pathname === '/api/cctv/health')
            return json({
              cameras: [0, 1].map((n) => ({
                id: 'fixture-camera-' + n,
                sourceKind: 'configured',
                status: cameraFailure && n === 0 ? 'unavailable' : 'ok',
                reasonCode:
                  cameraFailure && n === 0
                    ? 'upstream-http-error'
                    : 'delivered',
                transportStatus: cameraFailure && n === 0 ? 'failed' : 'ok',
                attemptedAt: Date.now(),
                lastSuccessAt: cameraFailure && n === 0 ? null : Date.now(),
                updatedAt: Date.now(),
                // Match a realistic public still-camera provider cadence. The
                // production freshness policy still expires this after three
                // declared intervals; the fixture result remains valid while
                // a slow hardware-rendered cycle opens and verifies evidence.
                refreshIntervalMs: 60_000,
              })),
            });
          if (url.pathname.startsWith('/api/cctv/frame/')) {
            cameraFrameCalls++;
            if (cameraFailure && url.pathname.endsWith('fixture-camera-0'))
              return json({ error: 'fixture-outage' }, 503);
            return { status: 200, contentType: 'image/png', body: png };
          }
          if (url.pathname === '/api/evidence/archive-lookup') {
            archiveCalls++;
            if (archiveFailure)
              return json({ state: 'failed', error: 'fixture-outage' }, 502);
            const { url: originalUrl } = JSON.parse(request.postData());
            return json({
              state: 'available',
              requestedUrl: originalUrl,
              reference: {
                kind: 'archive',
                title: 'Synthetic archive fixture',
                url:
                  'https://web.archive.org/web/20200101120000/' + originalUrl,
                originalUrl,
                archiveAt: Date.parse('2020-01-01T12:00:00Z'),
                lookedUpAt: Date.now(),
              },
            });
          }
        },
      },
    );
    diagnosticsPage = page;
    await page.evaluateOnNewDocument(installWorkerDiagnostics);
    // Save-as uses a native prompt in production. The application normally
    // replaces window.prompt during fixture boot, but keep the soak setup
    // deterministic if a browser/renderer leaves the native dialog in place.
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt')
        await dialog.accept('Rendered soak workspace');
      else await dialog.accept();
    });
    console.log('SOAK boot application');
    await bootFixturePage(page, base, {
      // A cold Vite development graph can take more than 90 seconds to compile
      // on the primary UHD 620 qualification host. This remains a bounded cold
      // activation allowance outside the measured soak interval; ordinary
      // browser gates retain the stricter shared default.
      applicationReadyTimeoutMs: 180_000,
      hash: soakShareHash,
    });
    const initialNativeResolution = nativeResolution
      ? assertNativeResolutionEvidence(
          await page.evaluate(readNativeResolutionEvidenceInPage),
          nativeDpr,
          'Initial soak',
        )
      : null;
    console.log('SOAK application ready');
    const applicationCommit = await page.evaluate(
      () =>
        window.__godsEyeView.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (expectedCommit && applicationCommit !== expectedCommit)
      throw new Error(
        `Soak application commit mismatch: expected ${expectedCommit}, received ${applicationCommit}`,
      );
    const networkPreflight = await verifyNetwork();
    console.log('SOAK worker network interception preflight passed');
    let workerPreflight;
    try {
      workerPreflight = await page.evaluate(runCesiumWorkerProbeInPage);
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => window.__gevSoakWorkers?.snapshot?.() || null)
        .catch(() => null);
      error.message += '; worker diagnostics: ' + JSON.stringify(diagnostics);
      throw error;
    }
    workerPreflight.network = networkPreflight;
    console.log('SOAK worker completion preflight passed');
    // Seed only synthetic observations through the real application recorder.
    const recordingStartAt = await page.evaluate(() => Date.now());
    const recordingFrames = createSyntheticAircraftFrames({
      startAt: recordingStartAt,
      sampleCount: 4,
      intervalMs: 1000,
    });
    await page.evaluate(async (frames) => {
      const app = window.__godsEyeView;
      await app.aircraftRecording.start({
        id: 'recording-rendered-soak',
        sourceId: 'synthetic-fixture',
        region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
      });
      for (const frame of frames) await app.aircraftRecording.ingest(frame);
      await app.aircraftRecording.stop('fixture-ready');
    }, recordingFrames);
    console.log('SOAK boot application');
    await bootFixturePage(page, base, { hash: soakShareHash });
    console.log('SOAK application ready');
    const soakPhase = (phase, operation, diagnosticContext) =>
      runWorkspaceFixturePhase(page, phase, operation, {
        diagnosticContext,
        onProgress: (progress) => console.log(`SOAK ${progress}`),
      });
    await soakPhase('workspace-save-as-click', () =>
      clickControl(page, '.workspace-library [data-action="save-as"]'),
    );
    await soakPhase('workspace-save-as-selection', () =>
      page.waitForFunction(
        () =>
          document.querySelector('.workspace-library [data-workspace-select]')
            ?.value,
        { polling: 100, timeout: 30000 },
      ),
    );
    const firstId = await soakPhase('workspace-first-id-read', () =>
      page.$eval(
        '.workspace-library [data-workspace-select]',
        (node) => node.value,
      ),
    );
    await soakPhase(
      'workspace-duplicate-click',
      () => clickControl(page, '.workspace-library [data-action="duplicate"]'),
      { targetWorkspaceId: firstId },
    );
    await soakPhase(
      'workspace-duplicate-status',
      () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('.workspace-library [data-status]')
              ?.textContent.startsWith('Created'),
          { polling: 100, timeout: 30000 },
        ),
      { targetWorkspaceId: firstId },
    );
    await soakPhase(
      'workspace-duplicate-selection',
      () =>
        page.waitForFunction(
          (id) =>
            document.querySelector('.workspace-library [data-workspace-select]')
              ?.value !== id,
          { polling: 100, timeout: 30000 },
          firstId,
        ),
      { targetWorkspaceId: firstId },
    );
    const secondId = await page.$eval(
      '.workspace-library [data-workspace-select]',
      (node) => node.value,
    );
    const ids = [firstId, secondId];
    const session = await page.createCDPSession();
    await page.evaluate(installSoakDatacenterPostRenderWitnessInPage);
    const renderer = await page.evaluate(() => {
      const canvas = window.__godsEyeView.viewer.scene.canvas;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: gl.getParameter(info?.UNMASKED_VENDOR_WEBGL || gl.VENDOR),
        renderer: gl.getParameter(info?.UNMASKED_RENDERER_WEBGL || gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      };
    });
    const graphics = await readBrowserGraphicsInfo(browser);
    const renderingEvidence = classifyRenderer(renderer.renderer, graphics);
    let previousFrames = 0;
    let cycleNumber = 0;
    async function waitForArchiveState(phase, predicate) {
      try {
        // Network/DOM state is independent of Cesium's animation cadence.
        // Keep the existing deadline and assertion, using timer-based polling.
        await page.waitForFunction(predicate, { polling: 100, timeout: 30000 });
      } catch (error) {
        const state = await page
          .evaluate(() => ({
            text: document
              .querySelector('#evidence-panel')
              ?.textContent?.slice(-1600),
            buttons: [
              ...document.querySelectorAll('#evidence-panel button'),
            ].map((button) => ({
              text: button.textContent,
              disabled: button.disabled,
            })),
            visible: !document.hidden,
            focused: document.hasFocus(),
            renderedFrames: window.__soakRenderedFrames,
            renderLoop: window.__godsEyeView?.viewer?.useDefaultRenderLoop,
            contextLost:
              window.__godsEyeView?.viewer?.scene?.context?._gl?.isContextLost?.(),
          }))
          .catch(() => null);
        error.message +=
          '; archive fixture: ' +
          JSON.stringify({
            phase,
            cycle: cycleNumber - 1,
            archiveCalls,
            archiveFailure,
            state,
          });
        throw error;
      }
    }
    async function waitForCameraState(phase, predicate, timeout = 30_000) {
      const startedAt = Date.now();
      let terminal = false;
      let evaluationError = null;
      while (Date.now() - startedAt < timeout) {
        try {
          terminal = Boolean(await page.evaluate(predicate));
          evaluationError = null;
        } catch (error) {
          evaluationError = error;
        }
        if (terminal) {
          console.log('SOAK camera ' + phase + ' confirmed');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      try {
        terminal = Boolean(await page.evaluate(predicate));
        evaluationError = null;
      } catch (error) {
        evaluationError = error;
      }
      if (terminal) {
        console.log('SOAK camera ' + phase + ' confirmed at deadline');
        return;
      }
      {
        const error =
          evaluationError ||
          new Error(`Camera ${phase} exceeded ${timeout}ms.`);
        const state = await page
          .evaluate(() => {
            const layer =
              window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
            const ui = layer?.getUIState?.();
            const compact = (row) =>
              row
                ? {
                    id: row.id,
                    healthReason: row.healthReason,
                    sourceStatus: row.sourceStatus,
                    decodeStatus: row.decodeStatus,
                    decodeReason: row.decodeReason,
                    attemptedAt: row.attemptedAt,
                    lastSuccessAt: row.lastSuccessAt,
                    decodeAttemptedAt: row.decodeAttemptedAt,
                    decodeLastSuccessAt: row.decodeLastSuccessAt,
                  }
                : null;
            return {
              enabled:
                window.__godsEyeView?.dataManager?.isEnabled?.('cctv') || false,
              activeCamera: compact(ui?.activeCamera),
              cameras: (ui?.cameras || []).map(compact).slice(0, 8),
              visible: !document.hidden,
              focused: document.hasFocus(),
              browserNow: Date.now(),
              renderedFrames: window.__soakRenderedFrames,
              inspector: (() => {
                const panel = document.querySelector('#evidence-panel');
                return panel
                  ? {
                      hidden: panel.hidden,
                      pinned: panel.dataset.pinned,
                      text: panel.textContent?.slice(-800),
                    }
                  : null;
              })(),
            };
          })
          .catch(() => null);
        error.message +=
          '; camera fixture: ' +
          JSON.stringify({
            phase,
            cycle: cycleNumber - 1,
            cameraFailure,
            cameraHealthCalls,
            cameraFrameCalls,
            cameraHealthHistory,
            state,
          });
        throw error;
      }
    }
    async function refreshCameraHealthAtBoundary(phase, timeout = 15_000) {
      const before = cameraHealthCalls;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        // refreshLayer() is the application's public, serialized update
        // boundary. CCTV deliberately rate-limits health reads, so retry the
        // update until this boundary owns a new provider response instead of
        // assuming that a visibility toggle refreshes network state.
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.refreshLayer('cctv'),
        );
        if (cameraHealthCalls > before) {
          console.log('SOAK camera ' + phase + ' provider refresh confirmed');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error(
        `Camera ${phase} provider refresh exceeded ${timeout}ms; calls remained ${cameraHealthCalls} after ${before}.`,
      );
    }
    async function cycle() {
      const iteration = cycleNumber++;
      assert.deepEqual(errors, []);
      console.log('SOAK cycle ' + iteration + ' workspace/import');
      const id = ids[iteration % 2];
      // Bound fixture size while still committing, opening and rendering real imports.
      await page.evaluate(async (key) => {
        const library = window.__godsEyeView.workspaceLibraryPanel.library;
        const record = await library.getWorkspace(key);
        await library.save(
          {
            ...record.document,
            chunks: { ...record.chunks, imports: [] },
            pinnedEvidence: [],
          },
          { id: key, expectedRevision: record.manifest.revision },
        );
      }, id);
      const onWorkspacePhase = (phase) =>
        console.log('SOAK phase ' + iteration + ' ' + phase);
      await openWorkspace(page, id, {
        timeoutMs: RENDERED_WORKSPACE_TIMEOUT_MS,
        onProgress: onWorkspacePhase,
      });
      await importFixtureGeometry(page, 'Rendered soak ' + iteration, {
        onProgress: onWorkspacePhase,
      });
      await page.evaluate(async () => {
        const app = window.__godsEyeView;
        for (const enabled of [false, true])
          await app.dataManager.setEnabled('local-datacenters', enabled);
        const record = app.dataManager.layers
          .get('local-datacenters')
          ?.module?.getAnalystRecords?.()
          ?.find((row) => row.evidence);
        if (!record?.evidence) throw new Error('Infrastructure was not loaded');
        window.dispatchEvent(
          new CustomEvent('gev:entity-selected', {
            detail: { label: record.name, evidence: record.evidence },
          }),
        );
        document.querySelector('.evidence-panel-technical').open = true;
      });
      // A unique public reference prevents a cache hit from hiding failure/recovery.
      await page.evaluate((index) => {
        window.dispatchEvent(
          new CustomEvent('gev:entity-selected', {
            detail: {
              label: 'Public reference fixture',
              evidence: {
                entityRef: { layerKey: 'fixture', id: 'reference-' + index },
                sourceUrl: 'https://example.test/soak/' + index,
              },
            },
          }),
        );
        document.querySelector('.evidence-panel-technical').open = true;
      }, iteration);
      console.log('SOAK archive failure/recovery');
      archiveFailure = true;
      const before = archiveCalls;
      await clickControl(page, '[data-archive-url]');
      await waitForArchiveState('failed lookup shown', () =>
        document
          .querySelector('#evidence-panel')
          .textContent.includes('Archive lookup failed'),
      );
      archiveFailure = false;
      await clickControl(page, '[data-archive-url]');
      await waitForArchiveState('recovered lookup attachable', () =>
        [...document.querySelectorAll('#evidence-panel button')].some(
          (node) => node.textContent === 'Attach archived reference',
        ),
      );
      await page.evaluate(() =>
        [...document.querySelectorAll('#evidence-panel button')]
          .find((node) => node.textContent === 'Attach archived reference')
          .click(),
      );
      await clickControl(page, '.workspace-library [data-action="pin-a"]');
      await page.waitForFunction(() =>
        document
          .querySelector('.workspace-library [data-status]')
          .textContent.startsWith('Pinned evidence A'),
      );
      const bundle = await page.evaluate(
        (key) =>
          window.__godsEyeView.workspaceLibraryPanel.library.exportBackup(key),
        id,
      );
      assert.ok(
        JSON.parse(
          bundle,
        ).document.pinnedEvidence[0].snapshot.records[0].record.references.some(
          (ref) => ref.kind === 'archive',
        ),
      );
      assert.equal(archiveCalls - before, 2);
      // Pin A intentionally locks the inspector to the archived evidence.
      // Close it before the camera journey so the subsequent user selection
      // can open a fresh, unpinned camera evidence view.
      await clickControl(page, '#evidence-panel-close');
      console.log('SOAK replay');
      await page.select(
        '.investigation-timeline-aircraft-select',
        'recording-rendered-soak',
      );
      await page.waitForFunction(
        () =>
          window.__godsEyeView.aircraftSource.getState().mode === 'recorded',
      );
      await page.evaluate(async (index) => {
        const app = window.__godsEyeView;
        const slider = document.querySelector(
          '.investigation-timeline-slider-control',
        );
        slider.value = index % 2 ? slider.min : slider.max;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await app.dataManager.setEnabled('flights', true);
        await app.dataManager.refreshLayer('flights');
        if (!(await app.aircraftSource.getSnapshot()).records.length)
          throw new Error('Replay lost observations');
      }, iteration);
      await page.waitForFunction(
        () =>
          window.__godsEyeView.dataManager.layers
            .get('flights')
            .module.getStats().count > 0,
      );
      // Real proxy-shaped health, image delivery/decoding and automatic alternative.
      console.log('SOAK camera outage');
      cameraFailure = true;
      await page.evaluate(async (location) => {
        const app = window.__godsEyeView;
        await app.dataManager.setEnabled('cctv', true);
        const destination = app.viewer.camera.position.constructor.fromDegrees(
          location.longitude,
          location.latitude,
          location.altitude,
        );
        const current = app.viewer.camera.position;
        // Reapplying an identical Cesium view starts another terrain quadtree
        // build even though the operator did not move. Keep the fixture's
        // camera journey representative without manufacturing unbounded work.
        if (
          Math.abs(current.x - destination.x) > 1 ||
          Math.abs(current.y - destination.y) > 1 ||
          Math.abs(current.z - destination.z) > 1
        )
          app.viewer.camera.setView({ destination });
        app.dataManager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      }, soakLocation);
      // Exercise the real visibility lifecycle, then cross the serialized
      // refresh boundary so the assertion observes a provider response made
      // after the fixture changed state.
      await page.evaluate(async () => {
        const manager = window.__godsEyeView.dataManager;
        await manager.setEnabled('cctv', false);
        await manager.setEnabled('cctv', true);
        manager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      });
      await refreshCameraHealthAtBoundary('outage');
      await waitForCameraState('outage-health', () => {
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        return (
          layer
            .getUIState()
            .cameras.find((row) => row.id === 'fixture-camera-0')
            ?.healthReason === 'upstream-http-error'
        );
      });
      const cameraSelection = await page.evaluate(() => {
        // Workspace pinning and replay can legitimately leave the inspector
        // locked. Clear it at the ownership boundary immediately before the
        // camera selection that must populate the inspector.
        document.querySelector('#evidence-panel-close')?.click();
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        let selected = null;
        const onSelected = (event) => {
          if (
            event.detail?.layerId === 'cctv' &&
            event.detail?.id === 'fixture-camera-0'
          )
            selected = {
              id: event.detail.id,
              healthReason: event.detail.cameraState?.healthReason,
              sourceStatus: event.detail.cameraState?.sourceStatus,
            };
        };
        window.addEventListener('gev:entity-selected', onSelected);
        if (!layer.selectCamera('fixture-camera-0'))
          throw new Error('Manual failed camera selection lost');
        window.removeEventListener('gev:entity-selected', onSelected);
        const panel = document.querySelector('#evidence-panel');
        return {
          selected,
          inspector: {
            hidden: panel?.hidden,
            pinned: panel?.dataset.pinned,
            text: panel?.textContent || '',
          },
        };
      });
      assert.deepEqual(cameraSelection.selected, {
        id: 'fixture-camera-0',
        healthReason: 'upstream-http-error',
        sourceStatus: 'unavailable',
      });
      assert.equal(cameraSelection.inspector.hidden, false);
      assert.equal(cameraSelection.inspector.pinned, 'false');
      assert.match(cameraSelection.inspector.text, /upstream-http-error/);
      assert.equal(
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.focusNearest({ focus: false }),
        ),
        'fixture-camera-1',
      );
      console.log('SOAK camera recovery');
      cameraFailure = false;
      await page.evaluate(async () => {
        const manager = window.__godsEyeView.dataManager;
        await manager.setEnabled('cctv', false);
        await manager.setEnabled('cctv', true);
        manager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      });
      await refreshCameraHealthAtBoundary('recovery');
      await waitForCameraState('recovery-health', () => {
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        return (
          layer
            .getUIState()
            .cameras.find((row) => row.id === 'fixture-camera-0')
            ?.healthReason === 'delivered'
        );
      });
      await page.evaluate(() =>
        window.__godsEyeView.dataManager.layers
          .get('cctv')
          .module.selectCamera('fixture-camera-0'),
      );
      await waitForCameraState(
        'recovery-decode',
        () =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.getUIState().activeCamera?.decodeStatus === 'ok',
      );
      assert.equal(
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.focusNearest({ focus: false }),
        ),
        'fixture-camera-0',
      );
      const frameState = await page.evaluate(async () => {
        const app = window.__godsEyeView;
        const viewer = app.viewer;
        if (viewer.isDestroyed() || viewer.scene.context.isDestroyed())
          throw new Error('Renderer destroyed');
        viewer.resize();
        for (let n = 0; n < 3; n++) {
          viewer.scene.requestRender();
          viewer.render();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const canvas = viewer.scene.canvas;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (
          gl.isContextLost() ||
          gl.drawingBufferWidth < 1 ||
          gl.drawingBufferHeight < 1
        )
          throw new Error('Renderer lost its framebuffer');
        await app.dataManager.setEnabled('cctv', false);
        document
          .querySelector('.investigation-timeline-controls button:last-child')
          .click();
        return {
          frames: window.__soakRenderedFrames,
          frameNumber: viewer.scene.frameState?.frameNumber ?? null,
          requestRenderMode: viewer.scene.requestRenderMode,
          renderRequested: viewer.scene._renderRequested ?? null,
          canRender: viewer._cesiumWidget?._canRender ?? null,
          canvas: {
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
          },
        };
      });
      assert.ok(
        frameState.frames > previousFrames,
        `no rendered frames during mixed-use cycle: ${JSON.stringify(frameState)}`,
      );
      previousFrames = frameState.frames;
      await page.waitForFunction(
        () => window.__godsEyeView.aircraftSource.getState().mode === 'live',
      );
      await openWorkspace(page, id, {
        timeoutMs: RENDERED_WORKSPACE_TIMEOUT_MS,
      });
      assert.deepEqual(errors, []);
      return {
        sourceToggles: 8,
        replaySeeks: 1,
        imports: 1,
        workspaceReloads: 2,
        archiveFailures: 1,
        cameraRecoveries: 1,
      };
    }
    return {
      page,
      warmupIterations: 2,
      scope: 'rendered-application-fixtures',
      location: soakLocation,
      workerPreflight,
      applicationCommit,
      renderer,
      graphics,
      renderingEvidence,
      startupPrewarm,
      environment: readHostEnvironment(),
      hardwareRenderingValidated: renderingEvidence.accelerationVerified,
      browserVersion: await browser.version(),
      nativeResolution: nativeResolution
        ? { observedDpr: nativeDpr, initial: initialNativeResolution }
        : null,
      runCycle: cycle,
      async validateDatacenterSoakFixture() {
        if (!datacenterFixtureValidationPromise)
          datacenterFixtureValidationPromise = (async () => {
            datacenterFixtureValidation.status = 'running';
            try {
              datacenterFixtureValidation.preloadRenderedFrameStart =
                await page.evaluate(startSoakDatacenterPreflightWitnessInPage);
              datacenterFixtureValidation.preloadCameraPose =
                await page.evaluate(
                  prepareSoakDatacenterFixtureViewInPage,
                  soakLocation,
                );
              await page.evaluate(async () => {
                const app = window.__godsEyeView;
                if (app.dataManager.isEnabled('local-datacenters'))
                  throw new Error(
                    'Datacenter fixture preflight requires a disabled initial layer.',
                  );
                await app.dataManager.setEnabled('local-datacenters', true, {
                  origin: 'programmatic',
                });
              });
              try {
                await page.waitForFunction(
                  (frameStart) => {
                    return (
                      Number.isFinite(frameStart) &&
                      window.__soakDatacenterRenderWitness?.renderedFrames >
                        frameStart &&
                      window.__soakDatacenterRenderWitness.enabled === true &&
                      window.__soakDatacenterRenderWitness.computed === true &&
                      window.__soakDatacenterRenderWitness.total > 0 &&
                      window.__soakDatacenterRenderWitness.active > 0
                    );
                  },
                  { timeout: 30_000 },
                  datacenterFixtureValidation.preloadRenderedFrameStart,
                );
              } catch (error) {
                const lastState = await page
                  .evaluate(() => {
                    const app = window.__godsEyeView;
                    const module =
                      app?.dataManager?.layers?.get(
                        'local-datacenters',
                      )?.module;
                    return {
                      enabled:
                        app?.dataManager?.isEnabled?.('local-datacenters'),
                      lod: module?.getLodDiagnostics?.() || null,
                      renderedFrames: window.__soakRenderedFrames ?? null,
                      renderWitness:
                        window.__soakDatacenterRenderWitness ?? null,
                    };
                  })
                  .catch(() => null);
                if (lastState)
                  lastState.cameraPose = await page
                    .evaluate(readSoakDatacenterCameraPoseInPage)
                    .catch(() => null);
                datacenterFixtureValidation.preloadRenderedFrameEnd =
                  lastState?.renderedFrames ?? null;
                datacenterFixtureValidation.preloadFailureCameraPose =
                  lastState?.cameraPose ?? null;
                datacenterFixtureValidation.preloadRenderWitness =
                  lastState?.renderWitness ?? null;
                datacenterFixtureValidation.preloadRenderedFrameObserved =
                  Number.isFinite(
                    datacenterFixtureValidation.preloadRenderedFrameStart,
                  ) &&
                  lastState?.renderWitness?.renderedFrames >
                    datacenterFixtureValidation.preloadRenderedFrameStart &&
                  lastState?.renderWitness?.enabled === true &&
                  lastState?.renderWitness?.computed === true &&
                  lastState?.renderWitness?.total ===
                    datacenterFixture.featureCount &&
                  lastState?.renderWitness?.active > 0;
                datacenterFixtureValidation.materializedFeatureCount =
                  lastState?.lod?.total ?? null;
                datacenterFixtureValidation.preloadEnabledState =
                  evaluateSoakDatacenterEnabledState(
                    {
                      ...lastState,
                      renderedFrameObserved:
                        datacenterFixtureValidation.preloadRenderedFrameObserved,
                    },
                    datacenterFixture.featureCount,
                  );
                error.message +=
                  '; bounded datacenter preflight state: ' +
                  JSON.stringify({
                    cameraPose: datacenterFixtureValidation.preloadCameraPose,
                    failureCameraPose:
                      datacenterFixtureValidation.preloadFailureCameraPose,
                    frameStart:
                      datacenterFixtureValidation.preloadRenderedFrameStart,
                    frameEnd:
                      datacenterFixtureValidation.preloadRenderedFrameEnd,
                    enabledState:
                      datacenterFixtureValidation.preloadEnabledState,
                  });
                throw error;
              }
              const diagnostics = await page.evaluate(() => {
                const app = window.__godsEyeView;
                const module =
                  app.dataManager.layers.get('local-datacenters')?.module;
                return {
                  enabled: app.dataManager.isEnabled('local-datacenters'),
                  lod: module?.getLodDiagnostics?.() || null,
                  renderedFrames: window.__soakRenderedFrames ?? null,
                  renderWitness: window.__soakDatacenterRenderWitness ?? null,
                };
              });
              datacenterFixtureValidation.preloadRenderedFrameEnd =
                diagnostics.renderedFrames;
              datacenterFixtureValidation.preloadRenderWitness =
                diagnostics.renderWitness;
              datacenterFixtureValidation.preloadRenderedFrameObserved =
                Number.isFinite(
                  datacenterFixtureValidation.preloadRenderedFrameStart,
                ) &&
                diagnostics.renderWitness?.renderedFrames >
                  datacenterFixtureValidation.preloadRenderedFrameStart &&
                diagnostics.renderWitness?.enabled === true &&
                diagnostics.renderWitness?.computed === true &&
                diagnostics.renderWitness?.total ===
                  datacenterFixture.featureCount &&
                diagnostics.renderWitness?.active > 0;
              datacenterFixtureValidation.materializedFeatureCount =
                diagnostics.lod?.total ?? null;
              datacenterFixtureValidation.preloadEnabledState =
                evaluateSoakDatacenterEnabledState(
                  {
                    ...diagnostics,
                    renderedFrameObserved:
                      datacenterFixtureValidation.preloadRenderedFrameObserved,
                  },
                  datacenterFixture.featureCount,
                );
              datacenterFixtureValidation.preloadEnabledObserved =
                datacenterFixtureValidation.preloadEnabledState.observed;
              await page.evaluate(async () => {
                await window.__godsEyeView.dataManager.setEnabled(
                  'local-datacenters',
                  false,
                  { origin: 'programmatic' },
                );
              });
              await page.waitForFunction(
                () => {
                  const app = window.__godsEyeView;
                  const lod = app.dataManager.layers
                    .get('local-datacenters')
                    ?.module?.getLodDiagnostics?.();
                  return (
                    !app.dataManager.isEnabled('local-datacenters') &&
                    lod?.computed === false &&
                    lod.total === 0 &&
                    lod.active === 0
                  );
                },
                { timeout: 30_000 },
              );
              const disabledState = await page.evaluate(() => {
                const app = window.__godsEyeView;
                const lod = app.dataManager.layers
                  .get('local-datacenters')
                  ?.module?.getLodDiagnostics?.();
                return {
                  enabled: app.dataManager.isEnabled('local-datacenters'),
                  total: lod?.total ?? null,
                  active: lod?.active ?? null,
                };
              });
              datacenterFixtureValidation.disabledMaterializedFeatureCount =
                disabledState.total;
              datacenterFixtureValidation.disabledRenderableCount =
                disabledState.active;
              datacenterFixtureValidation.preloadDisabledObserved =
                disabledState.enabled === false &&
                disabledState.total === 0 &&
                disabledState.active === 0;
              assert.equal(
                datacenterFixtureValidation.requestCount,
                1,
                'exactly one same-origin datacenter fixture response must be intercepted',
              );
              assert.equal(
                datacenterFixtureValidation.preparedRequestCount,
                1,
                'exactly one datacenter fixture response must be prepared',
              );
              assert.equal(
                datacenterFixtureValidation.fulfilledRequestCount,
                1,
                'the prepared datacenter fixture response must be fulfilled',
              );
              assert.equal(
                datacenterFixtureValidation.responseStatus,
                200,
                'the fulfilled datacenter fixture response must be successful',
              );
              assert.equal(
                datacenterFixtureValidation.bodySha256,
                datacenterFixtureValidation.expectedBodySha256,
                'the fulfilled response hash must match the prepared fixture',
              );
              assert.equal(
                datacenterFixtureValidation.deliveredFeatureCount,
                datacenterFixtureValidation.expectedFeatureCount,
                'the fulfilled response population must match the prepared fixture',
              );
              assert.equal(
                datacenterAssetRequests[0]?.fulfilled,
                true,
                'the bounded request history must prove fulfillment',
              );
              assert.equal(
                diagnostics.lod?.total,
                datacenterFixture.featureCount,
                'the materialized datacenter population must equal the delivered fixture',
              );
              assert.equal(
                datacenterFixtureValidation.preloadEnabledObserved,
                true,
                'fixture preflight must show at least one materialized feature in the declared camera view',
              );
              assert.equal(
                datacenterFixtureValidation.preloadDisabledObserved,
                true,
                'fixture preflight must leave the layer disabled after materialization',
              );
              datacenterFixtureValidation.status = 'validated';
            } catch (error) {
              datacenterFixtureValidation.status = 'failed';
              datacenterFixtureValidation.preloadFailureCameraPose = await page
                .evaluate(readSoakDatacenterCameraPoseInPage)
                .catch(() => null);
              datacenterFixtureValidation.failureReason = `${error?.message || String(error)}; final fixture camera pose: ${JSON.stringify(datacenterFixtureValidation.preloadFailureCameraPose)}`;
              throw error;
            } finally {
              await stopSoakDatacenterPreflightWitness(
                page,
                datacenterFixtureValidation,
              );
            }
          })();
        await datacenterFixtureValidationPromise;
        return createSoakDatacenterFixtureReceipt(
          datacenterFixtureValidation,
          datacenterAssetRequests,
        );
      },
      readDatacenterSoakFixtureReceipt() {
        return createSoakDatacenterFixtureReceipt(
          datacenterFixtureValidation,
          datacenterAssetRequests,
        );
      },
      async metrics() {
        const consoleHandleOwnership = await assertSoakConsoleOwnership(page);
        return {
          ...(await page.metrics()),
          consoleHandleOwnership,
        };
      },
      /**
       * Export the synthetic recording used by the soak as a portable bundle.
       * The rendered soak runs in an isolated browser context, so a share URL
       * containing only `ir=recording-rendered-soak` cannot be reopened from
       * the operator's normal Chrome profile unless this bundle is transferred.
       */
      async exportRecordingBundle(id = 'recording-rendered-soak') {
        const recording = await page.evaluate(async (recordingId) => {
          const app = window.__godsEyeView;
          const exported =
            await app?.aircraftRecording?.exportRecording?.(recordingId);
          if (!exported) return null;
          return {
            ...exported,
            chunks:
              exported.chunks instanceof Map
                ? Object.fromEntries(exported.chunks)
                : exported.chunks,
          };
        }, id);
        return recording ? createRecordingBundle(recording) : null;
      },
      async retainedMetrics() {
        const consoleHandleOwnership = await assertSoakConsoleOwnership(page);
        await session.send('HeapProfiler.collectGarbage');
        const application = await page.evaluate(() => {
          const app = window.__godsEyeView;
          const snapshot = app?.getPerformanceSnapshot?.();
          return snapshot
            ? {
                resources: snapshot.resources || null,
                scene: snapshot.scene || null,
                timings: snapshot.timings || null,
                workers: window.__gevSoakWorkers?.snapshot() || null,
              }
            : null;
        });
        const nativeEvidence = nativeResolution
          ? assertNativeResolutionEvidence(
              await page.evaluate(readNativeResolutionEvidenceInPage),
              nativeDpr,
              'Retained soak checkpoint',
              initialNativeResolution,
            )
          : null;
        return {
          ...(await page.metrics()),
          ...(await session.send('Memory.getDOMCounters')),
          application,
          consoleHandleOwnership,
          renderedFrames: previousFrames,
          nativeResolution: nativeEvidence,
          garbageCollection: {
            status: 'completed',
            method: 'HeapProfiler.collectGarbage',
          },
        };
      },
      close: closeSoak,
    };
  } catch (error) {
    try {
      error.browserClose = await closeSoak();
    } catch (cleanupError) {
      error.browserClose = cleanupError.browserClose || {
        closeCompleted: false,
      };
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}
