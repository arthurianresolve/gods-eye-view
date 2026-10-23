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
} from '/src/overlays/worldOverlay.js';

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
  schema: 'gev-s52-canvas2d-visual-stage/v1',
  status: 'running',
  scope:
    'Real browser Canvas2D and production worldOverlay module with a deterministic mock viewer/event/camera; not Cesium rendering, GPU, full application, or performance evidence.',
  runtime: { userAgent: navigator.userAgent, cesiumVersion: Cesium.VERSION },
  fixture: { initialViewport: [800, 600], initialDpr: 1, cases: 0 },
  cases: [],
};
window.__s52VisualStageResult = report;

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
  // Snapshot every mutable observer synchronously. Hashing and PNG export are
  // asynchronous work and must not let a later frame alter this sample.
  const pixelBytes = new Uint8ClampedArray(data);
  const imagePng = canvas.toDataURL('image/png');
  const pixels = pixelBytes;
  let nonTransparentPixels = 0;
  let alphaSum = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    alphaSum += pixels[i];
    if (pixels[i] > 0) nonTransparentPixels++;
  }
  const diagnostics = getWorldOverlayDiagnostics();
  const rects = ['north', 'middle', 'east', 'periodic', 'focus']
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
  return { ...synchronousSnapshot, pixelsSha256: hash };
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
      ...window.__s52VisualStageResult,
      status: 'failed',
      error: String(error?.stack || error),
    };
    window.__s52VisualStageResult = report;
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
