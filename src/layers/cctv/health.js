import { HEALTH_SYNC_INTERVAL_MS, HEALTH_ENDPOINT } from './policy.js';

export function createHealth({ state: layerState, services, parts, source }) {
  function notifyInspector(id) {
    const record = layerState._recordById?.get(id);
    const host = globalThis.window;
    if (
      !record ||
      !host?.dispatchEvent ||
      !host.CustomEvent ||
      !parts.presentation
    )
      return;
    const cameraState = parts.presentation.getPublicCameraState(record);
    host.dispatchEvent(
      new host.CustomEvent('gev:camera-health-updated', {
        detail: { evidence: cameraState.evidence, cameraState },
      }),
    );
  }
  function mergeClientHealth(next) {
    for (const [id, client] of layerState._clientHealthById) {
      const server = next.get(id) || {
        id,
        status: 'unknown',
        sourceKind: 'browser',
        label: '',
        message: '',
        reasonCode: 'unknown',
        attemptedAt: null,
        lastSuccessAt: null,
        sourceObservedAt: null,
        updatedAt: null,
      };
      next.set(id, { ...server, ...client });
    }
  }

  /** Record a local delivery/decode observation without rewriting proxy facts. */
  function recordClientHealth(cameraId, patch = {}) {
    const id = String(cameraId || '').trim();
    if (!id || patch.cancelled) return;
    const attemptedAt = Number.isFinite(patch.attemptedAt)
      ? patch.attemptedAt
      : Date.now();
    const previous = layerState._clientHealthById.get(id) || {};
    const client = {
      ...previous,
      decodeStatus: String(patch.status || previous.decodeStatus || 'unknown'),
      decodeReason: String(
        patch.reasonCode || previous.decodeReason || 'unknown',
      ),
      decodeAttemptedAt: attemptedAt,
      decodeLastSuccessAt:
        patch.status === 'ok'
          ? attemptedAt
          : previous.decodeLastSuccessAt || null,
    };
    layerState._clientHealthById.set(id, client);
    const current = layerState._healthById.get(id) || {
      id,
      status: 'unknown',
      updatedAt: null,
    };
    layerState._healthById.set(id, { ...current, ...client });
    notifyInspector(id);
  }

  /**
   * Fetches per-camera health status from the backend and updates _healthById.
   * Rate-limited to HEALTH_SYNC_INTERVAL_MS unless forced.
   * @param {boolean} [force=false] - Bypass the interval check.
   */

  async function syncHealthState(force = false) {
    const now = Date.now();
    if (!force && now - layerState._lastHealthSyncAt < HEALTH_SYNC_INTERVAL_MS)
      return;
    layerState._lastHealthSyncAt = now;

    const signal = layerState._sourceAbort?.signal;
    const isCurrentRequest = () =>
      signal === layerState._sourceAbort?.signal && !signal?.aborted;
    try {
      const data = await source.getHealth({ signal });
      signal?.throwIfAborted();
      if (!isCurrentRequest()) return;
      const rows = Array.isArray(data?.cameras) ? data.cameras : [];
      const next = new Map();
      for (const row of rows) {
        const id = String(row?.id || '').trim();
        if (!id) continue;
        const optionalTime = (value) =>
          value == null || value === ''
            ? null
            : parts.model.safeNumber(value, null);
        next.set(id, {
          status: String(row.status || '').toLowerCase() || 'unknown',
          sourceKind: String(
            row.sourceKind || row.feedType || '',
          ).toLowerCase(),
          label: String(row.label || row.provider || ''),
          message: String(row.message || ''),
          reasonCode: String(row.reasonCode || '').toLowerCase() || 'unknown',
          upstreamReasonCode: String(row.upstreamReasonCode || 'unknown'),
          transportStatus: String(row.transportStatus || 'unknown'),
          attemptedAt: optionalTime(row.attemptedAt),
          lastSuccessAt: optionalTime(row.lastSuccessAt),
          sourceObservedAt: optionalTime(row.sourceObservedAt),
          updatedAt: optionalTime(row.updatedAt),
          refreshIntervalMs: optionalTime(row.refreshIntervalMs),
        });
      }
      mergeClientHealth(next);
      layerState._healthById = next;
      if (layerState._activeCameraId)
        notifyInspector(layerState._activeCameraId);
    } catch {
      // keep previous health map
      if (isCurrentRequest() && layerState._activeCameraId)
        notifyInspector(layerState._activeCameraId);
    }
  }
  return { syncHealthState, recordClientHealth };
}
