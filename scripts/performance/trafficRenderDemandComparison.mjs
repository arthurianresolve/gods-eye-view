import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './rendererEvidence.mjs';
import {
  assertInitialRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';
import {
  compareTrafficRenderDemandRuns,
  validateTrafficRenderDemandRun,
} from './trafficRenderDemand.mjs';

if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('Run traffic render-demand comparisons on hosted CI only.');

const [baselineArg, candidateArg, outputArg] = process.argv.slice(2);
assert.ok(
  baselineArg && candidateArg && outputArg,
  'Usage: trafficRenderDemandComparison.mjs BASELINE CANDIDATE OUTPUT_DIRECTORY',
);
const roots = {
  baseline: resolve(baselineArg),
  candidate: resolve(candidateArg),
};
const commits = {
  baseline: process.env.BASELINE_SHA,
  candidate: process.env.CANDIDATE_SHA,
};
for (const [side, commit] of Object.entries(commits))
  assert.match(commit || '', /^[a-f0-9]{40}$/, `Missing exact ${side} SHA`);
assert.notEqual(roots.baseline, roots.candidate);

const output = resolve(outputArg);
assert.equal(
  existsSync(output),
  false,
  'Refusing to overwrite prior traffic evidence.',
);
await mkdir(output, { recursive: true });
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureNames = [
  'scripts/fixtures/traffic-render-demand.html',
  'scripts/fixtures/traffic-render-demand.mjs',
];
const fixtures = new Map();
for (const name of fixtureNames)
  fixtures.set(name, await readFile(resolve(rootDir, name)));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (cwd, args) => spawnSyncGit(cwd, args);
const gitBytes = (cwd, ref) => {
  const result = spawnSync(process.env.GIT || 'git', ['show', ref], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git show ${ref} failed in ${cwd}`);
  return result.stdout;
};
const TRAFFIC_SOURCES = [
  'src/layers/traffic/animation.js',
  'src/layers/traffic/lifecycle.js',
  'src/layers/traffic/rendering.js',
  'src/layers/traffic/retention.js',
  'src/layers/traffic/style.js',
];
const CESIUM_RUNTIME_FILES = [
  'cesium/Build/Cesium/Widgets/widgets.css',
  'cesium/Source/Cesium.js',
  '@cesium/engine/index.js',
  '@cesium/widgets/index.js',
  'cesium/Build/Cesium/index.cjs',
  'cesium/Build/CesiumUnminified/index.cjs',
  'cesium/Build/Cesium/Cesium.js',
  'cesium/Build/CesiumUnminified/Cesium.js',
];
const CESIUM_SOURCE_DIRS = [
  'cesium/Source',
  '@cesium/engine/Source',
  '@cesium/widgets/Source',
];
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
const report = {
  schema: 'gev-traffic-render-demand-comparison/v1',
  status: 'running',
  createdAt: new Date().toISOString(),
  scope:
    'Five alternating exact-pixel traffic A/B pairs, deterministic local surface and feed, 10-second enabled-empty idle observation; native hosted WebGL acceleration is required and verified.',
  commits,
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
    host: readHostEnvironment(),
    browserArgs: launchArgs,
  },
  harness: {
    commit: git(rootDir, ['rev-parse', 'HEAD']),
    runnerSha256: hash(await readFile(new URL(import.meta.url))),
    validatorSha256: hash(
      await readFile(new URL('./trafficRenderDemand.mjs', import.meta.url)),
    ),
    fixtures: Object.fromEntries(
      [...fixtures].map(([name, bytes]) => [name, hash(bytes)]),
    ),
  },
  sources: {},
  pairs: [],
  cleanup: {
    browserClosed: false,
    pagesClosed: false,
    serversStopped: false,
    temporaryFixturesRemoved: false,
    sourceTreesUnchanged: false,
    pageCloseResults: [],
    serverStopResults: [],
  },
};
const reportPath = resolve(output, 'traffic-render-demand.json');
let reportCheckpoint = 0;
let failure = null;
function recordFailure(error) {
  failure ||= error;
  report.status = 'failed';
  report.error = {
    name: error?.name || 'Error',
    message: String(error?.message || error),
  };
}
async function saveReport() {
  const temporary = `${reportPath}.tmp-${process.pid}-${++reportCheckpoint}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  try {
    await rename(temporary, reportPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
await saveReport();

function spawnSyncGit(cwd, args) {
  const result = spawnSync(process.env.GIT || 'git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

async function hashSourceDirectory(root, sourceDirectory) {
  const absoluteRoot = resolve(root, sourceDirectory);
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const relativePath = relative(absoluteRoot, path).split(sep).join('/');
        files.push([relativePath, hash(await readFile(path))]);
      }
    }
  }
  await visit(absoluteRoot);
  files.sort(([left], [right]) => left.localeCompare(right));
  const treeHash = createHash('sha256');
  for (const [path, digest] of files) treeHash.update(`${path}\0${digest}\n`);
  return { fileCount: files.length, sha256: treeHash.digest('hex') };
}

function serverFor(side, port) {
  const root = roots[side];
  const env = { ...process.env, GEV_APP_COMMIT: commits[side] };
  const child = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: root,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 16_000) stderr += chunk.toString();
  });
  return { child, port, stderr: () => stderr };
}

async function waitServer(server, side) {
  const url = `http://127.0.0.1:${server.port}/scripts/fixtures/traffic-render-demand.html`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null)
      throw new Error(
        `${side} Vite exited ${server.child.exitCode}: ${server.stderr()}`,
      );
    if (
      await fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    )
      return url;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${side} Vite startup timeout: ${server.stderr()}`);
}

async function stopServer(server) {
  if (!server) return { attempted: false, confirmed: false, reason: 'missing' };
  return stopOwnedRecoveryProcessTree(server.child);
}

async function stagedFixture(root, name, bytes) {
  const path = resolve(root, name);
  const present = existsSync(path);
  if (present) {
    assert.deepEqual(
      await readFile(path),
      bytes,
      `Fixture bytes differ in ${root}: ${name}`,
    );
    return { path, created: false };
  }
  await mkdir(dirname(path), { recursive: true });
  await copyFile(resolve(rootDir, name), path);
  return { path, created: true };
}

function withoutHeatlineOnlyFields(stats) {
  const copy = { ...stats };
  delete copy.heatLines;
  delete copy.jamViz;
  return copy;
}

async function decodePng(dataUrl, expectedHash, label) {
  assert.ok(
    dataUrl?.startsWith('data:image/png;base64,'),
    `${label}: no PNG data`,
  );
  const png = Buffer.from(
    dataUrl.slice('data:image/png;base64,'.length),
    'base64',
  );
  assert.equal(hash(png), expectedHash, `${label}: PNG hash mismatch`);
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(
    info.format,
    'raw',
    `${label}: PNG did not decode to raw pixels`,
  );
  assert.equal(info.channels, 4, `${label}: PNG is not RGBA after decode`);
  return { data, width: info.width, height: info.height };
}

async function verifyHeatlineControl(run, runDirectory) {
  const witness = run.heatlineVisualWitness;
  const primary = run.captures.find(
    (capture) => capture.name === 'jam-heatlines',
  );
  assert.ok(primary, 'Missing primary heatline capture');
  const controlPixels = await decodePng(
    witness.noHeatlineControlImagePng,
    witness.noHeatlineControlPngSha256,
    'No-heatline control',
  );
  const primaryPixels = await decodePng(
    primary.imagePng,
    primary.pngSha256,
    'Heatline capture',
  );
  assert.equal(controlPixels.width, primaryPixels.width);
  assert.equal(controlPixels.height, primaryPixels.height);
  assert.equal(controlPixels.width, primary.width);
  assert.equal(controlPixels.height, primary.height);
  let changedPixels = 0;
  for (let offset = 0; offset < primaryPixels.data.length; offset += 4) {
    if (
      primaryPixels.data[offset] !== controlPixels.data[offset] ||
      primaryPixels.data[offset + 1] !== controlPixels.data[offset + 1] ||
      primaryPixels.data[offset + 2] !== controlPixels.data[offset + 2] ||
      primaryPixels.data[offset + 3] !== controlPixels.data[offset + 3]
    )
      changedPixels++;
  }
  assert.ok(changedPixels > 0, 'Heatline control produced no changed pixels');
  assert.equal(changedPixels, witness.changedPixels);
  const controlSnapshot = witness.noHeatlineControlSnapshot;
  assert.ok(controlSnapshot, 'Missing no-heatline rendered snapshot');
  assert.deepEqual(
    primary.snapshot.dots,
    controlSnapshot.dots,
    'Heatline toggle changed dot identity, projection, size or style',
  );
  assert.deepEqual(
    withoutHeatlineOnlyFields(primary.snapshot.stats),
    withoutHeatlineOnlyFields(controlSnapshot.stats),
    'Heatline toggle changed non-heatline stats',
  );
  assert.deepEqual(primary.snapshot.camera, controlSnapshot.camera);
  assert.deepEqual(
    primary.snapshot.renderSettings,
    controlSnapshot.renderSettings,
  );

  const controlPath = resolve(
    runDirectory,
    'jam-heatlines-disabled-control.png',
  );
  await writeFile(
    controlPath,
    Buffer.from(
      witness.noHeatlineControlImagePng.slice('data:image/png;base64,'.length),
      'base64',
    ),
    { flag: 'wx' },
  );
  witness.noHeatlineControlImagePath = relative(output, controlPath)
    .split(sep)
    .join('/');
  delete witness.noHeatlineControlImagePng;
  witness.externalPixelVerification = {
    method: 'sharp.ensureAlpha().raw()',
    decodedWidth: controlPixels.width,
    decodedHeight: controlPixels.height,
    changedPixels,
    dotSnapshotEqual: true,
    nonHeatlineStatsEqual: true,
  };
}

async function runTrial(browser, url, side, pair, graphicsInfo, onRawResult) {
  const initialPages = await browser.pages();
  const page = initialPages.length
    ? assertInitialRecoveryPage(initialPages, url)
    : await browser.newPage();
  const externalRequests = [];
  const pageErrors = [];
  const origin = new URL(url).origin;
  try {
    await page.bringToFront();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(90_000);
    page.setDefaultTimeout(110_000);
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const protocol = new URL(request.url()).protocol;
      if (
        request.url().startsWith(`${origin}/`) ||
        ['data:', 'blob:'].includes(protocol)
      )
        void request.continue();
      else {
        externalRequests.push(request.url());
        void request.abort();
      }
    });
    const response = await page.goto(`${url}?mode=${side}`, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(response?.status(), 200, `${side} fixture did not load`);
    await page.waitForFunction(
      () => document.querySelector('#result')?.textContent?.length > 0,
      { timeout: 110_000 },
    );
    const run = await page.evaluate(() =>
      JSON.parse(document.querySelector('#result').textContent),
    );
    run.pageErrors = pageErrors;
    await onRawResult(run);
    run.externalRequests = externalRequests;
    const renderer = run.captures?.[0]?.snapshot?.renderSettings?.renderer;
    run.rendererEvidence = {
      renderer,
      browserGraphicsInfo: graphicsInfo,
      classification: classifyRenderer(renderer, graphicsInfo),
    };
    await onRawResult(run);
    // Validate fixture status first: a setup failure has no capture renderer.
    validateTrafficRenderDemandRun(run, {
      expectedCommit: commits[side],
      mode: side,
    });
    assert.deepEqual(
      externalRequests,
      [],
      `${side} fixture made external requests`,
    );
    assert.deepEqual(pageErrors, [], `${side} fixture raised a page error`);
    assert.equal(
      run.rendererEvidence.classification.accelerationVerified,
      true,
      `${side} renderer acceleration was not verified`,
    );
    const runDirectory = resolve(
      output,
      `pair-${String(pair).padStart(2, '0')}`,
      side,
    );
    await mkdir(runDirectory, { recursive: true });
    await verifyHeatlineControl(run, runDirectory);
    for (const capture of run.captures) {
      const marker = 'base64,';
      assert.ok(
        capture.imagePng?.startsWith('data:image/png;base64,'),
        `Missing PNG bytes for ${capture.name}`,
      );
      const png = Buffer.from(
        capture.imagePng.slice(
          capture.imagePng.indexOf(marker) + marker.length,
        ),
        'base64',
      );
      assert.equal(
        hash(png),
        capture.pngSha256,
        `Raw PNG hash mismatch: ${capture.name}`,
      );
      const decoded = await sharp(png).metadata();
      assert.equal(
        decoded.format,
        'png',
        `Decoded capture is not PNG: ${capture.name}`,
      );
      assert.equal(
        decoded.width,
        capture.width,
        `PNG width mismatch: ${capture.name}`,
      );
      assert.equal(
        decoded.height,
        capture.height,
        `PNG height mismatch: ${capture.name}`,
      );
      const pngPath = resolve(runDirectory, `${capture.name}.png`);
      await writeFile(pngPath, png, { flag: 'wx' });
      capture.imagePath = relative(output, pngPath).split(sep).join('/');
      delete capture.imagePng;
    }
    await onRawResult(run);
    return run;
  } finally {
    const close = await closeOwnedRecoveryPage(page, browser);
    report.cleanup.pageCloseResults.push(close);
    report.cleanup.pagesClosed = report.cleanup.pageCloseResults.every(
      (result) => result.closeCompleted && result.openPageCount === 0,
    );
    assert.equal(
      close.closeCompleted && close.openPageCount === 0,
      true,
      `${side} owned page cleanup was not confirmed`,
    );
  }
}

const staged = [];
const servers = [];
let browser;
try {
  for (const [side, root] of Object.entries(roots)) {
    assert.equal(
      git(root, ['status', '--porcelain']),
      '',
      `${side} source tree is dirty`,
    );
    assert.equal(
      git(root, ['rev-parse', 'HEAD']),
      commits[side],
      `Wrong ${side} immutable commit`,
    );
    const files = Object.fromEntries(
      TRAFFIC_SOURCES.map((name) => [
        name,
        hash(gitBytes(root, `HEAD:${name}`)),
      ]),
    );
    const packageLock = hash(
      await readFile(resolve(root, 'package-lock.json')),
    );
    const cesiumPackage = JSON.parse(
      await readFile(resolve(root, 'node_modules/cesium/package.json'), 'utf8'),
    );
    const enginePackage = JSON.parse(
      await readFile(
        resolve(root, 'node_modules/@cesium/engine/package.json'),
        'utf8',
      ),
    );
    const widgetsPackage = JSON.parse(
      await readFile(
        resolve(root, 'node_modules/@cesium/widgets/package.json'),
        'utf8',
      ),
    );
    const cesiumRuntimeFiles = Object.fromEntries(
      await Promise.all(
        CESIUM_RUNTIME_FILES.map(async (name) => [
          name,
          hash(await readFile(resolve(root, 'node_modules', name))),
        ]),
      ),
    );
    const cesiumSourceTrees = Object.fromEntries(
      await Promise.all(
        CESIUM_SOURCE_DIRS.map(async (name) => [
          name,
          await hashSourceDirectory(root, resolve(root, 'node_modules', name)),
        ]),
      ),
    );
    report.sources[side] = {
      commit: commits[side],
      trafficFiles: files,
      packageLockSha256: packageLock,
      cesiumVersion: cesiumPackage.version,
      cesiumPackageJsonSha256: hash(
        await readFile(resolve(root, 'node_modules/cesium/package.json')),
      ),
      engineVersion: enginePackage.version,
      enginePackageJsonSha256: hash(
        await readFile(
          resolve(root, 'node_modules/@cesium/engine/package.json'),
        ),
      ),
      widgetsVersion: widgetsPackage.version,
      widgetsPackageJsonSha256: hash(
        await readFile(
          resolve(root, 'node_modules/@cesium/widgets/package.json'),
        ),
      ),
      cesiumRuntimeFiles,
      cesiumSourceTrees,
    };
    for (const [name, bytes] of fixtures)
      staged.push(await stagedFixture(root, name, bytes));
  }
  assert.equal(
    report.sources.baseline.packageLockSha256,
    report.sources.candidate.packageLockSha256,
    'Package locks differ',
  );
  assert.equal(
    report.sources.baseline.cesiumVersion,
    report.sources.candidate.cesiumVersion,
    'Cesium versions differ',
  );
  assert.equal(
    report.sources.baseline.engineVersion,
    report.sources.candidate.engineVersion,
    'Cesium engine versions differ',
  );
  assert.equal(
    report.sources.baseline.widgetsVersion,
    report.sources.candidate.widgetsVersion,
    'Cesium widgets versions differ',
  );
  for (const packageKey of [
    'cesiumPackageJsonSha256',
    'enginePackageJsonSha256',
    'widgetsPackageJsonSha256',
  ])
    assert.equal(
      report.sources.baseline[packageKey],
      report.sources.candidate[packageKey],
      `Installed Cesium package metadata differs: ${packageKey}`,
    );
  assert.deepEqual(
    report.sources.baseline.cesiumRuntimeFiles,
    report.sources.candidate.cesiumRuntimeFiles,
    'Installed Cesium source/distribution bytes differ',
  );
  assert.deepEqual(
    report.sources.baseline.cesiumSourceTrees,
    report.sources.candidate.cesiumSourceTrees,
    'Installed Cesium source module trees differ',
  );
  for (const name of TRAFFIC_SOURCES)
    assert.notEqual(
      report.sources.baseline.trafficFiles[name],
      report.sources.candidate.trafficFiles[name],
      `Expected candidate change in ${name}`,
    );

  servers.push(serverFor('baseline', 4187), serverFor('candidate', 4188));
  const urls = await Promise.all(
    servers.map((server, index) =>
      waitServer(server, index === 0 ? 'baseline' : 'candidate'),
    ),
  );
  browser = await puppeteer.launch({
    headless: true,
    args: report.environment.browserArgs,
  });
  report.environment.browserVersion = await browser.version();
  report.environment.browserGraphicsInfo =
    await readBrowserGraphicsInfo(browser);
  assert.ok(
    report.environment.browserGraphicsInfo,
    'Could not read hosted browser graphics status',
  );
  await saveReport();
  for (let pair = 0; pair < 5; pair++) {
    const order =
      pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const runBySide = {};
    const pairRecord = { pair: pair + 1, order, runs: runBySide };
    report.pairs.push(pairRecord);
    await saveReport();
    for (const side of order) {
      const index = side === 'baseline' ? 0 : 1;
      runBySide[side] = { status: 'starting' };
      await saveReport();
      runBySide[side] = await runTrial(
        browser,
        urls[index],
        side,
        pair + 1,
        report.environment.browserGraphicsInfo,
        async (rawRun) => {
          runBySide[side] = rawRun;
          await saveReport();
        },
      );
      await saveReport();
    }
    const comparison = compareTrafficRenderDemandRuns(
      runBySide.baseline,
      runBySide.candidate,
      {
        baselineCommit: commits.baseline,
        candidateCommit: commits.candidate,
      },
    );
    pairRecord.comparison = comparison;
    await saveReport();
  }
  // Repeated pairs must remain identical; a deterministic fixture may not
  // drift between alternating browser trials.
  const reference = report.pairs[0].comparison.phases;
  for (const pair of report.pairs.slice(1))
    assert.deepEqual(
      pair.comparison.phases,
      reference,
      `Rendered output changed in pair ${pair.pair}`,
    );
  report.status = 'passed';
} catch (error) {
  recordFailure(error);
  await saveReport().catch(() => {});
} finally {
  if (browser) {
    try {
      report.browserClose = await closeRecoveryBrowser(browser, {
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      report.cleanup.browserClosed = report.browserClose.closeCompleted;
      assert.equal(
        report.cleanup.browserClosed,
        true,
        'Browser close was not confirmed',
      );
    } catch (error) {
      recordFailure(error);
    }
  }
  const serverResults = await Promise.all(
    servers.map(async (server) => {
      try {
        const result = await stopServer(server);
        report.cleanup.serverStopResults.push(result);
        return result.confirmed === true;
      } catch (error) {
        recordFailure(error);
        report.cleanup.serverStopResults.push({
          attempted: false,
          confirmed: false,
          reason: String(error?.message || error).slice(0, 160),
        });
        return false;
      }
    }),
  );
  report.cleanup.serversStopped = serverResults.every(Boolean);
  if (!report.cleanup.serversStopped)
    recordFailure(new Error('A Vite server process tree did not stop cleanly'));
  for (const item of [...staged].reverse()) {
    if (item.created) {
      try {
        await rm(item.path, { force: true });
      } catch (error) {
        recordFailure(error);
      }
    }
  }
  report.cleanup.temporaryFixturesRemoved = staged.every(
    (item) => !item.created || !existsSync(item.path),
  );
  try {
    let unchanged = true;
    for (const [side, root] of Object.entries(roots)) {
      const source = report.sources[side];
      unchanged &&= Boolean(
        source &&
        git(root, ['status', '--porcelain']) === '' &&
        git(root, ['rev-parse', 'HEAD']) === source.commit &&
        hash(await readFile(resolve(root, 'package-lock.json'))) ===
          source.packageLockSha256 &&
        hash(
          await readFile(resolve(root, 'node_modules/cesium/package.json')),
        ) === source.cesiumPackageJsonSha256 &&
        hash(
          await readFile(
            resolve(root, 'node_modules/@cesium/engine/package.json'),
          ),
        ) === source.enginePackageJsonSha256 &&
        hash(
          await readFile(
            resolve(root, 'node_modules/@cesium/widgets/package.json'),
          ),
        ) === source.widgetsPackageJsonSha256,
      );
      for (const name of CESIUM_RUNTIME_FILES)
        unchanged &&= Boolean(
          hash(await readFile(resolve(root, 'node_modules', name))) ===
          source?.cesiumRuntimeFiles?.[name],
        );
      for (const name of CESIUM_SOURCE_DIRS) {
        const current = await hashSourceDirectory(
          root,
          resolve(root, 'node_modules', name),
        );
        unchanged &&= Boolean(
          current.sha256 === source?.cesiumSourceTrees?.[name]?.sha256 &&
          current.fileCount === source?.cesiumSourceTrees?.[name]?.fileCount,
        );
      }
    }
    report.cleanup.sourceTreesUnchanged = unchanged;
    assert.equal(report.cleanup.sourceTreesUnchanged, true);
  } catch (error) {
    recordFailure(error);
  }
  report.endedAt = new Date().toISOString();
  if (
    report.status === 'passed' &&
    (!report.cleanup.browserClosed ||
      !report.cleanup.pagesClosed ||
      report.cleanup.pageCloseResults.length !== 10 ||
      !report.cleanup.serversStopped ||
      !report.cleanup.temporaryFixturesRemoved ||
      !report.cleanup.sourceTreesUnchanged)
  )
    recordFailure(new Error('Traffic evidence cleanup was incomplete'));
  await saveReport().catch((error) => recordFailure(error));
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    status: report.status,
    reportPath,
    pairs: report.pairs.length,
    idleFrames: report.pairs.map((pair) => ({
      pair: pair.pair,
      baseline: pair.runs.baseline.phases[0].frames,
      candidate: pair.runs.candidate.phases[0].frames,
    })),
    cleanup: report.cleanup,
  }),
);
