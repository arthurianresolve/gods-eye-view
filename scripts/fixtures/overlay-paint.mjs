import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  destroyWorldOverlay,
  getOverlayPaintRect,
  getWorldOverlayDiagnostics,
  hitTestWorldOverlay,
  initWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
  registerWorldOverlayPaintLane,
} from '/src/overlays/worldOverlay.js';
import { getWorldOverlayFontRevision } from '/src/overlays/worldOverlayDraw.js';
import { WORLD_OVERLAY_STYLE } from '/src/overlays/worldOverlayTokens.js';

const resultNode = document.querySelector('#result');
const sceneSurface = document.querySelector('#fixture-surface');
const sceneContainer = document.querySelector('#cesiumContainer');
const performanceNowDescriptor = Object.getOwnPropertyDescriptor(
  performance,
  'now',
);
const devicePixelRatioDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'devicePixelRatio',
);
let logicalTime = 1000;
let activationCount = 0;
let fixtureState = {};
const report = {
  schema: 'gev-s52-paint-canvas-comparison/v1',
  status: 'running',
  scope:
    'Real browser Canvas2D and production worldOverlay module with a deterministic mock viewer/event/camera; includes shared and separate custom-paint lanes and a local FontFace load. Not Cesium rendering, GPU, full application, or performance evidence.',
  runtime: { userAgent: navigator.userAgent, cesiumVersion: Cesium.VERSION },
  fixture: { initialViewport: [800, 600], initialDpr: 1, cases: 0 },
  cases: [],
};
window.__s52PaintStageResult = report;

class FixtureEvent {
  #listeners = new Set();

  addEventListener(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  raise(...args) {
    for (const listener of [...this.#listeners]) listener(...args);
  }
}

const postRender = new FixtureEvent();
const moveEnd = new FixtureEvent();
const viewerCanvas = {};
Object.defineProperties(viewerCanvas, {
  clientWidth: { get: () => sceneSurface.clientWidth },
  clientHeight: { get: () => sceneSurface.clientHeight },
});
const camera = {
  positionWC: new Cesium.Cartesian3(0, 0, 10_000_000),
  positionCartographic: { height: 1000 },
  viewMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),
  frustum: { projectionMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY) },
};
Object.defineProperty(camera, 'moveEnd', { value: moveEnd });
const viewer = {
  container: sceneContainer,
  canvas: viewerCanvas,
  camera,
  scene: {
    mode: Cesium.SceneMode.SCENE3D,
    postRender,
    requestCount: 0,
    requestRender() {
      this.requestCount++;
    },
  },
};

function setLogicalTime(value) {
  logicalTime = value;
}

function tick(deltaMs = 16) {
  logicalTime += deltaMs;
  postRender.raise();
}

function entry(id, x, y, overrides = {}) {
  return {
    id,
    position: new Cesium.Cartesian3(x, y, 0),
    variant: 'card',
    title: id,
    details: ['fixed visual stage', 'deterministic source'],
    selected: false,
    protected: true,
    interactive: true,
    accessibilityLabel: `Activate ${id}`,
    activate: () => {
      activationCount++;
      return true;
    },
    collisionGroup: id,
    horizonCull: false,
    edgeFade: 'none',
    accent: '#63d4ff',
    ...overrides,
  };
}

async function pixelEvidence() {
  const canvas = document.querySelector('#world-overlay-canvas');
  if (!canvas || canvas.width <= 0 || canvas.height <= 0)
    throw new Error('Overlay canvas has no backing store');
  const { data } = canvas
    .getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height);
  const detectionCanvas = document.querySelector(
    '#world-overlay-detection-surface',
  );
  if (
    !detectionCanvas ||
    detectionCanvas.width <= 0 ||
    detectionCanvas.height <= 0
  )
    throw new Error('Detection canvas has no backing store');
  const detectionData = detectionCanvas
    .getContext('2d')
    .getImageData(0, 0, detectionCanvas.width, detectionCanvas.height).data;
  // Snapshot every mutable observer synchronously. Hashing and PNG export are
  // asynchronous work and must not let a later frame alter this sample.
  const pixelBytes = new Uint8ClampedArray(data);
  const detectionPixelBytes = new Uint8ClampedArray(detectionData);
  const imagePng = canvas.toDataURL('image/png');
  const detectionImagePng = detectionCanvas.toDataURL('image/png');
  const pixels = pixelBytes;
  let nonTransparentPixels = 0;
  let alphaSum = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    alphaSum += pixels[i];
    if (pixels[i] > 0) nonTransparentPixels++;
  }
  const diagnostics = getWorldOverlayDiagnostics();
  const rectIds = ['north', 'middle', 'east', 'periodic', 'focus'];
  if (fixtureState.paintControl === 'ambient-selected-transition')
    rectIds.push('transition');
  const rects = rectIds
    .map((id) => [id, getOverlayPaintRect('s52-visual-stage', id)])
    .map(([id, rect]) => [
      id,
      rect
        ? {
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            anchorX: rect.anchorX,
            anchorY: rect.anchorY,
          }
        : null,
    ]);
  const hit = rects.map(([id, rect]) => {
    if (!rect) return [id, null];
    const result = hitTestWorldOverlay(
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      { sourceId: 's52-visual-stage' },
    );
    return [
      id,
      result ? { sourceId: result.sourceId, entryId: result.entryId } : null,
    ];
  });
  const titleBar = document.querySelector('#title-bar').getBoundingClientRect();
  const titleBarOverlap = rects.map(([id, rect]) => [
    id,
    !!rect &&
      rect.x < titleBar.right &&
      rect.x + rect.w > titleBar.left &&
      rect.y < titleBar.bottom &&
      rect.y + rect.h > titleBar.top,
  ]);
  const actions = [
    ...document.querySelectorAll('#world-overlay-action-list button'),
  ].map((button) => ({
    label: button.getAttribute('aria-label'),
    pressed: button.getAttribute('aria-pressed'),
    key: button.dataset.overlayActionKey,
  }));
  const accessibilityRoot = document.querySelector(
    '.world-overlay-accessibility',
  );
  const accessibilityStyle = accessibilityRoot
    ? getComputedStyle(accessibilityRoot)
    : null;
  const synchronousSnapshot = {
    nonTransparentPixels,
    alphaSum,
    imagePng,
    drawingBuffer: [canvas.width, canvas.height],
    cssCanvas: [canvas.clientWidth, canvas.clientHeight],
    viewport: [viewer.canvas.clientWidth, viewer.canvas.clientHeight],
    dpr: window.devicePixelRatio,
    rects,
    hit,
    titleBar: {
      x: titleBar.x,
      y: titleBar.y,
      width: titleBar.width,
      height: titleBar.height,
    },
    titleBarOverlap,
    actions,
    accessibility: accessibilityRoot
      ? {
          className: accessibilityRoot.className,
          clipPath: accessibilityStyle.clipPath,
          clip: accessibilityStyle.clip,
          width: accessibilityStyle.width,
          height: accessibilityStyle.height,
        }
      : null,
    activationCount,
    statusText:
      document.querySelector('#world-overlay-status')?.textContent || '',
    diagnostics: {
      candidateCount: diagnostics.candidateCount,
      projectedCount: diagnostics.projectedCount,
      paintedCount: diagnostics.paintedCount,
      hitRectCount: diagnostics.hitRectCount,
      entriesBySource: diagnostics.entriesBySource,
      paintedBySource: diagnostics.paintedBySource,
    },
    logicalTime,
    inputState: {
      ...fixtureState,
      cameraPositionWC: [
        camera.positionWC.x,
        camera.positionWC.y,
        camera.positionWC.z,
      ],
      cameraAltitudeM: camera.positionCartographic.height,
      sceneMode: viewer.scene.mode,
      viewMatrix: Array.from(camera.viewMatrix),
      projectionMatrix: Array.from(camera.frustum.projectionMatrix),
      viewport: [viewer.canvas.clientWidth, viewer.canvas.clientHeight],
      dpr: window.devicePixelRatio,
    },
  };
  const digest = await crypto.subtle.digest('SHA-256', pixelBytes);
  const hash = [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const detectionDigest = await crypto.subtle.digest(
    'SHA-256',
    detectionPixelBytes,
  );
  const detectionHash = [...new Uint8Array(detectionDigest)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  return {
    ...synchronousSnapshot,
    pixelsSha256: hash,
    detectionPixelsSha256: detectionHash,
    detectionImagePng,
    detectionDrawingBuffer: [detectionCanvas.width, detectionCanvas.height],
  };
}

async function captureCase(cases, name) {
  cases.push({ name, ...(await pixelEvidence()) });
  report.fixture.cases = cases.length;
}

function setDpr(value) {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value,
  });
}

async function run() {
  // Freeze the fixture's initial scale before the production module creates
  // its backing canvas. CSS size and DPR changes are measured separately.
  setDpr(1);
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => logicalTime,
  });
  setLogicalTime(1000);
  await document.fonts?.ready;
  await settleObservers();
  const cases = report.cases;
  const moving = new Cesium.Cartesian3(-0.4, 0.05, 0);
  let alpha = 1;
  let scale = 1;
  let tickIndex = 0;
  const baseEntries = [
    entry('north', -0.72, 0.76, { variant: 'selected', selected: true }),
    entry('middle', -0.05, -0.08),
    entry('east', 0.72, -0.42),
    entry('periodic', 0.15, 0.58, { position: () => moving }),
    entry('focus', -0.62, 0.82, {
      sourceAlpha: () => alpha,
      presentationScale: () => scale,
    }),
  ];

  initWorldOverlay(viewer);
  setOverlayEntries('s52-visual-stage', baseEntries, {
    visible: true,
    alpha: 0.92,
    cohortLimit: 12,
    collisionCapacity: 12,
    moving: true,
    solveIntervalMs: 16,
  });
  // First paint lets the production observer discover/observe the title bar.
  tick(16);
  await settleObservers();
  fixtureState = { observerWarmup: true };
  await captureCase(cases, 'ui-occluder-before-move');
  await settleObservers();
  // Leave the title occluder away from entries during the steady-state control.
  setTitleRect(530, 12, 245, 72);
  await settleObservers();
  // The production occluder inventory is cadence-limited to 100 ms.
  tick(120);
  await settleObservers();
  await paintFrames(1);
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'stable-0');
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'stable-1');
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'stable-2');

  const sample = (name) => cases.find((item) => item.name === name);
  const stableSamples = ['stable-0', 'stable-1', 'stable-2'].map(sample);
  assert(
    stableSamples.every((item) => item?.nonTransparentPixels > 500),
    'Stable overlay control must paint substantial non-background output',
  );
  assert(
    stableSamples[0].pixelsSha256 === stableSamples[1].pixelsSha256 &&
      stableSamples[1].pixelsSha256 === stableSamples[2].pixelsSha256,
    'Settled repeat frames must be pixel-identical',
  );
  assert(
    stableSamples[0].actions.length > 0,
    'Expected at least one accessible action',
  );
  assert(
    stableSamples[0].accessibility?.className ===
      'world-overlay-accessibility' &&
      (stableSamples[0].accessibility.clipPath.includes('inset') ||
        stableSamples[0].accessibility.clip !== 'auto'),
    'Accessibility action list must use the visually-hidden production host class',
  );

  setOverlayEntries(
    's52-fade-stage',
    [
      entry('fade', 0.44, -0.62, {
        variant: 'label',
        protected: false,
        selected: false,
      }),
    ],
    {
      visible: true,
      alpha: 1,
      cohortLimit: 4,
      collisionCapacity: 4,
      moving: false,
    },
  );
  fixtureState = {
    fadePhase: 'enter-start',
    fadeSource: 's52-fade-stage',
    logicalClock: logicalTime,
  };
  tick(16);
  await captureCase(cases, 'deterministic-fade-enter-start');
  fixtureState = {
    fadePhase: 'enter-mid',
    fadeSource: 's52-fade-stage',
    logicalClock: logicalTime + 120,
  };
  tick(120);
  await captureCase(cases, 'deterministic-fade-enter-mid');
  fixtureState = {
    fadePhase: 'enter-complete',
    fadeSource: 's52-fade-stage',
    logicalClock: logicalTime + 300,
  };
  tick(300);
  await captureCase(cases, 'deterministic-fade-enter-complete');
  const fadeStart = sample('deterministic-fade-enter-start');
  const fadeMid = sample('deterministic-fade-enter-mid');
  const fadeComplete = sample('deterministic-fade-enter-complete');
  assert(
    fadeStart.pixelsSha256 !== fadeMid.pixelsSha256 &&
      fadeMid.pixelsSha256 !== fadeComplete.pixelsSha256,
    'LabelArbiter enter fade must produce distinct deterministic Canvas2D frames',
  );
  assert(
    fadeStart.nonTransparentPixels > 0 &&
      fadeComplete.alphaSum > fadeStart.alphaSum,
    'Fade-in witness must show a visible label growing from its initial state',
  );
  clearOverlaySource('s52-fade-stage');
  fixtureState = {
    fadePhase: 'exit-start',
    fadeSource: 's52-fade-stage',
    logicalClock: logicalTime + 16,
  };
  tick(16);
  await captureCase(cases, 'deterministic-fade-exit-start');
  fixtureState = {
    fadePhase: 'exit-complete',
    fadeSource: 's52-fade-stage',
    logicalClock: logicalTime + 300,
  };
  tick(300);
  await captureCase(cases, 'deterministic-fade-exit-complete');
  const fadeExitStart = sample('deterministic-fade-exit-start');
  const fadeExitComplete = sample('deterministic-fade-exit-complete');
  assert(
    fadeExitStart.diagnostics.paintedBySource['s52-fade-stage'] > 0 &&
      fadeExitComplete.diagnostics.paintedBySource['s52-fade-stage'] ===
        undefined,
    'clearOverlaySource must show the actual arbiter exit fade and then settle',
  );
  assert(
    fadeExitStart.pixelsSha256 !== fadeExitComplete.pixelsSha256,
    'Fade-out witness must capture distinct active and settled frames',
  );

  moving.x = -0.18;
  tickIndex++;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'moving-1');
  moving.y = 0.22;
  tickIndex++;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'moving-2');

  tickIndex++;
  if (tickIndex % 3 === 0) moving.x = 0.26;
  tick(48);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'periodic-update');
  tickIndex++;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'periodic-hold');

  camera.viewMatrix[12] = 0.12;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'camera-view-translation');
  camera.frustum.projectionMatrix[0] = 1.15;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'camera-projection-scale');
  camera.positionWC.x = 25;
  camera.positionCartographic.height = 2500;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'camera-position-altitude');

  setOverlayEntries(
    's52-visual-stage',
    [
      entry('north', -0.72, 0.76, {
        variant: 'card',
        selected: false,
        title: 'North revised',
        details: ['selection change'],
      }),
      entry('middle', -0.05, -0.08, {
        title: 'Middle revised',
        accent: '#ffcc55',
      }),
      entry('east', 0.72, -0.42),
      entry('periodic', 0.15, 0.58, { position: () => moving }),
      entry('focus', -0.62, 0.82, {
        sourceAlpha: () => alpha,
        presentationScale: () => scale,
      }),
    ],
    {
      visible: true,
      alpha: 0.92,
      cohortLimit: 12,
      collisionCapacity: 12,
      moving: true,
      solveIntervalMs: 16,
    },
  );
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'replacement-style-selection');
  alpha = 0.48;
  scale = 0.72;
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
  };
  await captureCase(cases, 'presentation-callback-change');
  setOverlaySourceVisible('s52-visual-stage', false);
  tick(320);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
    sourceVisible: false,
  };
  await captureCase(cases, 'source-hidden');
  assert(
    cases.at(-1).diagnostics.paintedBySource['s52-visual-stage'] ===
      undefined && cases.at(-1).diagnostics.hitRectCount === 0,
    'Hidden-source case must have no painted or actionable overlay entries',
  );
  setOverlaySourceVisible('s52-visual-stage', true);
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
    sourceVisible: true,
  };
  await captureCase(cases, 'source-restored');
  assert(
    cases.at(-1).diagnostics.paintedBySource['s52-visual-stage'] > 0,
    'Restoring the source must republish visible overlay output',
  );

  // DPR-only invalidation: CSS dimensions remain fixed.
  setDpr(1.25);
  window.dispatchEvent(new Event('resize'));
  await settleObservers();
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
    dprOnly: true,
  };
  await captureCase(cases, 'dpr-only-change');
  assert(
    cases.at(-1).dpr === 1.25 &&
      cases.at(-1).cssCanvas.join(',') === cases.at(-2).cssCanvas.join(','),
    'DPR-only case must preserve CSS dimensions',
  );

  // CSS resize invalidation with DPR held constant.
  setDpr(1.25);
  sceneSurface.style.width = '720px';
  sceneSurface.style.height = '520px';
  window.dispatchEvent(new Event('resize'));
  await settleObservers();
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
    sourceVisible: true,
  };
  await captureCase(cases, 'css-resize-only');
  assert(
    cases.at(-1).dpr === cases.at(-2).dpr &&
      cases.at(-1).cssCanvas[0] < cases.at(-2).cssCanvas[0],
    'CSS resize case must hold DPR and reduce CSS width',
  );

  // Move a real DOM occluder after initialization; the production observers
  // must refresh placement and hit rectangles around it.
  const beforeOccluder = getOverlayPaintRect('s52-visual-stage', 'east');
  assert(beforeOccluder, 'Occluder control needs an east entry rectangle');
  setTitleRect(
    beforeOccluder.x + beforeOccluder.w / 2 - 100,
    beforeOccluder.y + beforeOccluder.h / 2 - 30,
    200,
    60,
  );
  await settleObservers();
  tick(120);
  await settleObservers();
  tick(16);
  fixtureState = { occluderMoved: true, sourceVisible: true };
  await captureCase(cases, 'ui-occluder-observed');
  const occlusionSample = cases.at(-1);
  const beforeOccluderSample = sample('ui-occluder-before-move');
  assert(
    occlusionSample.titleBar.x !== beforeOccluderSample.titleBar.x ||
      occlusionSample.titleBar.y !== beforeOccluderSample.titleBar.y,
    'UI occluder must actually move after overlay initialization',
  );
  assert(
    occlusionSample.titleBarOverlap.every(([, overlap]) => !overlap),
    'Production layout must keep painted hit targets outside the moved UI occluder',
  );
  assert(
    occlusionSample.hit.every(([id, hit]) => !hit || hit.entryId === id),
    'Occluder refresh must preserve hit identity for retained targets',
  );

  const action = document.querySelector('#world-overlay-action-list button');
  assert(action, 'Expected an accessible action to activate');
  if (action) action.click();
  tick(16);
  fixtureState = {
    movingPosition: [moving.x, moving.y, moving.z],
    alpha,
    scale,
    tickIndex,
    sourceVisible: true,
  };
  await captureCase(cases, 'ui-occlusion-pick-accessibility');
  assert(
    activationCount > 0,
    'Accessible activation must invoke the entry action',
  );
  assert(
    cases.at(-1).statusText.length > 0,
    'Activation must publish an accessible status',
  );

  // Separate-surface detection painting continues while a stable shared label
  // frame is eligible for reuse. The two backing stores are measured exactly.
  let detectionPaint = 0;
  const detectionLane = registerWorldOverlayPaintLane(
    'detection',
    ({ ctx }) => {
      detectionPaint++;
      ctx.fillStyle = detectionPaint % 2 ? '#ff2874' : '#28e8a0';
      ctx.fillRect(352 + detectionPaint * 3, 326, 44, 31);
    },
    { id: 's52-paint-detection', target: 'detection', active: true },
  );
  tick(16);
  fixtureState = { paintControl: 'separate-detection', detectionPaint };
  await captureCase(cases, 'separate-detection-0');
  tick(16);
  fixtureState = { paintControl: 'separate-detection', detectionPaint };
  await captureCase(cases, 'separate-detection-1');
  assert(detectionPaint >= 2, 'Separate detection painter must run per frame');
  assert(
    sample('separate-detection-0').pixelsSha256 ===
      sample('separate-detection-1').pixelsSha256,
    'Separate detection work must not alter the shared label surface',
  );
  assert(
    sample('separate-detection-0').detectionPixelsSha256 !==
      sample('separate-detection-1').detectionPixelsSha256,
    'Separate detection surface must capture its changing paint output',
  );
  detectionLane.unregister();
  tick(16);

  fixtureState = { paintControl: 'shared-painter-release', phase: 'ordinary' };
  await captureCase(cases, 'shared-painter-before');
  assert(
    sample('shared-painter-before').hit.some(
      ([, hit]) => hit?.entryId === 'east',
    ) && sample('shared-painter-before').actions.length > 0,
    'Ordinary shared paint must be warm before the unsupported lane is installed',
  );

  // A shared-surface custom painter is a live mutation and must remain visible
  // on every frame; reuse cannot suppress its callback or its changed pixels.
  let sharedPaint = 0;
  const sharedLane = registerWorldOverlayPaintLane(
    'detection',
    ({ ctx }) => {
      sharedPaint++;
      ctx.fillStyle = sharedPaint % 2 ? '#ffe23b' : '#55aaff';
      ctx.fillRect(374 + sharedPaint * 4, 368, 37, 23);
    },
    { id: 's52-paint-shared', target: 'shared', active: true },
  );
  tick(16);
  fixtureState = { paintControl: 'shared-painter', sharedPaint };
  await captureCase(cases, 'shared-painter-0');
  tick(16);
  fixtureState = { paintControl: 'shared-painter', sharedPaint };
  await captureCase(cases, 'shared-painter-1');
  assert(sharedPaint >= 2, 'Shared painter must run on both frames');
  assert(
    sample('shared-painter-0').pixelsSha256 !==
      sample('shared-painter-1').pixelsSha256,
    'Shared painter changes must reach the shared Canvas2D surface',
  );
  assert(
    sample('shared-painter-1').hit.some(([, hit]) => hit?.entryId === 'east') &&
      sample('shared-painter-1').actions.length > 0,
    'Shared painter frames must retain production hits and accessible actions',
  );
  sharedLane.unregister();
  tick(16);
  fixtureState = {
    paintControl: 'shared-painter-release',
    phase: 'ordinary-after-release',
  };
  await captureCase(cases, 'shared-painter-after-release');
  tick(100);
  fixtureState = {
    paintControl: 'shared-painter-release',
    phase: 'ordinary-after-release-hold',
  };
  await captureCase(cases, 'shared-painter-after-release-hold');
  assertNotEqual(
    sample('shared-painter-1').pixelsSha256,
    sample('shared-painter-after-release').pixelsSha256,
    'Removing the unsupported shared painter must restore ordinary pixels',
  );
  assertEqual(
    sample('shared-painter-after-release').pixelsSha256,
    sample('shared-painter-after-release-hold').pixelsSha256,
    'Ordinary shared paint must settle after the unsupported lane is removed',
  );
  assert(
    sample('shared-painter-after-release-hold').hit.some(
      ([, hit]) => hit?.entryId === 'east',
    ) && sample('shared-painter-after-release-hold').actions.length > 0,
    'Ordinary hit and accessibility outputs must recover after lane release',
  );

  // Load the repository's pinned local font into a real FontFaceSet. This
  // checks that a font revision invalidates cached text/placement output.
  const fontSource = 's52-paint-font';
  const fontText = 'WWWWWWWWWWWW font wake 0123456789';
  const fontEntryId = 'font-measurement';
  setOverlayEntries(
    fontSource,
    [
      entry(fontEntryId, 0.03, 0.31, {
        variant: 'selected',
        selected: true,
        title: fontText,
        accessibilityLabel: 'Local font layout test',
      }),
    ],
    { visible: true, moving: false },
  );
  const metricContext = document.createElement('canvas').getContext('2d');
  metricContext.font = WORLD_OVERLAY_STYLE.fontSelected;
  const fontWidthBefore = metricContext.measureText(fontText).width;
  const fontRevisionBefore = getWorldOverlayFontRevision();
  tick(16);
  const fontRectBefore = getOverlayPaintRect(fontSource, fontEntryId);
  const fontHitBefore = fontRectBefore
    ? hitTestWorldOverlay(
        fontRectBefore.x + fontRectBefore.w / 2,
        fontRectBefore.y + fontRectBefore.h / 2,
        { sourceId: fontSource },
      )
    : null;
  fixtureState = {
    paintControl: 'font-load',
    fontRevision: fontRevisionBefore,
    fontWidth: fontWidthBefore,
    fontRect: fontRectBefore
      ? [fontRectBefore.x, fontRectBefore.y, fontRectBefore.w, fontRectBefore.h]
      : null,
    fontHit: fontHitBefore
      ? [fontHitBefore.sourceId, fontHitBefore.entryId]
      : null,
  };
  await captureCase(cases, 'font-before-load');

  const fontFace = new FontFace('JetBrains Mono', 'url(./paint-wake.ttf)', {
    weight: '100 900',
  });
  document.fonts.add(fontFace);
  await fontFace.load();
  await document.fonts.load(WORLD_OVERLAY_STYLE.fontSelected, fontText);
  await document.fonts.ready;
  await settleObservers();
  metricContext.font = WORLD_OVERLAY_STYLE.fontSelected;
  const fontWidthAfter = metricContext.measureText(fontText).width;
  const fontRevisionAfter = getWorldOverlayFontRevision();
  tick(16);
  const fontRectAfter = getOverlayPaintRect(fontSource, fontEntryId);
  const fontHitAfter = fontRectAfter
    ? hitTestWorldOverlay(
        fontRectAfter.x + fontRectAfter.w / 2,
        fontRectAfter.y + fontRectAfter.h / 2,
        { sourceId: fontSource },
      )
    : null;
  fixtureState = {
    paintControl: 'font-load',
    fontRevision: fontRevisionAfter,
    fontWidth: fontWidthAfter,
    fontRect: fontRectAfter
      ? [fontRectAfter.x, fontRectAfter.y, fontRectAfter.w, fontRectAfter.h]
      : null,
    fontHit: fontHitAfter
      ? [fontHitAfter.sourceId, fontHitAfter.entryId]
      : null,
    fontStatus: fontFace.status,
  };
  await captureCase(cases, 'font-after-load');
  assert(fontFace.status === 'loaded', 'Local FontFace must load successfully');
  assert(
    fontRevisionAfter > fontRevisionBefore,
    'FontFaceSet loading must advance the production font revision',
  );
  assert(
    Math.abs(fontWidthAfter - fontWidthBefore) > 1,
    'Pinned local font must change actual Canvas2D text metrics',
  );
  assert(
    sample('font-before-load').pixelsSha256 !==
      sample('font-after-load').pixelsSha256,
    'Font metric change must repaint actual label pixels',
  );
  assert(
    sample('font-after-load').actions.some(
      (item) => item.label === 'Local font layout test',
    ),
    'Font invalidation must preserve the corresponding accessible action',
  );
  assertEqual(
    fontHitBefore?.entryId,
    fontEntryId,
    'Font label hit before load',
  );
  assertEqual(fontHitAfter?.entryId, fontEntryId, 'Font label hit after load');
  assert(
    fontRectBefore &&
      fontRectAfter &&
      Math.abs(fontRectAfter.w - fontRectBefore.w) > 1 &&
      sample('font-after-load').inputState.fontHit?.[0] === fontSource &&
      sample('font-after-load').inputState.fontHit?.[1] === fontEntryId,
    'Font test must update its own rectangle width and retain hit identity',
  );

  // Selection promotion/demotion is a real output change. The intervening
  // 100 ms frames are stable holds: cached pixels may be retained, but the
  // current geometry, pick target, and accessible action must remain live.
  const transitionId = 'ambient-selected-transition';
  const transitionText = 'Selection transition title';
  const transitionEntry = (selected) =>
    entry('transition', 0.18, -0.24, {
      title: transitionText,
      variant: selected ? 'selected' : 'card',
      selected,
      accessibilityLabel: 'Selection transition action',
    });
  const setTransitionEntry = (selected) =>
    setOverlayEntries('s52-visual-stage', [transitionEntry(selected)], {
      visible: true,
      alpha: 0.92,
      cohortLimit: 12,
      collisionCapacity: 12,
      moving: false,
      solveIntervalMs: 16,
    });
  const assertTransitionEvidence = (name) => {
    const row = sample(name);
    const rect = row?.rects.find(([id]) => id === 'transition')?.[1];
    const hit = row?.hit.find(([id]) => id === 'transition')?.[1];
    assert(
      rect && rect.w > 0 && rect.h > 0,
      `${name} must retain current painted transition geometry`,
    );
    assertEqual(
      hit?.entryId,
      'transition',
      `${name} must retain the current transition hit identity`,
    );
    assert(
      row.actions.some((item) => item.label === 'Selection transition action'),
      `${name} must retain the transition accessible action`,
    );
    return row;
  };
  setTransitionEntry(false);
  tick(16);
  tick(500);
  fixtureState = {
    paintControl: transitionId,
    phase: 'ambient-promotion-source',
  };
  await captureCase(cases, 'selection-transition-ambient');
  assertTransitionEvidence('selection-transition-ambient');

  setTransitionEntry(true);
  tick(16);
  fixtureState = { paintControl: transitionId, phase: 'promoted-selected' };
  await captureCase(cases, 'selection-transition-selected');
  assertTransitionEvidence('selection-transition-selected');
  tick(100);
  fixtureState = { paintControl: transitionId, phase: 'selected-hold-100ms' };
  await captureCase(cases, 'selection-transition-selected-hold');
  assertTransitionEvidence('selection-transition-selected-hold');
  assertEqual(
    sample('selection-transition-selected-hold').pixelsSha256,
    sample('selection-transition-selected').pixelsSha256,
    'Selected stable hold must retain the exact promoted pixels',
  );

  setTransitionEntry(false);
  tick(16);
  // Let the ambient transition reach its settled presentation before using it
  // as the stable-hold reference. Capturing after only one frame would compare
  // an in-progress demotion against its next animation frame.
  tick(500);
  fixtureState = { paintControl: transitionId, phase: 'demoted-ambient' };
  await captureCase(cases, 'selection-transition-ambient-again');
  assertTransitionEvidence('selection-transition-ambient-again');
  tick(100);
  fixtureState = { paintControl: transitionId, phase: 'ambient-hold-100ms' };
  await captureCase(cases, 'selection-transition-ambient-hold');
  assertTransitionEvidence('selection-transition-ambient-hold');
  assertEqual(
    sample('selection-transition-ambient-hold').pixelsSha256,
    sample('selection-transition-ambient-again').pixelsSha256,
    'Ambient stable hold must retain the exact demoted pixels',
  );
  assertNotEqual(
    sample('selection-transition-selected').pixelsSha256,
    sample('selection-transition-ambient-again').pixelsSha256,
    'Selection promotion and demotion must each produce distinct pixels',
  );

  report.status = 'passed';
  report.final = {
    activationCount,
    requestRenderCount: viewer.scene.requestCount,
    accessibleActionCount: document.querySelectorAll(
      '#world-overlay-action-list button',
    ).length,
  };
  resultNode.textContent = JSON.stringify(report);
  return report;
}

async function start() {
  resultNode.textContent = 'running';
  try {
    await run();
  } catch (error) {
    const report = {
      ...window.__s52PaintStageResult,
      status: 'failed',
      error: String(error?.stack || error),
    };
    window.__s52PaintStageResult = report;
    resultNode.textContent = JSON.stringify(report);
  } finally {
    try {
      destroyWorldOverlay();
    } catch {}
    restoreOwnDescriptor(
      window,
      'devicePixelRatio',
      devicePixelRatioDescriptor,
    );
    restoreOwnDescriptor(performance, 'now', performanceNowDescriptor);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(Object.is(actual, expected), message);
}

function assertNotEqual(actual, expected, message) {
  assert(!Object.is(actual, expected), message);
}

function restoreOwnDescriptor(target, key, descriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else delete target[key];
}

function setTitleRect(left, top, width, height) {
  const titleBar = document.querySelector('#title-bar');
  Object.assign(titleBar.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    right: 'auto',
    bottom: 'auto',
  });
}

async function settleObservers() {
  await Promise.resolve();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await document.fonts?.ready;
}

async function paintFrames(count) {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    tick(16);
  }
}

document.querySelector('#run').addEventListener('click', start);
document.querySelector('#run').click();
