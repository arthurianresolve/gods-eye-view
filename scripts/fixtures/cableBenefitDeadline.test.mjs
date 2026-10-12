import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPostRenderUntil } from './cableDeadline.mjs';

test('waits only for the remaining absolute frame deadline', async () => {
  const viewer = { identity: 'fixture-viewer' };
  let observed = null;
  const result = await waitForPostRenderUntil(
    viewer,
    180_000,
    () => 1_250,
    async (actualViewer, timeoutMs) => {
      observed = { actualViewer, timeoutMs };
      return 'rendered';
    },
  );

  assert.equal(result, 'rendered');
  assert.deepEqual(observed, { actualViewer: viewer, timeoutMs: 178_750 });
});

test('does not schedule a render wait after the absolute deadline', async () => {
  let scheduled = false;
  await assert.rejects(
    waitForPostRenderUntil(
      {},
      1_000,
      () => 1_000,
      async () => {
        scheduled = true;
      },
    ),
    /deadline expired/,
  );
  assert.equal(scheduled, false);
});
