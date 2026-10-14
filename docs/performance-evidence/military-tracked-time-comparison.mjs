import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = process.cwd();
const baseline = 'df9c3abd45f88b5e4062264fa0f4704209bc6d46';
const candidate = process.argv[2];
assert.match(candidate || '', /^[a-f0-9]{40}$/);
const git = (...args) => execFileSync('git', args, { cwd: root });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const harnessPath = 'scripts/performance/militaryTrackedFrameTimeRepro.mjs';
const runtimePaths = new Set([
  'src/layers/military/motion.js',
  'src/layers/military/tracking.js',
]);
const allowedChanges = new Set([
  ...runtimePaths,
  'src/layers/military/state.js',
  'src/data/trackedReadout.test.mjs',
]);
const changedSource = git(
  'diff',
  '--name-only',
  baseline,
  candidate,
  '--',
  'src',
)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);
assert.ok(
  changedSource.every((file) => allowedChanges.has(file)),
  'comparison must isolate the tracked-time change',
);
assert.equal(
  git(
    'diff',
    '--name-only',
    candidate,
    '--',
    'src',
    'package.json',
    'package-lock.json',
    harnessPath,
  )
    .toString()
    .trim(),
  '',
  'working source must match the candidate',
);
assert.deepEqual(
  git('show', `${baseline}:package-lock.json`),
  git('show', `${candidate}:package-lock.json`),
);
const harnessBytes = git('show', `${candidate}:${harnessPath}`);
const dependencyHashes = {};
const moduleCache = new Map();

function rewriteImports(source, file, commit) {
  return source.replace(
    /\bfrom\s+(['"])([^'"]+)\1/g,
    (match, quote, specifier) => {
      if (specifier.startsWith('node:')) return match;
      if (!specifier.startsWith('.'))
        return `from '${import.meta.resolve(specifier)}'`;
      const dependency = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), specifier),
      );
      if (runtimePaths.has(dependency))
        return `from '${loadRuntimeUrl(dependency, commit)}'`;
      const expected = git('show', `${candidate}:${dependency}`);
      assert.deepEqual(
        git('show', `${baseline}:${dependency}`),
        expected,
        `dependency changed: ${dependency}`,
      );
      // Git normalizes text line endings. The checked-out module must have the same source.
      assert.equal(
        readFileSync(path.join(root, dependency), 'utf8').replaceAll(
          '\r\n',
          '\n',
        ),
        expected.toString().replaceAll('\r\n', '\n'),
      );
      dependencyHashes[dependency] = sha256(expected);
      return `from '${pathToFileURL(path.join(root, dependency)).href}'`;
    },
  );
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function loadRuntimeUrl(file, commit) {
  const key = `${commit}:${file}`;
  if (!moduleCache.has(key))
    moduleCache.set(
      key,
      dataUrl(rewriteImports(git('show', key).toString(), file, commit)),
    );
  return moduleCache.get(key);
}

// Additional observations use the same factory fixtures and real trail callback.
// Each frame holds both clocks fixed; successive frames advance both clocks.
// This measures deterministic output and sampling counts, never CPU/GPU latency.
const fixedTrajectory = `
export function compareFixedTrajectory() {
  const { flightState, motion, evaluateTrailHead, focusPublications } = createFixture();
  const rows = [];
  const times = [14.5, 15.5, ...Array.from({length: 120}, (_, i) => 40 + i / 60), 170, 171];
  let clockCalls = 0;
  for (let i = 0; i < times.length; i++) {
    flightState._viewer.scene.frameState.frameNumber = i * 2 + 1;
    withClock([at(times[i])], (clock) => {
      const position = Cesium.Cartesian3.clone(motion._trackedDisplayPosition(ICAO));
      const course = motion._trackedDisplayCourse();
      motion._deadReckon(OTHER_ICAO, new Cesium.Cartesian3());
      flightState._viewer.scene.frameState.frameNumber += 1;
      const head = evaluateTrailHead();
      rows.push({ position: [position.x, position.y, position.z], course,
        trail: head.map(p => [p.x, p.y, p.z]), focusWrites: focusPublications(),
        extrapolating: flightState._drExtrapolating });
      clockCalls += clock.calls();
    }, [EPOCH_MS + times[i] * 1000]);
  }
  return { rows, clockCalls };
}
`;

const reports = [];
for (const commit of [baseline, candidate]) {
  const module = await import(
    dataUrl(
      rewriteImports(harnessBytes.toString(), harnessPath, commit) +
        fixedTrajectory,
    )
  );
  const repetitions = [];
  for (let i = 0; i < 5; i++) {
    const { rows, clockCalls } = module.compareFixedTrajectory();
    repetitions.push({
      frames: rows.length,
      outputSha256: sha256(JSON.stringify(rows)),
      clockCalls,
    });
  }
  reports.push({
    commit,
    runtimeSha256: Object.fromEntries(
      [...runtimePaths].map((file) => [
        file,
        sha256(git('show', `${commit}:${file}`)),
      ]),
    ),
    diagnostics: module.runMilitaryTrackedFrameTimeReproduction(),
    repetitions,
  });
}
for (let i = 0; i < 5; i++) {
  assert.equal(
    reports[0].repetitions[i].outputSha256,
    reports[1].repetitions[i].outputSha256,
    'fixed-input trajectory output changed',
  );
  assert.equal(
    reports[0].repetitions[i].clockCalls - reports[1].repetitions[i].clockCalls,
    reports[1].repetitions[i].frames,
    'expected one eliminated sample per frame',
  );
}
const before = reports[0].diagnostics.cases;
const after = reports[1].diagnostics.cases;
assert.equal(before.positionFirst.trailReturnedSegment, true);
assert.equal(after.positionFirst.trailReturnedSegment, false);
assert.deepEqual(
  before.positionFirst.positionEcefM,
  after.positionFirst.positionEcefM,
);
assert.deepEqual(
  after.positionFirst.positionEcefM,
  after.trailFirst.positionEcefM,
);
assert.equal(after.laterFrameObserver.focusWritesFromObserver, 0);
const report = {
  schema: 'gev-military-tracked-time-comparison/v1',
  scope:
    'Node production-factory output and sampling-count comparison; no CPU latency, browser, GPU or live aircraft measurement',
  timestamp: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  workingTreeHead: git('rev-parse', 'HEAD').toString().trim(),
  baseline,
  candidate,
  comparisonScriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  fixtureScriptSha256: sha256(harnessBytes),
  lockfileSha256: sha256(git('show', `${candidate}:package-lock.json`)),
  dependencyHashes,
  status: 'passed',
  reports,
};
const output =
  process.argv[3] ||
  `qa-artifacts/military-tracked-time-comparison-${candidate.slice(0, 7)}.json`;
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      output,
      sha256: sha256(readFileSync(output)),
      status: report.status,
      repetitions: reports.map(({ commit, repetitions }) => ({
        commit,
        repetitions,
      })),
    },
    null,
    2,
  ),
);
