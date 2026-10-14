/** Whether an enabled aircraft layer still has visuals driven by fleet frames. */
export function hasFleetRenderDemand(flightState) {
  return Boolean(
    flightState?._billboards?.size ||
    flightState?._models?.size ||
    flightState?._trackedEntity ||
    flightState?._trackedModel ||
    flightState?._trailHeadEntity,
  );
}

/** Reconcile one fleet owner's hold with its enabled state and live visuals. */
export function syncFleetRenderDemand({ flightState, render, owner, enabled }) {
  const needed = Boolean(enabled && hasFleetRenderDemand(flightState));
  if (needed) render.holdContinuousRender?.(owner);
  else render.releaseContinuousRender?.(owner);
  return needed;
}
