import { adaptFirmsRecords } from '../../data/firmsAdapt.js';
import { fireDetectionKey } from '../../data/firmsLabels.js';

export function createIngestion({
  layerState,
  services,
  components,
  config,
  feed,
}) {
  const { clearSelectedEntityContextForLayer } = services.context;
  const { id } = config;

  /** Replace a validated snapshot while preserving source freshness and selection identity. */

  async function loadHeatmap(targetMs = layerState._investigationTargetMs) {
    if (!layerState._dataSource || !layerState._enabled) return;
    const historical = Number.isFinite(targetMs);
    if (historical && layerState._historyLoadedTargetMs === targetMs) return;
    layerState.request?.abort();
    const request = new AbortController();
    layerState.request = request;
    layerState._loading = true;
    if (historical) layerState._historyStatus = 'loading';
    else if (layerState._needsLiveRefresh) clearHistoricalSnapshot();

    try {
      if (historical && typeof feed.getSnapshotAt !== 'function')
        throw new Error('FIRMS history is unsupported by this source');
      const payload = historical
        ? await feed.getSnapshotAt(targetMs, { signal: request.signal })
        : await feed.getSnapshot({ signal: request.signal });
      if (
        request.signal.aborted ||
        layerState.request !== request ||
        !layerState._enabled
      )
        return;
      if (payload.keyRequired) {
        layerState._keyRequired = true;
        layerState._error = null;
        layerState._stale = false;
        if (historical) {
          layerState._historyStatus = 'unavailable';
          layerState._historyLoadedTargetMs = targetMs;
          clearHistoricalSnapshot();
        }
        return;
      }
      layerState._keyRequired = false;
      layerState._error = null;
      layerState._stale = Boolean(payload?.stale);
      layerState._receivedAt = Date.now();
      layerState._missingSources = Array.isArray(payload?.sources)
        ? payload.sources
            .filter((source) => source?.ok === false)
            .map((source) => source.source)
            .filter((source) => typeof source === 'string')
            .slice(0, 8)
        : [];
      const previousSelection = layerState._selectedFire;
      layerState._selectedFire = null;
      layerState._fires = adaptFirmsRecords(payload?.fires);
      layerState._cellCacheByGrid.clear(); // aggregation is per-dataset — new fires, new cells
      layerState._firesByFrp = [...layerState._fires].sort(
        (a, b) => b.frp - a.frp,
      );
      layerState._count = layerState._fires.length;
      // Data age, not response age: a stale proxy payload truthfully reads old.
      layerState._lastUpdate = Number.isFinite(payload?.fetchedAt)
        ? payload.fetchedAt
        : Date.now();
      layerState._historyLoadedTargetMs = historical ? targetMs : null;
      layerState._historyStatus = historical ? 'available' : null;
      layerState._historyEffectiveTime = historical
        ? (payload?.window?.to ?? targetMs)
        : null;
      layerState._historyWindow = historical ? (payload?.window ?? null) : null;
      if (!historical) layerState._needsLiveRefresh = false;
      // Settle the previous selection BEFORE the LOD rebuild. renderCurrentLod
      // runs refreshContextRegistrations(), which deletes every context record
      // not in the new top-N — including the one the store still points at.
      // Clearing after that deletion fails the ownership guard inside
      // clearSelectedEntityContextForLayer and emits nothing at all, so an
      // eviction-aware readout never hears that its subject is gone.
      const reselected = findMatchingFire(previousSelection);
      if (!reselected && previousSelection) {
        // The selected detection is not in the new payload: it left the feed
        // rather than being deselected. Eviction-aware readouts hold their
        // last-known values for this instead of tearing down.
        clearSelectedEntityContextForLayer(id, { evicted: true });
      }
      components.rendering.renderCurrentLod(true);
      if (reselected) components.selection.selectFire(reselected, false);
    } catch (error) {
      if (
        request.signal.aborted ||
        layerState.request !== request ||
        !layerState._enabled
      )
        return;
      console.warn(
        `[Data:${id}] FIRMS ${historical ? 'history' : 'live'} load failed:`,
        error,
      );
      layerState._error = historical
        ? 'historical data unavailable'
        : 'live feed unavailable';
      if (historical) {
        layerState._historyStatus = 'unavailable';
        layerState._historyLoadedTargetMs = targetMs;
        clearHistoricalSnapshot();
      }
    } finally {
      if (layerState.request === request) {
        layerState.request = null;
        layerState._loading = false;
      }
    }
  }

  function clearHistoricalSnapshot() {
    layerState._selectedFire = null;
    layerState._fires = [];
    layerState._firesByFrp = [];
    layerState._cellCacheByGrid.clear();
    layerState._count = 0;
    layerState._missingSources = [];
    layerState._historyWindow = null;
    components.selection.clearFireSelection();
    clearSelectedEntityContextForLayer(id);
    components.rendering.renderCurrentLod(true);
  }

  /**
   * Find the record in the freshly-loaded set matching a previous selection.
   * Identity is the detection itself (lat/lon/acquisition time) — indices
   * are regenerated every fetch, so object/index identity cannot be used.
   * @param {?Object} previous - Previously selected fire record.
   * @returns {?Object} Matching new record.
   */

  function findMatchingFire(previous) {
    if (!previous) return null;
    const key = fireDetectionKey(previous);
    return (
      layerState._fires.find((fire) => fireDetectionKey(fire) === key) || null
    );
  }
  const methods = {
    async update() {
      if (layerState._destroyed || !layerState._enabled || layerState._loading)
        return;
      if (
        Number.isFinite(layerState._investigationTargetMs) &&
        layerState._historyLoadedTargetMs === layerState._investigationTargetMs
      )
        return;
      // Scheduled 10-minute poll (and the manager's immediate first update):
      // refresh the selected live or historical window. Viewport-driven
      // re-renders between polls are handled by the LOD watcher.
      await loadHeatmap();
    },
  };

  return { loadHeatmap, findMatchingFire, methods };
}
