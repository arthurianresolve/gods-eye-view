import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import {
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';

// This companion to the Node comparison is for a disposable hosted checkout.
// Local interactive Chrome remains controlled through the extension.
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Run this browser gate on a hosted CI runner.',
);
const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
assert.ok(
  baselinePath && candidatePath && outputPath,
  'Usage: overlayVisualComparison.mjs BASELINE CANDIDATE OUTPUT_DIRECTORY',
);
const roots = {
  baseline: resolve(baselinePath),
  candidate: resolve(candidatePath),
};
const expectedCommits = {
  baseline: process.env.BASELINE_SHA,
  candidate: process.env.CANDIDATE_SHA,
};
for (const value of Object.values(expectedCommits))
  assert.match(
    value || '',
    /^[a-f0-9]{40}$/,
    'Provide immutable BASELINE_SHA and CANDIDATE_SHA',
  );
assert.notEqual(roots.baseline, roots.candidate);
const output = resolve(outputPath);
assert.equal(existsSync(output), false, 'Refusing to overwrite prior evidence');
const here = dirname(fileURLToPath(import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = ['overlay-visual.html', 'overlay-visual.mjs'];
const expectedCases = [
  'ui-occluder-before-move',
  'stable-0',
  'stable-1',
  'stable-2',
  'deterministic-fade-enter-start',
  'deterministic-fade-enter-mid',
  'deterministic-fade-enter-complete',
  'deterministic-fade-exit-start',
  'deterministic-fade-exit-complete',
  'moving-1',
  'moving-2',
  'periodic-update',
  'periodic-hold',
  'camera-view-translation',
  'camera-projection-scale',
  'camera-position-altitude',
  'replacement-style-selection',
  'presentation-callback-change',
  'source-hidden',
  'source-restored',
  'dpr-only-change',
  'css-resize-only',
  'ui-occluder-observed',
  'ui-occlusion-pick-accessibility',
];
const fixtures = new Map(
  files.map((name) => [name, readFileSync(resolve(here, '../fixtures', name))]),
);
const report = {
  schema: 'gev-overlay-visual-comparison/v1',
  status: 'running',
  capturedAt: new Date().toISOString(),
  scope:
    'Browser Canvas2D component pixels, picking and accessible actions with deterministic mock Cesium viewer; no GPU, whole-scene or performance acceptance.',
  harnessCommit: git(here, ['rev-parse', 'HEAD']),
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  fixtures: Object.fromEntries(
    [...fixtures].map(([name, bytes]) => [name, hash(bytes)]),
  ),
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
  },
  sources: {},
  pairs: [],
  cleanup: {
    browserClosed: false,
    serversClosed: false,
    fixturesRemoved: false,
    unchangedSources: false,
  },
};
for (const [side, root] of Object.entries(roots)) {
  assert.equal(
    git(root, ['status', '--porcelain']),
    '',
    `Dirty ${side} source tree`,
  );
  report.sources[side] = {
    commit: git(root, ['rev-parse', 'HEAD']),
    lockfileSha256: hash(readFileSync(resolve(root, 'package-lock.json'))),
    overlaySha256: hash(
      readFileSync(resolve(root, 'src/overlays/worldOverlay.js')),
    ),
  };
  assert.equal(
    report.sources[side].commit,
    expectedCommits[side],
    `Wrong ${side} commit`,
  );
  for (const name of files)
    assert.equal(
      existsSync(resolve(root, 'scripts/fixtures', name)),
      false,
      `Fixture path already exists in ${side}: ${name}`,
    );
}
assert.equal(
  report.sources.baseline.lockfileSha256,
  report.sources.candidate.lockfileSha256,
  'Lockfiles must match',
);
mkdirSync(output, { recursive: true });
const save = () =>
  writeFileSync(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
const copied = [];
const servers = new Map();
let browser;
let failure;
function rememberFailure(error) {
  failure ||= error;
  report.status = 'failed';
  (report.errors ||= []).push(String(error.stack || error));
  save();
}
function stripImages(result, label) {
  for (let index = 0; index < result.cases.length; index++) {
    const row = result.cases[index];
    assert.match(
      row.imagePng,
      /^data:image\/png;base64,/,
      `Missing image for ${row.name}`,
    );
    const bytes = Buffer.from(
      row.imagePng.slice('data:image/png;base64,'.length),
      'base64',
    );
    assert.ok(
      bytes.length > 32 && bytes.length <= 4 * 1024 * 1024,
      'Unexpected image size',
    );
    const artifact = `${label}-${String(index).padStart(2, '0')}.png`;
    writeFileSync(resolve(output, artifact), bytes, { flag: 'wx' });
    delete row.imagePng;
    row.imageArtifact = { path: artifact, sha256: hash(bytes) };
  }
}
function comparable(result) {
  // Paths vary between captures. Pixels, input states, identities, populations,
  // hit regions and accessible actions must match exactly; no visual masks.
  return {
    schema: result.schema,
    status: result.status,
    runtime: result.runtime,
    fixture: result.fixture,
    cases: result.cases.map(({ imageArtifact, ...row }) => row),
    final: result.final,
  };
}
try {
  for (const [side, root] of Object.entries(roots)) {
    for (const [name, bytes] of fixtures) {
      const path = resolve(root, 'scripts/fixtures', name);
      writeFileSync(path, bytes, { flag: 'wx' });
      copied.push(path);
    }
    const server = await createServer({
      root,
      configFile: resolve(root, 'vite.config.js'),
      server: { host: '127.0.0.1', port: 0, hmr: false },
      logLevel: 'warn',
      clearScreen: false,
    });
    servers.set(side, server);
    await server.listen();
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  report.environment.browserVersion = await browser.version();
  report.environment.launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
  for (let run = 0; run < 5; run++) {
    const pair = {
      run,
      order: run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
    };
    report.pairs.push(pair);
    for (const side of pair.order) {
      const page = await browser.newPage();
      const address = servers.get(side).httpServer.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const pageErrors = [];
      const forbiddenRequests = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.setViewport(report.environment.viewport);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol))
          void request.continue();
        else {
          forbiddenRequests.push(request.url());
          void request.abort();
        }
      });
      try {
        const response = await page.goto(
          `${origin}/scripts/fixtures/overlay-visual.html`,
          { waitUntil: 'networkidle0', timeout: 60_000 },
        );
        assert.equal(response.status(), 200);
        await page.waitForFunction(
          () =>
            ['passed', 'failed'].includes(
              window.__s52VisualStageResult?.status,
            ),
          { timeout: 60_000, polling: 100 },
        );
        const result = await page.evaluate(() =>
          JSON.parse(JSON.stringify(window.__s52VisualStageResult)),
        );
        pair[side] = { result, pageErrors, forbiddenRequests };
        save();
        // Keep failure evidence even when a case aborts the fixture.
        stripImages(result, `${run}-${side}`);
        save();
        assert.equal(
          result.status,
          'passed',
          result.error || `${side} fixture did not pass`,
        );
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(forbiddenRequests, []);
        assert.deepEqual(
          result.cases.map((row) => row.name),
          expectedCases,
          'Incomplete or reordered case matrix',
        );
        assert.ok(
          result.runtime.userAgent.includes(
            report.environment.browserVersion.split('/')[1],
          ),
          'Runtime browser identity differs',
        );
        assert.equal(
          result.runtime.cesiumVersion,
          JSON.parse(
            readFileSync(
              resolve(roots[side], 'node_modules/cesium/package.json'),
            ),
          ).version,
        );
      } finally {
        const closed = await closeOwnedRecoveryPage(page, browser);
        assert.equal(
          closed.closeCompleted,
          true,
          'Fixture page close did not complete',
        );
      }
    }
    assert.deepEqual(
      comparable(pair.candidate.result),
      comparable(pair.baseline.result),
      `Visual/interaction mismatch in pair ${run}`,
    );
    if (run > 0) {
      assert.deepEqual(
        comparable(pair.baseline.result),
        comparable(report.pairs[0].baseline.result),
        `Unstable baseline in pair ${run}`,
      );
      assert.deepEqual(
        comparable(pair.candidate.result),
        comparable(report.pairs[0].candidate.result),
        `Unstable candidate in pair ${run}`,
      );
    }
    pair.equal = true;
    save();
    console.log(
      JSON.stringify({
        run,
        equal: true,
        cases: pair.baseline.result.cases.length,
      }),
    );
  }
} catch (error) {
  rememberFailure(error);
} finally {
  if (browser) {
    try {
      report.browserClose = await closeRecoveryBrowser(browser, {
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      assert.equal(
        report.browserClose.closeCompleted,
        true,
        'Graceful browser close failed',
      );
      assert.equal(report.browserClose.forcedProcessTermination, false);
      report.cleanup.browserClosed = true;
    } catch (error) {
      rememberFailure(error);
    }
  }
  const closed = await Promise.allSettled(
    [...servers.values()].map((server) => server.close()),
  );
  report.cleanup.serversClosed = closed.every(
    (result) => result.status === 'fulfilled',
  );
  for (const result of closed)
    if (result.status === 'rejected') rememberFailure(result.reason);
  try {
    for (const path of copied) unlinkSync(path);
    report.cleanup.fixturesRemoved = true;
    for (const [side, root] of Object.entries(roots)) {
      assert.equal(
        git(root, ['status', '--porcelain']),
        '',
        `Source tree changed: ${side}`,
      );
      assert.equal(
        git(root, ['rev-parse', 'HEAD']),
        report.sources[side].commit,
      );
      assert.equal(
        hash(readFileSync(resolve(root, 'package-lock.json'))),
        report.sources[side].lockfileSha256,
      );
      assert.equal(
        hash(readFileSync(resolve(root, 'src/overlays/worldOverlay.js'))),
        report.sources[side].overlaySha256,
      );
    }
    report.cleanup.unchangedSources = true;
  } catch (error) {
    rememberFailure(error);
  }
}
if (!failure) {
  assert.ok(Object.values(report.cleanup).every(Boolean), 'Incomplete cleanup');
  report.status = 'passed';
}
save();
console.log(JSON.stringify(report));
if (failure) process.exitCode = 1;
