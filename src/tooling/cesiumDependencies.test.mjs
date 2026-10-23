import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertCesiumDependencyIdentity,
  cesiumDependencyIdentityPlugin,
} from '../../build/cesium-dependencies.js';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gev-cesium-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function pkg(root, name) {
  const directory = path.join(root, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0' }),
  );
  return directory;
}

function graph(root) {
  return {
    cesium: pkg(root, 'cesium'),
    widgets: pkg(root, '@cesium/widgets'),
    engine: pkg(root, '@cesium/engine'),
  };
}

test('accepts one canonical engine and checks the Vite resolved root', (t) => {
  const root = fixture(t);
  const { engine } = graph(root);
  const rows = assertCesiumDependencyIdentity(root);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    [...new Set(rows.map((row) => row.path))],
    [realpathSync(path.join(engine, 'package.json'))],
  );
  assert.doesNotThrow(() =>
    cesiumDependencyIdentityPlugin().configResolved({ root }),
  );
});

test('rejects an independently installed same-version widgets engine', (t) => {
  const root = fixture(t);
  const { widgets } = graph(root);
  pkg(widgets, '@cesium/engine');
  assert.throws(
    () => assertCesiumDependencyIdentity(root),
    /Multiple Cesium engine instances/,
  );
  assert.throws(
    () => cesiumDependencyIdentityPlugin().configResolved({ root }),
    /clean checkout/,
  );
});

test('rejects an independently installed same-version cesium engine', (t) => {
  const root = fixture(t);
  const { cesium } = graph(root);
  pkg(cesium, '@cesium/engine');
  assert.throws(
    () => assertCesiumDependencyIdentity(root),
    /Multiple Cesium engine instances/,
  );
});

test('accepts a coherent junction but rejects mixed canonical package ownership', (t) => {
  const parent = fixture(t);
  const checkout = path.join(parent, 'checkout');
  const shared = path.join(parent, 'shared');
  mkdirSync(checkout);
  graph(shared);
  symlinkSync(
    path.join(shared, 'node_modules'),
    path.join(checkout, 'node_modules'),
    'junction',
  );
  assert.doesNotThrow(() => assertCesiumDependencyIdentity(checkout));
  const foreign = path.join(parent, 'foreign');
  const foreignWidgets = pkg(foreign, '@cesium/widgets');
  pkg(foreign, '@cesium/engine');
  // A new importer avoids Node's process-wide resolution cache of the coherent graph.
  const mixed = path.join(parent, 'mixed');
  graph(mixed);
  const widgetsPath = path.join(mixed, 'node_modules/@cesium/widgets');
  rmSync(widgetsPath, { recursive: true });
  symlinkSync(foreignWidgets, widgetsPath, 'junction');
  assert.throws(
    () => assertCesiumDependencyIdentity(mixed),
    /Multiple Cesium engine instances/,
  );
});

test('reports incomplete installation without changing dependency files', (t) => {
  const root = fixture(t);
  pkg(root, 'cesium');
  assert.throws(
    () => assertCesiumDependencyIdentity(root),
    /Cannot verify.*npm ci/,
  );
});
