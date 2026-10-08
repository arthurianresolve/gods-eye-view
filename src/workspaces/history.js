const DEFAULT_MAX_ENTRIES = 80;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function snapshot(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string')
    throw new TypeError('History values must be serializable.');
  return {
    value: JSON.parse(json),
    bytes: new TextEncoder().encode(json).byteLength,
  };
}

/** Keep bounded authored-state snapshots isolated by workspace identity. */
export function createWorkspaceHistory({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const entryLimit = Math.max(
    2,
    Math.min(500, Math.floor(maxEntries) || DEFAULT_MAX_ENTRIES),
  );
  const byteLimit = Math.max(
    1024,
    Math.min(16 * 1024 * 1024, Math.floor(maxBytes) || DEFAULT_MAX_BYTES),
  );
  const workspaces = new Map();
  let currentId = null;

  function current() {
    return currentId ? workspaces.get(currentId) : null;
  }
  function trim(state) {
    while (
      state.entries.length > 1 &&
      (state.entries.length > entryLimit || state.bytes > byteLimit)
    ) {
      const removed = state.entries.shift();
      state.bytes -= removed.bytes;
      state.cursor = Math.max(0, state.cursor - 1);
    }
  }

  const api = {
    bindWorkspace(id, initialValue) {
      const key = String(id || '').trim() || null;
      currentId = key;
      if (!key) return;
      if (!workspaces.has(key)) api.reset(initialValue);
    },
    record(value) {
      const state = current();
      if (!state) return false;
      const next = snapshot(value);
      if (next.bytes > byteLimit) return false;
      const json = JSON.stringify(next.value);
      if (state.entries[state.cursor]?.json === json) return false;
      state.entries.splice(state.cursor + 1);
      state.bytes = state.entries.reduce((sum, entry) => sum + entry.bytes, 0);
      next.json = json;
      state.entries.push(next);
      state.bytes += next.bytes;
      state.cursor = state.entries.length - 1;
      trim(state);
      return true;
    },
    undo() {
      const state = current();
      if (!state || state.cursor <= 0) return null;
      state.cursor--;
      return snapshot(state.entries[state.cursor].value).value;
    },
    redo() {
      const state = current();
      if (!state || state.cursor >= state.entries.length - 1) return null;
      state.cursor++;
      return snapshot(state.entries[state.cursor].value).value;
    },
    canUndo() {
      return Boolean(current() && current().cursor > 0);
    },
    canRedo() {
      return Boolean(
        current() && current().cursor < current().entries.length - 1,
      );
    },
    reset(value) {
      if (!currentId) return;
      if (value === undefined) {
        workspaces.delete(currentId);
        return;
      }
      const initial = snapshot(value);
      initial.json = JSON.stringify(initial.value);
      workspaces.set(currentId, {
        entries: [initial],
        cursor: 0,
        bytes: initial.bytes,
      });
    },
    forget(id) {
      workspaces.delete(String(id));
    },
    getState() {
      const state = current();
      return Object.freeze({
        workspaceId: currentId,
        undoDepth: state ? state.cursor : 0,
        redoDepth: state ? state.entries.length - state.cursor - 1 : 0,
        entries: state?.entries.length || 0,
        bytes: state?.bytes || 0,
        maxEntries: entryLimit,
        maxBytes: byteLimit,
      });
    },
  };
  return Object.freeze(api);
}
