export function createTesting({ state: layerState, services, parts, source }) {
  /** Test seam for real layer lifecycle coverage with a recording host. */

  function _setRocketMissionOverlayHostForTest(host = null) {
    layerState._missionOverlayHost = host
      ? { ...layerState.DEFAULT_OVERLAY_HOST, ...host }
      : layerState.DEFAULT_OVERLAY_HOST;
  }

  /** Test seam that exercises the real selection/deselection path. */

  function _setSelectedRocketMissionForTest(launchId = null) {
    parts.selection.setSelectedMission(launchId, Boolean(launchId));
  }

  function _observeRocketRenderInvalidationForTest(onInvalidate) {
    const demand = parts.renderDemand;
    const invalidate = demand.invalidate;
    demand.invalidate = (...args) => {
      onInvalidate?.();
      return invalidate.apply(demand, args);
    };
    return () => {
      demand.invalidate = invalidate;
    };
  }

  function _previewRocketMissionForTest(index) {
    parts.panel.scheduleMissionRosterPreview(index);
  }

  function _clearRocketMissionPreviewForTest() {
    parts.panel.clearMissionRosterPreviewState();
  }
  return {
    _setRocketMissionOverlayHostForTest,
    _setSelectedRocketMissionForTest,
    _observeRocketRenderInvalidationForTest,
    _previewRocketMissionForTest,
    _clearRocketMissionPreviewForTest,
  };
}
