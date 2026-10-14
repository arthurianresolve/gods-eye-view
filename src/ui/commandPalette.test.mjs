import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCommandPalette,
  createWorkflowLayoutManager,
  filterCommands,
} from './commandPalette.js';

class FakeElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName;
    this.listeners = new Map();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.value = '';
    this.open = false;
    this.isConnected = true;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || [])
      listener({ target: this, preventDefault() {}, ...event });
  }
  querySelector(selector) {
    return this.queryResults?.get(selector) || null;
  }
  querySelectorAll() {
    return this.children.filter((child) => child.tagName === 'button');
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    this.children.push(...children);
  }
  prepend(child) {
    this.children.unshift(child);
  }
  remove() {
    this.isConnected = false;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  showModal() {
    this.ownerDocument.focusBeforeDialog = this.ownerDocument.activeElement;
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    // Model the native dialog algorithm: restore focus synchronously, then
    // queue the close event as a separate task.
    this.ownerDocument.activeElement = this.ownerDocument.focusBeforeDialog;
    this.ownerDocument.queuedCloseEvents.push(() => this.dispatch('close'));
  }
}

function commandPaletteFixture(commands = []) {
  const documentRef = {
    activeElement: null,
    queuedCloseEvents: [],
    documentListeners: new Map(),
    body: { append() {} },
    createElement(tagName) {
      const element = new FakeElement(this, tagName);
      if (tagName === 'dialog') {
        const search = new FakeElement(this, 'input');
        const results = new FakeElement(this, 'div');
        element.queryResults = new Map([
          ['#gev-command-search', search],
          ['.gev-command-results', results],
        ]);
      }
      return element;
    },
    addEventListener(type, listener) {
      const listeners = this.documentListeners.get(type) || new Set();
      listeners.add(listener);
      this.documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      this.documentListeners.get(type)?.delete(listener);
    },
  };
  const triggerHost = new FakeElement(documentRef, 'div');
  const palette = createCommandPalette({
    commands,
    triggerHost,
    documentRef,
    windowRef: {},
  });
  return {
    documentRef,
    palette,
    trigger: triggerHost.children[0],
    results: palette.dialog.querySelector('.gev-command-results'),
    flushCloseEvent() {
      const event = documentRef.queuedCloseEvents.shift();
      assert.ok(event, 'a native close event should be queued');
      event();
    },
  };
}

test('command search is case-insensitive and explains unavailable commands', () => {
  const commands = [
    {
      label: 'Save workspace',
      description: 'Persist current work',
      availability: (context) =>
        context.storage
          ? true
          : { available: false, reason: 'Local storage is unavailable' },
    },
    { label: 'Clear selected layers', description: 'Turn layers off' },
  ];
  assert.equal(
    filterCommands(commands, 'WORK', { storage: true })[0].label,
    'Save workspace',
  );
  const unavailable = filterCommands(commands, 'save', { storage: false })[0];
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason, /storage is unavailable/);
  assert.deepEqual(filterCommands(commands, 'missing'), []);
});

test('workflow layouts restore panel state and teardown is reversible', () => {
  const panels = new Map();
  for (const id of [
    'control-panel',
    'location-bar',
    'data-panel',
    'evidence-panel',
    'scene-panel',
    'timeline-panel',
  ])
    panels.set(id, {
      id,
      classList: {
        collapsed: id !== 'location-bar',
        contains(name) {
          return name === 'collapsed' && this.collapsed;
        },
        toggle(name, value) {
          if (name === 'collapsed') this.collapsed = value;
        },
      },
    });
  const documentRef = { getElementById: (id) => panels.get(id) || null };
  const styleManager = {
    setPanelCollapsed(id, collapsed) {
      panels.get(id)?.classList.toggle('collapsed', collapsed);
    },
  };
  const before = new Map(
    [...panels].map(([id, panel]) => [id, panel.classList.collapsed]),
  );
  const layout = createWorkflowLayoutManager({ styleManager, documentRef });
  layout.apply('investigate');
  assert.equal(panels.get('evidence-panel').classList.collapsed, false);
  assert.equal(layout.restore(), true);
  assert.deepEqual(
    new Map([...panels].map(([id, panel]) => [id, panel.classList.collapsed])),
    before,
  );
  layout.apply('director');
  layout.destroy();
  assert.deepEqual(
    new Map([...panels].map(([id, panel]) => [id, panel.classList.collapsed])),
    before,
  );
});

test('a delayed native close event does not steal focus from a newly opened inspector', () => {
  let inspectorClose;
  const fixture = commandPaletteFixture([
    {
      label: 'Open evidence inspector',
      run() {
        inspectorClose = new FakeElement(fixture.documentRef, 'button');
        inspectorClose.focus();
      },
    },
  ]);
  fixture.trigger.focus();
  fixture.trigger.dispatch('click');
  fixture.results.children[0].dispatch('click');
  fixture.flushCloseEvent();

  assert.ok(inspectorClose);
  assert.equal(fixture.documentRef.activeElement, inspectorClose);
  fixture.palette.destroy();
});

test('Escape still relies on native close focus restoration', () => {
  const fixture = commandPaletteFixture();
  fixture.trigger.focus();
  fixture.trigger.dispatch('click');
  fixture.palette.dialog.dispatch('keydown', { key: 'Escape' });

  assert.equal(fixture.documentRef.activeElement, fixture.trigger);
  fixture.flushCloseEvent();
  assert.equal(fixture.documentRef.activeElement, fixture.trigger);
  fixture.palette.destroy();
});

test('an old close event cannot steal focus from a reopened palette', () => {
  const fixture = commandPaletteFixture();
  const secondOpener = new FakeElement(fixture.documentRef, 'button');
  fixture.trigger.focus();
  fixture.trigger.dispatch('click');
  fixture.palette.close();
  secondOpener.focus();
  fixture.palette.open();

  const search = fixture.palette.dialog.querySelector('#gev-command-search');
  fixture.flushCloseEvent();

  assert.equal(fixture.documentRef.activeElement, search);
  fixture.palette.close();
  fixture.flushCloseEvent();
  fixture.palette.destroy();
});
