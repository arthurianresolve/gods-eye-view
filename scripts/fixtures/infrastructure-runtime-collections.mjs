import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { localGeoJsonServices } from '../../src/app/localGeojsonServices.js';
import { createInfrastructureLayers } from '../../src/data/infrastructure.js';
import { INFRASTRUCTURE_DATA_URLS } from '../../src/sources/infrastructureData.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  countInfrastructureGraphics,
  createInfrastructureSampleReadiness,
  infrastructureCameraRevisionReady,
  INFRASTRUCTURE_RUNTIME_CASES,
  INFRASTRUCTURE_RUNTIME_PAIRS,
  INFRASTRUCTURE_RUNTIME_SCHEMA,
  validateInfrastructureRuntimeReport,
} from '../performance/infrastructureRuntimeComparison.mjs';

const FRAME_TIMEOUT_MS = 400;
const MAX_RECORDS = 2000;
const container = document.querySelector('#viewer');
const status = document.querySelector('#status');
const output = document.querySelector('#result');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sourceDigest() {
  const response = await fetch(INFRASTRUCTURE_DATA_URLS['local-dams']);
  check(response.ok, `Bundled dams payload returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  check(
    bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024,
    'Bundled source exceeded its size bound.',
  );
  const lines = new TextDecoder()
    .decode(bytes)
    .split('\n')
    .filter((line) => line.trim());
  const geometryKinds = {};
  for (const line of lines) {
    const feature = JSON.parse(line);
    const kind = feature?.geometry?.type || 'unknown';
    geometryKinds[kind] = (geometryKinds[kind] || 0) + 1;
  }
  return {
    payloadSha256: await sha256(bytes),
    payloadBytes: bytes.byteLength,
    featureCount: lines.length,
    geometryKinds,
  };
}

function value(property, time) {
  return typeof property?.getValue === 'function'
    ? property.getValue(time)
    : property;
}

function finitePosition(position) {
  const result = [position?.x, position?.y, position?.z];
  check(result.every(Number.isFinite), 'Non-finite surface position.');
  return result;
}

function finiteColor(color) {
  const result = [color?.red, color?.green, color?.blue, color?.alpha];
  check(result.every(Number.isFinite), 'Non-finite surface color.');
  return result;
}

function rgba8(color) {
  return color.map((channel) =>
    Math.min(255, Cesium.Color.floatToByte(Math.min(1, Math.max(0, channel)))),
  );
}

function analystIndex(records) {
  const index = new Map();
  for (const record of records) {
    const sourceId = String(record?.evidence?.entityRef?.id ?? '');
    if (!sourceId) throw new Error('Analyst record has no source identity.');
    const list = index.get(sourceId) || [];
    list.push(record);
    index.set(sourceId, list);
  }
  return index;
}

function identityFor(entity, recordsBySource, time) {
  const properties = value(entity.properties, time) || {};
  const sourceId = String(properties.osm_id ?? properties.id ?? entity.id);
  const record = recordsBySource.get(sourceId)?.[0];
  check(
    record?.evidence?.entityRef?.layerKey === 'local-dams',
    `Entity ${entity.id} lacks the expected analyst identity.`,
  );
  return String(record.sourceRecordId || record.evidence.entityRef.id);
}

function readEntitySurfaces(dataSource, records, time) {
  const bySource = analystIndex(records);
  const rows = [];
  for (const entity of dataSource.entities.values) {
    if (!entity.point || !entity.polyline) continue;
    const positions = value(entity.polyline.positions, time);
    check(
      Array.isArray(positions) && positions.length === 2,
      `Entity ${entity.id} has no two-point stem.`,
    );
    rows.push({
      entity,
      entityId: String(entity.id),
      sourceRecordId: identityFor(entity, bySource, time),
      entityShow: entity.show !== false,
      point: {
        position: finitePosition(value(entity.position, time)),
        pixelSize: value(entity.point.pixelSize, time),
        color: finiteColor(value(entity.point.color, time)),
        outlineColor: finiteColor(value(entity.point.outlineColor, time)),
        outlineWidth: value(entity.point.outlineWidth, time),
        show: value(entity.point.show, time) !== false,
      },
      stem: {
        positions: positions.map(finitePosition),
        width: value(entity.polyline.width, time),
        color: finiteColor(value(entity.polyline.material?.color, time)),
        show: value(entity.polyline.show, time) !== false,
      },
    });
  }
  check(
    rows.length > 0,
    'Default renderer exposes no point/stem Entity graphics.',
  );
  return rows;
}

function findProductionCollection(viewer) {
  const owners = [];
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.__gevLocalInfrastructureLayerId === 'local-dams')
      owners.push(primitive);
  }
  check(
    owners.length === 1 && !owners[0].isDestroyed(),
    'Expected exactly one live production collection owner.',
  );
  check(
    owners[0].length === 2,
    'Production collection owner has an unexpected child count.',
  );
  return {
    owner: owners[0],
    points: owners[0].get(0),
    stems: owners[0].get(1),
  };
}

function readCollectionSurfaces(dataSource, records, collections, time) {
  const bySource = analystIndex(records);
  const entityById = new Map(
    dataSource.entities.values.map((entity) => [String(entity.id), entity]),
  );
  check(
    collections.points.length > 0 &&
      collections.points.length === collections.stems.length,
    'Production primitive surface counts differ.',
  );
  const rows = [];
  for (let index = 0; index < collections.points.length; index++) {
    const point = collections.points.get(index);
    const stem = collections.stems.get(index);
    check(
      point?.id && point.id === stem?.id,
      `Point/stem ${index} lost its source Entity identity.`,
    );
    const entity = entityById.get(String(point.id.id));
    check(
      entity && entity.point === undefined && entity.polyline === undefined,
      `Entity ${point.id.id} retained duplicate Graphics.`,
    );
    rows.push({
      entity,
      entityId: String(entity.id),
      sourceRecordId: identityFor(entity, bySource, time),
      entityShow: entity.show !== false,
      point: {
        position: finitePosition(point.position),
        pixelSize: point.pixelSize,
        color: finiteColor(point.color),
        outlineColor: finiteColor(point.outlineColor),
        outlineWidth: point.outlineWidth,
        show: point.show !== false,
      },
      stem: {
        positions: stem.positions.map(finitePosition),
        width: stem.width,
        color: finiteColor(stem.material?.uniforms?.color),
        show: stem.show !== false,
      },
    });
  }
  return rows;
}

function geometrySnapshot(rows) {
  return rows.map(({ entityId, sourceRecordId, point, stem }) => ({
    entityId,
    sourceRecordId,
    point: point.position,
    stem: stem.positions,
  }));
}

function styleSnapshot(rows) {
  return rows.map(({ entityId, sourceRecordId, entityShow, point, stem }) => ({
    entityId,
    sourceRecordId,
    point: {
      pixelSize: point.pixelSize,
      colorRgba8: rgba8(point.color),
      outlineColorRgba8: rgba8(point.outlineColor),
      outlineWidth: point.outlineWidth,
      effectiveShow: entityShow && point.show,
    },
    stem: {
      width: stem.width,
      colorRgba8: rgba8(stem.color),
      effectiveShow: entityShow && stem.show,
    },
  }));
}

function styleAuditSnapshot(row) {
  return {
    entityId: row.entityId,
    entityShow: row.entityShow,
    point: {
      rawColor: row.point.color,
      graphicsOrPrimitiveShow: row.point.show,
      effectiveShow: row.entityShow && row.point.show,
    },
    stem: {
      rawColor: row.stem.color,
      graphicsOrPrimitiveShow: row.stem.show,
      effectiveShow: row.entityShow && row.stem.show,
    },
  };
}

function identitySnapshot(rows) {
  return rows.map(({ entityId, sourceRecordId }) => ({
    entityId,
    sourceRecordId,
  }));
}

function scanOwners(viewer) {
  let count = 0;
  const childCounts = [];
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.__gevLocalInfrastructureLayerId === 'local-dams') {
      count++;
      childCounts.push(primitive.length);
    }
  }
  return { count, childCounts };
}

function scenePrimitiveCounts(viewer) {
  return {
    scenePrimitives: viewer.scene.primitives.length,
    groundPrimitives: viewer.scene.groundPrimitives.length,
  };
}

async function warmViewerDataSourceDisplay(viewer) {
  const dataSourcesBefore = viewer.dataSources.length;
  const primitiveCountsBefore = scenePrimitiveCounts(viewer);
  const temporary = new Cesium.CustomDataSource(
    'infrastructure-renderer-display-warmup',
  );
  await viewer.dataSources.add(temporary);
  viewer.scene.requestRender();
  await captureFrame(viewer);
  const removed = await viewer.dataSources.remove(temporary, true);
  viewer.scene.requestRender();
  await captureFrame(viewer);
  check(removed, 'Temporary display-warmup data source was not removed.');
  check(
    viewer.dataSources.length === dataSourcesBefore,
    'Display warmup changed application data-source ownership.',
  );
  return {
    completedFrames: 2,
    temporaryDataSourceRemoved: true,
    dataSourcesBefore,
    dataSourcesAfter: viewer.dataSources.length,
    primitiveCountsBefore,
    primitiveCountsAfter: scenePrimitiveCounts(viewer),
  };
}

function projectNativePick(viewer, row, kind) {
  const position =
    kind === 'point'
      ? new Cesium.Cartesian3(...row.point.position)
      : Cesium.Cartesian3.midpoint(
          new Cesium.Cartesian3(...row.stem.positions[0]),
          new Cesium.Cartesian3(...row.stem.positions[1]),
          new Cesium.Cartesian3(),
        );
  const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    position,
  );
  if (!screen) return null;
  const width = viewer.scene.canvas.clientWidth;
  const height = viewer.scene.canvas.clientHeight;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    screen.x < 0 ||
    screen.y < 0 ||
    screen.x >= width ||
    screen.y >= height
  )
    return null;
  return screen;
}

function captureNativePick(
  viewer,
  row,
  kind,
  collections,
  screen,
  diagnostics,
) {
  const picked = viewer.scene.pick(new Cesium.Cartesian2(screen.x, screen.y));
  const miss = (reason) => {
    diagnostics[`${kind}Misses`]++;
    if (diagnostics.rejections.length < 4)
      diagnostics.rejections.push({
        kind,
        reason,
        expectedEntityId: row.entityId,
        actualEntityId: picked?.id?.id ? String(picked.id.id) : null,
        primitiveType: picked?.primitive?.constructor?.name || null,
        appearanceType:
          picked?.primitive?.appearance?.constructor?.name || null,
      });
    return null;
  };
  if (picked?.id !== row.entity) return miss('source-entity-mismatch');
  if (collections) {
    const collection =
      kind === 'point' ? collections.points : collections.stems;
    let expected = null;
    for (let index = 0; index < collection.length; index++) {
      if (collection.get(index)?.id === row.entity) {
        expected = collection.get(index);
        break;
      }
    }
    if (!expected || picked.primitive !== expected)
      return miss('collection-primitive-mismatch');
  } else if (kind === 'point') {
    if (!(picked.primitive instanceof Cesium.PointPrimitive))
      return miss('default-point-type');
  } else {
    const primitive = picked.primitive;
    const defaultStemPrimitive =
      primitive instanceof Cesium.GroundPolylinePrimitive ||
      (primitive instanceof Cesium.Primitive &&
        (primitive.appearance instanceof Cesium.PolylineColorAppearance ||
          primitive.appearance instanceof Cesium.PolylineMaterialAppearance));
    if (!defaultStemPrimitive) return miss('default-stem-type');
  }
  viewer.selectedEntity = picked.id;
  check(
    viewer.selectedEntity === row.entity,
    'Native selectedEntity did not retain picked source Entity.',
  );
  return {
    entityId: String(picked.id.id),
    sourceRecordId: row.sourceRecordId,
    kind,
    screen: [screen.x, screen.y],
  };
}

function findNativePickTarget(
  viewer,
  rows,
  collections,
  preferredEntityId = null,
  diagnostics,
) {
  const orderedRows = preferredEntityId
    ? [
        ...rows.filter((row) => row.entityId === preferredEntityId),
        ...rows.filter((row) => row.entityId !== preferredEntityId),
      ]
    : rows;
  for (const row of orderedRows) {
    diagnostics.examined++;
    if (!row.entityShow || !row.point.show || !row.stem.show) {
      diagnostics.hidden++;
      continue;
    }
    const pointScreen = projectNativePick(viewer, row, 'point');
    const stemScreen = projectNativePick(viewer, row, 'stem');
    if (!pointScreen || !stemScreen) {
      diagnostics.offscreen++;
      continue;
    }
    if (
      Math.hypot(pointScreen.x - stemScreen.x, pointScreen.y - stemScreen.y) <=
      8
    ) {
      diagnostics.coincident++;
      continue;
    }
    const pointPick = captureNativePick(
      viewer,
      row,
      'point',
      collections,
      pointScreen,
      diagnostics,
    );
    if (!pointPick) continue;
    const stemPick = captureNativePick(
      viewer,
      row,
      'stem',
      collections,
      stemScreen,
      diagnostics,
    );
    if (stemPick) return { row, pointPick, stemPick };
  }
  return null;
}

async function captureFrame(viewer) {
  viewer.scene.requestRender();
  const canvas = await captureFreshCesiumFrame(viewer, {
    timeoutMs: FRAME_TIMEOUT_MS,
  });
  check(canvas, 'Fresh completed frame was unavailable.');
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = context
      .getImageData(0, 0, canvas.width, canvas.height)
      .data.slice();
    let nonCorner = 0;
    for (let offset = 4; offset < pixels.length; offset += 4) {
      if (
        pixels[offset] !== pixels[0] ||
        pixels[offset + 1] !== pixels[1] ||
        pixels[offset + 2] !== pixels[2] ||
        pixels[offset + 3] !== pixels[3]
      )
        nonCorner++;
    }
    return {
      pixels,
      pixelSha256: await sha256(pixels),
      pngBase64: canvas.toDataURL('image/png').split(',')[1] || '',
      width: canvas.width,
      height: canvas.height,
      pixelsDifferentFromCorner: nonCorner,
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function setCamera(viewer, anchor, height) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      anchor.longitude,
      anchor.latitude,
      height,
    ),
    orientation: { heading: 0, pitch: -Math.PI / 3, roll: 0 },
  });
  viewer.scene.requestRender();
}

function snapshotCamera(viewer) {
  return {
    position: Cesium.Cartesian3.clone(viewer.camera.positionWC),
    direction: Cesium.Cartesian3.clone(viewer.camera.directionWC),
    up: Cesium.Cartesian3.clone(viewer.camera.upWC),
  };
}

function restoreCamera(viewer, state) {
  viewer.camera.setView({
    destination: state.position,
    orientation: { direction: state.direction, up: state.up },
  });
  viewer.scene.requestRender();
}

function snapshotClock(viewer) {
  const currentTime = viewer.clock.currentTime;
  return {
    iso: Cesium.JulianDate.toIso8601(currentTime, 3),
    julianDayNumber: currentTime.dayNumber,
    secondsOfDay: currentTime.secondsOfDay,
    shouldAnimate: viewer.clock.shouldAnimate,
  };
}

async function runLayerLifetime(
  viewer,
  mode,
  source,
  report,
  renderTime,
  initialCamera,
) {
  const lifetime = {
    mode,
    activationOrder: mode === 'entities' ? 0 : 1,
    activationContext:
      mode === 'entities'
        ? 'first layer lifetime in a fresh fixture viewer'
        : 'after baseline teardown in the same viewer; provider cache state unmeasured',
    status: 'running',
    samples: [],
    sceneBaseline: null,
    initialOwnership: null,
    renderClock: report.renderClock,
    teardown: null,
  };
  const ownersBefore = scanOwners(viewer);
  lifetime.sceneBaseline = {
    dataSources: viewer.dataSources.length,
    ...scenePrimitiveCounts(viewer),
    rendererOwners: ownersBefore.count,
  };
  lifetime.initialOwnership = { ...lifetime.sceneBaseline };
  const layerStart = performance.now();
  const services = { ...localGeoJsonServices };
  if (mode === 'primitive-collections')
    services.infrastructureSurfaceRenderer = mode;
  const layers = createInfrastructureLayers(services);
  const dams = layers.find((layer) => layer.id === 'local-dams');
  check(dams, 'Production dams layer did not construct.');
  let dataSource;
  let restored = true;
  try {
    restoreCamera(viewer, initialCamera);
    await dams.init(viewer);
    await dams.enable(viewer);
    lifetime.activationDiagnosticMs = performance.now() - layerStart;
    lifetime.activationTimingScope =
      'single-layer-activation-diagnostic-not-performance-evidence';
    dataSource = viewer.dataSources.getByName('Dams')?.[0];
    check(
      dataSource && dataSource.isLoading !== true,
      'Production dams source did not load.',
    );
    const records = dams.getAnalystRecords(MAX_RECORDS);
    check(records.length > 0, 'Production analyst records are empty.');
    let collections =
      mode === 'primitive-collections'
        ? findProductionCollection(viewer)
        : null;
    const time = Cesium.JulianDate.clone(renderTime);
    const readRows = () =>
      mode === 'entities'
        ? readEntitySurfaces(dataSource, records, time)
        : readCollectionSurfaces(dataSource, records, collections, time);
    let preferredPickEntityId = null;
    let rows = readRows();
    const first = rows[0];
    const anchor = Cesium.Cartographic.fromCartesian(
      new Cesium.Cartesian3(...first.point.position),
    );
    check(anchor, 'Source anchor is not cartographic.');
    const renderState = () => {
      const owner = scanOwners(viewer);
      const graphics = countInfrastructureGraphics(
        dataSource.entities.values,
        rows.map((row) => row.entity),
      );
      const graphicCount = graphics.surfaceGraphics;
      if (mode === 'entities')
        check(
          owner.count === 0 && graphicCount === rows.length,
          'Baseline is not the default Entity representation.',
        );
      else {
        const diagnostic = dams.getSurfaceRendererDiagnostics();
        check(
          owner.count === 1 && owner.childCounts[0] === 2 && graphicCount === 0,
          'Candidate contains duplicate or unowned Graphics.',
        );
        check(
          diagnostic.mode === mode &&
            diagnostic.owners === 1 &&
            diagnostic.attached &&
            diagnostic.points === rows.length &&
            diagnostic.stems === rows.length,
          'Candidate production ownership diagnostics differ from its actual primitives.',
        );
      }
      return {
        renderer: mode,
        datasourcePresent: viewer.dataSources.contains(dataSource),
        entityCount: dataSource.entities.values.length,
        surfaceEntityCount: rows.length,
        entitySurfaceGraphics: graphicCount,
        preservedGraphics: graphics.preservedGraphics,
        rendererOwners: owner.count,
        rendererOwnerChildren: owner.childCounts,
      };
    };
    renderState();
    const captureStableSample = async (
      caseId,
      pair,
      changedGeometryFrom,
      recordSample = true,
    ) => {
      const deadline = performance.now() + 8000;
      const readiness = createInfrastructureSampleReadiness();
      let completedCaptures = 0;
      let pickSearches = 0;
      let pickDiagnostics = null;
      let stableFrames = 0;
      let finalFrame;
      let pointPick;
      let stemPick;
      let pickRow;
      let selectionRendered = false;
      let geometryReady = false;
      let observedGeometry = null;
      let lodDiagnostics = null;
      let cameraPosition = null;
      while (performance.now() < deadline) {
        finalFrame = await captureFrame(viewer);
        completedCaptures++;
        if (pickRow) selectionRendered = true;
        rows = readRows();
        const hash = await sha256(
          new TextEncoder().encode(JSON.stringify(geometrySnapshot(rows))),
        );
        const signature = `${finalFrame.pixelSha256}:${hash}`;
        observedGeometry = hash;
        lodDiagnostics = dams.getLodDiagnostics();
        cameraPosition = finitePosition(viewer.camera.positionWC);
        geometryReady =
          (!changedGeometryFrom || hash !== changedGeometryFrom) &&
          infrastructureCameraRevisionReady(lodDiagnostics, cameraPosition);
        stableFrames = readiness.observe(signature, {
          inputsReady: geometryReady,
        });
        if (readiness.takePickAttempt()) {
          pickSearches++;
          pickDiagnostics = {
            examined: 0,
            hidden: 0,
            offscreen: 0,
            coincident: 0,
            pointMisses: 0,
            stemMisses: 0,
            rejections: [],
          };
          const target = findNativePickTarget(
            viewer,
            rows,
            collections,
            preferredPickEntityId,
            pickDiagnostics,
          );
          pointPick = target?.pointPick;
          stemPick = target?.stemPick;
          pickRow = target?.row;
          if (pickRow) preferredPickEntityId = pickRow.entityId;
        }
        if (stableFrames >= 3 && pointPick && stemPick && selectionRendered)
          break;
      }
      if (!(stableFrames >= 3 && pointPick && stemPick && pickRow)) {
        lifetime.failedSample = {
          caseId,
          pair,
          stableFrames,
          completedCaptures,
          pickSearches,
          pickDiagnostics,
          geometryReady,
          observedGeometry,
          changedGeometryFrom,
          lodDiagnostics,
          cameraPosition,
          pointPick: pointPick || null,
          stemPick: stemPick || null,
          surfaceCount: rows.length,
          visibleSurfaces: rows.filter(
            (row) => row.entityShow && row.point.show && row.stem.show,
          ).length,
          sourceReady: viewer.dataSourceDisplay.ready,
          ownership: renderState(),
          clock: snapshotClock(viewer),
          lastFrame: finalFrame
            ? {
                width: finalFrame.width,
                height: finalFrame.height,
                pixelSha256: finalFrame.pixelSha256,
                pngBase64: finalFrame.pngBase64,
              }
            : null,
        };
      }
      check(
        stableFrames >= 3 && pointPick && stemPick && pickRow,
        `${mode} ${caseId} did not settle with native point/stem picks.`,
      );
      check(
        finalFrame.pixelsDifferentFromCorner > 100,
        `${mode} ${caseId} capture is visually empty.`,
      );
      const identity = identitySnapshot(rows);
      const geometry = geometrySnapshot(rows);
      const style = styleSnapshot(rows);
      const geometrySha256 = await sha256(
        new TextEncoder().encode(JSON.stringify(geometry)),
      );
      const styleAudit = styleAuditSnapshot(pickRow);
      if (changedGeometryFrom)
        check(
          geometrySha256 !== changedGeometryFrom,
          `${mode} camera/LOD update left geometry unchanged.`,
        );
      const row = {
        caseId,
        pair,
        mode,
        status: 'settled',
        sourceFeatureCount: source.featureCount,
        surfaceCount: rows.length,
        entityCount: dataSource.entities.values.length,
        identitySha256: await sha256(
          new TextEncoder().encode(JSON.stringify(identity)),
        ),
        geometrySha256,
        styleSha256: await sha256(
          new TextEncoder().encode(JSON.stringify(style)),
        ),
        styleAudit,
        lodDiagnostics,
        cameraPosition,
        pixelSha256: finalFrame.pixelSha256,
        pngBase64: finalFrame.pngBase64,
        pixelDifferenceCount: finalFrame.pixelsDifferentFromCorner,
        frame: {
          width: finalFrame.width,
          height: finalFrame.height,
          completedStableFrames: stableFrames,
        },
        clock: snapshotClock(viewer),
        pointPick,
        stemPick,
        ownership: {
          ...renderState(),
          sceneDataSourceCount: viewer.dataSources.length,
          scenePrimitiveCount: viewer.scene.primitives.length,
          sceneGroundPrimitiveCount: viewer.scene.groundPrimitives.length,
        },
        productionDiagnostics:
          mode === 'primitive-collections'
            ? dams.getSurfaceRendererDiagnostics()
            : null,
        layerResourceDiagnostics: dams.getPerformanceDiagnostics(),
        entitySelectionIdentity: String(viewer.selectedEntity?.id || ''),
      };
      check(
        row.entitySelectionIdentity === pickRow.entityId,
        'Native Entity selection identity differs from the pick.',
      );
      if (recordSample) lifetime.samples.push(row);
      finalFrame.pixels = null;
      return row;
    };

    setCamera(viewer, anchor, 140000);
    for (const caseId of INFRASTRUCTURE_RUNTIME_CASES) {
      let previousGeometry = null;
      for (let pair = 0; pair < INFRASTRUCTURE_RUNTIME_PAIRS; pair++) {
        if (caseId === 'camera-lod-update') {
          setCamera(viewer, anchor, 140000);
          const baseline = await captureStableSample(
            `${caseId}-baseline`,
            pair,
            null,
            false,
          );
          previousGeometry = baseline.geometrySha256;
          setCamera(viewer, anchor, 170000);
        } else setCamera(viewer, anchor, 140000);
        const sample = await captureStableSample(
          caseId,
          pair,
          caseId === 'camera-lod-update' ? previousGeometry : null,
        );
      }
    }
    lifetime.status = 'passed';
  } catch (error) {
    lifetime.status = 'failed';
    lifetime.error = {
      name: error?.name || 'Error',
      message: String(error?.message || error),
    };
    throw error;
  } finally {
    for (const layer of layers) {
      try {
        layer.destroy(viewer);
      } catch (error) {
        restored = false;
        lifetime.teardownError = String(error);
      }
    }
    const owner = scanOwners(viewer);
    lifetime.teardown = {
      layerDestroyed: layers.every((layer) => {
        const diagnostics = layer.getPerformanceDiagnostics?.();
        return (
          diagnostics?.listeners === 0 &&
          diagnostics?.surfaceCollectionOwners === 0 &&
          diagnostics?.surfacePoints === 0 &&
          diagnostics?.surfaceStems === 0
        );
      }),
      dataSourceRemoved: dataSource
        ? !viewer.dataSources.contains(dataSource)
        : true,
      rendererOwnersRemoved: owner.count === 0,
      viewerKeptForNextLifetime: !viewer.isDestroyed(),
      instrumentationRestored: restored,
      ownerCountAfterDestroy: owner.count,
      dataSourceCountAfterDestroy: viewer.dataSources.length,
      scenePrimitiveCountAfterDestroy: viewer.scene.primitives.length,
      groundPrimitiveCountAfterDestroy: viewer.scene.groundPrimitives.length,
    };
    if (
      !lifetime.teardown.layerDestroyed ||
      !lifetime.teardown.dataSourceRemoved ||
      !lifetime.teardown.rendererOwnersRemoved ||
      !lifetime.teardown.instrumentationRestored
    ) {
      lifetime.status = 'failed';
      lifetime.teardownError ||= `${mode} layer lifetime failed teardown ownership checks.`;
    }
    if (!report.lifetimes.includes(lifetime)) report.lifetimes.push(lifetime);
  }
  if (lifetime.teardownError) throw new Error(lifetime.teardownError);
  return lifetime;
}

async function runDiagnostic() {
  const report = {
    schema: INFRASTRUCTURE_RUNTIME_SCHEMA,
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    source: await sourceDigest(),
    candidateRepresentation: {
      id: 'production-local-infrastructure-primitive-collections/rgba8/v1',
      stemColorEncoding: 'entity-color-attribute-byte',
    },
    environment: null,
    samplingScope:
      'five-correctness-snapshots-per-case-not-alternating-performance-runs',
    renderClock: null,
    status: 'running',
    lifetimes: [],
    comparisons: [],
    cleanup: { viewerDestroyed: false },
    error: null,
  };
  let viewer;
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit),
      'Exact application commit is required.',
    );
    viewer = createApplicationViewer({
      container,
      creditContainer: document.querySelector('#credits'),
      preserveDrawingBuffer: true,
    });
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    viewer.scene.globe.show = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyBox.show = false;
    viewer.scene.skyAtmosphere.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    const renderTime = Cesium.JulianDate.now();
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.clone(renderTime);
    report.viewerOwnedDisplayWarmup = await warmViewerDataSourceDisplay(viewer);
    const initialCamera = snapshotCamera(viewer);
    report.renderClock = {
      iso: Cesium.JulianDate.toIso8601(renderTime, 3),
      julianDayNumber: renderTime.dayNumber,
      secondsOfDay: renderTime.secondsOfDay,
      shouldAnimate: false,
    };
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: report.applicationCommit,
      harnessCommit: report.harnessCommit,
    });
    await runLayerLifetime(
      viewer,
      'entities',
      report.source,
      report,
      renderTime,
      initialCamera,
    );
    await runLayerLifetime(
      viewer,
      'primitive-collections',
      report.source,
      report,
      renderTime,
      initialCamera,
    );
    const baseline = report.lifetimes[0];
    const candidate = report.lifetimes[1];
    report.comparisons = compareSamples(baseline, candidate);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = {
      name: error?.name || 'Error',
      message: String(error?.message || error),
    };
  } finally {
    if (viewer && !viewer.isDestroyed()) {
      try {
        viewer.destroy();
        report.cleanup.viewerDestroyed = true;
      } catch (error) {
        report.cleanup.viewerError = String(error);
        report.status = 'failed';
      }
    }
  }
  if (report.status === 'passed') {
    try {
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: report.applicationCommit,
      });
    } catch (error) {
      report.status = 'failed';
      report.error = {
        name: error?.name || 'Error',
        message: String(error?.message || error),
      };
    }
  }
  return report;
}

function compareSamples(baseline, candidate) {
  const result = [];
  for (const caseId of INFRASTRUCTURE_RUNTIME_CASES) {
    const leftRows = baseline.samples.filter((row) => row.caseId === caseId);
    const rightRows = candidate.samples.filter((row) => row.caseId === caseId);
    for (let pair = 0; pair < INFRASTRUCTURE_RUNTIME_PAIRS; pair++) {
      const left = leftRows.find((row) => row.pair === pair);
      const right = rightRows.find((row) => row.pair === pair);
      check(
        left && right,
        `${caseId} pair ${pair + 1} is missing a renderer sample.`,
      );
      const exact =
        left.pixelSha256 === right.pixelSha256 &&
        left.identitySha256 === right.identitySha256 &&
        left.geometrySha256 === right.geometrySha256 &&
        left.styleSha256 === right.styleSha256 &&
        JSON.stringify(left.pointPick) === JSON.stringify(right.pointPick) &&
        JSON.stringify(left.stemPick) === JSON.stringify(right.stemPick);
      check(
        exact,
        `${caseId} pair ${pair + 1} baseline/candidate evidence differs.`,
      );
      result.push({
        caseId,
        pair,
        pixelSha256Equal: true,
        identityEqual: true,
        geometryEqual: true,
        styleEqual: true,
        picksEqual: true,
        framebufferEqual:
          left.frame.width === right.frame.width &&
          left.frame.height === right.frame.height,
      });
    }
  }
  return result;
}

async function main() {
  status.textContent =
    'Running default and candidate production layer lifetimes…';
  const report = await runDiagnostic();
  output.textContent = JSON.stringify(report);
  status.textContent = report.status;
}

main().catch((error) => {
  output.textContent = JSON.stringify({
    schema: INFRASTRUCTURE_RUNTIME_SCHEMA,
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    status: 'failed',
    error: {
      name: error?.name || 'Error',
      message: String(error?.message || error),
    },
  });
  status.textContent = 'failed';
});
