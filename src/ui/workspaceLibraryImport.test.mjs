import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkspaceLibraryPanel } from './workspaceLibrary.js';
import { createWorkspaceLibrary } from '../workspaces/library.js';
import { createView } from '../view/index.js';

class Element {
  constructor(selector = '') {
    this.selector = selector;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.files = [];
  }

  set innerHTML(_value) {}

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, detail = {}) {
    const event = {
      target: this,
      preventDefault() {},
      ...detail,
    };
    return Promise.all(
      (this.listeners.get(type) || []).map((listener) => listener(event)),
    );
  }

  querySelector(selector) {
    this.descendants ||= new Map();
    if (!this.descendants.has(selector)) {
      const child = new Element(selector);
      const action = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];
      if (action) child.dataset.action = action;
      this.descendants.set(selector, child);
    }
    return this.descendants.get(selector);
  }

  querySelectorAll(selector) {
    if (selector === 'option') return this.children;
    return [];
  }

  closest(selector) {
    return selector === '[data-action]' && this.dataset.action ? this : null;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  prepend(node) {
    this.children.unshift(node);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  get selectedOptions() {
    return this.children.filter((option) => option.selected);
  }

  focus() {}
  setAttribute() {}
  remove() {}
}

class TestOption extends Element {
  constructor(label, value) {
    super('option');
    this.textContent = label;
    this.value = value;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function memoryStorage() {
  const records = new Map();
  const history = new Map();
  let commitGate = null;
  let commitStarted = null;
  return {
    listWorkspaces: async () =>
      [...records.keys()].map((id) => ({
        id,
        kind: 'investigation-workspace',
      })),
    getWorkspace: async (id, { revision } = {}) =>
      revision == null
        ? records.get(id) || null
        : history.get(`${id}:${revision}`) || null,
    commitWorkspace: async ({
      id,
      expectedRevision,
      document,
      chunks,
      assets,
    }) => {
      if (commitGate) {
        commitStarted.resolve();
        await commitGate.promise;
        commitGate = null;
      }
      const current = records.get(id);
      const currentRevision = current?.manifest.revision || 0;
      assert.equal(currentRevision, expectedRevision);
      if (current) history.set(`${id}:${currentRevision}`, current);
      const saved = {
        kind: 'investigation-workspace',
        document,
        chunks,
        assets,
        manifest: { revision: document.revision, saved: true, pinned: false },
      };
      records.set(id, saved);
      return saved.manifest;
    },
    deleteWorkspace: async (id) => records.delete(id),
    estimate: () => ({ usage: 0, quota: 1 }),
    gateNextCommit() {
      commitGate = deferred();
      commitStarted = deferred();
      return { started: commitStarted.promise, release: commitGate.resolve };
    },
    records,
  };
}

async function createPanel({ workspaceCount = 0 } = {}) {
  const storage = memoryStorage();
  const seed = createWorkspaceLibrary({
    storage,
    makeId: (() => {
      let id = 0;
      return () => `workspace-${String.fromCharCode(97 + id++)}`;
    })(),
    now: () => 100,
  });
  const view = createView({ camera: { lat: 12, lon: 34 } });
  for (let index = 0; index < workspaceCount; index++) {
    await seed.save({
      title: `Workspace ${index}`,
      view,
      filters: {},
      annotations: [],
      pinnedEvidence: [],
      assetRefs: [],
      directorProjectRef: 'director-project-v1',
      chunks: {},
    });
  }

  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldOption = globalThis.Option;
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.Option = TestOption;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    prompt: () => 'Test workspace',
    confirm: () => true,
  };
  const container = new Element('container');
  let renderHandler = async () => {};
  const shareLinkManager = {
    getCurrentView: () => view,
    applyView: async () => ({ status: 'applied' }),
    subscribeViewChanges: () => () => {},
  };
  const panel = createWorkspaceLibraryPanel({
    container,
    storage,
    shareLinkManager,
    shareRestoration: { restoreWorkspaceView: async () => [] },
    onImportedData: (...args) => renderHandler(...args),
    now: () => 200,
  });
  await panel.refresh();
  const root = container.children[0];
  const element = (selector) => root.querySelector(selector);
  const action = async (name, { wait = true } = {}) => {
    const target = element(`[data-action="${name}"]`);
    target.dataset.action = name;
    await root.dispatch('click', { target });
    if (!wait) return;
    if (name === 'open')
      await waitFor(
        () => element('[data-status]').textContent.startsWith('Opened'),
        'workspace open',
      );
    if (name === 'preview-import')
      await waitFor(
        () =>
          element('[data-import-summary]').textContent.includes('accepted') ||
          element('[data-import-status]').textContent.startsWith(
            'Preview failed',
          ),
        'CSV preview',
      );
  };
  const selectWorkspace = async (id) => {
    element('[data-workspace-select]').value = id;
    await element('[data-workspace-select]').dispatch('change');
    await action('open');
  };
  return {
    panel,
    storage,
    root,
    element,
    action,
    selectWorkspace,
    setRenderHandler(handler) {
      renderHandler = handler;
    },
    restoreGlobals() {
      panel.destroy();
      if (oldDocument === undefined) delete globalThis.document;
      else globalThis.document = oldDocument;
      if (oldWindow === undefined) delete globalThis.window;
      else globalThis.window = oldWindow;
      if (oldOption === undefined) delete globalThis.Option;
      else globalThis.Option = oldOption;
    },
  };
}

function geoFile(name, text) {
  return { name, size: text.length, text: async () => text };
}

function pointCollection(name) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name },
        geometry: { type: 'Point', coordinates: [2, 48] },
      },
    ],
  });
}

test('file selection clears old preview synchronously and ignores a late stale read', async (t) => {
  const fixture = await createPanel();
  t.after(() => fixture.restoreGlobals());
  const input = fixture.element('[data-geo-file]');
  input.files = [geoFile('prior.geojson', pointCollection('PRIOR'))];
  await input.dispatch('change');
  assert.match(
    fixture.element('[data-import-summary]').textContent,
    /1 accepted/,
  );
  const oldRead = deferred();
  input.files = [
    { name: 'old.geojson', size: 20, text: () => oldRead.promise },
  ];
  const oldChange = input.dispatch('change');
  assert.equal(fixture.element('[data-import-summary]').textContent, '');
  assert.equal(fixture.element('[data-import-review]').hidden, true);
  assert.equal(fixture.element('[data-action="apply-import"]').disabled, true);

  input.files = [geoFile('current.geojson', pointCollection('CURRENT'))];
  await input.dispatch('change');
  assert.match(
    fixture.element('[data-import-summary]').textContent,
    /1 accepted/,
  );
  assert.equal(fixture.element('[data-import-review]').hidden, false);

  oldRead.resolve('{ malformed old file');
  await oldChange;
  assert.match(
    fixture.element('[data-import-summary]').textContent,
    /1 accepted/,
  );
  assert.equal(fixture.element('[data-import-review]').hidden, false);
  assert.match(
    fixture.element('[data-import-status]').textContent,
    /Preview ready/,
  );
});

test('completed CSV preview can be rerun after choosing a different workspace', async (t) => {
  const fixture = await createPanel({ workspaceCount: 2 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  const input = fixture.element('[data-geo-file]');
  input.files = [geoFile('points.csv', 'lat,lon,name\n48,2,POINT\n')];
  await input.dispatch('change');
  await fixture.action('preview-import');
  assert.match(
    fixture.element('[data-import-summary]').textContent,
    /1 accepted/,
  );

  await fixture.selectWorkspace('workspace-b');
  const rerun = fixture.action('preview-import');
  assert.equal(fixture.element('[data-import-summary]').textContent, '');
  assert.equal(fixture.element('[data-action="apply-import"]').disabled, true);
  await rerun;
  assert.match(
    fixture.element('[data-import-summary]').textContent,
    /1 accepted/,
  );
  assert.equal(fixture.element('[data-action="apply-import"]').disabled, false);
});

for (const selectionPhase of ['during-save', 'during-render']) {
  test(`a started save completes without overwriting a newer file selected ${selectionPhase}`, async (t) => {
    const fixture = await createPanel({ workspaceCount: 1 });
    t.after(() => fixture.restoreGlobals());
    await fixture.selectWorkspace('workspace-a');
    const input = fixture.element('[data-geo-file]');
    input.files = [geoFile('first.geojson', pointCollection('FIRST'))];
    await input.dispatch('change');
    assert.equal(
      fixture.element('[data-action="apply-import"]').disabled,
      false,
    );

    const rendering = deferred();
    const finishRendering = deferred();
    fixture.setRenderHandler(async (imports) => {
      if (imports.length) {
        rendering.resolve();
        await finishRendering.promise;
      }
    });
    const gate =
      selectionPhase === 'during-save'
        ? fixture.storage.gateNextCommit()
        : null;
    const applying = fixture.action('apply-import', { wait: false });
    if (gate) await gate.started;
    if (selectionPhase === 'during-save') {
      input.files = [geoFile('second.geojson', pointCollection('SECOND'))];
      await input.dispatch('change');
      assert.match(
        fixture.element('[data-import-summary]').textContent,
        /1 accepted/,
      );
      gate.release();
    }

    await rendering.promise;
    if (selectionPhase === 'during-render') {
      input.files = [geoFile('third.geojson', pointCollection('THIRD'))];
      await input.dispatch('change');
    }
    finishRendering.resolve();
    await applying;
    await waitFor(
      () => !fixture.element('[data-action="cancel-import"]').disabled,
      'apply completion',
    );

    const saved = fixture.storage.records.get('workspace-a');
    assert.equal(saved.chunks.imports.length, 1);
    assert.equal(saved.chunks.imports[0].sourceName, 'first.geojson');
    assert.match(
      fixture.element('[data-import-status]').textContent,
      /Review counts/,
    );
    assert.match(
      fixture.element('[data-import-summary]').textContent,
      /1 accepted/,
    );
    assert.equal(
      fixture.element('[data-action="apply-import"]').disabled,
      false,
    );
  });
}
