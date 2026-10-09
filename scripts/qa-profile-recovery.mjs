#!/usr/bin/env node
/** Real prior checkout -> interrupted installer -> rollback -> upgrade, one Chrome profile. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtemp,
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
  seedPersistentWorkspace,
  assertPersistentWorkspace,
} from './qa-application-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const priorCommit = '6b896e2a8277fba12bc9577ad7772005a71e13c7';
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
const scratch = await mkdtemp(path.join(os.tmpdir(), 'gev-profile-recovery-'));
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
async function reopen(label, { seed = false } = {}) {
  browser = await launchFixtureBrowser({
    userDataDir: path.join(scratch, 'browser-profile'),
  });
  try {
    browserVersion = await browser.version();
    const { page, errors } = await prepareFixturePage(browser, base);
    await bootFixturePage(page, base);
    if (seed) expected = await seedPersistentWorkspace(page);
    const result = await assertPersistentWorkspace(page, expected);
    assert.deepEqual(errors, []);
    checks.push({ id: label, status: 'passed', ...result });
    console.log(JSON.stringify(checks.at(-1)));
  } finally {
    await browser.close();
    browser = null;
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
  const report = {
    scope: 'prior-install-browser-profile-recovery',
    candidateCommit,
    priorCommit,
    platform: process.platform,
    os: os.release(),
    node: process.version,
    browserVersion,
    timestamp: new Date().toISOString(),
    sourceDirtyAtStart,
    sourceChangedDuringRun:
      Boolean(sourceStatus()) ||
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim() !== candidateCommit,
    checks,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally {
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
