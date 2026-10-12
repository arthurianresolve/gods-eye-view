import assert from 'node:assert/strict';
import test from 'node:test';
import { observeRenderBoundary } from './renderBoundaryObservation.mjs';
import {
  evaluateCompletedRenderDiagnostic,
  settleCompletedRenderDiagnostic,
} from './settleCompletedRenderDiagnostic.mjs';
import { observeTrackedEntityBoundary } from './trackingRoute.mjs';

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
