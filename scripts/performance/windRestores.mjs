/** Isolated application image preparation; no GPU, PNG encoding or motion claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const option = (key) => process.argv[process.argv.indexOf(key) + 1];
const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const hash = (pixels) => createHash('sha256').update(pixels).digest('hex');
if (process.argv.includes('--child')) {
  const root = path.resolve(option('--child'));
  assert.equal(
    git(root, ['status', '--porcelain', '--untracked-files=no']),
    '',
  );
  const { createWindRendering } = await import(
    pathToFileURL(path.join(root, 'src/layers/wind/rendering.js'))
  );
  let pixels,
    builds = 0,
    removals = 0;
  const live = new Set();
  const canvas = () => ({
    style: {},
    dataset: {},
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => ({
      clearRect() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(image) {
        pixels = image.data;
        builds++;
      },
    }),
    toDataURL: () => 'data:image/png;base64,fixture',
    remove() {},
  });
  globalThis.document = { createElement: canvas, hidden: false };
  const viewer = {
    scene: {
      canvas: canvas(),
      camera: { positionCartographic: { height: 1e6 } },
      requestRender() {},
    },
    imageryLayers: {
      addImageryProvider(provider) {
        const layer = { provider };
        live.add(layer);
        return layer;
      },
      remove(layer) {
        removals++;
        live.delete(layer);
      },
    },
  };
  const rendering = createWindRendering({
    cesium: {
      Rectangle: { MAX_VALUE: {} },
      SingleTileImageryProvider: class {},
    },
    container: { appendChild() {} },
    getViewer: () => viewer,
    createGpuRendering: () => ({
      supported: () => true,
      setField: () => true,
      setOptions() {},
      clear() {},
      destroy() {},
      getDiagnostics: () => ({ ready: true }),
    }),
  });
  const grid = { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 };
  const fixture = {
    grid,
    model: 'fixture',
    level: 'surface',
    units: 'm/s',
    cycle: { runIso: '2026-01-01T00:00:00Z' },
    u: Float32Array.from(
      { length: 65160 },
      (_, i) => 10 + Math.sin(i * 0.01) * 3,
    ),
    v: Float32Array.from({ length: 65160 }, (_, i) => Math.cos(i * 0.01) * 4),
  };
  const reports = [];
  rendering.attach();
  try {
    for (const overlay of ['speed', 'temperature', 'pressure']) {
      for (const update of ['equivalent', 'revised']) {
        rendering.clear();
        rendering.setOptions({ overlay });
        const snapshot = {
          ...fixture,
          scalar: {
            kind: overlay,
            units: overlay === 'pressure' ? 'hPa' : '\u00b0C',
            values: Float32Array.from(
              { length: 65160 },
              (_, i) =>
                (overlay === 'pressure' ? 1013 : 20) + Math.sin(i * 0.001) * 10,
            ),
          },
        };
        const clone = () => ({
          ...snapshot,
          u: new Float32Array(snapshot.u),
          v: new Float32Array(snapshot.v),
          scalar: {
            ...snapshot.scalar,
            values: new Float32Array(snapshot.scalar.values),
          },
        });
        const input = (revision) => {
          const next = clone();
          if (update === 'revised') {
            const values = overlay === 'speed' ? next.u : next.scalar.values;
            values[values.length - 1] += revision + 1;
          }
          return next;
        };
        for (let i = 0; i < 3; i++) rendering.setField(input(i));
        const expected = hash(pixels);
        const buildsBefore = builds,
          removalsBefore = removals;
        let elapsedMs = 0;
        const pixelSequence = createHash('sha256');
        for (let i = 0; i < 10; i++) {
          const next = input(i + 3);
          const start = performance.now();
          rendering.setField(next);
          elapsedMs += performance.now() - start;
          if (update === 'equivalent')
            assert.equal(
              hash(pixels),
              expected,
              'Equivalent field changed raster',
            );
          pixelSequence.update(pixels);
          assert.equal(live.size, 1, 'Image ownership grew');
        }
        reports.push({
          overlay,
          update,
          restores: 10,
          elapsedMs,
          perRestoreMs: elapsedMs / 10,
          textureBuilds: builds - buildsBefore,
          removedImages: removals - removalsBefore,
          retainedImages: live.size,
          rasterSequenceSha256: pixelSequence.digest('hex'),
        });
      }
    }
  } finally {
    rendering.destroy();
  }
  assert.equal(live.size, 0, 'Teardown retained imagery');
  console.log(
    JSON.stringify({ commit: git(root, ['rev-parse', 'HEAD']), reports }),
  );
} else {
  assert.ok(
    process.argv.includes('--baseline') && process.argv.includes('--out'),
  );
  const roots = {
    baseline: path.resolve(option('--baseline')),
    candidate: path.resolve(path.dirname(script), '../..'),
  };
  const report = {
    schema: 'gev-wind-restore-cpu/v1',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    fixture: 'synthetic-360x181-wind-and-scalars/v1',
    scope:
      'Five alternating Node child-process pairs, three warmups and ten restores per overlay and equivalent/revised case. Actual application raster generation with mocked DOM and imagery ownership; no Cesium drawing, GPU, PNG encoding, forced GC or motion claim. Fresh input clones and output hashing are outside the timed restore.',
    samples: [],
  };
  for (let pair = 0; pair < 5; pair++) {
    for (const variant of pair % 2
      ? ['candidate', 'baseline']
      : ['baseline', 'candidate']) {
      const sample = JSON.parse(
        execFileSync(process.execPath, [script, '--child', roots[variant]], {
          encoding: 'utf8',
          timeout: 30000,
        }),
      );
      report.samples.push({ pair, variant, ...sample });
    }
  }
  const cases = ['speed', 'temperature', 'pressure'].flatMap((overlay) =>
    ['equivalent', 'revised'].map((update) => ({ overlay, update })),
  );
  report.rasterEquivalent = cases.every(
    ({ overlay, update }) =>
      new Set(
        report.samples.map(
          (sample) =>
            sample.reports.find(
              (item) => item.overlay === overlay && item.update === update,
            ).rasterSequenceSha256,
        ),
      ).size === 1,
  );
  writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
  assert.ok(report.rasterEquivalent, 'Raster output changed across builds');
  const median = (overlay, update, variant) =>
    report.samples
      .filter((sample) => sample.variant === variant)
      .map(
        (sample) =>
          sample.reports.find(
            (item) => item.overlay === overlay && item.update === update,
          ).perRestoreMs,
      )
      .sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify(
      cases.map(({ overlay, update }) => ({
        overlay,
        update,
        baselineMs: median(overlay, update, 'baseline'),
        candidateMs: median(overlay, update, 'candidate'),
      })),
      null,
      2,
    ),
  );
}
