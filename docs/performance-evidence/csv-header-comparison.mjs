import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const baseline = '2b269e368efd92a39ef3f4128ea7d1d6684c8f62';
const candidate = process.argv[2];
assert.match(candidate || '', /^[a-f0-9]{40}$/);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const clean = () => {
  assert.equal(git('rev-parse', 'HEAD').trim(), candidate);
  assert.equal(git('status', '--porcelain', '--untracked-files=no').trim(), '');
};
clean();
const sourcePath = 'src/imports/geojsonCsv.js';
const changedRuntime = git(
  'diff',
  '--name-only',
  baseline,
  candidate,
  '--',
  'src',
)
  .trim()
  .split('\n')
  .filter((value) => value && !value.endsWith('.test.mjs'));
assert.deepEqual(
  changedRuntime.sort(),
  [sourcePath, 'src/imports/index.js', 'src/ui/workspaceLibrary.js'].sort(),
  'Only reviewed CSV runtime paths may differ',
);
const sources = Object.fromEntries(
  ['baseline', 'candidate'].map((variant) => [
    variant,
    git(
      'show',
      `${variant === 'baseline' ? baseline : candidate}:${sourcePath}`,
    ),
  ]),
);
assert.equal(
  readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n'),
  sources.candidate,
);
const load = (source) =>
  import(
    `data:text/javascript;base64,${Buffer.from(
      source.replace(
        /from '([^']+)'/g,
        (_match, relative) =>
          `from '${pathToFileURL(path.resolve('src/imports', relative)).href}'`,
      ),
    ).toString('base64')}`
  );
const modules = {
  baseline: await load(sources.baseline),
  candidate: await load(sources.candidate),
};
const input = [
  'id,lat,lon,observed_at,note',
  ...Array.from(
    { length: 50_000 },
    (_, index) =>
      `feature-${index},${(index % 180) - 90},${(index % 360) - 180},2026-01-01T00:00:00Z,synthetic-${index}`,
  ),
].join('\n');
const mapping = {
  latitude: 'lat',
  longitude: 'lon',
  id: 'id',
  time: 'observed_at',
};
const header = (variant) =>
  variant === 'baseline'
    ? modules[variant].parseCsv(input).headers
    : modules[variant].parseCsvHeaders(input);
const methods = {
  mappingHeaders: (variant) => header(variant),
  mappingAndPreview: async (variant) => {
    const headers = header(variant);
    const preview = await modules[variant].previewCSV(input, { mapping });
    return { headers, preview };
  },
  previewOnly: (variant) => modules[variant].previewCSV(input, { mapping }),
  fullDecode: (variant) => modules[variant].parseCsv(input),
};
const report = {
  schema: 'gev-csv-header-comparison/v1',
  baseline,
  candidate,
  capturedAt: new Date().toISOString(),
  scope:
    'Local Node CPU comparison of exact production parser exports; not browser interaction, GPU, or full document cooperative parsing acceptance.',
  sources: Object.fromEntries(
    Object.entries(sources).map(([key, value]) => [key, digest(value)]),
  ),
  harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
  fixture: {
    sha256: digest(input),
    bytes: Buffer.byteLength(input),
    rows: 50_000,
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
  },
  conditions: {
    warmupsPerVariantPerWorkload: 2,
    alternatingPairs: 5,
    forcedGC: false,
    profiling: false,
  },
  workloads: [],
};
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [name, method] of Object.entries(methods)) {
  const expected = await method('baseline');
  assert.deepEqual(await method('candidate'), expected);
  for (let warmup = 0; warmup < 2; warmup++) {
    await method('baseline');
    await method('candidate');
  }
  const samples = [];
  const expectedHash = digest(JSON.stringify(expected));
  for (let pair = 0; pair < 5; pair++) {
    for (const variant of pair % 2
      ? ['candidate', 'baseline']
      : ['baseline', 'candidate']) {
      const start = performance.now();
      const result = await method(variant);
      const durationMs = performance.now() - start;
      const outputSha256 = digest(JSON.stringify(result));
      assert.equal(
        outputSha256,
        expectedHash,
        `${name} ${variant} output differs`,
      );
      samples.push({ pair, variant, durationMs, outputSha256 });
    }
  }
  const baselineMedianMs = median(
    samples
      .filter((row) => row.variant === 'baseline')
      .map((row) => row.durationMs),
  );
  const candidateMedianMs = median(
    samples
      .filter((row) => row.variant === 'candidate')
      .map((row) => row.durationMs),
  );
  report.workloads.push({
    name,
    samples,
    baselineMedianMs,
    candidateMedianMs,
    changeRatio: candidateMedianMs / baselineMedianMs - 1,
  });
}
clean();
const output =
  process.argv[3] ||
  `qa-artifacts/csv-header-comparison-${candidate.slice(0, 7)}.json`;
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    report.workloads.map(({ samples, ...summary }) => summary),
    null,
    2,
  ),
);
console.log(output);
