import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { previewGPX, previewKML } from '../../src/imports/kmlGpx.js';
import { IMPORT_LIMITS } from '../../src/imports/geojsonCsv.js';

const KML_COUNT = 4_000;
const GPX_COUNT = 8_000;
const WARMUPS = 1;
const PAIRS = 5;
const BASE_TIME_MS = Date.UTC(2026, 0, 1);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fileSha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sourceHash = (path) => fileSha256(`${repoRoot}/${path}`);

function coordinates(index) {
  return {
    longitude: ((index * 73) % 360) - 180,
    latitude: ((index * 37) % 180) - 90,
    time: new Date(BASE_TIME_MS + index * 60_000).toISOString(),
  };
}

function createKml() {
  const placemarks = Array.from({ length: KML_COUNT }, (_, index) => {
    const { longitude, latitude, time } = coordinates(index);
    return `<Placemark><name>kml-${index}</name><description>survey-${index % 9}</description><TimeStamp><when>${time}</when></TimeStamp><altitudeMode>${index % 2 ? 'absolute' : 'clampToGround'}</altitudeMode><Point><coordinates>${longitude},${latitude},${index % 100}</coordinates></Point></Placemark>`;
  });
  return `<kml><Document>${placemarks.join('')}</Document></kml>`;
}

function createGpx() {
  const waypoints = Array.from({ length: GPX_COUNT }, (_, index) => {
    const { longitude, latitude, time } = coordinates(index);
    return `<wpt lat="${latitude}" lon="${longitude}"><ele>${index % 100}</ele><time>${time}</time><name>gpx-${index}</name></wpt>`;
  });
  return `<gpx>${waypoints.join('')}</gpx>`;
}

function expectedSummary(kind, count, prefix) {
  const first = coordinates(0);
  const last = coordinates(count - 1);
  const values = Array.from({ length: count }, (_, index) =>
    coordinates(index),
  );
  return {
    kind,
    accepted: count,
    rejected: 0,
    firstId: `${prefix}-0`,
    lastId: `${prefix}-${count - 1}`,
    bounds: [
      Math.min(...values.map((row) => row.longitude)),
      Math.min(...values.map((row) => row.latitude)),
      Math.max(...values.map((row) => row.longitude)),
      Math.max(...values.map((row) => row.latitude)),
    ],
    timeRange: [Date.parse(first.time), Date.parse(last.time)],
  };
}

const sources = {
  kml: createKml(),
  gpx: createGpx(),
};
const fixtureBytes = Object.fromEntries(
  Object.entries(sources).map(([key, value]) => [
    key,
    new TextEncoder().encode(value),
  ]),
);
for (const [kind, bytes] of Object.entries(fixtureBytes))
  assert.ok(
    bytes.byteLength <= IMPORT_LIMITS.bytes,
    `${kind} exceeds import limit`,
  );

const runners = {
  kml: { run: previewKML, count: KML_COUNT, prefix: 'kml' },
  gpx: { run: previewGPX, count: GPX_COUNT, prefix: 'gpx' },
};
const samples = [];
const hashes = new Map();

async function measure(kind, pair, warmup) {
  const fixture = runners[kind];
  const source = sources[kind];
  const startedAt = performance.now();
  const resultPromise = fixture.run(source);
  const synchronousPrefixMs = performance.now() - startedAt;
  const result = await resultPromise;
  const totalPreviewMs = performance.now() - startedAt;
  const output = {
    kind,
    accepted: result.accepted,
    rejected: result.rejected,
    firstId: result.records[0]?.id ?? null,
    lastId: result.records.at(-1)?.id ?? null,
    bounds: result.bounds,
    timeRange: result.timeRange,
  };
  assert.deepEqual(
    output,
    expectedSummary(kind, fixture.count, fixture.prefix),
  );
  const outputSha256 = sha256(JSON.stringify(result));
  if (hashes.has(kind)) assert.equal(outputSha256, hashes.get(kind));
  else hashes.set(kind, outputSha256);
  if (!warmup)
    samples.push({
      pair,
      kind,
      synchronousPrefixMs,
      totalPreviewMs,
      outputSha256,
    });
}

async function verifyCancellation(kind) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const pending = runners[kind].run(sources[kind], {
    signal: controller.signal,
  });
  const synchronousPrefixMs = performance.now() - startedAt;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  return {
    status: 'aborted-without-partial-result',
    synchronousPrefixMs,
  };
}

for (const kind of ['kml', 'gpx']) await measure(kind, null, true);
for (let pair = 0; pair < PAIRS; pair += 1) {
  const order = pair % 2 === 0 ? ['kml', 'gpx'] : ['gpx', 'kml'];
  for (const kind of order) await measure(kind, pair, false);
}

const median = (kind, field) => {
  const values = samples
    .filter((sample) => sample.kind === kind)
    .map((sample) => sample[field])
    .sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
};
let cleanImportSources = true;
try {
  execFileSync(
    'git',
    [
      'diff',
      '--quiet',
      'HEAD',
      '--',
      'src/imports/kmlGpx.js',
      'src/imports/geojsonCsv.js',
    ],
    { cwd: repoRoot },
  );
} catch {
  cleanImportSources = false;
}
const report = {
  schema: 'gev-s59-xml-import-current-path/v1',
  status: 'diagnostic-only',
  performanceAcceptanceEligible: false,
  capturedAt: new Date().toISOString(),
  sources: {
    commit: git('rev-parse', 'HEAD'),
    importSourcePaths: ['src/imports/kmlGpx.js', 'src/imports/geojsonCsv.js'],
    importSourceSha256: {
      kmlGpx: sourceHash('src/imports/kmlGpx.js'),
      geojsonCsv: sourceHash('src/imports/geojsonCsv.js'),
    },
    packageLockSha256: sourceHash('package-lock.json'),
    harnessPath: 'scripts/performance/measureXmlImportSummary.mjs',
    harnessSha256: fileSha256(fileURLToPath(import.meta.url)),
    importSourcePathsCleanAtRun: cleanImportSources,
  },
  environment: {
    node: process.version,
    platform: process.platform,
  },
  fixtures: Object.fromEntries(
    Object.entries(fixtureBytes).map(([kind, bytes]) => [
      kind,
      {
        generator: `create${kind.toUpperCase()} in scripts/performance/measureXmlImportSummary.mjs`,
        records: runners[kind].count,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        firstId: expectedSummary(
          kind,
          runners[kind].count,
          runners[kind].prefix,
        ).firstId,
        lastId: expectedSummary(kind, runners[kind].count, runners[kind].prefix)
          .lastId,
        outputSha256: hashes.get(kind),
      },
    ]),
  ),
  warmupCallsPerKind: WARMUPS,
  measuredPairs: PAIRS,
  samples,
  mediansMs: Object.fromEntries(
    Object.keys(runners).map((kind) => [
      kind,
      {
        synchronousPrefix: median(kind, 'synchronousPrefixMs'),
        totalPreview: median(kind, 'totalPreviewMs'),
      },
    ]),
  ),
  cancellation: {
    kml: await verifyCancellation('kml'),
    gpx: await verifyCancellation('gpx'),
  },
  scope:
    'Current-path Node CPU diagnostic only. Prefix includes synchronous UTF-8 decode, restricted XML parsing and the first cooperative batch; total includes complete feature conversion and preview summary. No browser, rendering, GPU, storage or interaction qualification.',
  limitations: [
    'The measurement does not isolate KML altitude/time summary scans from parsing and feature conversion.',
    'Cancellation is observed after the synchronous prefix; it cannot preempt decoding or XML parsing.',
    'The synthetic fixtures exercise bounded valid records and do not qualify arbitrary customer files.',
  ],
};
if (process.argv[2])
  writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
