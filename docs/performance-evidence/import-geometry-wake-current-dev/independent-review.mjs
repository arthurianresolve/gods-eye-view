import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const directory = resolve(process.argv[2]);
const expectedCommit = 'df63fc432a7164778583c20ced4db87bc3d6d350';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(join(directory, 'report.json'));
const report = JSON.parse(bytes);
const arms = [
  'whole-feature-timer',
  'chunked-timer',
  'chunked-message-channel',
];
const types = ['LineString', 'Polygon'];
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
assert.equal(report.status, 'passed');
assert.equal(report.commit, expectedCommit);
assert.equal(report.source.applicationCommit, expectedCommit);
assert.equal(report.source.harnessCommit, expectedCommit);
for (const field of [
  'dirtyAtStart',
  'sourceDirtyAtStart',
  'harnessDirtyAtStart',
  'changedDuringRun',
])
  assert.equal(report.source[field], false);
const trackedSources = {
  runtimeLayerSha256: 'src/imports/runtimeLayer.js',
  cooperativeSha256: 'src/imports/cooperative.js',
  fixtureSha256: 'scripts/fixtures/import-geometry-wake.js',
  fixtureHtmlSha256: 'scripts/fixtures/import-geometry-wake.html',
  schedulerSha256: 'scripts/performance/geometryWakeScheduler.mjs',
  packageLockSha256: 'package-lock.json',
  runnerSha256: 'scripts/qa-import-geometry-wake.mjs',
  validatorSha256: 'scripts/performance/importGeometryWakeComparison.mjs',
};
for (const [key, path] of Object.entries(trackedSources)) {
  const actual = sha(
    execFileSync('git', ['show', `${expectedCommit}:${path}`]),
  );
  assert.equal(report.source[key], actual, path);
  assert.equal(report.source.hashesAtFinish[key], actual, `${path} final hash`);
}
assert.equal(report.pairCount, 5);
assert.equal(report.pairs.length, 5);
assert.equal(report.browserCleanup.closeCompleted, true);
assert.equal(report.browserCleanup.forcedProcessTermination, false);
assert.equal(report.serverCleanup.confirmed, true);
assert.equal(report.cleanupError, undefined);
const images = [],
  samples = [],
  firstPixels = new Map(),
  firstGeometry = new Map();
let firstSettings;
await mkdir(join(directory, 'decoded-review'), { recursive: true });
for (const [pairIndex, pair] of report.pairs.entries()) {
  assert.equal(pair.index, pairIndex);
  assert.deepEqual(
    pair.order,
    arms.map((_, offset) => arms[(pairIndex + offset) % arms.length]),
  );
  for (const arm of arms) {
    const run = pair.runs[arm];
    assert.equal(run.applicationCommit, expectedCommit);
    assert.equal(run.harnessCommit, expectedCommit);
    assert.equal(run.status, 'passed');
    assert.equal(run.arm, arm);
    assert.deepEqual(run.pageErrors, []);
    assert.deepEqual(run.renderErrors, []);
    assert.equal(run.pageCleanup.closeCompleted, true);
    assert.equal(run.pageCleanup.openPageCount, 0);
    assert.equal(run.environment.contextLost, false);
    firstSettings ??= run.environment;
    assert.deepEqual(run.environment, firstSettings);
    assert.equal(run.samples.length, 2);
    for (const [index, sample] of run.samples.entries()) {
      const type = types[index];
      const name = `pair-${pairIndex}-${arm}-${type}`;
      assert.equal(sample.type, type);
      assert.equal(sample.positionCount, 50_000);
      assert.deepEqual(
        sample.ringLengths,
        type === 'Polygon' ? [25_000, 25_000] : [50_000],
      );
      const expectedId = `gev-import:geometry-wake:large-geometry:${type}`;
      assert.equal(sample.entityId, expectedId);
      assert.equal(sample.readiness.pickedEntityId, expectedId);
      assert.equal(sample.readiness.onCanvas, true);
      if (firstGeometry.has(type))
        assert.equal(sample.geometrySha256, firstGeometry.get(type));
      else firstGeometry.set(type, sample.geometrySha256);
      const capture = sample.capture;
      assert.equal(capture.width, 960);
      assert.equal(capture.height, 640);
      assert.ok(
        typeof capture.pngDataUrl === 'string' &&
          capture.pngDataUrl.length < 750_000,
      );
      assert.match(
        capture.pngDataUrl,
        /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/,
      );
      const png = Buffer.from(
        capture.pngDataUrl.slice('data:image/png;base64,'.length),
        'base64',
      );
      const { data, info } = await sharp(png, { limitInputPixels: 960 * 640 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.width, capture.width);
      assert.equal(info.height, capture.height);
      assert.equal(info.channels, 4);
      assert.equal(sha(data), capture.pixelSha256, `${name}: pixel hash`);
      if (firstPixels.has(type))
        assert.ok(data.equals(firstPixels.get(type)), `${name}: exact RGBA`);
      else {
        firstPixels.set(type, data);
        await writeFile(join(directory, 'decoded-review', `${type}.png`), png, {
          flag: 'wx',
        });
      }
      images.push({
        name,
        width: info.width,
        height: info.height,
        pngSha256: sha(png),
        rgbaSha256: sha(data),
      });
      assert.equal(sample.scheduleCount, sample.callbackCount);
      assert.equal(sample.wakeMs.length, sample.callbackCount);
      assert.equal(sample.activeCallbackMs.length, sample.callbackCount);
      const spans = [sample.initialActiveSpanMs, ...sample.activeCallbackMs];
      assert.ok(
        [...spans, ...sample.wakeMs, sample.loadElapsedMs].every(
          (value) => Number.isFinite(value) && value >= 0,
        ),
      );
      const maximumActiveSpanMs = Math.max(...spans);
      const totalActiveSpanMs = spans.reduce((sum, value) => sum + value, 0);
      assert.ok(
        Math.abs(maximumActiveSpanMs - sample.maximumActiveSpanMs) < 0.001,
      );
      assert.ok(Math.abs(totalActiveSpanMs - sample.totalActiveSpanMs) < 0.001);
      assert.equal(
        sample.activeSpansOver4ms,
        spans.filter((value) => value > 4).length,
      );
      for (const key of [
        'featureCount',
        'pendingJobs',
        'sceneEntityCount',
        'contextRecordCount',
        'schedulerPendingCount',
      ])
        assert.equal(sample.cleanup[key], 0);
      const cancellation = run.cancellation[type];
      assert.equal(cancellation.outcome, 'AbortError');
      assert.equal(
        cancellation.scope,
        'synthetic-budget-clock-queued-wake-cancel-before-dispatch',
      );
      assert.equal(cancellation.pendingSchedulerTasksBeforeClear, 1);
      for (const key of [
        'featureCountAfter',
        'pendingJobsAfter',
        'entitiesAfter',
        'contextRecordCountAfter',
        'pendingSchedulerTasksAfter',
      ])
        assert.equal(cancellation[key], 0);
      samples.push({
        pairIndex,
        arm,
        type,
        loadElapsedMs: sample.loadElapsedMs,
        maximumActiveSpanMs,
        totalActiveSpanMs,
        activeSpansOver4ms: sample.activeSpansOver4ms,
        totalWakeMs: sample.wakeMs.reduce((sum, value) => sum + value, 0),
      });
    }
  }
}
const comparisons = [];
for (const type of types) {
  for (const arm of arms.slice(1)) {
    const pairs = report.pairs.map((_, pairIndex) => {
      const baseline = samples.find(
        (s) =>
          s.pairIndex === pairIndex && s.type === type && s.arm === arms[0],
      );
      const candidate = samples.find(
        (s) => s.pairIndex === pairIndex && s.type === type && s.arm === arm,
      );
      return {
        pairIndex,
        loadChangePercent:
          (candidate.loadElapsedMs / baseline.loadElapsedMs - 1) * 100,
        maximumSpanChangePercent:
          (candidate.maximumActiveSpanMs / baseline.maximumActiveSpanMs - 1) *
          100,
        totalActiveChangePercent:
          (candidate.totalActiveSpanMs / baseline.totalActiveSpanMs - 1) * 100,
      };
    });
    comparisons.push({
      type,
      arm,
      pairs,
      medianPairedLoadChangePercent: median(
        pairs.map((p) => p.loadChangePercent),
      ),
      slowerLoadPairs: pairs.filter((p) => p.loadChangePercent > 0).length,
      loadRegressionsAbove10Percent: pairs.filter(
        (p) => p.loadChangePercent > 10,
      ).length,
      medianPairedMaximumSpanChangePercent: median(
        pairs.map((p) => p.maximumSpanChangePercent),
      ),
      medianPairedTotalActiveChangePercent: median(
        pairs.map((p) => p.totalActiveChangePercent),
      ),
    });
  }
}
const review = {
  schema: 'gev-import-geometry-wake-independent-review/v1',
  sourceSha256: sha(bytes),
  candidateCommit: expectedCommit,
  outcome: 'correctness-passed; optimization-not-accepted',
  sourceHashesVerifiedAgainstGit: Object.keys(trackedSources),
  imageCount: images.length,
  exactImageGroups: types.map((type) => ({
    type,
    images: images.filter((image) => image.name.endsWith(type)).length,
    geometrySha256: firstGeometry.get(type),
    rgbaSha256: sha(firstPixels.get(type)),
  })),
  settings: firstSettings,
  comparisons,
  samples,
  images,
  browserCleanup: report.browserCleanup,
  limitations: [
    'One shared hosted browser process with fresh page/viewer per arm.',
    'Hosted Apple paravirtual Metal does not establish physical Windows coverage.',
    'Both chunked arms regress completion time; measured active spans still exceed four ms.',
    'Coordinate hashes are matched as reported; the full coordinate arrays are not retained for offline reconstruction.',
    'No production scheduling or coordinate-preparation default is changed.',
  ],
};
await writeFile(
  join(directory, 'independent-review.json'),
  JSON.stringify(review, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    {
      sourceSha256: review.sourceSha256,
      imageCount: review.imageCount,
      exactImageGroups: review.exactImageGroups,
      comparisons,
    },
    null,
    2,
  ),
);
