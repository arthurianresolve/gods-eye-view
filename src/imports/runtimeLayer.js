import * as Cesium from 'cesium';
import { consumeInBatches } from './cooperative.js';
import { removeOwnedEntityCollection } from './entityCollectionOwnership.js';
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
const POINT_REPRESENTATIONS = new Set(['entity', 'primitive-collection']);

function position(coordinate) {
  return Cesium.Cartesian3.fromDegrees(
    coordinate[0],
    coordinate[1],
    Number.isFinite(coordinate[2]) ? coordinate[2] : 0,
  );
}

const COORDINATE_PREPARATION_CHUNK = 256;

function* positions(coordinates) {
  const result = new Array(coordinates.length);
  for (let index = 0; index < coordinates.length; index++) {
    result[index] = position(coordinates[index]);
    if ((index + 1) % COORDINATE_PREPARATION_CHUNK === 0)
      yield 'coordinate-chunk';
  }
  return result;
}

/** Render a bounded user-imported cohort with the shared evidence inspector. */
export function createImportedGeometryLayer({
  viewer,
  pointRepresentation = 'entity',
  now = () => Date.now(),
  batchOptions = {},
  screenSpaceEventHandlerFactory = (canvas) =>
    new Cesium.ScreenSpaceEventHandler(canvas),
} = {}) {
  if (!viewer?.entities || !viewer?.scene?.canvas)
    throw new TypeError('A Cesium viewer is required.');
  if (!POINT_REPRESENTATIONS.has(pointRepresentation))
    throw new TypeError('Unknown imported point representation.');
  if (
    pointRepresentation === 'primitive-collection' &&
    (typeof viewer.scene.primitives?.add !== 'function' ||
      typeof viewer.scene.primitives?.remove !== 'function')
  )
    throw new TypeError('Scene primitives are required for point collections.');
  const ownedEntities = new Map();
  let pointPrimitiveCollection = null;
  let destroyed = false;
  let pending = null;
  const handler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    if (destroyed || !isPointerFree()) return;
    const picked = viewer.scene.pick(movement.position)?.id;
    if (picked?.__gevImportContextId) selectEntityContext(picked);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function ensurePointPrimitiveCollection() {
    if (pointPrimitiveCollection) return pointPrimitiveCollection;
    const collection = new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT,
    });
    try {
      viewer.scene.primitives.add(collection);
      pointPrimitiveCollection = collection;
      return collection;
    } catch (error) {
      const primitives = viewer.scene?.primitives;
      try {
        if (primitives && !primitives.isDestroyed?.())
          primitives.remove(collection);
      } catch {
        // Preserve the construction error; the owned object is still destroyed below.
      }
      if (!collection.isDestroyed()) collection.destroy();
      throw error;
    }
  }

  function releasePointPrimitiveCollection() {
    const collection = pointPrimitiveCollection;
    pointPrimitiveCollection = null;
    if (!collection || collection.isDestroyed()) return;
    const primitives = viewer.scene?.primitives;
    let cleanupError = null;
    if (primitives && !primitives.isDestroyed?.()) {
      try {
        primitives.remove(collection);
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      if (!collection.isDestroyed()) collection.destroy();
    } catch (error) {
      cleanupError ||= error;
    }
    if (cleanupError) throw cleanupError;
  }

  function createEntity(id, name, shape) {
    if (pointRepresentation === 'entity' || !shape.point)
      return viewer.entities.add({ id, name, ...shape });

    if (ownedEntities.has(id) || viewer.entities.getById(id))
      throw new Error(`Duplicate imported feature id: ${id}`);
    // This opt-in path keeps the Entity's public identity and PointGraphics for
    // context/evidence consumers, while bypassing viewer.entities so Cesium's
    // general geometry visualizer does not create unrelated updater sets.
    const entity = new Cesium.Entity({ id, name, ...shape });
    ensurePointPrimitiveCollection().add({
      id: entity,
      position: shape.position,
      pixelSize: shape.point.pixelSize,
      color: shape.point.color,
      outlineColor: shape.point.outlineColor,
      outlineWidth: shape.point.outlineWidth,
      disableDepthTestDistance: 0.0,
    });
    return entity;
  }

  function clear() {
    const previous = pending;
    pending = null;
    previous?.abort();
    let cleanupError = null;
    try {
      removeOwnedEntityCollection(viewer.entities, ownedEntities);
    } catch (error) {
      cleanupError = error;
    }
    try {
      releasePointPrimitiveCollection();
    } catch (error) {
      cleanupError ||= error;
    }
    ownedEntities.clear();
    removeEntityContextsForLayer(IMPORTED_LAYER_ID);
    clearOverlaySource(IMPORTED_LAYER_ID);
    if (cleanupError) throw cleanupError;
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
        for (let index = 1; index < geometry.coordinates.length; index++) {
          holes.push(
            new Cesium.PolygonHierarchy(
              yield* positions(geometry.coordinates[index]),
            ),
          );
        }
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
        yield 'unsupported-feature';
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
      const entity = createEntity(id, label, shape);
      ownedEntities.set(id, entity);
      entity.__gevImportContextId = id;
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
      yield 'entity';
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
      cacheEntries: ownedEntities.size,
      pointRepresentation,
      pointPrimitiveCount: pointPrimitiveCollection?.length || 0,
    }),
    getPointRendererSnapshot() {
      if (pointRepresentation !== 'primitive-collection') return null;
      const collection = pointPrimitiveCollection;
      if (!collection)
        return { pointCount: 0, entityRows: [], primitiveRows: [] };
      const entityRows = [];
      const primitiveRows = [];
      const time = viewer.clock?.currentTime;
      for (let index = 0; index < collection.length; index++) {
        const point = collection.get(index);
        const entity = point.id;
        if (
          !entity ||
          ownedEntities.get(entity.id) !== entity ||
          viewer.entities.getById(entity.id) !== undefined ||
          entity.__gevImportContextId !== entity.id
        )
          throw new Error('Imported point collection has an unowned Entity.');
        const positionValue = entity.position?.getValue(time);
        const pointGraphics = entity.point;
        const vector = (value) =>
          value &&
          Number.isFinite(value.x) &&
          Number.isFinite(value.y) &&
          Number.isFinite(value.z)
            ? [value.x, value.y, value.z]
            : null;
        const color = (value) =>
          value &&
          [value.red, value.green, value.blue, value.alpha].every(
            Number.isFinite,
          )
            ? [value.red, value.green, value.blue, value.alpha]
            : null;
        const nearFar = (value) =>
          value
            ? [value.near, value.nearValue, value.far, value.farValue]
            : null;
        entityRows.push({
          id: entity.id,
          name: entity.name,
          position: vector(positionValue),
          pixelSize: pointGraphics.pixelSize.getValue(time),
          color: color(pointGraphics.color.getValue(time)),
          outlineColor: color(pointGraphics.outlineColor.getValue(time)),
          outlineWidth: pointGraphics.outlineWidth.getValue(time),
        });
        primitiveRows.push({
          id: entity.id,
          position: vector(point.position),
          color: color(point.color),
          outlineColor: color(point.outlineColor),
          outlineWidth: point.outlineWidth,
          pixelSize: point.pixelSize,
          disableDepthTestDistance: point.disableDepthTestDistance,
          splitDirection: point.splitDirection,
          scaleByDistance: nearFar(point.scaleByDistance),
          translucencyByDistance: nearFar(point.translucencyByDistance),
          distanceDisplayCondition: point.distanceDisplayCondition
            ? [
                point.distanceDisplayCondition.near,
                point.distanceDisplayCondition.far,
              ]
            : null,
          show: point.show,
        });
      }
      return {
        pointCount: collection.length,
        blendOption: collection.blendOption,
        entityRows,
        primitiveRows,
      };
    },
    getState: () => ({
      featureCount: ownedEntities.size,
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
