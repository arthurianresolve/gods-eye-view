import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWorkerAuditAtWarmupBoundary,
  PREWARM_WORKER_AUDIT_BOUNDARY,
} from './prewarmWorkerAuditBoundary.mjs';

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
