import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../../src/ui/styles/foundation.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import {
  destroyWorldOverlay,
  getOverlayPaintRect,
  getWorldOverlayDiagnostics,
  hitTestWorldOverlay,
  initWorldOverlay,
  setOverlayEntries,
} from '../../src/overlays/worldOverlay.js';
import { WORLD_OVERLAY_STYLE } from '../../src/overlays/worldOverlayTokens.js';

const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const resultNode = document.querySelector('#result');
const viewerNode = document.querySelector('#viewer');
const replacementViewerNode = document.querySelector('#replacement-viewer');
const FONT_FAMILY = 'JetBrains Mono';
const FONT_TEXT = 'WWWWWWWWWWWW font wake 0123456789';
const SOURCE_ID = 's52-font-wake-fixture';
const ENTRY_ID = 'font-measurement';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

function appCommit() {
  return typeof __GEV_APP_COMMIT__ === 'string'
    ? __GEV_APP_COMMIT__
    : 'unknown';
}

function installRenderCounter(scene) {
  const descriptor = Object.getOwnPropertyDescriptor(scene, 'requestRender');
  const original = scene.requestRender;
  const counter = { calls: 0 };
  scene.requestRender = function countedRequestRender(...args) {
    counter.calls++;
    return original.apply(this, args);
  };
  return {
    counter,
    restore() {
      if (descriptor) Object.defineProperty(scene, 'requestRender', descriptor);
      else delete scene.requestRender;
    },
  };
}

function makeViewer(container) {
  const viewer = createApplicationViewer({
    container,
    creditContainer: document.querySelector('#credits'),
  });
  const scene = viewer.scene;
  scene.globe.show = false;
  scene.skyBox.show = false;
  scene.skyAtmosphere.show = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.requestRenderMode = true;
  scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  viewer.clock.shouldAnimate = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 9000),
    orientation: {
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  });
  return viewer;
}

function publishEntry() {
  setOverlayEntries(
    SOURCE_ID,
    [
      {
        id: ENTRY_ID,
        position: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 20),
        variant: 'selected',
        title: FONT_TEXT,
        details: ['STATIC FONT METRICS'],
        selected: true,
        protected: true,
        horizonCull: false,
        edgeFade: 'none',
        interactive: true,
        accessibilityLabel: 'Font wake target',
        activate() {},
      },
    ],
    { visible: true, moving: false },
  );
}

function waitForPostRender(viewer, predicate, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = performance.now();
    let remove = () => {};
    let timer = null;
    let finished = false;
    const finish = (passed) => {
      if (finished) return;
      finished = true;
      remove();
      if (timer !== null) clearTimeout(timer);
      resolve({ passed, elapsedMs: performance.now() - start });
    };
    const onPostRender = () => {
      try {
        if (predicate()) finish(true);
      } catch {
        finish(false);
      }
    };
    remove = viewer.scene.postRender.addEventListener(onPostRender);
    timer = setTimeout(() => finish(false), timeoutMs);
    onPostRender();
  });
}

function waitForQuietScene(
  viewer,
  readFrameCount,
  quietMs = 250,
  timeoutMs = 4000,
) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    let finished = false;
    const remove = viewer.scene.postRender.addEventListener(() => {
      lastFrameAt = performance.now();
    });
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - startedAt;
      if (now - lastFrameAt >= quietMs) finish(true, elapsedMs);
      else if (elapsedMs >= timeoutMs) finish(false, elapsedMs);
    }, 25);
    const finish = (passed, elapsedMs) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      remove();
      resolve({
        passed,
        elapsedMs,
        quietMs: passed ? performance.now() - lastFrameAt : 0,
        observedFrameCount: readFrameCount(),
      });
    };
  });
}

function snapshotCanvas() {
  const canvas = document.getElementById('world-overlay-canvas');
  if (
    !canvas ||
    canvas.tagName !== 'CANVAS' ||
    !canvas.closest('#world-overlay-root') ||
    canvas.width < 1 ||
    canvas.height < 1
  )
    return null;
  const data = new Uint8Array(
    canvas
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data,
  );
  let nonTransparentPixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) nonTransparentPixels++;
  }
  return {
    width: canvas.width,
    height: canvas.height,
    nonTransparentPixels,
    data,
  };
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function finishSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    width: snapshot.width,
    height: snapshot.height,
    nonTransparentPixels: snapshot.nonTransparentPixels,
    pixelSha256: await sha256(snapshot.data),
  };
}

function textWidth(font) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  return context.measureText(FONT_TEXT).width;
}

async function installAndLoadFont() {
  const face = new FontFace(FONT_FAMILY, 'url(./font-wake.ttf)', {
    weight: '100 900',
    style: 'normal',
  });
  document.fonts.add(face);
  await face.load();
  await document.fonts.load(WORLD_OVERLAY_STYLE.fontSelected, FONT_TEXT);
  check(face.status === 'loaded', 'Pinned local FontFace did not load.');
  check(
    document.fonts.check(WORLD_OVERLAY_STYLE.fontSelected, FONT_TEXT),
    'The overlay font face is not available after loading.',
  );
  return face;
}

async function verifyFontAsset() {
  const response = await fetch('./font-wake.ttf', { cache: 'no-store' });
  check(response.ok, `Local font request failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256(bytes);
  check(
    digest ===
      'd7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134',
    `Pinned font bytes changed (${digest}).`,
  );
  return { sha256: digest, byteLength: bytes.length };
}

function recordCheck(report, id, passed, details) {
  report.checks.push({ id, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) report.failures.push(id);
}

async function runDiagnostic() {
  const report = {
    schema: 'gev-s52-font-wake/v1',
    applicationCommit: appCommit(),
    harness: 'font-wake.mjs',
    capturedAt: new Date().toISOString(),
    scope:
      'real Cesium request-render and Canvas2D font invalidation correctness; no performance claim',
    font: {
      familyAlias: FONT_FAMILY,
      source: './font-wake.ttf',
      expectedSha256:
        'd7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134',
      loadedFamily: null,
    },
    environment: {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      visibilityState: document.visibilityState,
      viewport: { width: innerWidth, height: innerHeight },
    },
    idle: null,
    checks: [],
    failures: [],
    status: 'running',
  };
  window.__s52FontWakeResult = report;
  let viewer;
  let replacementViewer;
  let renderCounter;
  let replacementRenderCounter;
  let frameRemove = () => {};
  let replacementFrameRemove = () => {};
  let loadedFace;
  const addedFaces = [];
  let backgrounded = document.visibilityState !== 'visible';
  let viewportChanged = false;
  const initialViewport = { width: innerWidth, height: innerHeight };
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  const onResize = () => {
    if (
      innerWidth !== initialViewport.width ||
      innerHeight !== initialViewport.height
    )
      viewportChanged = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onResize);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit),
      'Fixture server must define an exact application commit.',
    );
    check(
      document.visibilityState === 'visible',
      'Run this diagnostic in a visible foreground tab.',
    );
    check(window.devicePixelRatio > 0, 'Invalid device pixel ratio.');
    await document.fonts.ready;
    const fontPresentBeforeLoad = [...document.fonts].some(
      (face) =>
        face.family.replaceAll('"', '').replaceAll("'", '') === FONT_FAMILY,
    );
    check(!fontPresentBeforeLoad, 'Font family alias was already installed.');
    report.font.presentBeforeLoad = fontPresentBeforeLoad;

    viewer = makeViewer(viewerNode);
    const gl =
      viewer.canvas.getContext('webgl2') || viewer.canvas.getContext('webgl');
    const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    report.environment.cesiumVersion = Cesium.VERSION;
    report.environment.renderer = rendererInfo
      ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(gl.RENDERER) || null;
    report.environment.sceneSettings = {
      requestRenderMode: viewer.scene.requestRenderMode,
      maximumRenderTimeChange: String(viewer.scene.maximumRenderTimeChange),
      drawingBuffer: {
        width: viewer.canvas.width,
        height: viewer.canvas.height,
      },
      cssCanvas: (() => {
        const rect = viewer.canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })(),
    };
    initWorldOverlay(viewer);
    publishEntry();
    let frames = 0;
    frameRemove = viewer.scene.postRender.addEventListener(() => frames++);
    const firstFrame = await waitForPostRender(viewer, () => frames > 0, 5000);
    check(firstFrame.passed, 'Initial overlay frame did not arrive.');
    renderCounter = installRenderCounter(viewer.scene);
    const initialSettleRequests = renderCounter.counter.calls;
    const initialSettling = await waitForQuietScene(viewer, () => frames);
    initialSettling.requestRenderCalls =
      renderCounter.counter.calls - initialSettleRequests;
    report.initialSettling = initialSettling;
    check(
      initialSettling.passed,
      'Initial scene did not reach a natural quiet interval.',
    );
    const initialRectValue = getOverlayPaintRect(SOURCE_ID, ENTRY_ID);
    const initialRect = initialRectValue
      ? {
          x: initialRectValue.x,
          y: initialRectValue.y,
          w: initialRectValue.w,
          h: initialRectValue.h,
        }
      : null;
    check(initialRect?.w > 0 && initialRect?.h > 0, 'Overlay did not paint.');
    const initialCanvasRaw = snapshotCanvas();
    const initialDiagnostics = getWorldOverlayDiagnostics();
    const fallbackTextWidth = textWidth(WORLD_OVERLAY_STYLE.fontSelected);
    check(
      initialCanvasRaw?.nonTransparentPixels > 100,
      'Initial overlay canvas is empty.',
    );

    const idleFrameStart = frames;
    const idleRequestStart = renderCounter.counter.calls;
    const idleStartedAt = performance.now();
    await wait(800);
    report.idle = {
      durationMs: 800,
      observedMs: performance.now() - idleStartedAt,
      frameCount: frames - idleFrameStart,
      requestRenderCalls: renderCounter.counter.calls - idleRequestStart,
      framesAtStart: idleFrameStart,
      requestRenderMode: viewer.scene.requestRenderMode,
    };
    window.__s52FontWakeResult = report;
    check(
      report.idle.observedMs >= 790 &&
        report.idle.frameCount === 0 &&
        report.idle.requestRenderCalls === 0,
      `Scene was not parked before font load (${report.idle.frameCount} frames).`,
    );

    statusNode.textContent = 'Loading the pinned local font after idle';
    const beforeFontRequests = renderCounter.counter.calls;
    const beforeFontFrames = frames;
    const beforeFontSolveRevision = getWorldOverlayDiagnostics().solveRevision;
    loadedFace = await installAndLoadFont();
    addedFaces.push(loadedFace);
    report.font.asset = await verifyFontAsset();
    report.font.loadedFamily = loadedFace.family;
    const fontEventWait = await waitForPostRender(
      viewer,
      () => frames > beforeFontFrames,
      1800,
    );
    const afterFontRect = getOverlayPaintRect(SOURCE_ID, ENTRY_ID);
    const afterDiagnostics = getWorldOverlayDiagnostics();
    const afterCanvasRaw = snapshotCanvas();
    const afterHit = afterFontRect
      ? hitTestWorldOverlay(
          afterFontRect.x + afterFontRect.w / 2,
          afterFontRect.y + afterFontRect.h / 2,
          { sourceId: SOURCE_ID },
        )
      : null;
    const loadedTextWidth = textWidth(WORLD_OVERLAY_STYLE.fontSelected);
    const initialCanvas = await finishSnapshot(initialCanvasRaw);
    const afterCanvas = await finishSnapshot(afterCanvasRaw);
    report.primary = {
      firstFrame,
      fontEventWait,
      requestRenderDelta: renderCounter.counter.calls - beforeFontRequests,
      frameDelta: frames - beforeFontFrames,
      solveRevisionBefore: beforeFontSolveRevision,
      solveRevisionAfter: afterDiagnostics.solveRevision,
      rectBefore: {
        x: initialRect.x,
        y: initialRect.y,
        w: initialRect.w,
        h: initialRect.h,
      },
      rectAfter: afterFontRect
        ? {
            x: afterFontRect.x,
            y: afterFontRect.y,
            w: afterFontRect.w,
            h: afterFontRect.h,
          }
        : null,
      initialPaintedCount: initialDiagnostics.paintedCount,
      finalPaintedCount: afterDiagnostics.paintedCount,
      fallbackTextWidth,
      loadedTextWidth,
      initialCanvas,
      afterCanvas,
      hitIdentity: afterHit
        ? { sourceId: afterHit.sourceId, entryId: afterHit.entryId }
        : null,
    };
    window.__s52FontWakeResult = report;
    const primaryPassed =
      report.primary.requestRenderDelta > 0 &&
      report.primary.frameDelta > 0 &&
      report.primary.solveRevisionAfter > report.primary.solveRevisionBefore &&
      report.primary.rectAfter &&
      report.primary.rectAfter.w !== report.primary.rectBefore.w &&
      loadedTextWidth !== fallbackTextWidth &&
      report.primary.initialCanvas?.nonTransparentPixels > 100 &&
      report.primary.afterCanvas?.nonTransparentPixels > 100 &&
      report.primary.initialCanvas.pixelSha256 !==
        report.primary.afterCanvas.pixelSha256 &&
      report.primary.hitIdentity?.sourceId === SOURCE_ID &&
      report.primary.hitIdentity?.entryId === ENTRY_ID;
    recordCheck(
      report,
      'idle-font-load-recomputes-layout-and-hit-bounds',
      primaryPassed,
      {
        requestRenderDelta: report.primary.requestRenderDelta,
        frameDelta: report.primary.frameDelta,
        textWidthChanged: loadedTextWidth !== fallbackTextWidth,
        rectWidthChanged:
          report.primary.rectAfter?.w !== report.primary.rectBefore.w,
        pixelHashChanged:
          report.primary.initialCanvas?.pixelSha256 !==
          report.primary.afterCanvas?.pixelSha256,
      },
    );

    statusNode.textContent = 'Checking replacement-host listener ownership';
    // Tear down the first host before beginning a second real FontFaceSet load.
    // Keep the old Cesium viewer alive so any late callback/frame is observable.
    destroyWorldOverlay();
    replacementViewer = makeViewer(replacementViewerNode);
    initWorldOverlay(replacementViewer);
    publishEntry();
    let replacementFrames = 0;
    replacementFrameRemove =
      replacementViewer.scene.postRender.addEventListener(
        () => replacementFrames++,
      );
    const replacementInitial = await waitForPostRender(
      replacementViewer,
      () => replacementFrames > 0,
      5000,
    );
    check(replacementInitial.passed, 'Replacement overlay did not initialize.');
    replacementRenderCounter = installRenderCounter(replacementViewer.scene);
    const [oldHostSettling, replacementSettling] = await Promise.all([
      waitForQuietScene(viewer, () => frames),
      waitForQuietScene(replacementViewer, () => replacementFrames),
    ]);
    report.replacement = {
      initial: replacementInitial,
      preloadIdle: {
        oldHost: oldHostSettling,
        replacement: replacementSettling,
      },
    };
    check(
      oldHostSettling.passed && replacementSettling.passed,
      'Old and replacement scenes must both be naturally parked before the second font load.',
    );
    const replacementRequestsBefore = replacementRenderCounter.counter.calls;
    const replacementFramesBefore = replacementFrames;
    const oldRequestsBeforeReplace = renderCounter.counter.calls;
    const oldFramesBeforeReplace = frames;
    check(
      document.fonts.delete(loadedFace),
      'Could not remove first loaded FontFace.',
    );
    const secondFace = new FontFace(FONT_FAMILY, 'url(./font-wake.ttf)', {
      weight: '100 900',
      style: 'normal',
    });
    document.fonts.add(secondFace);
    addedFaces.push(secondFace);
    const secondLoad = secondFace.load();
    await secondLoad;
    await document.fonts.load(WORLD_OVERLAY_STYLE.fontSelected, FONT_TEXT);
    const replacementFontWait = await waitForPostRender(
      replacementViewer,
      () => replacementFrames > replacementFramesBefore,
      1800,
    );
    await wait(250);
    report.replacement = {
      initial: replacementInitial,
      fontEventWait: replacementFontWait,
      preloadIdle: {
        oldHost: oldHostSettling,
        replacement: replacementSettling,
      },
      oldHostRequestDelta:
        renderCounter.counter.calls - oldRequestsBeforeReplace,
      oldHostFrameDelta: frames - oldFramesBeforeReplace,
      replacementRequestDelta:
        replacementRenderCounter.counter.calls - replacementRequestsBefore,
      replacementFrameDelta: replacementFrames - replacementFramesBefore,
      overlayStillOwnedByReplacement:
        getOverlayPaintRect(SOURCE_ID, ENTRY_ID)?.w > 0,
      status: 'observed',
    };
    window.__s52FontWakeResult = report;
    const replacementPassed =
      report.replacement.oldHostRequestDelta === 0 &&
      report.replacement.oldHostFrameDelta === 0 &&
      report.replacement.replacementRequestDelta > 0 &&
      report.replacement.replacementFrameDelta > 0 &&
      report.replacement.overlayStillOwnedByReplacement;
    recordCheck(
      report,
      'font-event-wakes-current-host-only',
      replacementPassed,
      {
        oldHostRequestDelta: report.replacement.oldHostRequestDelta,
        oldHostFrameDelta: report.replacement.oldHostFrameDelta,
        replacementRequestDelta: report.replacement.replacementRequestDelta,
        replacementFrameDelta: report.replacement.replacementFrameDelta,
      },
    );

    recordCheck(
      report,
      'foreground-and-viewport-stable',
      !backgrounded && !viewportChanged,
      {
        backgrounded,
        viewportChanged,
        initialViewport,
        finalViewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio: window.devicePixelRatio,
      },
    );

    report.status = report.failures.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.error = {
      name: error?.name || 'Error',
      message: String(error?.message || error).slice(0, 800),
    };
  } finally {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onResize);
    try {
      frameRemove();
      replacementFrameRemove();
      destroyWorldOverlay();
    } catch (error) {
      report.cleanupError = String(error?.message || error).slice(0, 400);
      report.status = 'failed';
    }
    for (const face of addedFaces) document.fonts.delete(face);
    try {
      renderCounter?.restore();
      replacementRenderCounter?.restore();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      if (replacementViewer && !replacementViewer.isDestroyed())
        replacementViewer.destroy();
    } catch (error) {
      report.cleanupError = String(error?.message || error).slice(0, 400);
      report.status = 'failed';
    }
    report.finishedAt = new Date().toISOString();
    report.environment.finalVisibilityState = document.visibilityState;
    report.environment.backgrounded = backgrounded;
    report.environment.viewportChanged = viewportChanged;
    report.environment.finalViewport = {
      width: innerWidth,
      height: innerHeight,
    };
    window.__s52FontWakeResult = report;
    resultNode.textContent = JSON.stringify(report, null, 2);
    downloadButton.disabled = false;
    statusNode.textContent = `Finished: ${report.status}`;
  }
  return report;
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  downloadButton.disabled = true;
  resultNode.textContent = '';
  statusNode.textContent = 'Initializing isolated Cesium viewer';
  await runDiagnostic();
});

downloadButton.addEventListener('click', () => {
  const report = window.__s52FontWakeResult;
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `s52-font-wake-${report.applicationCommit}-${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
