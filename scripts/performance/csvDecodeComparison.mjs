#!/usr/bin/env node
/** Exact-source CPU comparison; no browser or production test hooks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measured } from './s59DocumentDecodeComparison.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const BASELINE = 'ef6fcd5de4ead7e5771a08f4eecc0cd35bd6ecb5';
const SOURCE = 'src/imports/geojsonCsv.js';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function createCsvDecodeFixtures() {
  const ordinary = ['id,latitude,longitude,time,note'];
  for (let i = 0; i < 50_000; i++)
    ordinary.push(
      `row-${i},${(i % 180) - 90},${(i % 360) - 180},2026-01-01T00:00:00Z,fixture`,
    );
  const header = 'id,latitude,longitude,time,note\r\n';
  const rows = [];
  for (let i = 0; i < 5_000; i++) {
    const prefix = `row-${i},30,-97,2026-01-01T00:00:00Z,"`;
    // The first CR is at 1023, then every 1024 characters. Quoted content
    // includes escaped quotes and commas without changing record boundaries.
    const targetLength = i === 0 ? 1023 - header.length : 1022;
    const suffix = '""quoted"",tail"';
    rows.push(
      prefix +
        'x'.repeat(targetLength - prefix.length - suffix.length) +
        suffix +
        '\r\n',
    );
  }
  return [
    { id: 'ordinary-50k', rows: 50_000, input: ordinary.join('\n') },
    {
      id: 'aligned-crlf-quoted-5k',
      rows: 5_000,
      input: header + rows.join(''),
    },
  ];
}

export function summarizeCsvComparison(samples) {
  assert.equal(
    samples.length,
    10,
    'Five complete paired samples are required.',
  );
  for (let pair = 0; pair < 5; pair++) {
    const rows = samples.filter((sample) => sample.pair === pair);
    assert.deepEqual(rows.map((row) => row.variant).sort(), [
      'baseline',
      'candidate',
    ]);
    assert.equal(
      rows[0].outputSha256,
      rows[1].outputSha256,
      'Complete CSV outputs differ.',
    );
    for (const row of rows) {
      assert.match(row.outputSha256, /^[a-f0-9]{64}$/);
      assert.ok(
        Number.isFinite(row.totalCompletionMs) && row.totalCompletionMs >= 0,
      );
      assert.ok(
        Number.isFinite(row.maxMainThreadGapMs) && row.maxMainThreadGapMs >= 0,
      );
    }
  }
  const values = (variant, field) =>
    samples.filter((row) => row.variant === variant).map((row) => row[field]);
  const baselineMedianMs = median(values('baseline', 'totalCompletionMs'));
  const candidateMedianMs = median(values('candidate', 'totalCompletionMs'));
  return {
    baselineMedianMs,
    candidateMedianMs,
    changeRatio:
      baselineMedianMs === 0 ? null : candidateMedianMs / baselineMedianMs - 1,
    baselineMedianTimerGapMs: median(values('baseline', 'maxMainThreadGapMs')),
    candidateMedianTimerGapMs: median(
      values('candidate', 'maxMainThreadGapMs'),
    ),
  };
}

export async function runCsvDecodeComparison({ candidate, outputPath }) {
  assert.match(candidate || '', /^[a-f0-9]{40}$/);
  const checkSource = () => {
    assert.equal(git('rev-parse', 'HEAD').trim(), candidate);
    assert.equal(
      git('status', '--porcelain').trim(),
      '',
      'Comparison requires a clean worktree.',
    );
  };
  checkSource();
  const changedRuntime = git(
    'diff',
    '--name-only',
    BASELINE,
    candidate,
    '--',
    'src',
  )
    .trim()
    .split('\n')
    .filter((name) => name && !name.endsWith('.test.mjs'));
  assert.deepEqual(
    changedRuntime,
    [SOURCE],
    'Only the reviewed CSV implementation may differ.',
  );
  const sources = Object.fromEntries(
    ['baseline', 'candidate'].map((variant) => [
      variant,
      git('show', `${variant === 'baseline' ? BASELINE : candidate}:${SOURCE}`),
    ]),
  );
  assert.equal(
    readFileSync(path.join(ROOT, SOURCE), 'utf8').replace(/\r\n/g, '\n'),
    sources.candidate,
  );
  const load = (source) =>
    import(
      `data:text/javascript;base64,${Buffer.from(
        source.replace(
          /from '([^']+)'/g,
          (_, relative) =>
            `from '${pathToFileURL(path.resolve(ROOT, 'src/imports', relative)).href}'`,
        ),
      ).toString('base64')}`
    );
  const modules = {
    baseline: await load(sources.baseline),
    candidate: await load(sources.candidate),
  };
  const report = {
    schema: 'gev-csv-decode-comparison/v1',
    baselineCommit: BASELINE,
    candidateCommit: candidate,
    capturedAt: new Date().toISOString(),
    status: 'running',
    sourceClean: true,
    sourceHashes: Object.fromEntries(
      Object.entries(sources).map(([variant, source]) => [
        variant,
        digest(source),
      ]),
    ),
    harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
    environment: {
      node: process.version,
      platform: process.platform,
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
    },
    conditions: {
      warmupsPerVariant: 2,
      alternatingPairs: 5,
      forcedGC: false,
      profiling: false,
    },
    scope:
      'Exact public parser exports on Node. Complete outputs and elapsed completion are compared. One-ms timer gaps observe event-loop responsiveness, not application CPU duration or browser interaction. No GPU evidence.',
    workloads: [],
  };
  const deadline = performance.now() + 10 * 60_000;
  for (const fixture of createCsvDecodeFixtures()) {
    for (const method of ['parseCsvHeaders', 'parseCsv', 'previewCSV']) {
      const invoke = (variant) => modules[variant][method](fixture.input);
      const expected = await invoke('baseline');
      assert.deepEqual(await invoke('candidate'), expected);
      if (method === 'previewCSV')
        assert.equal(expected.accepted, fixture.rows);
      if (method === 'parseCsv')
        assert.equal(expected.rows.length, fixture.rows);
      const expectedHash = digest(JSON.stringify(expected));
      for (let warmup = 0; warmup < 2; warmup++) {
        await invoke('baseline');
        await invoke('candidate');
      }
      const samples = [];
      for (let pair = 0; pair < 5; pair++) {
        for (const variant of pair % 2
          ? ['candidate', 'baseline']
          : ['baseline', 'candidate']) {
          assert.ok(
            performance.now() < deadline,
            'CSV comparison exceeded its ten-minute bound.',
          );
          const sample = await measured(() => invoke(variant));
          const outputSha256 = digest(JSON.stringify(sample.value));
          assert.equal(outputSha256, expectedHash);
          samples.push({
            pair,
            variant,
            totalCompletionMs: sample.totalCompletionMs,
            maxMainThreadGapMs: sample.maxMainThreadGapMs,
            outputSha256,
          });
        }
      }
      report.workloads.push({
        id: `${fixture.id}/${method}`,
        fixtureSha256: digest(fixture.input),
        fixtureBytes: Buffer.byteLength(fixture.input),
        fixtureRows: fixture.rows,
        expectedOutputSha256: expectedHash,
        samples,
        ...summarizeCsvComparison(samples),
      });
    }
  }
  checkSource();
  report.sourceCleanAtEnd = true;
  report.candidateCommitAtEnd = candidate;
  report.status = 'passed';
  report.performanceRegressions = report.workloads
    .filter((workload) => workload.changeRatio > 0.1)
    .map((workload) => workload.id);
  report.acceptanceScope =
    'Passed describes output parity and measurement integrity; regression and browser interaction acceptance are separate.';
  const output = path.resolve(outputPath);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = await runCsvDecodeComparison({
    candidate: process.argv[2],
    outputPath: process.argv[3],
  });
  console.log(
    JSON.stringify(
      report.workloads.map(({ samples, ...summary }) => summary),
      null,
      2,
    ),
  );
}
