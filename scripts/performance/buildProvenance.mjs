#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RECEIPT_SCHEMA = 'gev-build-provenance/v1';
const SERVED_SCHEMA = 'gev-served-assets-verification/v1';
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ASSETS = 2048;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 3_000;
const SERVED_TIMEOUT_MS = 120_000;

const jsonDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digestBytes = (value) => createHash('sha256').update(value).digest('hex');
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError(`${label} is required.`);
  return value;
};
const assertSha = (value, pattern, label) => {
  if (!pattern.test(value || '')) throw new Error(`${label} is invalid.`);
};

async function noSymlinkPath(input, label) {
  const absolute = path.resolve(input);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error(`${label} path contains a symlink.`);
  }
  return realpath(absolute);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertRelativeAssetPath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#') ||
    /[\0-\x1f]/.test(value)
  )
    throw new Error('Build asset path is unsafe.');
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('Build asset path is unsafe.');
  return value;
}

function validateAssetRecords(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_ASSETS)
    throw new Error('Build provenance asset list is invalid.');
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    assertRelativeAssetPath(file?.path);
    if (seen.has(file.path))
      throw new Error('Build provenance contains duplicate asset paths.');
    seen.add(file.path);
    if (
      !Number.isInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > MAX_ASSET_BYTES
    )
      throw new Error('Build provenance asset size is invalid.');
    assertSha(file.sha256, SHA256, 'Build asset hash');
    total += file.bytes;
    if (total > MAX_TOTAL_BYTES)
      throw new Error('Build provenance assets exceed the total size limit.');
  }
  return total;
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    throw new Error(
      `Unable to read Git provenance for ${path.basename(root)}.`,
    );
  }
}

async function readSourceIdentity(root, label, expectedCommit) {
  const canonicalRoot = await noSymlinkPath(root, label);
  if (!(await stat(canonicalRoot)).isDirectory())
    throw new Error(`${label} must be a directory.`);
  const gitRoot = await realpath(
    git(canonicalRoot, ['rev-parse', '--show-toplevel']),
  );
  if (gitRoot !== canonicalRoot)
    throw new Error(`${label} must name the Git checkout root.`);
  const commit = git(canonicalRoot, ['rev-parse', 'HEAD']);
  assertSha(commit, SHA1, `${label} commit`);
  if (expectedCommit) {
    assertSha(expectedCommit, SHA1, `Expected ${label} commit`);
    if (commit !== expectedCommit)
      throw new Error(`${label} commit does not match the expected full SHA.`);
  }
  if (git(canonicalRoot, ['status', '--porcelain', '--untracked-files=all']))
    throw new Error(`${label} checkout must be clean.`);
  return { root: canonicalRoot, commit };
}

async function packageRecipe(root, npmConfig) {
  const packageBytes = await readFile(path.join(root, 'package.json'));
  const lockBytes = await readFile(path.join(root, 'package-lock.json'));
  const packageJson = JSON.parse(packageBytes.toString('utf8'));
  const buildScript = packageJson.scripts?.build;
  text(buildScript, 'Tracked npm build script');
  return {
    packageJsonSha256: digestBytes(packageBytes),
    packageLockSha256: digestBytes(lockBytes),
    buildScriptSha256: digestBytes(Buffer.from(buildScript)),
    buildScriptName: 'build',
    dependencyInstall: 'npm ci --no-audit --no-fund',
    buildInvocation:
      'npm run build -- --outDir <new-empty-task-owned-directory>',
    nodeVersion: process.version,
    npmVersion: await npmVersion(root, npmConfig),
  };
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      path.isAbsolute(candidate) &&
      candidate.toLowerCase().endsWith('.js') &&
      existsSync(candidate)
    )
      return realpathSync(candidate);
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    const installed = execFileSync(locator, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)[0]
      .trim();
    const real = realpathSync(installed);
    if (real.toLowerCase().endsWith('.js')) return real;
    const adjacent = path.join(
      path.dirname(real),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    if (existsSync(adjacent)) return realpathSync(adjacent);
  } catch {
    // Fall through to a concise error.
  }
  throw new Error('npm CLI could not be resolved for the clean build.');
}

function buildEnvironment(npmConfig) {
  const safeNames = [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'PROCESSOR_ARCHITECTURE',
  ];
  const env = Object.fromEntries(
    safeNames
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  return {
    ...env,
    CI: '1',
    npm_config_update_notifier: 'false',
    npm_config_userconfig: npmConfig.userFile,
    npm_config_globalconfig: npmConfig.globalFile,
  };
}

async function runNpm(
  root,
  args,
  { captureOutput = false, npmConfig } = {},
) {
  const cli = npmCliPath();
  try {
    const output = execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: captureOutput ? ['ignore', 'pipe', 'ignore'] : 'ignore',
      timeout: 10 * 60 * 1000,
      maxBuffer: 32 * 1024,
      windowsHide: true,
      env: buildEnvironment(npmConfig),
    });
    return output?.trim() ?? '';
  } catch (error) {
    throw new Error(
      `npm ${args[0]} failed or exceeded its time limit (exit ${error.status ?? 'unknown'}).`,
    );
  }
}

async function npmVersion(root, npmConfig) {
  const output = await runNpm(root, ['--version'], {
    captureOutput: true,
    npmConfig,
  });
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(output))
    throw new Error('npm version could not be verified.');
  return output;
}

async function createNpmConfig() {
  const tempRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(tempRoot, 'gev-build-provenance-npm-'),
  );
  const canonical = await noSymlinkPath(directory, 'Temporary npm config');
  const expectedParent = await realpath(os.tmpdir());
  if (
    !inside(expectedParent, canonical) ||
    !path.basename(canonical).startsWith('gev-build-provenance-npm-')
  )
    throw new Error('Temporary npm config escaped its generated directory.');
  const userFile = path.join(canonical, 'user.npmrc');
  const globalFile = path.join(canonical, 'global.npmrc');
  const contents = 'audit=false\nfund=false\nupdate-notifier=false\n';
  await writeFile(userFile, contents, { flag: 'wx' });
  await writeFile(globalFile, contents, { flag: 'wx' });
  return { directory: canonical, userFile, globalFile };
}

async function removeNpmConfig(config) {
  const expectedParent = await realpath(os.tmpdir());
  const canonical = await noSymlinkPath(
    config.directory,
    'Temporary npm config',
  );
  if (
    !inside(expectedParent, canonical) ||
    !path.basename(canonical).startsWith('gev-build-provenance-npm-')
  )
    throw new Error('Refusing to remove an unowned temporary npm config.');
  for (const file of [config.userFile, config.globalFile]) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Temporary npm config changed during the build.');
    await unlink(file);
  }
  await rmdir(canonical);
}

function assertSimpleBuildPath(value) {
  if (/["%&|<>^!()$`]/.test(value))
    throw new Error('Build output path contains unsupported shell characters.');
  return value;
}

async function inventory(root) {
  const files = [];
  let totalBytes = 0;
  const visit = async (directory, prefix = '') => {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(prefix, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink())
        throw new Error(`Build output contains a symlink: ${relative}`);
      if (info.isDirectory()) {
        await visit(absolute, relative);
      } else if (info.isFile()) {
        if (files.length >= MAX_ASSETS)
          throw new Error('Build output exceeds the asset count limit.');
        if (info.size > MAX_ASSET_BYTES)
          throw new Error(`Build asset exceeds the size limit: ${relative}`);
        totalBytes += info.size;
        if (totalBytes > MAX_TOTAL_BYTES)
          throw new Error('Build output exceeds the total size limit.');
        files.push({
          path: assertRelativeAssetPath(relative),
          bytes: info.size,
          sha256: digestBytes(await readFile(absolute)),
        });
      } else {
        throw new Error(
          `Build output contains a non-regular file: ${relative}`,
        );
      }
    }
  };
  await visit(root);
  if (!files.some((file) => file.path === 'index.html'))
    throw new Error('Build output is missing index.html.');
  return { files, totalBytes };
}

function receiptHash(receipt) {
  const copy = { ...receipt };
  delete copy.receiptSha256;
  return jsonDigest(copy);
}

function compareRecord(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label} does not match its provenance receipt.`);
}

/** Freshly install and build an explicitly named clean checkout into a new output directory. */
export async function createLocalBuildReceipt({
  checkoutRoot,
  harnessRoot,
  buildOutDir,
  expectedAppCommit,
  expectedHarnessCommit,
} = {}) {
  text(checkoutRoot, 'Explicit build checkout');
  text(harnessRoot, 'Explicit harness checkout');
  text(buildOutDir, 'New build output path');
  assertSha(expectedAppCommit, SHA1, 'Expected application commit');
  assertSha(expectedHarnessCommit, SHA1, 'Expected harness commit');

  const appBefore = await readSourceIdentity(
    checkoutRoot,
    'Application',
    expectedAppCommit,
  );
  const harness = await readSourceIdentity(
    harnessRoot,
    'Harness',
    expectedHarnessCommit,
  );
  const dependencyPath = path.join(appBefore.root, 'node_modules');
  const dependencies = await lstat(dependencyPath).catch(() => null);
  if (dependencies?.isSymbolicLink())
    throw new Error(
      'Build checkout node_modules must not be a symlink or junction.',
    );
  const outPath = path.resolve(buildOutDir);
  const outParent = await noSymlinkPath(
    path.dirname(outPath),
    'Build output parent',
  );
  const canonicalOut = path.join(outParent, path.basename(outPath));
  if (
    inside(appBefore.root, canonicalOut) ||
    inside(harness.root, canonicalOut)
  )
    throw new Error('Build output must be outside both Git checkouts.');
  if (
    await lstat(canonicalOut).then(
      () => true,
      () => false,
    )
  )
    throw new Error(
      'Build output path already exists; existing output is never reused or cleared.',
    );
  assertSimpleBuildPath(canonicalOut);
  await mkdir(canonicalOut);
  const actualOut = await noSymlinkPath(canonicalOut, 'Build output');
  if (actualOut !== canonicalOut)
    throw new Error('Build output path changed during creation.');

  const npmConfig = await createNpmConfig();
  try {
    const recipe = await packageRecipe(appBefore.root, npmConfig);
    await runNpm(appBefore.root, ['ci', '--no-audit', '--no-fund'], {
      npmConfig,
    });
    const buildArg = `--outDir="${canonicalOut}"`;
    await runNpm(appBefore.root, ['run', 'build', '--', buildArg], {
      npmConfig,
    });

    const appAfter = await readSourceIdentity(
      appBefore.root,
      'Application',
      expectedAppCommit,
    );
    if (appAfter.commit !== appBefore.commit)
      throw new Error('Application source revision changed during the build.');
    const afterRecipe = await packageRecipe(appAfter.root, npmConfig);
    compareRecord(afterRecipe, recipe, 'Build recipe');
    const assets = await inventory(actualOut);
    const body = {
      schema: RECEIPT_SCHEMA,
      scope:
        'unsigned local source-build receipt; not a hardware or release attestation',
      source: { commit: appAfter.commit, worktree: 'clean' },
      harness: { commit: harness.commit, worktree: 'clean' },
      buildRecipe: recipe,
      assets: assets.files,
      assetCount: assets.files.length,
      totalAssetBytes: assets.totalBytes,
    };
    const receipt = { ...body, receiptSha256: receiptHash(body) };
    return { receipt, buildRoot: actualOut };
  } finally {
    await removeNpmConfig(npmConfig);
  }
}

async function validateReceiptLocal(
  receipt,
  {
    checkoutRoot,
    harnessRoot,
    buildRoot,
    expectedAppCommit,
    expectedHarnessCommit,
  } = {},
) {
  if (receipt?.schema !== RECEIPT_SCHEMA)
    throw new Error('Build provenance receipt schema is unsupported.');
  if (
    receipt?.scope !==
    'unsigned local source-build receipt; not a hardware or release attestation'
  )
    throw new Error('Build provenance receipt scope is unsupported.');
  assertSha(expectedAppCommit, SHA1, 'Expected application commit');
  assertSha(expectedHarnessCommit, SHA1, 'Expected harness commit');
  assertSha(receipt.receiptSha256, SHA256, 'Receipt hash');
  if (receiptHash(receipt) !== receipt.receiptSha256)
    throw new Error('Build provenance receipt hash is invalid.');
  const receiptBytes = validateAssetRecords(receipt.assets);
  if (
    receipt.assetCount !== receipt.assets.length ||
    receipt.totalAssetBytes !== receiptBytes
  )
    throw new Error('Build provenance asset summary is invalid.');
  const app = await readSourceIdentity(
    checkoutRoot,
    'Application',
    expectedAppCommit,
  );
  const harness = await readSourceIdentity(
    harnessRoot,
    'Harness',
    expectedHarnessCommit,
  );
  if (
    receipt.source?.commit !== app.commit ||
    receipt.source?.worktree !== 'clean'
  )
    throw new Error('Application source does not match the build receipt.');
  if (
    receipt.harness?.commit !== harness.commit ||
    receipt.harness?.worktree !== 'clean'
  )
    throw new Error('Harness source does not match the build receipt.');
  const npmConfig = await createNpmConfig();
  try {
    const recipe = await packageRecipe(app.root, npmConfig);
    compareRecord(receipt.buildRecipe, recipe, 'Build recipe');
  } finally {
    await removeNpmConfig(npmConfig);
  }
  const root = await noSymlinkPath(buildRoot, 'Build output');
  if (!(await stat(root)).isDirectory())
    throw new Error('Build output must be a directory.');
  const assets = await inventory(root);
  compareRecord(receipt.assets, assets.files, 'Build assets');
  if (
    receipt.assetCount !== assets.files.length ||
    receipt.totalAssetBytes !== assets.totalBytes
  )
    throw new Error('Build output summary does not match its receipt.');
  return { root, assets };
}

/** Verify a receipt against its local build and the same-origin assets actually served by a loopback app. */
export async function verifyServedBuildAssets({
  receipt,
  checkoutRoot,
  harnessRoot,
  buildRoot,
  expectedAppCommit,
  expectedHarnessCommit,
  baseUrl,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const { root, assets } = await validateReceiptLocal(receipt, {
    checkoutRoot,
    harnessRoot,
    buildRoot,
    expectedAppCommit,
    expectedHarnessCommit,
  });
  if (typeof fetchImpl !== 'function')
    throw new TypeError('A fetch implementation is required.');
  const base = parseLoopbackBaseUrl(baseUrl);
  const deadline = Date.now() + SERVED_TIMEOUT_MS;
  for (const asset of assets.files) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error(
        'Served build verification exceeded its total time limit.',
      );
    const url = assetUrl(base, asset.path);
    let response;
    try {
      response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remainingMs)),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch {
      throw new Error(`Served build asset could not be fetched: ${asset.path}`);
    }
    if (response.status !== 200) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(
        `Served build asset is missing or redirected: ${asset.path}`,
      );
    }
    let bytes;
    try {
      bytes = await readBoundedBody(response, MAX_ASSET_BYTES);
    } catch {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(
        `Served build asset exceeded its size or time limit: ${asset.path}`,
      );
    }
    if (bytes.byteLength !== asset.bytes || digestBytes(bytes) !== asset.sha256)
      throw new Error(
        `Served build asset differs from its receipt: ${asset.path}`,
      );
  }
  if (Date.now() > deadline)
    throw new Error('Served build verification exceeded its total time limit.');
  await validateReceiptLocal(receipt, {
    checkoutRoot,
    harnessRoot,
    buildRoot: root,
    expectedAppCommit,
    expectedHarnessCommit,
  });
  return {
    schema: SERVED_SCHEMA,
    status: 'served-assets-match',
    receiptSha256: receipt.receiptSha256,
    assetCount: assets.files.length,
    totalAssetBytes: assets.totalBytes,
  };
}

function parseLoopbackBaseUrl(value) {
  let url;
  try {
    url = new URL(text(value, 'Loopback application URL'));
  } catch {
    throw new TypeError('Loopback application URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP(S) asset verification is supported.');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'Application URL must not contain credentials, query, or fragment.',
    );
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()))
    throw new Error(
      'Served build verification is restricted to loopback hosts.',
    );
  return url;
}

function assetUrl(base, assetPath) {
  assertRelativeAssetPath(assetPath);
  const parts = assetPath.split('/');
  const prefix = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  const url = new URL(
    parts.map(encodeURIComponent).join('/'),
    `${base.origin}${prefix}`,
  );
  if (
    url.origin !== base.origin ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error('Receipt asset escaped the same-origin build path.');
  return url;
}

async function readBoundedBody(response, limit) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('Served asset exceeds the size limit.');
  }
  if (!response.body?.getReader)
    throw new Error('Served response must support bounded streaming.');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('Served asset exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function writeReceipt(pathname, receipt, forbiddenRoots = []) {
  const file = path.resolve(pathname);
  const parent = await noSymlinkPath(path.dirname(file), 'Receipt parent');
  const canonicalFile = path.join(parent, path.basename(file));
  for (const root of forbiddenRoots) {
    const canonicalRoot = await noSymlinkPath(
      root,
      'Protected checkout/output',
    );
    if (inside(canonicalRoot, canonicalFile))
      throw new Error(
        'Receipt must be stored outside source checkouts and build output.',
      );
  }
  await writeFile(canonicalFile, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  return canonicalFile;
}

function parseArgs(argv) {
  const command = argv.shift();
  if (!['create', 'verify-served'].includes(command))
    throw new TypeError(
      'Usage: buildProvenance.mjs create|verify-served --name value ...',
    );
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (
      ![
        '--checkout',
        '--harness',
        '--build-out',
        '--expected-app-sha',
        '--expected-harness-sha',
        '--out',
        '--receipt',
        '--build-root',
        '--url',
      ].includes(key)
    )
      throw new TypeError(`Unknown option: ${key}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError(`Missing value for ${key}`);
    options[key.slice(2).replaceAll('-', '')] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'create') {
    for (const name of [
      'checkout',
      'harness',
      'buildout',
      'expectedappsha',
      'expectedharnesssha',
      'out',
    ])
      text(options[name], `--${name}`);
    const { receipt, buildRoot } = await createLocalBuildReceipt({
      checkoutRoot: options.checkout,
      harnessRoot: options.harness,
      buildOutDir: options.buildout,
      expectedAppCommit: options.expectedappsha,
      expectedHarnessCommit: options.expectedharnesssha,
    });
    const receiptPath = await writeReceipt(options.out, receipt, [
      options.checkout,
      options.harness,
      buildRoot,
    ]);
    process.stdout.write(
      `Created local build receipt ${receipt.receiptSha256} for ${receipt.source.commit}; ${receipt.assetCount} assets at ${path.basename(buildRoot)}.\n`,
    );
    process.stdout.write(`Receipt: ${path.basename(receiptPath)}\n`);
    return;
  }

  for (const name of [
    'checkout',
    'harness',
    'buildroot',
    'expectedappsha',
    'expectedharnesssha',
    'receipt',
    'url',
  ])
    text(options[name], `--${name}`);
  const receipt = JSON.parse(await readFile(options.receipt, 'utf8'));
  const result = await verifyServedBuildAssets({
    receipt,
    checkoutRoot: options.checkout,
    harnessRoot: options.harness,
    buildRoot: options.buildroot,
    expectedAppCommit: options.expectedappsha,
    expectedHarnessCommit: options.expectedharnesssha,
    baseUrl: options.url,
  });
  process.stdout.write(
    `Verified ${result.assetCount} served assets for local receipt ${result.receiptSha256}.\n`,
  );
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
