import { CCTV_AMBIENT_CARD_MAX } from '../../data/cctvLod.js';
import { ACTIVE_FRAME_REFRESH_MS, IDLE_FRAME_REFRESH_MS } from './policy.js';
import { headingHudToken, isHeadingEstimated } from './headingConfidence.js';
import { createEvidenceEnvelope } from '../../evidence/evidence.js';
import { currentCameraHealth } from './healthPolicy.js';

function redactHealthDiagnostic(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address]')
    .slice(0, 180);
}

export function createPresentation({
  state: layerState,
  services,
  parts,
  source,
}) {
  /**
   * Builds a single-line summary string for the active camera, including city,
   * heading, FOV, coverage area, overlap count, projection mode, alignment
   * confidence, source type, and view context.
   * @returns {string} Summary text separated by mid-dots.
   */

  function buildSummaryText() {
    const active = parts.selection.getActiveRecord();
    if (!active) {
      return layerState._records.length
        ? `${layerState._records.length} CAMERAS STANDING BY · NO CAMERA SELECTED · CLICK A CAMERA TO ACTIVATE`
        : 'No cameras available in catalog.';
    }

    const area = parts.model.sectorAreaKm2(
      active.camera.rangeM,
      active.camera.fovDeg,
    );
    const overlapCount = parts.geometry.coverageNeighborCount(active);
    const viewKey = parts.model.currentViewContext();
    const viewBand = viewKey.split(':')[0] || 'global';
    const health = layerState._healthById.get(active.camera.id) || null;
    const calBadge = parts.calibration.deriveCalBadge(active.camera);

    return [
      `${active.camera.city.toUpperCase()} CCTV`,
      `${active.camera.name.toUpperCase()}`,
      // A synthetic bearing (headingConfidence 'low', no human calibration)
      // is tagged so a hashed guess never reads as a surveyed facing (#639).
      headingHudToken(active.camera),
      `FOV ${Math.round(active.camera.fovDeg)}°`,
      `COVERAGE ${area.toFixed(2)}km²`,
      overlapCount > 0 ? `OVERLAP ${overlapCount} cams` : 'ISOLATED VIEW',
      `PROJ ${layerState._showProjection ? 'MONITOR' : 'OFF'}`,
      layerState._coverageMode === 'viewshed' ? 'VIEWSHED' : null,
      `CAL ${calBadge.replace('-', ' ').toUpperCase()}`,
      health?.sourceKind
        ? `SRC ${String(health.sourceKind).toUpperCase()}`
        : `SRC ${String(active.camera.feedType || 'image').toUpperCase()}`,
      `${viewBand.toUpperCase()} CONTEXT`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Builds a public-facing camera state object for UI consumption.
   * Includes all pose, calibration, CAL badge, projection, and feed metadata.
   * @param {Object} record - Camera record.
   * @param {string|null} [activeId=null] - Active camera ID for the `active` flag.
   * @returns {Object} Public camera state.
   */

  function getPublicCameraState(record, activeId = null) {
    const resolvedActiveId =
      activeId || parts.selection.getActiveRecord()?.camera.id || null;
    const camera = record.camera;
    const health = currentCameraHealth(layerState._healthById.get(camera.id));
    const healthDiagnostic = redactHealthDiagnostic(health?.message);
    const isActive = camera.id === resolvedActiveId;
    const refreshMs = isActive
      ? ACTIVE_FRAME_REFRESH_MS
      : IDLE_FRAME_REFRESH_MS;
    const configuredVideo = parts.model.isVideoFeedType(camera.feedType);
    const videoFallback =
      configuredVideo && record.projection?.mode === 'image';
    const sourceKind =
      health?.sourceKind ||
      camera.sourceKind ||
      (camera.feedConfigured ? 'configured' : 'seed');
    const feedState =
      health?.sourceKind === 'synthetic' ||
      health?.sourceKind === 'streetview' ||
      videoFallback
        ? 'fallback'
        : health?.decodeStatus === 'failed'
          ? 'degraded'
          : health?.status === 'unavailable'
            ? 'unavailable'
            : health?.status === 'ok'
              ? 'nominal'
              : health?.status === 'stale'
                ? 'stale'
                : health?.sourceKind === 'synthetic'
                  ? 'fallback'
                  : health?.status === 'degraded'
                    ? 'degraded'
                    : 'unknown';
    const evidence = createEvidenceEnvelope({
      entityRef: { layerKey: 'cctv', id: camera.id },
      sourceId: camera.provider || sourceKind,
      sourceUrl: camera.credit || null,
      cameraHealth: {
        sourceStatus: health?.status || 'unknown',
        sourceKind,
        videoFallback,
        healthReason: health?.reasonCode || 'unknown',
        upstreamReasonCode: health?.upstreamReasonCode || 'unknown',
        transportStatus: health?.transportStatus || 'unknown',
        healthAttemptedAt: health?.attemptedAt,
        healthLastSuccessAt: health?.lastSuccessAt,
        decodeStatus: health?.decodeStatus || 'unknown',
        decodeReason: health?.decodeReason || 'unknown',
        decodeAttemptedAt: health?.decodeAttemptedAt,
        decodeLastSuccessAt: health?.decodeLastSuccessAt,
      },
      receivedAt: health?.lastSuccessAt,
      observedAt: health?.sourceObservedAt,
      feedState,
      method:
        sourceKind === 'synthetic'
          ? 'simulated'
          : sourceKind === 'streetview'
            ? 'reconstructed'
            : health?.lastSuccessAt
              ? 'observed'
              : 'unknown',
      coverage: {
        completeness: 'partial',
        reason:
          'Camera frame coverage is limited to the registered agency source.',
      },
      limitations: [
        healthDiagnostic ||
          'Camera capture time is not supplied by the source.',
        sourceKind === 'synthetic'
          ? 'Synthetic placeholder; no live camera frame was available.'
          : null,
      ].filter(Boolean),
    });
    return {
      id: camera.id,
      name: camera.name,
      city: camera.city,
      provider: camera.provider,
      lat: camera.lat,
      lon: camera.lon,
      headingDeg: camera.headingDeg,
      // Bearing provenance (#639): the pack's confidence flag plus the derived
      // "is this a synthetic guess" bit (calibration-aware), so UI consumers
      // never have to re-derive it.
      headingConfidence: camera.headingConfidence || null,
      headingEstimated: isHeadingEstimated(camera),
      pitchDeg: camera.pitchDeg,
      fovDeg: camera.fovDeg,
      rangeM: camera.rangeM,
      elevationM: camera.absoluteHeightM,
      mountHeightM: camera.mountHeightM,
      active: isActive,
      feedType: camera.feedType,
      isVideo: configuredVideo && !videoFallback,
      videoFallback,
      sourceKind,
      sourceStatus: health?.status || 'unknown',
      sourceMessage: healthDiagnostic,
      sourceLabel: health?.label || camera.provider || '',
      healthReason: health?.reasonCode || 'unknown',
      upstreamReasonCode: health?.upstreamReasonCode || 'unknown',
      transportStatus: health?.transportStatus || 'unknown',
      healthDiagnostic,
      healthAttemptedAt: health?.attemptedAt || null,
      healthLastSuccessAt: health?.lastSuccessAt || null,
      decodeStatus: health?.decodeStatus || 'unknown',
      decodeReason: health?.decodeReason || 'unknown',
      decodeAttemptedAt: health?.decodeAttemptedAt || null,
      decodeLastSuccessAt: health?.decodeLastSuccessAt || null,
      evidence,
      credit: camera.credit || '',
      calibration: {
        ...parts.calibration.normalizeCalibration(camera.calibration),
      },
      // Save-gated persistence (design §3e): true while the live pose carries
      // edits that have not been SAVEd (or RESET). Drives the CAL · EDITED chip.
      calDirty: !!record.calDirty,
      // Deterministic QA seam: counts commit-grade anchor resolutions (E/N drag
      // release, numeric E/N edit, or reset), never transient gizmo moves.
      groundResolveCount: record.calibrationGroundResolveCount || 0,
      // Per-record QA seam for proving transient gizmo moves never enter the
      // shared mesh-floor sampler while unrelated catalog cells finish.
      groundMeshSampleRequestCount: record.groundMeshSampleRequestCount || 0,
      // Datum QA seam: expose the immutable Re:Earth ellipsoidal prior
      // separately from the currently applied frustum ground. Google-3D may
      // legitimately refine the latter to the rendered mesh, so callers must
      // not infer the prior by subtracting mount height from live geometry.
      groundPriorM: Number.isFinite(record.groundPrior?.ellipsoid)
        ? record.groundPrior.ellipsoid
        : null,
      intrinsics: camera.intrinsics ? { ...camera.intrinsics } : null,
      extrinsics: camera.extrinsics ? { ...camera.extrinsics } : null,
      anchor: camera.anchor ? { ...camera.anchor } : null,
      // Panel-only trust signal (design §3b, amended by LOCKED §9.2/§9.3): no
      // in-world rendering reads this, no score-based quality math backs it.
      calBadge: parts.calibration.deriveCalBadge(camera),
      poseSource: camera.poseSource || null,
      basePose: camera.basePose ? { ...camera.basePose } : null,
      frameUrl: parts.frames.frameUrlFor(camera, refreshMs),
      mediaUrl: parts.frames.mediaUrlFor(camera),
    };
  }

  /**
   * Assembles the full UI state payload containing layer toggles, camera list,
   * active camera details, summary text, and error state.
   * @returns {Object} Complete UI state for subscribers.
   */

  function uiState() {
    const active = parts.selection.getActiveRecord();
    const activeId = active?.camera.id || null;
    const payload = {
      enabled: layerState._enabled,
      // Compat boolean + the full tri-state (viewshed design §3b).
      showCoverage: layerState._coverageMode !== 'off',
      coverageMode: layerState._coverageMode,
      showProjection: layerState._showProjection,
      calibrationMode: layerState._calibrationMode,
      autoHop: layerState._autoHop,
      autoHopSuspended: layerState._autoHopSuspended,
      autoHopSec: layerState._autoHopSec,
      count: layerState._count,
      lastUpdate: layerState._lastUpdate,
      error: layerState._lastError,
      loading: {
        active: layerState._geoLoading,
        loaded: Math.min(layerState._geoLoadDone, layerState._geoLoadTotal),
        total: layerState._geoLoadTotal,
      },
      // Ambient card tier telemetry (QA harnesses assert the fetch pacing —
      // minFrameFetchSpacingMs reads together with fetchMode: cold-fill bursts
      // legitimately reach ~250 ms, steady state stays >=1000 ms).
      ambientCards: {
        count: layerState._cardIds.size,
        limit: CCTV_AMBIENT_CARD_MAX,
        frameFetches: layerState._cardFetchCount,
        minFrameFetchSpacingMs: layerState._cardMinFetchSpacingMs,
        fetchMode: layerState._cardFetchMode,
        fetchesInFlight: layerState._cardFetchInFlightCount,
        // Item B QA seam: the hover-summoned pinned card, if any.
        hoverId: layerState._hoverCardId,
      },
      activeCameraId: activeId,
      activeCamera: active ? getPublicCameraState(active, activeId) : null,
      cameras: layerState._records.map((record) =>
        getPublicCameraState(record, activeId),
      ),
      summary: buildSummaryText(),
    };
    return payload;
  }

  /** Dispatches the current UI state to all registered subscriber callbacks. */

  function notifyListeners() {
    const payload = uiState();
    for (const callback of layerState._listeners) {
      try {
        callback(payload);
      } catch (error) {
        console.warn('[Data:CCTV] listener error:', error);
      }
    }
  }

  /**
   * Throttled notifyListeners for transient (mid-drag) calibration patches —
   * the panel re-render is DOM-heavy, so live gizmo drags publish state at
   * ≤10 Hz while the in-world geometry still tracks every processed move.
   */

  function notifyListenersThrottled() {
    const now = Date.now();
    if (now - layerState._lastTransientNotifyAt < 100) return;
    layerState._lastTransientNotifyAt = now;
    notifyListeners();
  }
  return {
    buildSummaryText,
    getPublicCameraState,
    uiState,
    notifyListeners,
    notifyListenersThrottled,
  };
}
