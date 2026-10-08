import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkflowLayoutManager,
  filterCommands,
} from './commandPalette.js';

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
