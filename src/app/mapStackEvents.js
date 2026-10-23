/** Bridge map controller states to the app-wide map-stack event. */
export function createMapStackEventBridge(eventTarget) {
  let controller = null;
  let disconnect = null;
  let lastSettledGeneration;
  let lastSettledSnapshot = null;

  function dispatch(state, settled = false) {
    const generation = controller?.getSwitchGeneration?.();
    const surfaceOwner = settled
      ? controller?.getImageryHostTileset?.() || null
      : undefined;
    const snapshot = settled
      ? {
          activeId: state?.activeId ?? null,
          lastError: state?.lastError ?? null,
          surfaceOwner,
        }
      : null;
    if (
      settled &&
      (generation != null
        ? generation === lastSettledGeneration &&
          snapshot?.activeId === lastSettledSnapshot?.activeId &&
          snapshot?.lastError === lastSettledSnapshot?.lastError &&
          snapshot?.surfaceOwner === lastSettledSnapshot?.surfaceOwner
        : snapshot?.activeId === lastSettledSnapshot?.activeId &&
          snapshot?.lastError === lastSettledSnapshot?.lastError &&
          snapshot?.surfaceOwner === lastSettledSnapshot?.surfaceOwner)
    )
      return;
    if (settled) {
      lastSettledGeneration = generation;
      lastSettledSnapshot = snapshot;
    }
    const detail = settled
      ? {
          ...state,
          status: state?.lastError ? 'error' : 'ready',
          surfaceOwnerKnown: true,
          surfaceOwner,
        }
      : state;
    eventTarget?.dispatchEvent(
      new CustomEvent('gev:map-stack-changed', { detail }),
    );
  }

  return {
    onChange(state) {
      if (!controller) return;
      dispatch(state, state?.status === 'ready' || state?.status === 'error');
    },
    connect(mapStackController) {
      disconnect?.();
      controller = mapStackController;
      lastSettledGeneration = undefined;
      lastSettledSnapshot = null;
      let active = true;
      const unsubscribe = controller?.subscribe?.((state) => {
        if (active && controller === mapStackController) dispatch(state, true);
      });
      const dispose = () => {
        if (!active) return;
        active = false;
        if (disconnect === dispose) {
          disconnect = null;
          controller = null;
        }
        unsubscribe?.();
      };
      disconnect = dispose;
      return dispose;
    },
  };
}
