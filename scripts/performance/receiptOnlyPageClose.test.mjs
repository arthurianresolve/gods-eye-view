import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeReceiptOnlyAuditPage,
  isReceiptOnlyTargetAlreadyAbsentError,
} from './receiptOnlyPageClose.mjs';

test('receipt-only close accepts Chrome confirmation that the target is absent', async () => {
  const result = await closeReceiptOnlyAuditPage({
    isClosed: () => false,
    async close() {
      throw new Error(
        'Protocol error (Target.closeTarget): No target with given id found',
      );
    },
  });
  assert.deepEqual(result, {
    status: 'target-already-absent',
    confirmed: true,
  });
});

test('receipt-only close remains strict for unrelated close failures', async () => {
  const failure = new Error('Protocol error (Target.closeTarget): timed out');
  await assert.rejects(
    closeReceiptOnlyAuditPage({
      isClosed: () => false,
      async close() {
        throw failure;
      },
    }),
    failure,
  );
});

test('receipt-only close confirms normal and previously closed targets', async () => {
  let closed = false;
  const normal = await closeReceiptOnlyAuditPage({
    isClosed: () => closed,
    async close() {
      closed = true;
    },
  });
  assert.deepEqual(normal, { status: 'closed', confirmed: true });

  const previous = await closeReceiptOnlyAuditPage({
    isClosed: () => true,
    async close() {
      assert.fail('already closed page must not be closed again');
    },
  });
  assert.deepEqual(previous, {
    status: 'already-closed',
    confirmed: true,
  });
});

test('target absence classifier requires the exact Chrome protocol response', () => {
  assert.equal(
    isReceiptOnlyTargetAlreadyAbsentError(
      new Error(
        'Protocol error (Target.closeTarget): No target with given id found',
      ),
    ),
    true,
  );
  assert.equal(
    isReceiptOnlyTargetAlreadyAbsentError(
      new Error('No target with given id found'),
    ),
    false,
  );
});
