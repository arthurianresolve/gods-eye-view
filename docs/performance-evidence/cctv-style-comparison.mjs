import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

const root = process.cwd();
const baseline = 'c19f3271cce3655b10ff1d1abaf3acf288a762ef';
const candidate = process.argv[2];
assert.match(candidate || '', /^[a-f0-9]{40}$/);
const git = (...args) => execFileSync('git', args, { cwd: root });
assert.equal(git('rev-parse', 'HEAD').toString().trim(), candidate);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'src/layers/cctv/rendering.js';
const dependencies = {
  '../../data/iconOrientation.js': 'src/data/iconOrientation.js',
  './headingConfidence.js': 'src/layers/cctv/headingConfidence.js',
  './policy.js': 'src/layers/cctv/policy.js',
};
for (const dependency of Object.values(dependencies))
  assert.deepEqual(git('show', `${baseline}:${dependency}`), git('show', `${candidate}:${dependency}`));
const sourceDirty = () => Boolean(git('status', '--porcelain', '--untracked-files=no').toString().trim());
assert.equal(sourceDirty(), false, 'tracked source must be clean');
const rows = [];
for (const commit of [baseline, candidate]) {
  const bytes = git('show', `${commit}:${sourcePath}`);
  let source = bytes.toString().replace("from 'cesium'", `from '${import.meta.resolve('cesium')}'`);
  for (const [specifier, relative] of Object.entries(dependencies))
    source = source.replace(`from '${specifier}'`, `from '${pathToFileURL(path.join(root, relative)).href}'`);
  const { createRendering } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const record = { camera: { id: 'fixture', headingConfidence: 'low' }, coverageEntities: [] };
  for (let i = 0; i < 5; i++) {
    const entity = new Cesium.Entity({ id: `line-${i}`, polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([-97.7431, 30.2672, -97.742, 30.268]),
      material: Cesium.Color.WHITE, width: 1,
    } });
    entity._coverageRole = i === 4 ? 'cap' : 'ray';
    record.coverageEntities.push(entity);
  }
  const state = { _records: [record], _enabled: true, _coverageMode: 'frustum', _showProjection: true, _activeCameraId: 'fixture' };
  let active = record;
  const rendering = createRendering({ state, services: { focus: {} }, parts: {
    selection: { getActiveRecord: () => active },
    geometry: { ensureActiveCoverageEntities() {}, buildCoverageVisibleSet: () => new Set(['fixture']), ensureVisibleCoverageEntities() {} },
    model: { isVideoFeedType: () => false },
    projection: { ensureProjectionRuntime() {}, pauseInactiveProjectionFeeds() {} },
  } });
  const updaters = record.coverageEntities.map(entity => new Cesium.PolylineGeometryUpdater(entity, { frameState: { context: { depthTexture: true } } }));
  let changes = 0;
  const removers = updaters.map(updater => updater.geometryChanged.addEventListener(() => changes++));
  const sampleTime = Cesium.JulianDate.fromIso8601('2026-01-01T00:00:00Z');
  const phases = [];
  try {
    for (const [name, mutate] of [
      ['estimated-active-projection', () => {}],
      ['curated-active-projection', () => { record.camera.poseSource = 'curated'; }],
      ['curated-idle', () => { active = null; }],
      ['estimated-idle', () => { record.camera.poseSource = null; }],
      ['viewshed-active', () => { active = record; state._coverageMode = 'viewshed'; record.viewshedColors = { line: Cesium.Color.ORANGE, lineActive: Cesium.Color.YELLOW }; }],
      ['viewshed-idle', () => { active = null; }],
      ['viewshed-active-no-projection', () => { active = record; state._showProjection = false; }],
      ['frustum-active-no-projection', () => { state._coverageMode = 'frustum'; }],
    ]) {
      mutate();
      rendering.refreshCoverageStyles();
      const snapshot = record.coverageEntities.map(({ show, polyline }) => ({ show, width: polyline.width.getValue(sampleTime),
        materialType: polyline.material.getType(sampleTime), material: polyline.material.getValue(sampleTime),
        depthFail: polyline.depthFailMaterial?.getValue(sampleTime) ?? null,
      }));
      const repeatGeometryChanges = [];
      for (let i = 0; i < 5; i++) {
        const before = changes;
        rendering.refreshCoverageStyles();
        repeatGeometryChanges.push(changes - before);
      }
      phases.push({ name, stylesSha256: hash(JSON.stringify(snapshot)), repeatGeometryChanges });
    }
  } finally { removers.forEach(remove => remove()); updaters.forEach(updater => updater.destroy()); }
  rows.push({ commit, sourceSha256: hash(bytes), phases });
}
for (let i = 0; i < rows[0].phases.length; i++) {
  assert.equal(rows[0].phases[i].stylesSha256, rows[1].phases[i].stylesSha256);
  assert.ok(rows[0].phases[i].repeatGeometryChanges.every(count => count > 0));
  assert.ok(rows[1].phases[i].repeatGeometryChanges.every(count => count === 0));
}
assert.equal(sourceDirty(), false);
assert.equal(git('rev-parse', 'HEAD').toString().trim(), candidate);
const report = { schema: 'gev-cctv-style-comparison/v1', status: 'passed', timestamp: new Date().toISOString(),
  scope: 'real Cesium entities and geometry updaters; no browser, worker, GPU or frame-time measurement',
  cesiumVersion: Cesium.VERSION, nodeVersion: process.version, platform: process.platform,
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), sourceClean: true,
  stylesEqual: true, rows,
};
const output = `qa-artifacts/cctv-style-comparison-${candidate.slice(0, 7)}.json`;
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status: report.status, phases: rows[0].phases.length, stylesEqual: true }));
