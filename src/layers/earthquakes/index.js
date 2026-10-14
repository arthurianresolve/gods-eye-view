import * as Cesium from 'cesium';
import { createEarthquakeEvidence } from './evidence.js';
import {
  EARTHQUAKE_OVERLAY_SOURCE_ID,
  EARTHQUAKE_OVERLAY_COHORT_LIMIT,
  EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
  depthColor,
  createEarthquakeOverlayEntry,
  selectEarthquakeOverlayCohort,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export {
  createUsgsEarthquakeSource,
  EARTHQUAKE_HISTORY_WINDOW_MS,
} from './source.js';

/** Own one earthquake display and its refresh lifecycle. */
export function createEarthquakesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Earthquakes require a snapshot source');
  if (!overlayHost) throw new TypeError('Earthquakes require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _receivedAt = null;
  let _sourceSnapshotAt = null;
  let _lastError = null;
  let _enabled = false;
  let _historyTargetMs = null;
  let _historyLoadedTargetMs = null;
  let _historyStatus = null;
  let _historyEffectiveTime = null;
  let _historyWindow = null;

  const layer = {
    id: 'earthquakes',
    name: 'Earthquakes (24h)',
    icon: '🌋',
    source: 'USGS',
    updateInterval: 60000,

    init(viewer) {
      if (_viewer) throw new Error('Earthquake layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('earthquakes');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _receivedAt = null;
      _sourceSnapshotAt = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Earthquakes] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      // No continuous-render hold: the discs are static geometry now, so the
      // layer has no per-frame animator to keep the render loop alive for.
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      const historyTargetMs = _historyTargetMs;
      if (
        historyTargetMs !== null &&
        _historyLoadedTargetMs === historyTargetMs
      )
        return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot =
          historyTargetMs !== null
            ? typeof source.getSnapshotAt === 'function'
              ? await source.getSnapshotAt(historyTargetMs, {
                  signal: request.signal,
                })
              : (() => {
                  throw new Error('USGS history is unsupported by this source');
                })()
            : typeof source.getSnapshotWithMetadata === 'function'
              ? await source.getSnapshotWithMetadata({ signal: request.signal })
              : {
                  rows: await source.getSnapshot({ signal: request.signal }),
                  receivedAt: Date.now(),
                  snapshotAt: null,
                };
        const rows = snapshot?.rows;
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        if (!Array.isArray(rows))
          throw new Error('Malformed USGS snapshot result');

        const nextEntities = [];
        let count = 0;
        const overlayEntries = [];

        for (const {
          stableId,
          usgsId,
          lon,
          lat,
          depthKm,
          mag,
          place,
          time,
        } of rows) {
          count++;
          const baseRadius = Math.pow(2, mag) * 1000;
          const color = depthColor(depthKm || 0);
          const isSignificant = mag >= 5.0;
          const fillAlpha = isSignificant ? 0.4 : 0.3;
          const outlineAlpha = isSignificant ? 1.0 : 0.8;

          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `earthquake:${stableId}`,
              position,
              ellipse: {
                // Static axes — see the module header. A CallbackProperty here
                // re-tessellates the clamped ground geometry every frame.
                semiMajorAxis: baseRadius,
                semiMinorAxis: baseRadius,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(fillAlpha),
                ),
                outline: true,
                outlineColor: color.withAlpha(outlineAlpha),
                outlineWidth: isSignificant ? 3 : 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                // Analyst seam (additive): the USGS event id (e.g. "us7000abcd").
                usgsId,
                mag,
                place,
                time,
                depth: depthKm,
              },
            }),
          );
          overlayEntries.push(
            createEarthquakeOverlayEntry({
              id: String(stableId),
              position,
              magnitude: mag,
              accent: color.toCssColorString(),
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            EARTHQUAKE_OVERLAY_SOURCE_ID,
            selectEarthquakeOverlayCohort(overlayEntries),
            {
              cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
              collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _count = count;
        _receivedAt = Number.isFinite(snapshot.receivedAt)
          ? snapshot.receivedAt
          : Date.now();
        _sourceSnapshotAt = Number.isFinite(snapshot.snapshotAt)
          ? snapshot.snapshotAt
          : null;
        _lastUpdate = _receivedAt;
        _lastError = null;
        _historyLoadedTargetMs = historyTargetMs;
        _historyStatus = historyTargetMs === null ? null : 'available';
        _historyEffectiveTime = snapshot.effectiveTime ?? null;
        _historyWindow = snapshot.window ?? null;
        console.log(`[Data:Earthquakes] Updated: ${_count} events (M2.5+)`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Earthquakes] Fetch error:', e);
        _lastError = e?.message || 'Earthquake source unavailable';
        if (historyTargetMs !== null) {
          _dataSource.entities.removeAll();
          _count = 0;
          _historyLoadedTargetMs = historyTargetMs;
          _historyStatus = 'unavailable';
          _historyEffectiveTime = new Date(historyTargetMs).toISOString();
          _historyWindow = null;
          overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
          overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, _enabled);
        }
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _receivedAt = null;
      _sourceSnapshotAt = null;
      _lastError = null;
      _historyTargetMs = null;
      _historyLoadedTargetMs = null;
      _historyStatus = null;
      _historyEffectiveTime = null;
      _historyWindow = null;
    },

    attachInvestigationTime(clock, capabilities = null) {
      if (!clock?.subscribe)
        throw new TypeError('An investigation clock is required');
      const removeCapability =
        typeof source.getSnapshotAt === 'function' && capabilities?.register
          ? capabilities.register({
              id: 'earthquakes',
              mode: 'provider-history',
              label: 'USGS earthquake events',
              coverage: { from: Date.UTC(1900, 0, 1), to: Date.now() },
              selectAt: async ({ targetMs, signal }) => {
                const snapshot = await source.getSnapshotAt(targetMs, {
                  signal,
                });
                return {
                  sampleTimeMs: snapshot.window?.to,
                  selectedTimeMs: targetMs,
                  timeBasis: 'event-occurrence-window',
                  window: snapshot.window,
                  eventCount: snapshot.rows?.length ?? 0,
                  truncated: snapshot.truncated === true,
                  sourceSnapshotAt: snapshot.snapshotAt ?? null,
                };
              },
            })
          : () => {};
      const remove = clock.subscribe((state) => {
        const wasHistorical = _historyTargetMs !== null;
        const next =
          state.mode === 'live' || !Number.isFinite(state.timeMs)
            ? null
            : Math.floor(state.timeMs / 60_000) * 60_000;
        if (next === _historyTargetMs) return;
        _historyTargetMs = next;
        _historyLoadedTargetMs = null;
        _historyStatus = next === null ? null : 'loading';
        _historyEffectiveTime =
          next === null ? null : new Date(next).toISOString();
        if (next === null && wasHistorical && _dataSource) {
          _dataSource.entities.removeAll();
          _count = 0;
          _historyWindow = null;
          overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
          overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, _enabled);
        }
        _request?.abort();
        _request = null;
        if (_enabled) void layer.update(_viewer);
      });
      return () => {
        removeCapability();
        remove();
        _request?.abort();
        _request = null;
      };
    },

    /**
     * Snapshot the layer's in-memory earthquake records as plain JSON-safe
     * objects for the analyst query engine. On-demand only (called at most
     * once per spoken query) — zero per-frame cost, no listeners, no caching.
     * Returns [] while the layer is disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position
          ? entity.position.getValue(now)
          : null;
        const carto = cartesian
          ? Cesium.Cartographic.fromCartesian(cartesian)
          : null;
        const p = entity.properties;
        const record = mapAnalystRecord(
          {
            id: p?.usgsId?.getValue(now) ?? null,
            mag: p?.mag?.getValue(now),
            place: p?.place?.getValue(now),
            time: p?.time?.getValue(now),
            depth: p?.depth?.getValue(now),
            lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
            lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
          },
          result.length,
        );
        record.evidence = createEarthquakeEvidence(record, {
          receivedAt: _receivedAt,
          snapshotAt: _sourceSnapshotAt,
          displayTime: _historyEffectiveTime,
          historyWindow: _historyWindow,
          feedState: _lastError ? 'degraded' : 'nominal',
          truncated: entities.length > limit,
        });
        result.push(record);
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        loading: _request !== null,
        lastUpdate: _lastUpdate,
        receivedAt: _receivedAt,
        sourceSnapshotAt: _sourceSnapshotAt,
        error: _lastError,
        historyTarget: _historyTargetMs,
        historyEffectiveTime: _historyEffectiveTime,
        historyStatus: _historyStatus,
        historyWindow: _historyWindow,
        loadingLabel:
          _historyStatus === 'loading'
            ? 'HISTORY · loading'
            : _historyStatus === 'unavailable'
              ? 'HISTORY · unavailable'
              : _historyStatus === 'available'
                ? `HISTORY · ${_historyEffectiveTime}`
                : '',
      };
    },
  };
  return layer;
}
