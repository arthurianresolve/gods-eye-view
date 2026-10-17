import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteraction } from './interaction.js';
import { createRendering } from './rendering.js';
import { createIngestion } from './ingestion.js';
import { createState } from './state.js';

test('release drops active pick mappings while old Cesium objects remain inert', () => {
  const state = {
    _pickByEntity: new WeakMap(),
    _enabled: true,
    _loaded: true,
    _cableDataSource: {},
    _landingDataSource: {},
    _referenceDataSource: {},
    _referenceRecords: [],
    _featureRecords: [],
    _surfaceRecords: [],
    _referenceLabelCount: 0,
    _publishScratch: [],
    _markerBlendDone: true,
    _referenceSweepGate: { reset() {} },
  };
  const interaction = createInteraction({
    state,
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  const entity = { id: 'cable-reference-0-cable/17' };
  const info = Object.freeze({
    identity: 'cable:cable/17',
    kind: 'cable',
    reference: Object.freeze({ lon: -31.2, lat: 42.1 }),
  });

  interaction.registerPickEntity(entity, info);
  state._featureRecords.push(info);
  assert.equal(interaction.resolvePickRecord({ primitive: entity }), info);
  assert.equal(interaction.resolvePickRecord({ id: entity }), info);

  // Release removes datasource ownership and replaces the active WeakMap.
  // The old entity can still be held by a test/picker but no longer resolves.
  const removed = [];
  createRendering({ state }).releaseDataSources({
    dataSources: {
      remove(source) {
        removed.push(source);
      },
    },
  });
  assert.equal(removed.length, 3);
  assert.deepEqual(state._featureRecords, []);
  assert.equal(interaction.resolvePickRecord({ primitive: entity }), null);
  assert.equal(interaction.resolvePickRecord({ id: entity }), null);
});

test('unregistered pick-like expandos cannot bypass active identity ownership', () => {
  const state = { _pickByEntity: new WeakMap() };
  const interaction = createInteraction({ state });
  const stale = {
    __gevTeleGeography: {
      kind: 'cable',
      reference: { lon: 1, lat: 2 },
    },
  };

  assert.equal(interaction.resolvePickRecord({ primitive: stale }), null);
  assert.equal(interaction.resolvePickRecord({ id: stale }), null);
});

test('post-add identity failure rolls back sources and retry rebuilds the same record', async () => {
  const overlayHost = {
    clearSource() {},
    setEntries() {},
    setVisible() {},
  };
  const state = createState({ sweepClock: () => 0, overlayHost });
  state._enabled = true;
  const parts = {};
  parts.rendering = createRendering({ state });
  parts.interaction = createInteraction({ state });
  let injectFailure = true;
  const styleCableEntity = parts.rendering.styleCableEntity;
  parts.rendering.styleCableEntity = (...args) => {
    if (injectFailure) throw new Error('injected post-add styling failure');
    return styleCableEntity(...args);
  };

  const sources = [];
  const viewer = {
    dataSources: {
      async add(source) {
        sources.push(source);
        return source;
      },
      remove(source) {
        const index = sources.indexOf(source);
        if (index >= 0) sources.splice(index, 1);
        return index >= 0;
      },
    },
    scene: { requestRender() {} },
  };
  const source = {
    label: 'identity-test',
    async fetch() {
      return {
        cables: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'cable-77',
              properties: { id: 'cable-77', name: 'Cable 77' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-40, 35],
                  [-30, 40],
                ],
              },
            },
          ],
        },
        landingPoints: { type: 'FeatureCollection', features: [] },
      };
    },
  };
  const ingestion = createIngestion({ state, parts, source });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await ingestion.load(viewer);
  } finally {
    console.warn = originalWarn;
  }
  assert.match(state._error, /injected post-add styling failure/);
  assert.equal(sources.length, 0, 'all accepted sources were rolled back');
  assert.deepEqual(state._featureRecords, []);
  assert.deepEqual(state._referenceRecords, []);
  assert.equal(state._pickByEntity.has({}), false);

  injectFailure = false;
  state._error = null;
  await ingestion.load(viewer);
  assert.equal(state._error, null);
  assert.equal(state._featureRecords.length, 1);
  assert.equal(state._featureRecords[0].identity, 'cable:cable-77');
  const oldSourceEntity = state._cableDataSource.entities.values[0];
  assert.equal(
    parts.interaction.resolvePickRecord({ id: oldSourceEntity }).identity,
    'cable:cable-77',
  );

  parts.rendering.releaseDataSources(viewer);
  assert.equal(sources.length, 0);
  assert.deepEqual(state._featureRecords, []);
  assert.equal(
    parts.interaction.resolvePickRecord({ id: oldSourceEntity }),
    null,
  );

  await ingestion.load(viewer);
  assert.equal(state._error, null);
  assert.equal(state._featureRecords[0].identity, 'cable:cable-77');
  parts.rendering.releaseDataSources(viewer);
});
