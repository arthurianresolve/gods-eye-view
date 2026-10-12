import assert from 'node:assert/strict';
import test from 'node:test';
import { observeRenderBoundary } from './renderBoundaryObservation.mjs';
import { settleCompletedRenderDiagnostic } from './settleCompletedRenderDiagnostic.mjs';

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

function viewer({ render = false, requestRender = true } = {}) {
  const postRender = new Event();
  const scene = { postRender };
  if (requestRender) {
    scene.requestRender = () => {
      if (render) queueMicrotask(() => postRender.fire());
    };
  }
  return { scene };
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
