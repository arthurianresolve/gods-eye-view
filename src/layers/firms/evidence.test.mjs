import assert from 'node:assert/strict';
import test from 'node:test';
import { fireDetectionKey } from '../../data/firmsLabels.js';
import { createQueries } from './queries.js';
import { createSelection } from './selection.js';

const snapshotAt = Date.UTC(2026, 9, 1, 12);
const receivedAt = Date.UTC(2026, 9, 1, 12, 1);
const acquisitionAt = Date.UTC(2026, 9, 1, 10, 30);
const fire = {
  index: 0,
  lat: 30.2,
  lon: -97.7,
  acqMs: acquisitionAt,
  frp: 25,
  confidence: 0.9,
  sensor: 'VIIRS',
  satellite: 'SNPP',
};

function state(overrides = {}) {
  return {
    _enabled: true,
    _firesByFrp: [fire],
    _selectedFire: fire,
    _lastUpdate: snapshotAt,
    _receivedAt: receivedAt,
    _stale: false,
    _error: null,
    _keyRequired: false,
    _missingSources: [],
    ...overrides,
  };
}

const model = {
  mapAnalystRecord(record) {
    return {
      id: `FIRE-${record.index}`,
      lat: record.lat,
      lon: record.lon,
      acqTime: record.acqMs,
    };
  },
  formatFrp: (value) => String(value),
  confidenceBucket: () => 'high',
  formatAge: () => '1h',
  firePosition: () => ({ x: 1 }),
};

test('FIRMS analyst records preserve acquisition, snapshot and receipt evidence', () => {
  const layerState = state({ _missingSources: ['MODIS'] });
  const { methods } = createQueries({
    layerState,
    services: {},
    components: { model },
    config: { id: 'local-firms', name: 'Fires', source: 'NASA FIRMS' },
  });

  const [record] = methods.getAnalystRecords();
  assert.equal(record.evidence.entityRef.layerKey, 'local-firms');
  assert.equal(record.evidence.entityRef.id, fireDetectionKey(fire));
  assert.equal(record.evidence.sourceId, 'NASA FIRMS');
  assert.equal(record.evidence.licenseRef, 'CC0 / U.S. public domain data');
  assert.equal(
    record.evidence.sourceUrl,
    'https://firms.modaps.eosdis.nasa.gov/',
  );
  assert.equal(record.evidence.observedAt, acquisitionAt);
  assert.equal(record.evidence.snapshotAt, snapshotAt);
  assert.equal(record.evidence.receivedAt, receivedAt);
  assert.equal(record.evidence.coverage.completeness, 'partial');
  assert.match(record.evidence.coverage.reason, /MODIS/);
});

test('FIRMS selected context exposes the same evidence without changing identity', () => {
  const layerState = state({ _stale: true });
  const registered = [];
  const selection = createSelection({
    layerState,
    services: {
      picking: { resolvePickId() {}, isOwnedByOtherLayer() {} },
      focus: { requestWorldFocus() {} },
      context: {
        selectEntityContext() {},
        clearSelectedEntityContextForLayer() {},
        getContextStore: () => ({ entities: new Map() }),
        registerEntityContext: (_entity, metadata) => registered.push(metadata),
      },
    },
    components: { model, cards: { rebuildAmbientLabels() {} } },
    config: {
      id: 'local-firms',
      name: 'Fires',
      overlayHost: {},
      screenSpaceEventHandlerFactory() {},
    },
  });

  selection.registerFireContext(fire);
  assert.equal(registered[0].id, fireDetectionKey(fire));
  assert.equal(registered[0].evidence.feedState, 'stale');
  assert.equal(registered[0].evidence.observedAt, acquisitionAt);
  assert.equal(registered[0].evidence.receivedAt, receivedAt);
});

test('missing fire acquisition time remains unknown and stale errors remain visible', () => {
  const layerState = state({
    _firesByFrp: [{ ...fire, acqMs: 0 }],
    _selectedFire: null,
    _error: 'live feed unavailable',
  });
  const { methods } = createQueries({
    layerState,
    services: {},
    components: { model },
    config: { id: 'local-firms', name: 'Fires', source: 'NASA FIRMS' },
  });

  const [record] = methods.getAnalystRecords();
  assert.equal(record.evidence.observedAt, null);
  assert.equal(record.evidence.method, 'unknown');
  assert.equal(record.evidence.feedState, 'degraded');
  assert.match(record.evidence.limitations.join(' '), /acquisition time/);
});
