import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { localGeoJsonServices } from '../../src/app/localGeojsonServices.js';
import { createInfrastructureLayers } from '../../src/data/infrastructure.js';
import { INFRASTRUCTURE_DATA_URLS } from '../../src/sources/infrastructureData.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  createSceneFrameTimingDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';
import {
  assertInfrastructureSourceInventory,
  assertInfrastructureRuntimeLayerIdentity,
  DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID,
  infrastructureFixtureLayer,
} from './infrastructureFixtureLayer.mjs';
import { setInfrastructureFixtureCamera } from './infrastructureFixtureCamera.mjs';
import { resolveInfrastructureNativePickOwner } from './infrastructureNativePickOwnership.mjs';
import {
  INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA,
  INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
  INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT,
  INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME,
  INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE,
  pickPathDiagnosticRequested,
  processOwnedCapturedFrame,
  runInfrastructurePickPathControls,
} from './infrastructurePickPathDiagnostic.mjs';
import {
  INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH,
  INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS,
  INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
  INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
  collectInfrastructurePrimitiveReadiness,
  createInfrastructurePrimitiveReadinessEnvelope,
  createInfrastructurePrimitiveReadinessLifetime,
  infrastructurePrimitiveReadinessDiagnosticRequested,
  observePrimitiveReadinessAfterFailure,
  selectPrimitiveReadinessTargets,
} from './infrastructurePrimitiveReadinessDiagnostic.mjs';
import {
  createInfrastructureCurrentUpdateReadinessEnvelope,
  createInfrastructureCurrentUpdateReadinessSample,
  infrastructureCurrentUpdateGateReady,
  infrastructureCurrentUpdateReadinessRequested,
  installInfrastructureCurrentUpdateReadinessObserver,
  readInfrastructureCurrentUpdateWitness,
} from './infrastructureCurrentUpdateReadiness.mjs';
import {
  countInfrastructureGraphics,
  compareInfrastructureRuntimeLifetimes,
  createInfrastructureSampleReadiness,
  infrastructureCameraRevisionReady,
  INFRASTRUCTURE_RUNTIME_CASES,
  INFRASTRUCTURE_RUNTIME_PAIRS,
  validateInfrastructureRuntimeReport,
} from '../performance/infrastructureRuntimeComparison.mjs';

const FRAME_TIMEOUT_MS = 400;
const CURRENT_UPDATE_SAMPLE_LIMIT = 64;
const fixtureSearchParams = new URLSearchParams(location.search);
const frameFailureDiagnosticEnabled =
  fixtureSearchParams.get('frame-failure-diagnostic') === '1';
let frameFailure = null;
const pickPathDiagnosticEnabled =
  pickPathDiagnosticRequested(fixtureSearchParams);
const primitiveReadinessDiagnosticEnabled =
  infrastructurePrimitiveReadinessDiagnosticRequested(fixtureSearchParams);
const currentUpdateReadinessDiagnosticEnabled =
  infrastructureCurrentUpdateReadinessRequested(fixtureSearchParams);
const fixtureLayer = infrastructureFixtureLayer(
  fixtureSearchParams.get('layerId') ||
    DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID,
);
if (fixtureLayer.layerId !== DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID)
  throw new Error('The runtime comparison fixture supports datacenters only.');
const currentUpdateReadinessRequired =
  fixtureLayer.layerId === DATACENTER_INFRASTRUCTURE_FIXTURE_LAYER_ID;
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

async function sourceDigest(layer) {
  const response = await fetch(INFRASTRUCTURE_DATA_URLS[layer.layerId]);
  check(
    response.ok,
    `Bundled ${layer.layerName} payload returned HTTP ${response.status}.`,
  );
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
  const source = {
    layerId: layer.layerId,
    payloadSha256: await sha256(bytes),
    payloadBytes: bytes.byteLength,
    featureCount: lines.length,
    geometryKinds,
  };
  assertInfrastructureSourceInventory(source, layer);
  return source;
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

function identityFor(entity, recordsBySource, time, layerId) {
  const properties = value(entity.properties, time) || {};
  const sourceId = String(properties.osm_id ?? properties.id ?? entity.id);
  const record = recordsBySource.get(sourceId)?.[0];
  check(
    record?.evidence?.entityRef?.layerKey === layerId,
    `Entity ${entity.id} lacks the expected analyst identity.`,
  );
  return String(record.sourceRecordId || record.evidence.entityRef.id);
}

function readEntitySurfaces(dataSource, records, time, layerId) {
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
      layerId,
      entityId: String(entity.id),
      sourceRecordId: identityFor(entity, bySource, time, layerId),
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

function findProductionCollection(viewer, layerId) {
  const owners = [];
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.__gevLocalInfrastructureLayerId === layerId)
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

function readCollectionSurfaces(
  dataSource,
  records,
  collections,
  time,
  layerId,
) {
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
      layerId,
      entityId: String(entity.id),
      sourceRecordId: identityFor(entity, bySource, time, layerId),
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

function scanOwners(viewer, layerId) {
  let count = 0;
  const childCounts = [];
  for (let index = 0; index < viewer.scene.primitives.length; index++) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.__gevLocalInfrastructureLayerId === layerId) {
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
  rowsByEntity,
  primitivesByEntity,
  layerId,
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
  const owner = resolveInfrastructureNativePickOwner({
    picked,
    kind,
    requestedEntity: row.entity,
    rowsByEntity,
    primitivesByEntity,
    layerId,
    mode: collections ? 'primitive-collections' : 'entities',
    Cesium,
  });
  if (!owner) return miss('picked-owner-kind-or-layer-mismatch');
  const actualRow = owner.row;
  viewer.selectedEntity = picked.id;
  check(
    viewer.selectedEntity === actualRow.entity,
    'Native selectedEntity did not retain picked source Entity.',
  );
  const result = {
    entityId: actualRow.entityId,
    sourceRecordId: actualRow.sourceRecordId,
    kind,
    screen: [screen.x, screen.y],
  };
  if (layerId === 'local-datacenters') {
    result.layerId = layerId;
    result.ownerVerified = true;
    result.primitiveType = owner.primitiveType;
    result.appearanceType = owner.appearanceType;
  }
  return { pick: result, row: actualRow };
}

function findNativePickTarget(
  viewer,
  rows,
  collections,
  layerId,
  preferredEntityId = null,
  diagnostics,
) {
  const rowsByEntity = new Map(rows.map((row) => [row.entity, row]));
  const primitivesByEntity = new Map();
  if (collections) {
    for (let index = 0; index < collections.points.length; index++) {
      const point = collections.points.get(index);
      const stem = collections.stems.get(index);
      if (point?.id && point.id === stem?.id)
        primitivesByEntity.set(point.id, { point, stem });
    }
  }
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
    const pointHit = captureNativePick(
      viewer,
      row,
      'point',
      collections,
      rowsByEntity,
      primitivesByEntity,
      layerId,
      pointScreen,
      diagnostics,
    );
    if (!pointHit) continue;
    const stemHit = captureNativePick(
      viewer,
      row,
      'stem',
      collections,
      rowsByEntity,
      primitivesByEntity,
      layerId,
      stemScreen,
      diagnostics,
    );
    if (stemHit)
      return {
        row: stemHit.row,
        pointRow: pointHit.row,
        stemRow: stemHit.row,
        pointPick: pointHit.pick,
        stemPick: stemHit.pick,
      };
  }
  return null;
}

function createPickPathDiagnosticState(report, mode) {
  const envelope = report.instrumentation?.pickPathDiagnostic;
  if (!envelope) return null;
  const state = {
    mode,
    envelope,
    candidateEntityIds: null,
    revisionsByCandidate: new Map(),
    renderRevisionObserver: null,
    budget: {
      calls: 0,
      limit: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
    },
    report: {
      mode,
      maxPickCalls: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
      pickCalls: 0,
      status: 'running',
      observations: [],
    },
  };
  envelope.lifetimes.push(state.report);
  return state;
}

function createPrimitiveReadinessDiagnosticState(report, mode) {
  const envelope = report.instrumentation?.primitiveReadinessDiagnostic;
  if (!envelope) return null;
  const lifetime = createInfrastructurePrimitiveReadinessLifetime(
    envelope,
    mode,
  );
  return {
    envelope,
    report: lifetime.report,
    ownerIds: lifetime.ownerIds,
    renderRevisionObserver: null,
  };
}

function runPickPathDiagnosticFrame({
  viewer,
  rows,
  collections,
  layerId,
  state,
  caseId,
  pair,
  completedRenderRevision,
  renderSignature,
  cameraPosition,
  renderClock,
  captureFrameState,
  readFrameState,
}) {
  if (
    !state ||
    state.report.observations.length >=
      INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME *
        INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE
  )
    return;

  if (!state.candidateEntityIds) {
    const candidates = [];
    for (const row of rows) {
      if (!row.entityShow || !row.point.show || !row.stem.show) continue;
      const pointScreen = projectNativePick(viewer, row, 'point');
      const stemScreen = projectNativePick(viewer, row, 'stem');
      if (
        !pointScreen ||
        !stemScreen ||
        Math.hypot(
          pointScreen.x - stemScreen.x,
          pointScreen.y - stemScreen.y,
        ) <= 8
      )
        continue;
      candidates.push({ row, pointScreen, stemScreen });
      if (
        candidates.length >=
        INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME
      )
        break;
    }
    if (candidates.length === 0) return;
    state.candidateEntityIds = candidates.map(
      (candidate) => candidate.row.entityId,
    );
  }

  const rowsByEntity = new Map(rows.map((row) => [row.entity, row]));
  const primitivesByEntity = new Map();
  if (collections) {
    for (let index = 0; index < collections.points.length; index++) {
      const point = collections.points.get(index);
      const stem = collections.stems.get(index);
      if (point?.id && point.id === stem?.id)
        primitivesByEntity.set(point.id, { point, stem });
    }
  }
  for (const candidateEntityId of state.candidateEntityIds) {
    const candidateRevisions =
      state.revisionsByCandidate.get(candidateEntityId) || 0;
    if (
      candidateRevisions >= INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE
    )
      continue;
    const phase =
      candidateRevisions === 0
        ? 'initial-stable-render'
        : 'subsequent-completed-render';
    if (
      state.budget.calls + 5 >
      INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME
    )
      break;
    const row = rows.find((item) => item.entityId === candidateEntityId);
    if (!row || !row.entityShow || !row.point.show || !row.stem.show) {
      state.report.observations.push({
        phase,
        caseId,
        pair,
        candidateEntityId,
        completedRenderRevision,
        renderSignature,
        status: 'candidate-not-visible',
        pickCalls: 0,
      });
      state.revisionsByCandidate.set(candidateEntityId, candidateRevisions + 1);
      continue;
    }
    const pointScreen = projectNativePick(viewer, row, 'point');
    const stemScreen = projectNativePick(viewer, row, 'stem');
    if (
      !pointScreen ||
      !stemScreen ||
      Math.hypot(pointScreen.x - stemScreen.x, pointScreen.y - stemScreen.y) <=
        8
    ) {
      state.report.observations.push({
        phase,
        caseId,
        pair,
        candidateEntityId,
        completedRenderRevision,
        renderSignature,
        status: 'candidate-not-pickable-in-view',
        pickCalls: 0,
      });
      state.revisionsByCandidate.set(candidateEntityId, candidateRevisions + 1);
      continue;
    }
    const observation = runInfrastructurePickPathControls({
      pick: (_kind, screenPosition) =>
        viewer.scene.pick(
          new Cesium.Cartesian2(screenPosition.x, screenPosition.y),
        ),
      resolve: (picked, kind) => {
        const owner = resolveInfrastructureNativePickOwner({
          picked,
          kind,
          requestedEntity: row.entity,
          rowsByEntity,
          primitivesByEntity,
          layerId,
          mode: collections ? 'primitive-collections' : 'entities',
          Cesium,
        });
        const entityId =
          owner?.row.entityId ||
          (typeof picked?.id?.id === 'string' ? picked.id.id : null);
        return {
          ownerVerified: Boolean(owner),
          entityId,
          sourceRecordId: owner?.row.sourceRecordId || null,
          primitiveType:
            owner?.primitiveType ||
            picked?.primitive?.constructor?.name ||
            null,
          appearanceType:
            owner?.appearanceType ||
            picked?.primitive?.appearance?.constructor?.name ||
            null,
          selectionValue: owner?.row.entity || picked?.id || null,
        };
      },
      getSelection: () => viewer.selectedEntity,
      setSelection: (entity) => {
        viewer.selectedEntity = entity;
      },
      candidateEntityId,
      pointScreen,
      stemScreen,
      completedRenderRevision,
      renderSignature,
      phase,
      budget: state.budget,
      captureFrameState,
      readFrameState,
    });
    state.report.pickCalls = state.budget.calls;
    state.report.observations.push({
      ...observation,
      caseId,
      pair,
      cameraPosition: cameraPosition?.slice(0, 3),
      renderClockIso: renderClock?.iso || null,
    });
    state.revisionsByCandidate.set(candidateEntityId, candidateRevisions + 1);
  }
}

async function captureFrame(
  viewer,
  captureFrameState = null,
  timeoutMs = FRAME_TIMEOUT_MS,
  signal = undefined,
) {
  viewer.scene.requestRender();
  return processOwnedCapturedFrame({
    async capture() {
      const before = frameFailureDiagnosticEnabled
        ? {
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            defaultRenderLoop: viewer.useDefaultRenderLoop,
            requestRenderMode: viewer.scene.requestRenderMode,
          }
        : null;
      const frameTiming = frameFailureDiagnosticEnabled
        ? createSceneFrameTimingDiagnostics(viewer.scene, {
            includeEventCounts: true,
          })
        : null;
      let canvas, outcome, frameWindow;
      try {
        canvas = await captureFreshCesiumFrame(viewer, {
          timeoutMs,
          signal,
          onDiagnostic: frameFailureDiagnosticEnabled
            ? (value) => {
                outcome = value;
              }
            : undefined,
        });
      } finally {
        frameWindow = frameTiming?.stop();
      }
      if (!canvas && frameFailureDiagnosticEnabled && !frameFailure) {
        frameFailure = {
          outcome,
          before,
          after: {
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            defaultRenderLoop: viewer.useDefaultRenderLoop,
          },
          frameWindow,
          scope: 'failure-only; not GPU or performance acceptance',
        };
        // The capture has already failed. Observe scheduling without retrying
        // capture, rendering manually, or changing its 400 ms deadline.
        frameFailure.schedulingAfterFailure = await observeImportFrameHealth();
      }
      check(canvas, 'Fresh completed frame was unavailable.');
      return canvas;
    },
    readFrameState: captureFrameState,
    async process(
      canvas,
      { completedFrameState, completedFrameStateErrorName },
    ) {
      check(!signal?.aborted, 'Diagnostic frame processing was cancelled.');
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
        ...(completedFrameState ? { completedFrameState } : {}),
        ...(completedFrameStateErrorName
          ? { completedFrameStateErrorName }
          : {}),
        pixelsDifferentFromCorner: nonCorner,
      };
    },
    release(canvas) {
      canvas.width = canvas.height = 0;
    },
  });
}

function setCamera(viewer, anchor, height) {
  return setInfrastructureFixtureCamera(
    viewer,
    anchor,
    height,
    fixtureLayer.layerId,
    { requestRender: true },
  );
}

function runtimeCameraContract(layerId, anchor) {
  if (layerId !== 'local-datacenters') return null;
  return {
    layerId,
    kind: 'lookAt-world-frame',
    targetCartographic: [
      anchor.longitude,
      anchor.latitude,
      Number.isFinite(anchor.height) ? anchor.height : 0,
    ],
    headingRadians: 0,
    pitchRadians: -Math.PI / 3,
    sampleRangesMeters: [140_000, 170_000],
    restoredTransform: 'IDENTITY',
  };
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

function createCompletedRenderRevisionObserver(viewer) {
  let completedRenderRevision = 0;
  let disposed = false;
  let remove = null;
  const safeErrorName = (error) =>
    ['TypeError', 'DeveloperError', 'RangeError'].includes(error?.name)
      ? error.name
      : 'Error';
  const observer = {
    available: false,
    cleanupConfirmed: false,
    errorName: null,
    read() {
      return {
        completedRenderRevision,
        cameraPosition: finitePosition(viewer.camera.positionWC),
        renderClockIso: snapshotClock(viewer).iso,
      };
    },
    dispose() {
      if (disposed) return observer.cleanupConfirmed;
      disposed = true;
      try {
        if (typeof remove !== 'function')
          throw new Error('Post-render observer removal is unavailable.');
        remove();
        observer.cleanupConfirmed = true;
      } catch (error) {
        observer.errorName = safeErrorName(error);
      }
      return observer.cleanupConfirmed;
    },
  };
  const onPostRender = () => {
    completedRenderRevision++;
  };
  try {
    const removeListener =
      viewer.scene.postRender.addEventListener(onPostRender);
    remove =
      typeof removeListener === 'function'
        ? removeListener
        : () => viewer.scene.postRender.removeEventListener(onPostRender);
    observer.available = true;
  } catch (error) {
    observer.errorName = safeErrorName(error);
    observer.dispose();
  }
  return observer;
}

async function runLayerLifetime(
  viewer,
  mode,
  layer,
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
  const pickPathDiagnostic = createPickPathDiagnosticState(report, mode);
  const primitiveReadinessDiagnostic = createPrimitiveReadinessDiagnosticState(
    report,
    mode,
  );
  let currentUpdateReadinessObserver = null;
  const currentUpdateReadinessLifetime =
    report.instrumentation?.currentUpdateReadiness?.lifetimes.find(
      (item) => item.mode === mode,
    );
  const ownersBefore = scanOwners(viewer, layer.layerId);
  lifetime.sceneBaseline = {
    dataSources: viewer.dataSources.length,
    ...scenePrimitiveCounts(viewer),
    rendererOwners: ownersBefore.count,
  };
  lifetime.initialOwnership = { ...lifetime.sceneBaseline };
  const layerStart = performance.now();
  const services = { ...localGeoJsonServices };
  if (mode === 'primitive-collections')
    services.datacenterSurfaceRenderer = mode;
  const layers = createInfrastructureLayers(services);
  const targetLayer = layers.find(
    (candidate) => candidate.id === layer.layerId,
  );
  check(targetLayer, `Production ${layer.layerName} layer did not construct.`);
  const targetLayerId = assertInfrastructureRuntimeLayerIdentity(
    targetLayer,
    layer,
  );
  if (pickPathDiagnostic) {
    pickPathDiagnostic.renderRevisionObserver =
      createCompletedRenderRevisionObserver(viewer);
    pickPathDiagnostic.report.renderRevisionObserver = {
      available: pickPathDiagnostic.renderRevisionObserver.available,
      cleanupConfirmed: false,
      ...(pickPathDiagnostic.renderRevisionObserver.errorName
        ? { errorName: pickPathDiagnostic.renderRevisionObserver.errorName }
        : {}),
    };
    if (!pickPathDiagnostic.renderRevisionObserver.available)
      pickPathDiagnostic.report.status = 'diagnostic-error';
  }
  let dataSource;
  let restored = true;
  try {
    restoreCamera(viewer, initialCamera);
    await targetLayer.init(viewer);
    await targetLayer.enable(viewer);
    lifetime.activationDiagnosticMs = performance.now() - layerStart;
    lifetime.activationTimingScope =
      'single-layer-activation-diagnostic-not-performance-evidence';
    dataSource = viewer.dataSources.getByName(layer.layerName)?.[0];
    check(
      dataSource && dataSource.isLoading !== true,
      `Production ${layer.layerName} source did not load.`,
    );
    check(
      dataSource.entities.values.length === layer.entityCount,
      `Expected ${layer.entityCount} ${layer.layerId} GeoJSON entities; received ${dataSource.entities.values.length}.`,
    );
    const records = targetLayer.getAnalystRecords(
      dataSource.entities.values.length,
    );
    check(
      records.length === layer.surfaceCount,
      `Expected all ${layer.surfaceCount} ${layer.layerId} surface identities; received ${records.length}.`,
    );
    currentUpdateReadinessObserver =
      installInfrastructureCurrentUpdateReadinessObserver({
        dataSourceDisplay: viewer.dataSourceDisplay,
        scene: viewer.scene,
        entityCollection: dataSource.entities,
      });
    if (currentUpdateReadinessLifetime) {
      currentUpdateReadinessLifetime.available =
        currentUpdateReadinessObserver.available;
      currentUpdateReadinessLifetime.installErrorName =
        currentUpdateReadinessObserver.installErrorName;
    }
    let collections =
      mode === 'primitive-collections'
        ? findProductionCollection(viewer, layer.layerId)
        : null;
    const time = Cesium.JulianDate.clone(renderTime);
    const readRows = () =>
      mode === 'entities'
        ? readEntitySurfaces(dataSource, records, time, layer.layerId)
        : readCollectionSurfaces(
            dataSource,
            records,
            collections,
            time,
            layer.layerId,
          );
    let preferredPickEntityId = null;
    let rows = readRows();
    const first = rows[0];
    const anchor = Cesium.Cartographic.fromCartesian(
      new Cesium.Cartesian3(...first.point.position),
    );
    check(anchor, 'Source anchor is not cartographic.');
    lifetime.cameraContract = runtimeCameraContract(layer.layerId, anchor);
    const renderState = () => {
      const owner = scanOwners(viewer, layer.layerId);
      const graphics = countInfrastructureGraphics(
        dataSource.entities.values,
        rows.map((row) => row.entity),
      );
      const graphicCount = graphics.surfaceGraphics;
      check(
        JSON.stringify(graphics.preservedGraphics) ===
          JSON.stringify(layer.preservedGraphics),
        `Preserved source geometry differs for ${layer.layerId}.`,
      );
      if (mode === 'entities')
        check(
          owner.count === 0 && graphicCount === rows.length,
          'Baseline is not the default Entity representation.',
        );
      else {
        const diagnostic = targetLayer.getSurfaceRendererDiagnostics();
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
      const currentUpdateGeneration =
        currentUpdateReadinessObserver?.beginGeneration().generation ?? null;
      const readiness = createInfrastructureSampleReadiness({
        diagnostics: true,
      });
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
      let sceneReadiness = null;
      let currentUpdateReadyForGeneration = currentUpdateReadinessRequired
        ? false
        : null;
      let currentUpdateLastObserverSnapshot = null;
      while (performance.now() < deadline) {
        try {
          finalFrame = await captureFrame(
            viewer,
            !pickPathDiagnostic &&
              !primitiveReadinessDiagnostic &&
              currentUpdateReadinessObserver?.available
              ? () => currentUpdateReadinessObserver.read()
              : pickPathDiagnostic?.renderRevisionObserver.available
                ? () => pickPathDiagnostic.renderRevisionObserver.read()
                : null,
          );
        } catch (error) {
          if (
            currentUpdateReadinessLifetime &&
            currentUpdateReadinessLifetime.samples.length <
              CURRENT_UPDATE_SAMPLE_LIMIT
          ) {
            const witness = readInfrastructureCurrentUpdateWitness(
              currentUpdateReadinessObserver,
              currentUpdateGeneration,
            );
            currentUpdateLastObserverSnapshot = witness.snapshot;
            currentUpdateReadinessLifetime.samples.push(
              createInfrastructureCurrentUpdateReadinessSample({
                caseId,
                pair,
                status: 'failed',
                generation: currentUpdateGeneration,
                capture: null,
                lastObserverSnapshot: witness.snapshot,
                captureFrameErrorName: [
                  'TypeError',
                  'DeveloperError',
                  'RangeError',
                ].includes(error?.name)
                  ? error.name
                  : 'Error',
                currentUpdateReadyForGeneration: false,
                latchedDataSourceDisplayReady:
                  viewer.dataSourceDisplay.ready === true,
              }),
            );
          }
          throw error;
        }
        completedCaptures++;
        const captureFrameState = finalFrame.completedFrameState || null;
        if (currentUpdateReadinessRequired) {
          const witness = readInfrastructureCurrentUpdateWitness(
            currentUpdateReadinessObserver,
            currentUpdateGeneration,
          );
          currentUpdateLastObserverSnapshot = witness.snapshot;
          currentUpdateReadyForGeneration =
            infrastructureCurrentUpdateGateReady({
              required: currentUpdateReadinessRequired,
              observerAvailable:
                currentUpdateReadinessObserver?.available === true,
              witnessReady:
                !finalFrame.completedFrameStateErrorName && witness.ready,
            });
        }
        if (pickRow) selectionRendered = true;
        rows = readRows();
        const hash = await sha256(
          new TextEncoder().encode(JSON.stringify(geometrySnapshot(rows))),
        );
        const signature = `${finalFrame.pixelSha256}:${hash}`;
        observedGeometry = hash;
        lodDiagnostics = targetLayer.getLodDiagnostics();
        cameraPosition = finitePosition(viewer.camera.positionWC);
        sceneReadiness = {
          dataSourcesReady: viewer.dataSourceDisplay.ready,
          globeTilesLoaded: viewer.scene.globe.tilesLoaded,
        };
        geometryReady =
          (!changedGeometryFrom || hash !== changedGeometryFrom) &&
          infrastructureCameraRevisionReady(lodDiagnostics, cameraPosition) &&
          sceneReadiness.dataSourcesReady === true &&
          sceneReadiness.globeTilesLoaded === true &&
          (currentUpdateReadinessRequired
            ? currentUpdateReadyForGeneration === true
            : true);
        stableFrames = readiness.observe(signature, {
          inputsReady: geometryReady,
        });
        if (
          pickPathDiagnostic &&
          pickPathDiagnostic.renderRevisionObserver.available &&
          recordSample &&
          geometryReady &&
          (pickPathDiagnostic.candidateEntityIds || stableFrames >= 3)
        ) {
          try {
            if (finalFrame.completedFrameStateErrorName)
              throw Object.assign(
                new Error('Completed-render witness could not be read.'),
                { name: finalFrame.completedFrameStateErrorName },
              );
            runPickPathDiagnosticFrame({
              viewer,
              rows,
              collections,
              layerId: targetLayerId,
              state: pickPathDiagnostic,
              caseId,
              pair,
              completedRenderRevision:
                captureFrameState?.completedRenderRevision,
              renderSignature: signature,
              cameraPosition,
              renderClock: report.renderClock,
              captureFrameState,
              readFrameState: () =>
                pickPathDiagnostic.renderRevisionObserver.read(),
            });
          } catch (error) {
            pickPathDiagnostic.report.status = 'diagnostic-error';
            if (
              pickPathDiagnostic.report.observations.length <
              INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME *
                INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE
            )
              pickPathDiagnostic.report.observations.push({
                phase: 'diagnostic-error',
                caseId,
                pair,
                candidateEntityId: null,
                completedRenderRevision:
                  captureFrameState?.completedRenderRevision || null,
                renderSignature: signature,
                status: 'diagnostic-error',
                errorName: [
                  'TypeError',
                  'DeveloperError',
                  'RangeError',
                  'PickError',
                ].includes(error?.name)
                  ? error.name
                  : 'Error',
                pickCalls: 0,
              });
          }
        }
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
            targetLayerId,
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
          readinessHistory: readiness.diagnostics(),
          stableFrames,
          completedCaptures,
          pickSearches,
          pickDiagnostics,
          geometryReady,
          observedGeometry,
          changedGeometryFrom,
          lodDiagnostics,
          cameraPosition,
          sceneReadiness,
          captureFrameStateErrorName:
            finalFrame?.completedFrameStateErrorName ?? null,
          ...(currentUpdateReadinessLifetime
            ? {
                currentUpdateReadiness: {
                  generation: currentUpdateGeneration,
                  capture: finalFrame?.completedFrameState ?? null,
                  currentUpdateReadyForGeneration:
                    currentUpdateReadyForGeneration === true,
                  latchedDataSourceDisplayReady:
                    sceneReadiness?.dataSourcesReady === true,
                },
              }
            : {}),
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
        if (
          currentUpdateReadinessLifetime &&
          currentUpdateReadinessLifetime.samples.length <
            CURRENT_UPDATE_SAMPLE_LIMIT
        )
          currentUpdateReadinessLifetime.samples.push(
            createInfrastructureCurrentUpdateReadinessSample({
              caseId,
              pair,
              status: 'failed',
              generation: currentUpdateGeneration,
              capture: finalFrame?.completedFrameState ?? null,
              lastObserverSnapshot: currentUpdateLastObserverSnapshot,
              captureFrameErrorName:
                finalFrame?.completedFrameStateErrorName ?? null,
              currentUpdateReadyForGeneration:
                currentUpdateReadyForGeneration === true,
              latchedDataSourceDisplayReady:
                sceneReadiness?.dataSourcesReady === true,
            }),
          );
        if (primitiveReadinessDiagnostic) Object.freeze(lifetime.failedSample);
        if (primitiveReadinessDiagnostic) {
          const targets = selectPrimitiveReadinessTargets(rows);
          const gateFailure = {
            caseId,
            pair,
            status: 'failed',
            stableFrames,
            completedCaptures,
            pickSearches,
            geometryReady,
            sourceReady: sceneReadiness?.dataSourcesReady ?? null,
            pointPickObserved: Boolean(pointPick),
            stemPickObserved: Boolean(stemPick),
          };
          const diagnostic = primitiveReadinessDiagnostic.report;
          const diagnosticStartedAt = performance.now();
          let diagnosticRenderRequested = false;
          diagnostic.status = 'observed';
          diagnostic.originalGate = gateFailure;
          diagnostic.targets = targets.map((target) => ({ ...target }));
          try {
            diagnostic.initialSnapshot =
              collectInfrastructurePrimitiveReadiness({
                Cesium,
                viewer,
                candidates: targets,
                entityById: new Map(
                  rows.map((row) => [row.entityId, row.entity]),
                ),
                ownerIds: primitiveReadinessDiagnostic.ownerIds,
                maxOwners: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS,
                maxDepth: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH,
                maxPointChildren:
                  INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
              });
            diagnostic.targets = diagnostic.targets.map((target, index) => ({
              ...target,
              pointStatus:
                diagnostic.initialSnapshot.targets[index]?.pointStatus ||
                'unknown',
              stemStatus:
                diagnostic.initialSnapshot.targets[index]?.stemStatus ||
                'unknown',
            }));
            const observer = createCompletedRenderRevisionObserver(viewer);
            primitiveReadinessDiagnostic.renderRevisionObserver = observer;
            diagnostic.renderRevisionObserver = {
              available: observer.available,
              cleanupConfirmed: false,
              ...(observer.errorName ? { errorName: observer.errorName } : {}),
            };
            diagnostic.postFailureObservation =
              await observePrimitiveReadinessAfterFailure({
                gateFailure,
                capture: ({ signal, markRenderRequested }) => {
                  if (!observer.available)
                    throw new Error(
                      'Post-render revision observer is unavailable.',
                    );
                  markRenderRequested();
                  diagnosticRenderRequested = true;
                  return captureFrame(
                    viewer,
                    () => ({
                      ...observer.read(),
                      primitiveReadiness:
                        collectInfrastructurePrimitiveReadiness({
                          Cesium,
                          viewer,
                          candidates: targets,
                          entityById: new Map(
                            rows.map((row) => [row.entityId, row.entity]),
                          ),
                          ownerIds: primitiveReadinessDiagnostic.ownerIds,
                          maxOwners:
                            INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS,
                          maxDepth:
                            INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH,
                          maxPointChildren:
                            INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
                        }),
                    }),
                    FRAME_TIMEOUT_MS,
                    signal,
                  );
                },
              });
            if (
              diagnostic.postFailureObservation.status !==
              'completed-frame-observed'
            )
              diagnostic.status = 'partial-or-diagnostic-error';
          } catch (error) {
            diagnostic.status = 'partial-or-diagnostic-error';
            const diagnosticElapsedMs = Math.max(
              0,
              performance.now() - diagnosticStartedAt,
            );
            diagnostic.postFailureObservation = {
              phase: 'post-failure-later-frame-observation',
              originalGateFailed: true,
              acceptanceEligible: false,
              originalGate: gateFailure,
              requestedDiagnosticRender: diagnosticRenderRequested,
              additionalPickCalls: 0,
              durationBudgetMs: INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
              elapsedMs: diagnosticElapsedMs,
              overBudget:
                diagnosticElapsedMs >
                INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
              status: 'diagnostic-error',
              frame: null,
              errorName: ['TypeError', 'DeveloperError', 'RangeError'].includes(
                error?.name,
              )
                ? error.name
                : 'Error',
            };
          }
        }
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
        sceneReadiness,
        ...(currentUpdateReadinessLifetime
          ? {
              currentUpdateReadiness: {
                generation: currentUpdateGeneration,
                capture: finalFrame?.completedFrameState ?? null,
                currentUpdateReadyForGeneration:
                  currentUpdateReadyForGeneration === true,
                latchedDataSourceDisplayReady:
                  sceneReadiness?.dataSourcesReady === true,
              },
            }
          : {}),
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
            ? targetLayer.getSurfaceRendererDiagnostics()
            : null,
        layerResourceDiagnostics: targetLayer.getPerformanceDiagnostics(),
        entitySelectionIdentity: String(viewer.selectedEntity?.id || ''),
      };
      if (
        currentUpdateReadinessLifetime &&
        currentUpdateReadinessLifetime.samples.length <
          CURRENT_UPDATE_SAMPLE_LIMIT
      )
        currentUpdateReadinessLifetime.samples.push(
          createInfrastructureCurrentUpdateReadinessSample({
            caseId,
            pair,
            status: 'settled',
            captureFrameErrorName:
              finalFrame?.completedFrameStateErrorName ?? null,
            lastObserverSnapshot: currentUpdateLastObserverSnapshot,
            ...row.currentUpdateReadiness,
          }),
        );
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
    if (currentUpdateReadinessObserver) {
      const cleanupConfirmed = currentUpdateReadinessObserver.dispose();
      restored &&= cleanupConfirmed;
      if (currentUpdateReadinessLifetime) {
        currentUpdateReadinessLifetime.cleanupConfirmed = cleanupConfirmed;
        currentUpdateReadinessLifetime.finalObserverState =
          currentUpdateReadinessObserver.snapshot();
      }
    }
    for (const layer of layers) {
      try {
        layer.destroy(viewer);
      } catch (error) {
        restored = false;
        lifetime.teardownError = String(error);
      }
    }
    const owner = scanOwners(viewer, layer.layerId);
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
    if (pickPathDiagnostic) {
      const observer = pickPathDiagnostic.renderRevisionObserver;
      const cleanupConfirmed = observer.dispose();
      Object.assign(pickPathDiagnostic.report.renderRevisionObserver, {
        available: observer.available,
        cleanupConfirmed,
        ...(observer.errorName ? { errorName: observer.errorName } : {}),
      });
      if (!cleanupConfirmed && pickPathDiagnostic.report.status === 'running')
        pickPathDiagnostic.report.status = 'diagnostic-error';
      if (pickPathDiagnostic.report.status === 'running')
        pickPathDiagnostic.report.status = lifetime.status;
      else if (lifetime.status === 'failed')
        pickPathDiagnostic.report.status = 'failed';
      pickPathDiagnostic.report.pickCalls = pickPathDiagnostic.budget.calls;
      pickPathDiagnostic.envelope.pickCalls =
        pickPathDiagnostic.envelope.lifetimes.reduce(
          (sum, item) =>
            sum + (Number.isSafeInteger(item.pickCalls) ? item.pickCalls : 0),
          0,
        );
    }
    if (primitiveReadinessDiagnostic?.renderRevisionObserver) {
      const observer = primitiveReadinessDiagnostic.renderRevisionObserver;
      const cleanupConfirmed = observer.dispose();
      Object.assign(
        primitiveReadinessDiagnostic.report.renderRevisionObserver,
        {
          available: observer.available,
          cleanupConfirmed,
          ...(observer.errorName ? { errorName: observer.errorName } : {}),
        },
      );
      if (!cleanupConfirmed)
        primitiveReadinessDiagnostic.report.status =
          'partial-or-diagnostic-error';
    }
    if (!report.lifetimes.includes(lifetime)) report.lifetimes.push(lifetime);
  }
  if (lifetime.teardownError) throw new Error(lifetime.teardownError);
  return lifetime;
}

async function runDiagnostic() {
  check(
    [
      pickPathDiagnosticEnabled,
      primitiveReadinessDiagnosticEnabled,
      currentUpdateReadinessDiagnosticEnabled,
    ].filter(Boolean).length <= 1,
    'Infrastructure diagnostics must run separately.',
  );
  const report = {
    schema: fixtureLayer.schema,
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    source: await sourceDigest(fixtureLayer),
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
    ...(pickPathDiagnosticEnabled ||
    primitiveReadinessDiagnosticEnabled ||
    currentUpdateReadinessDiagnosticEnabled
      ? {
          instrumentation: {
            ...(pickPathDiagnosticEnabled
              ? {
                  pickPathDiagnostic: {
                    schema: INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA,
                    enabled: true,
                    instrumented: true,
                    diagnosticOnly: true,
                    performanceAcceptanceEligible: false,
                    pickAcceptanceEligible: false,
                    scope:
                      'synchronous native scene picks in three selection-order controls; diagnostic calls never satisfy fixture pick gates',
                    frameWitnessSemantics:
                      'postRender count, camera position and clock only; scene.pick may advance internal preparation',
                    maxCandidatesPerLifetime:
                      INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME,
                    maxCompletedRenderRevisionsPerCandidate:
                      INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE,
                    maxPickCallsPerLifetime:
                      INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
                    maxPickCalls: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT,
                    pickCalls: 0,
                    status: 'running',
                    lifetimes: [],
                  },
                }
              : {}),
            ...(primitiveReadinessDiagnosticEnabled
              ? {
                  primitiveReadinessDiagnostic:
                    createInfrastructurePrimitiveReadinessEnvelope(),
                }
              : {}),
            ...(currentUpdateReadinessDiagnosticEnabled
              ? {
                  currentUpdateReadiness:
                    createInfrastructureCurrentUpdateReadinessEnvelope(),
                }
              : {}),
          },
        }
      : {}),
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
      fixtureLayer,
      report.source,
      report,
      renderTime,
      initialCamera,
    );
    await runLayerLifetime(
      viewer,
      'primitive-collections',
      fixtureLayer,
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
  const pickPathEnvelope = report.instrumentation?.pickPathDiagnostic;
  if (pickPathEnvelope) {
    pickPathEnvelope.status =
      pickPathEnvelope.lifetimes.length === 2 &&
      pickPathEnvelope.lifetimes.every(
        (item) => item.status === 'passed' && item.observations.length > 0,
      )
        ? 'complete'
        : 'partial-or-diagnostic-error';
    pickPathEnvelope.pickCalls = pickPathEnvelope.lifetimes.reduce(
      (sum, item) =>
        sum + (Number.isSafeInteger(item.pickCalls) ? item.pickCalls : 0),
      0,
    );
  }
  const primitiveReadinessEnvelope =
    report.instrumentation?.primitiveReadinessDiagnostic;
  if (primitiveReadinessEnvelope) {
    primitiveReadinessEnvelope.status =
      primitiveReadinessEnvelope.lifetimes.some(
        (item) => item.status !== 'not-triggered',
      )
        ? 'partial-or-diagnostic-error'
        : 'not-triggered';
  }
  const currentUpdateReadinessEnvelope =
    report.instrumentation?.currentUpdateReadiness;
  if (currentUpdateReadinessEnvelope) {
    const expectedSamples = [
      'default-style',
      'camera-lod-update-baseline',
      'camera-lod-update',
    ].flatMap((caseId) =>
      Array.from(
        { length: INFRASTRUCTURE_RUNTIME_PAIRS },
        (_, pair) => `${caseId}\u0000${pair}`,
      ),
    );
    currentUpdateReadinessEnvelope.status =
      currentUpdateReadinessEnvelope.lifetimes.length === 2 &&
      currentUpdateReadinessEnvelope.lifetimes.every(
        (item) =>
          item.available === true &&
          item.cleanupConfirmed === true &&
          item.samples.length === expectedSamples.length &&
          expectedSamples.every((identity) =>
            item.samples.some(
              (sample) => `${sample.caseId}\u0000${sample.pair}` === identity,
            ),
          ) &&
          item.samples.every(
            (sample) =>
              sample.status === 'settled' &&
              sample.captureFrameErrorName === null &&
              sample.currentUpdateReadyForGeneration === true,
          ),
      )
        ? 'complete'
        : 'partial-or-diagnostic-error';
  }
  if (report.status === 'passed') {
    try {
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: report.applicationCommit,
        allowPickPathDiagnostic: pickPathDiagnosticEnabled,
        allowCurrentUpdateReadinessDiagnostic:
          currentUpdateReadinessDiagnosticEnabled,
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
  return compareInfrastructureRuntimeLifetimes(baseline, candidate);
}

async function main() {
  status.textContent =
    'Running default and candidate production layer lifetimes…';
  const report = await runDiagnostic();
  if (frameFailureDiagnosticEnabled) {
    report.frameFailureDiagnosticEnabled = true;
    report.performanceAcceptanceEligible = false;
    report.frameFailure = frameFailure;
  }
  output.textContent = JSON.stringify(report);
  status.textContent = report.status;
}

main().catch((error) => {
  output.textContent = JSON.stringify({
    schema: fixtureLayer.schema,
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
