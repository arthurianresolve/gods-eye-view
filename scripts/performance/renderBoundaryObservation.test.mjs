import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundaryProgressRecorder,
  observeRenderBoundary,
} from './renderBoundaryObservation.mjs';
import { createCaptureFailureReport } from './captureFailureReport.mjs';

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function pageDiagnostics(overrides = {}) {
  return {
    phase: 'settled',
    pageEntryElapsedMs: 0,
    pageElapsedMs: 4,
    listenerRegistered: true,
    listenerRegistrationElapsedMs: 1,
    renderRequestStarted: true,
    renderRequestStartElapsedMs: 1,
    renderRequestCompleted: true,
    renderRequestCompleteElapsedMs: 2,
    postRenderObserved: true,
    postRenderElapsedMs: 4,
    pageTimerFired: false,
    pageTimerElapsedMs: null,
    cleanup: { timerCleared: true, listenerRemoved: true },
    ...overrides,
  };
}

test('render boundary reports page entry, dispatch delay, render and listener cleanup', async () => {
  const progress = [];
  const result = await observeRenderBoundary({
    label: 'measurement boundary',
    timeoutMs: 100,
    evaluate: async () => {
      await delay(12);
      return {
        status: 'settled',
        settleElapsedMs: 4,
        diagnostics: pageDiagnostics({ pageEntryElapsedMs: 10 }),
      };
    },
    onProgress: (entry) => progress.push(entry),
  });
  assert.equal(result.status, 'settled');
  assert.equal(result.page.diagnostics.listenerRegistered, true);
  assert.equal(result.page.diagnostics.renderRequestStarted, true);
  assert.equal(result.page.diagnostics.postRenderObserved, true);
  assert.equal(result.settleElapsedMs, 4);
  assert.equal(Number.isFinite(result.hostEvaluationOverheadResidualMs), true);
  assert.equal(result.pendingPageResultAtDeadline, false);
  assert.equal(result.cleanup.hostTimerCleared, true);
  assert.equal(progress.at(-1).status, 'settled');
});

test('host deadline retains page entry acknowledgement when page stalls', async () => {
  let resolveEvaluation;
  const progress = [];
  let receiveProgress;
  let invocationId;
  const pending = new Promise((resolve) => {
    resolveEvaluation = resolve;
  });
  await assert.rejects(
    observeRenderBoundary({
      label: 'slow boundary',
      timeoutMs: 8,
      hostGraceMs: 0,
      prepareProgress: async (receive, id) => {
        receiveProgress = receive;
        invocationId = id;
        return { functionName: '__fixture_progress', dispose: () => {} };
      },
      evaluate: () => {
        receiveProgress(invocationId, 'page-entry', { pageElapsedMs: 0 });
        receiveProgress(invocationId, 'listener-registered', {
          listenerRegistered: true,
          pageElapsedMs: 1,
        });
        return pending;
      },
      onProgress: (entry) => progress.push(entry),
    }),
    (error) => {
      assert.equal(
        error.boundaryObservation.status,
        'host-observation-deadline',
      );
      assert.equal(error.boundaryObservation.pendingPageResultAtDeadline, true);
      assert.equal(error.boundaryObservation.pageEntryObserved, true);
      assert.equal(error.boundaryObservation.progressEvents.length, 2);
      assert.equal(
        error.boundaryObservation.progressEvents[0].stage,
        'page-entry',
      );
      assert.equal(
        error.boundaryObservation.progressEvents[0].afterHostDeadline,
        false,
      );
      assert.equal(
        error.boundaryObservation.hostEvaluationOverheadResidualMs,
        null,
      );
      assert.equal(error.boundaryObservation.cleanup.hostTimerCleared, true);
      return true;
    },
  );

  resolveEvaluation({
    status: 'settled',
    settleElapsedMs: 4,
    diagnostics: pageDiagnostics(),
  });
  await delay(5);
  const late = progress.at(-1);
  assert.equal(late.status, 'host-observation-deadline');
  assert.equal(late.latePageResultObserved, true);
  assert.equal(late.page.status, 'settled');
  assert.equal(Number.isFinite(late.hostEvaluationOverheadResidualMs), true);
});

test('host deadline distinguishes no page entry and ignores malformed or foreign acknowledgements', async () => {
  let receiveProgress;
  let invocationId;
  await assert.rejects(
    observeRenderBoundary({
      label: 'no page entry',
      timeoutMs: 5,
      hostGraceMs: 0,
      prepareProgress: async (receive, id) => {
        receiveProgress = receive;
        invocationId = id;
        return { functionName: '__fixture_progress', dispose: () => {} };
      },
      evaluate: () => new Promise(() => {}),
    }),
    (error) => {
      assert.equal(error.boundaryObservation.pageEntryObserved, false);
      assert.equal(error.boundaryObservation.pendingPageResultAtDeadline, true);
      receiveProgress('wrong-invocation', 'page-entry', { pageElapsedMs: 0 });
      receiveProgress(invocationId, 'unknown-stage', {});
      receiveProgress(invocationId, 'page-entry', []);
      receiveProgress(invocationId, 'page-entry', { pageElapsedMs: true });
      const validLate = receiveProgress(invocationId, 'page-entry', {
        pageElapsedMs: 0,
      });
      assert.equal(validLate.accepted, true);
      for (let index = 0; index < 7; index += 1)
        receiveProgress(invocationId, 'page-entry', {});
      const overflow = receiveProgress(invocationId, 'page-entry', {});
      assert.equal(overflow.accepted, false);
      assert.equal(error.boundaryObservation.pageEntryObserved, true);
      assert.equal(error.boundaryObservation.progressEvents.length, 8);
      assert.deepEqual(error.boundaryObservation.ignoredProgressEvents, {
        wrongInvocation: 1,
        malformed: 3,
        overflow: 1,
      });
      assert.equal(
        error.boundaryObservation.progressEvents.at(-1).afterHostDeadline,
        true,
      );
      return true;
    },
  );
});

test('a progress binding that resolves after the deadline is disposed without starting page evaluation', async () => {
  let resolveBinding;
  let disposed = 0;
  let evaluations = 0;
  const bindingPromise = new Promise((resolve) => {
    resolveBinding = resolve;
  });
  await assert.rejects(
    observeRenderBoundary({
      label: 'late binding',
      timeoutMs: 5,
      hostGraceMs: 0,
      prepareProgress: () => bindingPromise,
      evaluate: () => {
        evaluations += 1;
      },
    }),
    /host observation deadline/,
  );
  resolveBinding({
    functionName: '__late_binding',
    dispose: () => {
      disposed += 1;
    },
  });
  await delay(5);
  assert.equal(evaluations, 0);
  assert.equal(disposed, 1);
});

test('malformed progress binding is disposed and page evaluation never starts', async () => {
  let disposed = 0;
  let evaluations = 0;
  await assert.rejects(
    observeRenderBoundary({
      label: 'bad binding',
      timeoutMs: 100,
      prepareProgress: async () => ({
        functionName: 'not-a-browser-function-name',
        dispose: () => {
          disposed += 1;
        },
      }),
      evaluate: () => {
        evaluations += 1;
      },
    }),
    /progress binding is malformed/,
  );
  assert.equal(disposed, 1);
  assert.equal(evaluations, 0);
});

test('binding cleanup failure is recorded without replacing a page timer failure', async () => {
  await assert.rejects(
    observeRenderBoundary({
      label: 'cleanup failure',
      timeoutMs: 100,
      prepareProgress: async () => ({
        functionName: '__fixture_progress',
        dispose: async () => {
          throw new Error('binding cleanup failed');
        },
      }),
      evaluate: async () => ({
        status: 'page-error',
        error: { name: 'Error', message: 'page timer fired' },
        diagnostics: pageDiagnostics({
          phase: 'page-error',
          pageTimerFired: true,
          postRenderObserved: false,
        }),
      }),
    }),
    (error) => {
      assert.match(error.message, /page timer fired/);
      assert.equal(error.boundaryObservation.status, 'page-error');
      assert.equal(
        error.boundaryObservation.cleanup.progressBindingRemoved,
        false,
      );
      assert.equal(
        error.boundaryObservation.cleanup.progressBindingError.message,
        'binding cleanup failed',
      );
      return true;
    },
  );
});

test('binding cleanup duration measures only its own bounded teardown', async () => {
  let clock = 10;
  const result = await observeRenderBoundary({
    label: 'cleanup duration',
    timeoutMs: 100,
    now: () => clock,
    prepareProgress: async () => ({
      functionName: '__fixture_progress',
      dispose: () => {
        clock += 7;
      },
    }),
    evaluate: async () => {
      clock += 5;
      return {
        status: 'settled',
        settleElapsedMs: 3,
        diagnostics: pageDiagnostics({ pageElapsedMs: 3 }),
      };
    },
  });
  assert.equal(result.cleanup.progressBindingCleanupElapsedMs, 7);
  assert.equal(result.hostElapsedMs, 5);
  assert.equal(result.hostEvaluationOverheadResidualMs, 2);
});

test('page timeout and render-request errors remain distinct from host timeout', async () => {
  const neverRendered = {
    status: 'page-error',
    error: { name: 'Error', message: 'Completed render did not settle.' },
    diagnostics: pageDiagnostics({
      phase: 'page-error',
      pageTimerFired: true,
      postRenderObserved: false,
    }),
  };
  await assert.rejects(
    observeRenderBoundary({
      label: 'page timer',
      timeoutMs: 100,
      evaluate: async () => neverRendered,
    }),
    (error) => {
      assert.equal(error.boundaryObservation.status, 'page-error');
      assert.equal(
        error.boundaryObservation.page.diagnostics.pageTimerFired,
        true,
      );
      assert.equal(
        error.boundaryObservation.page.diagnostics.postRenderObserved,
        false,
      );
      return /Completed render did not settle/.test(error.message);
    },
  );

  await assert.rejects(
    observeRenderBoundary({
      label: 'evaluation',
      timeoutMs: 100,
      evaluate: async () => {
        throw new Error('render request observer error');
      },
    }),
    (error) => {
      assert.equal(error.boundaryObservation.status, 'page-evaluation-error');
      return /render request observer error/.test(error.message);
    },
  );
});

test('invalid observers fail before scheduling a timer', async () => {
  let timers = 0;
  await assert.rejects(
    observeRenderBoundary({
      label: '',
      evaluate: () => {},
      setTimer: () => {
        timers += 1;
      },
    }),
    /arguments are invalid/,
  );
  assert.equal(timers, 0);
});

test('host deadline is scheduled from the original boundary start after slow dispatch', async () => {
  let clock = 0;
  let scheduledDelay = null;
  let fireTimer;
  const progress = [];
  const pending = new Promise(() => {});
  const observed = observeRenderBoundary({
    label: 'slow page entry',
    timeoutMs: 100,
    hostGraceMs: 10,
    now: () => clock,
    evaluate: () => {
      clock = 7;
      return pending;
    },
    onProgress: (snapshot) => progress.push(snapshot),
    setTimer: (callback, delayMs) => {
      fireTimer = callback;
      scheduledDelay = delayMs;
      return 1;
    },
    clearTimer: () => {},
  });
  await Promise.resolve();
  assert.equal(scheduledDelay, 110);
  assert.equal(progress.at(-1).hostDispatchElapsedMs, 7);
  clock = 110;
  fireTimer();
  await assert.rejects(observed, (error) => {
    assert.equal(error.boundaryObservation.status, 'host-observation-deadline');
    assert.equal(error.boundaryObservation.hostTimeoutMs, 110);
    return true;
  });
});

test('boundary progress recorder remains bound to the invocation owner after current record changes', () => {
  const original = {};
  const replacement = {};
  let current = original;
  const recordProgress = createBoundaryProgressRecorder(
    current,
    'measurementBoundaryObservation',
  );
  current = replacement;
  recordProgress({ invocationId: 'invocation-a', status: 'host-deadline' });
  assert.equal(
    original.measurementBoundaryObservation.invocationId,
    'invocation-a',
  );
  assert.equal(replacement.measurementBoundaryObservation, undefined);
  assert.throws(
    () => createBoundaryProgressRecorder({}, 'arbitraryPayload'),
    /owner is invalid/,
  );
  const failure = createCaptureFailureReport({
    phase: 'measurement-boundary-render-wait',
    error: new Error('boundary timed out'),
    current: original,
  });
  assert.equal(
    failure.progress.current.measurementBoundaryObservation.invocationId,
    'invocation-a',
  );
});
