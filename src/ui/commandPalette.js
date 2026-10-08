export const WORKFLOW_LAYOUTS = Object.freeze({
  explore: Object.freeze(['control-panel', 'location-bar']),
  investigate: Object.freeze(['location-bar', 'data-panel', 'evidence-panel']),
  director: Object.freeze(['scene-panel', 'timeline-panel']),
});

/** Search a curated list while keeping unavailable actions visible with reasons. */
export function filterCommands(commands, query, context = {}) {
  const needle = String(query || '')
    .trim()
    .toLocaleLowerCase();
  return commands
    .filter(
      (command) =>
        !needle ||
        `${command.label} ${command.description || ''} ${command.keywords || ''}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .map((command) => {
      const state =
        typeof command.availability === 'function'
          ? command.availability(context)
          : (command.availability ?? true);
      const available =
        typeof state === 'object' ? state.available !== false : state !== false;
      return {
        ...command,
        available,
        reason: typeof state === 'object' ? state.reason || '' : '',
      };
    });
}

/** Preserve the current panel arrangement across temporary Explore/Investigate/Director layouts. */
export function createWorkflowLayoutManager({
  styleManager,
  documentRef = document,
} = {}) {
  const ids = [...new Set(Object.values(WORKFLOW_LAYOUTS).flat())];
  const baseline = new Map();
  let active = null;
  let applying = false;
  const states = () =>
    new Map(
      ids.map((id) => [
        id,
        documentRef.getElementById(id)?.classList.contains('collapsed') ?? true,
      ]),
    );
  const applyStates = (next) => {
    applying = true;
    try {
      for (const [id, collapsed] of next)
        styleManager?.setPanelCollapsed?.(id, collapsed, {
          persist: false,
          syncShare: false,
        });
    } finally {
      applying = false;
    }
  };
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver((changes) => {
          if (!active || applying) return;
          for (const change of changes) {
            const id = change.target.id;
            if (ids.includes(id))
              baseline.set(id, change.target.classList.contains('collapsed'));
          }
        })
      : null;
  for (const id of ids) {
    const panel = documentRef.getElementById(id);
    if (panel)
      observer?.observe(panel, {
        attributes: true,
        attributeFilter: ['class'],
      });
  }
  return Object.freeze({
    get active() {
      return active;
    },
    apply(name) {
      if (!Object.hasOwn(WORKFLOW_LAYOUTS, name))
        throw new TypeError(`Unknown workflow layout: ${name}`);
      if (!active) for (const [id, value] of states()) baseline.set(id, value);
      active = name;
      const visible = new Set(WORKFLOW_LAYOUTS[name]);
      applyStates(new Map(ids.map((id) => [id, !visible.has(id)])));
      return name;
    },
    restore() {
      if (!active) return false;
      const previous = new Map(baseline);
      active = null;
      applyStates(previous);
      baseline.clear();
      return true;
    },
    destroy() {
      observer?.disconnect();
      if (active) {
        applying = true;
        for (const [id, collapsed] of baseline)
          styleManager?.setPanelCollapsed?.(id, collapsed, {
            persist: false,
            syncShare: false,
          });
        applying = false;
      }
      active = null;
      baseline.clear();
    },
  });
}

/** Install the searchable command palette and the workflow presets. */
export function createCommandPalette({
  commands = [],
  context = {},
  triggerHost = document.querySelector('#top-center-actions'),
  documentRef = document,
  windowRef = window,
} = {}) {
  const dialog = documentRef.createElement('dialog');
  dialog.className = 'gev-command-palette';
  dialog.setAttribute('aria-labelledby', 'gev-command-title');
  dialog.innerHTML = `<form method="dialog"><header><h2 id="gev-command-title">Search commands</h2><button aria-label="Close command palette" value="close">×</button></header><label for="gev-command-search">Find an action</label><input id="gev-command-search" type="search" autocomplete="off" /><p class="gev-command-hint">Type to filter · Escape closes</p><div class="gev-command-results" role="listbox" aria-label="Available commands"></div></form>`;
  documentRef.body.append(dialog);
  const search = dialog.querySelector('#gev-command-search');
  const results = dialog.querySelector('.gev-command-results');
  const trigger = documentRef.createElement('button');
  trigger.type = 'button';
  trigger.className = 'gev-command-trigger';
  trigger.setAttribute('aria-label', 'Search commands');
  trigger.title = 'Search commands (Ctrl+K)';
  trigger.textContent = '⌕';
  triggerHost?.prepend(trigger);
  let returnFocus = null;
  let currentEntries = [];
  function render() {
    currentEntries = filterCommands(commands, search.value, context);
    results.replaceChildren();
    for (const [index, command] of currentEntries.entries()) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'gev-command-option';
      button.role = 'option';
      button.dataset.index = String(index);
      button.disabled = !command.available;
      const name = documentRef.createElement('strong');
      name.textContent = command.label;
      const description = documentRef.createElement('span');
      description.textContent = command.available
        ? command.description || ''
        : command.reason || 'Unavailable';
      button.append(name, description);
      button.addEventListener('click', async () => {
        if (!command.available) return;
        dialog.close('command');
        await command.run?.(context);
      });
      results.append(button);
    }
    if (!currentEntries.length) {
      const empty = documentRef.createElement('p');
      empty.textContent = 'No matching commands.';
      results.append(empty);
    }
  }
  function open() {
    if (dialog.open) return;
    returnFocus = documentRef.activeElement;
    search.value = '';
    render();
    dialog.showModal();
    search.focus();
  }
  const onKey = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      if (
        event.target?.matches?.(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      event.preventDefault();
      open();
    }
  };
  const onClose = () => {
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };
  const onDialogKeyDown = (event) => {
    if (event.key !== 'Escape' || !dialog.open) return;
    event.preventDefault();
    dialog.close('escape');
  };
  search.addEventListener('input', render);
  dialog.addEventListener('keydown', onDialogKeyDown);
  search.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const options = [...results.querySelectorAll('button:not(:disabled)')];
    if (!options.length) return;
    const index = options.indexOf(documentRef.activeElement);
    options[
      (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) %
        options.length
    ].focus();
  });
  trigger.addEventListener('click', open);
  dialog.addEventListener('close', onClose);
  documentRef.addEventListener('keydown', onKey);
  render();
  return Object.freeze({
    dialog,
    open,
    close: () => dialog.open && dialog.close(),
    refresh: render,
    destroy() {
      documentRef.removeEventListener('keydown', onKey);
      trigger.removeEventListener('click', open);
      dialog.removeEventListener('keydown', onDialogKeyDown);
      dialog.removeEventListener('close', onClose);
      trigger.remove();
      dialog.remove();
    },
  });
}
