import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  createCableFeatureRecord,
  clearSourceOrdinalAnnotations,
  groupEntitiesBySourceOrdinal,
  normalizeFeatures,
  withSourceOrdinals,
} from './geometry.js';

test('plain cable identities keep duplicate names distinct and detach coordinates', () => {
  const firstFeature = {
    id: 'cable/17',
    properties: { name: 'North Link' },
  };
  const secondFeature = {
    id: 'cable/18',
    properties: { name: 'North Link' },
  };
  const first = createCableFeatureRecord(firstFeature, 'cable', {
    lon: -31.2,
    lat: 42.1,
  });
  const second = createCableFeatureRecord(secondFeature, 'cable', {
    lon: -31.3,
    lat: 42.2,
  });

  assert.equal(first.label, second.label);
  assert.notEqual(first.identity, second.identity);
  assert.equal(first.identity, 'cable:cable/17');
  assert.deepEqual(
    createCableFeatureRecord(
      { ...firstFeature, properties: { name: 'North Link' } },
      'cable',
      { lon: -31.2, lat: 42.1 },
    ),
    first,
    'the source id and reference define the same identity after rebuild',
  );
  assert.deepEqual(first.reference, { lon: -31.2, lat: 42.1 });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.entity, undefined);
  assert.equal(createCableFeatureRecord({}, 'cable', { lon: 1, lat: 2 }), null);
  assert.equal(createCableFeatureRecord(firstFeature, 'cable', null), null);
  assert.equal(
    createCableFeatureRecord(
      { id: 'landing/3', properties: {} },
      'landing-point',
      { lon: 2, lat: 3 },
    ).label,
    'landing/3',
  );
});

test('multipart and duplicate-ID GeoJSON entities bind to source order, not entity index', async () => {
  const source = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'shared',
        properties: { id: 'shared', name: 'North cable' },
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
  const normalized = normalizeFeatures(source, 'cable');
  const annotationProbe = withSourceOrdinals(normalized);
  assert.notEqual(annotationProbe, normalized);
  assert.equal(
    annotationProbe.features[0].properties.__gev_cable_source_ordinal_v1,
    0,
  );
  clearSourceOrdinalAnnotations(annotationProbe);
  assert.equal(
    Object.hasOwn(
      annotationProbe.features[0].properties,
      '__gev_cable_source_ordinal_v1',
    ),
    false,
  );
  const annotated = withSourceOrdinals(normalized);
  assert.deepEqual(source.features[0].properties, {
    id: 'shared',
    name: 'North cable',
  });

  const dataSource = await Cesium.GeoJsonDataSource.load(
    { type: 'FeatureCollection', features: annotated.features },
    { clampToGround: true },
  );
  clearSourceOrdinalAnnotations(annotated);
  assert.equal(
    Object.hasOwn(
      annotated.features[0].properties,
      '__gev_cable_source_ordinal_v1',
    ),
    false,
  );
  try {
    const entities = dataSource.entities.values;
    assert.equal(
      entities.length,
      3,
      'one MultiLineString expands to two Entities',
    );
    assert.deepEqual(
      entities.map((entity) => entity.id),
      ['shared', 'shared_2', 'shared_3'],
      'the native duplicate-ID suffixes stay unchanged',
    );

    const groups = groupEntitiesBySourceOrdinal(
      [...entities].reverse(),
      annotated,
    );
    assert.deepEqual(
      groups.map((group) => group.map((entity) => entity.id).sort()),
      [['shared', 'shared_2'], ['shared_3']],
      'association is independent of loaded Entity enumeration order',
    );
    assert.equal(
      groups[0][0].polyline.positions.getValue(Cesium.JulianDate.MINIMUM_VALUE)
        .length,
      2,
    );
    for (const entity of entities) {
      assert.equal(
        entity.properties.hasProperty('__gev_cable_source_ordinal_v1'),
        false,
        'temporary association metadata is removed from the active Entity',
      );
    }
  } finally {
    dataSource.entities.removeAll();
  }
});

test('source ordinal annotation avoids metadata collisions and cleans malformed entity groups', async () => {
  const source = [
    {
      properties: {
        __gev_cable_source_ordinal_v1: 42,
        __gev_cable_source_ordinal_v1_1: 'original',
      },
    },
  ];
  const collision = withSourceOrdinals(source);
  assert.equal(collision.propertyName, '__gev_cable_source_ordinal_v1_2');
  clearSourceOrdinalAnnotations(collision);
  assert.deepEqual(collision.features, source);
  const annotated = withSourceOrdinals([
    {
      type: 'Feature',
      id: 'single',
      properties: { name: 'single' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ]);
  const dataSource = await Cesium.GeoJsonDataSource.load({
    type: 'FeatureCollection',
    features: annotated.features,
  });
  try {
    const entity = dataSource.entities.values[0];
    assert.throws(
      () => groupEntitiesBySourceOrdinal([entity, {}], annotated),
      /missing its source ordinal/,
    );
    assert.equal(
      entity.properties.hasProperty('__gev_cable_source_ordinal_v1'),
      false,
      'failure still releases the transient property from earlier Entities',
    );
  } finally {
    dataSource.entities.removeAll();
  }
});

test('bundled cable source maps every real Cesium segment to all 712 parent features', async () => {
  const source = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          '../../data/local_data/telegeography_submarine_cables/cable-geo.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  );
  const features = normalizeFeatures(source, 'cable');
  assert.equal(features.length, 712);
  const multiIndex = features.findIndex(
    (feature) => feature.properties?.id === 'kunoa-north',
  );
  assert.notEqual(multiIndex, -1);

  const annotated = withSourceOrdinals(features);
  const dataSource = await Cesium.GeoJsonDataSource.load(
    { type: 'FeatureCollection', features: annotated.features },
    { clampToGround: true },
  );
  clearSourceOrdinalAnnotations(annotated);
  try {
    const groups = groupEntitiesBySourceOrdinal(
      dataSource.entities.values,
      annotated,
    );
    assert.equal(dataSource.entities.values.length, 1913);
    assert.equal(groups.length, 712);
    assert.equal(groups.filter((group) => group.length === 0).length, 0);
    assert.deepEqual(
      groups[multiIndex].map((entity) => entity.id),
      ['kunoa-north', 'kunoa-north_2', 'kunoa-north_3'],
      'native Cesium IDs remain grouped under the matching source feature',
    );
    assert.equal(
      groups
        .flat()
        .filter((entity) => entity.properties.getValue().id === 'kunoa-north')
        .length,
      3,
    );
    for (const entity of dataSource.entities.values) {
      assert.equal(
        entity.properties.hasProperty('__gev_cable_source_ordinal_v1'),
        false,
      );
    }
  } finally {
    dataSource.entities.removeAll();
  }
});
