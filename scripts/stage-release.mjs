#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_DOCUMENT_VERSION } from '../src/workspaces/document.js';
import { SCENE_DOCUMENT_VERSION } from '../src/director/document.js';
import { SETTINGS_BACKUP_VERSION } from '../src/diagnostics/portable.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED = new Set(['gev-release-manifest.json']);

export function parseReleaseArgs(args, env = process.env) {
  const options = { out: 'release-staging', channel: 'dev', commit: 'unknown' };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--out', '--channel', '--commit'].includes(key))
      throw new TypeError(`Unknown option: ${key}`);
    const value = args[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  if (!['stable', 'dev'].includes(options.channel))
    throw new TypeError('Release channel must be stable or dev.');
  if (
    options.channel === 'stable' &&
    (env.GITHUB_REF_TYPE !== 'tag' ||
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(env.GITHUB_REF_NAME || ''))
  ) {
    // Local invocations may not know the ref name; the workflow supplies it.
    if (env.GITHUB_ACTIONS === 'true')
      throw new TypeError('Stable builds require a semantic-version tag.');
  }
  return options;
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`Release staging refuses symlinks: ${relative}`);
    if (info.isDirectory())
      files.push(...(await listFiles(absolute, relative)));
    else if (info.isFile() && !EXCLUDED.has(name))
      files.push({ absolute, relative });
  }
  return files;
}

async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

export async function stageRelease({
  root = ROOT,
  out = 'release-staging',
  channel = 'dev',
  commit = 'unknown',
  env = process.env,
} = {}) {
  const source = path.resolve(root);
  const destination = path.resolve(source, out);
  if (destination === source || !destination.startsWith(`${source}${path.sep}`))
    throw new Error(
      'Release staging destination must be inside the repository and cannot be the repository root.',
    );
  if (!['stable', 'dev'].includes(channel))
    throw new TypeError('Release channel must be stable or dev.');
  const existing = await stat(destination).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || (await readdir(destination)).length)
      throw new Error(
        `Release output already exists and is not empty: ${path.relative(source, destination)}`,
      );
  } else await mkdir(destination, { recursive: true });
  const pkg = JSON.parse(
    await readFile(path.join(source, 'package.json'), 'utf8'),
  );
  if (
    channel === 'stable' &&
    env.GITHUB_ACTIONS === 'true' &&
    (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_REF_NAME !== `v${pkg.version}`)
  )
    throw new Error(
      `Stable tag ${env.GITHUB_REF_NAME} must match package version v${pkg.version}.`,
    );
  const dist = path.join(source, 'dist');
  if (!(await stat(dist).catch(() => null))?.isDirectory())
    throw new Error('Build dist/ before staging a release.');
  const filesToCopy = [
    ...(await listFiles(dist)).map((entry) => ({
      ...entry,
      relative: path.posix.join('dist', entry.relative),
    })),
    ...[
      'package.json',
      'package-lock.json',
      'README.md',
      'CHANGELOG.md',
      'DATA_SOURCES.md',
      'docs/UPDATE-RECOVERY.md',
      'scripts/verify-release.mjs',
    ].map((relative) => ({
      absolute: path.join(source, relative),
      relative,
    })),
  ];
  for (const entry of filesToCopy) {
    const info = await lstat(entry.absolute);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Missing or unsafe release input: ${entry.relative}`);
    const target = path.join(
      destination,
      entry.relative.replaceAll('/', path.sep),
    );
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(entry.absolute, target);
  }
  const copied = await listFiles(destination);
  const checksums = [];
  for (const entry of copied)
    checksums.push({
      path: entry.relative,
      bytes: (await stat(entry.absolute)).size,
      sha256: await sha256(entry.absolute),
    });
  const manifest = {
    format: 'gev-release',
    formatVersion: 1,
    channel,
    version: pkg.version,
    commit: String(commit).slice(0, 64),
    node: pkg.engines?.node || null,
    dataSchemas: {
      workspace: WORKSPACE_DOCUMENT_VERSION,
      director: SCENE_DOCUMENT_VERSION,
      settings: SETTINGS_BACKUP_VERSION,
    },
    artifactFiles: checksums,
  };
  await writeFile(
    path.join(destination, 'gev-release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  return manifest;
}

export async function verifyReleaseDirectory(directory) {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'gev-release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    manifest.format !== 'gev-release' ||
    manifest.formatVersion !== 1 ||
    !Array.isArray(manifest.artifactFiles)
  )
    throw new Error('Release manifest format is invalid.');
  const actual = await listFiles(root);
  if (actual.length !== manifest.artifactFiles.length)
    throw new Error('Release file list does not match its manifest.');
  const expected = new Map(
    manifest.artifactFiles.map((entry) => [entry.path, entry]),
  );
  for (const file of actual) {
    const record = expected.get(file.relative);
    if (
      !record ||
      record.bytes !== (await stat(file.absolute)).size ||
      record.sha256 !== (await sha256(file.absolute))
    )
      throw new Error(`Release checksum mismatch: ${file.relative}`);
  }
  return manifest;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    const manifest = await stageRelease(options);
    await verifyReleaseDirectory(path.resolve(ROOT, options.out));
    console.log(
      `Staged ${manifest.channel} ${manifest.version} (${manifest.commit}) with ${manifest.artifactFiles.length} checksummed files.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
