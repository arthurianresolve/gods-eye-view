import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundaryProgressRecorder,
  observeRenderBoundary,
  prepareRenderBoundaryProgressBinding,
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

test('a null optional progress binding is treated as absent while malformed bindings still fail', async () => {
  const result = await observeRenderBoundary({
    label: 'Austin warmup boundary without progress binding',
    progressBinding: null,
    timeoutMs: 100,
    evaluate: async () => ({
      status: 'settled',
      settleElapsedMs: 4,
      diagnostics: pageDiagnostics(),
    }),
  });

  assert.equal(result.status, 'settled');
  assert.equal(result.progressBindingOwnerId, null);
  assert.equal(result.cleanup.progressBindingRemoved, true);
  assert.equal(result.cleanup.progressInvocationReleased, true);

  await assert.rejects(
    observeRenderBoundary({
      label: 'malformed progress binding',
      progressBinding: {},
      evaluate: () => {},
    }),
    /arguments are invalid/,
  );
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
  const sourceTrigger = createBoundaryProgressRecorder(
    original,
    'postMeasurementSourceTriggerBoundaryObservation',
  );
  sourceTrigger({ invocationId: 'source-trigger', status: 'settled' });
  assert.equal(
    original.postMeasurementSourceTriggerBoundaryObservation.invocationId,
    'source-trigger',
  );
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

test('preinstalled document binding covers warmup and measurement without boundary setup cost', async () => {
  const exposed = new Map();
  const order = [];
  const page = {
    async exposeFunction(name, callback) {
      order.push('binding-installed');
      exposed.set(name, callback);
    },
    async removeExposedFunction(name) {
      order.push('binding-removed');
      exposed.delete(name);
    },
  };
  const binding = await prepareRenderBoundaryProgressBinding({
    page,
    ownerId: 'provider-sample:document-a',
  });
  const records = [];
  for (const label of ['warmup', 'measurement']) {
    const progress = [];
    const result = await observeRenderBoundary({
      label,
      timeoutMs: 100,
      progressBinding: binding,
      evaluate: async (_timeout, current) => {
        order.push(`${label}-boundary-started`);
        const callback = exposed.get(current.progressFunctionName);
        assert.equal(typeof callback, 'function');
        await callback(current.invocationId, 'page-entry', {
          pageElapsedMs: 0,
        });
        return {
          status: 'settled',
          settleElapsedMs: 4,
          diagnostics: pageDiagnostics(),
        };
      },
      onProgress: (entry) => progress.push(entry),
    });
    records.push(result.invocationId);
    assert.equal(result.progressBindingOwnerId, binding.ownerId);
    assert.equal(result.progressBindingSetupElapsedMs, binding.setupElapsedMs);
    assert.equal(result.hostProgressBindingSetupElapsedMs, null);
    assert.equal(result.cleanup.progressInvocationReleased, true);
    assert.equal(result.cleanup.progressBindingRemoved, null);
    assert.equal(progress.at(-1).pageEntryObserved, true);
    assert.equal(exposed.has(binding.functionName), true);
  }
  assert.equal(new Set(records).size, 2);
  assert.deepEqual(order, [
    'binding-installed',
    'warmup-boundary-started',
    'measurement-boundary-started',
  ]);
  const cleanup = await binding.dispose();
  assert.equal(cleanup.removed, true);
  assert.equal(exposed.size, 0);
  assert.equal(order.at(-1), 'binding-removed');
});

test('late acknowledgements remain bound to their invocation and cannot update the next record', async () => {
  const exposed = new Map();
  const page = {
    async exposeFunction(name, callback) {
      exposed.set(name, callback);
    },
    async removeExposedFunction(name) {
      exposed.delete(name);
    },
  };
  const binding = await prepareRenderBoundaryProgressBinding({
    page,
    ownerId: 'provider-sample:document-b',
  });
  let staleInvocationId;
  const firstProgress = [];
  await assert.rejects(
    observeRenderBoundary({
      label: 'stalled warmup',
      timeoutMs: 8,
      hostGraceMs: 0,
      progressBinding: binding,
      evaluate: (_timeout, current) => {
        staleInvocationId = current.invocationId;
        return new Promise(() => {});
      },
      onProgress: (entry) => firstProgress.push(entry),
    }),
    /host observation deadline/,
  );
  const secondProgress = [];
  let currentInvocationId;
  const result = await observeRenderBoundary({
    label: 'measurement',
    timeoutMs: 100,
    progressBinding: binding,
    evaluate: async (_timeout, current) => {
      currentInvocationId = current.invocationId;
      await exposed.get(binding.functionName)(
        current.invocationId,
        'page-entry',
        { pageElapsedMs: 0 },
      );
      return {
        status: 'settled',
        settleElapsedMs: 2,
        diagnostics: pageDiagnostics(),
      };
    },
    onProgress: (entry) => secondProgress.push(entry),
  });
  const malformedAccepted = await exposed.get(binding.functionName)(
    'not-a-uuid',
    'page-entry',
    { pageElapsedMs: 0 },
  );
  const staleAccepted = await exposed.get(binding.functionName)(
    staleInvocationId,
    'page-entry',
    { pageElapsedMs: 0 },
  );
  assert.equal(malformedAccepted.accepted, false);
  assert.notEqual(staleInvocationId, currentInvocationId);
  assert.equal(staleAccepted.accepted, false);
  assert.deepEqual(binding.ignoredCallbacks, {
    malformedInvocation: 1,
    unownedInvocation: 1,
  });
  assert.equal(firstProgress.at(-1).progressEvents.length, 0);
  assert.equal(result.pageEntryObserved, true);
  assert.equal(secondProgress.at(-1).progressEvents.length, 1);
  assert.equal((await binding.dispose()).removed, true);
});

test('late document-binding setup schedules cleanup without treating install as success', async () => {
  let resolveInstall;
  let removed = 0;
  const page = {
    exposeFunction: () =>
      new Promise((resolve) => {
        resolveInstall = resolve;
      }),
    removeExposedFunction: async () => {
      removed += 1;
    },
  };
  await assert.rejects(
    prepareRenderBoundaryProgressBinding({
      page,
      ownerId: 'provider-sample:document-c',
      timeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.name, 'TimeoutError');
      assert.equal(error.lateRemovalScheduled, true);
      return true;
    },
  );
  resolveInstall();
  await delay(5);
  assert.equal(removed, 1);
});

test('failed document-binding setup attempts owner-local cleanup and preserves setup error', async () => {
  let removed = 0;
  const page = {
    exposeFunction: async () => {
      throw new Error('binding setup rejected');
    },
    removeExposedFunction: async () => {
      removed += 1;
    },
  };
  await assert.rejects(
    prepareRenderBoundaryProgressBinding({
      page,
      ownerId: 'provider-sample:document-e',
    }),
    /binding setup rejected/,
  );
  assert.equal(removed, 1);
});

test('persistent binding cleanup is bounded and reports an unremoved owner', async () => {
  const page = {
    async exposeFunction() {},
    removeExposedFunction: () => new Promise(() => {}),
  };
  const binding = await prepareRenderBoundaryProgressBinding({
    page,
    ownerId: 'provider-sample:document-d',
  });
  const cleanup = await binding.dispose();
  assert.equal(cleanup.removed, false);
  assert.equal(cleanup.error.name, 'TimeoutError');
  assert.ok(cleanup.elapsedMs >= 200 && cleanup.elapsedMs < 1000);
});

test('concurrent binding disposal waits for the same pending removal outcome', async () => {
  let finishRemoval;
  let removeCalls = 0;
  const page = {
    async exposeFunction() {},
    removeExposedFunction() {
      removeCalls += 1;
      return new Promise((resolve) => {
        finishRemoval = resolve;
      });
    },
  };
  const binding = await prepareRenderBoundaryProgressBinding({
    page,
    ownerId: 'provider-sample:concurrent-dispose',
  });
  const first = binding.dispose();
  await delay(0);
  const second = binding.dispose();
  let settled = false;
  second.then(() => {
    settled = true;
  });
  await delay(0);
  assert.equal(settled, false);
  assert.equal(removeCalls, 1);
  finishRemoval();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(firstResult.removed, true);
  assert.ok(firstResult.elapsedMs >= 0);
});

test('concurrent disposal shares removal rejection and timeout results', async (t) => {
  await t.test('rejection', async () => {
    let removeCalls = 0;
    const binding = await prepareRenderBoundaryProgressBinding({
      page: {
        async exposeFunction() {},
        async removeExposedFunction() {
          removeCalls += 1;
          throw new Error('remove rejected');
        },
      },
      ownerId: 'provider-sample:concurrent-rejection',
    });
    const first = binding.dispose();
    const second = binding.dispose();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(firstResult.removed, false);
    assert.equal(firstResult.error.message, 'remove rejected');
    assert.equal(removeCalls, 1);
  });

  await t.test('timeout', async () => {
    let removeCalls = 0;
    const binding = await prepareRenderBoundaryProgressBinding({
      page: {
        async exposeFunction() {},
        removeExposedFunction() {
          removeCalls += 1;
          return new Promise(() => {});
        },
      },
      ownerId: 'provider-sample:concurrent-timeout',
    });
    const first = binding.dispose();
    const second = binding.dispose();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(firstResult.removed, false);
    assert.equal(firstResult.error.name, 'TimeoutError');
    assert.equal(removeCalls, 1);
  });
});

test('invocation unregistration errors use invocation cleanup evidence', async () => {
  const progress = [];
  const result = await observeRenderBoundary({
    label: 'invocation cleanup rejection',
    timeoutMs: 100,
    progressBinding: {
      functionName: '__gevRenderBoundary_test',
      ownerId: 'provider-sample:registration-error',
      register: () => true,
      unregister: () => {
        throw new Error('invocation unregister rejected');
      },
    },
    evaluate: async () => ({
      status: 'settled',
      settleElapsedMs: 1,
      diagnostics: pageDiagnostics(),
    }),
    onProgress: (entry) => progress.push(entry),
  });
  assert.equal(
    result.cleanup.progressInvocationError.message,
    'invocation unregister rejected',
  );
  assert.equal(result.cleanup.progressBindingError, undefined);
  assert.equal(
    progress.at(-1).cleanup.progressInvocationError.message,
    'invocation unregister rejected',
  );
});

test('failure reports retain progress-binding setup and boundary-timeout ownership', async (t) => {
  await t.test('setup failure', () => {
    const current = {
      phase: 'prepare-render-boundary-binding',
      renderBoundaryProgressBinding: {
        ownerId: 'provider-sample:document-setup-failure',
        status: 'setup-timeout',
        setupTimeoutMs: 5000,
        setupElapsedMs: 5000,
        cleanup: null,
        lateRemovalScheduled: true,
      },
    };
    const report = createCaptureFailureReport({
      phase: current.phase,
      error: new Error('binding install timed out'),
      current,
    });
    assert.deepEqual(
      report.progress.current.renderBoundaryProgressBinding,
      current.renderBoundaryProgressBinding,
    );
  });

  await t.test('boundary timeout after cleanup', async () => {
    const exposed = new Map();
    const page = {
      async exposeFunction(name, callback) {
        exposed.set(name, callback);
      },
      async removeExposedFunction(name) {
        exposed.delete(name);
      },
    };
    const binding = await prepareRenderBoundaryProgressBinding({
      page,
      ownerId: 'provider-sample:document-boundary-failure',
    });
    const current = {
      phase: 'measurement-boundary-render-wait',
      renderBoundaryProgressBinding: {
        ownerId: binding.ownerId,
        status: 'ready',
        setupTimeoutMs: 5000,
        setupElapsedMs: binding.setupElapsedMs,
        cleanup: null,
      },
    };
    try {
      await observeRenderBoundary({
        label: 'measurement boundary',
        timeoutMs: 5,
        hostGraceMs: 0,
        progressBinding: binding,
        evaluate: () => new Promise(() => {}),
        onProgress: (observation) => {
          current.measurementBoundaryObservation = observation;
        },
      });
      assert.fail('Expected boundary timeout.');
    } catch (error) {
      current.renderBoundaryProgressBinding.cleanup = await binding.dispose();
      current.renderBoundaryProgressBinding.status = 'disposed';
      const report = createCaptureFailureReport({
        phase: current.phase,
        error,
        current,
      });
      assert.equal(
        report.progress.current.renderBoundaryProgressBinding.ownerId,
        binding.ownerId,
      );
      assert.equal(
        report.progress.current.renderBoundaryProgressBinding.cleanup.removed,
        true,
      );
      assert.equal(
        report.progress.current.measurementBoundaryObservation.status,
        'host-observation-deadline',
      );
    }
  });
});
