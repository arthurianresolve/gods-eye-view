import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createWorkspaceStorage } from '../storage/index.js';
import { createDirectorPersistence } from './persistence.js';

function fixture() {
  const storage = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
  });
  const persistence = createDirectorPersistence({ storage, crypto: webcrypto });
  const bytes = new Uint8Array([123, 125]);
  const project = {
    version: 6,
    scenes: [
      {
        id: 'scene-one',
        title: 'Scene one',
        releaseLayerIds: [],
        appliedShotPacks: [],
        anchors: [],
        dataPacks: [
          {
            id: 'pack-one',
            version: 1,
            format: 'geojson',
            source: {
              adapter: 'scene-bundle',
              path: 'files/observations.json',
            },
            attribution: { text: 'Local', license: 'CC0' },
            placement: { altitudeReference: 'ellipsoid' },
            byteLength: 2,
            sha256:
              '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
          },
        ],
        shots: [],
      },
    ],
  };
  const bundleAssets = new Map([
    ['files/observations.json', { bytes, mimeType: 'application/json' }],
  ]);
  return { storage, persistence, project, bytes, bundleAssets };
}

test('Director scene and bundled bytes persist by content digest and reload after service recreation', async (t) => {
  const { storage, persistence, project, bytes, bundleAssets } = fixture();
  t.after(() => storage.destroy());
  const saved = await persistence.save(project, bundleAssets);
  assert.equal(saved.revision, 1);
  assert.equal(saved.assetCount, 1);
  const loaded = await createDirectorPersistence({
    storage,
    crypto: webcrypto,
  }).load();
  assert.deepEqual(loaded.project.scenes[0].dataPacks[0].source, {
    adapter: 'scene-bundle',
    path: 'files/observations.json',
  });
  assert.deepEqual(
    [...loaded.assets.get('files/observations.json').bytes],
    [...bytes],
  );
  assert.equal(
    loaded.assets.get('files/observations.json').mimeType,
    'application/json',
  );
});

test('shared content remains addressable when one pack is removed and orphaned bytes leave the next revision', async (t) => {
  const { storage, persistence, project, bundleAssets } = fixture();
  t.after(() => storage.destroy());
  const shared = structuredClone(project);
  shared.scenes[0].dataPacks[0].source.path = 'files/first.json';
  shared.scenes.push({
    ...structuredClone(shared.scenes[0]),
    id: 'scene-two',
    title: 'Scene two',
  });
  shared.scenes[1].dataPacks[0].source.path = 'files/second.json';
  const sameBytes = bundleAssets.get('files/observations.json');
  const sharedAssets = new Map([
    ['files/first.json', sameBytes],
    ['files/second.json', sameBytes],
  ]);
  await persistence.save(shared, sharedAssets);
  const oneScene = structuredClone(shared);
  oneScene.scenes.splice(0, 1);
  await persistence.save(oneScene, sharedAssets);
  const loaded = await persistence.load();
  assert.equal(loaded.project.scenes.length, 1);
  assert.equal(loaded.assets.size, 1);
  assert.ok(loaded.assets.has('files/second.json'));
  const noPacks = structuredClone(oneScene);
  noPacks.scenes[0].dataPacks = [];
  const pruned = await persistence.save(noPacks, new Map());
  assert.equal(pruned.assetCount, 0);
  assert.equal((await persistence.load()).assets.size, 0);
});

test('missing and modified bundle data block a complete save or restore', async (t) => {
  const { storage, persistence, project, bundleAssets } = fixture();
  t.after(() => storage.destroy());
  await assert.rejects(persistence.save(project, new Map()), {
    code: 'missing-asset',
  });
  await persistence.save(project, bundleAssets);
  const altered = new Uint8Array([0, 1]);
  await assert.rejects(
    persistence.save(
      project,
      new Map([
        [
          'files/observations.json',
          {
            bytes: altered,
            mimeType: 'application/json',
          },
        ],
      ]),
    ),
    { code: 'integrity' },
  );
});
