#!/usr/bin/env node
/** Real prior checkout -> interrupted installer -> rollback -> upgrade, one Chrome profile. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  stat,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageRelease, verifyReleaseDirectory } from './stage-release.mjs';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  readFixturePageDiagnostics,
  seedPersistentWorkspace,
  assertPersistentWorkspace,
} from './qa-application-fixtures.mjs';
import {
  captureBoundedDomState,
  createStartupDiagnostics,
} from './performance/startupDiagnostics.mjs';
import {
  assertInitialRecoveryPage,
  assertOwnedRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  createRecoveryPageTargetGuard,
  countRecoveryApplicationPages,
  recoveryPageCleanupError,
} from './performance/profileRecoveryPageOwnership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const priorCommit = '6b896e2a8277fba12bc9577ad7772005a71e13c7';
// Recovery checks storage/update behavior on GPU-less runners, not performance.
// Bound software raster work without changing resolution scale, effects or data.
// Other browser/performance fixtures retain their declared viewports.
const viewport = { width: 960, height: 640 };
const value = (key, fallback) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? fallback : process.argv[index + 1];
};
const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
const sourceStatus = () =>
  execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
const sourceDirtyAtStart = Boolean(sourceStatus());
// Windows can expose the same temporary directory through an 8.3 short name
// in one process and its long name in another. Vite/Rollup treats those as
// different roots and may then emit an absolute path for index.html. Resolve
// the freshly-created directory once so every child process uses one spelling.
const scratch = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'gev-profile-recovery-')),
);
const installation = path.join(scratch, 'installation');
const out = path.resolve(value('--out', 'qa-artifacts/profile-recovery.json'));
await mkdir(path.dirname(out), { recursive: true });
let sequence = 0;

async function stopTree(child) {
  if (child.exitCode != null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) =>
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).once('exit', resolve),
    );
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
}

function chromeProcessCount() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 2500, maxBuffer: 8192, windowsHide: true },
    );
    return output
      .split(/\r?\n/)
      .filter((line) => /^"chrome\.exe"/i.test(line.trim())).length;
  } catch {
    return null;
  }
}

async function collectRecoveryDiagnostics(page, browser, diagnostics) {
  const domState = await captureBoundedDomState(page, 5000);
  let targetInventory = [];
  try {
    targetInventory = diagnostics.recordTargets(browser.targets());
  } catch {
    // The browser may already be closing after a renderer failure.
  }
  return diagnostics.snapshot({
    domState,
    targetInventory,
    chromeProcessCount: chromeProcessCount(),
    browserProcessId: browser.process()?.pid ?? null,
  });
}

async function command(
  cwd,
  executable,
  args,
  { interruptInstall = false } = {},
) {
  const logPath = out + '.' + ++sequence + '.log';
  console.log(
    JSON.stringify({
      phase: 'command',
      executable: path.basename(executable),
      args,
      log: logPath,
    }),
  );
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    interrupted = false,
    checking = false;
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  const poll = interruptInstall
    ? setInterval(async () => {
        if (checking || interrupted) return;
        checking = true;
        // The real installer removes this marker immediately before spawning npm ci.
        const ready = await stat(path.join(cwd, 'pinokio', '.installed')).catch(
          () => null,
        );
        if (!ready) {
          interrupted = true;
          await stopTree(child);
        }
        checking = false;
      }, 25)
    : null;
  const timeout = setTimeout(() => void stopTree(child), 12 * 60_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearInterval(poll);
    clearTimeout(timeout);
    await writeFile(logPath, output);
  }
  if (interruptInstall)
    assert.ok(interrupted, 'real dependency installer was not interrupted');
  else assert.equal(code, 0, executable + ' failed: ' + output.slice(-4000));
  return { log: path.basename(logPath), interrupted };
}
const git = (args) => command(installation, 'git', args);
const install = () =>
  command(installation, process.execPath, ['scripts/pinokio-install.mjs']);
const build = () =>
  command(installation, process.execPath, [
    'node_modules/vite/bin/vite.js',
    'build',
  ]);
let serving = null;
const server = createServer(async (request, response) => {
  const relative =
    decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    ).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(serving, relative);
  if (!file.startsWith(serving + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.wasm': 'application/wasm',
    };
    response
      .writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let expected, browser, browserVersion;
const checks = [];
let activeCheck = 'setup',
  activeStep = 'setup',
  failure = null;
const progress = (step) => {
  activeStep = step;
  console.log(
    JSON.stringify({ phase: 'browser-recovery', check: activeCheck, step }),
  );
};
async function reopen(label, { seed = false } = {}) {
  activeCheck = label;
  const bootStartedAt = Date.now();
  const progressTimeline = [];
  const timedProgress = (step) => {
    progressTimeline.push({ step, elapsedMs: Date.now() - bootStartedAt });
    progress(step);
  };
  timedProgress('launch');
  browser = await launchFixtureBrowser({
    userDataDir: path.join(scratch, 'browser-profile'),
  });
  const pageTargetGuard = createRecoveryPageTargetGuard(browser);
  const diagnosticMode = process.env.GEV_PROFILE_RECOVERY_DIAGNOSTICS === '1';
  const diagnostics = diagnosticMode ? createStartupDiagnostics(base) : null;
  const browserProcess = browser.process();
  const stderrListener = diagnostics
    ? (chunk) => diagnostics.recordStderr(chunk)
    : null;
  if (stderrListener) {
    diagnostics.recordInitialTargets(browser.targets());
    browserProcess?.stderr?.on('data', stderrListener);
  }
  const pageOwnership = {
    initialPageCount: null,
    appPagesBeforeNavigation: null,
    appPagesAfterBoot: null,
    appPagesAfterWorkspace: null,
    unexpectedCreatedPageTargets: null,
    closeCompleted: null,
    openPagesBeforeBrowserClose: null,
    browserCloseCompleted: null,
    forcedBrowserProcessTermination: false,
  };
  let page = null;
  let bootElapsedMs = null;
  let rendererQueryStartedAt = null;
  let rendererQueryDurationMs = null;
  try {
    browserVersion = await browser.version();
    timedProgress('install-fixtures');
    const initialPages = await browser.pages();
    pageOwnership.initialPageCount = initialPages.length;
    pageOwnership.appPagesBeforeNavigation = countRecoveryApplicationPages(
      initialPages,
      base,
    );
    page = assertInitialRecoveryPage(initialPages, base);
    pageOwnership.unexpectedCreatedPageTargets =
      pageTargetGuard.unexpectedPageTargetCount(page);
    pageTargetGuard.assertOnlyOwnedPageTarget(page);
    const prepared = await prepareFixturePage(browser, base, {
      viewport,
      startupDiagnostics: diagnostics,
      page,
    });
    page = prepared.page;
    const { errors } = prepared;
    await bootFixturePage(page, base, { onProgress: timedProgress });
    const pagesAfterBoot = await browser.pages();
    pageOwnership.unexpectedCreatedPageTargets =
      pageTargetGuard.unexpectedPageTargetCount(page);
    pageTargetGuard.assertOnlyOwnedPageTarget(page);
    pageOwnership.appPagesAfterBoot = countRecoveryApplicationPages(
      pagesAfterBoot,
      base,
    );
    pageOwnership.appPagesAfterBoot = assertOwnedRecoveryPage(
      pagesAfterBoot,
      page,
      base,
    );
    const navigationAt = progressTimeline.find(
      (entry) => entry.step === 'navigation',
    )?.elapsedMs;
    const readyAt = progressTimeline.find(
      (entry) => entry.step === 'ready',
    )?.elapsedMs;
    if (Number.isFinite(navigationAt) && Number.isFinite(readyAt))
      bootElapsedMs = readyAt - navigationAt;
    rendererQueryStartedAt = Date.now();
    timedProgress('read-renderer');
    const renderer = await page.evaluate(() => {
      const queryStartedAt = performance.now();
      const mark = (phase) =>
        console.info(
          '__GEV_RECOVERY_WEBGL__' +
            JSON.stringify({
              phase,
              elapsedMs: performance.now() - queryStartedAt,
            }),
        );
      mark('query-start');
      const canvas = window.__godsEyeView.viewer.scene.canvas;
      let gl = canvas.getContext('webgl2');
      if (!gl) mark('webgl2-unavailable');
      if (!gl) gl = canvas.getContext('webgl');
      mark(gl ? 'context-ready' : 'webgl-context-unavailable');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      mark('extension-ready');
      const renderer = gl.getParameter(
        info?.UNMASKED_RENDERER_WEBGL || gl.RENDERER,
      );
      mark('renderer-ready');
      return renderer;
    });
    rendererQueryDurationMs = Date.now() - rendererQueryStartedAt;
    timedProgress('renderer-read-complete');
    if (process.env.GEV_QA_SOFTWARE_RENDERING === '1')
      assert.match(
        renderer,
        /swiftshader/i,
        'Expected explicit fixture software renderer',
      );
    if (seed) {
      timedProgress('seed-workspace');
      expected = await seedPersistentWorkspace(page);
    }
    timedProgress('verify-persisted-workspace');
    const result = await assertPersistentWorkspace(page, expected);
    const pagesAfterWorkspace = await browser.pages();
    pageOwnership.unexpectedCreatedPageTargets =
      pageTargetGuard.unexpectedPageTargetCount(page);
    pageTargetGuard.assertOnlyOwnedPageTarget(page);
    pageOwnership.appPagesAfterWorkspace = countRecoveryApplicationPages(
      pagesAfterWorkspace,
      base,
    );
    pageOwnership.appPagesAfterWorkspace = assertOwnedRecoveryPage(
      pagesAfterWorkspace,
      page,
      base,
    );
    assert.deepEqual(errors, []);
    const startup = diagnostics
      ? {
          ...await collectRecoveryDiagnostics(page, browser, diagnostics),
          bootElapsedMs,
          rendererQueryDurationMs,
          reopenElapsedMs: Date.now() - bootStartedAt,
          progressTimeline,
          ...readFixturePageDiagnostics(page),
        }
      : null;
    checks.push({
      id: label,
      status: 'passed',
      renderer,
      ...result,
      pageOwnership,
      ...(startup ? { diagnostics: startup } : {}),
    });
  } catch (error) {
    if (diagnostics && page)
      error.recoveryDiagnostics = await collectRecoveryDiagnostics(
        page,
        browser,
        diagnostics,
      );
    if (error.recoveryDiagnostics) {
      error.recoveryDiagnostics.bootElapsedMs = bootElapsedMs;
      error.recoveryDiagnostics.rendererQueryDurationMs =
        rendererQueryDurationMs ??
        (rendererQueryStartedAt == null
          ? null
          : Date.now() - rendererQueryStartedAt);
      error.recoveryDiagnostics.reopenElapsedMs = Date.now() - bootStartedAt;
      error.recoveryDiagnostics.progressTimeline = progressTimeline;
      Object.assign(
        error.recoveryDiagnostics,
        readFixturePageDiagnostics(page),
      );
    }
    checks.push({
      id: label,
      status: 'failed',
      step: activeStep,
      error: error.message,
      pageOwnership,
      ...(error.recoveryDiagnostics
        ? { diagnostics: error.recoveryDiagnostics }
        : {}),
    });
    throw error;
  } finally {
    let cleanupError = null;
    if (page) {
      try {
        await cleanupFixturePageDiagnostics(page);
      } catch (error) {
        cleanupError = error;
      }
    }
    let pageCleanup = { closeCompleted: false, openPageCount: null };
    const check = checks.at(-1)?.id === label ? checks.at(-1) : null;
    if (browser) {
      pageCleanup = await closeOwnedRecoveryPage(page, browser);
      pageOwnership.closeCompleted = pageCleanup.closeCompleted;
      pageOwnership.openPagesBeforeBrowserClose = pageCleanup.openPageCount;
      pageOwnership.unexpectedCreatedPageTargets = page
        ? pageTargetGuard.unexpectedPageTargetCount(page)
        : null;
    }
    if (stderrListener) browserProcess?.stderr?.off('data', stderrListener);
    pageTargetGuard.dispose();
    let browserClose = {
      closeCompleted: false,
      forcedProcessTermination: false,
    };
    if (browser)
      browserClose = await closeRecoveryBrowser(browser, {
        forceProcess: () => stopTree(browser.process()),
      });
    pageOwnership.browserCloseCompleted = browserClose.closeCompleted;
    pageOwnership.forcedBrowserProcessTermination =
      browserClose.forcedProcessTermination;
    browser = null;
    const pageCleanupFailure = recoveryPageCleanupError({
      ...pageCleanup,
      unexpectedCreatedPageTargets:
        pageOwnership.unexpectedCreatedPageTargets,
      browserCloseCompleted: pageOwnership.browserCloseCompleted,
    });
    cleanupError ||= pageCleanupFailure;
    if (cleanupError) {
      if (check) {
        check.pageOwnership = pageOwnership;
        check.pageOwnership.cleanupError = cleanupError.message.slice(0, 240);
      }
      if (check?.status === 'passed') {
        check.status = 'failed';
        check.step = 'owned-page-cleanup';
        check.error = cleanupError.message;
        check.pageOwnership.cleanupError = cleanupError.message.slice(0, 240);
      }
      if (!check || check.status === 'failed' && check.step !== 'owned-page-cleanup')
        console.error(
          JSON.stringify({
            phase: 'browser-recovery-cleanup',
            check: label,
            error: cleanupError.message,
          }),
        );
      if (check?.step === 'owned-page-cleanup') throw cleanupError;
    }
    if (check?.status === 'passed') {
      timedProgress('passed');
      if (check.diagnostics)
        check.diagnostics.progressTimeline = progressTimeline;
      console.log(JSON.stringify(check));
    }
  }
}

try {
  await command(scratch, 'git', [
    'clone',
    '--quiet',
    '--no-hardlinks',
    ROOT,
    installation,
  ]);
  await git(['checkout', '--quiet', '-B', 'recovery-test', priorCommit]);
  await git([
    'update-ref',
    'refs/remotes/origin/recovery-candidate',
    candidateCommit,
  ]);
  await git(['config', 'branch.recovery-test.remote', 'origin']);
  // Fetch a fixed object, independent of branch movements during CI.
  await git(['config', 'branch.recovery-test.merge', candidateCommit]);
  await git([
    'config',
    'remote.origin.fetch',
    '+' + candidateCommit + ':refs/remotes/origin/recovery-candidate',
  ]);
  await install();
  await build();
  await stageRelease({
    root: installation,
    out: 'qa-artifacts/retained-prior',
    commit: priorCommit,
  });
  const previous = path.join(installation, 'qa-artifacts', 'retained-prior');
  assert.equal((await verifyReleaseDirectory(previous)).commit, priorCommit);
  serving = path.join(previous, 'dist');
  await reopen('prior-install-saves-browser-workspace', { seed: true });
  await command(
    installation,
    process.execPath,
    ['scripts/pinokio-update.mjs'],
    { interruptInstall: true },
  );
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: installation,
      encoding: 'utf8',
    }).trim(),
    candidateCommit,
  );
  await reopen('interrupted-update-retained-application');
  await git(['checkout', '--quiet', '-B', 'recovery-test', priorCommit]);
  await install();
  await reopen('prior-install-rollback-same-profile');
  await command(installation, process.execPath, ['scripts/pinokio-update.mjs']);
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: installation,
      encoding: 'utf8',
    }).trim(),
    candidateCommit,
  );
  await build();
  await stageRelease({
    root: installation,
    out: 'qa-artifacts/verified-candidate',
    commit: candidateCommit,
  });
  const candidate = path.join(
    installation,
    'qa-artifacts',
    'verified-candidate',
  );
  assert.equal(
    (await verifyReleaseDirectory(candidate)).commit,
    candidateCommit,
  );
  serving = path.join(candidate, 'dist');
  await reopen('upgraded-application-same-profile');
  // The actual built candidate is damaged, rejected, and never served afterwards.
  await writeFile(
    path.join(candidate, 'dist', 'index.html'),
    'interrupted download',
  );
  await assert.rejects(verifyReleaseDirectory(candidate), /checksum/);
  const incomplete = path.join(scratch, 'incomplete');
  await mkdir(incomplete);
  await copyFile(
    path.join(candidate, 'gev-release-manifest.json'),
    path.join(incomplete, 'gev-release-manifest.json'),
  );
  await assert.rejects(verifyReleaseDirectory(incomplete), /file list/);
  assert.equal((await verifyReleaseDirectory(previous)).commit, priorCommit);
  serving = path.join(previous, 'dist');
  await reopen('failed-verification-rolls-back-and-reopens-assets');
} catch (error) {
    failure = { check: activeCheck, step: activeStep, error: error.message };
    if (error.recoveryDiagnostics)
      failure.diagnostics = error.recoveryDiagnostics;
  throw error;
} finally {
  const report = {
    scope: 'prior-install-browser-profile-recovery',
    candidateCommit,
    priorCommit,
    platform: process.platform,
    os: os.release(),
    node: process.version,
    hostEnvironment: {
      cpuModel: os.cpus()[0]?.model || null,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    requestedRenderingBackend:
      process.env.GEV_QA_SOFTWARE_RENDERING !== '1'
        ? 'default'
        : process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY === '1'
          ? 'swiftshader-webgl-only'
          : 'swiftshader-gl-driver',
    browserVersion,
    viewport,
    hardwareRenderingValidated: false, // Recovery checks are not GPU evidence.
    timestamp: new Date().toISOString(),
    sourceDirtyAtStart,
    sourceChangedDuringRun:
      Boolean(sourceStatus()) ||
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim() !== candidateCommit,
    checks,
    status: failure ? 'failed' : 'passed',
    failure,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  // Only this freshly created scratch directory is removed; reports live outside it.
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
