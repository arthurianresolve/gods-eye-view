import { VESSEL_OVERLAY_SOURCE_ID } from '../../data/vesselLabels.js';
import {
  AIS_FIRST_CONNECT_GRACE_MS,
  AIS_FIRST_CONNECT_LABEL,
  AIS_HEALTHY_STATUSES,
  FOCUS_UPDATE_MS,
  VISIBILITY_UPDATE_MS,
} from './policy.js';

export function createLifecycle({
  vesselState,
  services,
  parts: components,
  layer,
  options,
}) {
  const { state } = vesselState;
  const { restoreSpriteOrder, restoreSpriteOrderOnEnable } = services.sprites;
  const { holdContinuousRender, releaseContinuousRender } = services.render;
  const scheduleRenderUpdate = services.render?.scheduleRenderUpdate;
  const { ensureGeoidReady } = services.geoid;
  const { registerPickOwner, unregisterPickOwner } = services.picking;
  const periodicRenderOwner = Symbol('ais-vessels-periodic');
  let periodicRenderDisposer = null;
  let periodicRenderDueAt = null;
  let removeFocusTargetListener = null;

  function stopPeriodicRenderDemand() {
    periodicRenderDisposer?.();
    periodicRenderDisposer = null;
    periodicRenderDueAt = null;
  }

  function schedulePeriodicRenderDemand(dueAt, replace = false) {
    if (!state.feed.enabled || typeof scheduleRenderUpdate !== 'function')
      return;
    if (periodicRenderDisposer && !replace && periodicRenderDueAt === dueAt)
      return;
    stopPeriodicRenderDemand();
    periodicRenderDueAt = dueAt;
    const now =
      services.focus?.focusNowMs?.(performance.now()) ?? performance.now();
    periodicRenderDisposer = scheduleRenderUpdate(
      periodicRenderOwner,
      () => {
        periodicRenderDisposer = null;
        periodicRenderDueAt = null;
        if (!state.feed.enabled) return;
        components.rendering.updateVisibility();
      },
      Math.max(0, dueAt - now),
    );
  }

  function syncPeriodicRenderDemand() {
    if (typeof scheduleRenderUpdate !== 'function') return;
    if (!state.feed.enabled || !state.records.all.length) {
      stopPeriodicRenderDemand();
      return;
    }
    const focusTarget = services.focus?.getFocusTarget?.() || null;
    const focusActive =
      state.focusTransitioning ||
      services.focus?.focusPassIsNeeded?.(focusTarget, state.activeFocusCount);
    const visibilityDueAt = state.lastVisibilityUpdate + VISIBILITY_UPDATE_MS;
    const focusDueAt = focusActive
      ? state.lastFocusUpdate + FOCUS_UPDATE_MS
      : Number.POSITIVE_INFINITY;
    schedulePeriodicRenderDemand(Math.min(visibilityDueAt, focusDueAt));
  }

  function startPeriodicRenderDemand() {
    if (typeof scheduleRenderUpdate !== 'function') {
      holdContinuousRender('ais-vessels');
      return;
    }
    releaseContinuousRender('ais-vessels');
    if (!removeFocusTargetListener) {
      removeFocusTargetListener = services.focus?.onFocusTargetChange?.(() => {
        if (state.feed.enabled && state.records.all.length)
          schedulePeriodicRenderDemand(
            services.focus?.focusNowMs?.(performance.now()) ??
              performance.now(),
            true,
          );
      });
    }
    if (state.records.all.length)
      schedulePeriodicRenderDemand(
        services.focus?.focusNowMs?.(performance.now()) ?? performance.now(),
        true,
      );
  }

  function stopVesselRenderDemand() {
    stopPeriodicRenderDemand();
    removeFocusTargetListener?.();
    removeFocusTargetListener = null;
    releaseContinuousRender('ais-vessels');
  }

  function clearFirstConnectTimer() {
    if (state.feed.firstConnectTimer === null) return;
    vesselState._aisRuntime.clearTimeout(state.feed.firstConnectTimer);
    state.feed.firstConnectTimer = null;
  }

  function invalidateAisSession() {
    clearFirstConnectTimer();
    state.feed.sessionId = ++vesselState._aisSessionSequence;
    state.feed.firstConnectPhase = 'idle';
    state.feed.firstConnectStartedAt = null;
    state.feed.firstConnectDeadline = null;
  }

  function beginAisSession() {
    clearFirstConnectTimer();
    const sessionId = ++vesselState._aisSessionSequence;
    const startedAt = vesselState._aisRuntime.now();
    state.feed.sessionId = sessionId;
    state.feed.firstConnectPhase = 'loading';
    state.feed.firstConnectStartedAt = startedAt;
    state.feed.firstConnectDeadline = startedAt + AIS_FIRST_CONNECT_GRACE_MS;
    state.feed.error = null;
    state.feed.loadingLabel = AIS_FIRST_CONNECT_LABEL;
    scheduleFirstConnectExpiry(sessionId, AIS_FIRST_CONNECT_GRACE_MS);
  }

  function scheduleFirstConnectExpiry(sessionId, delayMs) {
    state.feed.firstConnectTimer = vesselState._aisRuntime.setTimeout(() => {
      if (
        !state.feed.enabled ||
        state.feed.sessionId !== sessionId ||
        state.feed.firstConnectPhase !== 'loading'
      )
        return;
      const remainingMs =
        state.feed.firstConnectDeadline - vesselState._aisRuntime.now();
      if (remainingMs > 0) {
        scheduleFirstConnectExpiry(sessionId, remainingMs);
        return;
      }
      state.feed.firstConnectTimer = null;
      state.feed.firstConnectPhase = 'unavailable';
      state.feed.loadingLabel = '';
      state.feed.error = state.feed.lastMessageAt
        ? 'awaiting usable AIS positions…'
        : 'awaiting first AIS message…';
      state.feed.stale = state.feed.count > 0;
    }, delayMs);
  }

  function settleFirstConnectPhase(phase) {
    clearFirstConnectTimer();
    state.feed.firstConnectPhase = phase;
    state.feed.loadingLabel = '';
  }

  function isGraceEligibleTransport(status) {
    return AIS_HEALTHY_STATUSES.has(status) || status === 'connecting';
  }

  function isDefinitiveTransportFailure(status) {
    return Boolean(status) && !isGraceEligibleTransport(status);
  }

  function markAisUnavailable(reason) {
    settleFirstConnectPhase('unavailable');
    state.feed.error = reason || 'AIS live load failed';
    state.feed.stale = state.feed.count > 0;
  }

  function resetState() {
    components.rendering.resetRecordVisuals();
    state.feed.abort?.abort();
    state.trailAbort?.abort();
    state.trailAbort = null;
    clearFirstConnectTimer();
    state.viewer = null;
    state.feed.enabled = false;
    state.feed.loading = false;
    state.feed.loaded = false;
    state.feed.stale = false;
    state.feed.partial = false;
    state.feed.error = null;
    state.feed.loadingLabel = '';
    state.feed.lastUpdate = null;
    state.feed.count = 0;
    state.feed.newestPositionAt = null;
    state.feed.transportStatus = null;
    state.feed.nextAttemptAt = null;
    state.feed.lastMessageAt = null;
    state.feed.rawRowCount = 0;
    state.feed.acceptedRowCount = 0;
    state.feed.sessionId = ++vesselState._aisSessionSequence;
    state.feed.firstConnectPhase = 'idle';
    state.feed.firstConnectStartedAt = null;
    state.feed.firstConnectDeadline = null;
    state.feed.firstConnectTimer = null;
    state.feed.abort = null;
    state.billboardCollection = null;
    state.records.all = [];
    state.records.byMmsi = new Map();
    state.records.unkeyed = [];
    state.clickHandler = null;
    state.keyTarget = null;
    state.keydownHandler = null;
    state.trackedEntityRemover = null;
    state.interactionHandlerFactory = null;
    state.interactionKeyTarget = null;
    state.preRenderRemover = null;
    state.lastVisibilityUpdate = 0;
    state.lastFocusUpdate = 0;
    state.activeFocusCount = 0;
    state.focusTransitioning = false;
    state.activeLabelCount = 0;
    state.selectedRecord = null;
    state.trail = null;
    state.trailPositions = [];
    state.trailMmsi = null;
    state.trailBackfillToken = 0;
  }
  const methods = {
    /** Configure the source before initialization; an active layer keeps its owner. */
    setSource(source) {
      if (state.viewer)
        throw new Error('Configure the source before layer initialization');
      if (typeof source?.getSnapshot !== 'function')
        throw new TypeError('A snapshot source is required');
      vesselState._source = source;
      this.source = source.label || this.source;
    },

    init(viewer) {
      if (typeof vesselState._source?.getSnapshot !== 'function')
        throw new TypeError('A snapshot source is required');
      state.viewer = viewer;
      components.rendering.ensureCollections(viewer);
      vesselState._vesselOverlayHost.setVisible(
        VESSEL_OVERLAY_SOURCE_ID,
        false,
      );
      components.selection.installInteraction(viewer);
      components.rendering.installRuntime(viewer);
      restoreSpriteOrder(viewer);
    },

    enable(viewer) {
      const wasEnabled = state.feed.enabled;
      state.feed.enabled = true;
      if (!wasEnabled) beginAisSession();
      startPeriodicRenderDemand();
      const activeViewer = viewer || state.viewer;
      components.rendering.ensureCollections(activeViewer);
      components.selection.installInteraction(activeViewer);
      components.rendering.setVisible(true);
      // Height-datum fix: warm the geoid grid once per layer-enable, never
      // blocking a poll. The first refresh may land pre-resolve (N = 0), and
      // the next is up to 60 s out — so re-floor in place on resolve. A load
      // failure leaves N = 0 forever, which is safe: sprites are depth-test-
      // free, so vessels stay visible either way.
      if (!vesselState._geoidReady) {
        const sessionId = state.feed.sessionId;
        ensureGeoidReady()
          .then(() => {
            if (!state.feed.enabled || state.feed.sessionId !== sessionId)
              return;
            vesselState._geoidReady = true;
            components.tracking.refloorVesselRecords();
          })
          .catch(() => {
            /* grid failed to load — anchors stay at ellipsoid 0 */
          });
      }
      // Pick-ownership (H2): vessel picks carry the record OBJECT as their id;
      // the registry resolver reduces it to the record's mmsi (a string key).
      registerPickOwner('ais-live-vessels', (pickedId) =>
        state.records.byMmsi.has(pickedId),
      );
      restoreSpriteOrderOnEnable('ais', activeViewer);
      // Vessels are asked for by view, so ask again when the view moves away.
      removeViewListener();
      const moveEnd = activeViewer?.camera?.moveEnd;
      if (typeof moveEnd?.addEventListener === 'function')
        state.feed.removeViewListener = moveEnd.addEventListener(() => {
          components.ingestion.refreshIfMoved(activeViewer);
        });
      return components.ingestion.loadLivePositions(activeViewer);
    },

    disable() {
      removeViewListener();
      state.feed.enabled = false;
      invalidateAisSession();
      stopVesselRenderDemand();
      unregisterPickOwner('ais-live-vessels');
      components.rendering.setVisible(false);
      vesselState._vesselOverlayHost.clearSource(VESSEL_OVERLAY_SOURCE_ID);
      components.selection.clearVesselInspection();
      components.tracking.destroySelectedVesselTrail();
      components.selection.removeVesselInteraction();
      if (state.feed.abort) {
        state.feed.abort.abort();
        state.feed.abort = null;
      }
      state.feed.loading = false;
      state.feed.loadingLabel = '';
    },

    destroy(viewer) {
      removeViewListener();
      const activeViewer = viewer || state.viewer;
      invalidateAisSession();
      state.feed.enabled = false;
      stopVesselRenderDemand(); // direct-destroy path
      if (state.feed.abort) state.feed.abort.abort();
      unregisterPickOwner('ais-live-vessels');
      components.selection.clearVesselInspection();
      components.tracking.destroySelectedVesselTrail();
      if (state.billboardCollection && activeViewer?.scene?.primitives) {
        activeViewer.scene.primitives.remove(state.billboardCollection);
      }
      vesselState._vesselOverlayHost.clearSource(VESSEL_OVERLAY_SOURCE_ID);
      vesselState._vesselOverlayHost.setVisible(
        VESSEL_OVERLAY_SOURCE_ID,
        false,
      );
      components.selection.removeVesselInteraction();
      if (state.preRenderRemover) {
        state.preRenderRemover();
      }
      resetState();
    },
  };

  function removeViewListener() {
    const remove = state.feed.removeViewListener;
    state.feed.removeViewListener = null;
    if (typeof remove === 'function') remove();
  }

  return {
    clearFirstConnectTimer,
    invalidateAisSession,
    beginAisSession,
    scheduleFirstConnectExpiry,
    settleFirstConnectPhase,
    isGraceEligibleTransport,
    isDefinitiveTransportFailure,
    markAisUnavailable,
    resetState,
    syncPeriodicRenderDemand,
    methods,
  };
}
