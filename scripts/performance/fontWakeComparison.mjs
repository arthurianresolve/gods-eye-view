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
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Run this browser check on hosted CI.',
);
const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
assert.ok(
  baselinePath && candidatePath && outputPath,
  'Usage: fontWakeComparison.mjs BASELINE CANDIDATE OUTPUT_DIRECTORY',
);
const roots = {
  baseline: resolve(baselinePath),
  candidate: resolve(candidatePath),
};
const expectedCommits = {
  baseline: process.env.BASELINE_SHA,
  candidate: process.env.CANDIDATE_SHA,
};
for (const commit of Object.values(expectedCommits))
  assert.match(
    commit || '',
    /^[a-f0-9]{40}$/,
    'Set immutable baseline and candidate SHAs.',
  );
assert.notEqual(roots.baseline, roots.candidate);

const repoRoot = resolve(process.cwd());
const output = resolve(outputPath);
assert.equal(
  existsSync(output),
  false,
  'Refusing to overwrite previous evidence.',
);
const fixtures = new Map(
  ['font-wake.html', 'font-wake.mjs', 'font-wake.ttf', 'OFL.txt'].map(
    (name) => [name, readFileSync(resolve(repoRoot, 'scripts/fixtures', name))],
  ),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceFiles = [
  'src/overlays/worldOverlay.js',
  'src/overlays/worldOverlayDraw.js',
  'src/overlays/worldOverlayTokens.js',
];
const launchArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader-webgl',
  '--enable-unsafe-swiftshader',
];
const report = {
  schema: 'gev-s52-font-wake-comparison/v1',
  status: 'running',
  capturedAt: new Date().toISOString(),
  scope:
    'Two-pair hosted correctness comparison of real FontFaceSet events and Cesium request-render wake; software WebGL scene, no performance claim.',
  harness: {
    commit: git(repoRoot, ['rev-parse', 'HEAD']),
    sha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    files: ['scripts/performance/fontWakeComparison.mjs'],
  },
  fixtures: Object.fromEntries(
    [...fixtures].map(([name, bytes]) => [name, hash(bytes)]),
  ),
  font: {
    familyAlias: 'JetBrains Mono',
    bytesSha256:
      'd7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134',
    licenseSha256:
      '061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41',
  },
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
    launchArgs,
  },
  sources: {},
  fixtureOwnership: {},
  pairs: [],
  cleanup: {
    browserClosed: false,
    pagesClosed: false,
    sessionsDetached: false,
    serversClosed: false,
    fixtureFilesRemoved: false,
    sourceTreesUnchanged: false,
  },
};
assert.equal(
  report.fixtures['font-wake.ttf'],
  report.font.bytesSha256,
  'The staged font asset differs from the pinned font bytes.',
);
assert.equal(
  report.fixtures['OFL.txt'],
  report.font.licenseSha256,
  'The staged font license differs from the recorded license bytes.',
);

for (const [side, root] of Object.entries(roots)) {
  assert.equal(
    git(root, ['status', '--porcelain']),
    '',
    `Dirty ${side} source tree.`,
  );
  const commit = git(root, ['rev-parse', 'HEAD']);
  assert.equal(commit, expectedCommits[side], `Wrong ${side} commit.`);
  report.fixtureOwnership[side] = {};
  for (const [name, bytes] of fixtures) {
    const path = resolve(root, 'scripts/fixtures', name);
    const present = existsSync(path);
    if (present)
      assert.deepEqual(
        readFileSync(path),
        bytes,
        `Existing fixture differs from the harness in ${side}: ${name}`,
      );
    report.fixtureOwnership[side][name] = present ? 'existing' : 'temporary';
  }
  const files = Object.fromEntries(
    sourceFiles.map((name) => [name, hash(readFileSync(resolve(root, name)))]),
  );
  report.sources[side] = {
    commit,
    files,
    packageLockSha256: hash(readFileSync(resolve(root, 'package-lock.json'))),
    cesiumVersion: JSON.parse(
      readFileSync(resolve(root, 'node_modules/cesium/package.json'), 'utf8'),
    ).version,
  };
}
assert.equal(
  report.sources.baseline.packageLockSha256,
  report.sources.candidate.packageLockSha256,
  'Dependency lockfiles differ.',
);
assert.equal(
  report.sources.baseline.cesiumVersion,
  report.sources.candidate.cesiumVersion,
  'Cesium versions differ.',
);
for (const name of ['src/overlays/worldOverlayTokens.js'])
  assert.equal(
    report.sources.baseline.files[name],
    report.sources.candidate.files[name],
    `${name} must be identical across the font-wake comparison.`,
  );
for (const name of [
  'src/overlays/worldOverlay.js',
  'src/overlays/worldOverlayDraw.js',
])
  assert.notEqual(
    report.sources.baseline.files[name],
    report.sources.candidate.files[name],
    `${name} should contain the font-wake candidate change.`,
  );

mkdirSync(dirname(output), { recursive: true });
mkdirSync(output, { recursive: false });
const save = () =>
  writeFileSync(
    resolve(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
const copied = [];
const sessions = [];
const servers = new Map();
const pageCleanups = [];
let browser;
let failure;
function rememberFailure(error) {
  failure ||= error;
  report.status = 'failed';
  (report.errors ||= []).push(String(error?.stack || error).slice(0, 6000));
  save();
}
async function closeWithTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation).then(
        () => true,
        () => false,
      ),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summarize(result) {
  return {
    status: result.status,
    failures: result.failures,
    idle: {
      frameCount: result.idle?.frameCount,
      requestRenderCalls: result.idle?.requestRenderCalls,
    },
    primary: {
      woke:
        result.primary?.requestRenderDelta > 0 &&
        result.primary?.frameDelta > 0,
      solved:
        result.primary?.solveRevisionAfter >
        result.primary?.solveRevisionBefore,
      rectWidthBefore: result.primary?.rectBefore?.w,
      rectWidthAfter: result.primary?.rectAfter?.w,
      fallbackTextWidth: result.primary?.fallbackTextWidth,
      loadedTextWidth: result.primary?.loadedTextWidth,
      initialPixelSha256: result.primary?.initialCanvas?.pixelSha256,
      afterPixelSha256: result.primary?.afterCanvas?.pixelSha256,
      hitIdentity: result.primary?.hitIdentity,
    },
    replacement: {
      oldHostRequestDelta: result.replacement?.oldHostRequestDelta,
      oldHostFrameDelta: result.replacement?.oldHostFrameDelta,
      replacementWoke:
        result.replacement?.replacementRequestDelta > 0 &&
        result.replacement?.replacementFrameDelta > 0,
      overlayStillOwnedByReplacement:
        result.replacement?.overlayStillOwnedByReplacement,
    },
    environment: {
      cesiumVersion: result.environment?.cesiumVersion,
      renderer: result.environment?.renderer,
      dpr: result.environment?.devicePixelRatio,
      viewport: result.environment?.viewport,
    },
  };
}

function assertSideResult(side, result, expectedCommit) {
  assert.equal(
    result.applicationCommit,
    expectedCommit,
    `${side} served wrong source identity.`,
  );
  assert.equal(
    result.environment?.backgrounded,
    false,
    `${side} page was backgrounded.`,
  );
  assert.equal(
    result.environment?.viewportChanged,
    false,
    `${side} viewport changed.`,
  );
  assert.equal(
    result.idle?.frameCount,
    0,
    `${side} idle control rendered frames.`,
  );
  assert.equal(
    result.idle?.requestRenderCalls,
    0,
    `${side} idle control requested frames.`,
  );
  assert.ok(
    result.idle?.observedMs >= 790,
    `${side} idle control was shortened.`,
  );
  assert.ok(
    result.environment?.renderer,
    `${side} renderer identity is missing.`,
  );
  assert.equal(
    result.environment?.cesiumVersion,
    report.sources[side].cesiumVersion,
    `${side} runtime Cesium version mismatch.`,
  );
  assert.equal(
    result.font?.asset?.sha256,
    report.font.bytesSha256,
    `${side} runtime did not load the pinned font bytes.`,
  );

  if (side === 'baseline') {
    assert.equal(
      result.status,
      'failed',
      'Baseline should preserve the missing-wake failure.',
    );
    assert.deepEqual(
      result.failures,
      [
        'idle-font-load-recomputes-layout-and-hit-bounds',
        'font-event-wakes-current-host-only',
      ],
      'Baseline failed outside the expected missing-wake controls.',
    );
    assert.equal(result.primary?.requestRenderDelta, 0);
    assert.equal(result.primary?.frameDelta, 0);
    assert.notEqual(
      result.primary?.fallbackTextWidth,
      result.primary?.loadedTextWidth,
      'Baseline must load a font that changes actual text metrics.',
    );
    assert.equal(
      result.primary?.solveRevisionAfter,
      result.primary?.solveRevisionBefore,
    );
    assert.equal(result.primary?.rectAfter?.w, result.primary?.rectBefore?.w);
    assert.equal(
      result.primary?.initialCanvas?.pixelSha256,
      result.primary?.afterCanvas?.pixelSha256,
    );
    assert.equal(result.replacement?.oldHostRequestDelta, 0);
    assert.equal(result.replacement?.replacementRequestDelta, 0);
    return;
  }

  assert.equal(
    result.status,
    'passed',
    result.error || 'Candidate font-wake checks failed.',
  );
  assert.deepEqual(result.failures, []);
  assert.ok(result.primary?.requestRenderDelta > 0);
  assert.ok(result.primary?.frameDelta > 0);
  assert.ok(
    result.primary?.solveRevisionAfter > result.primary?.solveRevisionBefore,
  );
  assert.notEqual(result.primary?.rectAfter?.w, result.primary?.rectBefore?.w);
  assert.notEqual(
    result.primary?.fallbackTextWidth,
    result.primary?.loadedTextWidth,
  );
  assert.notEqual(
    result.primary?.initialCanvas?.pixelSha256,
    result.primary?.afterCanvas?.pixelSha256,
  );
  assert.deepEqual(result.primary?.hitIdentity, {
    sourceId: 's52-font-wake-fixture',
    entryId: 'font-measurement',
  });
  assert.equal(result.replacement?.oldHostRequestDelta, 0);
  assert.equal(result.replacement?.oldHostFrameDelta, 0);
  assert.ok(result.replacement?.replacementRequestDelta > 0);
  assert.ok(result.replacement?.replacementFrameDelta > 0);
  assert.equal(result.replacement?.overlayStillOwnedByReplacement, true);
}

try {
  save();
  for (const [side, root] of Object.entries(roots)) {
    for (const [name, bytes] of fixtures) {
      const path = resolve(root, 'scripts/fixtures', name);
      if (report.fixtureOwnership[side][name] === 'existing') continue;
      writeFileSync(path, bytes, { flag: 'wx' });
      copied.push(path);
    }
    const server = await createServer({
      root,
      configFile: resolve(root, 'vite.config.js'),
      define: { __GEV_APP_COMMIT__: JSON.stringify(expectedCommits[side]) },
      server: {
        host: '127.0.0.1',
        port: 0,
        hmr: false,
      },
      logLevel: 'warn',
      clearScreen: false,
    });
    servers.set(side, server);
    await server.listen();
  }

  browser = await puppeteer.launch({
    headless: true,
    timeout: 30_000,
    args: launchArgs,
  });
  report.environment.browserVersion = await browser.version();
  report.environment.browserArgs = launchArgs;

  for (let index = 0; index < 2; index++) {
    const order =
      index === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const pair = { index, order, runs: {} };
    report.pairs.push(pair);
    save();
    for (const side of order) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const origin = `http://127.0.0.1:${servers.get(side).httpServer.address().port}`;
      const run = {
        side,
        pageErrors: [],
        externalRequests: [],
        interceptionErrors: [],
        result: null,
        partial: null,
        cleanup: null,
      };
      pair.runs[side] = run;
      let session = null;
      const sessionOwnership = { side, detached: false };
      sessions.push(sessionOwnership);
      page.on('pageerror', (error) => {
        if (run.pageErrors.length < 20)
          run.pageErrors.push(String(error.message).slice(0, 500));
      });
      try {
        await page.setViewport(report.environment.viewport);
        await page.setCacheEnabled(false);
        session = await page.createCDPSession();
        sessionOwnership.session = session;
        const { interceptFixtureSession } = await import(
          pathToFileURL(
            resolve(repoRoot, 'scripts/performance/fixtureInterception.mjs'),
          ).href
        );
        await interceptFixtureSession(
          session,
          origin,
          (url) => {
            if (
              ['http:', 'https:'].includes(url.protocol) &&
              url.origin !== origin &&
              run.externalRequests.length < 20
            )
              run.externalRequests.push(url.origin);
            return null;
          },
          (error) => {
            if (run.interceptionErrors.length < 20)
              run.interceptionErrors.push(String(error.message).slice(0, 500));
          },
        );
        const response = await page.goto(
          `${origin}/scripts/fixtures/font-wake.html`,
          {
            waitUntil: 'networkidle0',
            timeout: 45_000,
          },
        );
        assert.equal(
          response?.status(),
          200,
          `${side} fixture failed to load.`,
        );
        await page.click('#run');
        const deadline = Date.now() + 45_000;
        for (;;) {
          const text = await page.$eval('#result', (node) => node.textContent);
          if (text) {
            run.result = JSON.parse(text);
            break;
          }
          if (Date.now() >= deadline) {
            run.partial = await page.evaluate(() =>
              window.__s52FontWakeResult
                ? JSON.parse(JSON.stringify(window.__s52FontWakeResult))
                : null,
            );
            throw new Error(
              `${side} font-wake fixture exceeded the 45-second host deadline.`,
            );
          }
          await new Promise((resolvePoll) => setTimeout(resolvePoll, 50));
        }
        assert.deepEqual(run.pageErrors, [], `${side} browser page errors.`);
        assert.deepEqual(
          run.externalRequests,
          [],
          `${side} made external requests.`,
        );
        assert.deepEqual(
          run.interceptionErrors,
          [],
          `${side} request interception errors.`,
        );
        assertSideResult(side, run.result, expectedCommits[side]);
        run.summary = summarize(run.result);
        save();
      } finally {
        if (session) {
          sessionOwnership.detached = await closeWithTimeout(
            session.detach(),
            2000,
          );
          if (!sessionOwnership.detached)
            rememberFailure(
              new Error(`${side} CDP session did not detach cleanly.`),
            );
        } else {
          sessionOwnership.detached = true;
        }
        try {
          const ownership = await import(
            pathToFileURL(
              resolve(
                repoRoot,
                'scripts/performance/profileRecoveryPageOwnership.mjs',
              ),
            ).href
          );
          run.cleanup = await ownership.closeOwnedRecoveryPage(
            page,
            context,
            2000,
          );
          if (!run.cleanup.closeCompleted || run.cleanup.openPageCount !== 0)
            rememberFailure(
              new Error(`${side} owned page did not close cleanly.`),
            );
        } catch (error) {
          run.cleanup = { closeCompleted: false, openPageCount: null };
          rememberFailure(error);
        }
        const contextClosed = await closeWithTimeout(context.close(), 2000);
        if (!contextClosed)
          rememberFailure(new Error(`${side} browser context did not close.`));
        pageCleanups.push({
          side,
          closeCompleted: run.cleanup?.closeCompleted === true,
          contextClosed,
        });
        save();
      }
    }

    const baseline = pair.runs.baseline.result;
    const candidate = pair.runs.candidate.result;
    assert.equal(
      baseline?.primary?.initialCanvas?.pixelSha256,
      candidate?.primary?.initialCanvas?.pixelSha256,
      `Initial fallback pixels differ in pair ${index}.`,
    );
    assert.deepEqual(
      summarize(baseline).environment,
      summarize(candidate).environment,
      `Browser/viewport context differs in pair ${index}.`,
    );
    pair.equalInitialPixels = true;
    save();
  }

  assert.deepEqual(
    summarize(report.pairs[0].runs.baseline.result),
    summarize(report.pairs[1].runs.baseline.result),
    'Baseline outcome is unstable across alternating pairs.',
  );
  assert.deepEqual(
    summarize(report.pairs[0].runs.candidate.result),
    summarize(report.pairs[1].runs.candidate.result),
    'Candidate outcome is unstable across alternating pairs.',
  );
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  (report.errors ||= []).push(String(error?.stack || error).slice(0, 8000));
  save();
} finally {
  if (browser) {
    try {
      const ownership = await import(
        pathToFileURL(
          resolve(
            repoRoot,
            'scripts/performance/profileRecoveryPageOwnership.mjs',
          ),
        ).href
      );
      report.browserClose = await ownership.closeRecoveryBrowser(browser, {
        timeoutMs: 5000,
        forceProcess: () =>
          ownership.stopOwnedRecoveryProcessTree(browser.process()),
      });
      assert.equal(
        report.browserClose.closeCompleted,
        true,
        'Browser close did not complete.',
      );
      assert.equal(
        report.browserClose.forcedProcessTermination,
        false,
        'Browser required forced termination.',
      );
      report.cleanup.browserClosed = true;
    } catch (error) {
      failure ||= error;
      report.status = 'failed';
      (report.errors ||= []).push(String(error?.stack || error).slice(0, 4000));
    }
  }
  report.cleanup.pagesClosed = pageCleanups.every(
    (page) => page.closeCompleted,
  );
  report.cleanup.sessionsDetached = sessions.every((entry) => entry.detached);
  const serverResults = await Promise.all(
    [...servers.entries()].map(async ([side, server]) => {
      const closed = await closeWithTimeout(server.close(), 3000);
      if (!closed)
        rememberFailure(new Error(`${side} Vite server did not close.`));
      return closed;
    }),
  );
  report.cleanup.serversClosed = serverResults.every(Boolean);
  for (const path of copied) {
    try {
      unlinkSync(path);
    } catch (error) {
      failure ||= error;
      report.status = 'failed';
      (report.errors ||= []).push(
        `Fixture cleanup failed: ${String(error.message).slice(0, 500)}`,
      );
    }
  }
  report.cleanup.fixtureFilesRemoved = copied.every(
    (path) => !existsSync(path),
  );
  try {
    for (const [side, root] of Object.entries(roots)) {
      assert.equal(
        git(root, ['status', '--porcelain']),
        '',
        `${side} source tree changed.`,
      );
      assert.equal(
        git(root, ['rev-parse', 'HEAD']),
        report.sources[side].commit,
      );
      for (const name of sourceFiles)
        assert.equal(
          hash(readFileSync(resolve(root, name))),
          report.sources[side].files[name],
          `${side} source changed during comparison: ${name}`,
        );
      for (const [name, bytes] of fixtures) {
        if (report.fixtureOwnership[side][name] !== 'existing') continue;
        assert.deepEqual(
          readFileSync(resolve(root, 'scripts/fixtures', name)),
          bytes,
          `${side} pre-existing fixture changed during comparison: ${name}`,
        );
      }
    }
    report.cleanup.sourceTreesUnchanged = true;
  } catch (error) {
    failure ||= error;
    report.status = 'failed';
    (report.errors ||= []).push(String(error?.stack || error).slice(0, 4000));
  }
}

report.finishedAt = new Date().toISOString();
if (!failure) {
  assert.ok(
    Object.values(report.cleanup).every(Boolean),
    'Incomplete comparison cleanup.',
  );
  report.status = 'passed';
}
save();
console.log(
  JSON.stringify({
    schema: report.schema,
    status: report.status,
    reportPath: resolve(output, 'report.json'),
    baseline: expectedCommits.baseline,
    candidate: expectedCommits.candidate,
    pairs: report.pairs.length,
    cleanup: report.cleanup,
  }),
);
if (failure) process.exitCode = 1;
