import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkspaceLibraryPanel } from './workspaceLibrary.js';
import { createWorkspaceLibrary } from '../workspaces/library.js';
import { createView } from '../view/index.js';
import { WorkspaceRevisionConflict } from '../storage/codec.js';

class Element {
  constructor(selector = '') {
    this.selector = selector;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this._value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.files = [];
  }

  set innerHTML(_value) {}

  get value() {
    return this._value;
  }

  set value(value) {
    const next = String(value);
    if (
      this.selector === '[data-workspace-select]' &&
      !this.children.some((option) => String(option.value) === next)
    ) {
      this._value = '';
      return;
    }
    this._value = next;
  }

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
    if (
      this.selector === '[data-workspace-select]' &&
      !this.children.some((option) => String(option.value) === this._value)
    )
      this._value = '';
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

async function waitFor(predicate, label, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function memoryStorage() {
  const records = new Map();
  const history = new Map();
  const commitAttempts = [];
  let commitGate = null;
  let commitStarted = null;
  let readGate = null;
  return {
    listWorkspaces: async () =>
      [...records.keys()].map((id) => ({
        id,
        kind: 'investigation-workspace',
      })),
    getWorkspace: async (id, { revision } = {}) => {
      const record =
        revision == null
          ? records.get(id) || null
          : history.get(`${id}:${revision}`) || null;
      if (readGate?.matches(id, record)) {
        const gate = readGate;
        readGate = null;
        gate.started.resolve();
        await gate.promise;
      }
      return record;
    },
    commitWorkspace: async ({
      id,
      expectedRevision,
      document,
      chunks,
      assets,
    }) => {
      const attempt = {
        id,
        expectedRevision,
        revision: document.revision,
        latitude: document.view?.camera?.lat,
        chunks,
      };
      commitAttempts.push(attempt);
      if (commitGate) {
        const gate = commitGate;
        commitGate = null;
        commitStarted.resolve();
        await gate.promise;
      }
      const current = records.get(id);
      const currentRevision = current?.manifest.revision || 0;
      if (currentRevision !== expectedRevision)
        throw new WorkspaceRevisionConflict(
          id,
          expectedRevision,
          currentRevision,
        );
      if (current) history.set(`${id}:${currentRevision}`, current);
      const saved = {
        kind: 'investigation-workspace',
        document,
        chunks,
        assets,
        manifest: { revision: document.revision, saved: true, pinned: false },
      };
      records.set(id, saved);
      attempt.completed = true;
      return saved.manifest;
    },
    deleteWorkspace: async (id) => records.delete(id),
    estimate: () => ({ usage: 0, quota: 1 }),
    gateNextCommit() {
      commitGate = deferred();
      commitStarted = deferred();
      return { started: commitStarted.promise, release: commitGate.resolve };
    },
    gateNextRead(matches = () => true) {
      const gate = deferred();
      const started = deferred();
      readGate = { ...gate, matches, started };
      return { started: started.promise, release: gate.resolve };
    },
    records,
    commitAttempts,
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
  let view = createView({ camera: { lat: 12, lon: 34 } });
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
  storage.commitAttempts.length = 0;

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
  const navigation = {
    _navigationGeneration: 0,
    _beginDeferredNavigation() {
      this._navigationGeneration += 1;
      return this._navigationGeneration;
    },
  };
  let renderHandler = async () => {};
  let viewChangeListener = null;
  const queuedApplyBehaviors = [];
  const viewApplyCalls = [];
  const workspaceViewRestores = [];
  const shareLinkManager = {
    getCurrentView: () => view,
    applyView: async (nextView, options = {}) => {
      viewApplyCalls.push({ view: nextView, options });
      const behavior = queuedApplyBehaviors.shift();
      if (behavior) await behavior(nextView, options);
      const gate = applyViewGate;
      applyViewGate = null;
      if (gate) {
        gate.started.resolve();
        await gate.promise;
      }
      if (
        options.navigationToken != null &&
        options.navigationToken !== navigation._navigationGeneration
      )
        return { status: 'superseded' };
      view = nextView;
      return { status: 'applied' };
    },
    subscribeViewChanges: (listener) => {
      viewChangeListener = listener;
      return () => {
        if (viewChangeListener === listener) viewChangeListener = null;
      };
    },
  };
  let applyViewGate = null;
  const panel = createWorkspaceLibraryPanel({
    container,
    storage,
    shareLinkManager,
    navigation,
    shareRestoration: {
      restoreWorkspaceView: async (restoredView, options) => {
        workspaceViewRestores.push({ view: restoredView, options });
        return [];
      },
    },
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
    emitViewChange(nextView) {
      navigation._navigationGeneration += 1;
      view = nextView;
      viewChangeListener?.(nextView);
    },
    gateNextViewApply() {
      const gate = deferred();
      const started = deferred();
      applyViewGate = { ...gate, started };
      return { started: started.promise, release: gate.resolve };
    },
    queueViewApplyBehavior(behavior) {
      queuedApplyBehaviors.push(behavior);
    },
    viewApplyCalls,
    workspaceViewRestores,
    currentView: () => view,
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

async function stagePointImport(fixture) {
  const input = fixture.element('[data-geo-file]');
  input.files = [geoFile('points.geojson', pointCollection('POINT'))];
  await input.dispatch('change');
  await fixture.action('preview-import');
}

function changedView(style = 'retro') {
  return createView({ camera: { lat: 20, lon: 35 }, style });
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

test('superseded workspace rollback passes ownership and skips stale layer restoration', async (t) => {
  const fixture = await createPanel({ workspaceCount: 2 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  assert.ok(
    fixture.workspaceViewRestores[0].options.signal instanceof AbortSignal,
  );
  assert.ok(fixture.workspaceViewRestores[0].options.navigationToken != null);
  fixture.workspaceViewRestores.length = 0;

  const rollbackStarted = deferred();
  const rollbackGate = deferred();
  fixture.queueViewApplyBehavior(async () => {
    throw new Error('workspace view apply failed');
  });
  fixture.queueViewApplyBehavior(async (_view, options) => {
    rollbackStarted.resolve(options);
    await rollbackGate.promise;
  });

  fixture.element('[data-workspace-select]').value = 'workspace-b';
  await fixture.element('[data-workspace-select]').dispatch('change');
  const opening = fixture.action('open', { wait: false });
  const rollbackOptions = await rollbackStarted.promise;
  assert.ok(rollbackOptions.navigationToken != null);
  assert.equal(rollbackOptions.signal, undefined);

  const newerView = createView({ camera: { lat: 45, lon: 90 } });
  fixture.emitViewChange(newerView);
  rollbackGate.resolve();
  await opening;
  await waitFor(
    () => fixture.panel.restore.getState().status === 'superseded',
    'stale workspace rollback to settle as superseded',
  );

  assert.equal(fixture.workspaceViewRestores.length, 0);
  assert.equal(fixture.currentView(), newerView);
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

for (const firstWriter of ['autosave', 'import']) {
  test(`same-panel ${firstWriter}-first and import writes serialize with fresh revisions`, async (t) => {
    const fixture = await createPanel({ workspaceCount: 1 });
    t.after(() => fixture.restoreGlobals());
    await fixture.selectWorkspace('workspace-a');
    await stagePointImport(fixture);
    const gate = fixture.storage.gateNextCommit();
    t.after(() => gate.release());

    if (firstWriter === 'autosave') {
      fixture.emitViewChange(changedView());
      await gate.started;
      assert.equal(fixture.storage.commitAttempts.length, 1);
      await fixture.action('apply-import', { wait: false });
      assert.equal(
        fixture.element('[data-action="cancel-import"]').disabled,
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        fixture.storage.commitAttempts.length,
        1,
        'the import must wait behind the in-flight autosave',
      );
    } else {
      await fixture.action('apply-import', { wait: false });
      await gate.started;
      assert.equal(fixture.storage.commitAttempts.length, 1);
      fixture.emitViewChange(changedView());
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      assert.equal(
        fixture.storage.commitAttempts.length,
        1,
        'the autosave must wait behind the in-flight import',
      );
    }

    gate.release();
    await waitFor(
      () =>
        fixture.storage.commitAttempts.length === 2 &&
        fixture.storage.records.get('workspace-a')?.manifest.revision === 3,
      'both same-panel writes to commit',
    );
    await waitFor(
      () => !fixture.element('[data-action="cancel-import"]').disabled,
      'import UI completion',
    );

    const attempts = fixture.storage.commitAttempts;
    assert.deepEqual(
      attempts.map((attempt) => attempt.expectedRevision),
      [1, 2],
    );
    assert.deepEqual(
      attempts.map((attempt) => attempt.revision),
      [2, 3],
    );
    const saved = fixture.storage.records.get('workspace-a');
    assert.equal(saved.manifest.revision, 3);
    assert.equal(saved.chunks.imports.length, 1);
    assert.equal(saved.document.view.style, 'retro');
  });
}

test('manual Save preserves imported chunks through later autosave and reopen', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  await stagePointImport(fixture);
  await fixture.action('apply-import');

  await fixture.action('save');
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Saved'),
    'manual Save completion',
  );
  assert.equal(
    fixture.storage.records.get('workspace-a').chunks.imports.length,
    1,
  );

  fixture.emitViewChange(changedView('noir'));
  await waitFor(
    () => fixture.storage.records.get('workspace-a').manifest.revision === 4,
    'autosave after manual save',
  );
  await fixture.selectWorkspace('workspace-a');

  const saved = fixture.storage.records.get('workspace-a');
  assert.equal(saved.manifest.revision, 4);
  assert.equal(saved.chunks.imports.length, 1);
  assert.equal(saved.chunks.imports[0].sourceName, 'points.geojson');
  assert.equal(saved.document.view.style, 'noir');
});

test('a queued import is not redirected after the user switches workspaces', async (t) => {
  const fixture = await createPanel({ workspaceCount: 2 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  await stagePointImport(fixture);
  const gate = fixture.storage.gateNextCommit();
  t.after(() => gate.release());
  fixture.emitViewChange(changedView());
  await gate.started;

  await fixture.action('apply-import', { wait: false });
  fixture.element('[data-workspace-select]').value = 'workspace-b';
  await fixture.element('[data-workspace-select]').dispatch('change');
  gate.release();
  await fixture.action('open');
  await waitFor(
    () => fixture.storage.commitAttempts[0]?.completed === true,
    'original workspace autosave to finish',
  );
  await new Promise((resolve) => setTimeout(resolve, 25));

  const first = fixture.storage.records.get('workspace-a');
  const second = fixture.storage.records.get('workspace-b');
  assert.equal(first.manifest.revision, 2);
  assert.equal(first.chunks.imports, undefined);
  assert.equal(second.manifest.revision, 1);
  assert.equal(second.chunks.imports, undefined);
  assert.equal(fixture.storage.commitAttempts.length, 1);
});

test('disposing while an import waits behind a save prevents its queued write', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  await stagePointImport(fixture);
  const gate = fixture.storage.gateNextCommit();
  t.after(() => gate.release());
  fixture.emitViewChange(changedView());
  await gate.started;

  await fixture.action('apply-import', { wait: false });
  fixture.panel.destroy();
  gate.release();
  await waitFor(
    () => fixture.storage.commitAttempts[0]?.completed === true,
    'active save to finish after panel disposal',
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fixture.storage.commitAttempts.length, 1);
  assert.equal(
    fixture.storage.records.get('workspace-a').chunks.imports,
    undefined,
  );
});

test('queued same-panel writes preserve genuine external revision conflicts', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  await stagePointImport(fixture);
  const existing = fixture.storage.records.get('workspace-a');
  const externalWriter = createWorkspaceLibrary({
    storage: fixture.storage,
    now: () => 300,
  });
  await externalWriter.save(
    { ...existing.document, view: changedView('noir') },
    { id: 'workspace-a', expectedRevision: 1 },
  );
  // Refreshing the list must not adopt an external revision into this panel's
  // optimistic owner state and thereby bypass the expected-revision conflict.
  await fixture.panel.refresh();

  await fixture.action('apply-import', { wait: false });
  await waitFor(
    () =>
      fixture
        .element('[data-import-status]')
        .textContent.includes('another tab saved a newer revision'),
    'external revision conflict reporting',
  );

  const saved = fixture.storage.records.get('workspace-a');
  assert.equal(saved.manifest.revision, 2);
  assert.equal(saved.document.view.style, 'noir');
  assert.equal(saved.chunks.imports, undefined);
  assert.equal(fixture.storage.commitAttempts.length, 1);
});

test('external CAS during an in-flight same-panel save remains a conflict', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  await stagePointImport(fixture);
  const gate = fixture.storage.gateNextCommit();
  t.after(() => gate.release());

  await fixture.action('apply-import', { wait: false });
  await gate.started;
  const current = fixture.storage.records.get('workspace-a');
  const externalWriter = createWorkspaceLibrary({
    storage: fixture.storage,
    now: () => 300,
  });
  await externalWriter.save(
    { ...current.document, view: changedView('noir') },
    { id: 'workspace-a', expectedRevision: 1 },
  );
  gate.release();

  await waitFor(
    () =>
      fixture
        .element('[data-import-status]')
        .textContent.includes('another tab saved a newer revision'),
    'concurrent external CAS conflict reporting',
  );
  const saved = fixture.storage.records.get('workspace-a');
  assert.equal(saved.manifest.revision, 2);
  assert.equal(saved.document.view.style, 'noir');
  assert.equal(saved.chunks.imports, undefined);
  assert.equal(fixture.storage.commitAttempts.length, 2);
  assert.deepEqual(
    fixture.storage.commitAttempts.map((attempt) => attempt.expectedRevision),
    [1, 1],
  );
});

test('duplicate followed by Save preserves its imports, saved queries and pinned evidence', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  const source = fixture.storage.records.get('workspace-a');
  const savedQuery = {
    version: 1,
    id: 'query-fixture',
    name: 'Fixture flights',
    updatedAt: 100,
    query: {
      layers: ['flights'],
      scope: { kind: 'anywhere' },
      filters: [],
      sortBy: null,
      sortDir: 'asc',
      limit: 50,
    },
  };
  const pinned = {
    id: 'pin-fixture',
    sourceId: 'flights',
    capturedAt: 100,
    record: { callsign: 'FIXTURE' },
  };
  source.chunks = {
    imports: [{ sourceName: 'saved.geojson', records: [] }],
    savedQueries: [savedQuery],
  };
  source.document = { ...source.document, pinnedEvidence: [pinned] };

  await fixture.action('duplicate', { wait: false });
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Created'),
    'duplicate completion',
  );
  const duplicateId = fixture.element('[data-workspace-select]').value;
  assert.notEqual(duplicateId, 'workspace-a');
  assert.equal(
    fixture
      .element('[data-query-saved]')
      .children.some((option) => option.value === 'query-fixture'),
    true,
  );

  await fixture.action('save');
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Saved'),
    'duplicate Save completion',
  );
  const duplicated = fixture.storage.records.get(duplicateId);
  assert.equal(duplicated.chunks.imports[0].sourceName, 'saved.geojson');
  assert.equal(duplicated.chunks.savedQueries[0].id, 'query-fixture');
  assert.equal(duplicated.document.pinnedEvidence[0].id, 'pin-fixture');
});

test('duplicate publishes complete copied chunks before queued Save can start', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  const source = fixture.storage.records.get('workspace-a');
  source.chunks = {
    imports: [{ sourceName: 'saved.geojson', records: [] }],
    savedQueries: [],
  };
  const copiedRead = fixture.storage.gateNextRead(
    (_id, record) => record?.document.title === 'Workspace 0 copy',
  );

  await fixture.action('duplicate', { wait: false });
  await copiedRead.started;
  await fixture.action('save', { wait: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fixture.storage.commitAttempts.length,
    1,
    'Save must remain queued until the duplicate owner has its copied chunks',
  );
  copiedRead.release();
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Created'),
    'duplicate hydration',
  );
  await fixture.action('save', { wait: false });
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Saved'),
    'Save after duplicate hydration',
  );

  const duplicateId = fixture.element('[data-workspace-select]').value;
  assert.notEqual(duplicateId, 'workspace-a');
  const duplicate = fixture.storage.records.get(duplicateId);
  assert.equal(duplicate.chunks.imports[0].sourceName, 'saved.geojson');
  assert.equal(fixture.storage.commitAttempts.length, 2);
});

test('delete still works for a selected workspace that has not been opened', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  fixture.element('[data-workspace-select]').value = 'workspace-a';
  await fixture.action('delete', { wait: false });
  await waitFor(
    () =>
      fixture.element('[data-status]').textContent === 'Investigation deleted.',
    'selected workspace deletion',
  );
  assert.equal(fixture.storage.records.has('workspace-a'), false);
});

test('recovery waits for an in-flight same-tab autosave before reading its revision', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  const externalWriter = createWorkspaceLibrary({
    storage: fixture.storage,
    now: () => 300,
  });
  const initial = fixture.storage.records.get('workspace-a');
  await externalWriter.save(
    { ...initial.document, view: changedView('noir') },
    { id: 'workspace-a', expectedRevision: 1 },
  );
  fixture.storage.commitAttempts.length = 0;
  await fixture.selectWorkspace('workspace-a');

  const gate = fixture.storage.gateNextCommit();
  t.after(() => gate.release());
  const viewApply = fixture.gateNextViewApply();
  t.after(() => viewApply.release());
  fixture.emitViewChange(changedView('retro'));
  await gate.started;
  fixture.element('[data-revision-select]').value = '1';
  await fixture.action('recover', { wait: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fixture.storage.commitAttempts.length,
    1,
    'recovery must wait behind the active autosave commit',
  );
  gate.release();
  await viewApply.started;
  await fixture.action('save', { wait: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fixture.storage.commitAttempts.length,
    2,
    'Save must wait until recovery has applied and hydrated its view',
  );
  viewApply.release();

  await waitFor(
    () =>
      fixture.element('[data-status]').textContent ===
      'Recovered the selected complete revision as a new current revision.',
    'recovery hydration',
  );
  assert.equal(
    fixture.storage.commitAttempts.length,
    2,
    'the save queued during recovery must not run against the old view',
  );
  await fixture.action('save', { wait: false });
  await waitFor(
    () => fixture.storage.records.get('workspace-a').manifest.revision === 5,
    'Save after recovery view restoration',
  );
  const attempts = fixture.storage.commitAttempts;
  assert.deepEqual(
    attempts.map((attempt) => attempt.expectedRevision),
    [2, 3, 4],
  );
  const saved = fixture.storage.records.get('workspace-a');
  assert.equal(saved.manifest.revision, 5);
  assert.equal(saved.document.view.style, initial.document.view.style);
});

test('recovering a missing historical revision reports missing without false success', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  fixture.element('[data-revision-select]').value = '999';

  await fixture.action('recover', { wait: false });
  await waitFor(
    () =>
      fixture
        .element('[data-status]')
        .textContent.startsWith('Could not open investigation (missing)'),
    'missing recovery result',
  );

  assert.notEqual(
    fixture.element('[data-status]').textContent,
    'Recovered the selected complete revision as a new current revision.',
  );
  assert.equal(fixture.storage.commitAttempts.length, 0);
  assert.equal(fixture.storage.records.get('workspace-a').manifest.revision, 1);
});

test('backup import restores its distinct view before becoming the active save owner', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  const sourceLibrary = createWorkspaceLibrary({
    storage: fixture.storage,
    makeId: () => 'backup-source',
    now: () => 250,
  });
  await sourceLibrary.save({
    title: 'Backup source',
    view: changedView('thermal'),
    filters: {},
    annotations: [],
    pinnedEvidence: [],
    assetRefs: [],
    directorProjectRef: 'director-project-v1',
    chunks: {},
  });
  const backup = await sourceLibrary.exportBackup('backup-source');
  await fixture.selectWorkspace('workspace-a');
  fixture.emitViewChange(changedView('noir'));
  await waitFor(
    () => fixture.storage.records.get('workspace-a').manifest.revision === 2,
    'original view autosave',
  );
  const previousIds = new Set(fixture.storage.records.keys());

  const input = fixture.element('[data-import]');
  input.files = [geoFile('backup.json', backup)];
  await input.dispatch('change');
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Imported'),
    'backup import and normal view restoration',
  );
  const importedId = [...fixture.storage.records.keys()].find(
    (id) => !previousIds.has(id),
  );
  assert.ok(importedId);
  assert.equal(fixture.element('[data-workspace-select]').value, importedId);
  assert.equal(
    fixture
      .element('[data-workspace-select]')
      .children.some((option) => option.value === importedId),
    true,
  );
  assert.equal(fixture.currentView().style, 'thermal');

  await fixture.action('save', { wait: false });
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Saved'),
    'save after backup restoration',
  );
  assert.equal(
    fixture.storage.records.get(importedId).document.view.style,
    'thermal',
  );
});

test('reopening the same workspace hydrates after its in-flight autosave drains', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  const gate = fixture.storage.gateNextCommit();
  t.after(() => gate.release());
  fixture.emitViewChange(changedView('retro'));
  await gate.started;

  await fixture.action('open', { wait: false });
  gate.release();
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Opened'),
    'same-workspace reopen after autosave',
  );
  await fixture.action('save');
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Saved'),
    'save after same-workspace reopen',
  );

  assert.deepEqual(
    fixture.storage.commitAttempts.map((attempt) => attempt.expectedRevision),
    [1, 2],
  );
  assert.equal(fixture.storage.records.get('workspace-a').manifest.revision, 3);
  assert.equal(
    fixture.storage.records.get('workspace-a').document.view.style,
    'retro',
  );
});

test('opening a stale captured view cannot adopt a concurrent external revision', async (t) => {
  const fixture = await createPanel({ workspaceCount: 1 });
  t.after(() => fixture.restoreGlobals());
  await fixture.selectWorkspace('workspace-a');
  const viewApply = fixture.gateNextViewApply();
  t.after(() => viewApply.release());
  await fixture.action('open', { wait: false });
  await viewApply.started;

  const externalWriter = createWorkspaceLibrary({
    storage: fixture.storage,
    now: () => 300,
  });
  const current = fixture.storage.records.get('workspace-a');
  await externalWriter.save(
    { ...current.document, view: changedView('noir') },
    { id: 'workspace-a', expectedRevision: current.manifest.revision },
  );
  viewApply.release();
  await waitFor(
    () => fixture.element('[data-status]').textContent.startsWith('Opened'),
    'open using the view captured before the external save',
  );

  await fixture.action('save', { wait: false });
  await waitFor(
    () =>
      fixture
        .element('[data-status]')
        .textContent.includes('Another tab saved a newer revision'),
    'external revision conflict after stale-view open',
  );
  const saved = fixture.storage.records.get('workspace-a');
  assert.equal(saved.manifest.revision, 2);
  assert.equal(saved.document.view.style, 'noir');
  assert.deepEqual(
    fixture.storage.commitAttempts.map((attempt) => attempt.expectedRevision),
    [1],
  );
});
