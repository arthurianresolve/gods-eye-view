import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createIngestion } from './ingestion.js';
import { readFileSync } from 'node:fs';
import { createState } from './state.js';
import { createRendering } from './rendering.js';
import { createInteraction } from './interaction.js';

test('ingestion applies source records to every expanded segment without flattening Entity IDs', async () => {
  const cables = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'shared',
        properties: {
          id: 'shared',
          name: 'North cable',
          __gev_cable_source_ordinal_v1: 'provider value',
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-40, 10],
              [-39, 11],
            ],
            [
              [-38, 12],
              [-37, 13],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'shared',
        properties: { id: 'shared', name: 'South cable' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [20, -10],
            [21, -11],
          ],
        },
      },
    ],
  };
  const landingPoints = { type: 'FeatureCollection', features: [] };
  const state = {
    _loading: false,
    _loaded: false,
    _loadGeneration: 0,
    _enabled: false,
    _cachedCableJson: cables,
    _cachedLandingJson: landingPoints,
    cableColor: Cesium.Color.CYAN,
    landingColor: Cesium.Color.YELLOW,
    _overlayPublisher: { show() {}, hide() {} },
    _referenceSweepGate: { markDirty() {} },
  };
  const styled = [];
  const stems = [];
  const registered = new Map();
  const parts = {
    rendering: {
      styleCableEntity(entity, feature) {
        styled.push({ entity, name: feature.properties.name });
      },
      styleLandingEntity(entity, feature) {
        styled.push({ entity, name: feature.properties.name });
      },
      addReferenceStem(value) {
        stems.push(value);
      },
      updateVisibility() {},
      resetPublishSignature() {},
      releaseDataSources() {},
    },
    interaction: {
      registerPickEntity(entity, record) {
        registered.set(entity, record);
      },
    },
  };
  const source = {
    label: 'fixture',
    async fetch() {
      return { cables, landingPoints };
    },
  };
  const viewer = {
    dataSources: {
      async add(dataSource) {
        return dataSource;
      },
      remove() {},
    },
    scene: { requestRender() {} },
  };

  await createIngestion({ state, parts, source }).load(viewer);
  try {
    const cableEntities = state._cableDataSource.entities.values;
    assert.deepEqual(
      cableEntities.map((entity) => entity.id),
      ['shared', 'shared_2', 'shared_3'],
      'Cesium keeps its native duplicate-ID suffixing for expanded parts',
    );
    assert.deepEqual(
      styled.map(({ entity, name }) => [entity.id, name]),
      [
        ['shared', 'North cable'],
        ['shared_2', 'North cable'],
        ['shared_3', 'South cable'],
      ],
    );
    assert.deepEqual(
      state._featureRecords.map((record) => record.label),
      ['North cable', 'South cable'],
      'one source record is retained per original GeoJSON feature',
    );
    assert.deepEqual(
      stems.map(({ kind, label }) => [kind, label]),
      [
        ['cable', 'North cable'],
        ['cable', 'South cable'],
      ],
      'each source feature gets one reference stem regardless of segment count',
    );
    assert.equal(state._surfaceRecords.length, 3);
    assert.equal(registered.size, 3);
    assert.equal(
      cableEntities[1].properties.getValue().__gev_cable_source_ordinal_v1,
      'provider value',
    );
    assert.deepEqual(cables.features[0].properties, {
      id: 'shared',
      name: 'North cable',
      __gev_cable_source_ordinal_v1: 'provider value',
    });
    assert.equal(registered.get(cableEntities[1]).label, 'North cable');
    assert.equal(registered.get(cableEntities[2]).label, 'South cable');
    for (const entity of cableEntities) {
      assert.equal(
        entity.properties.hasProperty('__gev_cable_source_ordinal_v1_1'),
        false,
      );
    }
  } finally {
    state._cableDataSource?.entities.removeAll();
    state._landingDataSource?.entities.removeAll();
  }
});

function failureHarness() {
  const cables = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'cable',
        properties: { name: 'Cable' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    ],
  };
  const landingPoints = { type: 'FeatureCollection', features: [] };
  const state = {
    _loadGeneration: 0,
    _cachedCableJson: cables,
    _cachedLandingJson: landingPoints,
    cableColor: Cesium.Color.CYAN,
    landingColor: Cesium.Color.YELLOW,
    _overlayPublisher: { show() {}, hide() {} },
    _referenceSweepGate: { markDirty() {} },
  };
  const added = [];
  const viewer = {
    dataSources: {
      async add(ds) {
        added.push(ds);
        return ds;
      },
      remove() {},
    },
    scene: { requestRender() {} },
  };
  const parts = {
    rendering: {
      styleCableEntity() {},
      styleLandingEntity() {},
      addReferenceStem() {},
      updateVisibility() {},
      resetPublishSignature() {},
      releaseDataSources() {},
    },
    interaction: { registerPickEntity() {} },
  };
  const ingestion = createIngestion({
    state,
    parts,
    source: { label: 'fixture' },
  });
  return { state, viewer, added, load: () => ingestion.load(viewer) };
}

for (const boundary of [0, 1]) {
  test(
    'abort at GeoJSON load boundary ' +
      boundary +
      ' removes transient fields without publishing stale sources',
    async (t) => {
      const env = failureHarness();
      const original = Cesium.GeoJsonDataSource.load;
      const calls = [];
      const reached = Promise.withResolvers();
      const release = Promise.withResolvers();
      t.mock.method(Cesium.GeoJsonDataSource, 'load', async (json, options) => {
        const call = { json, ds: await original(json, options) };
        calls.push(call);
        if (calls.length - 1 === boundary) {
          reached.resolve();
          await release.promise;
        }
        return call.ds;
      });
      const pending = env.load();
      await reached.promise;
      env.state._abort.abort();
      const successorAbort = new AbortController();
      env.state._loadGeneration += 1;
      env.state._abort = successorAbort;
      env.state._loading = true;
      release.resolve();
      await pending;
      assert.equal(env.added.length, 0);
      assert.equal(calls.length, boundary + 1);
      assert.equal(env.state._abort, successorAbort);
      assert.equal(
        env.state._loading,
        true,
        'a stale completion cannot clear successor ownership',
      );
      assert.equal(env.state._error, null);
      for (const { json, ds } of calls) {
        for (const feature of json.features)
          assert.deepEqual(Object.keys(feature.properties), ['name']);
        for (const entity of ds.entities.values) {
          assert.deepEqual(entity.properties.propertyNames, ['name']);
          assert.doesNotMatch(
            entity.description.getValue(Cesium.JulianDate.MINIMUM_VALUE),
            /__gev_cable_source_ordinal/,
          );
        }
        ds.entities.removeAll();
      }
    },
  );
}

for (const failure of ['load rejection', 'invalid source ordinal']) {
  test(failure + ' clears temporary metadata before retry', async (t) => {
    const env = failureHarness();
    const original = Cesium.GeoJsonDataSource.load;
    const calls = [];
    t.mock.method(console, 'warn', () => {});
    const replacement = t.mock.method(
      Cesium.GeoJsonDataSource,
      'load',
      async (json, options) => {
        const call = { json };
        calls.push(call);
        if (failure === 'load rejection')
          throw new Error('injected load failure');
        call.ds = await original(json, options);
        call.ds.entities.values[0].properties.__gev_cable_source_ordinal_v1 = 999;
        return call.ds;
      },
    );
    await env.load();
    assert.match(
      env.state._error,
      failure === 'load rejection'
        ? /injected load failure/
        : /invalid source ordinal/,
    );
    assert.equal(
      env.added.length,
      0,
      'invalid binding cannot publish a data source',
    );
    assert.equal(env.state._loaded, false);
    for (const { json, ds } of calls) {
      for (const feature of json.features)
        assert.deepEqual(Object.keys(feature.properties), ['name']);
      for (const entity of ds?.entities.values || [])
        assert.deepEqual(entity.properties.propertyNames, ['name']);
      ds?.entities.removeAll();
    }
    replacement.mock.restore();
    await env.load();
    assert.equal(env.state._error, null);
    assert.equal(env.state._loaded, true);
    assert.equal(env.added.length, 3);
    env.state._cableDataSource.entities.removeAll();
    env.state._landingDataSource.entities.removeAll();
  });
}

test('all bundled cable segments receive their actual source style and active pick record', async () => {
  const cables = JSON.parse(
    readFileSync(
      new URL(
        '../../data/local_data/telegeography_submarine_cables/cable-geo.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const state = createState({
    sweepClock: () => 0,
    overlayHost: { clearSource() {}, setEntries() {}, setVisible() {} },
  });
  const parts = {
    rendering: createRendering({ state }),
    interaction: createInteraction({ state }),
  };
  const source = {
    label: 'bundled fixture',
    async fetch() {
      return {
        cables,
        landingPoints: { type: 'FeatureCollection', features: [] },
      };
    },
  };
  const attached = new Set();
  const viewer = {
    dataSources: {
      async add(ds) {
        attached.add(ds);
        return ds;
      },
      remove(ds) {
        return attached.delete(ds);
      },
    },
    scene: { requestRender() {} },
  };
  await createIngestion({ state, parts, source }).load(viewer);
  try {
    assert.equal(state._error, null);
    assert.equal(state._count, 712);
    assert.equal(state._featureRecords.length, 712);
    assert.equal(state._referenceRecords.length, 712);
    assert.equal(state._surfaceRecords.length, 1913);
    const sourceRecords = new Set(state._featureRecords);
    for (const entity of state._cableDataSource.entities.values) {
      const props = entity.properties.getValue();
      const record = parts.interaction.resolvePickRecord({ id: entity });
      assert.ok(
        sourceRecords.has(record),
        'every rendered segment resolves to an active source record',
      );
      assert.equal(record.id, String(props.id));
      assert.equal(record.label, props.name);
      const expectedColor = (
        props.color
          ? Cesium.Color.fromCssColorString(String(props.color))
          : state.cableColor
      ).withAlpha(0.92);
      assert.ok(
        Cesium.Color.equals(
          entity.polyline.material.getValue(Cesium.JulianDate.MINIMUM_VALUE)
            .color,
          expectedColor,
        ),
      );
      assert.equal(entity.polyline.width.getValue(), 2.5);
      assert.equal(entity.polyline.clampToGround.getValue(), true);
      assert.equal(
        entity.polyline.classificationType.getValue(),
        state._classificationType,
      );
    }
  } finally {
    parts.rendering.releaseDataSources(viewer);
  }
  assert.equal(attached.size, 0);
  assert.equal(state._featureRecords.length, 0);
  assert.equal(state._surfaceRecords.length, 0);
});
