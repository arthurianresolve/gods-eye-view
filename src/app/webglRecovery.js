/** Offer an explicit reload when the Cesium drawing context is lost. */
export function installWebGlRecovery(
  viewer,
  {
    documentTarget = globalThis.document,
    locationTarget = globalThis.location,
    getRecoveryUrl = () => locationTarget?.href || null,
  } = {},
) {
  const canvas = viewer?.scene?.canvas || viewer?.canvas;
  const status = documentTarget?.getElementById?.('webgl-recovery-status');
  const message = documentTarget?.getElementById?.('webgl-recovery-message');
  const reloadButton = documentTarget?.getElementById?.(
    'webgl-recovery-reload',
  );
  if (
    !canvas?.addEventListener ||
    !status ||
    !message ||
    !reloadButton?.addEventListener
  )
    return () => {};

  let active = true;
  const onContextLost = (event) => {
    event.preventDefault?.();
    if (!active) return;
    status.dataset.state = 'lost';
    message.textContent =
      '3D graphics were interrupted. Reload to restore this view.';
    status.hidden = false;
  };
  const onReload = () => {
    if (!active) return;
    let recoveryUrl = null;
    try {
      recoveryUrl = getRecoveryUrl();
    } catch {
      // Fall back to the current address if a state serializer is unavailable.
    }
    try {
      if (typeof recoveryUrl === 'string' && recoveryUrl)
        locationTarget?.assign?.(recoveryUrl);
      else locationTarget?.reload?.();
    } catch {
      locationTarget?.reload?.();
    }
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  reloadButton.addEventListener('click', onReload);
  return () => {
    if (!active) return;
    active = false;
    canvas.removeEventListener('webglcontextlost', onContextLost);
    reloadButton.removeEventListener('click', onReload);
    status.hidden = true;
    delete status.dataset.state;
  };
}
