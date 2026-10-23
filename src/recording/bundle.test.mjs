import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  createRecordingBundle,
  importRecordingBundle,
  parseRecordingBundle,
  recordingBundleStream,
} from './bundle.js';

function recording(overrides = {}) {
  return {
    format: 'gods-eye-view-aircraft-recording',
    schemaVersion: 1,
    document: {
      id: 'aircraft-run',
      kind: 'aircraft-recording',
      schemaVersion: 1,
      title: 'Aircraft run',
      status: 'complete',
      sourcePolicy: {
        policyId: 'fixture-approved-v1',
        retentionAllowed: true,
        exportAllowed: true,
      },
      ...overrides.document,
    },
    chunks: {
      'observations-000000': [
        {
          observationId: 'A12345@1000',
          entityId: 'A12345',
          observedAt: 1000,
          latitude: 1,
          longitude: 2,
          method: 'observed',
        },
      ],
      gaps: [],
      ...overrides.chunks,
    },
  };
}

test('recording bundles stream in bounded pieces and verify chunk plus manifest hashes', async () => {
  const bundle = await createRecordingBundle(recording(), {
    crypto: webcrypto,
  });
  const response = new Response(recordingBundleStream(bundle));
  const text = await response.text();
  const restored = await parseRecordingBundle(text, { crypto: webcrypto });
  assert.equal(restored.document.id, 'aircraft-run');
  assert.equal(restored.kind, 'aircraft-recording');
  assert.deepEqual(restored.chunks.gaps, []);
  assert.equal(restored.chunks['observations-000000'][0].observedAt, 1000);

  const tampered = JSON.parse(text);
  tampered.chunks.find(
    (entry) => entry.name === 'observations-000000',
  ).value[0].latitude = 80;
  await assert.rejects(parseRecordingBundle(tampered, { crypto: webcrypto }), {
    code: 'integrity',
  });
  await assert.rejects(
    parseRecordingBundle(text.slice(0, -8), { crypto: webcrypto }),
    { code: 'invalid-bundle' },
  );
});

test('bundle creation refuses recordings without a complete export policy and enforces the byte budget', async () => {
  await assert.rejects(
    createRecordingBundle(
      recording({ document: { sourcePolicy: { exportAllowed: false } } }),
      { crypto: webcrypto },
    ),
    { code: 'recording-policy' },
  );
  await assert.rejects(
    createRecordingBundle(recording(), { crypto: webcrypto, maxBytes: 4 }),
    { code: 'recording-too-large' },
  );
  await assert.rejects(
    createRecordingBundle(recording({ document: { status: 'active' } }), {
      crypto: webcrypto,
    }),
    { code: 'recording-policy' },
  );
});

test('import validates before committing and creates a distinct revisioned workspace', async () => {
  const bundle = await createRecordingBundle(recording(), {
    crypto: webcrypto,
  });
  let committed = null;
  const storage = {
    async commitWorkspace(value) {
      committed = value;
      return { saved: true, revision: 1 };
    },
  };
  const imported = await importRecordingBundle(bundle, {
    storage,
    id: 'imported-aircraft-run',
    now: () => 2000,
    crypto: webcrypto,
  });
  assert.equal(imported.id, 'imported-aircraft-run');
  assert.equal(imported.kind, 'aircraft-recording');
  assert.equal(committed.expectedRevision, 0);
  assert.equal(committed.document.id, imported.id);
  assert.equal(committed.document.importedAt, 2000);
  assert.equal(committed.chunks['observations-000000'][0].entityId, 'A12345');

  const broken = {
    ...bundle,
    manifest: { ...bundle.manifest, sha256: '0'.repeat(64) },
  };
  committed = null;
  await assert.rejects(
    importRecordingBundle(broken, { storage, crypto: webcrypto }),
    { code: 'integrity' },
  );
  assert.equal(committed, null, 'corrupt data never reaches storage');
});
