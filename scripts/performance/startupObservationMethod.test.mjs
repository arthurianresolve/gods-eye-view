import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStartupObservationMode } from './startupObservationMethod.mjs';

test('page-observed startup method is opt-in only for non-attribution startup shards', () => {
  assert.equal(assertStartupObservationMode({ enabled: false }), false);
  assert.equal(
    assertStartupObservationMode({ enabled: true, startupOnlyShard: true }),
    true,
  );
  assert.throws(
    () => assertStartupObservationMode({ enabled: true }),
    /requires --startup-only-shard/,
  );
  assert.throws(
    () =>
      assertStartupObservationMode({
        enabled: true,
        startupOnlyShard: true,
        startupAttributionEnabled: true,
      }),
    /cannot be combined with --startup-attribution/,
  );
});
