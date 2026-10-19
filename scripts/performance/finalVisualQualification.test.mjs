import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { VISIBLE_CONTROL_VARIANCE_POLICY } from './visibleControlVariance.mjs';
import {
  FINAL_VISUAL_QUALIFICATION_SCHEMA,
  FINAL_VISUAL_STATES,
  FINAL_VISUAL_TIME_MS,
  captureQualificationPng,
  validateFinalVisualQualification,
} from './finalVisualQualification.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dimensions = { width: 1440, height: 900 };
const createPng = (red = 32) =>
  sharp({
    create: {
      ...dimensions,
      channels: 4,
      background: { r: red, g: 64, b: 96, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

const scrollContainer = (id, width, scrollHeight, clientHeight) => ({
  id,
  present: true,
  rect: {
    left: 20,
    top: 12,
    right: 20 + width,
    bottom: 12 + clientHeight,
    width,
    height: clientHeight,
  },
  scroll: {
    left: 0,
    top: 0,
    width,
    height: scrollHeight,
    clientWidth: width,
    clientHeight,
    offsetWidth: width + 2,
    offsetHeight: clientHeight + 2,
  },
  computed: {
    display: 'block',
    visibility: 'visible',
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollbarGutter: 'auto',
    scrollbarWidth: 'thin',
  },
});

async function fixture(t) {
  const png = await createPng();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-final-visual-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(
      path.dirname(resolved).toLowerCase(),
      (await fs.realpath(os.tmpdir())).toLowerCase(),
    );
    assert.ok(path.basename(resolved).startsWith('gev-final-visual-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  for (const state of FINAL_VISUAL_STATES)
    for (const side of ['baseline', 'candidate'])
      await fs.writeFile(path.join(root, state + '-' + side + '.png'), png);
  const profile = {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { ...dimensions, dpr: 1 },
    drawingBuffer: dimensions,
  };
  const renderer = {
    vendor: 'Google Inc. (Intel)',
    device:
      'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    browserVersion: 'Chrome/152.0.7977.75',
  };
  const camera = {
    longitude: -97.7431,
    latitude: 30.2672,
    heightM: 2000,
    headingRadians: 0,
    pitchRadians: -Math.PI / 2,
    rollRadians: 0,
  };
  const settings = {
    qualityMode: 'manual',
    densityPct: 75,
    detectionMode: 'DENSE',
    resolutionScale: 1,
    antialias: false,
    msaaSamples: 4,
    fxaa: true,
  };
  const phaseFor = (id) => {
    const visible = id !== 'hud-hidden';
    return {
      revision: 1,
      hudVisible: visible,
      hudOpacity: visible ? 1 : 0,
      hudVisibility: visible ? 'visible' : 'hidden',
      hudDisplay: 'block',
      recordingVisible: true,
      summaryTypingComplete: true,
      summary: 'Synthetic CCTV fixture',
      documentVisible: true,
      documentFocused: true,
      pointer: { x: 1, y: 1, pointerType: 'mouse' },
      activeElement: { tagName: 'BODY', id: '', className: 'app-shell' },
      scrollContainers: [
        scrollContainer('cctv-panel', 360, 1000, 876),
        scrollContainer('cctv-panel-inner', 360, 1200, 850),
        { id: 'cctv-cyber-panel-body', present: false },
      ],
      gaze: {
        status: 'ready',
        reducedMotion: false,
        pointerMoveSequence: 2,
        resetSequence: 1,
        expected: {
          pointer: { x: 1, y: 1 },
          logos: [
            {
              id: '',
              key: 'logo-0',
              rect: { left: 10, top: 10, width: 40, height: 20 },
              transform: 'translate(-1.00 -1.00)',
            },
          ],
        },
        logos: [
          {
            id: '',
            key: 'logo-0',
            rect: { left: 10, top: 10, width: 40, height: 20 },
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
      },
    };
  };
  const alphaRows = Array.from({ length: 8 }, (_, cssRow) => ({
    cssRow,
    pixelRow: cssRow,
    leftAlpha: cssRow === 0 || cssRow === 4 ? 255 : 0,
    rightAlpha: cssRow === 0 || cssRow === 4 ? 255 : 0,
  }));
  const phaseEvidence = {
    before: 0,
    after: 0,
    dimensions: {
      before: {
        ...dimensions,
        cssWidth: dimensions.width,
        cssHeight: dimensions.height,
        dpr: 1,
      },
      after: {
        ...dimensions,
        cssWidth: dimensions.width,
        cssHeight: dimensions.height,
        dpr: 1,
      },
    },
    alphaRows: { before: alphaRows, after: alphaRows },
  };
  const teardown = {
    browserClosed: true,
    pageClose: { closeCompleted: true, openPageCount: 0 },
    browserClose: {
      closeCompleted: true,
      forcedProcessTermination: false,
      observation: { processExit: { code: 0, signal: null } },
    },
    errors: [],
  };
  const report = {
    schema: FINAL_VISUAL_QUALIFICATION_SCHEMA,
    application: { baselineSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40) },
    harness: {
      baselineSha: 'c'.repeat(40),
      candidateSha: 'c'.repeat(40),
      buildHarnessCommit: 'c'.repeat(40),
      visualHarnessCommit: 'd'.repeat(40),
    },
    receipts: {
      baselineSha256: 'e'.repeat(64),
      candidateSha256: 'f'.repeat(64),
    },
    fixture: { frameSha256: '1'.repeat(64) },
    environment: {
      platform: 'win32',
      foregroundConfirmed: true,
      renderer,
      rendererByRevision: { baseline: renderer, candidate: renderer },
      browserPid: { baseline: 101, candidate: 102 },
      nativeSharpnessProfile: profile,
      populations: [{ id: 'cctv', enabled: true, count: 1 }],
      camera: { id: 'qa-cctv-lifecycle-camera-001', ...camera },
    },
    masks: [],
    states: FINAL_VISUAL_STATES.map((id) => ({
      id,
      observedStatePhase: 'pre-readiness-structural-observation',
      completedRender: {
        baseline: { frameNumber: 1, elapsedMs: 1 },
        candidate: { frameNumber: 2, elapsedMs: 1 },
      },
      foreground: {
        baseline: {
          status: 'foreground-confirmed',
          foregroundConfirmed: true,
          foregroundPid: 101,
        },
        candidate: {
          status: 'foreground-confirmed',
          foregroundConfirmed: true,
          foregroundPid: 102,
        },
      },
      camera: { id: 'qa-cctv-lifecycle-camera-001', ...camera },
      cameraByRevision: { baseline: camera, candidate: camera },
      nativeSharpnessProfile: profile,
      nativeSharpnessProfileByRevision: {
        baseline: profile,
        candidate: profile,
      },
      settings: { baseline: settings, candidate: settings },
      populations: {
        baseline: { cctv: 1, entities: 1, dataSources: 0 },
        candidate: { cctv: 1, entities: 1, dataSources: 0 },
      },
      hud: {
        baseline: { visible: id !== 'hud-hidden' },
        candidate: { visible: id !== 'hud-hidden' },
      },
      presentation: {
        baseline: {
          before: phaseFor(id),
          after: phaseFor(id),
        },
        candidate: {
          before: phaseFor(id),
          after: phaseFor(id),
        },
      },
      readiness: {
        baseline: {
          status: 'ready',
          consecutiveStableRenders: 2,
          completedRenders: 2,
          proof: phaseFor(id),
        },
        candidate: {
          status: 'ready',
          consecutiveStableRenders: 2,
          completedRenders: 2,
          proof: phaseFor(id),
        },
      },
      captureMethod: {
        baseline: 'debugger-paused-snapshot',
        candidate: 'debugger-paused-snapshot',
      },
      phase: {
        baseline: phaseEvidence,
        candidate: phaseEvidence,
      },
      pauseCleanup: {
        baseline: { resumed: true, disabled: true, detached: true },
        candidate: { resumed: true, disabled: true, detached: true },
      },
      frameDelivery: {
        baseline: { count: 1, sha256: '1'.repeat(64), matchesFixture: true },
        candidate: { count: 1, sha256: '1'.repeat(64), matchesFixture: true },
      },
      timestampMs: {
        baseline: FINAL_VISUAL_TIME_MS,
        candidate: FINAL_VISUAL_TIME_MS,
      },
      baseline: { path: id + '-baseline.png', sha256: digest(png), dimensions },
      candidate: {
        path: id + '-candidate.png',
        sha256: digest(png),
        dimensions,
      },
    })),
    teardown: { baseline: teardown, candidate: teardown },
  };
  return { root, report: JSON.parse(JSON.stringify(report)) };
}

test('accepts complete matched hardware observations and decoded PNGs', async (t) => {
  const { root, report } = await fixture(t);
  assert.deepEqual(
    await validateFinalVisualQualification(report, { evidenceRoot: root }),
    { schema: report.schema, status: 'passed', states: 4 },
  );
});

test('explicit control policy requires independent full-image witnesses on both builds', async (t) => {
  const { root, report } = await fixture(t);
  const pixels = await sharp(await createPng())
    .ensureAlpha()
    .raw()
    .toBuffer();
  pixels[40] += 9;
  const changed = await sharp(pixels, { raw: { ...dimensions, channels: 4 } })
    .png()
    .toBuffer();
  for (const [id, side] of [
    ['still-settled', 'candidate'],
    ['hud-restored', 'baseline'],
    ['hud-restored', 'candidate'],
  ]) {
    const state = report.states.find((value) => value.id === id);
    await fs.writeFile(path.join(root, state[side].path), changed);
    state[side].sha256 = digest(changed);
  }
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /decoded rendered pixels changed/,
  );
  report.rasterPolicy = VISIBLE_CONTROL_VARIANCE_POLICY;
  const accepted = await validateFinalVisualQualification(report, {
    evidenceRoot: root,
  });
  assert.equal(accepted.rasterVariance.variedPixels, 1);
  assert.equal(accepted.rasterVariance.maximumChannelDelta, 9);
  report.states[3].settings.baseline.densityPct = 50;
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
  );
});

test('captures lossless PNG with speed optimization and separate timing metadata', async (t) => {
  const png = await createPng();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-final-png-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let options;
  const record = await captureQualificationPng(
    {
      async screenshot(value) {
        options = value;
        return png;
      },
    },
    path.join(root, 'capture.png'),
  );
  assert.deepEqual(options, { type: 'png', optimizeForSpeed: true });
  assert.deepEqual(record.dimensions, dimensions);
  assert.equal(record.sha256, digest(png));
  assert.ok(record.screenshotElapsedMs >= 0);
  assert.ok(record.fileWriteElapsedMs >= 0);
});

test('rejects contradictory or missing evidence at the relevant observation', async (t) => {
  const { root, report } = await fixture(t);
  const cases = [
    [
      'same application',
      (r) => {
        r.application.candidateSha = r.application.baselineSha;
      },
      /application revisions/,
    ],
    [
      'missing gaze readiness proof',
      (r) => {
        r.states[0].readiness.candidate.proof.gaze.expected.logos = [];
      },
      /readiness proof/,
    ],
    [
      'readiness did not stabilize across enough renders',
      (r) => {
        r.states[0].readiness.candidate.consecutiveStableRenders = 1;
      },
      /stable render count/,
    ],
    [
      'gaze transform drift at capture',
      (r) => {
        r.states[0].presentation.candidate.after.gaze.logos[0].globeTransform =
          'translate(0.00 0.00)';
      },
      /presentation changed/,
    ],
    [
      'wrong harness',
      (r) => {
        r.harness.candidateSha = '9'.repeat(40);
      },
      /build harness/,
    ],
    [
      'software renderer',
      (r) => {
        r.environment.renderer.device = 'SwiftShader';
      },
      /UHD/,
    ],
    [
      'different browser',
      (r) => {
        r.environment.rendererByRevision.candidate.browserVersion =
          'Chrome\/100';
      },
      /renderer\/browser/,
    ],
    [
      'unconfirmed close',
      (r) => {
        r.teardown.candidate.browserClosed = false;
      },
      /browser cleanup/,
    ],
    [
      'missing process exit',
      (r) => {
        r.teardown.candidate.browserClose.observation.processExit = null;
      },
      /exit proof/,
    ],
    [
      'forced close',
      (r) => {
        r.teardown.candidate.browserClose.forcedProcessTermination = true;
      },
      /forced shutdown/,
    ],
    [
      'missing frame',
      (r) => {
        delete r.states[0].completedRender.candidate.frameNumber;
      },
      /render proof/,
    ],
    [
      'wrong foreground PID',
      (r) => {
        r.states[0].foreground.candidate.foregroundPid = 999;
      },
      /foreground PID/,
    ],
    [
      'lower density',
      (r) => {
        r.states[0].settings.candidate.densityPct = 50;
      },
      /density/,
    ],
    [
      'missing effective settings',
      (r) => {
        r.states[0].settings = {};
      },
      /quality mode/,
    ],
    [
      'missing antialias',
      (r) => {
        delete r.states[0].settings.candidate.antialias;
      },
      /antialias/,
    ],
    [
      'lower MSAA',
      (r) => {
        r.states[0].settings.candidate.msaaSamples = 1;
      },
      /MSAA/,
    ],
    [
      'wrong profile',
      (r) => {
        r.states[0].nativeSharpnessProfileByRevision.candidate.resolutionScale = 0.5;
      },
      /native profile differs/,
    ],
    [
      'camera mismatch',
      (r) => {
        r.states[0].cameraByRevision.candidate.heightM = 3000;
      },
      /observed camera differs/,
    ],
    [
      'phase changed',
      (r) => {
        r.states[0].presentation.candidate.after.revision++;
      },
      /presentation changed/,
    ],
    [
      'phase rows missing',
      (r) => {
        r.states[0].phase.candidate.alphaRows.after.pop();
      },
      /alpha rows/,
    ],
    [
      'phase claim contradictory',
      (r) => {
        r.states[0].phase.candidate.before = 2;
      },
      /phase claim/,
    ],
    [
      'phase pixel row inconsistent with DPR',
      (r) => {
        r.states[0].phase.candidate.alphaRows.before[1].pixelRow = 2;
      },
      /pixel row/,
    ],
    [
      'phase CSS dimensions differ',
      (r) => {
        r.states[0].phase.candidate.dimensions.before.cssWidth = 720;
      },
      /CSS width/,
    ],
    [
      'phase DPR differs',
      (r) => {
        r.states[0].phase.candidate.dimensions.after.dpr = 2;
      },
      /DPR/,
    ],
    [
      'phase edges contradict',
      (r) => {
        r.states[0].phase.candidate.alphaRows.after[0].rightAlpha = 0;
      },
      /edge alpha rows differ/,
    ],
    [
      'phase cleanup missing',
      (r) => {
        r.states[0].pauseCleanup.candidate.detached = false;
      },
      /paused cleanup/,
    ],
    [
      'HUD transition incomplete',
      (r) => {
        r.states[2].presentation.candidate.after.hudOpacity = 0.42;
      },
      /presentation changed/,
    ],
    [
      'wrong frame',
      (r) => {
        r.states[0].frameDelivery.candidate.sha256 = '2'.repeat(64);
      },
      /frame digest/,
    ],
    [
      'empty population',
      (r) => {
        r.states[0].populations.candidate.cctv = 0;
      },
      /CCTV population/,
    ],
    [
      'hidden HUD visible',
      (r) => {
        r.states[2].hud.candidate.visible = true;
      },
      /HUD/,
    ],
    [
      'wrong timestamp',
      (r) => {
        r.states[0].timestampMs.candidate++;
      },
      /candidate timestamp/,
    ],
    [
      'missing state',
      (r) => {
        r.states.pop();
      },
      /states/,
    ],
    [
      'pixel masks',
      (r) => {
        r.masks = [{ reason: 'hide regression' }];
      },
      /masks/,
    ],
    [
      'path escapes root',
      (r) => {
        r.states[0].baseline.path = '../outside.png';
      },
      /escapes evidence root/,
    ],
  ];
  for (const [name, mutate, expected] of cases)
    await t.test(name, async () => {
      const changed = JSON.parse(JSON.stringify(report));
      mutate(changed);
      await assert.rejects(
        validateFinalVisualQualification(changed, { evidenceRoot: root }),
        expected,
      );
    });
});

test('rejects changed decoded pixels even with a correct new file digest', async (t) => {
  const { root, report } = await fixture(t);
  const changed = await createPng(33);
  await fs.writeFile(path.join(root, report.states[0].candidate.path), changed);
  report.states[0].candidate.sha256 = digest(changed);
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /decoded rendered pixels changed/,
  );
});
