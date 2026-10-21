import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

async function trackedToggleButton() {
  const { railFixture } = await import('./railTestFixture.mjs');
  const writes = [];
  const fixture = railFixture((property) => writes.push(property));
  const button = fixture.document.createElement('button');
  button.className = 'data-toggle-btn';
  writes.length = 0;
  return { button, writes };
}

test('toggle reconciliation preserves lifecycle, feed and accessible states without repeat DOM writes', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { button, writes } = await trackedToggleButton();
  const base = { id: 'reconcile-fixture', name: 'Fixture feed', stats: {} };
  for (const state of [
    { enabled: false, lifecycleState: 'disabled', text: 'OFF', feed: 'off' },
    {
      enabled: false,
      lifecycleState: 'enabling',
      text: 'ENABLING',
      feed: 'enabling',
      busy: true,
    },
    { enabled: true, lifecycleState: 'enabled', text: 'ON', feed: 'nominal' },
    {
      enabled: true,
      lifecycleState: 'disabling',
      text: 'DISABLING',
      feed: 'disabling',
      busy: true,
    },
    { enabled: false, lifecycleState: 'disabled', text: 'OFF', feed: 'off' },
    {
      enabled: true,
      lifecycleState: 'enabled',
      lifecycleUncertain: true,
      text: 'UNCERTAIN',
      feed: 'uncertain',
    },
    {
      enabled: true,
      lifecycleState: 'enabled',
      stats: { partial: true },
      text: 'PARTIAL',
      feed: 'partial',
    },
    {
      enabled: false,
      lifecycleState: 'disabled',
      stats: { sourceUnavailable: true, error: 'First failure' },
      text: 'UNAVAILABLE',
      feed: 'unavailable',
      unavailable: true,
    },
    {
      enabled: true,
      lifecycleState: 'enabled',
      stats: { sourceUnavailable: true, error: 'First failure' },
      text: 'UNAVAILABLE',
      feed: 'unavailable',
      unavailable: true,
    },
    { enabled: false, lifecycleState: 'disabled', text: 'OFF', feed: 'off' },
  ]) {
    const layer = { ...base, ...state };
    writes.length = 0;
    LayerPanel.prototype._syncToggleButton(button, layer);
    assert.equal(button.textContent, state.text);
    assert.equal(button.dataset.feedState, state.feed);
    assert.equal(button.disabled, false, 'busy controls retain keyboard focus');
    assert.equal(button.classList.contains('active'), state.enabled);
    assert.equal(
      button.classList.contains('transitioning'),
      Boolean(state.busy),
    );
    assert.equal(
      button.classList.contains('enabling'),
      state.feed === 'enabling',
    );
    assert.equal(
      button.classList.contains('disabling'),
      state.feed === 'disabling',
    );
    assert.equal(
      button.classList.contains('lifecycle-uncertain'),
      state.feed === 'uncertain',
    );
    assert.equal(
      button.classList.contains('feed-partial'),
      state.feed === 'partial',
    );
    assert.equal(
      button.classList.contains('feed-unavailable'),
      state.feed === 'unavailable',
    );
    assert.equal(button.getAttribute('aria-busy'), String(Boolean(state.busy)));
    assert.equal(
      button.getAttribute('aria-disabled'),
      String(Boolean(state.busy || (state.unavailable && !state.enabled))),
    );
    assert.equal(button.title, state.unavailable ? 'First failure' : '');
    assert.equal(
      button.getAttribute('aria-label'),
      `Fixture feed: ${state.text}${state.unavailable ? '. First failure' : ''}`,
    );
    assert.ok(writes.length > 0, 'a changed presentation must still update');
    writes.length = 0;
    for (let repeat = 0; repeat < 3; repeat++)
      LayerPanel.prototype._syncToggleButton(button, layer);
    assert.deepEqual(
      writes,
      [],
      `unchanged ${state.feed} presentation must emit no DOM writes`,
    );
  }
});

test('toggle reconciliation updates changed guidance and repairs externally changed DOM values', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { button, writes } = await trackedToggleButton();
  const layer = {
    id: 'reconcile-fixture',
    name: 'Fixture feed',
    enabled: false,
    stats: { sourceUnavailable: true, error: 'First failure' },
  };
  LayerPanel.prototype._syncToggleButton(button, layer);
  layer.stats.error = 'Second failure';
  writes.length = 0;
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.equal(button.title, 'Second failure');
  assert.equal(
    button.getAttribute('aria-label'),
    'Fixture feed: UNAVAILABLE. Second failure',
  );
  assert.equal(
    writes.filter((property) => property === 'textContent').length,
    0,
    'guidance changes do not replace identical chip text',
  );
  assert.equal(writes.filter((property) => property === 'title').length, 1);
  assert.equal(writes.filter((property) => property === 'attribute').length, 1);
  button.dataset.feedState = 'stale-dom';
  button.textContent = 'STALE DOM';
  button.title = 'Stale guidance';
  button.disabled = true;
  button.setAttribute('aria-disabled', 'false');
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-label', 'Stale accessible name');
  button.classList.toggle('feed-unavailable', false);
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.equal(button.dataset.feedState, 'unavailable');
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(button.title, 'Second failure');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.getAttribute('aria-busy'), 'false');
  assert.equal(
    button.getAttribute('aria-label'),
    'Fixture feed: UNAVAILABLE. Second failure',
  );
  assert.equal(button.classList.contains('feed-unavailable'), true);
  writes.length = 0;
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.deepEqual(writes, []);
});

test('toggle reconciliation applies a changed language before becoming quiet again', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { getLocale, prepareLocale, setLocale, t } =
    await import('../i18n/index.js');
  const previousLocale = getLocale();
  const { button, writes } = await trackedToggleButton();
  const layer = {
    id: 'reconcile-fixture',
    name: 'Fixture feed',
    enabled: true,
    stats: {},
  };
  try {
    setLocale('en');
    LayerPanel.prototype._syncToggleButton(button, layer);
    const englishText = button.textContent;
    await prepareLocale('ru');
    writes.length = 0;
    LayerPanel.prototype._syncToggleButton(button, layer);
    assert.notEqual(button.textContent, englishText);
    assert.equal(button.textContent, t('ON'));
    assert.ok(button.getAttribute('aria-label').includes(t('ON')));
    assert.equal(
      button.dataset.feedState,
      'nominal',
      'machine state is independent of language',
    );
    assert.equal(
      writes.filter((property) => property === 'textContent').length,
      1,
    );
    writes.length = 0;
    LayerPanel.prototype._syncToggleButton(button, layer);
    assert.deepEqual(writes, []);
    setLocale('en');
    LayerPanel.prototype._syncToggleButton(button, layer);
    assert.equal(button.textContent, englishText);
  } finally {
    setLocale(previousLocale);
  }
});

test('full panel refresh still visits every row and mutates only a changed toggle', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const first = await trackedToggleButton();
  const second = await trackedToggleButton();
  const layers = ['first', 'second'].map((id) => ({
    id,
    name: id,
    enabled: false,
    stats: {},
  }));
  let reads = 0;
  const panel = new LayerPanel({
    getLayers: () => {
      reads++;
      return layers;
    },
  });
  const buttons = new Map([
    ['first', first.button],
    ['second', second.button],
  ]);
  panel._toggleContainer = {
    querySelector(selector) {
      const id = selector.match(/data-layer-id="([^"]+)"/)?.[1];
      return {
        querySelector: (childSelector) =>
          childSelector === '.data-toggle-btn' ? buttons.get(id) : null,
      };
    },
  };
  panel._refreshWeatherPanel = () => {};
  panel._refreshTogglePanel();
  first.writes.length = 0;
  second.writes.length = 0;
  panel._refreshTogglePanel();
  panel._refreshTogglePanel();
  assert.equal(
    reads,
    3,
    'unchanged refreshes still inspect current layer state',
  );
  assert.deepEqual(first.writes, []);
  assert.deepEqual(second.writes, []);
  layers[1].enabled = true;
  panel._refreshTogglePanel();
  assert.deepEqual(first.writes, [], 'unchanged sibling rows remain untouched');
  assert.equal(second.button.textContent, 'ON');
  assert.equal(
    second.writes.filter((property) => property === 'textContent').length,
    1,
  );
  second.writes.length = 0;
  panel._refreshTogglePanel();
  assert.deepEqual(second.writes, []);
});

test('row controls update their content and visibility without repeating the hidden write', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const container = f.document.createElement('div');
  const hiddenWrites = [];
  let hidden = container.hidden;
  Object.defineProperty(container, 'hidden', {
    get: () => hidden,
    set(value) {
      hiddenWrites.push(value);
      hidden = value;
    },
  });
  let controls = {};
  let reads = 0;
  const panel = new LayerPanel({
    getRowControls: () => {
      reads++;
      return controls;
    },
  });
  const layer = { id: 'controls-fixture', enabled: true };
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  try {
    const states = [
      { controls: {}, hidden: true },
      {
        controls: { chips: [{ id: 'mode', label: 'First mode' }] },
        hidden: false,
      },
      {
        controls: { chips: [{ id: 'mode', label: 'Second mode' }] },
        hidden: false,
      },
      {
        controls: { legend: [{ label: 'Coverage', color: '#abcdef' }] },
        hidden: false,
      },
      { controls: { info: 'Current information' }, hidden: false },
      { controls: {}, hidden: true },
    ];
    for (const state of states) {
      controls = state.controls;
      const previouslyHidden = container.hidden;
      hiddenWrites.length = 0;
      panel._syncRowControls(container, layer);
      assert.equal(container.hidden, state.hidden);
      assert.deepEqual(
        hiddenWrites,
        previouslyHidden === state.hidden ? [] : [state.hidden],
      );
      if (controls.chips)
        assert.equal(
          container.querySelector('.data-toggle-chip').textContent,
          controls.chips[0].label,
        );
      if (controls.legend)
        assert.equal(
          container.querySelector('.data-toggle-legend-item').children[1]
            .textContent,
          'Coverage',
        );
      if (controls.info)
        assert.equal(
          container.querySelector('.data-toggle-controls-info').textContent,
          controls.info,
        );
      const beforeReads = reads;
      hiddenWrites.length = 0;
      for (let repeat = 0; repeat < 3; repeat++)
        panel._syncRowControls(container, layer);
      assert.equal(
        reads - beforeReads,
        3,
        'every refresh still reads current controls',
      );
      assert.deepEqual(hiddenWrites, []);
    }
  } finally {
    globalThis.document = previousDocument;
  }
});

test('row controls repair externally changed visibility and honor live enabled state', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const container = f.document.createElement('div');
  const writes = [];
  let hidden = false;
  Object.defineProperty(container, 'hidden', {
    get: () => hidden,
    set(value) {
      writes.push(value);
      hidden = value;
    },
  });
  const panel = new LayerPanel({
    getRowControls: () => ({ chips: [{ id: 'mode', label: 'Mode' }] }),
  });
  const layer = { id: 'controls-fixture', enabled: true };
  for (const enabled of [true, false, true]) {
    layer.enabled = enabled;
    panel._syncRowControls(container, layer);
    assert.equal(container.hidden, !enabled);
    container.hidden = enabled;
    writes.length = 0;
    panel._syncRowControls(container, layer);
    assert.equal(container.hidden, !enabled);
    assert.deepEqual(writes, [!enabled]);
    writes.length = 0;
    panel._syncRowControls(container, layer);
    assert.deepEqual(writes, []);
  }
});

test('panel presentation places Transit between Street Traffic and Bike Share in Movement', () => {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  const declarations = source.slice(
    source.indexOf('const PANEL_GROUPS ='),
    source.indexOf('const PANEL_POSITIONS ='),
  );
  const order = JSON.parse(
    runInNewContext(
      `const msg = (text) => text;\n${declarations}\nJSON.stringify(PANEL_ORDER)`,
    ),
  );
  assert.deepEqual(
    order.filter(({ label }) => label === 'Movement').map(({ id }) => id),
    [
      'satellites',
      'flights',
      'military',
      'local-adsb',
      'ais-live-vessels',
      'traffic',
      'transit',
      'bikeshare',
    ],
  );
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.match(attrs.get('aria-label'), /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
});

test('readout rows contain only toggles and metadata; ordinary rows retain controls', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'other',
  ];
  let refresh;
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'Source',
    enabled: true,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled: (...args) => calls.push(args),
    setLayerParams: (...args) => calls.push(args),
    hasRowControls: () => true,
    subscribeRowControls: (_id, callback) => {
      refresh = callback;
    },
    getRowControls: (id) => ({
      readout: id !== 'other',
      summary: { status: 'Loading' },
      info: 'Detailed time',
      chips: [{ id: 'config', label: 'Soft', params: { opacity: 'light' } }],
      legend: [{ label: 'Rain', color: '#abcdef' }],
      list: {
        items: [{ id: 'storm', text: 'Storm', params: { focus: true } }],
      },
    }),
  });
  try {
    panel.mount(f.container);
    for (const id of ids.slice(0, -1)) {
      const row = f.find((n) => n.dataset.layerId === id);
      assert.equal(row.children.length, 2);
      assert.ok(row.querySelector('.data-name'));
      assert.ok(row.querySelector('.data-toggle-meta'));
      for (const cls of [
        'data-toggle-chip',
        'data-count',
        'data-toggle-controls',
        'data-toggle-controls-status',
        'data-row-list',
      ])
        assert.equal(row.querySelector(`.${cls}`), null);
      row.querySelector('.data-toggle-btn').click();
    }
    assert.deepEqual(
      calls.map(([id]) => id),
      ids.slice(0, -1),
    );
    const ordinary = f.find((n) => n.dataset.layerId === 'other');
    assert.equal(
      ordinary.querySelector('.data-toggle-controls-info').textContent,
      'Detailed time',
    );
    assert.ok(ordinary.querySelector('.data-toggle-legend-item'));
    ordinary.querySelector('.data-toggle-chip').click();
    assert.deepEqual(calls.at(-1), [
      'other',
      { opacity: 'light' },
      { origin: 'user' },
    ]);
    assert.equal(typeof refresh, 'function');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('the Recent Imagery readout mounts in its rail body like the weather readout and is rebuilt or released with the panel', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const body = f.document.createElement('div');
  f.document.getElementById = (id) =>
    id === 'recent-imagery-panel-body' ? body : null;
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const mounted = [];
  const factory = (container) => {
    const readout = {
      container,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    mounted.push(readout);
    return readout;
  };
  const panel = new LayerPanel({
    getLayers: () => [],
    isEnabled: () => false,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => false,
    subscribeRowControls() {},
    getRowControls: () => null,
  });
  try {
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 0, 'no body before the panel mounts');
    panel.mount(f.container);
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].container, body);
    panel.mount(f.container);
    assert.equal(mounted[0].destroyed, true, 'a remount rebuilds it');
    assert.equal(mounted.length, 2);
    panel.attachRecentImagery(null);
    assert.equal(mounted[1].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3);
    panel.destroy();
    assert.equal(mounted[2].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3, 'a destroyed panel mounts nothing');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('an omitted source is visibly unavailable and cannot be toggled on', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const attrs = new Map();
  const button = {
    classList: { toggle() {} },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: false,
    stats: {
      sourceUnavailable: true,
      status: 'unavailable',
      error: 'Data source not configured: flights',
    },
  };
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(attrs.get('aria-disabled'), 'true');
  assert.match(button.title, /not configured/);
  LayerPanel.prototype._syncToggleButton(button, { ...layer, enabled: true });
  assert.equal(
    attrs.get('aria-disabled'),
    'false',
    'an active layer can always be switched off',
  );
});

test('row text keeps a hyphenated code whole and never starts a line with the separator', async () => {
  const { setRowText } = await import('./layerPanel.js');
  const previousDocument = globalThis.document;
  const element = () => ({
    className: '',
    textContent: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  });
  globalThis.document = { createElement: element };
  try {
    const text = (node) =>
      node.children.length
        ? node.children.map((child) => child.textContent).join('')
        : node.textContent;
    const kept = (node) =>
      node.children
        .filter((child) => child.className === 'data-keep')
        .map((child) => child.textContent);

    const name = element();
    setRowText(name, 'Локальный ADS-B');
    assert.equal(text(name), 'Локальный ADS-B');
    assert.deepEqual(kept(name), ['ADS-B']);

    const meta = element();
    setRowText(meta, 'UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
    assert.equal(text(meta), 'UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
    assert.deepEqual(kept(meta), [' ·', ' ·', ' ·']);
    assert.ok(
      meta.children.every((child) => !child.textContent.startsWith('·')),
      'the space before each dot is held to the piece it closes',
    );

    const plain = element();
    setRowText(plain, 'Satellites');
    assert.equal(plain.textContent, 'Satellites');
    assert.equal(plain.children.length, 0);

    const long = element();
    setRowText(long, 'see https-proxy-endpoint-config-x');
    assert.deepEqual(kept(long), [], 'a long hyphenated run may still wrap');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('the unavailable chip may abbreviate, but its accessible name keeps the full state', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const attrs = new Map();
  const button = {
    classList: { toggle() {} },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  LayerPanel.prototype._syncToggleButton(button, {
    id: 'local-firms',
    name: 'FIRMS Active Fires',
    enabled: false,
    stats: { sourceUnavailable: true, error: 'KEY REQUIRED' },
  });
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(button.dataset.feedState, 'unavailable');
  assert.match(attrs.get('aria-label'), /^Active Fires: UNAVAILABLE\./);
});

test('the Weather readout receives enabled air-quality alongside weather layers', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const layers = ['wind', 'air-quality', 'other'].map((id) => ({
    id,
    icon: '*',
    enabled: true,
  }));
  layers.push({ id: 'weather-radar', icon: '*', enabled: false });
  const panel = new LayerPanel({
    getLayers: () => layers,
    getRowControls: (id) => ({ readout: true, summary: { label: id } }),
  });
  let entries = null;
  panel._weatherPanel = {
    update: (next) => {
      entries = next;
    },
  };
  panel._refreshWeatherPanel();
  assert.deepEqual(
    entries.map(({ id, summary }) => [id, summary.label]),
    [
      ['wind', 'wind'],
      ['air-quality', 'air-quality'],
    ],
  );
});
