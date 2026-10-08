import { fireDetectionKey } from '../../data/firmsLabels.js';
import { createFirmsEvidence } from './evidence.js';
import { FIRMS_HISTORY_MAX_AGE_MS } from './source.js';
import { REFRESH_INTERVAL_MS } from './policy.js';

export function createQueries({
  layerState,
  services,
  components,
  config,
  feed,
}) {
  const { id, name, icon, source } = config;

  const methods = {
    /** Return the selected detection as a plain record for application consumers. */
    getSelectedInfo() {
      const fire = layerState._selectedFire;
      if (!fire) return null;
      return {
        id: fireDetectionKey(fire),
        label: `Fire · FRP ${components.model.formatFrp(fire.frp)} MW`,
        latitude: fire.lat,
        longitude: fire.lon,
        frp: fire.frp,
        confidencePct: Number.isFinite(fire.confidence)
          ? fire.confidence * 100
          : null,
        observedAt:
          Number.isFinite(fire.acqMs) && fire.acqMs > 0 ? fire.acqMs : null,
        source: fire.sensor || fire.satellite || null,
        evidence: createFirmsEvidence(fire, evidenceOptions()),
      };
    },

    id,

    name,

    icon,

    source,

    // The one data-layer control a provider key gates: the proxy answers
    // 503 {error:'no_key'} without a FIRMS key. Declared as a key-registry id
    // rather than an env-var string, so the panel can name the key from the
    // one place that owns what each key is called.
    requiresKeyId: 'firms',

    // Live layer: the manager calls update() every 10 minutes while enabled,
    // which refetches through the /api/firms proxy (the proxy's 30 min TTL —
    // not this interval — is what protects the upstream FIRMS quota).
    updateInterval: REFRESH_INTERVAL_MS,

    attachInvestigationTime(clock, capabilities = null) {
      if (!clock?.subscribe)
        throw new TypeError('An investigation clock is required');
      const removeCapability =
        typeof feed.getSnapshotAt === 'function' && capabilities?.register
          ? capabilities.register({
              id,
              mode: 'provider-history',
              label: 'NASA FIRMS active-fire detections',
              coverage: {
                from: Date.now() - FIRMS_HISTORY_MAX_AGE_MS,
                to: Date.now(),
              },
              selectAt: async ({ targetMs, signal }) => {
                const snapshot = await feed.getSnapshotAt(targetMs, { signal });
                if (snapshot?.keyRequired) return null;
                return {
                  sampleTimeMs: snapshot.window?.to,
                  selectedTimeMs: targetMs,
                  timeBasis: 'acquisition-time-window',
                  window: snapshot.window,
                  eventCount: snapshot.fires?.length ?? 0,
                  stale: snapshot.stale === true,
                  partial: (snapshot.sources || []).some(
                    (entry) => entry?.ok === false,
                  ),
                };
              },
            })
          : () => {};
      const remove = clock.subscribe((state) => {
        const next =
          state.mode === 'live' || !Number.isFinite(state.timeMs)
            ? null
            : Math.floor(state.timeMs / 60_000) * 60_000;
        if (next === layerState._investigationTargetMs) return;
        const wasHistorical = Number.isFinite(
          layerState._investigationTargetMs,
        );
        layerState.request?.abort();
        layerState.request = null;
        layerState._investigationTargetMs = next;
        layerState._historyLoadedTargetMs = null;
        layerState._needsLiveRefresh = next === null && wasHistorical;
        layerState._historyStatus = next === null ? null : 'loading';
        layerState._historyEffectiveTime =
          next === null ? null : new Date(next).toISOString();
        if (layerState._enabled) void components.ingestion.loadHeatmap(next);
      });
      return () => {
        removeCapability();
        remove();
        layerState.request?.abort();
        layerState.request = null;
      };
    },

    /**
     * Layer stats for the data panel. Degraded feed states surface through
     * `error` (established qa-failstate pattern: a dead feed must never look
     * like a healthy empty layer) with a matching human `loadingLabel`:
     * 'LIVE · updated Xm ago' fresh, 'STALE · cached Xh' when the proxy
     * served past-TTL cache, 'KEY REQUIRED' keyless.
     */
    getStats() {
      const now = Date.now();
      const staleText = layerState._lastUpdate
        ? `STALE · cached ${components.model.formatAge(now - layerState._lastUpdate) || '<1h'}`
        : 'STALE';
      let loadingLabel = '';
      if (
        Number.isFinite(layerState._investigationTargetMs) &&
        layerState._historyStatus === 'loading'
      ) {
        loadingLabel = 'HISTORY · loading';
      } else if (layerState._loading) {
        loadingLabel = layerState._fires.length
          ? 'refreshing...'
          : 'loading...';
      } else if (layerState._keyRequired) {
        loadingLabel = 'KEY REQUIRED';
      } else if (Number.isFinite(layerState._investigationTargetMs)) {
        loadingLabel =
          layerState._historyStatus === 'available'
            ? `HISTORY · ${new Date(layerState._historyEffectiveTime).toISOString()}`
            : layerState._historyStatus === 'unavailable'
              ? 'HISTORY · unavailable'
              : 'HISTORY · loading';
      } else if (layerState._stale) {
        loadingLabel = staleText;
      } else if (layerState._error) {
        loadingLabel = layerState._error;
      } else if (layerState._lastUpdate) {
        loadingLabel = `LIVE · updated ${components.model.formatAgoMinutes(now - layerState._lastUpdate)}`;
      }
      return {
        count: layerState._count,
        cells: layerState._cellCount,
        lastUpdate: layerState._lastUpdate,
        loading: layerState._loading,
        stale: layerState._stale,
        partial: layerState._missingSources.length > 0,
        source: 'NASA FIRMS',
        receivedAt: layerState._receivedAt,
        // The machine-readable half of the keyless state, ahead of the human
        // strings below: without it "no key configured" is indistinguishable
        // from a broken feed, and the row reads as a fault instead of a step
        // the operator can take.
        keyRequired: layerState._keyRequired,
        historyStatus: layerState._historyStatus,
        historyTarget: layerState._investigationTargetMs,
        historyEffectiveTime: layerState._historyEffectiveTime,
        historyWindow: layerState._historyWindow,
        error: layerState._keyRequired
          ? 'KEY REQUIRED'
          : layerState._stale
            ? staleText
            : layerState._error,
        loadingLabel,
      };
    },

    /**
     * Strongest currently-loaded detection (by FRP) for voice targeting
     * ("take me to the biggest fire").
     * @returns {{latitude: number, longitude: number, frp: number, label: string}|null}
     */
    getStrongestFire() {
      const strongest = layerState._firesByFrp.length
        ? layerState._firesByFrp[0]
        : null;
      if (!strongest) return null;
      return {
        latitude: strongest.lat,
        longitude: strongest.lon,
        frp: strongest.frp,
        label: `Fire · FRP ${components.model.formatFrp(strongest.frp)} MW`,
      };
    },

    /**
     * Detection-overlay seam, shaped like the other layers' detectable
     * objects (traffic/flights). NOT yet registered in initDetection's layer
     * list — wiring fires through the detection/label-arbiter pipeline is a
     * deliberate post-PR#1 task; when that happens the arbiter replaces this
     * layer's greedy declutter as the SELECTOR and the shared overlay remains
     * the renderer. Walks the FRP-sorted index so the strongest fires come first.
     * @param {{maxCount?: number}} [options]
     * @returns {Array<{position: Cesium.Cartesian3, id: string, type: string}>}
     */
    getDetectableObjects(options = {}) {
      if (!layerState._enabled || !layerState._firesByFrp.length) return [];
      const maxCount = Number.isFinite(options.maxCount)
        ? Math.max(1, Math.floor(options.maxCount))
        : 250;
      const result = [];
      for (const fire of layerState._firesByFrp) {
        result.push({
          position: components.model.firePosition(fire),
          id: `FIRE-${String(fire.index).padStart(5, '0')}`,
          type: 'FIRE',
        });
        if (result.length >= maxCount) break;
      }
      return result;
    },

    /**
     * Snapshot the layer's in-memory fire records as plain JSON-safe
     * objects for the analyst query engine. Walks the FRP-sorted index so
     * truncation keeps the STRONGEST fires (200k+ detections can be live —
     * the cap is load-bearing, not cosmetic). On-demand only (called at
     * most once per spoken query) — zero per-frame cost, no listeners, no
     * caching. Returns [] while the layer is disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!layerState._enabled || !layerState._firesByFrp.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const fire of layerState._firesByFrp) {
        const record = components.model.mapAnalystRecord(fire);
        record.evidence = createFirmsEvidence(fire, {
          ...evidenceOptions(),
          truncated: layerState._firesByFrp.length > limit,
        });
        result.push(record);
        if (result.length >= limit) break;
      }
      return result;
    },

    /** Test seam that binds the production click path and indexes. */
    _bindInteractionForTest(viewer, fires = []) {
      layerState._viewer = viewer;
      layerState._enabled = true;
      layerState._fires = fires;
      layerState._firesByFrp = [...fires];
      layerState._pickIndexById.clear();
      layerState._labelLodDistance = 1e7;
      layerState._labelCandidates = fires.map((fire) => {
        layerState._pickIndexById.set(`firms-${fire.index}`, fire);
        return { fire, position: components.model.firePosition(fire) };
      });
      components.cards.rebuildAmbientLabels();
      components.selection.installClickHandler();
      return layerState._clickHandler;
    },
  };

  function evidenceOptions() {
    return {
      receivedAt: layerState._receivedAt,
      snapshotAt: layerState._lastUpdate,
      displayTime: layerState._historyEffectiveTime,
      historyWindow: layerState._historyWindow,
      feedState: layerState._keyRequired
        ? 'unavailable'
        : layerState._stale
          ? 'stale'
          : layerState._error
            ? 'degraded'
            : 'nominal',
      missingSources: layerState._missingSources,
    };
  }

  return { methods };
}
