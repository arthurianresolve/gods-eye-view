/** Bridge map controller states to the app-wide map-stack event. */
export function createMapStackEventBridge(eventTarget) {
  let controller = null;
  let unsubscribe = null;
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
      dispatch(state, state?.status === 'ready' || state?.status === 'error');
    },
    connect(mapStackController) {
      unsubscribe?.();
      controller = mapStackController;
      unsubscribe = controller?.subscribe?.((state) => dispatch(state, true));
      return () => {
        unsubscribe?.();
        unsubscribe = null;
        if (controller === mapStackController) controller = null;
      };
    },
  };
}
