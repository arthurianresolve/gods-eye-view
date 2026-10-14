// Read-only ownership/mutation audit. No browser, network, timing or GPU claims.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const prior = git('rev-parse', 'd8ce27b1^');
const current = git('rev-parse', 'HEAD');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = {};

async function loadFactory(revision, sourcePath, exportedName) {
  const source = execFileSync('git', ['show', `${revision}:${sourcePath}`], {
    cwd: root,
    encoding: 'utf8',
  });
  sources[`${revision}:${sourcePath}`] = sha256(source);
  const resolved = source.replace(
    /from (['"])([^'"]+)\1/g,
    (_match, _quote, specifier) => {
      const url = specifier.startsWith('.')
        ? pathToFileURL(path.resolve(root, path.dirname(sourcePath), specifier))
            .href
        : import.meta.resolve(specifier);
      return `from ${JSON.stringify(url)}`;
    },
  );
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`
  );
  return module[exportedName];
}

function measure(factory, { kind, moving }) {
  const population = kind === 'core' ? 840 : 10_000;
  const passes = kind === 'core' ? 10 : 300;
  const collection = new Cesium.PointPrimitiveCollection();
  const catalog = new Map();
  const points = new Map();
  let offset = 0;
  const positionFor = (id) => ({
    longitude: -100 + (id % 90) + offset,
    latitude: 20 + (id % 40),
    altitude: 400_000 + id,
  });
  for (let id = 0; id < population; id++) {
    const pos = positionFor(id);
    catalog.set(id, {
      group: kind === 'core' ? 'visual' : 'dense',
      satrec: id,
    });
    points.set(
      id,
      collection.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(
          pos.longitude,
          pos.latitude,
          pos.altitude,
        ),
      }),
    );
  }
  const state = {
    _catalog: catalog,
    _points: points,
    _denseIds: kind === 'dense' ? [...catalog.keys()] : [],
    _denseCursor: 0,
    _trackedNorad: null,
    _scratchPropagationCartesian: new Cesium.Cartesian3(),
  };
  const parts = { orbits: { propagatePosition: positionFor } };
  const driver = factory({ state, services: { focus: {} }, parts, source: {} });
  const positionDescriptor = Object.getOwnPropertyDescriptor(
    Cesium.PointPrimitive.prototype,
    'position',
  );
  let attemptedPositionWrites = 0;
  let dirtyNotifications = 0;
  let propagationCartesianCalls = 0;
  let suppliedResultCalls = 0;
  const returnedCartesians = new Set();
  const originalFromDegrees = Cesium.Cartesian3.fromDegrees;
  const originalUpdate = collection._updatePointPrimitive;
  for (const point of points.values()) {
    Object.defineProperty(point, 'position', {
      get() {
        return positionDescriptor.get.call(this);
      },
      set(value) {
        attemptedPositionWrites++;
        positionDescriptor.set.call(this, value);
      },
    });
  }
  collection._updatePointPrimitive = function (...args) {
    dirtyNotifications++;
    return originalUpdate.apply(this, args);
  };
  Cesium.Cartesian3.fromDegrees = function (...args) {
    propagationCartesianCalls++;
    if (args[4] !== undefined) suppliedResultCalls++;
    const result = originalFromDegrees.apply(this, args);
    returnedCartesians.add(result);
    return result;
  };
  try {
    for (let pass = 0; pass < passes; pass++) {
      if (moving) offset = (pass + 1) * 0.0001;
      if (kind === 'core') driver._propagateAll();
      else driver._propagateDenseChunk();
    }
    const coordinates = [...points.values()].map(({ id, position }) => [
      id,
      position.x,
      position.y,
      position.z,
    ]);
    return {
      kind,
      moving,
      population,
      passes,
      propagationCartesianCalls,
      suppliedResultCalls,
      distinctReturnedCartesians: returnedCartesians.size,
      attemptedPositionWrites,
      dirtyNotifications,
      finalCoordinatesSha256: sha256(JSON.stringify(coordinates)),
      gpuUploadCalls: null,
      gpuUploadBytes: null,
    };
  } finally {
    Cesium.Cartesian3.fromDegrees = originalFromDegrees;
    collection._updatePointPrimitive = originalUpdate;
    collection.destroy();
  }
}

const comparisons = [];
for (const [kind, sourcePath, name] of [
  ['core', 'src/layers/satellites/rendering.js', 'createRendering'],
  ['dense', 'src/layers/satellites/catalog.js', 'createCatalog'],
]) {
  const before = await loadFactory(prior, sourcePath, name);
  const after = await loadFactory(current, sourcePath, name);
  for (const moving of [false, true]) {
    const control = measure(before, { kind, moving });
    const candidate = measure(after, { kind, moving });
    assert.equal(
      candidate.finalCoordinatesSha256,
      control.finalCoordinatesSha256,
    );
    assert.equal(
      candidate.propagationCartesianCalls,
      control.propagationCartesianCalls,
    );
    assert.equal(candidate.dirtyNotifications, control.dirtyNotifications);
    assert.equal(candidate.distinctReturnedCartesians, 1);
    assert.equal(
      control.distinctReturnedCartesians,
      control.propagationCartesianCalls,
    );
    if (!moving) {
      assert.equal(candidate.attemptedPositionWrites, 0);
      assert.equal(candidate.dirtyNotifications, 0);
    }
    comparisons.push({ control, candidate });
  }
}

const { POINT_STYLES } = await import(
  pathToFileURL(path.join(root, 'src/layers/satellites/policy.js')).href
);
const styles = Object.entries(POINT_STYLES).map(([id, value]) => ({
  id,
  alpha: value.color.alpha,
  outlineAlpha: value.outlineColor.alpha,
  outlineWidth: value.outlineWidth,
}));
assert.ok(styles.some((row) => row.alpha === 1));
assert.ok(styles.some((row) => row.alpha > 0 && row.alpha < 1));
assert.ok(styles.some((row) => row.outlineWidth > 0 && row.outlineAlpha < 1));
console.log(
  JSON.stringify(
    {
      schema: 'gev-satellite-collection-mutation-audit/v1',
      scope:
        'Component CPU object identities and setter notifications; deterministic propagation seam, actual Cesium primitives. No rendering, latency or GPU upload measurement.',
      prior,
      current,
      node: process.version,
      cesium: Cesium.VERSION,
      sources,
      cesiumPointSourceSha256: sha256(
        readFileSync(
          path.join(
            root,
            'node_modules/@cesium/engine/Source/Scene/PointPrimitive.js',
          ),
        ),
      ),
      comparisons,
      currentStyles: styles,
      performanceAcceptanceEligible: false,
    },
    null,
    2,
  ),
);
