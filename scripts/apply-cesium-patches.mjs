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
const DEFAULT_COLLISION_MANIFEST = path.join(
  REPOSITORY_ROOT,
  'patches',
  'cesium-1.138.0-collision-transform.json',
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
 * Apply the hash-pinned Cesium 1.138 dependency patches in order. Every
 * dependency file is validated through the full patch chain before the first
 * write; any intermediate state is accepted for recovery after interruption.
 */
export function applyCesiumPatches(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const manifestPaths =
    options.manifestPaths ??
    (Object.hasOwn(options, 'manifestPath')
      ? [options.manifestPath]
      : [DEFAULT_MANIFEST, DEFAULT_COLLISION_MANIFEST]);
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error('At least one Cesium patch manifest is required');
  }
  const manifests = manifestPaths.map((manifestPath) => {
    const manifest = readJson(manifestPath);
    validateManifest(manifest);
    return manifest;
  });
  const firstManifest = manifests[0];
  for (const manifest of manifests) {
    if (
      manifest.cesiumVersion !== firstManifest.cesiumVersion ||
      manifest.engineVersion !== firstManifest.engineVersion
    ) {
      throw new Error(
        'Cesium patch manifests target different package versions',
      );
    }
  }
  assertPackageVersion(
    root,
    'node_modules/cesium/package.json',
    firstManifest.cesiumVersion,
  );
  assertPackageVersion(
    root,
    'node_modules/@cesium/engine/package.json',
    firstManifest.engineVersion,
  );

  const entriesByPath = new Map();
  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index];
    const manifestEntries = new Map(
      manifest.files.map((entry) => [entry.relativePath, entry]),
    );
    if (index === 0) {
      for (const [relativePath, entry] of manifestEntries) {
        entriesByPath.set(relativePath, [entry]);
      }
      continue;
    }
    if (
      manifestEntries.size !== entriesByPath.size ||
      [...entriesByPath.keys()].some(
        (relativePath) => !manifestEntries.has(relativePath),
      )
    ) {
      throw new Error('Cesium patch manifests do not cover the same files');
    }
    for (const [relativePath, entries] of entriesByPath) {
      const entry = manifestEntries.get(relativePath);
      if (entry.sourceSha256 !== entries.at(-1).patchedSha256) {
        throw new Error(`Broken Cesium patch chain for ${relativePath}`);
      }
      entries.push(entry);
    }
  }

  const validated = [...entriesByPath].map(([relativePath, entries]) => {
    const filePath = path.join(root, 'node_modules', relativePath);
    const originalBytes = readFileSync(filePath);
    const originalDigest = sha256(originalBytes);
    const validDigests = [
      entries[0].sourceSha256,
      ...entries.map((entry) => entry.patchedSha256),
    ];
    const stateIndex = validDigests.indexOf(originalDigest);
    if (stateIndex < 0) {
      throw new Error(
        `Unexpected Cesium bytes for ${relativePath}: ${originalDigest}`,
      );
    }
    let bytes = originalBytes;
    let text;
    for (
      let patchIndex = stateIndex;
      patchIndex < entries.length;
      patchIndex += 1
    ) {
      const entry = entries[patchIndex];
      if (patchIndex > 0 && sha256(bytes) !== entry.sourceSha256) {
        throw new Error(`Broken Cesium patch chain for ${relativePath}`);
      }
      text ??= bytes.toString('utf8');
      const occurrences = text.split(entry.oldText).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `Expected one patch anchor in ${relativePath}; found ${occurrences}`,
        );
      }
      text = text.replace(entry.oldText, entry.newText);
      bytes = Buffer.from(text, 'utf8');
      const patchedDigest = sha256(bytes);
      if (patchedDigest !== entry.patchedSha256) {
        throw new Error(
          `Patch output hash mismatch for ${relativePath}: ${patchedDigest}`,
        );
      }
    }
    return {
      entry: entries.at(-1),
      filePath,
      bytes,
      patched: stateIndex === entries.length,
    };
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
