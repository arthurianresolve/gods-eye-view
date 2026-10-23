function radioPanelPlacement(doc) {
  if (!doc?.getElementById) return;
  const panel = doc.getElementById('radio-panel');
  const context = doc.getElementById('global-context-panel');
  const dock = doc.getElementById('context-radio-dock');
  const mini = doc.getElementById('context-radio-mini');
  const parent =
    context?.querySelector('.cyber-panel-body') ||
    context?.querySelector('.global-context-panel-inner');
  const header = context?.querySelector('.panel-header');
  if (!panel || !parent || !header || !dock || !mini) return;
  return { panel, parent, header, dock, mini };
}

/** Whether the existing placement sync would leave the DOM unchanged. */
export function isRadioPanelPlacementCurrent(doc) {
  const placement = radioPanelPlacement(doc);
  if (!placement) return true;
  const { panel, parent, header, dock, mini } = placement;
  return (
    panel.parentElement === parent &&
    dock.parentElement === header &&
    mini.parentElement === dock
  );
}

/** Keep Radio in Context in every theme, reusing the same playback controls. */
export function syncRadioPanelPlacement(doc) {
  const placement = radioPanelPlacement(doc);
  if (!placement) return;
  const { panel, parent, header, dock, mini } = placement;
  if (panel.parentElement !== parent) parent.append(panel);
  if (dock.parentElement !== header)
    header.insertBefore(dock, header.querySelector('.panel-collapse-btn'));
  if (mini.parentElement !== dock) dock.append(mini);
}
