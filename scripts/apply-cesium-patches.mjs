import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  statSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DEFAULT_MANIFEST = path.join(
  REPOSITORY_ROOT,
  'patches',
  'cesium-1.138.0-inertia.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertSafeRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`Unsafe Cesium patch path: ${String(relativePath)}`);
  }
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.license !== 'Apache-2.0' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 5
  ) {
    throw new Error('Unsupported or incomplete Cesium patch manifest');
  }
  const paths = new Set();
  for (const entry of manifest.files) {
    assertSafeRelativePath(entry.relativePath);
    if (paths.has(entry.relativePath)) {
      throw new Error(`Duplicate Cesium patch path: ${entry.relativePath}`);
    }
    paths.add(entry.relativePath);
    for (const field of ['sourceSha256', 'patchedSha256']) {
      if (!/^[a-f0-9]{64}$/.test(entry[field] ?? '')) {
        throw new Error(`Invalid ${field} for ${entry.relativePath}`);
      }
    }
    if (
      typeof entry.oldText !== 'string' ||
      entry.oldText.length === 0 ||
      typeof entry.newText !== 'string' ||
      entry.newText.length === 0 ||
      entry.oldText === entry.newText
    ) {
      throw new Error(`Invalid replacement for ${entry.relativePath}`);
    }
  }
}

function assertPackageVersion(root, relativePath, expectedVersion) {
  const packagePath = path.join(root, relativePath);
  const actualVersion = readJson(packagePath).version;
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Cesium patch requires ${relativePath} ${expectedVersion}; found ${actualVersion}`,
    );
  }
}

/**
 * Apply the hash-pinned Cesium 1.138 disabled-input inertia correction.
 * Every dependency file is validated before the first write; mixed pristine
 * and already-patched states are accepted for recovery after interrupted writes.
 */
export function applyCesiumPatches({
  root = REPOSITORY_ROOT,
  manifestPath = DEFAULT_MANIFEST,
} = {}) {
  const manifest = readJson(manifestPath);
  validateManifest(manifest);
  assertPackageVersion(
    root,
    'node_modules/cesium/package.json',
    manifest.cesiumVersion,
  );
  assertPackageVersion(
    root,
    'node_modules/@cesium/engine/package.json',
    manifest.engineVersion,
  );

  const validated = manifest.files.map((entry) => {
    const filePath = path.join(root, 'node_modules', entry.relativePath);
    const bytes = readFileSync(filePath);
    const digest = sha256(bytes);
    if (digest === entry.patchedSha256) {
      return { entry, filePath, bytes, patched: true };
    }
    if (digest !== entry.sourceSha256) {
      throw new Error(
        `Unexpected Cesium bytes for ${entry.relativePath}: ${digest}`,
      );
    }
    const originalText = bytes.toString('utf8');
    const occurrences = originalText.split(entry.oldText).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Expected one patch anchor in ${entry.relativePath}; found ${occurrences}`,
      );
    }
    const patchedBytes = Buffer.from(
      originalText.replace(entry.oldText, entry.newText),
      'utf8',
    );
    const patchedDigest = sha256(patchedBytes);
    if (patchedDigest !== entry.patchedSha256) {
      throw new Error(
        `Patch output hash mismatch for ${entry.relativePath}: ${patchedDigest}`,
      );
    }
    return { entry, filePath, bytes: patchedBytes, patched: false };
  });

  const pending = validated.filter((item) => !item.patched);
  if (pending.length === 0) return { changed: [], alreadyPatched: true };

  const staged = [];
  try {
    for (const item of pending) {
      const mode = lstatSync(item.filePath).mode;
      const temporaryPath = `${item.filePath}.gev-patch-${process.pid}.tmp`;
      writeFileSync(temporaryPath, item.bytes, { flag: 'wx', mode });
      staged.push({ ...item, temporaryPath });
      chmodSync(temporaryPath, statSync(item.filePath).mode & 0o777);
    }
    for (const item of staged) {
      renameSync(item.temporaryPath, item.filePath);
    }
  } catch (error) {
    for (const item of staged) {
      try {
        unlinkSync(item.temporaryPath);
      } catch {
        // Keep the original failure; the next invocation validates each file
        // and can safely finish a partially renamed set.
      }
    }
    throw error;
  }

  return {
    changed: pending.map((item) => item.entry.relativePath),
    alreadyPatched: false,
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  try {
    const result = applyCesiumPatches();
    if (result.alreadyPatched) {
      console.log('[cesium-patch] all supported distributions already patched');
    } else {
      console.log(
        `[cesium-patch] patched ${result.changed.length} distributions`,
      );
    }
  } catch (error) {
    console.error(`[cesium-patch] ${error.message}`);
    process.exitCode = 1;
  }
}
