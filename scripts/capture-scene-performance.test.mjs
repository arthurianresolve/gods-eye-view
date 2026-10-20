import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Linter } from 'eslint';
import { MAP_STREAMING_WORKLOAD_ID } from './performance/mapStreamingWorkloadContract.mjs';
import { MAP_FIXTURE_BUILD_PROFILE_ID } from './performance/buildProvenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'capture-scene-performance.mjs');

async function extractRawSampleCallback() {
  const source = await fs.readFile(SCRIPT, 'utf8');
  let callbackSource = null;
  const callbackArrays = new Map();
  const linter = new Linter({ configType: 'flat' });
  const rule = {
    create(context) {
      return {
        VariableDeclarator(node) {
          if (
            node.id?.type === 'Identifier' &&
            node.id.name === 'sampleArguments' &&
            node.init?.type === 'ArrayExpression'
          ) {
            callbackArrays.set(node.id.name, node.init);
          }
        },
        CallExpression(node) {
          if (
            callbackSource ||
            node.callee?.type !== 'MemberExpression' ||
            node.callee.object?.name !== 'page' ||
            node.callee.property?.name !== 'evaluate'
          )
            return;
          const argument = node.arguments[0];
          const candidate =
            argument?.type === 'SpreadElement' &&
            argument.argument?.type === 'Identifier'
              ? callbackArrays.get(argument.argument.name)?.elements?.[0]
              : argument;
          if (
            candidate?.type !== 'ArrowFunctionExpression' ||
            !candidate.async ||
            !context.sourceCode
              .getText(candidate)
              .includes('frameTraceEnabled') ||
            !context.sourceCode
              .getText(candidate)
              .includes('renderDemandOwnership')
          )
            return;
          callbackSource = context.sourceCode.getText(candidate);
        },
      };
    },
  };
  const messages = linter.verify(
    source,
    [
      {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: { capture: { rules: { callback: rule } } },
        rules: { 'capture/callback': 'error' },
      },
    ],
    { filename: SCRIPT },
  );
  assert.deepEqual(messages, []);
  assert.ok(callbackSource, 'raw sample page callback was not found');
  assert.match(
    source,
    /const sampleArguments\s*=\s*\[[\s\S]*?page\.evaluate\(\.\.\.sampleArguments\)/,
    'raw sample callback must execute through the sample argument array',
  );
  return callbackSource;
}

function createRawSampleHarness({
  throwOnRender = false,
  framesPerRender = 1,
  globeTilesLoaded = false,
  tileProgressAvailable = false,
  throwOnTileProgressRemove = false,
  tileAddReturnsNoRemove = false,
  tileRemoveReturnsFalse = false,
  resourceEntries = null,
  resourceObserverAvailable = false,
  resourceObserverObserveThrows = false,
  resourceObserverTakeRecordsThrows = false,
  resourceObserverDisconnectThrows = false,
} = {}) {
  let clock = 1000;
  let manualStarted = false;
  let currentDistance = 0;
  let warmupFrames = 0;
  const renderedPhases = [];
  const makeEvent = () => {
    const listeners = new Set();
    let additions = 0;
    return {
      addEventListener(listener) {
        additions += 1;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      removeEventListener(listener) {
        listeners.delete(listener);
      },
      emit(...args) {
        for (const listener of [...listeners]) listener(...args);
      },
      get size() {
        return listeners.size;
      },
      get additions() {
        return additions;
      },
    };
  };
  const preRender = makeEvent();
  const postRender = makeEvent();
  const tileLoadProgressEvent = tileProgressAvailable ? makeEvent() : null;
  const resourceObservers = [];
  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.observedType = null;
      this.disconnected = false;
      resourceObservers.push(this);
    }
    observe(options) {
      this.observedType = options.type;
      if (options.type === 'resource' && resourceObserverObserveThrows)
        throw new Error('fake resource observer setup failure');
      if (options.type === 'resource' && Array.isArray(resourceEntries))
        this.callback({ getEntries: () => resourceEntries });
    }
    takeRecords() {
      if (this.observedType === 'resource' && resourceObserverTakeRecordsThrows)
        throw new Error('fake resource observer drain failure');
      return [];
    }
    disconnect() {
      this.disconnected = true;
      if (this.observedType === 'resource' && resourceObserverDisconnectThrows)
        throw new Error('fake resource observer cleanup failure');
    }
  }
  const makeTileProgressEvent = () => {
    if (!tileLoadProgressEvent) return null;
    return {
      addEventListener(listener) {
        tileLoadProgressEvent.addEventListener(listener);
        if (tileAddReturnsNoRemove) return undefined;
        return () => {
          if (throwOnTileProgressRemove)
            throw new Error('fake tile progress cleanup failure');
          tileLoadProgressEvent.removeEventListener(listener);
        };
      },
      removeEventListener(listener) {
        if (tileRemoveReturnsFalse) return false;
        tileLoadProgressEvent.removeEventListener(listener);
        return true;
      },
    };
  };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const camera = {
    setView() {},
    moveRight(distance) {
      currentDistance = distance;
      clock += 3;
    },
  };
  const scene = {
    preRender,
    postRender,
    globe:
      globeTilesLoaded === null
        ? null
        : {
            tilesLoaded: globeTilesLoaded,
            ...(tileProgressAvailable
              ? { tileLoadProgressEvent: makeTileProgressEvent() }
              : {}),
          },
    requestRenderMode: true,
    requestRender() {},
  };
  const viewer = {
    scene,
    camera,
    useDefaultRenderLoop: true,
    render() {
      manualStarted = true;
      if (throwOnRender) throw new Error('fake render failure');
      for (let index = 0; index < framesPerRender; index++) {
        renderedPhases.push((currentDistance * 50) / 16);
        preRender.emit();
        clock += 7;
        postRender.emit();
      }
    },
  };
  const windowRef = {
    location: {
      href: 'http://localhost:4173/',
      origin: 'http://localhost:4173',
    },
    __godsEyeView: {
      viewer,
      getRenderGovernorDiagnostics: () => ({
        mode: 'continuous',
        holds: ['diagnostic'],
        scheduledUpdates: [],
        recentRequests: Array.from({ length: 18 }, (_, index) => ({
          reason: `request-${index}`,
          at: 1_000_000 + index,
        })),
      }),
    },
    __gevPerformanceHome: {
      position: {},
      direction: {},
      up: {},
      transform: {},
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  const documentRef = {
    hidden: false,
    hasFocus: () => true,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener)
        documentListeners.delete(type);
    },
  };
  const context = {
    window: windowRef,
    document: documentRef,
    performance: { now: () => clock, timeOrigin: 1_000_000 },
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback) =>
      setTimeout(() => {
        clock += 16;
        // Two already-queued default-loop frames may complete while ownership
        // is being quiesced. They must not enter the measured trace.
        if (!manualStarted) {
          preRender.emit();
          clock += 7;
          postRender.emit();
          warmupFrames += 1;
        }
        callback(clock);
      }, 0),
    cancelAnimationFrame: clearTimeout,
    PerformanceObserver: resourceObserverAvailable
      ? FakePerformanceObserver
      : undefined,
  };
  return {
    context,
    scene,
    preRender,
    postRender,
    tileLoadProgressEvent,
    resourceObservers,
    windowListeners,
    documentListeners,
    renderedPhases,
    get warmupFrames() {
      return warmupFrames;
    },
  };
}

function runRawSample(callbackSource, harness, parameters) {
  const callback = vm.runInNewContext(`(${callbackSource})`, harness.context);
  return callback(parameters).then((result) => {
    if (result?.__gevSceneMeasurementFailure) {
      throw Object.assign(
        new Error(result.__gevSceneMeasurementFailure.message),
        {
          name: result.__gevSceneMeasurementFailure.name,
          cableIdleEventTrace: result.cableIdleEventTrace,
        },
      );
    }
    return result;
  });
}

test('raw map frame samples use the bounded fixture speed without altering other routes', async () => {
  const callback = await extractRawSampleCallback();
  for (const speed of [120, 320]) {
    const sample = await runRawSample(callback, createRawSampleHarness(), {
      durationMs: 35,
      scenarioName: 'scripted-motion',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: false,
      motionMetersPerSecond: speed,
    });
    assert.equal(sample.cameraPath.motionDistanceM, (35 * speed) / 1000);
    assert.equal(sample.renderDemandOwnership.restored, true);
  }
});

test('raw sample tracing resets pre-window frames and records applied route phase', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness();
  const sample = await runRawSample(callback, harness, {
    durationMs: 35,
    scenarioName: 'scripted-motion',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
  });
  assert.ok(sample.frameTrace.length > 0);
  assert.equal(harness.warmupFrames, 2);
  assert.equal(sample.frameTrace.length, harness.renderedPhases.length);
  assert.equal(sample.frameTrace[0].routePhaseMs, 0);
  assert.equal(sample.frameTrace[0].sceneRenderWallMs, 7);
  assert.ok(
    sample.frameTrace.every((frame) => frame.globeTilesLoaded === false),
  );
  assert.ok(sample.frameTrace.every((frame) => frame.routePhaseMs !== null));
  assert.deepEqual(
    JSON.parse(JSON.stringify(sample.frameTrace[0].governor.recentRequests)),
    [
      ...Array.from({ length: 16 }, (_, index) => ({
        reason: `request-${index + 2}`,
        atWallClockMs: 1_000_002 + index,
      })),
    ],
  );
  assert.equal(sample.frameTrace[0].governor.recentRequestsDroppedCount, 2);
  assert.ok(
    sample.frameTrace.every(
      (frame) =>
        Number.isFinite(frame.manualFrameCallbackStartedAtMs) &&
        Number.isFinite(frame.cameraUpdateFinishedAtMs) &&
        Number.isFinite(frame.viewerRenderStartedAtMs) &&
        Number.isFinite(frame.viewerRenderReturnedAtMs) &&
        frame.manualFrameCallbackStartedAtMs <=
          frame.cameraUpdateFinishedAtMs &&
        frame.cameraUpdateFinishedAtMs - frame.manualFrameCallbackStartedAtMs >=
          3 &&
        frame.cameraUpdateFinishedAtMs <= frame.viewerRenderStartedAtMs &&
        frame.viewerRenderStartedAtMs <= frame.viewerRenderReturnedAtMs,
    ),
  );
  for (let index = 0; index < sample.frameTrace.length; index++) {
    const frame = sample.frameTrace[index];
    assert.ok(
      Math.abs(frame.routePhaseMs - harness.renderedPhases[index]) < 1e-9,
    );
    assert.ok(
      frame.preRenderAtMs >= sample.frameTraceWindow.startPerformanceNowMs,
    );
  }
  assert.equal(harness.preRender.size, 0);
  assert.equal(harness.postRender.size, 0);
  assert.ok(Number.isFinite(sample.frameTrace.at(-1).viewerRenderReturnedAtMs));
  assert.equal(sample.frameTrace.at(-1).routePhaseMs, 35);
});

test('raw sample tracing disabled adds no pre-render listener or trace data', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness();
  const sample = await runRawSample(callback, harness, {
    durationMs: 10,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: false,
  });
  assert.equal('frameTrace' in sample, false);
  assert.equal('longTaskTrace' in sample, false);
  assert.equal('cableIdleEventTrace' in sample, false);
  assert.equal(
    sample.frameTrace,
    undefined,
    'disabled tracing must not add manual timing fields',
  );
  assert.equal(harness.preRender.additions, 0);
  assert.equal(harness.preRender.size, 0);
  assert.equal(harness.postRender.size, 0);
});

test('idle trace records explicit null manual-pump timing fields', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness();
  const originalSetTimeout = harness.context.setTimeout;
  harness.context.setTimeout = (handler, delay, ...args) =>
    originalSetTimeout(() => {
      if (delay === 10) {
        harness.preRender.emit();
        harness.context.performance.now();
        harness.postRender.emit();
      }
      handler(...args);
    }, delay);
  const sample = await runRawSample(callback, harness, {
    durationMs: 10,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
  });
  assert.ok(sample.frameTrace.length > 0);
  for (const frame of sample.frameTrace) {
    assert.equal(frame.manualFrameCallbackStartedAtMs, null);
    assert.equal(frame.cameraUpdateFinishedAtMs, null);
    assert.equal(frame.viewerRenderStartedAtMs, null);
    assert.equal(frame.viewerRenderReturnedAtMs, null);
  }

  const unavailable = await runRawSample(
    callback,
    createRawSampleHarness({ globeTilesLoaded: null }),
    {
      durationMs: 35,
      scenarioName: 'scripted-motion',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: true,
    },
  );
  assert.ok(unavailable.frameTrace.length > 0);
  assert.ok(
    unavailable.frameTrace.every((frame) => frame.globeTilesLoaded === null),
  );
});

test('raw sample trace caps frames and reports truncation without losing observed counts', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({ framesPerRender: 4100 });
  const sample = await runRawSample(callback, harness, {
    durationMs: 1,
    scenarioName: 'scripted-motion',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
  });
  assert.equal(sample.frameTrace.length, 4096);
  assert.equal(sample.frameTraceWindow.recordedFrames, 4096);
  assert.ok(sample.frameTraceWindow.observedFrames >= 4100);
  assert.equal(sample.frameTraceWindow.truncated, true);
  assert.ok(
    sample.frameTrace.every((frame) =>
      Number.isFinite(frame.viewerRenderStartedAtMs),
    ),
  );
  assert.ok(Number.isFinite(sample.frameTrace.at(-1).viewerRenderReturnedAtMs));
  assert.equal(harness.preRender.size, 0);
  assert.equal(harness.postRender.size, 0);
});

test('raw sample cleanup removes listeners when rendering throws', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({ throwOnRender: true });
  await assert.rejects(
    runRawSample(callback, harness, {
      durationMs: 10,
      scenarioName: 'scripted-motion',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: true,
    }),
    /fake render failure/,
  );
  assert.equal(harness.preRender.size, 0);
  assert.equal(harness.postRender.size, 0);
  assert.equal(harness.windowListeners.size, 0);
  assert.equal(harness.documentListeners.size, 0);
});

test('cable idle event trace correlates URL-free provider entries and tile progress', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({
    globeTilesLoaded: false,
    tileProgressAvailable: true,
    resourceObserverAvailable: true,
    resourceEntries: [
      {
        name: 'https://services.arcgisonline.com/secret/path?token=do-not-retain',
        startTime: 1000,
        responseEnd: 1000,
        duration: 0,
      },
      {
        name: 'https://terrain.reearth.land/private?key=do-not-retain',
        startTime: 990,
        responseEnd: 1000,
        duration: 10,
      },
      {
        name: 'https://unrecognized.example/private?token=do-not-retain',
        startTime: 1000,
        responseEnd: 1000,
        duration: 0,
      },
      {
        name: 'http://localhost:4173/static/app.js?secret=ignored',
        startTime: 1000,
        responseEnd: 1000,
        duration: 0,
      },
    ],
  });
  const originalSetTimeout = harness.context.setTimeout;
  harness.context.setTimeout = (handler, delay, ...args) =>
    originalSetTimeout(() => {
      if (delay === 10) {
        harness.tileLoadProgressEvent.emit(7);
        harness.tileLoadProgressEvent.emit(0);
      }
      handler(...args);
    }, delay);
  const sample = await runRawSample(callback, harness, {
    durationMs: 10,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
    cableIdleEventTraceEnabled: true,
  });
  const trace = sample.cableIdleEventTrace;
  assert.equal(trace.schema, 'gev-cable-idle-provider-events/v1');
  assert.equal(trace.status, 'observed');
  assert.equal(trace.tileProgress.status, 'observed');
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        trace.tileProgress.events.map((event) => event.queuedTileCount),
      ),
    ),
    [7, 0],
  );
  assert.deepEqual(trace.tileProgress.initialTilesLoaded, false);
  assert.equal(trace.providerRequests.status, 'observed');
  assert.equal(trace.providerRequests.providers.esriImagery.started, 1);
  assert.equal(trace.providerRequests.providers.esriImagery.ended, 1);
  assert.equal(trace.providerRequests.providers.reearthTerrain.ended, 1);
  assert.equal(trace.providerRequests.providers.otherExternal.ended, 1);
  assert.equal(
    trace.providerRequests.events.some(
      (event) => event.provider === 'sameOrigin',
    ),
    false,
  );
  assert.equal(trace.cleanup.confirmed, true);
  assert.equal(trace.tileProgress.cleanup.confirmed, true);
  assert.equal(trace.providerRequests.cleanup.confirmed, true);
  const serialized = JSON.stringify(trace);
  assert.doesNotMatch(
    serialized,
    /services\.arcgisonline|terrain\.reearth|unrecognized\.example/,
  );
  assert.doesNotMatch(serialized, /secret|token=|private|do-not-retain/);
  assert.ok(
    harness.resourceObservers.every((observer) => observer.disconnected),
  );
  assert.equal(harness.tileLoadProgressEvent.size, 0);
});

test('cable idle event traces bound tile and resource entries while preserving omitted counts', async () => {
  const callback = await extractRawSampleCallback();
  const resourceEntries = Array.from({ length: 520 }, (_, index) => ({
    name: `https://services.arcgisonline.com/tile/${index}?private=1`,
    startTime: 1000,
    responseEnd: 1000,
    duration: 0,
  }));
  const harness = createRawSampleHarness({
    tileProgressAvailable: true,
    resourceObserverAvailable: true,
    resourceEntries,
  });
  const originalSetTimeout = harness.context.setTimeout;
  harness.context.setTimeout = (handler, delay, ...args) =>
    originalSetTimeout(() => {
      if (delay === 10)
        for (let index = 0; index < 300; index++)
          harness.tileLoadProgressEvent.emit(index);
      handler(...args);
    }, delay);
  const sample = await runRawSample(callback, harness, {
    durationMs: 10,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
    cableIdleEventTraceEnabled: true,
  });
  const trace = sample.cableIdleEventTrace;
  assert.equal(trace.tileProgress.eventsObserved, 300);
  assert.equal(trace.tileProgress.events.length, 256);
  assert.equal(trace.tileProgress.eventsOmitted, 44);
  assert.equal(trace.providerRequests.eventsObserved, 520);
  assert.equal(trace.providerRequests.events.length, 512);
  assert.equal(trace.providerRequests.eventsOmitted, 8);
  assert.equal(trace.providerRequests.providers.esriImagery.started, 520);
  assert.doesNotMatch(JSON.stringify(trace), /arcgisonline|private=1/);
});

test('cable idle event trace distinguishes absent APIs and observer setup failures', async () => {
  const callback = await extractRawSampleCallback();
  const absent = await runRawSample(
    callback,
    createRawSampleHarness({ globeTilesLoaded: null }),
    {
      durationMs: 1,
      scenarioName: 'idle',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: true,
      cableIdleEventTraceEnabled: true,
    },
  );
  assert.equal(absent.cableIdleEventTrace.tileProgress.status, 'unavailable');
  assert.equal(
    absent.cableIdleEventTrace.providerRequests.status,
    'unavailable',
  );
  assert.equal(absent.cableIdleEventTrace.status, 'partial');
  assert.equal(absent.cableIdleEventTrace.cleanup.confirmed, true);

  const setupFailureHarness = createRawSampleHarness({
    tileProgressAvailable: true,
    resourceObserverAvailable: true,
    resourceObserverObserveThrows: true,
  });
  const setupFailure = await runRawSample(callback, setupFailureHarness, {
    durationMs: 1,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
    cableIdleEventTraceEnabled: true,
  });
  assert.equal(
    setupFailure.cableIdleEventTrace.providerRequests.status,
    'observe-failed',
  );
  assert.equal(
    setupFailure.cableIdleEventTrace.providerRequests.observerErrors,
    1,
  );
  assert.equal(setupFailure.cableIdleEventTrace.status, 'partial');
  assert.equal(setupFailure.cableIdleEventTrace.cleanup.confirmed, true);
  assert.equal(setupFailureHarness.tileLoadProgressEvent.size, 0);
});

test('cable idle trace keeps partial diagnostics when resource drain fails but disconnects', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({
    tileProgressAvailable: true,
    resourceObserverAvailable: true,
    resourceObserverTakeRecordsThrows: true,
    resourceEntries: [],
  });
  const sample = await runRawSample(callback, harness, {
    durationMs: 1,
    scenarioName: 'idle',
    delay: 0,
    recordFrameWindow: false,
    expectedRunOrdinal: 1,
    frameTraceEnabled: true,
    cableIdleEventTraceEnabled: true,
  });
  const trace = sample.cableIdleEventTrace;
  assert.equal(trace.providerRequests.status, 'observer-error');
  assert.equal(trace.providerRequests.observerErrors, 1);
  assert.equal(trace.providerRequests.cleanup.attempted, true);
  assert.equal(trace.providerRequests.cleanup.confirmed, true);
  assert.equal(trace.cleanup.confirmed, true);
  assert.equal(trace.status, 'partial');
  assert.ok(harness.resourceObservers[0].disconnected);
});

test('cable idle event trace fails the sample if observer cleanup cannot be confirmed', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({
    tileProgressAvailable: true,
    throwOnTileProgressRemove: true,
    resourceObserverAvailable: true,
    resourceObserverDisconnectThrows: true,
    resourceEntries: [],
  });
  const originalSetTimeout = harness.context.setTimeout;
  harness.context.setTimeout = (handler, delay, ...args) =>
    originalSetTimeout(() => {
      if (delay === 1) harness.tileLoadProgressEvent.emit(3);
      handler(...args);
    }, delay);
  await assert.rejects(
    runRawSample(callback, harness, {
      durationMs: 1,
      scenarioName: 'idle',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: true,
      cableIdleEventTraceEnabled: true,
    }),
    (error) => {
      assert.match(error.message, /observer cleanup was not confirmed/);
      assert.equal(error.cableIdleEventTrace.status, 'cleanup-failed');
      assert.equal(error.cableIdleEventTrace.cleanup.attempted, true);
      assert.equal(error.cableIdleEventTrace.cleanup.confirmed, false);
      assert.equal(error.cableIdleEventTrace.tileProgress.eventsObserved, 1);
      assert.equal(
        error.cableIdleEventTrace.tileProgress.events[0].queuedTileCount,
        3,
      );
      return true;
    },
  );
  assert.ok(
    harness.resourceObservers.some((observer) => observer.disconnected),
  );
  assert.equal(harness.tileLoadProgressEvent.size, 1);
});

test('cable idle trace rejects an unconfirmed fallback tile-listener removal', async () => {
  const callback = await extractRawSampleCallback();
  const harness = createRawSampleHarness({
    tileProgressAvailable: true,
    tileAddReturnsNoRemove: true,
    tileRemoveReturnsFalse: true,
    resourceObserverAvailable: true,
    resourceEntries: [],
  });
  await assert.rejects(
    runRawSample(callback, harness, {
      durationMs: 1,
      scenarioName: 'idle',
      delay: 0,
      recordFrameWindow: false,
      expectedRunOrdinal: 1,
      frameTraceEnabled: true,
      cableIdleEventTraceEnabled: true,
    }),
    (error) => {
      assert.match(error.message, /cleanup was not confirmed/);
      assert.equal(
        error.cableIdleEventTrace.tileProgress.cleanup.attempted,
        true,
      );
      assert.equal(
        error.cableIdleEventTrace.tileProgress.cleanup.confirmed,
        false,
      );
      assert.equal(error.cableIdleEventTrace.cleanup.confirmed, false);
      assert.equal(error.cableIdleEventTrace.status, 'cleanup-failed');
      return true;
    },
  );
  assert.equal(harness.tileLoadProgressEvent.size, 1);
  assert.equal(harness.resourceObservers[0].disconnected, true);
});

test('startup and main documents are foregrounded before viewer readiness', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  assert.equal(
    source.match(/focusOwnedWindowsBrowserWindow\(/g)?.length,
    1,
    'owned Windows browser activation has one shared call site',
  );
  assert.doesNotMatch(
    source,
    /hostWindowActivation\s*\?\?=/,
    'every foreground boundary must reactivate the owned OS window',
  );
  const startupNavigation = source.indexOf('await startupPage.goto(');
  const startupActivation = source.indexOf(
    'await activateCapturePage(startupPage)',
    startupNavigation,
  );
  const startupReadiness = source.indexOf(
    'await startupPage.waitForFunction(() => !!window.__godsEyeView?.viewer',
    startupNavigation,
  );
  assert.ok(
    startupNavigation >= 0 &&
      startupActivation > startupNavigation &&
      startupReadiness > startupActivation,
  );

  const mainNavigation = source.indexOf(
    'await page.goto(url,',
    startupReadiness,
  );
  const mainActivation = source.indexOf(
    'await activateCapturePage(page)',
    mainNavigation,
  );
  const mainReadiness = source.indexOf(
    'await page.waitForFunction(() => !!window.__godsEyeView?.viewer',
    mainNavigation,
  );
  assert.ok(
    mainNavigation >= 0 &&
      mainActivation > mainNavigation &&
      mainReadiness > mainActivation,
  );
  const sessionStart = source.indexOf(
    'await foregroundActivationSession.start({ timeoutMs: 15_000 })',
  );
  const startupLoop = source.indexOf(
    "failureProgress.phase = 'startup-navigation'",
  );
  assert.ok(sessionStart >= 0 && sessionStart < startupLoop);
  assert.ok(
    source.indexOf('await foregroundActivationSession?.dispose();') >= 0,
    'persistent foreground helper is disposed during capture cleanup',
  );
});

test('timed samples reacquire foreground after warmup and before measurement', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const warmupBoundary = source.indexOf(
    'failureProgress.current.warmupBoundary = fixtureBoundaryStart;',
  );
  const measurementActivation = source.indexOf(
    'failureProgress.current.measurementForegroundActivation =',
    warmupBoundary,
  );
  const measurementObservation = source.indexOf(
    'const fixtureMeasurementStart =',
    measurementActivation,
  );
  const rawMeasurement = source.indexOf(
    'rawSamplePromise = Promise.resolve().then(() =>',
    measurementObservation,
  );
  assert.ok(
    warmupBoundary >= 0 &&
      measurementActivation > warmupBoundary &&
      measurementObservation > measurementActivation &&
      rawMeasurement > measurementObservation,
  );
  assert.match(
    source.slice(measurementActivation, measurementObservation),
    /await activateCapturePage\(page\)/,
  );
});

test('scripted motion completion does not wait for another animation frame', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const measurementWait = source.indexOf('await measurementWait;');
  const endpoint = source.indexOf('finishMotion();', measurementWait);
  const returnSample = source.indexOf('return {', endpoint);
  assert.ok(measurementWait >= 0 && endpoint > measurementWait);
  const completion = source.slice(measurementWait, returnSample);
  assert.match(completion, /cancelAnimationFrame\(motionFrameRequest\)/);
  assert.doesNotMatch(completion, /await motionFinished/);
});

test('moving samples own a bounded Viewer render pump and restore the default loop', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const ownership = source.indexOf('const renderDemandOwnership = {');
  const applyDistance = source.indexOf('const applyDistance = (distance) => {');
  const finishMotion = source.indexOf('finishMotion =', applyDistance);
  const returnedSample = source.indexOf('return {', finishMotion);
  const finallyBlock = source.indexOf('} finally {', returnedSample);
  assert.ok(
    ownership >= 0 &&
      applyDistance > ownership &&
      finishMotion > applyDistance &&
      returnedSample > finishMotion &&
      finallyBlock > returnedSample,
  );
  const acquisition = source.slice(ownership, applyDistance);
  assert.match(acquisition, /scenarioName !== 'idle'/);
  assert.match(acquisition, /viewer\.useDefaultRenderLoop = false;/);
  assert.match(
    acquisition,
    /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/,
  );
  assert.match(acquisition, /renderDemandOwnership\.manualFramePump = true;/);
  const poseUpdate = source.slice(applyDistance, finishMotion);
  assert.match(poseUpdate, /viewer\.camera\.moveRight\(distance\);/);
  const motionPump = source.slice(finishMotion, returnedSample);
  assert.match(motionPump, /if \(!frameTrace\)[\s\S]*updateMotion\(elapsed\);/);
  assert.match(motionPump, /viewer\.render\(\);/);
  const completion = source.slice(finishMotion, finallyBlock);
  assert.match(completion, /if \(renderDemandOwnership\.requested\) \{/);
  assert.match(completion, /restoreMeasurementRenderDemand\(\);/);
  assert.match(completion, /renderDemandOwnership,/);
  const cleanup = source.slice(
    finallyBlock,
    source.indexOf('},\n        {', finallyBlock),
  );
  assert.match(cleanup, /restoreMeasurementRenderDemand\(\);/);
});

test('fresh dense provider documents synchronize engine and visual density', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const freshDocumentStart = source.indexOf(
    'async function prepareFreshProviderDocument()',
  );
  const sampleLoopStart = source.indexOf(
    'for (const scenario of scenarios)',
    freshDocumentStart,
  );
  assert.ok(freshDocumentStart >= 0 && sampleLoopStart > freshDocumentStart);
  const freshDocumentSource = source.slice(freshDocumentStart, sampleLoopStart);
  assert.match(
    freshDocumentSource,
    /app\.styleManager\.setDetection\(\{[\s\S]*?mode: requestedDetectionMode,[\s\S]*?densityPct: requestedDensity/,
  );
  assert.match(freshDocumentSource, /densityPct: expectedDensityPct/);
  assert.match(
    freshDocumentSource,
    /visualDetection\?\.density !== requestedDensity/,
  );
});

test('timed workload setup synchronizes engine, controls, and visual density', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const sections = [
    [
      'Austin',
      source.slice(
        source.indexOf('async function configureAustinOperatingPage('),
        source.indexOf('async function readAustinOperatingObservation('),
      ),
    ],
    [
      'infrastructure',
      source.slice(
        source.indexOf(
          "failureProgress.phase = 'configure-infrastructure-fixture'",
        ),
        source.indexOf(
          "failureProgress.phase = 'configure-austin-operating-fixture'",
        ),
      ),
    ],
    [
      'weather/effects',
      source.slice(
        source.indexOf(
          "failureProgress.phase = 'configure-weather-effects-fixture'",
        ),
        source.indexOf('let startupProbe = null;'),
      ),
    ],
    [
      'shared map/baseline',
      source.slice(
        source.indexOf('if (!fixture) {'),
        source.indexOf('const commonScene = await page.evaluate('),
      ),
    ],
  ];
  for (const [label, section] of sections) {
    assert.match(
      section,
      /styleManager\.setDetection\(\{[\s\S]*?densityPct/,
      `${label} setup must use the public atomic detection setter`,
    );
    assert.match(
      section,
      /getDetectionTuning\(\)\?\.densityPct/,
      `${label} setup must verify the engine density`,
    );
    assert.match(
      section,
      /visualDetection\?\.density/,
      `${label} setup must verify the rendered visual density`,
    );
  }
});

test('controlled manual fixtures retain their requested legacy density', async () => {
  const source = await fs.readFile(SCRIPT, 'utf8');
  const synchronizations = source.match(
    /if \(mode === 'manual'\)\s+controller\?\.rememberManualDensity\?\.\(/g,
  );
  assert.equal(synchronizations?.length, 5);
});

function invoke(args, { loaderPath = null } = {}) {
  return spawnSync(
    process.execPath,
    [
      ...(loaderPath
        ? ['--experimental-loader', pathToFileURL(loaderPath).href]
        : []),
      SCRIPT,
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // This file is also run beside the browser-heavy performance harness.
      // Process creation can be delayed by that shared load even though the
      // provenance rejection itself happens before Cesium/browser startup.
      // Keep the test bounded, but do not turn host contention into a false
      // CLI failure at the old 15-second child-process timeout.
      timeout: 60_000,
      windowsHide: true,
    },
  );
}

async function withForbiddenCesiumLoader(run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gev-capture-no-cesium-'),
  );
  const loaderPath = path.join(directory, 'forbid-cesium-loader.mjs');
  await fs.writeFile(
    loaderPath,
    `export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'cesium') throw new Error('forbidden Cesium import witness');
      return nextResolve(specifier, context);
    }\n`,
  );
  try {
    return await run(loaderPath, directory);
  } finally {
    const resolvedDirectory = path.resolve(directory);
    assert.ok(
      resolvedDirectory.startsWith(path.resolve(os.tmpdir()) + path.sep),
      'temporary loader directory must remain inside the OS temp directory',
    );
    await fs.rm(resolvedDirectory, { recursive: true, force: true });
  }
}

function verifiedFixtureArgs() {
  return [
    '--build-receipt',
    path.join(ROOT, 'package.json'),
    '--app-checkout',
    ROOT,
    '--harness-checkout',
    ROOT,
    '--build-root',
    ROOT,
    '--expected-app-sha',
    'a'.repeat(40),
    '--expected-harness-sha',
    'b'.repeat(40),
    '--served-base-url',
    'http://127.0.0.1:4173',
  ];
}

test('capture CLI recognizes an infrastructure workload before browser startup', () => {
  const result = invoke([
    '--provider-fixture',
    'infrastructure-datacenters',
    '--provider-fixture-time',
    '2026-10-08T12:00:00.000Z',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Comparison fixtures require verified build provenance/,
  );
  assert.doesNotMatch(result.stderr, /Unsupported infrastructure workload/);
  assert.doesNotMatch(
    result.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('cable idle event trace CLI is limited to a standard ineligible trace capture', () => {
  const missingFrameTrace = invoke(['--cable-idle-event-trace']);
  assert.notEqual(missingFrameTrace.status, 0);
  assert.match(missingFrameTrace.stderr, /requires --frame-trace-out/);

  const wrongWindow = invoke([
    '--cable-idle-event-trace',
    '--frame-trace-out',
    path.join(os.tmpdir(), 'cable-idle-trace.json'),
    '--provider-fixture',
    'infrastructure-cables',
    '--hardware-required',
    '--runs',
    '1',
    '--startup-runs',
    '5',
    '--warmup-ms',
    '0',
    '--seconds',
    '60',
  ]);
  assert.notEqual(wrongWindow.status, 0);
  assert.match(wrongWindow.stderr, /requires one headed native-sharpness/);

  const standardWindow = invoke([
    '--cable-idle-event-trace',
    '--frame-trace-out',
    path.join(os.tmpdir(), 'cable-idle-trace.json'),
    '--provider-fixture',
    'infrastructure-cables',
    '--hardware-required',
    '--runs',
    '1',
    '--startup-runs',
    '5',
    '--warmup-ms',
    '30000',
    '--seconds',
    '60',
  ]);
  assert.notEqual(standardWindow.status, 0);
  assert.match(
    standardWindow.stderr,
    /Comparison fixtures require verified build provenance options/,
  );
  assert.doesNotMatch(
    standardWindow.stderr,
    /Could not find Chrome|Browser was not found/,
  );
});

test('startup provider-response diagnostic is explicit, startup-only and ineligible', async () => {
  const flagOnly = invoke(['--startup-provider-fixture-diagnostic']);
  assert.equal(flagOnly.status, 1, flagOnly.stderr);
  assert.match(
    flagOnly.stderr,
    /requires an infrastructure-dams --startup-only-shard with --startup-page-observed-v1/,
  );

  const missingPageMethod = invoke([
    '--startup-only-shard',
    '--startup-provider-fixture-diagnostic',
    '--provider-fixture',
    'infrastructure-dams',
  ]);
  assert.equal(missingPageMethod.status, 1, missingPageMethod.stderr);
  assert.match(missingPageMethod.stderr, /requires an infrastructure-dams/);

  const wrongFixture = invoke([
    '--startup-only-shard',
    '--startup-page-observed-v1',
    '--startup-provider-fixture-diagnostic',
    '--provider-fixture',
    'infrastructure-datacenters',
  ]);
  assert.equal(wrongFixture.status, 1, wrongFixture.stderr);
  assert.match(wrongFixture.stderr, /requires an infrastructure-dams/);

  const acceptedContractBeforeProvenance = invoke([
    '--startup-only-shard',
    '--startup-page-observed-v1',
    '--startup-provider-fixture-diagnostic',
    '--provider-fixture',
    'infrastructure-dams',
    '--startup-shard-id',
    'provider-diagnostic-control-01',
    '--startup-role',
    'control',
    '--hardware-required',
    '--out',
    path.join(os.tmpdir(), 'provider-diagnostic-contract-only.json'),
  ]);
  assert.equal(acceptedContractBeforeProvenance.status, 1);
  assert.match(
    acceptedContractBeforeProvenance.stderr,
    /--startup-only-shard requires verified, headed native hardware capture/,
  );
  assert.doesNotMatch(
    acceptedContractBeforeProvenance.stderr,
    /Browser was not found|Could not find Chrome/,
  );

  const source = await fs.readFile(SCRIPT, 'utf8');
  assert.match(source, /gev-startup-provider-fixture-diagnostic-shard\/v1/);
  assert.match(source, /acceptanceEligible:\s*false/);
  assert.match(source, /comparisonEligible:\s*false/);
  assert.match(source, /manifestSha256/);
  assert.match(source, /unmatchedExternal/);
});

test('receipt-only worker auditing is accepted for dense and infrastructure comparisons before provenance validation', () => {
  for (const args of [
    [
      '--provider-fixture',
      'dense-investigation',
      '--mixed-layers',
      '--worker-audit-mode',
      'receipt-only',
    ],
    [
      '--provider-fixture',
      'infrastructure-datacenters',
      '--worker-audit-mode',
      'receipt-only',
    ],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Comparison fixtures require verified build provenance options/,
    );
    assert.doesNotMatch(result.stderr, /Receipt-only worker auditing requires/);
    assert.doesNotMatch(
      result.stderr,
      /Browser was not found|Could not find Chrome/,
    );
  }
});

test('Austin comparison rejects subsecond fixture boundaries before browser startup', () => {
  const result = invoke([
    '--provider-fixture',
    'austin-operating-v1',
    '--warmup-ms',
    '30500',
    '--seconds',
    '60.5',
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /whole-second warmup and measurement durations/);
  assert.doesNotMatch(
    result.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('map workload requires its named build profile before loading Cesium infrastructure', async () => {
  await withForbiddenCesiumLoader(async (loaderPath) => {
    const missingProfile = invoke(
      ['--provider-fixture', MAP_STREAMING_WORKLOAD_ID],
      { loaderPath },
    );
    assert.equal(missingProfile.status, 1, missingProfile.stderr);
    assert.match(
      missingProfile.stderr,
      /requires --build-profile austin-map-streaming-v1/,
    );
    assert.doesNotMatch(
      missingProfile.stderr,
      /forbidden Cesium import witness/,
    );

    const missingReceipt = invoke(
      [
        '--provider-fixture',
        MAP_STREAMING_WORKLOAD_ID,
        '--build-profile',
        MAP_FIXTURE_BUILD_PROFILE_ID,
      ],
      { loaderPath },
    );
    assert.equal(missingReceipt.status, 1, missingReceipt.stderr);
    assert.match(missingReceipt.stderr, /requires a verified build receipt/);
    assert.doesNotMatch(
      missingReceipt.stderr,
      /forbidden Cesium import witness/,
    );
  });
});

test('capture CLI rejects unsupported infrastructure names and mixed populations', () => {
  const unsupported = invoke(['--provider-fixture', 'infrastructure-unknown']);
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported infrastructure workload/);

  const mixed = invoke([
    '--provider-fixture',
    'infrastructure-dams',
    '--mixed-layers',
  ]);
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /cannot use aircraft or --mixed-layers/);
});

test('invalid infrastructure CLI requests reject before importing Cesium', async () => {
  await withForbiddenCesiumLoader(async (loaderPath, directory) => {
    const unsupported = invoke(
      ['--provider-fixture', 'infrastructure-unknown'],
      { loaderPath },
    );
    assert.equal(unsupported.status, 1, unsupported.stderr);
    assert.match(
      unsupported.stderr,
      /Unsupported infrastructure workload: infrastructure-unknown/,
    );
    assert.doesNotMatch(unsupported.stderr, /forbidden Cesium import witness/);

    const missingProvenance = invoke(
      ['--provider-fixture', 'infrastructure-datacenters'],
      { loaderPath },
    );
    assert.equal(missingProvenance.status, 1, missingProvenance.stderr);
    assert.match(
      missingProvenance.stderr,
      /Comparison fixtures require verified build provenance options/,
    );
    assert.doesNotMatch(
      missingProvenance.stderr,
      /forbidden Cesium import witness/,
    );

    const partialProvenance = invoke(
      [
        '--provider-fixture',
        'infrastructure-datacenters',
        '--build-receipt',
        path.join(ROOT, 'package.json'),
      ],
      { loaderPath },
    );
    assert.equal(partialProvenance.status, 1, partialProvenance.stderr);
    assert.match(
      partialProvenance.stderr,
      /Verified capture requires .* together/,
    );
    assert.doesNotMatch(
      partialProvenance.stderr,
      /forbidden Cesium import witness/,
    );

    const malformedReceiptPath = path.join(directory, 'malformed-receipt.json');
    await fs.writeFile(malformedReceiptPath, '{ malformed receipt json');
    const invalidReceipt = invoke(
      [
        '--provider-fixture',
        'infrastructure-datacenters',
        '--build-receipt',
        malformedReceiptPath,
        '--app-checkout',
        ROOT,
        '--harness-checkout',
        ROOT,
        '--build-root',
        ROOT,
        '--expected-app-sha',
        'a'.repeat(40),
        '--expected-harness-sha',
        'b'.repeat(40),
        '--served-base-url',
        'http://127.0.0.1:4173',
      ],
      { loaderPath },
    );
    assert.equal(invalidReceipt.status, 1, invalidReceipt.stderr);
    assert.match(invalidReceipt.stderr, /SyntaxError/);
    assert.doesNotMatch(
      invalidReceipt.stderr,
      /forbidden Cesium import witness/,
    );

    const incompatiblePopulation = invoke(
      ['--provider-fixture', 'infrastructure-dams', '--mixed-layers'],
      { loaderPath },
    );
    assert.equal(
      incompatiblePopulation.status,
      1,
      incompatiblePopulation.stderr,
    );
    assert.match(
      incompatiblePopulation.stderr,
      /cannot use aircraft or --mixed-layers/,
    );
    assert.doesNotMatch(
      incompatiblePopulation.stderr,
      /forbidden Cesium import witness/,
    );
  });
});

test('an explicit build-profile flag without a value rejects before browser startup', async () => {
  await withForbiddenCesiumLoader(async (loaderPath) => {
    for (const args of [
      ['--build-profile'],
      ['--build-profile', '--headless'],
    ]) {
      const result = invoke(args, { loaderPath });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /--build-profile requires a value/);
      assert.doesNotMatch(result.stderr, /forbidden Cesium import witness/);
      assert.doesNotMatch(
        result.stderr,
        /Browser was not found|Could not find Chrome/,
      );
    }
  });
});

test('first-motion profiling rejects unsupported workload before browser startup', () => {
  const wrongFixture = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'infrastructure-datacenters',
    '--first-motion-cpu-profile',
    '--cpu-profile-artifact-directory',
    'unused-profile-output',
  ]);
  assert.notEqual(wrongFixture.status, 0);
  assert.match(
    wrongFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    wrongFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );

  const missingDirectory = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'dense-investigation',
    '--mixed-layers',
    '--first-motion-cpu-profile',
  ]);
  assert.notEqual(missingDirectory.status, 0);
  assert.match(
    missingDirectory.stderr,
    /requires --cpu-profile-artifact-directory/,
  );
  assert.doesNotMatch(
    missingDirectory.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('shader program attribution is opt-in only for the dense capture fixture', () => {
  const missingFixture = invoke([
    ...verifiedFixtureArgs(),
    '--shader-program-attribution',
  ]);
  assert.notEqual(missingFixture.status, 0);
  assert.match(
    missingFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    missingFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );

  const wrongFixture = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'infrastructure-datacenters',
    '--shader-program-attribution',
  ]);
  assert.notEqual(wrongFixture.status, 0);
  assert.match(
    wrongFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    wrongFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});
