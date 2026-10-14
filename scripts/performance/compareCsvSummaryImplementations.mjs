import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const BASELINE_COMMIT = 'e20a84b863bb5a91d809bbdd78de4e59ced1897b';
const CANDIDATE_SOURCE_SHA256 =
  '45c9fe3097a768ee81b8dbc3d965be5baf8324ef71bb6e287e705a4ab14dc34f';
const ROW_COUNT = 50_000;
const WARMUPS = 1;
const PAIRS = 5;
const BASE_TIME_MS = Date.UTC(2026, 0, 1);
const EXPECTED_BOUNDS = [-180, -90, 179, 89];
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const targetPath = fileURLToPath(
  new URL('../../src/imports/geojsonCsv.js', import.meta.url),
);
const targetUrl = pathToFileURL(targetPath).href;
const sourcePath = 'src/imports/geojsonCsv.js';
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sourceAt = (revision) =>
  execFileSync('git', ['show', `${revision}:${sourcePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function createCsvFixture() {
  const rows = Array.from({ length: ROW_COUNT }, (_, index) => {
    const latitude = index === ROW_COUNT - 1 ? 91 : ((index * 37) % 180) - 90;
    const longitude = ((index * 73) % 360) - 180;
    const observed = new Date(BASE_TIME_MS + index * 60_000).toISOString();
    return `row-${index},${latitude},${longitude},${observed},quality-${index % 7}`;
  });
  return `id,latitude,longitude,observed_at,quality\r\n${rows.join('\r\n')}`;
}

const baselineSource = sourceAt(BASELINE_COMMIT);
const candidateCommit = git('rev-parse', 'HEAD');
const candidateSource = sourceAt(candidateCommit);
const baselineSourceSha256 = sha256(baselineSource);
const candidateSourceSha256 = sha256(candidateSource);
assert.equal(
  baselineSourceSha256,
  'b641993b975f53d4c396736d1079aa144e67754a4222fec713dde3bf972f492d',
);
assert.equal(candidateSourceSha256, CANDIDATE_SOURCE_SHA256);

const sourceByUrl = new Map([
  [`${targetUrl}?s59=baseline`, baselineSource],
  [`${targetUrl}?s59=candidate`, candidateSource],
]);
registerHooks({
  load(url, context, nextLoad) {
    const source = sourceByUrl.get(url);
    if (source !== undefined)
      return { format: 'module', source, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const [baselineModule, candidateModule] = await Promise.all([
  import(`${targetUrl}?s59=baseline`),
  import(`${targetUrl}?s59=candidate`),
]);
const fixtureText = createCsvFixture();
const fixtureBytes = new TextEncoder().encode(fixtureText);
const fixtureSha256 = sha256(fixtureBytes);
const expectedTimeRange = [
  BASE_TIME_MS,
  BASE_TIME_MS + (ROW_COUNT - 2) * 60_000,
];
const expectedOutput = {
  accepted: ROW_COUNT - 1,
  rejected: 1,
  firstId: 'row-0',
  lastId: `row-${ROW_COUNT - 2}`,
  bounds: EXPECTED_BOUNDS,
  timeRange: expectedTimeRange,
};
const modes = {
  baseline: baselineModule.previewCSV,
  candidate: candidateModule.previewCSV,
};
const samples = [];
let referenceOutputSha256 = null;

async function measure(arm, pair, warmup) {
  const startedAt = performance.now();
  const previewPromise = modes[arm](fixtureText, {
    mapping: {
      id: 'id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'observed_at',
    },
  });
  const synchronousPrefixMs = performance.now() - startedAt;
  const preview = await previewPromise;
  const totalPreviewMs = performance.now() - startedAt;
  const output = {
    accepted: preview.accepted,
    rejected: preview.rejected,
    firstId: preview.records[0]?.id ?? null,
    lastId: preview.records.at(-1)?.id ?? null,
    bounds: preview.bounds,
    timeRange: preview.timeRange,
  };
  assert.deepEqual(output, expectedOutput);
  const outputSha256 = sha256(JSON.stringify(preview));
  if (referenceOutputSha256 === null) referenceOutputSha256 = outputSha256;
  else assert.equal(outputSha256, referenceOutputSha256);
  if (!warmup)
    samples.push({
      pair,
      arm,
      synchronousPrefixMs,
      totalPreviewMs,
      outputSha256,
    });
}

for (const arm of ['baseline', 'candidate']) await measure(arm, null, true);
for (let pair = 0; pair < PAIRS; pair += 1) {
  const order =
    pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const arm of order) await measure(arm, pair, false);
}

const median = (arm, field) => {
  const values = samples
    .filter((sample) => sample.arm === arm)
    .map((sample) => sample[field])
    .sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
};
const baselineMedianMs = median('baseline', 'totalPreviewMs');
const candidateMedianMs = median('candidate', 'totalPreviewMs');
const report = {
  schema: 'gev-s59-csv-summary-replay/v1',
  status: 'diagnostic-only',
  performanceAcceptanceEligible: false,
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
  },
  sources: {
    baselineCommit: BASELINE_COMMIT,
    baselinePath: sourcePath,
    baselineSha256: baselineSourceSha256,
    candidateCommit,
    candidatePath: sourcePath,
    candidateSha256: candidateSourceSha256,
    harnessPath: 'scripts/performance/compareCsvSummaryImplementations.mjs',
    harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  },
  fixture: {
    generator:
      'createCsvFixture in scripts/performance/compareCsvSummaryImplementations.mjs',
    rows: ROW_COUNT,
    accepted: ROW_COUNT - 1,
    rejected: 1,
    byteLength: fixtureBytes.byteLength,
    sha256: fixtureSha256,
    mapping: {
      id: 'id',
      latitude: 'latitude',
      longitude: 'longitude',
      time: 'observed_at',
    },
    firstAcceptedId: 'row-0',
    lastAcceptedId: `row-${ROW_COUNT - 2}`,
    bounds: EXPECTED_BOUNDS,
    timeRange: expectedTimeRange,
    invalidRow: ROW_COUNT,
  },
  warmupCallsPerArm: WARMUPS,
  measuredPairs: PAIRS,
  samples,
  sameOutput: true,
  outputSha256: referenceOutputSha256,
  medianTotalPreviewMs: {
    baseline: baselineMedianMs,
    candidate: candidateMedianMs,
    relativeChangePct:
      ((candidateMedianMs - baselineMedianMs) / baselineMedianMs) * 100,
  },
  scope:
    'Node-only CPU diagnostic: total CSV preview and synchronous call prefix. No browser, rendering, GPU, user-file, interaction-percentile or import-to-render qualification.',
  limitations: [
    'The entire CSV decode/scan remains synchronous and cannot be interrupted by AbortSignal.',
    'The measurement does not include workspace storage, layer application or catalog interaction.',
    'The fixture is deterministic and synthetic; results do not qualify arbitrary large files.',
  ],
};
assert.equal(git('rev-parse', 'HEAD'), candidateCommit);
if (process.argv[2])
  writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
