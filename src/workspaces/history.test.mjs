import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHistory } from './history.js';

test('workspace history bounds snapshots, isolates workspaces, and drops redo after edits', () => {
  const history = createWorkspaceHistory({ maxEntries: 3, maxBytes: 4096 });
  history.bindWorkspace('one', { label: 'initial' });
  history.record({ label: 'second' });
  history.record({ label: 'third' });
  history.record({ label: 'fourth' });
  assert.equal(history.getState().entries, 3);
  assert.deepEqual(history.undo(), { label: 'third' });
  assert.deepEqual(history.redo(), { label: 'fourth' });
  history.undo();
  history.record({ label: 'replacement' });
  assert.equal(history.canRedo(), false);
  history.bindWorkspace('two', { label: 'other workspace' });
  assert.equal(history.canUndo(), false);
  assert.deepEqual(history.undo(), null);
  history.bindWorkspace('one', {
    label: 'ignored while existing history remains',
  });
  assert.equal(history.canUndo(), true);
});

test('history ignores oversized snapshots and returns defensive copies', () => {
  const history = createWorkspaceHistory({ maxBytes: 1024 });
  history.bindWorkspace('one', { label: 'start' });
  assert.equal(history.record({ label: 'x'.repeat(2048) }), false);
  assert.equal(history.canUndo(), false);
  const source = { nested: { value: 1 } };
  history.record(source);
  source.nested.value = 9;
  history.undo();
  const value = history.redo();
  value.nested.value = 8;
  history.undo();
  assert.deepEqual(history.redo(), { nested: { value: 1 } });
});
