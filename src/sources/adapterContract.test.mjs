import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSourceAdapter,
  runSourceAdapterConformance,
} from './adapterContract.js';
import { createSyntheticSourceAdapter } from './syntheticAdapter.js';

test('synthetic source adapter passes the public conformance checks with provenance and retention policy', async () => {
  const report = await runSourceAdapterConformance(
    createSyntheticSourceAdapter({ now: () => 10_000 }),
  );
  assert.deepEqual(report, {
    id: 'synthetic-example',
    count: 2,
    cancelled: true,
  });
});

test('source adapters reject malformed coordinates and fail conformance when cancellation is ignored', async () => {
  const malformed = createSourceAdapter({
    id: 'bad-source',
    label: 'Bad fixture',
    acquire: async () => ({ observations: [{ id: 'bad', lat: 92, lon: 0 }] }),
  });
  await assert.rejects(malformed.read(), /coordinates/);
  const ignoresCancellation = {
    id: 'ignores-cancel',
    capabilities: { temporalModes: ['live'] },
    retention: { record: false, export: false },
    read: async () => ({ observations: [] }),
  };
  await assert.rejects(
    runSourceAdapterConformance(ignoresCancellation),
    /ignored/,
  );
});
