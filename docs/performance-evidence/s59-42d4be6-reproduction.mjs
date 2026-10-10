import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
const baselineRef = 'c7785169cb1d05dec2b133ade87c624db84eabed';
const candidateRef = '42d4be66e26e2bb2223aec8506c1b34643367526';
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const status = () => git('status', '--porcelain', '--untracked-files=all');
const temporarySuffix = `${process.pid}.${Date.now()}`;
const baselineImportPath = path.join(
  root,
  `src/imports/geojsonCsv.baseline.${temporarySuffix}.tmp.mjs`,
);
const baselineCooperativePath = path.join(
  root,
  `src/imports/cooperative.baseline.${temporarySuffix}.tmp.mjs`,
);
const baselinePackPath = path.join(
  root,
  `src/director/packs/geojson.baseline.${temporarySuffix}.tmp.mjs`,
);
const ownedTemporaryFiles = new Set();
const reportHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceFiles = [
  'src/director/packs/geojson.js',
  'src/imports/geojsonCsv.js',
  'src/imports/cooperative.js',
];

function createWorkload(name) {
  const point = (index) => [
    -97.7 + (index % 100) * 0.0001,
    30.2 + Math.floor(index / 100) * 0.0001,
  ];
  let features;
  if (name === 'line-40000') {
    features = [
      {
        type: 'Feature',
        id: 'line',
        properties: { time: '2026-10-08T12:00:00Z' },
        geometry: {
          type: 'LineString',
          coordinates: Array.from({ length: 40_000 }, (_, index) =>
            point(index),
          ),
        },
      },
    ];
  } else if (name === 'polygon-hole-30000') {
    const ring = (count, radius) => {
      const points = Array.from({ length: count }, (_, index) => {
        const angle = (2 * Math.PI * index) / (count - 1);
        return [
          -97 + Math.cos(angle) * radius,
          30 + Math.sin(angle) * radius,
        ];
      });
      points[count - 1] = [...points[0]];
      return points;
    };
    features = [
      {
        type: 'Feature',
        id: 'polygon',
        properties: { time: '2026-10-08T12:00:00Z' },
        geometry: {
          type: 'Polygon',
          coordinates: [ring(20_000, 0.1), ring(10_000, 0.04)],
        },
      },
    ];
  } else if (name === 'many-points-10000') {
    features = Array.from({ length: 10_000 }, (_, index) => ({
      type: 'Feature',
      id: `p-${index}`,
      properties: { time: '2026-10-08T12:00:00Z', n: index },
      geometry: { type: 'Point', coordinates: point(index) },
    }));
  } else throw new Error(`Unknown workload: ${name}`);
  return new TextEncoder().encode(
    JSON.stringify({ type: 'FeatureCollection', features }),
  );
}

async function main() {
  if (git('rev-parse', 'HEAD') !== candidateRef || status() !== '')
    throw new Error('Run this harness at the clean measured candidate commit.');
  const harnessPath = fileURLToPath(import.meta.url);
  const output = {
    schema: 's59-geojson-incremental-final/v1',
    measuredAtUtc: new Date().toISOString(),
    baselineCommit: git('rev-parse', baselineRef),
    candidateCommit: candidateRef,
    sourceCleanAtStart: true,
    sourceCleanAtEnd: null,
    candidateSourceGitBlobIds: Object.fromEntries(
      sourceFiles.map((file) => [file, git('hash-object', file)]),
    ),
    candidateSourceSha256: Object.fromEntries(
      sourceFiles.map((file) => [
        file,
        createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'),
      ]),
    ),
    harnessPath,
    harnessSha256: createHash('sha256')
      .update(readFileSync(harnessPath))
      .digest('hex'),
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpu: cpus()[0]?.model || null,
    fixture: {
      geometryCounts: {
        line: 40_000,
        polygonOuterRing: 20_000,
        polygonHole: 10_000,
        manyPointFeatures: 10_000,
      },
      ordering: 'five pairs; AB, BA, AB, BA, AB',
      expectedAccepted: { line: 1, polygon: 1, manyPoints: 10_000 },
    },
    workloads: {},
    cancellation: [],
    syncPackDecode: [],
  };
  try {
    const baselineCooperativeSource = execFileSync('git', [
      'show',
      `${output.baselineCommit}:src/imports/cooperative.js`,
    ]);
    writeFileSync(baselineCooperativePath, baselineCooperativeSource, {
      flag: 'wx',
    });
    ownedTemporaryFiles.add(baselineCooperativePath);
    const baselinePackSource = execFileSync('git', [
        'show',
        `${output.baselineCommit}:src/director/packs/geojson.js`,
      ]);
    writeFileSync(baselinePackPath, baselinePackSource, { flag: 'wx' });
    ownedTemporaryFiles.add(baselinePackPath);
    const oldImporter = execFileSync(
      'git',
      ['show', `${output.baselineCommit}:src/imports/geojsonCsv.js`],
      { encoding: 'utf8' },
    ).replace(
      '../director/packs/geojson.js',
      `../director/packs/${path.basename(baselinePackPath)}`,
    ).replace(
      './cooperative.js',
      `./${path.basename(baselineCooperativePath)}`,
    );
    writeFileSync(baselineImportPath, oldImporter, { flag: 'wx' });
    ownedTemporaryFiles.add(baselineImportPath);
    const baseline = await import(
      `${pathToFileURL(baselineImportPath).href}?run=${Date.now()}`
    );
    const candidate = await import(
      `${pathToFileURL(path.join(root, 'src/imports/geojsonCsv.js')).href}?run=${Date.now()}`
    );
    for (const [name, expectedRecords] of [
      ['line-40000', 1],
      ['polygon-hole-30000', 1],
      ['many-points-10000', 10_000],
    ]) {
      const bytes = createWorkload(name);
      const pairs = [];
      for (let pair = 0; pair < 5; pair++) {
        const order =
          pair % 2 === 0
            ? ['baseline', 'candidate']
            : ['candidate', 'baseline'];
        const row = {};
        for (const variant of order) {
          const fn =
            variant === 'baseline'
              ? baseline.previewGeoJSON
              : candidate.previewGeoJSON;
          const started = performance.now();
          const result = await fn(bytes, { timeField: 'time' });
          row[variant] = {
            elapsedMs: performance.now() - started,
            records: result.records.length,
            rejected: result.rejected,
            outputSha256: reportHash(result),
          };
        }
        if (
          row.baseline.records !== expectedRecords ||
          row.candidate.records !== expectedRecords ||
          row.baseline.rejected !== 0 ||
          row.candidate.rejected !== 0 ||
          row.baseline.outputSha256 !== row.candidate.outputSha256
        ) throw new Error(`${name} population or output differs`);
        pairs.push({ pair: pair + 1, order, ...row });
      }
      output.workloads[name] = {
        inputBytes: bytes.byteLength,
        expectedRecords,
        pairs,
      };
      if (name === 'line-40000') {
        for (let pair = 0; pair < 5; pair++) {
          const order =
            pair % 2 === 0
              ? ['baseline', 'candidate']
              : ['candidate', 'baseline'];
          const row = {};
          for (const variant of order) {
            const fn =
              variant === 'baseline'
                ? baseline.previewGeoJSON
                : candidate.previewGeoJSON;
            const controller = new AbortController();
            const started = performance.now();
            let abortAtMs = null;
            const timer = setTimeout(() => {
              abortAtMs = performance.now() - started;
              controller.abort();
            }, 0);
            try {
              await fn(bytes, { signal: controller.signal });
              row[variant] = {
                outcome: 'fulfilled',
                elapsedMs: performance.now() - started,
                abortAtMs,
                abortToSettlementMs: null,
              };
            } catch (error) {
              const elapsedMs = performance.now() - started;
              row[variant] = {
                outcome: error.name,
                elapsedMs,
                abortAtMs,
                abortToSettlementMs:
                  abortAtMs === null ? null : elapsedMs - abortAtMs,
              };
            } finally {
              clearTimeout(timer);
            }
          }
          output.cancellation.push({ pair: pair + 1, order, ...row });
        }
      }
    }
    const candidatePack = await import(
      `${pathToFileURL(path.join(root, 'src/director/packs/geojson.js')).href}?run=${Date.now()}`
    );
    const baselinePack = await import(
      `${pathToFileURL(baselinePackPath).href}?run=${Date.now()}`
    );
    const line = JSON.parse(
      new TextDecoder().decode(createWorkload('line-40000')),
    );
    const packBytes = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: line.features.map(({ id, geometry }) => ({
          type: 'Feature',
          id,
          geometry,
        })),
      }),
    );
    for (let pair = 0; pair < 5; pair++) {
      const order =
        pair % 2 === 0
          ? ['baseline', 'candidate']
          : ['candidate', 'baseline'];
      const row = {};
      for (const variant of order) {
        const decode =
          variant === 'baseline'
            ? baselinePack.decodePackGeoJSON
            : candidatePack.decodePackGeoJSON;
        const started = performance.now();
        const result = decode(packBytes);
        row[variant] = {
          elapsedMs: performance.now() - started,
          outputSha256: reportHash(result),
        };
      }
      if (row.baseline.outputSha256 !== row.candidate.outputSha256)
        throw new Error('Pack decoder output differs');
      output.syncPackDecode.push({ pair: pair + 1, order, ...row });
    }
  } finally {
    for (const file of ownedTemporaryFiles) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  output.sourceCleanAtEnd = status() === '';
  if (!output.sourceCleanAtEnd)
    throw new Error('Candidate source tree was not restored cleanly');
  const out = path.join(
    root,
    'qa-artifacts',
    `s59-geojson-incremental-repro-${Date.now()}.json`,
  );
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
  return out;
}

main().then((file) => process.stdout.write(`${file}\n`));
