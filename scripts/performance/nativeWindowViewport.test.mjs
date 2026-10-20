import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { nativeWindowHostQueryError } from './nativeWindowGeometrySession.mjs';
import {
  NATIVE_WINDOW_VIEWPORT_SCHEMA,
  assertMatchingNativeWindowViewport,
  assertNativeWindowViewportEvidence,
  createNativeWindowViewportOwner,
  getWindowsNativeWindowGeometryScript,
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
    layoutReads: 0,
    pageReads: 0,
    hostReads: 0,
    sessions: 0,
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
      if (method === 'Page.getLayoutMetrics') {
        state.layoutReads++;
        const layout = clone(state.evidence.cdp.layoutMetrics);
        return state.onLayout?.(layout, state.layoutReads) ?? layout;
      }
      if (
        method === 'Browser.setWindowBounds' ||
        method === 'Emulation.clearDeviceMetricsOverride'
      )
        return {};
      throw new Error('Unexpected command ' + method);
    },
    async detach() {
      state.detached++;
      return state.onDetach?.();
    },
  };
  const page = {
    viewport: () => state.viewport,
    async createCDPSession() {
      state.sessions++;
      return session;
    },
    async evaluate(callback) {
      assert.equal(callback, readNativeWindowViewportInPage);
      state.pageReads++;
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
    readHostWindow: async (pid, operationOptions) => {
      assert.equal(pid, 1122);
      state.hostReads++;
      return state.onHost?.(operationOptions) ?? clone(state.evidence.host);
    },
    wait: async (ms) => {
      assert.equal(ms, 50);
      state.waits++;
      return state.onWait?.();
    },
  };
  return { state, options };
}

function staleLayout(layout) {
  for (const viewport of [layout.cssLayoutViewport, layout.cssVisualViewport])
    Object.assign(viewport, { clientWidth: 1037, clientHeight: 511 });
  return layout;
}

test('the native owner starts one geometry session before preparation reads and disposes it with CDP', async () => {
  const h = ownerHarness();
  delete h.options.readHostWindow;
  let factories = 0,
    starts = 0,
    queries = 0,
    disposals = 0;
  const cleanup = {
    status: 'closed',
    helperPid: 9001,
    exitCode: 0,
    signal: null,
    requests: 3,
  };
  h.options.hostSessionFactory = ({ browserPid, geometryScript }) => {
    factories++;
    assert.equal(browserPid, 1122);
    assert.equal(geometryScript, getWindowsNativeWindowGeometryScript());
    return {
      start: async ({ signal }) => {
        starts++;
        assert.equal(signal.aborted, false);
        assert.equal(h.state.pageReads, 0);
      },
      query: async (pid) => {
        assert.equal(pid, 1122);
        return {
          ...clone(h.state.evidence.host),
          query: { requestId: ++queries, helperPid: 9001 },
        };
      },
      dispose: async () => {
        disposals++;
        return cleanup;
      },
      read: () => ({ cleanup }),
    };
  };
  const owner = await createNativeWindowViewportOwner(h.options);
  h.state.evidence = fixture();
  const after = await owner.capture('fresh-checkpoint');
  assert.equal(factories, 1);
  assert.equal(starts, 1);
  assert.equal(queries, 3);
  assert.ok(after.host.query.requestId > owner.configured.host.query.requestId);
  assert.deepEqual(await owner.dispose(), {
    status: 'disposed',
    hostQueryCleanup: cleanup,
  });
  await owner.dispose();
  assert.equal(disposals, 1);
  assert.equal(h.state.detached, 1);
});

test('session startup, query and cleanup failures preserve structured host cause and release CDP without retry', async () => {
  for (const phase of ['startup', 'query', 'cleanup']) {
    const h = ownerHarness();
    delete h.options.readHostWindow;
    let queries = 0,
      disposals = 0;
    const cause = nativeWindowHostQueryError(
      Object.assign(new Error('timeout'), {
        code: 'ETIMEDOUT',
        gevTimeout: true,
        killed: true,
        signal: 'SIGTERM',
        stderr: '#< CLIXML\r\n',
      }),
      { phase, browserPid: 1122, helperPid: 9001, elapsedMs: 5000 },
    );
    const cleanup = {
      status: 'closed',
      exitCode: null,
      signal: 'SIGTERM',
      forcedTermination: true,
    };
    h.options.hostSessionFactory = () => ({
      start: async () => {
        if (phase === 'startup') throw cause;
      },
      query: async () => {
        if (++queries === 3 && phase === 'query') throw cause;
        return clone(h.state.evidence.host);
      },
      dispose: async () => {
        disposals++;
        if (phase === 'cleanup') throw cause;
        return cleanup;
      },
      read: () => ({ cleanup, failure: cause.nativeWindowHostQueryFailure }),
    });
    if (phase === 'startup')
      await assert.rejects(
        createNativeWindowViewportOwner(h.options),
        (error) => {
          assert.equal(
            error.nativeWindowViewport.hostQueryFailure.phase,
            'startup',
          );
          return true;
        },
      );
    else {
      const owner = await createNativeWindowViewportOwner(h.options);
      h.state.evidence = fixture();
      if (phase === 'query')
        await assert.rejects(owner.capture('failed-fresh-query'), (error) => {
          assert.deepEqual(
            error.nativeWindowViewport.hostQueryFailure,
            cause.nativeWindowHostQueryFailure,
          );
          assert.equal(error.nativeWindowViewport.host, undefined);
          return true;
        });
      if (phase === 'cleanup')
        await assert.rejects(owner.dispose(), (error) => {
          assert.deepEqual(error.nativeWindowGeometryHelperCleanup, cleanup);
          return true;
        });
      else await owner.dispose();
    }
    assert.equal(disposals, 1, phase);
    assert.equal(h.state.detached, 1, phase);
    assert.equal(
      queries,
      phase === 'startup' ? 0 : phase === 'query' ? 3 : 2,
      phase,
    );
  }
});

test('preparation cancellation owns a pending helper startup and still disposes both resources', async () => {
  const h = ownerHarness();
  delete h.options.readHostWindow;
  const controller = new AbortController();
  h.options.preparationSignal = controller.signal;
  let started = false,
    disposed = 0;
  h.options.hostSessionFactory = () => ({
    start: ({ signal }) =>
      new Promise((resolve, reject) => {
        started = true;
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
    query: () => assert.fail('No read before ready'),
    dispose: async () => {
      disposed++;
    },
    read: () => ({}),
  });
  const pending = createNativeWindowViewportOwner(h.options);
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('cancel helper startup'));
  await assert.rejects(pending, /cancel helper startup/);
  assert.equal(disposed, 1);
  assert.equal(h.state.detached, 1);
  assert.equal(h.state.pageReads, 0);
});

test('the actual driver close closure retains helper exit proof and closes the browser after helper failure', async () => {
  const source = readFileSync(
    new URL('../qa-rendered-soak-driver.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  let closePromise = null;'),
    end = source.indexOf('  let startupPrewarm = null;', start);
  assert.ok(start >= 0 && end > start);
  for (const fail of [false, true]) {
    const order = [],
      helper = {
        status: 'closed',
        exitCode: fail ? null : 0,
        signal: fail ? 'SIGTERM' : null,
      };
    const cause = Object.assign(new Error('helper failed'), {
      nativeWindowGeometryHelperCleanup: helper,
    });
    const close = vm.runInNewContext(`${source.slice(start, end)}; closeSoak`, {
      diagnosticsPage: null,
      nativeWindowOwner: {
        dispose: async () => {
          order.push('helper');
          if (fail) throw cause;
          return { hostQueryCleanup: helper };
        },
      },
      closeBrowser: async () => {
        order.push('browser');
        return { closeCompleted: true, forcedProcessTermination: false };
      },
    });
    if (fail)
      await assert.rejects(close(), (error) => {
        assert.equal(error, cause);
        assert.equal(error.browserClose.closeCompleted, true);
        assert.deepEqual(error.browserClose.nativeWindowGeometryHelper, helper);
        return true;
      });
    else {
      const result = await close();
      assert.deepEqual(result.nativeWindowGeometryHelper, helper);
      await close();
    }
    assert.deepEqual(order, ['helper', 'browser']);
  }
});

test('one-shot compatibility errors preserve execFile timeout facts without serializing its command', async () => {
  const encoded = 'A'.repeat(20000);
  const cause = Object.assign(
    new Error(`Command failed: powershell.exe -EncodedCommand ${encoded}`),
    {
      code: null,
      signal: 'SIGTERM',
      killed: true,
      stdout: '',
      stderr: '#< CLIXML\r\n',
    },
  );
  await assert.rejects(
    readOwnedWindowsNativeWindowGeometry(1122, {
      platform: 'win32',
      run: async () => {
        throw cause;
      },
    }),
    (error) => {
      const failure = error.nativeWindowHostQueryFailure;
      assert.equal(failure.code, null);
      assert.equal(failure.signal, 'SIGTERM');
      assert.equal(failure.killed, true);
      assert.equal(failure.timedOut, true);
      assert.equal(failure.stderr.text, '#< CLIXML\r\n');
      assert.ok(JSON.stringify(error).length < 2000);
      assert.ok(!error.message.includes(encoded));
      return true;
    },
  );
});

test('already cancelled preparation allocates no CDP session or native reads', async () => {
  const h = ownerHarness(),
    controller = new AbortController();
  controller.abort(new Error('cancelled before preparation'));
  h.options.preparationSignal = controller.signal;
  await assert.rejects(
    createNativeWindowViewportOwner(h.options),
    /cancelled before preparation/,
  );
  assert.equal(h.state.sessions, 0);
  assert.equal(h.state.commands.length, 0);
  assert.equal(h.state.hostReads, 0);
});

test('preparation retains stale CDP then A/B/B exact proofs and freezes only the final stable geometry', async () => {
  const h = ownerHarness();
  h.options.settleAttempts = 4;
  h.state.onLayout = (layout, count) =>
    count === 1 ? staleLayout(layout) : layout;
  h.state.onWait = () => {
    if (h.state.waits === 2) h.state.evidence.page.outer.height--;
  };
  const owner = await createNativeWindowViewportOwner(h.options);
  assert.deepEqual(
    owner.preparation.attempts.map((a) => a.status),
    ['incoherent', 'coherent', 'coherent', 'coherent'],
  );
  assert.equal(owner.preparation.acceptedAttempt, 4);
  assert.equal(
    owner.preparation.attempts[0].evidence.cdp.layoutMetrics.cssVisualViewport
      .clientWidth,
    1037,
  );
  assert.equal(owner.preparation.attempts[0].evidence.page.inner.width, 1280);
  assert.equal(owner.preparation.attempts[2].matchesPrevious, false);
  assert.equal(owner.configured.page.outer.height, 699);
  assert.doesNotThrow(() => JSON.stringify(owner.configured));
  h.state.evidence = fixture();
  h.state.evidence.page.outer.height = 699;
  await owner.capture('startup');
  await owner.dispose();
  assert.equal(h.state.detached, 1);
});

test('incoherent preparation breaks consecutive matches and bounded non-settlement preserves every attempt', async () => {
  const broken = ownerHarness();
  broken.options.settleAttempts = 4;
  broken.state.onLayout = (layout, count) =>
    count === 2 ? staleLayout(layout) : layout;
  const owner = await createNativeWindowViewportOwner(broken.options);
  assert.deepEqual(
    owner.preparation.attempts.map((a) => a.status),
    ['coherent', 'incoherent', 'coherent', 'coherent'],
  );
  assert.equal(owner.preparation.acceptedAttempt, 4);
  await owner.dispose();
  for (const alternate of [false, true]) {
    const h = ownerHarness();
    h.options.settleAttempts = 3;
    if (alternate)
      h.state.onWait = () => {
        h.state.evidence.page.outer.height = h.state.waits % 2 ? 699 : 700;
      };
    else h.state.onLayout = (layout) => staleLayout(layout);
    await assert.rejects(
      createNativeWindowViewportOwner(h.options),
      (error) => {
        assert.match(error.message, /did not settle/);
        const proof = error.nativeWindowViewport;
        assert.equal(proof.preparation.status, 'failed');
        assert.equal(proof.preparation.attempts.length, 3);
        assert.equal(proof.preparation.cleanup.status, 'completed');
        assert.throws(() =>
          assertNativeWindowViewportEvidence(proof, {
            expectedDpr: 2,
            requireCanvas: false,
          }),
        );
        return true;
      },
    );
    assert.equal(h.state.detached, 1);
    assert.equal(h.state.waits, 2);
  }
});

test('preparation cancellation consumes late work and disposes the owned session once', async () => {
  const h = ownerHarness(),
    controller = new AbortController();
  h.options.preparationSignal = controller.signal;
  let reachedWait, releaseWait, waitSignal;
  const waiting = new Promise((resolve) => {
    reachedWait = resolve;
  });
  h.options.wait = (ms, { signal }) => {
    assert.equal(ms, 50);
    waitSignal = signal;
    reachedWait();
    return new Promise((resolve) => {
      releaseWait = resolve;
    });
  };
  const pending = createNativeWindowViewportOwner(h.options);
  await waiting;
  controller.abort(new Error('cancelled owned preparation'));
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /cancelled owned preparation/);
    assert.equal(error.nativeWindowViewport.preparation.attempts.length, 1);
    assert.equal(
      error.nativeWindowViewport.preparation.cleanup.status,
      'completed',
    );
    return true;
  });
  assert.equal(waitSignal.aborted, true);
  const reads = h.state.hostReads;
  releaseWait();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.hostReads, reads);
  assert.equal(h.state.detached, 1);
});

test('preparation deadline retains a partial host read and bounded cleanup cannot block factory close', async () => {
  const h = ownerHarness();
  h.options.settleTimeoutMs = 20;
  let releaseHost, hostSignal;
  h.state.onHost = ({ signal }) => {
    hostSignal = signal;
    return new Promise((resolve) => {
      releaseHost = resolve;
    });
  };
  await assert.rejects(createNativeWindowViewportOwner(h.options), (error) => {
    assert.match(error.message, /timed out/);
    const attempt = error.nativeWindowViewport.preparation.attempts[0];
    assert.ok(attempt.evidence.cdp.layoutMetrics);
    assert.equal(attempt.evidence.page, undefined);
    assert.equal(
      error.nativeWindowViewport.preparation.cleanup.status,
      'completed',
    );
    return true;
  });
  assert.equal(hostSignal.aborted, true);
  const pageReads = h.state.pageReads;
  releaseHost(clone(h.state.evidence.host));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.pageReads, pageReads);
  assert.equal(h.state.detached, 1);

  const blocked = ownerHarness();
  blocked.options.settleTimeoutMs = 20;
  blocked.options.preparationCleanupTimeoutMs = 20;
  blocked.state.onLayout = () => new Promise(() => {});
  blocked.state.onDetach = () => new Promise(() => {});
  await assert.rejects(
    createNativeWindowViewportOwner(blocked.options),
    (error) => {
      assert.match(error.message, /preparation timed out/);
      assert.match(error.cleanupError.message, /cleanup timed out/);
      assert.equal(
        error.nativeWindowViewport.preparation.cleanup.status,
        'failed',
      );
      assert.equal(error.nativeWindowViewport.preparation.attempts.length, 1);
      return true;
    },
  );
  assert.equal(blocked.state.detached, 1);
});

test('post-navigation drift remains single-shot without preparation waits or retries', async () => {
  const h = ownerHarness(),
    controller = new AbortController();
  h.options.preparationSignal = controller.signal;
  const owner = await createNativeWindowViewportOwner(h.options);
  controller.abort(new Error('finished preparation is no longer subscribed'));
  h.state.evidence = fixture();
  await owner.capture('startup');
  const waits = h.state.waits,
    snapshots = h.state.layoutReads;
  h.state.onLayout = (layout) => staleLayout(layout);
  await assert.rejects(owner.capture('post-navigation'), /1280/);
  assert.equal(h.state.layoutReads, snapshots + 1);
  assert.equal(h.state.waits, waits);
  assert.equal(owner.preparation.attempts.length, 2);
  assert.equal(owner.preparation.status, 'passed');
  await owner.dispose();
});

test('owned preparation maximizes once, clears emulation, then only reads checkpoints', async () => {
  const { state, options } = ownerHarness();
  const owner = await createNativeWindowViewportOwner(options);
  assert.equal(owner.nativeDpr, 2);
  assert.equal(owner.configured.page.nativeResolution, null);
  assert.equal(owner.preparation.status, 'passed');
  assert.equal(owner.preparation.attempts.length, 2);
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
  assert.equal(restored.ordinal, 4);
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
  options.settleAttempts = 3;
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
  const controller = new AbortController();
  const result = await readOwnedWindowsNativeWindowGeometry(1122, {
    platform: 'win32',
    signal: controller.signal,
    run: async (executable, args, options) => {
      calls++;
      assert.equal(executable, 'powershell.exe');
      assert.equal(options.timeout, 5000);
      assert.equal(options.windowsHide, true);
      assert.equal(options.signal, controller.signal);
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
