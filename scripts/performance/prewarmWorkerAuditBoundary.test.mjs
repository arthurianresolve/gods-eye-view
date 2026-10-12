import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWorkerAuditAtWarmupBoundary,
  readProviderWarmupBoundarySnapshot,
  PREWARM_WORKER_AUDIT_BOUNDARY,
} from './prewarmWorkerAuditBoundary.mjs';
import { evaluateCompletedRenderDiagnostic } from './settleCompletedRenderDiagnostic.mjs';
import { observeRenderBoundary } from './renderBoundaryObservation.mjs';
import {
  holdProviderWarmupBoundary,
  installPhasedMonotonicWallClock,
} from './productionFlightFixture.mjs';

const warmupBoundary = { phase: 'warmup-held', elapsedMs: 1000 };
const completedRender = { settleElapsedMs: 2.5 };
const validAudit = {
  inventory: { status: 'receipt-derived-worker-blobs-validated' },
  documentAudit: { validation: { status: 'passed' } },
};

test('orchestrated prewarm audit follows warmup and completed-render callbacks', async () => {
  const events = [];
  const result = await runWorkerAuditAtWarmupBoundary({
    auditMode: 'prewarm',
    warmupMs: 1000,
    readWarmupBoundary: async () => {
      events.push('warmup-complete');
      return warmupBoundary;
    },
    settleCompletedRender: async (boundary) => {
      assert.equal(boundary, warmupBoundary);
      events.push('completed-render');
      return completedRender;
    },
    audit: async () => {
      events.push('atomic-worker-audit');
      return validAudit;
    },
  });
  assert.deepEqual(events, [
    'warmup-complete',
    'completed-render',
    'atomic-worker-audit',
  ]);
  assert.deepEqual(result.timingBoundary, {
    phase: PREWARM_WORKER_AUDIT_BOUNDARY,
    configuredWarmupMs: 1000,
    fixtureClockElapsedMs: 1000,
    completedRenderSettleMs: 2.5,
  });
  assert.equal(result.warmupBoundary, warmupBoundary);
  assert.equal(result.completedRender, completedRender);
});

test('prewarm audit fails closed before body reads when warmup or render boundary is incomplete', async () => {
  let auditCalls = 0;
  const audit = async () => {
    auditCalls++;
    return validAudit;
  };
  for (const input of [
    { warmupBoundary: { phase: 'setup', elapsedMs: 1000 } },
    { warmupBoundary: { phase: 'warmup-held', elapsedMs: 999 } },
    { completedRender: null },
    { completedRender: { settleElapsedMs: null } },
  ]) {
    await assert.rejects(
      runWorkerAuditAtWarmupBoundary({
        auditMode: 'prewarm',
        warmupMs: 1000,
        readWarmupBoundary: async () => input.warmupBoundary ?? warmupBoundary,
        settleCompletedRender: async () =>
          input.completedRender === undefined
            ? completedRender
            : input.completedRender,
        audit,
      }),
      /declared warmup and a completed boundary render/,
    );
  }
  assert.equal(auditCalls, 0);
});

test('diagnostic worker auditing stays outside the prewarm timing contract', async () => {
  let auditCalls = 0;
  const events = [];
  const result = await runWorkerAuditAtWarmupBoundary({
    auditMode: 'diagnostic',
    warmupMs: 1000,
    readWarmupBoundary: async () => {
      events.push('warmup-complete');
      return null;
    },
    settleCompletedRender: async () => {
      events.push('completed-render');
      return null;
    },
    audit: async () => {
      auditCalls++;
      return validAudit;
    },
  });
  assert.deepEqual(events, ['warmup-complete', 'completed-render']);
  assert.equal(result.timingBoundary, null);
  assert.equal(auditCalls, 0);
});

test('a worker audit validation failure remains a failure at the warmup boundary', async () => {
  await assert.rejects(
    runWorkerAuditAtWarmupBoundary({
      auditMode: 'prewarm',
      warmupMs: 1000,
      readWarmupBoundary: async () => warmupBoundary,
      settleCompletedRender: async () => completedRender,
      audit: async () => ({
        inventory: null,
        documentAudit: { validation: null },
      }),
    }),
    /no validated prewarm worker set/,
  );
});

test('an incomplete render rejects without reading worker bodies', async () => {
  let auditCalls = 0;
  await assert.rejects(
    runWorkerAuditAtWarmupBoundary({
      auditMode: 'prewarm',
      warmupMs: 1000,
      readWarmupBoundary: async () => warmupBoundary,
      settleCompletedRender: async () => {
        throw new Error('render boundary timed out');
      },
      audit: async () => {
        auditCalls++;
        return validAudit;
      },
    }),
    /render boundary timed out/,
  );
  assert.equal(auditCalls, 0);
});

test('prewarm audit follows an atomic serialized provider clock/render boundary', async () => {
  let monotonicNow = 10;
  const trace = [];
  const target = {
    Date,
    performance: { now: () => monotonicNow },
    window: null,
  };
  target.window = target;
  installPhasedMonotonicWallClock(
    Date.parse('2026-10-08T12:00:00.000Z'),
    1000,
    1000,
    target,
  );
  target.__gevPhasedMonotonicWallClockV1.startWarmup();
  monotonicNow += 1100;

  const handlers = new Set();
  const viewer = {
    scene: {
      postRender: {
        addEventListener(handler) {
          trace.push('listener-registered');
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
      requestRender() {
        trace.push(
          `request-${target.__gevPhasedMonotonicWallClockV1.snapshot().phase}`,
        );
        queueMicrotask(() => {
          trace.push('post-render');
          for (const handler of [...handlers]) handler();
        });
      },
    },
  };
  target.__godsEyeView = { viewer };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousView = Object.getOwnPropertyDescriptor(
    globalThis,
    '__godsEyeView',
  );
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
        return pageFunction(...JSON.parse(JSON.stringify(args)));
      },
    };
    let boundaryResult;
    const result = await runWorkerAuditAtWarmupBoundary({
      auditMode: 'prewarm',
      warmupMs: 1000,
      readWarmupBoundary: async () => {
        // The clock hold, listener install, and render request occur inside the
        // same page callback. The next orchestration step only consumes it.
        boundaryResult = await observeRenderBoundary({
          label: 'atomic prewarm boundary',
          timeoutMs: 100,
          evaluate: (pageTimeoutMs, binding) =>
            evaluateCompletedRenderDiagnostic(targetPage, pageTimeoutMs, {
              ...binding,
              beforeRenderRequestFunction: holdProviderWarmupBoundary,
              beforeRenderRequestArgs: [1000],
            }),
        });
        assert.equal(boundaryResult.status, 'settled');
        return readProviderWarmupBoundarySnapshot(boundaryResult);
      },
      settleCompletedRender: async () => boundaryResult,
      audit: async () => {
        trace.push('worker-audit');
        return validAudit;
      },
    });
    assert.equal(result.warmupBoundary.phase, 'warmup-held');
    assert.deepEqual(trace, [
      'listener-registered',
      'request-warmup-held',
      'post-render',
      'worker-audit',
    ]);
    assert.equal(handlers.size, 0);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousView)
      Object.defineProperty(globalThis, '__godsEyeView', previousView);
    else delete globalThis.__godsEyeView;
  }
});
