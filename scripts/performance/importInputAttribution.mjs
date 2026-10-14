import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import {
  decodeImportText,
  parseCsv,
  previewCSV,
  previewGeoJSON,
  IMPORT_LIMITS,
} from '../../src/imports/geojsonCsv.js';

// Attribute the synchronous prefix separately from cooperative normalization.
// This is a CPU diagnostic, not a browser interaction or GPU acceptance gate.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'A clean worktree is required.');
const fixtures = [
  {
    kind: 'csv',
    count: 50_000,
    text:
      'id,latitude,longitude,label\r\n' +
      Array.from(
        { length: 50_000 },
        (_, index) => `${index},30.2,-97.7,"Public reference ${index}, fixed"`,
      ).join('\r\n'),
  },
  {
    kind: 'geojson',
    count: 25_000,
    text: JSON.stringify({
      type: 'FeatureCollection',
      features: Array.from({ length: 25_000 }, (_, index) => ({
        type: 'Feature',
        id: String(index),
        properties: { label: `Public reference ${index}, fixed` },
        geometry: { type: 'Point', coordinates: [-97.7, 30.2] },
      })),
    }),
  },
];
const report = {
  schema: 'gev-import-input-attribution/v1',
  commit,
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
  },
  scope:
    'Node synchronous decode/parse and preview-prefix attribution; total preview includes cooperative timer waits. No forced GC, browser, rendered scene, interaction percentile or GPU claim.',
  performanceAcceptanceEligible: false,
  trials: 5,
  warmupTrials: 1,
  workloads: [],
};
for (const fixture of fixtures) {
  const bytes = new TextEncoder().encode(fixture.text);
  assert.ok(bytes.byteLength <= IMPORT_LIMITS.bytes);
  const row = {
    kind: fixture.kind,
    records: fixture.count,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    samples: [],
  };
  const preview = fixture.kind === 'csv' ? previewCSV : previewGeoJSON;
  for (let trial = -1; trial < report.trials; trial++) {
    let startedAt = performance.now();
    const decoded = decodeImportText(bytes);
    const decodeMs = performance.now() - startedAt;
    startedAt = performance.now();
    const parsed =
      fixture.kind === 'csv' ? parseCsv(decoded) : JSON.parse(decoded);
    const parseMs = performance.now() - startedAt;
    assert.equal(
      fixture.kind === 'csv' ? parsed.rows.length : parsed.features.length,
      fixture.count,
    );
    startedAt = performance.now();
    const pending = preview(bytes);
    const synchronousPreviewPrefixMs = performance.now() - startedAt;
    const result = await pending;
    const totalPreviewMs = performance.now() - startedAt;
    assert.equal(result.accepted, fixture.count);
    assert.equal(result.rejected, 0);
    assert.equal(result.records[0].id, '0');
    assert.equal(result.records.at(-1).id, String(fixture.count - 1));
    if (trial >= 0)
      row.samples.push({
        trial,
        decodeMs,
        parseMs,
        synchronousPreviewPrefixMs,
        totalPreviewMs,
      });
  }
  report.workloads.push(row);
}
assert.equal(git('rev-parse', 'HEAD'), commit);
assert.equal(git('status', '--porcelain'), '');
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
for (const row of report.workloads) {
  const median = (key) =>
    row.samples.map((sample) => sample[key]).sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify({
      kind: row.kind,
      records: row.records,
      bytes: row.bytes,
      decodeMs: median('decodeMs'),
      parseMs: median('parseMs'),
      synchronousPreviewPrefixMs: median('synchronousPreviewPrefixMs'),
      totalPreviewMs: median('totalPreviewMs'),
    }),
  );
}
