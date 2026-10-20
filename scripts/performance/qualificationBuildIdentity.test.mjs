import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  QUALIFICATION_BUILD_IDENTITY_KIND,
  createQualificationBuildIdentityPlan,
  assertQualificationBuildIdentityPlan,
  inspectQualificationBuildIdentityPlan,
  readQualificationBuildIdentityPlan,
  resolveQualificationIdentitySource,
  verifyQualificationBuildIdentityAssets,
  assertQualificationBuildIdentityVerification,
  assertQualificationLiveBuildIdentity,
  assertQualificationBuildIdentityBoundaries,
  createQualificationBuildIdentityEvidence,
  inspectQualificationBuildIdentityEvidence,
  readQualificationBrowserVersion,
} from './qualificationBuildIdentity.mjs';

const BASELINE = '76cc760b384da27e7cfc848a76f317112574826a';
const CANDIDATE = 'e6e1abc10b154b5317101d6e1b9bb18779e469ce';
const HARNESS = '55639cc7fde03daacf25e643f16f803e001113f9';
const APPLICATION = { baseline: BASELINE, candidate: CANDIDATE };
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const RENDERER =
  'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const bytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const settings = () => ({
  qualityMode: 'manual',
  densityPct: 75,
  detectionMode: 'DENSE',
  resolutionScale: 1,
  antialias: true,
  msaaSamples: 4,
  fxaa: false,
  bloom: false,
  bloomIntensity: 0,
  sharpen: false,
  sharpenIntensity: 49,
  visual: {
    style: 'normal',
    bloomEnabled: false,
    bloomIntensity: 0,
    sharpenEnabled: false,
    sharpenIntensity: 49,
    detectionMode: 'DENSE',
    detectionDensityPct: 75,
    detectionAllocation: 'ELASTIC',
    detectionFadePct: 7,
    detectionOutsideOpacityPct: 1,
    scopeEnabled: true,
    scopeFeatherPct: 11,
    mapStack: 'osm',
  },
});

test('owned Browser.getVersion read is bounded, preserves failure and disposes only its session', async () => {
  let detached = 0;
  const session = {
    send: async (method, params, options) => {
      assert.equal(method, 'Browser.getVersion');
      assert.equal(params, undefined);
      assert.equal(options.timeout, 4000);
      return { product: 'Chrome/155.0.8059.84', userAgent: UA };
    },
    detach: async () => {
      detached++;
    },
  };
  assert.equal(
    (
      await readQualificationBrowserVersion({
        createCDPSession: async () => session,
      })
    ).userAgent,
    UA,
  );
  assert.equal(detached, 1);
  const original = new Error('original protocol failure');
  await assert.rejects(
    readQualificationBrowserVersion({
      createCDPSession: async () => ({
        send: async () => {
          throw original;
        },
        detach: async () => {
          throw new Error('cleanup failure');
        },
      }),
    }),
    (error) =>
      error === original && error.cleanupError.message === 'cleanup failure',
  );
  await assert.rejects(
    readQualificationBrowserVersion(
      {
        createCDPSession: async () => ({
          send: () => new Promise(() => {}),
          detach: () => new Promise(() => {}),
        }),
      },
      { timeoutMs: 20, cleanupTimeoutMs: 20 },
    ),
    (error) =>
      /getVersion timed out/.test(error.message) &&
      /cleanup timed out/.test(error.cleanupError.message),
  );
  let release,
    lateDetached = 0,
    lateReads = 0;
  const pending = readQualificationBrowserVersion(
    {
      createCDPSession: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    { timeoutMs: 20 },
  );
  await assert.rejects(pending, /getVersion timed out/);
  release({
    send: async () => {
      lateReads++;
    },
    detach: async () => {
      lateDetached++;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateReads, 0);
  assert.equal(lateDetached, 1);
});

function receipt(commit) {
  const assets = [
    { path: 'index.html', bytes: 13, sha256: hash('<main></main>') },
    { path: 'assets/app.js', bytes: 3, sha256: hash('app') },
  ];
  const value = {
    schema: 'gev-build-provenance/v1',
    scope:
      'unsigned local source-build receipt; not a hardware or release attestation',
    source: { commit, worktree: 'clean' },
    harness: { commit: HARNESS, worktree: 'clean' },
    buildRecipe: {},
    assetCount: 2,
    totalAssetBytes: 16,
    assets,
  };
  return { ...value, receiptSha256: hash(JSON.stringify(value)) };
}

async function fixture(t) {
  const temp = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temp, 'gev-qualification-identity-'));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), temp);
    assert.ok(
      path.basename(resolved).startsWith('gev-qualification-identity-'),
    );
    await rm(resolved, { recursive: true, force: true });
  });
  const executable = path.join(root, 'fixture-chrome.exe');
  const executableBytes = Buffer.from('Fixture only; never launched.');
  await writeFile(executable, executableBytes);
  const builds = {};
  for (const [role, commit] of Object.entries(APPLICATION)) {
    const data = receipt(commit),
      serialized = bytes(data),
      filename = path.join(root, `${role}-receipt.json`);
    await writeFile(filename, serialized);
    builds[role] = {
      checkout: path.join(root, role),
      root: path.join(root, `${role}-build`),
      receipt: filename,
      receiptFileSha256: hash(serialized),
      receiptSha256: data.receiptSha256,
      baseUrl: `http://127.0.0.1:${role === 'baseline' ? 4316 : 4315}`,
      profile: 'standard',
    };
  }
  const plan = createQualificationBuildIdentityPlan({
    createdAt: '2026-10-20T00:00:00.000Z',
    application: APPLICATION,
    buildHarness: { commit: HARNESS, checkout: path.join(root, 'harness') },
    browser: {
      executable,
      executableSha256: hash(executableBytes),
      product: 'Chrome/155.0.8059.84',
      userAgent: UA,
      platform: 'Win32',
      renderer: RENDERER,
    },
    measurementEnvironment: 'native-window-viewport-v1',
    nativeDpr: 2,
    settings: settings(),
    builds,
  });
  const planBytes = bytes(plan),
    planPath = path.join(root, 'identity-plan.json');
  await writeFile(planPath, planBytes);
  const context = inspectQualificationBuildIdentityPlan(planBytes, {
    expectedPlanSha256: hash(planBytes),
    expectedApplicationCommits: APPLICATION,
  });
  return { root, plan, planPath, context };
}

const served = (input) => ({
  schema: 'gev-served-assets-verification/v1',
  status: 'served-assets-match',
  receiptSha256: input.receipt.receiptSha256,
  assetCount: input.receipt.assetCount,
  totalAssetBytes: input.receipt.totalAssetBytes,
});

function nativeEvidence() {
  const rect = (left, top, width, height) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  return {
    schema: 'gev-native-window-viewport/v1',
    browserPid: 1122,
    observedAtUtc: '2026-10-20T00:00:02.250Z',
    metricsEmulation: 'cleared-before-navigation',
    puppeteerViewport: null,
    cdpBoundsMapping: 'native-DIPs:windowRect',
    host: {
      schema: 'gev-owned-windows-window-geometry/v1',
      browserPid: 1122,
      ownerPid: 1122,
      windowHandle: '12345',
      ownedWindowCount: 1,
      physicalPixelReadContext: 'per-monitor-aware-v2',
      targetDpiAwareness: 2,
      dpi: 192,
      visible: true,
      minimized: false,
      maximized: true,
      foreground: true,
      windowRect: rect(-13, -13, 2586, 1386),
      clientRect: rect(0, 0, 2560, 1360),
      visibleFrameRect: rect(0, 0, 2560, 1360),
      monitor: {
        device: 'DISPLAY5',
        bounds: rect(0, 0, 2560, 1440),
        workArea: rect(0, 0, 2560, 1360),
        displayMode: {
          width: 2560,
          height: 1440,
          refreshHz: 60,
          bitsPerPixel: 32,
          orientation: 0,
          positionX: 0,
          positionY: 0,
          adapter: 'Intel UHD Graphics 620',
        },
      },
    },
    page: {
      devicePixelRatio: 2,
      inner: { width: 1280, height: 537 },
      outer: { width: 1280, height: 680 },
      screen: {
        width: 1280,
        height: 720,
        availLeft: 0,
        availTop: 0,
        availWidth: 1280,
        availHeight: 680,
      },
      visualViewport: {
        width: 1280,
        height: 537,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
      },
      documentClient: { width: 1280, height: 537 },
      scroll: { x: 0, y: 0 },
      visibilityState: 'visible',
      focused: true,
      nativeResolution: {
        devicePixelRatio: 2,
        resolutionScale: 1,
        useBrowserRecommendedResolution: false,
        maximumScreenSpaceError: 1,
        canvas: {
          clientWidth: 1280,
          clientHeight: 537,
          width: 2560,
          height: 1074,
        },
        sceneDrawingBuffer: { width: 2560, height: 1074 },
      },
      canvasRect: rect(0, 0, 1280, 537),
    },
    cdp: {
      windowId: 7,
      windowBounds: {
        left: -7,
        top: -7,
        width: 1294,
        height: 694,
        windowState: 'maximized',
      },
      layoutMetrics: {
        cssLayoutViewport: { clientWidth: 1280, clientHeight: 537 },
        cssVisualViewport: {
          clientWidth: 1280,
          clientHeight: 537,
          scale: 1,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          pageX: 0,
          pageY: 0,
        },
      },
    },
  };
}

function live(plan, role) {
  const viewport = { width: 1280, height: 537, dpr: 2 },
    drawingBuffer = { width: 2560, height: 1074 };
  const nativeWindowEvidence = nativeEvidence(),
    pid = role === 'baseline' ? 1122 : 2233;
  nativeWindowEvidence.browserPid = pid;
  nativeWindowEvidence.host.browserPid = pid;
  nativeWindowEvidence.host.ownerPid = pid;
  return {
    actual: {
      applicationCommit: plan.application[role],
      browserVersion: plan.browser.product,
      renderer: RENDERER,
      userAgent: UA,
      platform: 'Win32',
      viewport,
      drawingBuffer,
      nativeSharpnessProfile: {
        id: 'native-sharpness-v1',
        useBrowserRecommendedResolution: false,
        resolutionScale: 1,
        maximumScreenSpaceError: 1,
        viewport,
        drawingBuffer,
      },
      settings: settings(),
    },
    browserVersion: {
      product: plan.browser.product,
      userAgent: UA,
      protocolVersion: '1.3',
    },
    browserProcess: { pid, executable: plan.browser.executable },
    nativeWindowEvidence,
  };
}

test('identity source selection is explicit, mutually exclusive and keeps legacy/weather requirements', () => {
  const inputs = {
    baselineCapturePath: 'baseline.json',
    candidateCapturePath: 'candidate.json',
  };
  assert.equal(
    resolveQualificationIdentitySource(inputs).kind,
    'performance-capture-pair',
  );
  assert.equal(
    resolveQualificationIdentitySource({
      ...inputs,
      weatherIdentityEnvelopePath: 'weather.json',
    }).kind,
    'validated-weather-balanced-pair',
  );
  const direct = {
    buildIdentityPlanPath: 'identity.json',
    buildIdentityPlanSha256: 'a'.repeat(64),
    nativeWindowViewport: true,
  };
  assert.equal(
    resolveQualificationIdentitySource(direct).kind,
    QUALIFICATION_BUILD_IDENTITY_KIND,
  );
  for (const patch of [
    inputs,
    { baselineCapturePath: 'baseline.json' },
    { weatherIdentityEnvelopePath: 'weather.json' },
    { nativeWindowViewport: false },
    { buildIdentityPlanSha256: undefined },
    { buildIdentityPlanPath: undefined },
  ])
    assert.throws(() =>
      resolveQualificationIdentitySource({ ...direct, ...patch }),
    );
  assert.throws(() =>
    resolveQualificationIdentitySource({
      candidateCapturePath: 'candidate.json',
    }),
  );
  assert.throws(() =>
    resolveQualificationIdentitySource({
      weatherIdentityEnvelopePath: 'weather.json',
    }),
  );
});

test('predeclared 76/e6 plan preserves roles, native quality, effects and identity-only scope', async (t) => {
  const { plan } = await fixture(t);
  assertQualificationBuildIdentityPlan(plan, {
    expectedApplicationCommits: APPLICATION,
  });
  for (const mutate of [
    (p) => {
      p.application.baseline = 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256';
    },
    (p) => {
      p.application = { baseline: CANDIDATE, candidate: BASELINE };
    },
    (p) => {
      p.performanceEligible = true;
    },
    (p) => {
      p.coldStartupEligible = true;
    },
    (p) => {
      p.comparisonEligible = true;
    },
    (p) => {
      p.settings.resolutionScale = 0.5;
    },
    (p) => {
      p.settings.densityPct = 50;
    },
    (p) => {
      p.settings.msaaSamples = 1;
    },
    (p) => {
      p.settings.antialias = false;
    },
    (p) => {
      delete p.settings.visual;
    },
    (p) => {
      p.browser.renderer = 'ANGLE (SwiftShader software)';
    },
    (p) => {
      p.browser.userAgent = 'other browser';
    },
    (p) => {
      p.browser.platform = 'win32';
    },
    (p) => {
      p.builds.baseline.baseUrl = 'https://example.com/';
    },
    (p) => {
      p.builds.baseline.baseUrl = p.builds.candidate.baseUrl;
    },
    (p) => {
      p.builds.candidate.profile = 'austin-map-streaming-v1';
    },
  ]) {
    const altered = structuredClone(plan);
    mutate(altered);
    assert.throws(() =>
      assertQualificationBuildIdentityPlan(altered, {
        expectedApplicationCommits: APPLICATION,
      }),
    );
  }
});

test('raw plan reader binds externally chosen bytes, selected commits and parsed content', async (t) => {
  const { planPath, context } = await fixture(t);
  const read = await readQualificationBuildIdentityPlan({
    planPath,
    expectedPlanSha256: context.planSha256,
    expectedApplicationCommits: APPLICATION,
  });
  assert.deepEqual(read.plan, context.plan);
  await assert.rejects(
    readQualificationBuildIdentityPlan({
      planPath,
      expectedPlanSha256: 'f'.repeat(64),
    }),
  );
  await assert.rejects(
    readQualificationBuildIdentityPlan({
      planPath,
      expectedPlanSha256: context.planSha256,
      expectedApplicationCommits: { baseline: CANDIDATE, candidate: BASELINE },
    }),
  );
  assert.throws(() =>
    inspectQualificationBuildIdentityPlan(Buffer.from('{}'), {
      expectedPlanSha256: hash('{}'),
    }),
  );
  context.plan.application.candidate = 'f'.repeat(40);
  await assert.rejects(
    verifyQualificationBuildIdentityAssets(context, 'candidate', 'before', {
      verifyAssets: async () =>
        assert.fail('changed parsed context must fail before verification'),
    }),
    /Parsed identity plan changed/,
  );
});

test('full receipt and served-byte validator receive exact roles, roots, harness and all assets', async (t) => {
  const { context } = await fixture(t);
  let calls = 0;
  const proof = await verifyQualificationBuildIdentityAssets(
    context,
    'candidate',
    'before',
    {
      now: () => '2026-10-20T00:00:01.000Z',
      verifyAssets: async (input) => {
        calls++;
        assert.equal(input.expectedAppCommit, CANDIDATE);
        assert.equal(input.expectedHarnessCommit, HARNESS);
        assert.equal(
          input.checkoutRoot,
          context.plan.builds.candidate.checkout,
        );
        assert.equal(input.buildRoot, context.plan.builds.candidate.root);
        assert.equal(input.harnessRoot, context.plan.buildHarness.checkout);
        assert.equal(input.baseUrl, context.plan.builds.candidate.baseUrl);
        assert.equal(input.expectedBuildProfile, null);
        assert.equal(input.receipt.assets.length, 2);
        return served(input);
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(proof.performanceEligible, false);
  assert.equal(proof.coldStartupEligible, false);
  assertQualificationBuildIdentityVerification(context, proof, {
    role: 'candidate',
    phase: 'before',
  });
  for (const mutate of [
    (p) => {
      p.role = 'baseline';
    },
    (p) => {
      p.planSha256 = 'f'.repeat(64);
    },
    (p) => {
      p.served.assetCount--;
    },
    (p) => {
      p.receipt.assets[1].sha256 = 'f'.repeat(64);
    },
    (p) => {
      p.applicationCommit = BASELINE;
    },
    (p) => {
      p.performanceEligible = true;
    },
  ]) {
    const altered = structuredClone(proof);
    mutate(altered);
    assert.throws(() =>
      assertQualificationBuildIdentityVerification(context, altered, {
        role: 'candidate',
        phase: 'before',
      }),
    );
  }
  await assert.rejects(
    verifyQualificationBuildIdentityAssets(context, 'candidate', 'before', {
      verifyAssets: async (input) => ({
        ...served(input),
        status: 'not-verified',
      }),
    }),
  );
});

test('changed Chrome, receipt bytes or provenance abort before a source identity can be issued', async (t) => {
  const fx = await fixture(t),
    options = {
      verifyAssets: async () =>
        assert.fail('must fail before served validation'),
    };
  const original = await readFile(fx.plan.browser.executable);
  await writeFile(fx.plan.browser.executable, 'changed Chrome');
  await assert.rejects(
    verifyQualificationBuildIdentityAssets(
      fx.context,
      'candidate',
      'before',
      options,
    ),
    /Chrome executable changed/,
  );
  await writeFile(fx.plan.browser.executable, original);
  await writeFile(fx.plan.builds.candidate.receipt, 'changed receipt');
  await assert.rejects(
    verifyQualificationBuildIdentityAssets(
      fx.context,
      'candidate',
      'before',
      options,
    ),
    /receipt file changed/,
  );
});

test('live identity requires protocol/page/process equality plus full native canvas and exact settings', async (t) => {
  const { context, plan } = await fixture(t);
  for (const role of ['baseline', 'candidate']) {
    const proof = assertQualificationLiveBuildIdentity(
      context,
      role,
      live(plan, role),
    );
    assert.equal(proof.applicationCommit, APPLICATION[role]);
    assert.equal(proof.comparisonEligible, false);
    assert.equal(proof.coldStartupEligible, false);
  }
  for (const mutate of [
    (x) => {
      x.actual.applicationCommit = BASELINE;
    },
    (x) => {
      x.browserVersion.product = 'Chrome/154.0.0.0';
    },
    (x) => {
      x.browserVersion.userAgent += ' changed';
    },
    (x) => {
      x.actual.userAgent += ' changed';
    },
    (x) => {
      x.actual.platform = 'win32';
    },
    (x) => {
      x.actual.renderer = 'SwiftShader';
    },
    (x) => {
      x.browserProcess.pid++;
    },
    (x) => {
      x.browserProcess.executable += '.different';
    },
    (x) => {
      x.actual.nativeSharpnessProfile.resolutionScale = 0.5;
    },
    (x) => {
      x.nativeWindowEvidence.page.devicePixelRatio = 1;
    },
    (x) => {
      x.nativeWindowEvidence.page.nativeResolution.canvas.width--;
    },
    (x) => {
      x.nativeWindowEvidence.page.focused = false;
    },
    (x) => {
      x.nativeWindowEvidence.host.foreground = false;
    },
    (x) => {
      x.actual.settings.visual.mapStack = 'changed';
    },
  ]) {
    const value = live(plan, 'candidate');
    mutate(value);
    assert.throws(() =>
      assertQualificationLiveBuildIdentity(context, 'candidate', value),
    );
  }
});

test('both-role before/after evidence must bracket the complete formal capture, never an action', async (t) => {
  const { context } = await fixture(t),
    boundaries = {};
  for (const role of ['baseline', 'candidate']) {
    boundaries[role] = {};
    for (const phase of ['before', 'after'])
      boundaries[role][phase] = await verifyQualificationBuildIdentityAssets(
        context,
        role,
        phase,
        {
          verifyAssets: async (input) => served(input),
          now: () =>
            phase === 'before'
              ? '2026-10-20T00:00:01.000Z'
              : '2026-10-20T00:00:04.000Z',
        },
      );
  }
  const span = {
    startedAt: '2026-10-20T00:00:02.000Z',
    completedAt: '2026-10-20T00:00:03.000Z',
  };
  assertQualificationBuildIdentityBoundaries(context, boundaries, span);
  assert.throws(() =>
    assertQualificationBuildIdentityBoundaries(context, boundaries),
  );
  const overlapping = structuredClone(boundaries);
  overlapping.candidate.after.startedAt = '2026-10-20T00:00:02.500Z';
  assert.throws(
    () =>
      assertQualificationBuildIdentityBoundaries(context, overlapping, span),
    /overlapped/,
  );
  const missing = structuredClone(boundaries);
  delete missing.baseline.before;
  assert.throws(() =>
    assertQualificationBuildIdentityBoundaries(context, missing, span),
  );
});

test('distinct direct evidence revalidates complete source and live proofs without inventing performance inputs', async (t) => {
  const { context, plan } = await fixture(t),
    boundaries = {},
    observations = {};
  for (const role of ['baseline', 'candidate']) {
    boundaries[role] = {};
    observations[role] = {};
    for (const phase of ['before', 'after']) {
      boundaries[role][phase] = await verifyQualificationBuildIdentityAssets(
        context,
        role,
        phase,
        {
          verifyAssets: async (input) => served(input),
          now: () =>
            phase === 'before'
              ? '2026-10-20T00:00:01.000Z'
              : '2026-10-20T00:00:04.000Z',
        },
      );
      const value = live(plan, role);
      value.nativeWindowEvidence.observedAtUtc =
        phase === 'before'
          ? '2026-10-20T00:00:02.250Z'
          : '2026-10-20T00:00:02.750Z';
      observations[role][phase] = assertQualificationLiveBuildIdentity(
        context,
        role,
        value,
      );
    }
  }
  const result = createQualificationBuildIdentityEvidence(context, {
    boundaries,
    live: observations,
    captureSpan: {
      startedAt: '2026-10-20T00:00:02.000Z',
      completedAt: '2026-10-20T00:00:03.000Z',
    },
  });
  assert.equal(result.coldStartupEligible, false);
  assert.equal(result.performanceEligible, false);
  assert.equal(result.captures, undefined);
  const inspected = inspectQualificationBuildIdentityEvidence(result, {
    expectedApplicationCommits: APPLICATION,
  });
  assert.equal(inspected.identities.baseline.applicationCommit, BASELINE);
  assert.equal(inspected.identities.candidate.applicationCommit, CANDIDATE);
  for (const mutate of [
    (x) => {
      x.live.candidate.before.role = 'baseline';
    },
    (x) => {
      delete x.live.baseline.after;
    },
    (x) => {
      delete x.boundaries.candidate.before;
    },
    (x) => {
      x.live.candidate.after.nativeWindowEvidence.browserPid++;
    },
    (x) => {
      x.live.baseline.before.nativeWindowEvidence.observedAtUtc =
        '2026-10-20T00:00:05.000Z';
    },
    (x) => {
      x.performanceEligible = true;
    },
  ]) {
    const bad = structuredClone(result);
    mutate(bad);
    assert.throws(() => inspectQualificationBuildIdentityEvidence(bad));
  }
});

test('actual CLI requires one complete source kind, with unchanged legacy and native opt-in requirements', () => {
  const source = readFileSync(
    new URL('../qa-qualification-metrics-capture.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('function cliArgs('),
    end = source.indexOf('\nfunction isMain(', start);
  assert.ok(start > 0 && end > start);
  const parse = runInNewContext(`(${source.slice(start, end)})`, {
    resolveQualificationIdentitySource,
  });
  const common = [
    'node',
    'capture',
    '--baseline-url',
    'http://127.0.0.1:4316',
    '--candidate-url',
    'http://127.0.0.1:4315',
    '--out',
    'new.json',
  ];
  const legacy = [
    '--baseline-capture',
    'base.json',
    '--candidate-capture',
    'candidate.json',
  ];
  const direct = [
    '--build-identity-plan',
    'identity.json',
    '--build-identity-plan-sha256',
    'a'.repeat(64),
    '--native-window-viewport',
    'true',
  ];
  assert.equal(parse([...common, ...legacy]).out, 'new.json');
  assert.equal(
    parse([...common, ...direct])['build-identity-plan'],
    'identity.json',
  );
  assert.throws(() => parse(common));
  assert.throws(() => parse([...common, '--baseline-capture', 'base.json']));
  assert.throws(() => parse([...common, ...direct, ...legacy]));
  assert.throws(() =>
    parse([
      ...common,
      ...direct,
      '--weather-identity-envelope',
      'weather.json',
    ]),
  );
  assert.throws(() => parse([...common, ...direct.slice(0, 4)]));
  assert.throws(() =>
    parse([...common, ...direct, '--native-window-viewport', 'false']),
  );
});

test('actual producer brackets all captures with source checks and retains primary failure if postflight fails', async (t) => {
  const fx = await fixture(t),
    source = readFileSync(
      new URL('../qa-qualification-metrics-capture.mjs', import.meta.url),
      'utf8',
    );
  const start = source.indexOf(
      'export async function runQualificationMetricsCapture(',
    ),
    end = source.indexOf('\nif (isMain())', start);
  assert.ok(start > 0 && end > start);
  for (const failBefore of [false, true]) {
    const events = [],
      writes = [];
    const execute = runInNewContext(
      `(${source.slice(start, end).replace('export ', '').replaceAll('import.meta.url', "'file:///capture-producer.mjs'")})`,
      {
        assert,
        URL,
        Buffer,
        resolveQualificationIdentitySource,
        QUALIFICATION_BUILD_IDENTITY_KIND,
        readQualificationBuildIdentityPlan: async () => ({
          ...fx.context,
          path: fx.planPath,
        }),
        qualificationBuildExpectedIdentity: (context, role) => ({
          applicationCommit: context.plan.application[role],
          browserVersion: context.plan.browser.product,
          renderer: RENDERER,
          userAgent: UA,
          platform: 'Win32',
          nativeDpr: 2,
        }),
        readWeatherBalancedIdentityCapturePair: () =>
          assert.fail('No weather fallback'),
        readCapture: () => assert.fail('No performance fallback'),
        fixtureIdentity: () => ({ fixtureId: 'unchanged-fixture' }),
        sha256: hash,
        readFile: async () => Buffer.from('frozen producer source'),
        fileURLToPath: (value) => String(value),
        writeFile: async (filename, text, options) =>
          writes.push({ filename, value: JSON.parse(text), options }),
        verifyQualificationBuildIdentityAssets: async (
          context,
          role,
          phase,
        ) => {
          events.push(`verify-${role}-${phase}`);
          if (
            (failBefore && phase === 'before') ||
            (!failBefore && phase === 'after' && role === 'baseline')
          )
            throw new Error(
              failBefore ? 'preflight failure' : 'postflight failure',
            );
          return { role, phase };
        },
        collectQualificationMetricsForBuild: async (input) => {
          events.push(`capture-${input.role}`);
          assert.equal(
            input.buildIdentityContext.planSha256,
            fx.context.planSha256,
          );
          assert.equal(
            input.expected.applicationCommit,
            APPLICATION[input.role],
          );
          return {
            status: input.role === 'baseline' ? 'failed' : 'completed',
            interactionStatus: 'failed',
            heapStatus: 'failed',
            failureReason:
              input.role === 'baseline' ? 'original primary failure' : null,
          };
        },
        createQualificationBuildIdentityEvidence: () =>
          assert.fail('A failed capture must not issue identity eligibility'),
        qualificationBuildIdentityEvidenceReference: () =>
          assert.fail('No valid envelope exists'),
        SCHEMA: 'gev-qualification-capture/v1',
        INTERACTION_SCHEMA: 'gev-interaction-latency-evidence/v4',
        INTERACTION_PROTOCOL: 'unchanged',
        INTERACTION_EVENT_TIMING_PLAN: {},
        LOCAL_RENDER_WITNESS: 'unchanged',
        REPLAY_RENDER_WITNESS: 'unchanged',
        QUALIFICATION_NATIVE_WINDOW_ENVIRONMENT_SCHEMA:
          'gev-qualification-native-window-environment/v1',
        QUALIFICATION_NATIVE_WINDOW_MODE: 'native-window-viewport-v1',
        LOCAL_CONTROL_CAMERA_ROUTE_ID: 'unchanged',
        LOCAL_CONTROL_CAMERA_LOCATION: {},
        HEAP_SCHEMA: 'gev-sampled-heap-evidence/v1',
        WORK_PLAN: { phaseIds: [], operationsPerCycle: {} },
        SAMPLE_CADENCE_MS: 1000,
        SAMPLE_MAX_GAP_MS: 5000,
      },
    );
    const result = await execute({
      baselineUrl: fx.plan.builds.baseline.baseUrl,
      candidateUrl: fx.plan.builds.candidate.baseUrl,
      buildIdentityPlanPath: fx.planPath,
      buildIdentityPlanSha256: fx.context.planSha256,
      nativeWindowViewport: true,
      outputPath: 'exclusive-output.json',
    });
    assert.equal(result.status, 'failed');
    assert.equal(
      result.failureReason,
      failBefore ? 'preflight failure' : 'original primary failure',
    );
    assert.deepEqual(
      events,
      failBefore
        ? ['verify-baseline-before']
        : [
            'verify-baseline-before',
            'verify-candidate-before',
            'capture-baseline',
            'capture-candidate',
            'verify-baseline-after',
            'verify-candidate-after',
          ],
    );
    assert.equal(result.interactionEvidence.status, 'failed');
    assert.equal(result.sampledHeapEvidence.status, 'failed');
    assert.equal(writes[0].options.flag, 'wx');
    assert.equal(writes.at(-1).value.failureReason, result.failureReason);
    if (!failBefore)
      assert.equal(
        result.buildIdentityPostflightErrors[0].message,
        'postflight failure',
      );
  }
});
