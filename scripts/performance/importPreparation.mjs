import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { selectImportRenderRecords } from '../../src/imports/renderRecords.js';

// Exact previous runtime preparation. Retain it here only as a comparison.
function baseline(imports, limit) {
  const features = imports.flatMap((entry) =>
    Array.isArray(entry?.records)
      ? entry.records.map((record) => ({ ...record, __import: entry }))
      : [],
  );
  return { selected: features.slice(0, limit), total: features.length };
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'Benchmark requires a clean worktree',
);
const report = {
  schema: 'gev-import-preparation/v1',
  commit,
  node: process.version,
  platform: process.platform,
  capturedAt: new Date().toISOString(),
  scope:
    'Node CPU cohort preparation only; excludes Cesium geometry, rendering and ingestion parsing',
  samples: [],
  workloads: [],
};
for (const count of [50_000, 250_000]) {
  const imports = Array.from({ length: count / 50_000 }, (_, sourceIndex) => ({
    id: `file-${sourceIndex}`,
    kind: 'geojson',
    attribution: 'synthetic fixture',
    records: Array.from({ length: 50_000 }, (_, index) => ({
      id: `${index}`,
      properties: { name: `Synthetic ${index}`, category: 'fixture' },
      geometry: { type: 'Point', coordinates: [-97.74, 30.27, 0] },
    })),
  }));
  const expected = baseline(imports, 5000);
  const actual = selectImportRenderRecords(imports, 5000);
  assert.equal(expected.total, actual.total);
  assert.deepEqual(
    actual.selected.map(({ record, source }) => [
      source.id,
      record.id,
      record.geometry,
      record.properties,
    ]),
    expected.selected.map((record) => [
      record.__import.id,
      record.id,
      record.geometry,
      record.properties,
    ]),
  );
  for (let warmup = 0; warmup < 3; warmup++) {
    baseline(imports, 5000);
    selectImportRenderRecords(imports, 5000);
  }
  for (let run = 0; run < 5; run++) {
    const methods =
      run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const method of methods) {
      const start = performance.now();
      const result =
        method === 'baseline'
          ? baseline(imports, 5000)
          : selectImportRenderRecords(imports, 5000);
      report.samples.push({
        count,
        run,
        method,
        durationMs: performance.now() - start,
        renderedCount: result.selected.length,
      });
    }
  }
  const median = (method) =>
    report.samples
      .filter((sample) => sample.count === count && sample.method === method)
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b)[2];
  report.workloads.push({
    records: count,
    selected: 5000,
    equivalent: true,
    baselineMedianMs: median('baseline'),
    candidateMedianMs: median('candidate'),
  });
}
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.workloads, null, 2));
