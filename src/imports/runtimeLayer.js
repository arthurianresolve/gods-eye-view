import * as Cesium from 'cesium';
import { consumeInBatches } from './cooperative.js';
import { selectImportRenderRecords } from './renderRecords.js';
import {
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from '../data/contextStore.js';
import { isPointerFree } from '../data/inputOwnership.js';
import { createEvidenceEnvelope } from '../evidence/evidence.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

export const IMPORTED_LAYER_ID = 'user-imports';
export const MAX_RENDERED_IMPORT_FEATURES = 5_000;
const MAX_IMPORTED_OVERLAY_LABELS = 180;

function position(coordinate) {
  return Cesium.Cartesian3.fromDegrees(
    coordinate[0],
    coordinate[1],
    Number.isFinite(coordinate[2]) ? coordinate[2] : 0,
  );
}

function* positions(coordinates) {
  const result = new Array(coordinates.length);
  for (let index = 0; index < coordinates.length; index++) {
    result[index] = position(coordinates[index]);
    // A single permitted feature can contain 50,000 vertices. Let the existing
    // four-ms consumer yield within it, before publishing an incomplete entity.
    // Small chunks avoid a clock read and iterator resume for every vertex.
    if ((index + 1) % 64 === 0) yield;
  }
  return result;
}

/** Render a bounded user-imported cohort with the shared evidence inspector. */
export function createImportedGeometryLayer({
  viewer,
  now = () => Date.now(),
  batchOptions = {},
  screenSpaceEventHandlerFactory = (canvas) =>
    new Cesium.ScreenSpaceEventHandler(canvas),
} = {}) {
  if (!viewer?.entities || !viewer?.scene?.canvas)
    throw new TypeError('A Cesium viewer is required.');
  const ids = new Set();
  let destroyed = false;
  let pending = null;
  const handler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    if (destroyed || !isPointerFree()) return;
    const picked = viewer.scene.pick(movement.position)?.id;
    if (picked?.__gevImportContextId) selectEntityContext(picked);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function clear() {
    const previous = pending;
    pending = null;
    previous?.abort();
    for (const id of ids) {
      const entity = viewer.entities.getById(id);
      if (entity) viewer.entities.remove(entity);
    }
    ids.clear();
    removeEntityContextsForLayer(IMPORTED_LAYER_ID);
    clearOverlaySource(IMPORTED_LAYER_ID);
  }

  function* build(imports, { workspaceId = 'active' } = {}) {
    const { selected, total } = selectImportRenderRecords(
      imports,
      MAX_RENDERED_IMPORT_FEATURES,
    );
    const overlayEntries = [];
    for (const { record: feature, source } of selected) {
      const importId = source.id || 'import';
      const id = `gev-import:${workspaceId}:${importId}:${feature.id}`;
      const label = String(
        feature.properties?.name || feature.properties?.title || feature.id,
      ).slice(0, 120);
      let shape;
      const geometry = feature.geometry;
      if (geometry?.type === 'Point') {
        shape = {
          position: position(geometry.coordinates),
          point: {
            pixelSize: 9,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
          },
        };
      } else if (
        geometry?.type === 'LineString' &&
        geometry.coordinates.length >= 2
      ) {
        shape = {
          polyline: {
            positions: yield* positions(geometry.coordinates),
            width: 3,
            material: Cesium.Color.CYAN,
            clampToGround: true,
          },
        };
      } else if (
        geometry?.type === 'Polygon' &&
        geometry.coordinates?.[0]?.length >= 4
      ) {
        const outer = yield* positions(geometry.coordinates[0]);
        const holes = [];
        for (let index = 1; index < geometry.coordinates.length; index++)
          holes.push(
            new Cesium.PolygonHierarchy(
              yield* positions(geometry.coordinates[index]),
            ),
          );
        shape = {
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(outer, holes),
            material: Cesium.Color.CYAN.withAlpha(0.18),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            perPositionHeight: false,
          },
        };
      } else {
        yield;
        continue;
      }
      const anchor =
        geometry.type === 'Point'
          ? geometry.coordinates
          : geometry.type === 'LineString'
            ? geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
            : geometry.coordinates[0]?.[0];
      if (anchor && overlayEntries.length < MAX_IMPORTED_OVERLAY_LABELS)
        overlayEntries.push({
          id,
          position: position(anchor),
          variant: 'label',
          title: label.slice(0, 48),
          priority: overlayEntries.length,
          collisionGroup: 'ambient-label',
          paintLane: 'ambient-label',
          interactive: false,
          edgeFade: 'keyhole',
          horizonCull: true,
        });
      const entity = viewer.entities.add({ id, name: label, ...shape });
      entity.__gevImportContextId = id;
      ids.add(id);
      const evidence = createEvidenceEnvelope({
        entityRef: { layerKey: IMPORTED_LAYER_ID, id: String(feature.id) },
        sourceId:
          source.kind === 'synthetic-demo'
            ? 'Synthetic offline demo · generated locally, not live'
            : `User import · ${source.kind || 'geographic file'}`,
        observedAt: feature.timeMs,
        receivedAt: now(),
        method: source.kind === 'synthetic-demo' ? 'simulated' : 'unknown',
        feedState: source.kind === 'synthetic-demo' ? 'off' : 'unknown',
        coverage: {
          completeness: 'unknown',
          reason:
            'A local file has no inferred geographic or temporal coverage.',
        },
        licenseRef: source.attribution || null,
        limitations:
          source.kind === 'synthetic-demo'
            ? [
                'Synthetic demonstration only; these generated marks are not live observations and have no real source coverage.',
              ]
            : [
                'Source time and coverage are only present when supplied in the imported file.',
              ],
        now: now(),
      });
      registerEntityContext(entity, {
        id,
        layerId: IMPORTED_LAYER_ID,
        label,
        evidence,
        importedFeature: {
          id: String(feature.id),
          properties: feature.properties,
        },
      });
      yield;
    }
    setOverlayEntries(IMPORTED_LAYER_ID, overlayEntries, {
      cohortLimit: MAX_IMPORTED_OVERLAY_LABELS,
      collisionCapacity: MAX_IMPORTED_OVERLAY_LABELS,
      maxVisible: MAX_IMPORTED_OVERLAY_LABELS,
    });
    if (overlayEntries.length) setOverlaySourceVisible(IMPORTED_LAYER_ID, true);
    viewer.scene.requestRender?.();
    return {
      drawn: selected.length,
      omitted: Math.max(0, total - selected.length),
    };
  }

  function load(imports, options) {
    if (destroyed) return { drawn: 0, omitted: 0 };
    clear();
    const iterator = build(imports, options);
    try {
      let next;
      do {
        next = iterator.next();
      } while (!next.done);
      return next.value;
    } catch (error) {
      clear();
      throw error;
    }
  }

  async function loadAsync(imports, { signal, ...options } = {}) {
    if (destroyed) return { drawn: 0, omitted: 0 };
    clear();
    const controller = new AbortController();
    const abort = () => controller.abort();
    pending = controller;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await consumeInBatches(build(imports, options), {
        ...batchOptions,
        signal: controller.signal,
        budgetMs: 4,
      });
    } catch (error) {
      // A cancelled older load must not clear a replacement workspace.
      if (pending === controller) clear();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (pending === controller) pending = null;
    }
  }

  return Object.freeze({
    load,
    loadAsync,
    clear,
    getPerformanceDiagnostics: () => ({
      pendingJobs: pending ? 1 : 0,
      cacheEntries: ids.size,
    }),
    getState: () => ({
      featureCount: ids.size,
      pendingJobs: pending ? 1 : 0,
      destroyed,
    }),
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      handler.destroy();
    },
  });
}
