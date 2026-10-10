import test from 'node:test';
import assert from 'node:assert/strict';
import { createCableFeatureRecord } from './geometry.js';

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
