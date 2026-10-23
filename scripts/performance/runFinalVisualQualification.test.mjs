import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { retainDecorationFailureEvidence } from './decorationCaptureProof.mjs';
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

test('guard failure projection is self-contained, bounded, and omits page content', () => {
  const describe = vm.runInNewContext(
    `(${describeVisualPauseReadiness.toString()})`,
  );
  const detail = describe({
    phase: 2,
    reason: null,
    hud: {
      summary: 'private page content',
      summaryTypingComplete: true,
      documentFocused: false,
      documentVisible: true,
    },
  });
  assert.equal(detail.phase, 2);
  assert.equal(detail.summaryPresent, true);
  assert.equal(detail.documentFocused, false);
  assert.equal(detail.documentVisible, true);
  assert.equal(JSON.stringify(detail).includes('private page content'), false);
  assert.ok(JSON.stringify(detail).length < 4096);
  assert.equal(describe(null).phase, null);
});

test('visual guard requests only the missing canvas phase without a render hold', () => {
  let requests = 0;
  const request = vm.runInNewContext(
    `(${requestVisualGuardFrame.toString()})`,
    {
      window: {
        __godsEyeView: {
          viewer: {
            scene: {
              requestRender() {
                requests++;
              },
            },
          },
        },
      },
    },
  );
  assert.equal(request({ phase: 2, hud: { documentVisible: true } }), true);
  for (const snapshot of [
    null,
    { phase: 0, hud: { documentVisible: true } },
    { phase: 2, hud: { documentVisible: false } },
  ])
    assert.equal(request(snapshot), false);
  assert.equal(requests, 1);
});

test('atomic visual eligibility rejects advancing phases and incomplete presentation', () => {
  const ready = {
    phase: 0,
    reason: null,
    hud: {
      recordingVisible: true,
      summaryTypingComplete: true,
      summary: 'ready',
      documentVisible: true,
      documentFocused: true,
      gaze: { status: 'ready' },
      hudDisplay: 'block',
      hudOpacity: 1,
      hudVisible: true,
      hudVisibility: 'visible',
    },
  };
  // Execute the exact self-contained function used in the browser task.
  const eligible = vm.runInNewContext(
    `(${isVisualSnapshotReadyToPause.toString()})`,
  );
  assert.equal(eligible(ready), true);
  for (const patch of [
    { phase: 2 },
    { phase: null },
    { reason: 'hud-state-unsettled' },
  ])
    assert.equal(eligible({ ...ready, ...patch }), false);
  for (const patch of [
    { recordingVisible: false },
    { summaryTypingComplete: false },
    { summary: '' },
    { documentVisible: false },
    { documentFocused: false },
    { gaze: { status: 'pending' } },
    { hudOpacity: 0.5 },
    { hudDisplay: 'none' },
    { hudVisibility: 'hidden' },
  ])
    assert.equal(
      eligible({ ...ready, hud: { ...ready.hud, ...patch } }),
      false,
    );
  assert.equal(
    eligible({
      ...ready,
      hud: {
        ...ready.hud,
        hudVisible: false,
        hudOpacity: 0,
        hudVisibility: 'hidden',
      },
    }),
    true,
  );
  assert.equal(eligible(null), false);
});

function activationFixture(tilesLoaded) {
  const calls = [];
  let params = {};
  const module = {
    setParams: (value) => {
      calls.push('select');
      params = value;
    },
    getParams: () => params,
  };
  const app = {
    viewer: { scene: { globe: { tilesLoaded } } },
    dataManager: {
      setEnabled: async () => {
        calls.push('enable');
        return true;
      },
      isEnabled: () => true,
      layers: new Map([['cctv', { module }]]),
    },
    styleManager: {
      _adaptiveQuality: { getMode: () => 'manual' },
      services: {
        getDetectionMode: () => 'DENSE',
        getDetectionTuning: () => ({ densityPct: 75 }),
      },
    },
  };
  const activate = vm.runInNewContext(
    `(${activateQualificationCctvInPage.toString()})`,
    { window: { __godsEyeView: app } },
  );
  return { activate, calls, app, module };
}

test('CCTV activation never samples an unfinished or unknown globe surface', async () => {
  for (const ready of [false, undefined, null, 1]) {
    const fixture = activationFixture(ready);
    await assert.rejects(
      fixture.activate('fixture-camera'),
      /before CCTV activation/,
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test('serialized activation uses the production selection after surface readiness', async () => {
  const fixture = activationFixture(true);
  const result = await fixture.activate('fixture-camera');
  assert.deepEqual(fixture.calls, ['enable', 'select']);
  assert.equal(result.tilesLoadedBeforeActivation, true);
  assert.equal(result.cameraId, 'fixture-camera');
  assert.equal(fixture.module.getParams().selectedCameraId, 'fixture-camera');
  assert.equal(fixture.module.getParams().showProjection, true);
  assert.equal(fixture.module.getParams().autoHop, false);
});

test('ready surface does not hide enable, selection, or visual setting failures', async () => {
  const disabled = activationFixture(true);
  disabled.app.dataManager.setEnabled = async () => false;
  await assert.rejects(
    disabled.activate('fixture-camera'),
    /could not be enabled/,
  );
  assert.deepEqual(disabled.calls, []);
  const ignored = activationFixture(true);
  ignored.module.setParams = () => {};
  await assert.rejects(
    ignored.activate('fixture-camera'),
    /did not settle selected/,
  );
  const quality = activationFixture(true);
  quality.app.styleManager._adaptiveQuality.getMode = () => 'auto';
  await assert.rejects(quality.activate('fixture-camera'), /Manual DENSE/);
});

test('visual state page callback serializes without Node or outer bindings', () => {
  const checkpoint = {
    cameraCount: 1,
    cameraPose: { longitude: -97.7431, latitude: 30.2672 },
    cameraView: { containsFixture: true },
    scene: { entities: 1, dataSources: 0 },
  };
  const context = {
    window: {
      __godsEyeView: {
        styleManager: {
          services: {
            getDetectionTuning: () => ({ densityPct: 75 }),
            getDetectionMode: () => 'DENSE',
          },
          _adaptiveQuality: { getMode: () => 'manual' },
          getVisualState: () => ({ hud: { visible: true } }),
          hud: {
            getMode: () => 'on',
            visible: true,
            getVariant: () => 'tactical',
          },
        },
        viewer: {
          resolutionScale: 1,
          scene: {
            context: {
              _gl: { getContextAttributes: () => ({ antialias: false }) },
            },
            msaaSamples: 4,
            postProcessStages: { fxaa: { enabled: true } },
          },
        },
        dataManager: { layers: new Map() },
      },
      devicePixelRatio: 1,
    },
    document: { getElementById: () => ({ getAttribute: () => 'false' }) },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    Date: { now: () => Date.parse('2026-10-08T12:00:00.000Z') },
  };
  const source = `(${readQualificationStateInPage.toString()})`;
  const result = vm.runInNewContext(
    source,
    context,
  )({
    checkpointValue: checkpoint,
    profileValue: { id: 'native-sharpness-v1' },
  });
  assert.equal(result.settings.densityPct, 75);
  assert.equal(result.hud.visible, true);
  assert.equal(result.checkpoint.cameraView.containsFixture, true);
});

function phaseFixture({
  dpr = 2,
  phase = 0,
  mismatchedEdges = false,
  empty = false,
} = {}) {
  const reads = [];
  const canvas = {
    width: 1440 * dpr,
    height: 900 * dpr,
    getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    getContext: (...args) => {
      assert.deepEqual(
        args,
        ['2d'],
        'observation must not reconfigure the existing context',
      );
      return {
        getImageData: (x, y, width, height) => {
          reads.push({ x, y, width, height });
          assert.equal(width, canvas.width);
          assert.ok(height > 0 && y + height <= canvas.height);
          const data = new Uint8ClampedArray(width * height * 4);
          for (const column of [0, width - 1]) {
            const edgePhase =
              mismatchedEdges && column > 0 ? (phase + 2) % 4 : phase;
            const paintedRows = [edgePhase, edgePhase + 4].map((row) =>
              Math.floor(row * dpr),
            );
            for (let row = 0; row < height; row++)
              data[(row * width + column) * 4 + 3] =
                !empty && paintedRows.includes(y + row) ? 8 : 0;
          }
          return { data };
        },
      };
    },
  };
  const scope = {
    window: {
      __gevVisualPresentationBoundary: {
        read: () => ({
          hudVisible: true,
          revision: 1,
          recordingVisible: true,
          summaryTypingComplete: true,
          summary: 'ready',
          documentVisible: true,
          documentFocused: true,
          gaze: { status: 'ready' },
          hudDisplay: 'block',
          hudVisibility: 'visible',
          hudOpacity: 1,
        }),
      },
      __godsEyeView: {
        viewer: { scene: { frameState: { frameNumber: 42 } } },
      },
    },
    performance: {
      now: (() => {
        let now = 100;
        return () => now++;
      })(),
    },
    document: {
      getElementById: (id) =>
        id === 'world-overlay-detection-surface' ? canvas : null,
    },
  };
  const read = () =>
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(
          `(${readVisualSnapshotPhaseInPage.toString()})({ expectedHudVisible: true })`,
          scope,
        ),
      ),
    );
  return { read, reads, canvas, scope };
}

test('serialized snapshot phase reads actual edge pixels at native DPR', () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 3])
    for (const phase of [0, 2]) {
      const fixture = phaseFixture({ dpr, phase });
      const result = fixture.read();
      assert.equal(result.phase, phase);
      assert.equal(result.alphaRows.length, 8);
      assert.deepEqual(
        result.alphaRows
          .filter((row) => row.leftAlpha > 0)
          .map((row) => row.cssRow),
        [phase, phase + 4],
      );
      assert.deepEqual(
        result.alphaRows.map((row) => row.pixelRow),
        Array.from({ length: 8 }, (_, row) => Math.floor(row * dpr)),
      );
      assert.equal(result.dimensions.dpr, dpr);
      assert.equal(result.observation.frameNumber, 42);
      assert.ok(result.observation.pageReadDurationMs >= 0);
      assert.ok(result.observation.pixelReadDurationMs >= 0);
      assert.deepEqual(
        fixture.reads,
        [
          {
            x: 0,
            y: 0,
            width: fixture.canvas.width,
            height: Math.floor(7 * dpr) + 1,
          },
        ],
        'phase observation performs one shallow readback without changing sampled pixels',
      );
    }
});

test('hidden REC eligibility avoids GPU readback without inventing a phase', () => {
  const fixture = phaseFixture();
  fixture.scope.window.__gevVisualPresentationBoundary.read = () => ({
    hudVisible: true,
    recordingVisible: false,
    revision: 1,
  });
  const result = fixture.read();
  assert.equal(result.phase, null);
  assert.equal(result.reason, 'recording-indicator-hidden');
  assert.equal(result.observation.pixelReadDurationMs, null);
  assert.deepEqual(result.alphaRows, []);
  assert.deepEqual(fixture.reads, []);
  assert.equal(isVisualSnapshotReadyToPause(result), false);
});

test('every cheap mandatory guard failure avoids GPU readback without changing eligibility', () => {
  for (const patch of [
    { recordingVisible: false },
    { summaryTypingComplete: false },
    { summary: '' },
    { documentVisible: false },
    { documentFocused: false },
    { gaze: { status: 'pending' } },
    { hudDisplay: 'none' },
    { hudOpacity: 0.5 },
    { hudOpacity: NaN },
    { hudVisibility: 'hidden' },
    { hudVisible: false, hudOpacity: 0, hudVisibility: 'hidden' },
  ]) {
    const fixture = phaseFixture();
    const ready = fixture.scope.window.__gevVisualPresentationBoundary.read();
    fixture.scope.window.__gevVisualPresentationBoundary.read = () => ({
      ...ready,
      ...patch,
    });
    const result = fixture.read();
    assert.equal(result.phase, null);
    assert.notEqual(result.reason, null);
    assert.equal(result.observation.pixelReadDurationMs, null);
    assert.deepEqual(result.alphaRows, []);
    assert.deepEqual(fixture.reads, []);
    assert.equal(isVisualSnapshotReadyToPause(result), false);
  }
});

function releasedGuardTimeout() {
  return Object.assign(new Error('Debugger pause deadline exceeded.'), {
    pauseDiagnostics: {
      pauseTimeoutMs: 5000,
      pauseObserved: false,
      guardFinalEvaluation: null,
      guardChecks: 32,
      guardSamples: [{ detail: { phase: 0, summaryTypingComplete: false } }],
    },
    pauseCleanup: { resumed: false, disabled: true, detached: true },
  });
}

test('only a fully released never-paused guard deadline with no screenshot is readiness unavailable', () => {
  assert.equal(
    isReleasedVisualGuardTimeout(releasedGuardTimeout(), 0, 0),
    true,
  );
  assert.equal(
    isReleasedVisualGuardTimeout(releasedGuardTimeout(), 2, 2),
    true,
  );
  for (const [before, after] of [
    [0, 1],
    [3, 3],
    [-1, -1],
    [0, undefined],
  ])
    assert.equal(
      isReleasedVisualGuardTimeout(releasedGuardTimeout(), before, after),
      false,
    );
  for (const corrupt of [
    (error) => {
      error.name = 'TypeError';
    },
    (error) => {
      error.message = 'paused screenshot deadline exceeded.';
    },
    (error) => {
      error.message = 'Atomic pause guard failed.';
    },
    (error) => {
      error.pauseDiagnostics.pauseObserved = true;
    },
    (error) => {
      error.pauseDiagnostics.pauseTimeoutMs = 15000;
    },
    (error) => {
      error.pauseDiagnostics.guardChecks = 0;
    },
    (error) => {
      error.pauseDiagnostics.guardSamples = [];
    },
    (error) => {
      error.pauseDiagnostics.guardFinalEvaluation = {};
    },
    (error) => {
      error.pauseCleanup.resumed = true;
    },
    (error) => {
      error.pauseCleanup.disabled = false;
    },
    (error) => {
      error.pauseCleanup.detached = false;
    },
    (error) => {
      error.cleanupErrors = [{ stage: 'disable' }];
    },
  ]) {
    const error = releasedGuardTimeout();
    corrupt(error);
    assert.equal(isReleasedVisualGuardTimeout(error, 0, 0), false);
  }
});

test('actual producer catch consumes the existing attempt bound without resetting PNG count', () => {
  const source = readFileSync(
    new URL('./runFinalVisualQualification.mjs', import.meta.url),
    'utf8',
  );
  const pauseStart = source.indexOf(
    'pausedCapture = await captureWithDebuggerPause(',
  );
  const catchStart = source.indexOf('} catch (error) {', pauseStart);
  const catchEnd = source.indexOf(
    'const before = pausedCapture.readBefore',
    catchStart,
  );
  assert.ok(pauseStart > 0 && catchStart > pauseStart && catchEnd > catchStart);
  const catchBlock = source.slice(catchStart, catchEnd);
  const loop = source.match(
    /for \(let attempt = 1; attempt <= 12 && pngCount < 3; attempt\+\+\) \{/,
  );
  assert.ok(loop);
  const execute = vm.runInNewContext(
    `(error, pngCount) => {
      const attempts = [], states = [], id = 'hud-visible';
      let decorationReadBefore, decorationFontsBefore, decorationFontsAfter, decorationPaintBefore;
      const pngCountBeforeCapture = pngCount;
      ${loop[0]}
        try { throw error;
        ${catchBlock}
      }
      return { attempts, states, pngCount };
    }`,
    {
      isReleasedVisualGuardTimeout,
      boundedError: (error) => ({ message: error.message }),
      retainDecorationFailureEvidence,
    },
  );
  const result = execute(releasedGuardTimeout(), 1);
  assert.equal(result.attempts.length, 12);
  assert.equal(result.states.length, 0);
  assert.equal(result.pngCount, 1);
  assert.ok(
    result.attempts.every(
      (attempt) =>
        attempt.accepted === false &&
        attempt.reason === 'visual-pause-readiness-timeout',
    ),
  );
  const afterPause = releasedGuardTimeout();
  afterPause.pauseDiagnostics.pauseObserved = true;
  assert.throws(() => execute(afterPause, 1), /Debugger pause deadline/);
});

test('actual producer fatal eligibility catch retains boxless geometry and never retries it', () => {
  const source = readFileSync(
    new URL('./runFinalVisualQualification.mjs', import.meta.url),
    'utf8',
  );
  const pauseStart = source.indexOf(
    'pausedCapture = await captureWithDebuggerPause(',
  );
  const catchStart = source.indexOf('} catch (error) {', pauseStart);
  const catchEnd = source.indexOf(
    'const before = pausedCapture.readBefore',
    catchStart,
  );
  assert.ok(pauseStart > 0 && catchStart > pauseStart && catchEnd > catchStart);
  const execute = vm.runInNewContext(
    `(error, decorationReadBefore) => {
      const attempts = [], states = [], id = 'still-settled';
      const pngCount = 0, pngCountBeforeCapture = 0;
      const decorationFontsBefore = [{ selector: '#cctv-source-badge', fonts: [] }];
      const decorationPaintBefore = { svgMarkup: 'retained original header input' };
      let decorationFontsAfter;
      try {
        for (let attempt = 1; attempt <= 12 && pngCount < 3; attempt++) {
          try { throw error;
          ${source.slice(catchStart, catchEnd)}
        }
      } catch (failure) { return { attempts, states, pngCount, sameError: failure === error }; }
      throw new Error('Fatal eligibility failure was retried');
    }`,
    {
      isReleasedVisualGuardTimeout,
      boundedError: (error) => ({ message: error.message }),
      retainDecorationFailureEvidence,
    },
  );
  const proof = {
    surfaces: [
      {
        selector: '#cctv-source-badge',
        ancestors: [
          {
            tag: 'DIV',
            className: 'cyber-panel-body',
            rect: { x: 0, y: 0, width: 0, height: 0 },
            style: { display: 'contents' },
          },
        ],
      },
    ],
  };
  const result = execute(
    new Error('Nonempty decoration rectangle required'),
    proof,
  );
  assert.equal(result.sameError, true);
  assert.equal(result.pngCount, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.states[0].captureFailed, true);
  assert.equal(result.attempts[0].decorationFailure.acceptanceEligible, false);
  assert.deepEqual(result.attempts[0].decorationFailure.evidence.before, proof);
  assert.equal(
    result.attempts[0].decorationFailure.evidence.paintBefore.svgMarkup,
    'retained original header input',
  );
});

test('pause readiness diagnostics keep page timing and frame evidence bounded', () => {
  const describe = vm.runInNewContext(
    `(${describeVisualPauseReadiness.toString()})`,
  );
  const detail = describe({
    phase: 0,
    observation: {
      frameNumber: 71,
      pageReadStartedAtMs: 150.25,
      pageReadCompletedAtMs: 164.5,
      pageReadDurationMs: 14.25,
      pixelReadDurationMs: 12.5,
    },
    hud: {},
  });
  assert.equal(detail.frameNumber, 71);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.observation)), {
    pageReadStartedAtMs: 150.25,
    pageReadCompletedAtMs: 164.5,
    pageReadDurationMs: 14.25,
    pixelReadDurationMs: 12.5,
  });
  assert.equal(describe({}).frameNumber, null);
  assert.equal(describe({}).observation.pixelReadDurationMs, null);
  assert.ok(JSON.stringify(detail).length < 4096);
});

test('snapshot phase stays unavailable for absent strokes or contradictory edges', () => {
  assert.equal(phaseFixture({ empty: true }).read().phase, null);
  assert.equal(phaseFixture({ mismatchedEdges: true }).read().phase, null);
  const short = phaseFixture();
  short.canvas.height = 12;
  short.canvas.getBoundingClientRect = () => ({ width: 1440, height: 6 });
  assert.equal(
    short.read().phase,
    null,
    'truncated observations cannot claim a phase',
  );
  const missing = phaseFixture();
  missing.scope.document.getElementById = () => null;
  assert.throws(missing.read, /surfaces are unavailable/);
  const dimensions = phaseFixture();
  dimensions.canvas.getBoundingClientRect = () => ({ width: 0, height: 900 });
  assert.throws(dimensions.read, /dimensions are unavailable/);
});

function visualReadinessProof(scrollTop = 0) {
  const gazeRect = { left: 2, top: 3, width: 40, height: 20 };
  const gaze = {
    status: 'ready',
    reducedMotion: false,
    pointerMoveSequence: 1,
    resetSequence: 0,
    expected: {
      pointer: { x: 1, y: 1 },
      logos: [
        {
          id: '',
          key: 'logo-0',
          rect: gazeRect,
          transform: 'translate(-1.00 -1.00)',
        },
      ],
    },
    logos: [
      {
        id: '',
        key: 'logo-0',
        rect: gazeRect,
        mode: 'inline-svg',
        globeTransform: 'translate(-1.00 -1.00)',
        cageTransform: 'translate(-1.00 -1.00)',
      },
    ],
    activeAnimations: [],
    animationOverflow: false,
    cctvEffects: [
      ...['cctv-panel', 'cctv-panel-inner'].map((id) => ({
        id,
        present: true,
        filter: 'none',
        backdropFilter: 'none',
        transitionProperty: 'none',
        transitionDuration: '0s',
        transitionDelay: '0s',
        animationName: 'none',
        animationDuration: '0s',
      })),
      { id: 'cctv-cyber-panel-body', present: false },
    ],
    titleStyle: {
      filter: 'none',
      transitionProperty: 'none',
      transitionDuration: '0s',
      animationName: 'none',
      animationDuration: '0s',
    },
    sourceBadge: {
      rect: { left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2 },
      filter: 'none',
      backdropFilter: 'none',
      borderRadius: '4px',
      transitionProperty: 'none',
      transitionDuration: '0s',
      animationName: 'none',
    },
  };
  return {
    revision: 1,
    recordingVisible: true,
    summaryTypingComplete: true,
    summary: 'fixture',
    documentVisible: true,
    documentFocused: true,
    hudVisible: true,
    hudDisplay: 'block',
    hudVisibility: 'visible',
    hudOpacity: 1,
    pointer: { x: 1, y: 1, pointerType: 'mouse' },
    activeElement: { tagName: 'BODY', id: '', className: 'app-shell' },
    scrollContainers: [
      {
        id: 'cctv-panel',
        present: true,
        rect: {
          left: 0,
          top: 0,
          right: 360,
          bottom: 850,
          width: 360,
          height: 850,
        },
        scroll: {
          left: 0,
          top: 0,
          width: 360,
          height: 1000,
          clientWidth: 360,
          clientHeight: 850,
          offsetWidth: 360,
          offsetHeight: 850,
        },
        computed: {
          display: 'block',
          visibility: 'visible',
          overflowX: 'hidden',
          overflowY: 'visible',
          scrollbarGutter: 'auto',
          scrollbarWidth: 'auto',
        },
      },
      {
        id: 'cctv-panel-inner',
        present: true,
        rect: {
          left: 0,
          top: 0,
          right: 360,
          bottom: 850,
          width: 360,
          height: 850,
        },
        scroll: {
          left: 0,
          top: scrollTop,
          width: 360,
          height: 1200,
          clientWidth: 360,
          clientHeight: 850,
          offsetWidth: 360,
          offsetHeight: 850,
        },
        computed: {
          display: 'flex',
          visibility: 'visible',
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarGutter: 'auto',
          scrollbarWidth: 'thin',
        },
      },
      { id: 'cctv-cyber-panel-body', present: false },
    ],
    gaze,
  };
}

function makeVisualReadinessPage(
  readProof,
  {
    frameNumbers = null,
    requestRenderThrows = false,
    holdRaf = false,
    requestAnimationFrameThrows = false,
  } = {},
) {
  const listeners = new Set();
  const pendingRafs = new Map();
  const pendingTimers = new Set();
  let frameNumber = 0;
  let renderCount = 0;
  let rafSequence = 0;
  let clock = 0;
  const scopedSetTimeout = (callback, delay) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      callback();
    }, delay);
    pendingTimers.add(timer);
    return timer;
  };
  const scopedClearTimeout = (timer) => {
    clearTimeout(timer);
    pendingTimers.delete(timer);
  };
  const scene = {
    frameState: { frameNumber },
    postRender: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    requestRender() {
      if (requestRenderThrows)
        throw new Error('synthetic render request error');
      renderCount++;
      frameNumber = frameNumbers
        ? frameNumbers[Math.min(renderCount - 1, frameNumbers.length - 1)]
        : frameNumber + 1;
      scene.frameState.frameNumber = frameNumber;
      queueMicrotask(() => [...listeners].forEach((listener) => listener()));
    },
  };
  const scope = {
    window: {
      __godsEyeView: { viewer: { scene } },
      __gevVisualPresentationBoundary: { read: readProof },
    },
    performance: { now: () => ++clock },
    requestAnimationFrame: (callback) => {
      if (requestAnimationFrameThrows)
        throw new Error('synthetic animation frame error');
      const handle = ++rafSequence;
      pendingRafs.set(handle, callback);
      if (!holdRaf)
        queueMicrotask(() => {
          const pending = pendingRafs.get(handle);
          if (!pending) return;
          pendingRafs.delete(handle);
          pending(clock);
        });
      return handle;
    },
    cancelAnimationFrame: (handle) => pendingRafs.delete(handle),
    setTimeout: scopedSetTimeout,
    clearTimeout: scopedClearTimeout,
  };
  return {
    wait: vm.runInNewContext(
      `(${waitForVisualReadinessInPage.toString()})`,
      scope,
    ),
    stats: () => ({
      listeners: listeners.size,
      pendingRafs: pendingRafs.size,
      pendingTimers: pendingTimers.size,
      renderCount,
    }),
  };
}

test('visual readiness waits for two stable post-render and layout samples', async () => {
  const topValues = [0, 12, 12, 12];
  let reads = 0;
  const page = makeVisualReadinessPage(() =>
    visualReadinessProof(topValues[Math.min(reads++, topValues.length - 1)]),
  );
  const result = await page.wait({
    expectedHudVisible: true,
    timeoutMs: 100,
    stableRenders: 2,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.completedRenders, 3);
  assert.equal(result.consecutiveStableRenders, 2);
  assert.equal(result.proof.scrollContainers[1].scroll.top, 12);
  assert.deepEqual(page.stats(), {
    listeners: 0,
    pendingRafs: 0,
    pendingTimers: 0,
    renderCount: 3,
  });
});

test('visual readiness remains ineligible when scroll geometry never settles', async () => {
  let reads = 0;
  const page = makeVisualReadinessPage(() => visualReadinessProof(reads++));
  const result = await page.wait({
    expectedHudVisible: true,
    timeoutMs: 8,
    stableRenders: 2,
  });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'scroll-layout-not-stable');
  assert.ok(result.completedRenders >= 1);
});

test('visual readiness waits until the gaze transform reaches its target', async () => {
  const transforms = [
    'translate(-0.80 -0.80)',
    'translate(-1.00 -1.00)',
    'translate(-1.00 -1.00)',
  ];
  let reads = 0;
  const page = makeVisualReadinessPage(() => {
    const proof = visualReadinessProof();
    const transform = transforms[Math.min(reads++, transforms.length - 1)];
    proof.gaze.logos[0].globeTransform = transform;
    proof.gaze.logos[0].cageTransform = transform;
    return proof;
  });
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 100 });
  assert.equal(result.status, 'ready');
  assert.equal(result.completedRenders, 3);
  assert.equal(
    result.proof.gaze.logos[0].globeTransform,
    'translate(-1.00 -1.00)',
  );
});

test('visual readiness rejects a reset pointer until it is freshly positioned', async () => {
  const page = makeVisualReadinessPage(() => ({
    ...visualReadinessProof(),
    gaze: {
      ...visualReadinessProof().gaze,
      status: 'pointer-reset-after-positioning',
      resetSequence: 1,
    },
  }));
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 8 });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'pointer-reset-after-positioning');
});

test('visual readiness cleans listeners and timers if requesting a render throws', async () => {
  const page = makeVisualReadinessPage(() => visualReadinessProof(), {
    requestRenderThrows: true,
  });
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 20 });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'render-request-failed');
  assert.deepEqual(page.stats(), {
    listeners: 0,
    pendingRafs: 0,
    pendingTimers: 0,
    renderCount: 0,
  });
});

test('visual readiness cancels a layout frame when its bounded wait expires', async () => {
  const page = makeVisualReadinessPage(() => visualReadinessProof(), {
    holdRaf: true,
  });
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 10 });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'browser-layout-frame-timeout');
  assert.deepEqual(page.stats(), {
    listeners: 0,
    pendingRafs: 0,
    pendingTimers: 0,
    renderCount: 1,
  });
});

test('visual readiness clears its layout timer if animation frame scheduling throws', async () => {
  const page = makeVisualReadinessPage(() => visualReadinessProof(), {
    requestAnimationFrameThrows: true,
  });
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 20 });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'browser-layout-frame-request-failed');
  assert.deepEqual(page.stats(), {
    listeners: 0,
    pendingRafs: 0,
    pendingTimers: 0,
    renderCount: 1,
  });
});

test('visual readiness requires advancing scene frame numbers', async () => {
  const page = makeVisualReadinessPage(() => visualReadinessProof(), {
    frameNumbers: [7, 7, 7],
  });
  const result = await page.wait({ expectedHudVisible: true, timeoutMs: 12 });
  assert.equal(result.status, 'not-ready');
  assert.equal(result.reason, 'render-frame-number-not-advanced');
  assert.equal(page.stats().listeners, 0);
  assert.equal(page.stats().pendingRafs, 0);
  assert.equal(page.stats().pendingTimers, 0);
  assert.ok(page.stats().renderCount > 0);
});
