import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const baselineCommit = 'aea307c211e99f2f23a538a8356825723edd0097';
const args = process.argv.slice(2);
let outPath = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--out' || !args[i + 1] || outPath) {
    throw new Error(
      'Usage: node scripts/qa-cctv-gizmo-geometry.mjs [--out PATH]',
    );
  }
  outPath = path.resolve(root, args[i + 1]);
  i += 1;
}
const baselineText = execFileSync(
  'git',
  ['show', `${baselineCommit}:src/data/cctvGizmo.js`],
  { cwd: root, encoding: 'utf8' },
);
const baselineBytes = Buffer.from(baselineText, 'utf8');
const baselinePath = path.join(
  root,
  'src',
  'data',
  `.cctvGizmo-baseline-${process.pid}-${Date.now()}.mjs`,
);
const candidatePath = path.join(root, 'src', 'data', 'cctvGizmo.js');
const candidateBytes = await readFile(candidatePath);
const harnessBytes = await readFile(scriptPath);
const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const sourceStatus = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' },
);
const sourceStatusEntries = sourceStatus.split(/\r?\n/).filter(Boolean);
const candidateSourceDirty = sourceStatusEntries.some((entry) =>
  entry.slice(3).replaceAll('\\', '/').endsWith('src/data/cctvGizmo.js'),
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const previousDocument = globalThis.document;
globalThis.document = {
  onmousewheel: null,
  addEventListener() {},
  removeEventListener() {},
};

function makeViewer() {
  const listeners = new Map();
  const canvas = {
    disableRootEvents: true,
    clientWidth: 800,
    clientHeight: 600,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    onwheel: null,
    style: {},
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
  };
  const scene = {
    canvas,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    ellipsoid: Cesium.Ellipsoid.WGS84,
  };
  const camera = new Cesium.Camera(scene);
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7, 30.3, 10_000_000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  Object.assign(scene, {
    camera,
    globe: undefined,
    mode: Cesium.SceneMode.SCENE3D,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    cameraUnderground: false,
    postUpdate: new Cesium.Event(),
    pick: () => ({ id: { id: 'cctv-gizmo-move-east' } }),
    drillPick: () => [],
  });
  const controller = new Cesium.ScreenSpaceCameraController(scene);
  controller.enableCollisionDetection = false;
  scene.screenSpaceCameraController = controller;
  const entities = new Cesium.EntityCollection();
  const viewer = {
    scene,
    camera: { getPickRay: () => null },
    entities,
  };
  return { viewer, controller, entities };
}

function makeRecord({
  rangeM = 100,
  headingDeg = 0,
  pitchDeg = -17,
  longitude = -97,
  altitudeM = 20,
  capAltitudeM = 720,
  capHalfWidthDeg = 0.0001,
  capHalfHeightDeg = 0.0001,
} = {}) {
  return {
    camera: {
      id: 'geometry-refresh',
      headingDeg,
      pitchDeg,
      rangeM,
      basePose: {},
    },
    frustumPositions: {
      mount: Cesium.Cartesian3.fromDegrees(longitude, 30, altitudeM),
      capCenter: Cesium.Cartesian3.fromDegrees(longitude, 30, capAltitudeM),
      tl: Cesium.Cartesian3.fromDegrees(
        longitude - capHalfWidthDeg,
        30 + capHalfHeightDeg,
        capAltitudeM,
      ),
      tr: Cesium.Cartesian3.fromDegrees(
        longitude + capHalfWidthDeg,
        30 + capHalfHeightDeg,
        capAltitudeM,
      ),
      bl: Cesium.Cartesian3.fromDegrees(
        longitude - capHalfWidthDeg,
        30 - capHalfHeightDeg,
        capAltitudeM,
      ),
      br: Cesium.Cartesian3.fromDegrees(
        longitude + capHalfWidthDeg,
        30 - capHalfHeightDeg,
        capAltitudeM,
      ),
    },
    frustumGeometry: { rangeM },
  };
}

function cloneRecord(record) {
  return {
    ...record,
    camera: { ...record.camera },
    frustumPositions: Object.fromEntries(
      Object.entries(record.frustumPositions).map(([key, value]) => [
        key,
        Cesium.Cartesian3.clone(value),
      ]),
    ),
  };
}

function snapshot(entities) {
  const value = (property) =>
    typeof property?.getValue === 'function' ? property.getValue() : property;
  const color = (property) => {
    const current = value(property);
    return current && [current.red, current.green, current.blue, current.alpha];
  };
  return entities.values
    .map((entity) => {
      const position = value(entity.position);
      const line = entity.polyline;
      const point = entity.point;
      return {
        id: entity.id,
        show: entity.show,
        position: position && [position.x, position.y, position.z],
        point: point && {
          pixelSize: value(point.pixelSize),
          color: color(point.color),
          outlineColor: color(point.outlineColor),
          outlineWidth: value(point.outlineWidth),
          disableDepthTestDistance: value(point.disableDepthTestDistance),
        },
        polyline: line && {
          positions: value(line.positions).map(({ x, y, z }) => [x, y, z]),
          width: value(line.width),
          materialType: line.material.getType(),
          materialColor: color(line.material.color),
          depthFailColor: color(line.depthFailMaterial.color),
        },
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function runSequence(createCalibrationGizmo) {
  const { viewer, controller, entities } = makeViewer();
  const updaters = [];
  const removers = [];
  const stages = [];
  let gizmo;
  let result;
  let primaryError;
  try {
    let record = makeRecord();
    gizmo = createCalibrationGizmo({
      viewer,
      getActiveRecord: () => record,
      applyPatch() {},
      endPatch() {},
    });
    gizmo.setEnabled(true);
    const lines = entities.values.filter((entity) => entity.polyline);
    for (const entity of lines) {
      const updater = new Cesium.PolylineGeometryUpdater(entity, {
        frameState: { context: { depthTexture: true } },
      });
      updaters.push(updater);
      removers.push(
        updater.geometryChanged.addEventListener(() => {
          const entry = stages.at(-1);
          if (entry) entry.geometryChanged.push(entity.id);
        }),
      );
    }
    const apply = (name, update) => {
      const entry = { name, geometryChanged: [] };
      stages.push(entry);
      update();
      entry.snapshot = snapshot(entities);
      entry.geometryChanged.sort();
    };
    apply('initial', () => {});
    apply('unchanged-refreshes-and-toggle', () => {
      for (let n = 0; n < 5; n += 1) gizmo.refresh();
      gizmo.setEnabled(true);
      gizmo.setEnabled(false);
      gizmo.setEnabled(true);
    });
    apply('cloned-equivalent-record', () => {
      record = cloneRecord(record);
      gizmo.refresh();
    });
    apply('heading-only', () => {
      record = { ...record, camera: { ...record.camera, headingDeg: 35 } };
      gizmo.refresh();
    });
    apply('range-only', () => {
      record = { ...record, camera: { ...record.camera, rangeM: 180 } };
      gizmo.refresh();
    });
    apply('pitch-only', () => {
      record = { ...record, camera: { ...record.camera, pitchDeg: -24 } };
      gizmo.refresh();
    });
    apply('cap-altitude-only', () => {
      record = makeRecord({
        rangeM: 180,
        headingDeg: 35,
        pitchDeg: -24,
        capAltitudeM: 740,
      });
      gizmo.refresh();
    });
    apply('fov-only', () => {
      record = makeRecord({
        rangeM: 180,
        headingDeg: 35,
        pitchDeg: -24,
        capAltitudeM: 740,
        capHalfWidthDeg: 0.0002,
        capHalfHeightDeg: 0.00015,
      });
      gizmo.refresh();
    });
    apply('mount-and-terrain', () => {
      record = makeRecord({
        rangeM: 180,
        headingDeg: 35,
        pitchDeg: -24,
        longitude: -96.999,
        altitudeM: 125,
        capAltitudeM: 845,
        capHalfWidthDeg: 0.0002,
        capHalfHeightDeg: 0.00015,
      });
      gizmo.refresh();
    });
    apply('in-place-mutation', () => {
      Cesium.Cartesian3.fromDegrees(
        -96.998,
        30,
        125,
        undefined,
        record.frustumPositions.mount,
      );
      record.camera.headingDeg = 51;
      gizmo.refresh();
    });
    result = stages.map(({ name, geometryChanged, snapshot: output }) => ({
      name,
      geometryChanged,
      snapshot: output,
    }));
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  for (const remove of removers) {
    try {
      remove();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const updater of updaters) {
    try {
      updater.destroy();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const cleanup of [
    () => gizmo?.destroy(),
    () => controller.destroy(),
    () => entities.removeAll(),
  ]) {
    try {
      cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError) {
    if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
    throw primaryError;
  }
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Fixture cleanup failed');
  return result;
}

let baselineOwned = false;
try {
  await writeFile(baselinePath, baselineBytes, { flag: 'wx' });
  baselineOwned = true;
  const baselineModule = await import(pathToFileURL(baselinePath).href);
  const candidateModule = await import(pathToFileURL(candidatePath).href);
  const pairs = [];
  for (let pair = 0; pair < 5; pair += 1) {
    const baseline = await runSequence(baselineModule.createCalibrationGizmo);
    const candidate = await runSequence(candidateModule.createCalibrationGizmo);
    assert.deepEqual(
      candidate.map(({ name, snapshot: output }) => ({
        name,
        snapshot: output,
      })),
      baseline.map(({ name, snapshot: output }) => ({
        name,
        snapshot: output,
      })),
      `pair ${pair}: numerical geometry, visibility, IDs, and styles match`,
    );
    pairs.push({ pair, baseline, candidate });
  }
  const baselineInvalidations = pairs
    .flatMap((pair) => pair.baseline)
    .reduce((sum, stage) => sum + stage.geometryChanged.length, 0);
  const candidateInvalidations = pairs
    .flatMap((pair) => pair.candidate)
    .reduce((sum, stage) => sum + stage.geometryChanged.length, 0);
  const snapshotComparisonCount = pairs.reduce(
    (sum, pair) => sum + pair.baseline.length,
    0,
  );
  assert.equal(pairs.length, 5, 'run exactly five baseline/candidate pairs');
  assert.equal(snapshotComparisonCount, 50);
  assert.ok(
    candidateInvalidations < baselineInvalidations,
    'candidate must reduce actual updater invalidation notifications',
  );
  const report = {
    schema: 'gev-cctv-gizmo-geometry-comparison/v1',
    generatedAt: new Date().toISOString(),
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    scope:
      'Node real-Cesium Entity/PolylineGeometryUpdater definition-change notifications; not GPU builds or frame-rate evidence',
    baselineCommit,
    candidateCommit,
    sourceClean: sourceStatusEntries.length === 0,
    sourceStatusEntryCount: sourceStatusEntries.length,
    candidateSourceDirty,
    baselineSourceSha256: sha256(baselineBytes),
    candidateSourceSha256: sha256(candidateBytes),
    harnessSha256: sha256(harnessBytes),
    cesiumVersion: Cesium.VERSION,
    pairCount: pairs.length,
    snapshotsCompared: snapshotComparisonCount,
    sceneObjects: { gizmoEntities: 8, polylineGeometryUpdaters: 5 },
    pairs: pairs.map(({ pair, baseline, candidate }) => ({
      pair,
      stages: baseline.map((base, index) => ({
        name: base.name,
        geometryOutputsEqual: true,
        baselineSnapshotSha256: sha256(
          Buffer.from(JSON.stringify(base.snapshot)),
        ),
        candidateSnapshotSha256: sha256(
          Buffer.from(JSON.stringify(candidate[index].snapshot)),
        ),
        baselineGeometryChanged: base.geometryChanged.length,
        candidateGeometryChanged: candidate[index].geometryChanged.length,
        baselineChangedIds: base.geometryChanged,
        candidateChangedIds: candidate[index].geometryChanged,
      })),
    })),
    totalUpdaterInvalidations: {
      baseline: baselineInvalidations,
      candidate: candidateInvalidations,
    },
  };
  const reportPath =
    outPath ||
    path.join(
      root,
      'qa-artifacts',
      `cctv-gizmo-geometry-comparison-${sha256(candidateBytes).slice(0, 12)}-${sha256(harnessBytes).slice(0, 8)}.json`,
    );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({
      reportPath,
      candidateCommit,
      sourceClean: report.sourceClean,
      candidateSourceDirty,
      pairCount: report.pairCount,
      snapshotsCompared: report.snapshotsCompared,
      totalUpdaterInvalidations: report.totalUpdaterInvalidations,
    })}\n`,
  );
} finally {
  try {
    if (baselineOwned) await rm(baselinePath, { force: true });
  } finally {
    globalThis.document = previousDocument;
  }
}
