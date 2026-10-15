import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundaryProgressRecorder,
  observeRenderBoundary,
} from './renderBoundaryObservation.mjs';
import {
  evaluateCompletedRenderDiagnostic,
  settleCompletedRenderDiagnostic,
} from './settleCompletedRenderDiagnostic.mjs';
import { observeTrackedEntityBoundary } from './trackingRoute.mjs';
import {
  holdProviderWarmupBoundary,
  installPhasedMonotonicWallClock,
} from './productionFlightFixture.mjs';
import { observeAustinInstallationsReadyForRenderBoundary } from './austinOperatingReadinessHistory.mjs';

class Event {
  handlers = new Set();
  addEventListener(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  removeEventListener(handler) {
    this.handlers.delete(handler);
  }
  fire() {
    for (const handler of [...this.handlers]) handler();
  }
}

function viewer({
  render = false,
  requestRender = true,
  renderLoop = undefined,
  refuseRetirement = false,
  throwOnRetirement = false,
  onRetirement = () => {},
} = {}) {
  const postRender = new Event();
  const scene = { postRender };
  if (requestRender) {
    scene.requestRender = () => {
      if (render) queueMicrotask(() => postRender.fire());
    };
  }
  const subject = { scene };
  if (renderLoop !== undefined) {
    let current = renderLoop;
    Object.defineProperty(subject, 'useDefaultRenderLoop', {
      get: () => current,
      set: (value) => {
        if (value === false) onRetirement();
        if (throwOnRetirement && value === false)
          throw new Error('render loop setter failed');
        if (!(refuseRetirement && value === false)) current = value;
      },
    });
  }
  return subject;
}

test('diagnostic render probe records request, postRender and owned cleanup', async () => {
  const subject = viewer({ render: true });
  const result = await settleCompletedRenderDiagnostic(subject, 100);
  assert.equal(result.status, 'settled');
  assert.equal(result.diagnostics.renderRequestAvailable, true);
  assert.equal(result.diagnostics.renderRequestStarted, true);
  assert.equal(result.diagnostics.renderRequestCompleted, true);
  assert.equal(result.diagnostics.postRenderObserved, true);
  assert.equal(result.diagnostics.cleanup.timerCleared, true);
  assert.equal(result.diagnostics.cleanup.listenerRemoved, true);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('page timer and missing render request stay explicit without relaxing settle', async () => {
  const subject = viewer({ requestRender: false });
  const result = await settleCompletedRenderDiagnostic(subject, 5);
  assert.equal(result.status, 'page-error');
  assert.equal(result.diagnostics.pageTimerFired, true);
  assert.equal(result.diagnostics.renderRequestAvailable, false);
  assert.equal(result.diagnostics.renderRequestStarted, false);
  assert.equal(result.diagnostics.renderRequestCompleted, false);
  assert.equal(result.diagnostics.postRenderObserved, false);
  assert.equal(result.diagnostics.postRenderElapsedMs, null);
  assert.equal(result.diagnostics.cleanup.listenerRemoved, true);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('render request exception is retained and listener is removed', async () => {
  const subject = viewer();
  subject.scene.requestRender = () => {
    throw new Error('requestRender failed');
  };
  const result = await settleCompletedRenderDiagnostic(subject, 100);
  assert.equal(result.status, 'page-error');
  assert.equal(result.error.message, 'requestRender failed');
  assert.equal(result.diagnostics.renderRequestStarted, true);
  assert.equal(result.diagnostics.renderRequestCompleted, false);
  assert.equal(result.diagnostics.cleanup.listenerRemoved, true);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('warmup boundary leaves viewer loop active and final boundary retires after postRender', async () => {
  const order = [];
  const subject = viewer({
    render: true,
    renderLoop: true,
    onRetirement: () => order.push('retired'),
  });
  const warmup = await settleCompletedRenderDiagnostic(subject, 100);
  assert.equal(warmup.status, 'settled');
  assert.equal(subject.useDefaultRenderLoop, true);
  assert.equal(warmup.diagnostics.renderLoopRetirement, null);

  const final = await settleCompletedRenderDiagnostic(
    subject,
    100,
    null,
    null,
    true,
    (label) => {
      order.push('observed');
      return { label };
    },
    ['tracking-end'],
  );
  assert.equal(final.status, 'settled');
  assert.equal(final.diagnostics.postRenderObserved, true);
  assert.equal(final.diagnostics.postRenderCondition, null);
  assert.deepEqual(final.diagnostics.finalObservation, {
    label: 'tracking-end',
  });
  assert.deepEqual(order, ['observed', 'retired']);
  assert.deepEqual(final.diagnostics.renderLoopRetirement, {
    requested: true,
    status: 'retired-at-final-post-render',
    before: true,
    after: false,
    confirmed: true,
    elapsedMs: final.diagnostics.renderLoopRetirement.elapsedMs,
  });
  assert.equal(subject.useDefaultRenderLoop, false);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('final boundary timeout does not claim retirement or settle successfully', async () => {
  const subject = viewer({ requestRender: false, renderLoop: true });
  const result = await settleCompletedRenderDiagnostic(
    subject,
    5,
    null,
    null,
    true,
  );
  assert.equal(result.status, 'page-error');
  assert.equal(result.diagnostics.pageTimerFired, true);
  assert.equal(result.diagnostics.renderLoopRetirement.confirmed, false);
  assert.equal(result.diagnostics.renderLoopRetirement.status, 'not-attempted');
  assert.equal(subject.useDefaultRenderLoop, true);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('final boundary fails closed when loop state is unavailable or retirement is refused', async () => {
  const missing = viewer({ render: true });
  const missingResult = await settleCompletedRenderDiagnostic(
    missing,
    100,
    null,
    null,
    true,
  );
  assert.equal(missingResult.status, 'page-error');
  assert.equal(
    missingResult.diagnostics.renderLoopRetirement.status,
    'viewer-render-loop-unavailable',
  );
  assert.equal(missing.scene.postRender.handlers.size, 0);

  const refused = viewer({
    render: true,
    renderLoop: true,
    refuseRetirement: true,
  });
  const refusedResult = await settleCompletedRenderDiagnostic(
    refused,
    100,
    null,
    null,
    true,
  );
  assert.equal(refusedResult.status, 'page-error');
  assert.equal(
    refusedResult.diagnostics.renderLoopRetirement.status,
    'viewer-render-loop-not-disabled',
  );
  assert.equal(refusedResult.diagnostics.renderLoopRetirement.confirmed, false);
  assert.equal(refused.useDefaultRenderLoop, true);
  assert.equal(refused.scene.postRender.handlers.size, 0);

  const alreadyDisabled = viewer({ render: true, renderLoop: false });
  const alreadyDisabledResult = await settleCompletedRenderDiagnostic(
    alreadyDisabled,
    100,
    null,
    null,
    true,
  );
  assert.equal(alreadyDisabledResult.status, 'page-error');
  assert.equal(
    alreadyDisabledResult.diagnostics.renderLoopRetirement.status,
    'already-disabled-before-final-post-render',
  );
  assert.equal(alreadyDisabled.scene.postRender.handlers.size, 0);

  const throws = viewer({
    render: true,
    renderLoop: true,
    throwOnRetirement: true,
  });
  const throwsResult = await settleCompletedRenderDiagnostic(
    throws,
    100,
    null,
    null,
    true,
  );
  assert.equal(throwsResult.status, 'page-error');
  assert.equal(
    throwsResult.diagnostics.renderLoopRetirement.status,
    'viewer-render-loop-set-failed',
  );
  assert.equal(throwsResult.diagnostics.renderLoopRetirement.confirmed, false);
  assert.equal(throws.scene.postRender.handlers.size, 0);
});

test('host binding receives owned page phase acknowledgements and is removed', async () => {
  const subject = viewer({ render: true });
  const hostSnapshots = [];
  const result = await observeRenderBoundary({
    label: 'integrated page probe',
    timeoutMs: 100,
    prepareProgress: async (receive, invocationId) => {
      const functionName = `__test_${invocationId.replaceAll('-', '')}`;
      globalThis[functionName] = (id, stage, details) =>
        receive(id, stage, details);
      return {
        functionName,
        dispose: () => {
          delete globalThis[functionName];
        },
      };
    },
    evaluate: (timeoutMs, { invocationId, progressFunctionName }) =>
      settleCompletedRenderDiagnostic(
        subject,
        timeoutMs,
        progressFunctionName,
        invocationId,
      ),
    onProgress: (snapshot) => hostSnapshots.push(snapshot),
  });
  assert.equal(result.status, 'settled');
  assert.equal(result.pageEntryObserved, true);
  assert.deepEqual(
    result.progressEvents.map(({ stage }) => stage),
    [
      'page-entry',
      'listener-registered',
      'render-request-started',
      'render-request-completed',
      'post-render',
      'terminal',
      'cleanup',
    ],
  );
  assert.ok(
    result.progressEvents.every(({ hostReceiptElapsedMs }) =>
      Number.isFinite(hostReceiptElapsedMs),
    ),
  );
  assert.equal(result.cleanup.progressBindingRemoved, true);
  assert.equal(hostSnapshots.at(-1).cleanup.progressBindingRemoved, true);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('page evaluate argument order delivers the invocation and host observes page entry', async () => {
  const subject = viewer({ render: true, renderLoop: true });
  const invocationId = 'render-boundary-owned-id';
  const progressFunctionName = '__test_render_boundary_ack';
  const hostSnapshots = [];
  const previousView = globalThis.__godsEyeView;
  const previousBinding = globalThis[progressFunctionName];
  globalThis.__godsEyeView = { viewer: subject };
  globalThis[progressFunctionName] = (receivedId, stage, details) => {
    hostSnapshots.push({ receivedId, stage, details });
  };
  try {
    const targetPage = {
      evaluate: (fn, ...args) => fn(...args),
    };
    const result = await evaluateCompletedRenderDiagnostic(targetPage, 100, {
      progressFunctionName,
      invocationId,
      retireViewerRenderLoop: true,
      finalObservationFunction: (value) => ({ value }),
      finalObservationArgs: ['serialized-final-read'],
    });

    assert.equal(result.status, 'settled');
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, true);
    assert.deepEqual(result.diagnostics.finalObservation, {
      value: 'serialized-final-read',
    });
    assert.equal(subject.useDefaultRenderLoop, false);
    assert.equal(hostSnapshots[0].receivedId, invocationId);
    assert.equal(hostSnapshots[0].stage, 'page-entry');
  } finally {
    if (previousView === undefined) delete globalThis.__godsEyeView;
    else globalThis.__godsEyeView = previousView;
    if (previousBinding === undefined) delete globalThis[progressFunctionName];
    else globalThis[progressFunctionName] = previousBinding;
  }
});

test('tracked endpoint helper is composed into the page function with JSON-only evaluate arguments', async () => {
  const order = [];
  const subject = viewer({
    render: true,
    renderLoop: true,
    onRetirement: () => order.push('retired'),
  });
  subject.trackedEntity = { gevTrackedId: 'flights:000001' };
  subject.camera = { positionWC: {}, directionWC: {}, upWC: {}, transform: [] };
  subject.clock = { currentTime: null, shouldAnimate: false, clockStep: 0 };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const app = { viewer: subject, dataManager: { layers: new Map() } };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __godsEyeView: app },
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: app,
  });
  try {
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        const serializedArgs = JSON.parse(JSON.stringify(args));
        return serializedFunction(...serializedArgs);
      },
    };
    const result = await evaluateCompletedRenderDiagnostic(targetPage, 100, {
      retireViewerRenderLoop: true,
      finalObservationFunction: observeTrackedEntityBoundary,
      finalObservationArgs: ['flights:000001'],
    });
    assert.equal(result.status, 'settled');
    assert.equal(
      result.diagnostics.finalObservation.expectedIdentity,
      'flights:000001',
    );
    assert.equal(
      result.diagnostics.finalObservation.selectedIdentity,
      'flights:000001',
    );
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, true);
    assert.deepEqual(order, ['retired']);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('provider warmup clock hold and listener registration share one serialized page callback', async () => {
  let monotonicNow = 10;
  const trace = [];
  const target = {
    Date,
    performance: { now: () => monotonicNow },
    trace,
  };
  const fixedTime = Date.parse('2026-10-08T12:00:00.000Z');
  installPhasedMonotonicWallClock(fixedTime, 1000, 1000, target);
  target.__godsEyeView = null;
  target.window = target;
  target.__gevPhasedMonotonicWallClockV1.startWarmup();
  monotonicNow += 1200;

  const subject = viewer({ renderLoop: true });
  target.__godsEyeView = { viewer: subject };
  subject.scene.postRender.addEventListener = (handler) => {
    trace.push('listener-registered');
    subject.scene.postRender.handlers.add(handler);
    return () => subject.scene.postRender.handlers.delete(handler);
  };
  subject.scene.requestRender = () => {
    trace.push(
      `render-requested-${target.__gevPhasedMonotonicWallClockV1.snapshot().phase}`,
    );
    queueMicrotask(() => subject.scene.postRender.fire());
  };

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const warmupRecord = {};
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: target.__godsEyeView,
  });
  try {
    const targetPage = {
      evaluate: (fn, ...args) => {
        const pageFunction = new Function(`return (${fn.toString()});`)();
        const jsonArgs = JSON.parse(JSON.stringify(args));
        return pageFunction(...jsonArgs);
      },
    };
    const result = await observeRenderBoundary({
      label: 'atomic provider warmup boundary',
      timeoutMs: 100,
      prepareProgress: async (receive, invocationId) => {
        const functionName = `__test_warmup_${invocationId.replaceAll('-', '')}`;
        Object.defineProperty(globalThis, functionName, {
          configurable: true,
          value: (receivedId, stage, details) =>
            receive(receivedId, stage, details),
        });
        return {
          functionName,
          dispose: () => delete globalThis[functionName],
        };
      },
      evaluate: (pageTimeoutMs, binding) =>
        evaluateCompletedRenderDiagnostic(targetPage, pageTimeoutMs, {
          ...binding,
          beforeRenderRequestFunction: holdProviderWarmupBoundary,
          beforeRenderRequestArgs: [1000],
        }),
      onProgress: createBoundaryProgressRecorder(
        warmupRecord,
        'warmupBoundaryObservation',
      ),
    });

    assert.equal(result.status, 'settled');
    assert.deepEqual(trace, [
      'listener-registered',
      'render-requested-warmup-held',
    ]);
    assert.deepEqual(
      result.page.diagnostics.beforeRenderRequestObservation,
      target.__gevPhasedMonotonicWallClockV1.snapshot(),
    );
    assert.equal(
      result.page.diagnostics.beforeRenderRequestObservation.phase,
      'warmup-held',
    );
    assert.equal(result.page.diagnostics.listenerRegistered, true);
    assert.equal(result.page.diagnostics.cleanup.listenerRemoved, true);
    const clockAck = result.progressEvents.find(
      (event) => event.stage === 'fixture-clock-held',
    );
    assert.ok(
      clockAck,
      JSON.stringify({
        ignored: result.ignoredProgressEvents,
        events: result.progressEvents,
      }),
    );
    assert.equal(clockAck.details.fixtureClockPhase, 'warmup-held');
    assert.equal(clockAck.details.fixtureClockElapsedMs, 1000);
    assert.equal(clockAck.details.fixtureClockEpochMs, fixedTime + 1000);
    assert.equal(clockAck.details.fixtureClockRunOrdinal, 1);
    assert.deepEqual(
      warmupRecord.warmupBoundary,
      result.page.diagnostics.beforeRenderRequestObservation,
    );
    assert.equal(result.cleanup.progressBindingRemoved, true);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('atomic provider clock callback error removes the listener without requesting a render', async () => {
  const subject = viewer({ renderLoop: true });
  let renderRequests = 0;
  subject.scene.requestRender = () => renderRequests++;
  const result = await settleCompletedRenderDiagnostic(
    subject,
    100,
    null,
    null,
    false,
    null,
    [],
    () => {
      throw new Error('fixture clock was not at warmup boundary');
    },
    [],
  );
  assert.equal(result.status, 'page-error');
  assert.equal(
    result.error.message,
    'fixture clock was not at warmup boundary',
  );
  assert.equal(result.diagnostics.listenerRegistered, true);
  assert.equal(result.diagnostics.cleanup.listenerRemoved, true);
  assert.equal(renderRequests, 0);
  assert.equal(subject.scene.postRender.handlers.size, 0);
});

test('host progress preserves an atomic warmup snapshot when its page render times out', async () => {
  let monotonicNow = 10;
  const target = { Date, performance: { now: () => monotonicNow } };
  target.window = target;
  installPhasedMonotonicWallClock(
    Date.parse('2026-10-08T12:00:00.000Z'),
    1000,
    1000,
    target,
  );
  target.__gevPhasedMonotonicWallClockV1.startWarmup();
  monotonicNow += 1100;
  const subject = viewer({ requestRender: false });
  subject.scene.requestRender = () => {};
  target.__godsEyeView = { viewer: subject };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const failureRecord = {};
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: target.__godsEyeView,
  });
  try {
    const targetPage = {
      evaluate: (fn, ...args) => {
        const pageFunction = new Function(`return (${fn.toString()});`)();
        const pendingPageResult = pageFunction(
          ...JSON.parse(JSON.stringify(args)),
        );
        pendingPageResult.catch(() => {});
        return new Promise(() => {});
      },
    };
    let failure;
    try {
      await observeRenderBoundary({
        label: 'atomic provider warmup host timeout',
        timeoutMs: 10,
        hostGraceMs: 10,
        prepareProgress: async (receive, invocationId) => {
          const functionName = `__test_warmup_timeout_${invocationId.replaceAll('-', '')}`;
          Object.defineProperty(globalThis, functionName, {
            configurable: true,
            value: (receivedId, stage, details) =>
              receive(receivedId, stage, details),
          });
          return {
            functionName,
            dispose: () => delete globalThis[functionName],
          };
        },
        evaluate: (pageTimeoutMs, binding) =>
          evaluateCompletedRenderDiagnostic(targetPage, pageTimeoutMs, {
            ...binding,
            beforeRenderRequestFunction: holdProviderWarmupBoundary,
            beforeRenderRequestArgs: [1000],
          }),
        onProgress: createBoundaryProgressRecorder(
          failureRecord,
          'warmupBoundaryObservation',
        ),
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    const observation = failure.boundaryObservation;
    assert.equal(observation.status, 'host-observation-deadline');
    assert.equal(observation.pendingPageResultAtDeadline, true);
    assert.ok(
      observation.progressEvents.some(
        (event) =>
          event.stage === 'fixture-clock-held' &&
          event.details.fixtureClockPhase === 'warmup-held' &&
          event.details.fixtureClockElapsedMs === 1000,
      ),
      JSON.stringify({
        ignored: observation.ignoredProgressEvents,
        events: observation.progressEvents,
      }),
    );
    assert.ok(
      observation.progressEvents.some(
        (event) => event.stage === 'page-timer-fired',
      ),
    );
    assert.deepEqual(
      failureRecord.warmupBoundary,
      target.__gevPhasedMonotonicWallClockV1.snapshot(),
    );
    assert.equal(failureRecord.warmupBoundary.runOrdinal, 1);
    assert.equal(observation.cleanup.progressBindingRemoved, true);
    assert.equal(subject.scene.postRender.handlers.size, 0);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('serialized Austin boundary waits for installation readiness and a later render before retirement', async () => {
  const stats = { loading: true, error: null };
  const order = [];
  const subject = viewer({
    renderLoop: true,
    onRetirement: () => order.push('retired'),
  });
  let renderRequests = 0;
  subject.scene.requestRender = () => {
    renderRequests += 1;
    order.push(`request-${renderRequests}`);
  };
  const app = {
    viewer: subject,
    dataManager: {
      layers: new Map([
        ['military-installations', { module: { getStats: () => stats } }],
      ]),
      isEnabled: (id) => id === 'military-installations',
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  try {
    const stages = [];
    let firstPostRenderElapsedMs = null;
    const ungatedSubject = viewer({ renderLoop: true });
    const ungatedApp = {
      viewer: ungatedSubject,
      dataManager: {
        layers: new Map([
          ['military-installations', { module: { getStats: () => stats } }],
        ]),
        isEnabled: () => true,
      },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __godsEyeView: ungatedApp },
    });
    Object.defineProperty(globalThis, '__godsEyeView', {
      configurable: true,
      value: ungatedApp,
    });
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        return serializedFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    const ungatedPromise = evaluateCompletedRenderDiagnostic(targetPage, 100, {
      retireViewerRenderLoop: true,
    });
    ungatedSubject.scene.postRender.fire();
    const ungatedResult = await ungatedPromise;
    assert.equal(stats.loading, true);
    assert.equal(ungatedResult.status, 'settled');
    assert.equal(
      ungatedResult.diagnostics.renderLoopRetirement.confirmed,
      true,
    );

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __godsEyeView: app },
    });
    Object.defineProperty(globalThis, '__godsEyeView', {
      configurable: true,
      value: app,
    });
    globalThis.__test_austin_boundary_progress = (_id, stage, details) => {
      stages.push(stage);
      if (stage === 'post-render')
        firstPostRenderElapsedMs = details.pageElapsedMs;
    };
    const resultPromise = evaluateCompletedRenderDiagnostic(targetPage, 200, {
      progressFunctionName: '__test_austin_boundary_progress',
      invocationId: 'austin-installation-boundary',
      retireViewerRenderLoop: true,
      postRenderConditionFunction:
        observeAustinInstallationsReadyForRenderBoundary,
    });
    await Promise.resolve();
    const retiredHandler = [...subject.scene.postRender.handlers][0];
    assert.equal(typeof retiredHandler, 'function');
    assert.equal(renderRequests, 1);
    assert.equal(subject.useDefaultRenderLoop, true);

    subject.scene.postRender.fire();
    for (let index = 0; index < 9; index += 1) subject.scene.postRender.fire();
    assert.equal(renderRequests, 1);
    assert.equal(subject.useDefaultRenderLoop, true);

    stats.loading = false;
    subject.scene.postRender.fire();
    assert.equal(renderRequests, 2);
    assert.equal(subject.useDefaultRenderLoop, true);
    assert.deepEqual(order, ['request-1', 'request-2']);

    subject.scene.postRender.fire();
    const result = await resultPromise;
    await Promise.resolve();
    assert.equal(result.status, 'settled');
    assert.equal(result.diagnostics.postRenderCondition.initialReady, false);
    assert.equal(result.diagnostics.postRenderObserved, true);
    assert.equal(
      result.diagnostics.postRenderElapsedMs,
      firstPostRenderElapsedMs,
    );
    assert.equal(result.diagnostics.postRenderCondition.observations, 13);
    assert.equal(
      result.diagnostics.postRenderCondition.readyPostRenderCount,
      2,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.acceptedAfterFollowupRender,
      true,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.acceptedBoundaryObserved,
      true,
    );
    assert.ok(
      result.diagnostics.postRenderCondition.acceptedBoundaryElapsedMs >=
        result.diagnostics.postRenderElapsedMs,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.followupRenderRequestCompleted,
      true,
    );
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, true);
    assert.deepEqual(order, ['request-1', 'request-2', 'retired']);
    assert.equal(subject.scene.postRender.handlers.size, 0);
    assert.equal(stages.filter((stage) => stage === 'post-render').length, 1);
    assert.ok(stages.length <= 8, stages.join(','));

    retiredHandler();
    assert.equal(result.diagnostics.postRenderCondition.observations, 13);
    assert.equal(renderRequests, 2);
  } finally {
    delete globalThis.__test_austin_boundary_progress;
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('Austin boundary requires readiness to survive the viewport debounce window', async () => {
  const stats = { loading: false, error: null };
  const subject = viewer({ renderLoop: true });
  let renderRequests = 0;
  subject.scene.requestRender = () => {
    renderRequests += 1;
  };
  const app = {
    viewer: subject,
    dataManager: {
      layers: new Map([
        ['military-installations', { module: { getStats: () => stats } }],
      ]),
      isEnabled: () => true,
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __godsEyeView: app },
    });
    Object.defineProperty(globalThis, '__godsEyeView', {
      configurable: true,
      value: app,
    });
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        return serializedFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    const resultPromise = evaluateCompletedRenderDiagnostic(targetPage, 500, {
      retireViewerRenderLoop: true,
      postRenderConditionFunction:
        observeAustinInstallationsReadyForRenderBoundary,
      postRenderConditionStabilityMs: 20,
    });
    await Promise.resolve();
    assert.equal(renderRequests, 1);

    subject.scene.postRender.fire();
    subject.scene.postRender.fire();
    assert.equal(subject.useDefaultRenderLoop, true);
    assert.equal(renderRequests, 1);

    stats.loading = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(renderRequests, 2);
    subject.scene.postRender.fire();
    assert.equal(subject.useDefaultRenderLoop, true);

    stats.loading = false;
    subject.scene.postRender.fire();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(renderRequests, 3);
    subject.scene.postRender.fire();
    const result = await resultPromise;

    assert.equal(result.status, 'settled');
    assert.equal(result.diagnostics.postRenderCondition.stabilityMs, 20);
    assert.equal(
      result.diagnostics.postRenderCondition.stabilityTimerStarted,
      true,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.stabilityTimerFired,
      true,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.stabilityTimerCancelled,
      false,
    );
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, true);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('Austin readiness boundary fails on missing or errored installation state without retiring', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  try {
    for (const state of [
      { entry: null, enabled: true },
      {
        entry: {
          module: { getStats: () => ({ loading: false, error: null }) },
        },
        enabled: false,
      },
      {
        entry: { module: { getStats: () => ({ error: null }) } },
        enabled: true,
      },
      {
        entry: {
          module: { getStats: () => ({ loading: false, error: 'bad' }) },
        },
        enabled: true,
      },
    ]) {
      const subject = viewer({ renderLoop: true });
      const app = {
        viewer: subject,
        dataManager: {
          layers: new Map(
            state.entry ? [['military-installations', state.entry]] : [],
          ),
          isEnabled: () => state.enabled,
        },
      };
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { __godsEyeView: app },
      });
      Object.defineProperty(globalThis, '__godsEyeView', {
        configurable: true,
        value: app,
      });
      const targetPage = {
        evaluate: (fn, ...args) => {
          const serializedFunction = new Function(
            `return (${fn.toString()});`,
          )();
          return serializedFunction(...JSON.parse(JSON.stringify(args)));
        },
      };
      const result = await evaluateCompletedRenderDiagnostic(targetPage, 100, {
        retireViewerRenderLoop: true,
        postRenderConditionFunction:
          observeAustinInstallationsReadyForRenderBoundary,
      });
      assert.equal(result.status, 'page-error');
      assert.match(result.error.message, /Austin installations/);
      assert.equal(subject.useDefaultRenderLoop, true);
      assert.equal(subject.scene.postRender.handlers.size, 0);
      assert.equal(result.diagnostics.cleanup.timerCleared, true);
      assert.equal(result.diagnostics.cleanup.listenerRemoved, true);
    }
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('Austin readiness timeout stays within page boundary and removes its listener', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const stats = { loading: true, error: null };
  const subject = viewer({ requestRender: false, renderLoop: true });
  const app = {
    viewer: subject,
    dataManager: {
      layers: new Map([
        ['military-installations', { module: { getStats: () => stats } }],
      ]),
      isEnabled: () => true,
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __godsEyeView: app },
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: app,
  });
  try {
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        return serializedFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    const resultPromise = evaluateCompletedRenderDiagnostic(targetPage, 10, {
      retireViewerRenderLoop: true,
      postRenderConditionFunction:
        observeAustinInstallationsReadyForRenderBoundary,
    });
    await Promise.resolve();
    const lateHandler = [...subject.scene.postRender.handlers][0];
    assert.equal(typeof lateHandler, 'function');
    const result = await resultPromise;
    assert.equal(result.status, 'page-error');
    assert.equal(result.diagnostics.pageTimerFired, true);
    assert.equal(result.diagnostics.postRenderObserved, false);
    assert.equal(result.diagnostics.postRenderElapsedMs, null);
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, false);
    assert.equal(subject.useDefaultRenderLoop, true);
    assert.equal(subject.scene.postRender.handlers.size, 0);
    assert.equal(result.diagnostics.cleanup.timerCleared, true);
    lateHandler();
    assert.equal(subject.scene.postRender.handlers.size, 0);
    assert.equal(result.diagnostics.postRenderCondition.observations, 1);
    assert.equal(result.diagnostics.postRenderObserved, false);
    assert.equal(result.diagnostics.postRenderElapsedMs, null);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('Austin loading postrenders record first observation without accepting or retiring the boundary', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const stats = { loading: true, error: null };
  const subject = viewer({ requestRender: false, renderLoop: true });
  const app = {
    viewer: subject,
    dataManager: {
      layers: new Map([
        ['military-installations', { module: { getStats: () => stats } }],
      ]),
      isEnabled: () => true,
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __godsEyeView: app },
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: app,
  });
  try {
    const stages = [];
    let firstPostRenderElapsedMs = null;
    globalThis.__test_austin_loading_progress = (_id, stage, details) => {
      stages.push(stage);
      if (stage === 'post-render')
        firstPostRenderElapsedMs = details.pageElapsedMs;
    };
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        return serializedFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    const resultPromise = evaluateCompletedRenderDiagnostic(targetPage, 10, {
      progressFunctionName: '__test_austin_loading_progress',
      invocationId: 'austin-loading-timeout',
      retireViewerRenderLoop: true,
      postRenderConditionFunction:
        observeAustinInstallationsReadyForRenderBoundary,
    });
    await Promise.resolve();
    const copiedHandler = [...subject.scene.postRender.handlers][0];
    assert.equal(typeof copiedHandler, 'function');
    for (let index = 0; index < 4; index += 1) subject.scene.postRender.fire();

    const result = await resultPromise;
    assert.equal(result.status, 'page-error');
    assert.equal(result.diagnostics.pageTimerFired, true);
    assert.equal(result.diagnostics.postRenderObserved, true);
    assert.equal(
      result.diagnostics.postRenderElapsedMs,
      firstPostRenderElapsedMs,
    );
    assert.ok(Number.isFinite(result.diagnostics.postRenderElapsedMs));
    assert.equal(
      result.diagnostics.postRenderCondition.acceptedBoundaryObserved,
      false,
    );
    assert.equal(
      result.diagnostics.postRenderCondition.acceptedBoundaryElapsedMs,
      null,
    );
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, false);
    assert.equal(subject.useDefaultRenderLoop, true);
    assert.equal(stages.filter((stage) => stage === 'post-render').length, 1);
    const observationsAtTerminal =
      result.diagnostics.postRenderCondition.observations;
    copiedHandler();
    assert.equal(
      result.diagnostics.postRenderCondition.observations,
      observationsAtTerminal,
    );
    assert.equal(
      result.diagnostics.postRenderElapsedMs,
      firstPostRenderElapsedMs,
    );
  } finally {
    delete globalThis.__test_austin_loading_progress;
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});

test('Austin readiness condition errors after a postrender preserve the render observation', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
  const stats = { loading: true, error: null };
  const subject = viewer({ renderLoop: true });
  const app = {
    viewer: subject,
    dataManager: {
      layers: new Map([
        ['military-installations', { module: { getStats: () => stats } }],
      ]),
      isEnabled: () => true,
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __godsEyeView: app },
  });
  Object.defineProperty(globalThis, '__godsEyeView', {
    configurable: true,
    value: app,
  });
  try {
    const targetPage = {
      evaluate: (fn, ...args) => {
        const serializedFunction = new Function(`return (${fn.toString()});`)();
        return serializedFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    const resultPromise = evaluateCompletedRenderDiagnostic(targetPage, 100, {
      retireViewerRenderLoop: true,
      postRenderConditionFunction:
        observeAustinInstallationsReadyForRenderBoundary,
    });
    await Promise.resolve();
    subject.scene.postRender.fire();
    assert.equal(subject.useDefaultRenderLoop, true);
    stats.error = 'fixture source failed';
    subject.scene.postRender.fire();
    const result = await resultPromise;
    assert.equal(result.status, 'page-error');
    assert.match(result.error.message, /reported an error/);
    assert.equal(result.diagnostics.postRenderObserved, true);
    assert.ok(Number.isFinite(result.diagnostics.postRenderElapsedMs));
    assert.equal(
      result.diagnostics.postRenderCondition.acceptedBoundaryObserved,
      false,
    );
    assert.equal(result.diagnostics.renderLoopRetirement.confirmed, false);
    assert.equal(subject.useDefaultRenderLoop, true);
    assert.equal(subject.scene.postRender.handlers.size, 0);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});
