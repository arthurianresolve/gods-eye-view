#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`Release contains a symlink: ${relative}`);
    if (info.isDirectory())
      result.push(...(await listFiles(absolute, relative)));
    else if (info.isFile() && name !== 'gev-release-manifest.json')
      result.push({ absolute, relative });
  }
  return result;
}

async function verifyReleaseDirectory(directory) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(
    await readFile(path.join(root, 'gev-release-manifest.json'), 'utf8'),
  );
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
    const digest = createHash('sha256')
      .update(await readFile(file.absolute))
      .digest('hex');
    if (
      !record ||
      record.bytes !== (await stat(file.absolute)).size ||
      record.sha256 !== digest
    )
      throw new Error(`Release checksum mismatch: ${file.relative}`);
  }
  return manifest;
}

const args = process.argv.slice(2);
const index = args.indexOf('--path');
try {
  if (index < 0 || !args[index + 1])
    throw new TypeError(
      'Usage: node scripts/verify-release.mjs --path <staging-directory>',
    );
  const directory = path.resolve(args[index + 1]);
  const manifest = await verifyReleaseDirectory(directory);
  console.log(
    `Verified ${manifest.channel} ${manifest.version} (${manifest.commit}); ${manifest.artifactFiles.length} files match SHA-256.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
