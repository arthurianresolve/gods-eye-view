import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceDocument, parseWorkspaceDocument } from './document.js';

function workspace(overrides = {}) {
  return {
    id: 'investigation-taipei',
    title: 'Taipei activity',
    createdAt: 1000,
    updatedAt: 2000,
    view: {
      camera: { lat: 25.03, lon: 121.56, altitude_m: 100_000 },
      layers: ['earthquakes', 'flights'],
    },
    filters: { region: 'Taipei' },
    pinnedEvidence: [
      {
        id: 'event-42',
        sourceId: 'earthquakes',
        capturedAt: 1500,
        record: {
          magnitude: 4.2,
          latitude: 25,
          longitude: 121,
          evidence: {
            references: [
              {
                kind: 'archive',
                url: 'https://web.archive.org/web/20260101000000/https://example.test',
                originalUrl: 'https://example.test',
                archiveAt: 1767225600000,
                lookedUpAt: 1767225601000,
                title: 'Internet Archive capture',
              },
            ],
          },
        },
      },
    ],
    annotations: [{ type: 'label', target: 'Taipei' }],
    assetRefs: [{ id: 'asset-1', sha256: 'a'.repeat(64), byteLength: 2048 }],
    directorProjectRef: 'project-taipei',
    ...overrides,
  };
}

test('direct pinned envelopes cannot bypass reference import validation', () => {
  const input = JSON.parse(
    JSON.stringify(createWorkspaceDocument(workspace())),
  );
  input.pinnedEvidence[0].record = {
    entityRef: { layerKey: 'fixture', id: 'one' },
    references: [{ kind: 'user-linked', url: 'https://localhost./private' }],
  };
  assert.throws(() => parseWorkspaceDocument(JSON.stringify(input)), /unsafe/);
});

test('workspace documents normalize the saved view and preserve stable evidence references', () => {
  const document = createWorkspaceDocument(workspace());
  assert.equal(document.kind, 'investigation-workspace');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.revision, 1);
  assert.deepEqual(document.view.layers, ['earthquakes', 'flights']);
  assert.deepEqual(document.annotations, [{ type: 'label', target: 'Taipei' }]);
  assert.equal(document.pinnedEvidence[0].id, 'event-42');
  assert.equal(
    document.pinnedEvidence[0].record.evidence.references[0].kind,
    'archive',
  );
  assert.equal(document.assetRefs[0].sha256, 'a'.repeat(64));
  assert.deepEqual(parseWorkspaceDocument(JSON.stringify(document)), document);
});

test('workspace documents reject unsafe references, invalid views, future schemas, and excessive payloads', () => {
  assert.throws(
    () => createWorkspaceDocument(workspace({ id: '../escape' })),
    /Invalid workspace id/,
  );
  assert.throws(
    () => createWorkspaceDocument(workspace({ view: {} })),
    /Saved view is invalid/,
  );
  assert.throws(
    () => createWorkspaceDocument(workspace({ schemaVersion: 99 })),
    { code: 'unsupported-version' },
  );
  assert.throws(
    () =>
      createWorkspaceDocument(
        workspace({
          pinnedEvidence: [
            { id: 'dup', sourceId: 'a', capturedAt: 1 },
            { id: 'dup', sourceId: 'b', capturedAt: 2 },
          ],
        }),
      ),
    /IDs must be unique/,
  );
  assert.throws(
    () =>
      createWorkspaceDocument(
        workspace({
          assetRefs: [{ id: '../x', sha256: 'a'.repeat(64), byteLength: 1 }],
        }),
      ),
    /integrity metadata/,
  );
  assert.throws(
    () =>
      createWorkspaceDocument(
        workspace({
          pinnedEvidence: [
            {
              ...workspace().pinnedEvidence[0],
              record: {
                evidence: {
                  references: [
                    { kind: 'archive', url: 'http://127.0.0.1/private' },
                  ],
                },
              },
            },
          ],
        }),
      ),
    /unsafe URL or kind/,
  );
  assert.throws(
    () =>
      parseWorkspaceDocument({
        ...createWorkspaceDocument(workspace()),
        privateRuntimeObject: true,
      }),
    /unsupported fields/,
  );
});

test('an unversioned draft migrates and arbitrary class instances are not persisted', () => {
  const migrated = parseWorkspaceDocument(
    {
      schemaVersion: 0,
      id: 'legacy-view',
      title: 'Legacy view',
      view: { camera: { lat: 0, lon: 0 } },
    },
    { now: () => 3000 },
  );
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.createdAt, 3000);
  assert.deepEqual(migrated.filters, {});
  class CesiumLike {
    constructor() {
      this.x = 1;
    }
  }
  assert.throws(
    () =>
      createWorkspaceDocument(
        workspace({ filters: { runtime: new CesiumLike() } }),
      ),
    /plain JSON data/,
  );
});

test('versioned documents require a complete internally consistent snapshot', () => {
  const document = createWorkspaceDocument(workspace());
  const missingField = { ...document };
  delete missingField.temporalSource;
  assert.throws(
    () => parseWorkspaceDocument(missingField),
    /missing required fields/,
  );
  assert.throws(
    () => parseWorkspaceDocument({ ...document, temporalSource: 'recording' }),
    /does not match its saved view/,
  );
  assert.throws(
    () => createWorkspaceDocument(workspace({ updatedAt: 999 })),
    /cannot precede creation time/,
  );
});
