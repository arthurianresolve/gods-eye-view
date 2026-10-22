import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STYLE_URL_NAMES,
  createView,
  viewFromParams,
  viewToParams,
  viewUrl,
} from './index.js';

test('saved views preserve complete visual settings through repeated URL round trips', () => {
  for (const scopeTerminusPct of [null, 97]) {
    const visual = {
      bloom: true,
      sharpen: true,
      bloomIntensity: 84,
      bloomVersion: 2,
      sharpenIntensity: 49,
      hudVariant: 'operator',
      hudVisible: true,
      detectionAllocation: 'WEIGHTED',
      detectionFadePct: 7,
      detectionOutsideOpacityPct: 1,
      celestialRing: true,
      scopeEnabled: false,
      scopeFeatherPct: 11,
      scopeTerminusPct,
      styleParams: { pixelation: 3, distortion: 0.25, instability: 0 },
    };
    const view = createView({
      camera: { lat: 1, lon: 2 },
      style: 'retro',
      visual,
    });
    let restored = view;
    for (let cycle = 0; cycle < 3; cycle++)
      restored = viewFromParams(viewToParams(restored));
    assert.deepEqual(restored.visual, visual);
    assert.deepEqual(restored, view);
    assert.ok(Object.isFrozen(view.visual));
    assert.ok(Object.isFrozen(view.visual.styleParams));
    visual.styleParams.pixelation = 4;
    assert.equal(view.visual.styleParams.pixelation, 3);
  }
  const legacy = createView({ camera: { lat: 1, lon: 2 } });
  assert.equal('visual' in legacy, false);
  assert.deepEqual(viewFromParams(viewToParams(legacy)), legacy);
});

test('visual URL migration is bounded and legacy bloom is migrated only once', () => {
  const migrated = viewFromParams(
    new URLSearchParams(
      'v=2&lat=1&lon=2&style=crt&bloom=1&bi=25&si=999&kf=-8&ko=999&scf=-7&sce=0&hud=bogus&sp=p.300_d.25',
    ),
  );
  assert.equal(migrated.visual.bloomIntensity, 150);
  assert.equal(migrated.visual.bloomVersion, 2);
  assert.equal(migrated.visual.sharpenIntensity, 100);
  assert.equal(migrated.visual.detectionFadePct, 0);
  assert.equal(migrated.visual.detectionOutsideOpacityPct, 100);
  assert.equal(migrated.visual.scopeFeatherPct, 0);
  assert.equal(migrated.visual.scopeTerminusPct, 94);
  assert.equal(migrated.visual.hudVariant, 'tactical');
  assert.deepEqual(migrated.visual.styleParams, {
    pixelation: 3,
    distortion: 0.25,
  });
  assert.deepEqual(viewFromParams(viewToParams(migrated)), migrated);
  for (const sce of ['', '97px', 'Infinity', 'not-a-number'])
    assert.equal(
      viewFromParams(new URLSearchParams({ lat: '1', lon: '2', sce })).visual
        .scopeTerminusPct,
      null,
    );
});

test('malformed visual imports cannot silently change settings or add arbitrary style parameters', () => {
  for (const visual of [
    [],
    'sharpen',
    { sharpen: 'true' },
    { bloomIntensity: Infinity },
    { bloomIntensity: -1 },
    { bloomVersion: 1 },
    { sharpenIntensity: 101 },
    { detectionFadePct: 41 },
    { detectionAllocation: 'AUTO' },
    { detectionOutsideOpacityPct: NaN },
    { scopeTerminusPct: 93 },
    { scopeFeatherPct: null },
    { hudVariant: 'other' },
    { url: 'https://example.test' },
    { styleParams: { unregistered: 1 } },
    { styleParams: { pixelation: '3' } },
    { styleParams: { pixelation: 11 } },
    { styleParams: [] },
  ])
    assert.throws(
      () => createView({ camera: { lat: 1, lon: 2 }, style: 'retro', visual }),
      /view visual/,
    );
});

test('optional detection settings survive canonical view and URL round trips', () => {
  for (const detection of ['OFF', 'SPARSE', 'BALANCED', 'DENSE'].flatMap(
    (mode) => [0, 25, 50, 75, 100].map((densityPct) => ({ mode, densityPct })),
  )) {
    const view = createView({ camera: { lat: 1, lon: 2 }, detection });
    assert.deepEqual(viewFromParams(viewToParams(view)), view);
    assert.ok(Object.isFrozen(view.detection));
  }
  const old = createView({ camera: { lat: 1, lon: 2 } });
  assert.equal('detection' in old, false);
  assert.deepEqual(viewFromParams(viewToParams(old)), old);
  for (const detection of [
    { mode: 'DENSE', densityPct: NaN },
    { mode: 'AUTO', densityPct: 75 },
    { mode: 'OFF', densityPct: '75' },
  ])
    assert.throws(
      () => createView({ camera: { lat: 1, lon: 2 }, detection }),
      /Invalid view detection/,
    );
});

test('a view round-trips through share-link parameters', () => {
  const view = createView({
    camera: {
      lat: 35.68,
      lon: 139.76,
      altitude_m: 300000,
      heading_deg: 15,
      pitch_deg: -45,
    },
    layers: ['earthquakes', 'ais-live-vessels'],
    style: 'retro',
    map: 'osm',
    follow: { kind: 'aircraft', id: 'AE1234' },
  });
  const params = viewToParams(view);
  assert.equal(params.get('style'), 'crt');
  assert.equal(params.get('map'), 'osm');
  assert.deepEqual(viewFromParams(params), view);
  assert.deepEqual(view.layers, ['ais-live-vessels', 'earthquakes', 'flights']);
  const satellite = createView({
    camera: { lat: 0, lon: 0 },
    follow: { kind: 'satellite', id: '25544' },
  });
  assert.deepEqual(viewFromParams(viewToParams(satellite)).follow, {
    kind: 'satellite',
    id: '25544',
  });
});

test('views have defaults, bounds, and reject what links cannot carry', () => {
  const view = createView({ camera: { lat: 91, lon: 10, altitude_m: 1 } });
  assert.deepEqual(view.camera, {
    lat: 90,
    lon: 10,
    altitude_m: 50,
    heading_deg: 0,
    pitch_deg: -90,
  });
  assert.equal(view.style, null);
  const params = viewToParams(view);
  assert.equal(params.has('style'), false);
  assert.equal(params.has('l'), false);
  assert.throws(() => createView({ camera: {} }), /lat and lon/);
  assert.throws(
    () => createView({ camera: { lat: 0, lon: 0 }, style: 'sepia' }),
    /Unknown view style/,
  );
  assert.throws(
    () =>
      createView({
        camera: { lat: 0, lon: 0 },
        follow: { kind: 'ship', id: '1' },
      }),
    /Cannot follow a ship/,
  );
  assert.equal(viewFromParams(new URLSearchParams('style=crt')), null);
  assert.equal(
    new URL(viewUrl('https://maps.example/app', view)).hash.slice(1),
    params.toString(),
  );
});

test('views use the same style names as the app share links', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../sharelink.js', import.meta.url), 'utf8'),
  );
  assert.match(source, /const STYLE_TO_URL = STYLE_URL_NAMES;/);
  assert.equal(STYLE_URL_NAMES.retro, 'crt');
});

test('annotations travel in the link, keeping only what the app draws', async () => {
  const { annotationsFromParams } = await import('./index.js');
  const view = createView({
    camera: { lat: 25, lon: 121 },
    annotations: [
      { type: 'pin', target: 'Taipei 101', label: 'Taipei 101', color: 'red' },
      {
        type: 'arrow',
        latitude: 24,
        longitude: 119,
        toLatitude: 25,
        toLongitude: 121,
      },
      {
        type: 'route',
        points: [
          { latitude: 1, longitude: 2 },
          { latitude: 3, longitude: 4 },
        ],
        screenX: 0.5,
      },
      { type: 'pin' },
      { type: 'sparkle', target: 'x' },
      { type: 'label', latitude: 200, longitude: 0, target: 'Here' },
    ],
  });
  assert.equal(view.annotations.length, 4);
  assert.equal(view.annotations[2].screenX, undefined);
  assert.deepEqual(view.annotations[3], { type: 'label', target: 'Here' });
  const params = viewToParams(view);
  assert.ok(params.has('an'));
  assert.deepEqual(viewFromParams(params), view);
  assert.deepEqual(
    annotationsFromParams(new URLSearchParams('an=not json')),
    [],
  );
  const many = createView({
    camera: { lat: 0, lon: 0 },
    annotations: Array.from({ length: 30 }, () => ({
      type: 'label',
      target: 'x'.repeat(200),
      label: 'y'.repeat(120),
    })),
  });
  assert.equal(many.annotations.length, 24);
  // Too long for a link: the view keeps them, the link leaves them out.
  assert.equal(viewToParams(many).has('an'), false);
});

test('historical intent and local recording references round-trip without changing old links', () => {
  const targetMs = Date.now() - 60_000;
  const providerHistory = createView({
    camera: { lat: 12, lon: 34 },
    temporal: { source: 'provider-history', targetMs, recordingId: null },
  });
  const params = viewToParams(providerHistory);
  assert.equal(params.get('is'), 'provider-history');
  assert.equal(params.get('it'), String(targetMs));
  assert.equal(params.has('ir'), false);
  assert.deepEqual(viewFromParams(params), providerHistory);

  const recording = createView({
    camera: { lat: 12, lon: 34 },
    temporal: {
      source: 'recording',
      targetMs,
      recordingId: 'flight-run-2026-10-08',
    },
  });
  assert.deepEqual(viewFromParams(viewToParams(recording)), recording);
  assert.equal(
    viewToParams(createView({ camera: { lat: 0, lon: 0 } })).has('is'),
    false,
  );
  assert.equal(
    viewFromParams(new URLSearchParams('lat=0&lon=0&is=recording&it=42')),
    null,
  );
  assert.equal(
    viewFromParams(
      new URLSearchParams('lat=0&lon=0&is=provider-history&it=not-a-time'),
    ),
    null,
  );
  assert.throws(
    () =>
      createView({
        camera: { lat: 0, lon: 0 },
        temporal: { source: 'provider-history', targetMs: Date.now() + 60_000 },
      }),
    /past target/,
  );
});
