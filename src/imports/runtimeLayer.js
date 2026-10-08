import * as Cesium from 'cesium';
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

function positions(coordinates) {
  return coordinates.map(position);
}

/** Render a bounded user-imported cohort with the shared evidence inspector. */
export function createImportedGeometryLayer({
  viewer,
  now = () => Date.now(),
} = {}) {
  if (!viewer?.entities || !viewer?.scene?.canvas)
    throw new TypeError('A Cesium viewer is required.');
  const ids = new Set();
  let destroyed = false;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    if (destroyed || !isPointerFree()) return;
    const picked = viewer.scene.pick(movement.position)?.id;
    if (picked?.__gevImportContextId) selectEntityContext(picked);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function clear() {
    for (const id of ids) {
      const entity = viewer.entities.getById(id);
      if (entity) viewer.entities.remove(entity);
    }
    ids.clear();
    removeEntityContextsForLayer(IMPORTED_LAYER_ID);
    clearOverlaySource(IMPORTED_LAYER_ID);
  }

  function load(imports, { workspaceId = 'active' } = {}) {
    if (destroyed) return { drawn: 0, omitted: 0 };
    clear();
    const features = (Array.isArray(imports) ? imports : []).flatMap((entry) =>
      Array.isArray(entry?.records)
        ? entry.records.map((record) => ({ ...record, __import: entry }))
        : [],
    );
    const selected = features.slice(0, MAX_RENDERED_IMPORT_FEATURES);
    const overlayEntries = [];
    for (const feature of selected) {
      const importId = feature.__import.id || 'import';
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
            positions: positions(geometry.coordinates),
            width: 3,
            material: Cesium.Color.CYAN,
            clampToGround: true,
          },
        };
      } else if (
        geometry?.type === 'Polygon' &&
        geometry.coordinates?.[0]?.length >= 4
      ) {
        shape = {
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              positions(geometry.coordinates[0]),
              geometry.coordinates
                .slice(1)
                .map((ring) => new Cesium.PolygonHierarchy(positions(ring))),
            ),
            material: Cesium.Color.CYAN.withAlpha(0.18),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            perPositionHeight: false,
          },
        };
      } else continue;
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
          feature.__import.kind === 'synthetic-demo'
            ? 'Synthetic offline demo · generated locally, not live'
            : `User import · ${feature.__import.kind || 'geographic file'}`,
        observedAt: feature.timeMs,
        receivedAt: now(),
        method:
          feature.__import.kind === 'synthetic-demo' ? 'simulated' : 'unknown',
        feedState:
          feature.__import.kind === 'synthetic-demo' ? 'off' : 'unknown',
        coverage: {
          completeness: 'unknown',
          reason:
            'A local file has no inferred geographic or temporal coverage.',
        },
        licenseRef: feature.__import.attribution || null,
        limitations:
          feature.__import.kind === 'synthetic-demo'
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
      omitted: Math.max(0, features.length - selected.length),
    };
  }

  return Object.freeze({
    load,
    clear,
    getState: () => ({ featureCount: ids.size, destroyed }),
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      handler.destroy();
    },
  });
}
