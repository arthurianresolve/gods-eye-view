import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  NATIVE_WINDOW_VIEWPORT_SCHEMA,
  assertMatchingNativeWindowViewport,
  assertNativeWindowViewportEvidence,
  createNativeWindowViewportOwner,
  readNativeWindowViewportInPage,
  readOwnedWindowsNativeWindowGeometry,
  physicalRectToEnclosingDips,
  resolveNativeWindowBrowserOptions,
} from './nativeWindowViewport.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
function fixture({ canvas = true } = {}) {
  const visual = {
    width: 1280,
    height: 600,
    scale: 1,
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
  };
  return {
    schema: NATIVE_WINDOW_VIEWPORT_SCHEMA,
    browserPid: 1122,
    metricsEmulation: 'cleared-before-navigation',
    puppeteerViewport: null,
    cdpBoundsMapping: 'native-DIPs:windowRect',
    page: {
      devicePixelRatio: 2,
      inner: { width: 1280, height: 600 },
      outer: { width: 1280, height: 700 },
      screenPosition: { x: -8, y: -8 },
      screen: {
        width: 1280,
        height: 720,
        availLeft: 0,
        availTop: 0,
        availWidth: 1280,
        availHeight: 700,
        colorDepth: 24,
        pixelDepth: 24,
      },
      visualViewport: visual,
      documentClient: { width: 1280, height: 600 },
      scroll: { x: 0, y: 0 },
      visibilityState: 'visible',
      focused: true,
      nativeResolution: canvas
        ? {
            devicePixelRatio: 2,
            canvas: {
              clientWidth: 1280,
              clientHeight: 600,
              width: 2560,
              height: 1200,
            },
            sceneDrawingBuffer: { width: 2560, height: 1200 },
            resolutionScale: 1,
            useBrowserRecommendedResolution: false,
            maximumScreenSpaceError: 1,
          }
        : null,
      canvasRect: canvas ? rect(0, 0, 1280, 600) : null,
    },
    host: {
      schema: 'gev-owned-windows-window-geometry/v1',
      browserPid: 1122,
      ownerPid: 1122,
      windowHandle: '55',
      ownedWindowCount: 1,
      physicalPixelReadContext: 'per-monitor-aware-v2',
      targetDpiAwareness: 2,
      dpi: 192,
      visible: true,
      minimized: false,
      maximized: true,
      foreground: true,
      // These invisible outer borders intentionally extend outside the work area.
      windowRect: rect(-16, -16, 2592, 1432),
      clientRect: rect(0, 0, 2560, 1400),
      visibleFrameRect: rect(0, 0, 2560, 1400),
      monitor: {
        device: '\\\\.\\DISPLAY1',
        bounds: rect(0, 0, 2560, 1440),
        workArea: rect(0, 0, 2560, 1400),
        displayMode: {
          width: 2560,
          height: 1440,
          refreshHz: 60,
          bitsPerPixel: 32,
          orientation: 0,
          positionX: 0,
          positionY: 0,
          adapter: 'Fixture native GPU',
        },
      },
    },
    cdp: {
      windowId: 7,
      windowBounds: {
        left: -8,
        top: -8,
        width: 1296,
        height: 716,
        windowState: 'maximized',
      },
      layoutMetrics: {
        cssLayoutViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 1280,
          clientHeight: 600,
        },
        cssVisualViewport: {
          offsetX: 0,
          offsetY: 0,
          pageX: 0,
          pageY: 0,
          clientWidth: 1280,
          clientHeight: 600,
          scale: 1,
          zoom: 1,
        },
        cssContentSize: { x: 0, y: 0, width: 1280, height: 600 },
      },
    },
  };
}

test('native window mode is explicit and leaves legacy launch options untouched', () => {
  const legacy = {
    headless: true,
    defaultViewport: { width: 1440, height: 1000 },
  };
  assert.deepEqual(
    resolveNativeWindowBrowserOptions(legacy, { nativeResolution: true }),
    legacy,
  );
  assert.deepEqual(
    resolveNativeWindowBrowserOptions(
      { headless: false },
      {
        nativeResolution: true,
        nativeWindowViewport: true,
      },
    ),
    { headless: false, defaultViewport: null },
  );
  for (const [options, flags] of [
    [{ headless: false }, { nativeResolution: false }],
    [{ headless: true }, { nativeResolution: true }],
    [{}, { nativeResolution: true }],
    [
      { headless: false, defaultViewport: { width: 1, height: 1 } },
      { nativeResolution: true },
    ],
    [{ headless: false, devtools: true }, { nativeResolution: true }],
    ...[
      '--force-device-scale-factor=2',
      '--high-dpi-support=1',
      '--headless=new',
    ].map((arg) => [
      { headless: false, args: [arg] },
      { nativeResolution: true },
    ]),
  ])
    assert.throws(() =>
      resolveNativeWindowBrowserOptions(options, {
        ...flags,
        nativeWindowViewport: true,
      }),
    );
});

test('physical content fits without rejecting the invisible maximized outer border', () => {
  const evidence = fixture();
  assert.equal(
    assertNativeWindowViewportEvidence(evidence, { expectedDpr: 2 }),
    evidence,
  );
  assert.ok(
    evidence.host.windowRect.left < evidence.host.monitor.workArea.left,
  );
  const visibleBounds = fixture();
  visibleBounds.cdp.windowBounds = {
    left: 0,
    top: 0,
    width: 1280,
    height: 700,
    windowState: 'maximized',
  };
  visibleBounds.cdpBoundsMapping = 'native-DIPs:visibleFrameRect';
  assert.equal(
    assertNativeWindowViewportEvidence(visibleBounds, { expectedDpr: 2 }),
    visibleBounds,
  );
});

test('native DIP enclosure rounds edges outward including odd negative invisible borders', () => {
  assert.deepEqual(
    physicalRectToEnclosingDips(rect(-13, -13, 2586, 1386), 2),
    rect(-7, -7, 1294, 694),
  );
  assert.deepEqual(
    physicalRectToEnclosingDips(rect(13, 13, 2586, 1386), 2),
    rect(6, 6, 1294, 694),
  );
  assert.deepEqual(
    physicalRectToEnclosingDips(rect(-13, -13, 2586, 1386), 1.25),
    rect(-11, -11, 2070, 1110),
  );
  assert.throws(
    () => physicalRectToEnclosingDips(rect(0, 0, 1, 1), 0),
    /scale/,
  );
});

test('actual odd-border native preparation maps exactly and rejects every one-DIP mismatch', () => {
  const evidence = fixture({ canvas: false });
  evidence.host.windowRect = rect(-13, -13, 2586, 1386);
  evidence.host.clientRect = rect(0, 0, 2560, 1360);
  evidence.host.visibleFrameRect = rect(0, 0, 2560, 1360);
  evidence.host.monitor.workArea = rect(0, 0, 2560, 1360);
  evidence.page.screen.availHeight = 680;
  evidence.page.outer.height = 680;
  evidence.page.inner.height = 537;
  evidence.page.visualViewport.height = 537;
  evidence.page.documentClient.height = 537;
  evidence.cdp.layoutMetrics.cssLayoutViewport.clientHeight = 537;
  evidence.cdp.layoutMetrics.cssVisualViewport.clientHeight = 537;
  evidence.cdp.layoutMetrics.cssContentSize.height = 537;
  evidence.cdp.windowBounds = {
    left: -7,
    top: -7,
    width: 1294,
    height: 694,
    windowState: 'maximized',
  };
  assert.equal(
    assertNativeWindowViewportEvidence(evidence, {
      expectedDpr: 2,
      requireCanvas: false,
    }),
    evidence,
  );
  for (const axis of ['left', 'top', 'width', 'height'])
    for (const delta of [-1, 1]) {
      const changed = clone(evidence);
      changed.cdp.windowBounds[axis] += delta;
      assert.throws(
        () =>
          assertNativeWindowViewportEvidence(changed, {
            expectedDpr: 2,
            requireCanvas: false,
          }),
        /coordinate mapping/,
      );
    }
  const clipped = clone(evidence);
  clipped.host.visibleFrameRect = rect(-1, 0, 2560, 1360);
  assert.throws(
    () =>
      assertNativeWindowViewportEvidence(clipped, {
        expectedDpr: 2,
        requireCanvas: false,
      }),
    /outside/,
  );
});

test('missing, virtualized, oversized, zoomed or softened evidence fails closed', async (t) => {
  const changes = [
    [
      'missing OS evidence',
      (e) => {
        e.host = null;
      },
    ],
    [
      'foreign window PID',
      (e) => {
        e.host.ownerPid++;
      },
    ],
    [
      'missing DPI awareness',
      (e) => {
        e.host.targetDpiAwareness = null;
      },
    ],
    [
      'virtualized target',
      (e) => {
        e.host.targetDpiAwareness = 0;
      },
    ],
    [
      'virtualized reader',
      (e) => {
        e.host.physicalPixelReadContext = 'system';
      },
    ],
    [
      'wrong native DPI',
      (e) => {
        e.host.dpi = 96;
      },
    ],
    [
      'missing active display mode',
      (e) => {
        delete e.host.monitor.displayMode;
      },
    ],
    [
      'wrong active display mode',
      (e) => {
        e.host.monitor.displayMode.width--;
      },
    ],
    [
      'missing refresh rate',
      (e) => {
        delete e.host.monitor.displayMode.refreshHz;
      },
    ],
    [
      'minimized window',
      (e) => {
        e.host.minimized = true;
      },
    ],
    [
      'non-maximized CDP window',
      (e) => {
        e.cdp.windowBounds.windowState = 'normal';
      },
    ],
    [
      'unproven CDP placement',
      (e) => {
        e.cdp.windowBounds.left++;
      },
    ],
    [
      'missing CDP size',
      (e) => {
        delete e.cdp.windowBounds.width;
      },
    ],
    [
      'outer-only visible proof',
      (e) => {
        e.host.visibleFrameRect = null;
      },
    ],
    [
      'clipped visible frame',
      (e) => {
        e.host.visibleFrameRect = rect(-1, 0, 2560, 1400);
      },
    ],
    [
      'clipped client area',
      (e) => {
        e.host.clientRect = rect(0, 0, 2560, 1401);
      },
    ],
    [
      'old oversized fixture',
      (e) => {
        e.page.inner = { width: 1440, height: 1000 };
        e.page.outer = { width: 1440, height: 1000 };
        e.page.documentClient = { ...e.page.inner };
        Object.assign(e.page.visualViewport, e.page.inner);
        Object.assign(e.cdp.layoutMetrics.cssVisualViewport, {
          clientWidth: 1440,
          clientHeight: 1000,
        });
        Object.assign(e.cdp.layoutMetrics.cssLayoutViewport, {
          clientWidth: 1440,
          clientHeight: 1000,
        });
      },
    ],
    [
      'active emulation',
      (e) => {
        e.puppeteerViewport = { width: 1280, height: 600 };
      },
    ],
    [
      'missing zoom',
      (e) => {
        delete e.cdp.layoutMetrics.cssVisualViewport.zoom;
      },
    ],
    [
      'desktop zoom',
      (e) => {
        e.cdp.layoutMetrics.cssVisualViewport.zoom = 1.25;
      },
    ],
    [
      'pinch zoom',
      (e) => {
        e.page.visualViewport.scale = 1.2;
      },
    ],
    [
      'wrong screen mapping',
      (e) => {
        e.page.screen.width++;
      },
    ],
    [
      'wrong workarea origin',
      (e) => {
        e.page.screen.availLeft = 1;
      },
    ],
    [
      'wrong CSS viewport',
      (e) => {
        e.page.visualViewport.width--;
      },
    ],
    [
      'missing canvas',
      (e) => {
        e.page.nativeResolution = null;
      },
    ],
    [
      'reduced renderer scale',
      (e) => {
        e.page.nativeResolution.resolutionScale = 0.5;
      },
    ],
    [
      'reduced globe detail',
      (e) => {
        e.page.nativeResolution.maximumScreenSpaceError = 2;
      },
    ],
    [
      'reduced canvas buffer',
      (e) => {
        e.page.nativeResolution.canvas.width /= 2;
      },
    ],
    [
      'clipped canvas',
      (e) => {
        e.page.canvasRect.right++;
      },
    ],
  ];
  for (const [name, change] of changes)
    await t.test(name, () => {
      const evidence = fixture();
      change(evidence);
      assert.throws(() =>
        assertNativeWindowViewportEvidence(evidence, { expectedDpr: 2 }),
      );
    });
});

test('paired geometry permits separate owners but requires identical native dimensions and proof', () => {
  const baseline = fixture(),
    candidate = fixture();
  candidate.browserPid++;
  candidate.host.browserPid++;
  candidate.host.ownerPid++;
  candidate.host.windowHandle = '99';
  candidate.cdp.windowId++;
  assert.equal(assertMatchingNativeWindowViewport(baseline, candidate), true);
  const changed = fixture();
  changed.page.outer.height--;
  assert.throws(
    () => assertMatchingNativeWindowViewport(baseline, changed),
    /geometry/,
  );
  const missing = fixture();
  delete missing.host;
  assert.throws(() => assertMatchingNativeWindowViewport(baseline, missing));
  assert.throws(
    () =>
      assertNativeWindowViewportEvidence(changed, {
        expectedDpr: 2,
        reference: baseline,
      }),
    /geometry/,
  );
});

test('serialized reader retains CSS/native dimensions and separate scale indicators', () => {
  const expected = fixture().page;
  const native = expected.nativeResolution;
  const result = vm.runInNewContext(
    `(${readNativeWindowViewportInPage.toString()})()`,
    {
      window: {
        devicePixelRatio: 2,
        innerWidth: 1280,
        innerHeight: 600,
        outerWidth: 1280,
        outerHeight: 700,
        screenX: -8,
        screenY: -8,
        scrollX: 0,
        scrollY: 0,
        screen: expected.screen,
        visualViewport: expected.visualViewport,
        __godsEyeView: {
          viewer: {
            resolutionScale: 1,
            useBrowserRecommendedResolution: false,
            scene: {
              canvas: {
                ...native.canvas,
                getBoundingClientRect: () => expected.canvasRect,
              },
              drawingBufferWidth: 2560,
              drawingBufferHeight: 1200,
              globe: { maximumScreenSpaceError: 1 },
            },
          },
        },
      },
      document: {
        documentElement: { clientWidth: 1280, clientHeight: 600 },
        visibilityState: 'visible',
        hasFocus: () => true,
      },
    },
  );
  assert.deepEqual(clone(result), expected);
});

test('pre-navigation quirks document uses the CSSOM body viewport without altering it', () => {
  const page = fixture({ canvas: false }).page;
  const result = vm.runInNewContext(
    `(${readNativeWindowViewportInPage.toString()})()`,
    {
      window: {
        devicePixelRatio: 2,
        innerWidth: 1280,
        innerHeight: 600,
        outerWidth: 1280,
        outerHeight: 700,
        screenX: -8,
        screenY: -8,
        scrollX: 0,
        scrollY: 0,
        screen: page.screen,
        visualViewport: page.visualViewport,
      },
      document: {
        compatMode: 'BackCompat',
        documentElement: { clientWidth: 1280, clientHeight: 16 },
        body: { clientWidth: 1280, clientHeight: 600 },
        visibilityState: 'visible',
        hasFocus: () => true,
      },
    },
  );
  assert.deepEqual(clone(result), page);
});

function ownerHarness() {
  const state = {
    evidence: fixture({ canvas: false }),
    viewport: null,
    commands: [],
    detached: 0,
    waits: 0,
  };
  const session = {
    async send(method, params) {
      state.commands.push({ method, params });
      if (method === 'Browser.getWindowForTarget')
        return {
          windowId: state.evidence.cdp.windowId,
          bounds: clone(state.evidence.cdp.windowBounds),
        };
      if (method === 'Browser.getWindowBounds')
        return { bounds: clone(state.evidence.cdp.windowBounds) };
      if (method === 'Page.getLayoutMetrics')
        return clone(state.evidence.cdp.layoutMetrics);
      if (
        method === 'Browser.setWindowBounds' ||
        method === 'Emulation.clearDeviceMetricsOverride'
      )
        return {};
      throw new Error('Unexpected command ' + method);
    },
    async detach() {
      state.detached++;
    },
  };
  const page = {
    viewport: () => state.viewport,
    async createCDPSession() {
      return session;
    },
    async evaluate(callback) {
      assert.equal(callback, readNativeWindowViewportInPage);
      return clone(state.evidence.page);
    },
    async setViewport() {
      throw new Error('Must not emulate or resize content');
    },
  };
  const options = {
    page,
    browserPid: 1122,
    browserOptions: { headless: false, defaultViewport: null },
    readHostWindow: async (pid) => {
      assert.equal(pid, 1122);
      return clone(state.evidence.host);
    },
    wait: async (ms) => {
      assert.equal(ms, 50);
      state.waits++;
    },
  };
  return { state, options };
}

test('owned preparation maximizes once, clears emulation, then only reads checkpoints', async () => {
  const { state, options } = ownerHarness();
  const owner = await createNativeWindowViewportOwner(options);
  assert.equal(owner.nativeDpr, 2);
  assert.equal(owner.configured.page.nativeResolution, null);
  assert.equal(state.waits, 1);
  const writes = state.commands.filter((entry) =>
    [
      'Browser.setWindowBounds',
      'Emulation.clearDeviceMetricsOverride',
    ].includes(entry.method),
  );
  assert.deepEqual(writes, [
    {
      method: 'Browser.setWindowBounds',
      params: { windowId: 7, bounds: { windowState: 'maximized' } },
    },
    { method: 'Emulation.clearDeviceMetricsOverride', params: undefined },
  ]);
  state.evidence = fixture();
  const startup = await owner.capture('startup');
  const restored = await owner.capture('workspace-restored');
  assert.equal(assertMatchingNativeWindowViewport(startup, restored), true);
  assert.equal(restored.ordinal, 3);
  assert.equal(
    state.commands.filter((entry) => entry.method === 'Browser.setWindowBounds')
      .length,
    1,
  );
  await owner.dispose();
  await owner.dispose();
  assert.equal(state.detached, 1);
  await assert.rejects(owner.capture('late'), /disposed/);
});

test('owned failure cleans its CDP session and preserves failed geometry evidence', async () => {
  const { state, options } = ownerHarness();
  state.evidence.page.visualViewport.scale = 2;
  await assert.rejects(createNativeWindowViewportOwner(options), (error) => {
    assert.equal(error.nativeWindowViewport.page.visualViewport.scale, 2);
    return /scale/.test(error.message);
  });
  assert.equal(state.detached, 1);
  const changed = ownerHarness();
  const owner = await createNativeWindowViewportOwner(changed.options);
  changed.state.viewport = { width: 1440, height: 1000 };
  await assert.rejects(owner.capture('changed'), /emulation/);
  await owner.dispose();
});

test('native window association and unchanged geometry remain mandatory after navigation', async () => {
  const h = ownerHarness();
  const owner = await createNativeWindowViewportOwner(h.options);
  h.state.evidence.cdp.windowId++;
  await assert.rejects(owner.capture('foreign'), /CDP window changed/);
  await owner.dispose();
  const second = ownerHarness();
  const other = await createNativeWindowViewportOwner(second.options);
  second.state.evidence = fixture();
  second.state.evidence.page.outer.height--;
  await assert.rejects(
    other.capture('resized'),
    /Configured native window geometry changed/,
  );
  await other.dispose();
});

test('Windows host probe is bounded, PID-bound and read-only for target windows', async () => {
  let calls = 0;
  const expected = fixture().host;
  const result = await readOwnedWindowsNativeWindowGeometry(1122, {
    platform: 'win32',
    run: async (executable, args, options) => {
      calls++;
      assert.equal(executable, 'powershell.exe');
      assert.equal(options.timeout, 5000);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.GEV_NATIVE_WINDOW_BROWSER_PID, '1122');
      const source = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.match(source, /GetWindowDpiAwarenessContext/);
      assert.match(source, /DwmGetWindowAttribute/);
      assert.ok(
        source.indexOf('if (pid != ownedPid) return true') <
          source.indexOf('var name = new StringBuilder'),
      );
      assert.doesNotMatch(
        source,
        /SetWindowPos|SetForegroundWindow|ShowWindow|MoveWindow/,
      );
      return { stdout: JSON.stringify(expected) };
    },
  });
  assert.deepEqual(result, expected);
  assert.equal(calls, 1);
  await assert.rejects(
    readOwnedWindowsNativeWindowGeometry(1122, { platform: 'linux' }),
    /Windows desktop/,
  );
  await assert.rejects(
    readOwnedWindowsNativeWindowGeometry(-1, { platform: 'win32' }),
    /PID/,
  );
  await assert.rejects(
    readOwnedWindowsNativeWindowGeometry(1122, {
      platform: 'win32',
      run: async () => ({
        stdout: JSON.stringify({ ...expected, ownerPid: 1 }),
      }),
    }),
    /owned PID/,
  );
});
