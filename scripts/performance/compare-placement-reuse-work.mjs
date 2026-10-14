import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(scriptDir, '../..');
const baselineRoot = candidateRoot;
const baselineCommit = 'f25154a61326e881e2223f2238d94b06cf231df8';
const optionValues = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const option = process.argv[index];
  if (!['--candidate', '--out'].includes(option) || !process.argv[index + 1]) {
    throw new Error(
      'usage: node compare-placement-reuse-work.mjs --out <fresh-directory> [--candidate <worldOverlay.js>]',
    );
  }
  optionValues.set(option, process.argv[++index]);
}
if (!optionValues.has('--out'))
  throw new Error('--out <fresh-directory> is required');
const candidateSourcePath = path.resolve(
  candidateRoot,
  optionValues.get('--candidate') || 'src/overlays/worldOverlay.js',
);
const outputDir = path.resolve(candidateRoot, optionValues.get('--out'));
try {
  await stat(outputDir);
  throw new Error(
    `refusing to overwrite existing output directory: ${outputDir}`,
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await mkdir(path.dirname(outputDir), { recursive: true });
await mkdir(outputDir);
const artifactDir = path.join(outputDir, 'artifacts');
const reportPath = path.join(outputDir, 'report.json');
const tempParent = path.dirname(outputDir);
const buildDir = await mkdtemp(path.join(tempParent, '.run-'));
process.once('exit', () => {
  const resolvedTemp = path.resolve(buildDir);
  if (
    path.dirname(resolvedTemp) === path.resolve(tempParent) &&
    path.basename(resolvedTemp).startsWith('.run-')
  ) {
    rmSync(resolvedTemp, { recursive: true, force: true });
  }
});

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: null });
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr?.toString()}`,
    );
  return result.stdout;
}
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function absoluteImports(source, originalFile, override = new Map()) {
  return source.replace(
    /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (_all, quote, specifier) => {
      const replaced = override.get(specifier);
      const href =
        replaced ||
        pathToFileURL(path.resolve(path.dirname(originalFile), specifier)).href;
      return `from ${JSON.stringify(href)}`;
    },
  );
}

const candidateBytes = await readFile(candidateSourcePath);
const baselineBytes = runGit(baselineRoot, [
  'show',
  `${baselineCommit}:src/overlays/worldOverlay.js`,
]);
await mkdir(path.join(artifactDir, 'baseline'), { recursive: true });
await mkdir(path.join(artifactDir, 'candidate'), { recursive: true });
await writeFile(
  path.join(artifactDir, 'baseline/worldOverlay.js'),
  baselineBytes,
);
await writeFile(
  path.join(artifactDir, 'candidate/worldOverlay.js'),
  candidateBytes,
);
const patchBytes = spawnSync(
  'git',
  [
    'diff',
    '--no-index',
    '--',
    'baseline/worldOverlay.js',
    'candidate/worldOverlay.js',
  ],
  { cwd: artifactDir, encoding: null },
);
if (patchBytes.status !== 1)
  throw new Error(
    `expected source diff, got ${patchBytes.status}: ${patchBytes.stderr?.toString()}`,
  );
await writeFile(
  path.join(artifactDir, 'placement-reuse.diff'),
  patchBytes.stdout,
);
const immutableRuntimePaths = [
  'src/testSupport/readStylesheet.mjs',
  'build/application-html.js',
  'src/layers/installations/namedMarkers.js',
  'src/data/cctvCards.js',
  'src/performance/cpuTimings.js',
  'src/cyberSonar.js',
  'src/celestialRing.js',
  'src/data/detectionCohort.js',
  'src/data/labelArbiter.js',
  'src/overlays/worldOverlayDraw.js',
  'src/overlays/worldOverlayTokens.js',
  'index.html',
  'style.css',
  'package.json',
  'package-lock.json',
];
const immutableDependencyRows = {};
for (const rel of immutableRuntimePaths) {
  const baseline = runGit(baselineRoot, ['show', `${baselineCommit}:${rel}`]);
  const working = await readFile(path.join(candidateRoot, rel));
  const exact = baseline.equals(working);
  immutableDependencyRows[rel] = {
    baselineGitBlobId: runGit(baselineRoot, [
      'rev-parse',
      `${baselineCommit}:${rel}`,
    ])
      .toString('utf8')
      .trim(),
    baselineSha256: sha(baseline),
    workingSha256: sha(working),
    exactBytesMatch: exact,
  };
  if (!exact)
    throw new Error(
      `consumed dependency differs byte-for-byte from pinned baseline: ${rel}`,
    );
}
const pinnedTestBytes = runGit(baselineRoot, [
  'show',
  `${baselineCommit}:src/overlays/worldOverlay.test.mjs`,
]);
let sourceTest = pinnedTestBytes.toString('utf8');
const behaviorAppendPath = path.join(
  candidateRoot,
  'scripts/fixtures/placement-behavior.test.append.mjs',
);
const behaviorTestBytes = await readFile(behaviorAppendPath);
const behaviorTest = behaviorTestBytes.toString('utf8');
const cesiumImport = import.meta.resolve('cesium');
const cesiumImportPath = fileURLToPath(cesiumImport);
const cesiumPackagePath = path.join(
  candidateRoot,
  'node_modules/cesium/package.json',
);
const cesiumPackageBytes = await readFile(cesiumPackagePath);
const cesiumRuntimeBytes = await readFile(cesiumImportPath);
sourceTest = sourceTest.replace(
  /from\s+(['"])cesium\1/g,
  `from ${JSON.stringify(cesiumImport)}`,
);
const appendedTest = `

test('S52 placement reuse preserves output while skipping unchanged variant construction', (t) => {
  const env = installMockEnvironment({ width: 400, height: 300, dpr: 1, occluderRect: { left: 2, top: 2, width: 32, height: 22 } });
  t.after(() => env.cleanup());
  globalThis.__s52PlacementBuildCalls = 0;
  let loadingDone;
  env.document.fonts = {
    ready: new Promise(() => {}),
    addEventListener(name, listener) { if (name === 'loadingdone') loadingDone = listener; },
    removeEventListener() {},
  };
  initWorldOverlay(env.viewer);
  let anchor = positionAtScreen(205, 128);
  let scale = 1;
  let presentationSamples = 0;
  const input = (overrides = {}) => selectedEntry('probe', {
    position: () => anchor,
    title: 'PLACEMENT WITNESS',
    interactive: true,
    presentationScale: () => { presentationSamples++; return scale; },
    gapPx: 14,
    leaderOffsetPx: 3,
    placement: 'auto',
    verticalOnly: false,
    viewportMargin: 5,
    ...overrides,
  });
  setOverlayEntries('s52-placement', [input()]);
  const snapshots = [];
  const capture = () => {
    env.postRender.raise();
    const rect = getOverlayPaintRect('s52-placement', 'probe');
    const hit = rect && hitTestWorldOverlay(rect.x + rect.w / 2, rect.y + rect.h / 2, { sourceId: 's52-placement' });
    snapshots.push({
      rect: rect && { x: rect.x, y: rect.y, w: rect.w, h: rect.h, anchorX: rect.anchorX, anchorY: rect.anchorY },
      hit: hit && { sourceId: hit.sourceId, entryId: hit.entryId, variant: hit.entry?.variant },
      text: env.ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text),
      buildCalls: globalThis.__s52PlacementBuildCalls,
      presentationSamples,
    });
    env.ctx.calls.length = 0;
    return hit?.entry || null;
  };
  capture();
  capture();
  anchor = positionAtScreen(214, 133);
  const liveEntry = capture();
  assert.ok(liveEntry, 'the published hit exposes the normalized entry for input mutation');
  const invalidations = [];
  const mutateAndCheck = (mutate, label) => {
    const before = globalThis.__s52PlacementBuildCalls;
    mutate();
    capture();
    const after = globalThis.__s52PlacementBuildCalls;
    const stable = globalThis.__s52PlacementBuildCalls;
    capture();
    invalidations.push({ label, before, after, stable: globalThis.__s52PlacementBuildCalls });
  };
  mutateAndCheck(() => { liveEntry.gapPx += 4; }, 'gap');
  mutateAndCheck(() => { liveEntry.leaderOffsetPx += 2; }, 'leader offset');
  mutateAndCheck(() => { liveEntry.placement = 'below'; }, 'preferred corner');
  mutateAndCheck(() => { liveEntry.verticalOnly = true; }, 'vertical-only policy');
  mutateAndCheck(() => { liveEntry.viewportMargin += 3; }, 'viewport margin');
  mutateAndCheck(() => {
    liveEntry.anchorRadiusPx = 5;
    liveEntry.minAnchorGapPx = 2;
    liveEntry.anchorGapPaddingPx = 4;
  }, 'distance-derived anchor gap and leader offset');
  mutateAndCheck(() => { scale = 1.25; }, 'callback-derived placement size');
  mutateAndCheck(() => {
    setOverlayEntries('s52-placement', [input({ title: 'REPLACED CONTENT' })]);
  }, 'normalized entry/layout replacement');
  env.viewer.canvas.clientWidth = 440;
  env.window.dispatch('resize');
  env.advanceTime(120);
  mutateAndCheck(() => {}, 'viewport revision');
  const title = env.document.getElementById('title-bar');
  const beforeOcclusion = snapshots.at(-1).rect;
  title._rect = {
    left: beforeOcclusion.x - 8,
    top: beforeOcclusion.y - 8,
    width: beforeOcclusion.w + 16,
    height: beforeOcclusion.h + 16,
  };
  for (const observer of env.mutationObservers) {
    observer.callback([{ type: 'attributes', target: title }]);
  }
  env.advanceTime(120);
  mutateAndCheck(() => {}, 'occlusion/layout revision');
  const obstructedRect = snapshots.at(-2).rect;
  title._rect = { left: 2, top: 2, width: 12, height: 12 };
  for (const observer of env.mutationObservers) {
    observer.callback([{ type: 'attributes', target: title }]);
  }
  env.advanceTime(120);
  mutateAndCheck(() => {}, 'occlusion removal revision');
  const restoredRect = snapshots.at(-2).rect;
  const beforeOffscreen = globalThis.__s52PlacementBuildCalls;
  const visibleAnchor = anchor;
  anchor = positionAtScreen(650, 270);
  capture();
  const offscreenRect = snapshots.at(-1).rect;
  anchor = visibleAnchor;
  capture();
  const restoredVisibleRect = snapshots.at(-1).rect;
  const afterVisibilityRestore = globalThis.__s52PlacementBuildCalls;
  const beforeFont = globalThis.__s52PlacementBuildCalls;
  loadingDone();
  capture();
  const stableAfterFont = globalThis.__s52PlacementBuildCalls;
  capture();
  if (process.env.S52_PLACEMENT_REPORT) {
    writeFileSync(process.env.S52_PLACEMENT_REPORT, JSON.stringify({ snapshots, invalidations, presentationSamples,
      occlusion: { before: beforeOcclusion, obstructed: obstructedRect, restored: restoredRect },
      visibility: { offscreen: offscreenRect, restored: restoredVisibleRect, buildCallsBefore: beforeOffscreen, buildCallsAfter: afterVisibilityRestore },
    }, null, 2));
  }
  assert.equal(snapshots[0].buildCalls, 1, 'the first eligible frame constructs variants');
  assert.equal(snapshots[1].buildCalls, snapshots[0].buildCalls,
    'unchanged pure placement inputs reuse their complete variants');
  assert.ok(snapshots[2].buildCalls > snapshots[1].buildCalls,
    'a changed projected anchor invalidates placement variants');
  assert.ok(presentationSamples >= snapshots.filter(({ rect }) => rect).length,
    'presentation callbacks remain sampled on every visible frame, including after placement reuse');
  assert.ok(invalidations.every(({ after, before, stable }) => after === before + 1 && stable === after),
    'every exact placement dependency rebuilds once, then reuses on the next unchanged frame');
  assert.notDeepEqual({ x: obstructedRect.x, y: obstructedRect.y }, { x: beforeOcclusion.x, y: beforeOcclusion.y },
    'the occluder removes the previously selected placement and selects a clear variant');
  assert.deepEqual({ x: restoredRect.x, y: restoredRect.y }, { x: beforeOcclusion.x, y: beforeOcclusion.y },
    'after UI exclusion changes, the complete original variant set can be selected again');
  assert.equal(offscreenRect, null, 'an offscreen input stops publishing its hit rectangle');
  assert.ok(restoredVisibleRect, 'the same source entry publishes again when its anchor returns');
  assert.equal(afterVisibilityRestore, beforeOffscreen,
    'returning to exactly cached placement inputs reuses variants after an offscreen interval');
  assert.equal(stableAfterFont, beforeFont + 1, 'font measurement revision invalidates placement');
  assert.equal(globalThis.__s52PlacementBuildCalls, stableAfterFont, 'font geometry is reusable after measurement');
  assert.ok(snapshots.filter(({ rect }) => rect).every(({ rect, hit, text }) => Number.isFinite(rect.x) && hit?.entryId === 'probe' && text.some((value) => value === 'PLACEMENT WITNESS' || value === 'REPLACED CONTENT')),
    'the cache retains nonempty paint and the source hit identity');
});

test('S52 placement reuse adds no placement work to detection-only painting', (t) => {
  const env = installMockEnvironment();
  t.after(() => env.cleanup());
  globalThis.__s52PlacementBuildCalls = 0;
  initWorldOverlay(env.viewer);
  let detectionPaints = 0;
  registerWorldOverlayPaintLane('detection', (frame) => {
    detectionPaints++;
    frame.ctx.fillRect(20, 20, 8, 8);
  }, { id: 's52-detection-only', active: true, target: 'detection' });
  env.postRender.raise();
  assert.equal(detectionPaints, 1, 'the custom detection lane still paints');
  assert.ok(env.detectionCtx.calls.some(([name]) => name === 'fillRect'));
  assert.equal(globalThis.__s52PlacementBuildCalls, 0,
    'detection-only work does not enter label placement construction');
});
`;

async function prepare(side, root, originalBytes) {
  const sideDir = path.join(buildDir, side);
  await mkdir(sideDir, { recursive: true });
  const originalWorldPath = path.join(root, 'src/overlays/worldOverlay.js');
  const drawPath = path.join(root, 'src/overlays/worldOverlayDraw.js');
  const wrapperPath = path.join(sideDir, 'instrumentedWorldOverlayDraw.mjs');
  const drawUrl = pathToFileURL(drawPath).href;
  await writeFile(
    wrapperPath,
    `
import * as base from ${JSON.stringify(drawUrl)};
export const altitudeFade = base.altitudeFade;
export const destroyWorldOverlayDraw = base.destroyWorldOverlayDraw;
export const distanceFade = base.distanceFade;
export const distanceScale = base.distanceScale;
export const getWorldOverlayFontRevision = base.getWorldOverlayFontRevision;
export const installWorldOverlayFontInvalidation = base.installWorldOverlayFontInvalidation;
export const measureOverlayEntry = base.measureOverlayEntry;
export const paintOverlayEntry = base.paintOverlayEntry;
export function placementVariants(...args) {
  globalThis.__s52PlacementBuildCalls = (globalThis.__s52PlacementBuildCalls || 0) + 1;
  return base.placementVariants(...args);
}
`,
  );
  const overlayPath = path.join(sideDir, 'worldOverlay.mjs');
  let overlaySource = originalBytes
    .toString('utf8')
    .replace(/from\s+(['"])cesium\1/g, `from ${JSON.stringify(cesiumImport)}`);
  overlaySource = absoluteImports(
    overlaySource,
    originalWorldPath,
    new Map([['./worldOverlayDraw.js', pathToFileURL(wrapperPath).href]]),
  );
  await writeFile(overlayPath, overlaySource);

  const testPath = path.join(sideDir, 'worldOverlay.test.mjs');
  let testSource = sourceTest.replace(
    "import { readFileSync } from 'node:fs';",
    "import { readFileSync, writeFileSync } from 'node:fs';",
  );
  const originalTestPath = path.join(
    candidateRoot,
    'src/overlays/worldOverlay.test.mjs',
  );
  const overlayUrl = pathToFileURL(overlayPath).href;
  testSource = absoluteImports(
    testSource,
    originalTestPath,
    new Map([['./worldOverlay.js', overlayUrl]]),
  );
  for (const rel of ['../../index.html', '../../style.css']) {
    const actualUrl = pathToFileURL(
      path.resolve(
        root,
        rel === '../../index.html' ? 'index.html' : 'style.css',
      ),
    ).href;
    testSource = testSource.replaceAll(
      `new URL('${rel}', import.meta.url)`,
      `new URL(${JSON.stringify(actualUrl)})`,
    );
  }
  await writeFile(testPath, `${testSource}${appendedTest}${behaviorTest}`);
  return {
    testPath,
    overlayPath,
    wrapperPath,
    sourceSha256: sha(originalBytes),
  };
}

const prepared = {
  baseline: await prepare('baseline', baselineRoot, baselineBytes),
  candidate: await prepare('candidate', candidateRoot, candidateBytes),
};
const report = {
  schema: 'gev-s52-placement-reuse-focused/v1',
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  scope:
    'Exact-source mock-canvas correctness and work counts; no timing, rendered pixel or hardware acceptance',
  childTimeoutMs: 60_000,
  candidateSourcePath,
  requestedOutputPath: reportPath,
  artifactDirectory: artifactDir,
  baseline: {
    commit: baselineCommit,
    worldOverlayGitBlobId: runGit(candidateRoot, [
      'rev-parse',
      `${baselineCommit}:src/overlays/worldOverlay.js`,
    ])
      .toString('utf8')
      .trim(),
    sourceSha256: prepared.baseline.sourceSha256,
  },
  candidate: {
    baseCommit: baselineCommit,
    workingHead: runGit(candidateRoot, ['rev-parse', 'HEAD'])
      .toString('utf8')
      .trim(),
    baseWorldOverlayGitBlobId: runGit(candidateRoot, [
      'rev-parse',
      `${baselineCommit}:src/overlays/worldOverlay.js`,
    ])
      .toString('utf8')
      .trim(),
    stagedSourceSha256: prepared.candidate.sourceSha256,
  },
  harness: {
    runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    pinnedTestHelperSha256: sha(pinnedTestBytes),
    behaviorAppendSha256: sha(behaviorTestBytes),
  },
  sharedRuntimeDependencies: immutableDependencyRows,
  installedCesium: {
    version: JSON.parse(cesiumPackageBytes.toString('utf8')).version,
    packagePath: path.relative(candidateRoot, cesiumPackagePath),
    packageBytesSha256: sha(cesiumPackageBytes),
    resolvedImportPath: path.relative(candidateRoot, cesiumImportPath),
    resolvedImportBytesSha256: sha(cesiumRuntimeBytes),
  },
  instrumentation:
    'fixture wrapper counts actual worldOverlayDraw.placementVariants invocations',
  runs: {},
};
for (const side of ['baseline', 'candidate']) {
  const data = path.join(buildDir, `${side}-focused-output.json`);
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=S52 placement',
      prepared[side].testPath,
    ],
    {
      cwd: side === 'baseline' ? baselineRoot : candidateRoot,
      encoding: 'utf8',
      env: { ...process.env, S52_PLACEMENT_REPORT: data },
      timeout: 60_000,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const measured = await readFile(data, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const tapStatuses = Object.fromEntries(
    (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.match(/^(ok|not ok) \d+ - (.+)$/))
      .filter(Boolean)
      .map(([, status, name]) => [name, status === 'ok']),
  );
  report.runs[side] = {
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.error?.code === 'ETIMEDOUT',
    statuses: tapStatuses,
    stdout: result.stdout || '',
    expectedCacheWitness:
      tapStatuses[
        'S52 placement reuse preserves output while skipping unchanged variant construction'
      ] ===
      (side === 'candidate'),
    behaviorRegressionsPassed:
      tapStatuses[
        'S52 placement reuse adds no placement work to detection-only painting'
      ] === true &&
      tapStatuses[
        'S52 placement behavior restores choices after occlusion, visibility, and anchor-radius changes'
      ] === true &&
      tapStatuses[
        'S52 placement behavior restores ambient eligibility after a protected footprint moves'
      ] === true,
    expectedCandidateAllPass:
      side !== 'candidate' ||
      (Object.keys(tapStatuses).length === 4 &&
        Object.values(tapStatuses).every(Boolean)),
    exactSingleBaselineFailure:
      side !== 'baseline' ||
      (Object.keys(tapStatuses).length === 4 &&
        Object.values(tapStatuses).filter((passed) => !passed).length === 1 &&
        tapStatuses[
          'S52 placement reuse preserves output while skipping unchanged variant construction'
        ] === false &&
        (result.stdout || '').includes(
          'unchanged pure placement inputs reuse their complete variants',
        )),
    stderr: result.stderr || '',
    snapshots: measured?.snapshots || null,
  };
}
const finalCandidateBytes = await readFile(candidateSourcePath);
const finalBehaviorTestBytes = await readFile(behaviorAppendPath);
const finalDependencyRows = {};
for (const rel of immutableRuntimePaths) {
  const finalBytes = await readFile(path.join(candidateRoot, rel));
  finalDependencyRows[rel] = {
    initialSha256: immutableDependencyRows[rel].workingSha256,
    finalSha256: sha(finalBytes),
    unchanged: sha(finalBytes) === immutableDependencyRows[rel].workingSha256,
  };
}
const finalCesiumPackageBytes = await readFile(cesiumPackagePath);
const finalCesiumRuntimeBytes = await readFile(cesiumImportPath);
report.finalIntegrity = {
  candidateSource: {
    initialSha256: sha(candidateBytes),
    finalSha256: sha(finalCandidateBytes),
    unchanged: sha(finalCandidateBytes) === sha(candidateBytes),
  },
  behaviorAppend: {
    initialSha256: sha(behaviorTestBytes),
    finalSha256: sha(finalBehaviorTestBytes),
    unchanged: sha(finalBehaviorTestBytes) === sha(behaviorTestBytes),
  },
  runtimeDependencies: finalDependencyRows,
  allRuntimeDependenciesUnchanged: Object.values(finalDependencyRows).every(
    ({ unchanged }) => unchanged,
  ),
  installedCesiumUnchanged:
    sha(finalCesiumPackageBytes) === sha(cesiumPackageBytes) &&
    sha(finalCesiumRuntimeBytes) === sha(cesiumRuntimeBytes),
};
report.sharedDependenciesIdentical = Object.values(
  report.sharedRuntimeDependencies,
).every((row) => row.exactBytesMatch);
if (report.runs.baseline.snapshots && report.runs.candidate.snapshots) {
  const outputShape = (rows) =>
    rows.map(({ rect, hit, text }) => ({ rect, hit, text }));
  report.outputParity =
    JSON.stringify(outputShape(report.runs.baseline.snapshots)) ===
    JSON.stringify(outputShape(report.runs.candidate.snapshots));
}
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      reportPath,
      baselineCommit,
      workingHead: report.candidate.workingHead,
      stagedSourceSha256: report.candidate.stagedSourceSha256,
      baselineExit: report.runs.baseline.exitCode,
      candidateExit: report.runs.candidate.exitCode,
      baselineExpectedFailure: report.runs.baseline.expectedCacheWitness,
      candidateFocusedPass: report.runs.candidate.expectedCacheWitness,
      baselineCalls:
        report.runs.baseline.snapshots?.map((row) => row.buildCalls) || null,
      candidateCalls:
        report.runs.candidate.snapshots?.map((row) => row.buildCalls) || null,
      outputParity: report.outputParity,
    },
    null,
    2,
  ),
);
if (
  !report.sharedDependenciesIdentical ||
  report.runs.baseline.exitCode !== 1 ||
  !report.runs.baseline.expectedCacheWitness ||
  !report.runs.baseline.exactSingleBaselineFailure ||
  report.runs.baseline.timedOut ||
  report.runs.candidate.exitCode !== 0 ||
  !report.runs.candidate.expectedCacheWitness ||
  report.runs.candidate.timedOut ||
  !report.runs.candidate.expectedCandidateAllPass ||
  !report.runs.baseline.behaviorRegressionsPassed ||
  !report.runs.candidate.behaviorRegressionsPassed ||
  !report.finalIntegrity.candidateSource.unchanged ||
  !report.finalIntegrity.behaviorAppend.unchanged ||
  !report.finalIntegrity.allRuntimeDependenciesUnchanged ||
  !report.finalIntegrity.installedCesiumUnchanged ||
  report.outputParity !== true
)
  process.exitCode = 1;
