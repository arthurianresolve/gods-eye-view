import { createHash } from 'node:crypto';
import { promises as fs, readdirSync, lstatSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export const ASSET_MANIFEST_SCHEMA = 'gev-asset-manifest/v1';
export const CESIUM_DIGEST_SCHEMA = 'gev-cesium-distribution/v1';

const COMPRESSIBLE = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.map',
  '.md',
  '.svg',
  '.txt',
  '.wasm',
  '.webmanifest',
  '.xml',
]);
const IMMUTABLE_ASSET = /^(?:assets\/[^/]+-[a-f0-9]{8,}\.[^/]+|cesium\/[a-f0-9]{16,}\/[^/]+)$/;
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
});

function safeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '')
  )
    throw new Error(`Unsafe asset path: ${value}`);
  const result = path.posix.normalize(normalized);
  if (result === '.' || result.startsWith('../'))
    throw new Error(`Unsafe asset path: ${value}`);
  return result;
}

async function walk(root, relative = '') {
  const directory = path.join(root, relative);
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const files = [];
  for (const name of names) {
    const next = relative ? `${relative}/${name}` : name;
    if ((await fs.lstat(path.join(root, next))).isSymbolicLink())
      throw new Error(`Symlinked asset is not allowed: ${next}`);
    const entry = path.join(root, next);
    const stat = await fs.stat(entry);
    if (stat.isDirectory()) files.push(...(await walk(root, next)));
    else if (stat.isFile()) files.push(safeRelativePath(next));
    else throw new Error(`Unsupported asset entry: ${next}`);
  }
  return files;
}

export async function listAssetFiles(root) {
  return (await walk(path.resolve(root))).sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function computeContentDigest(root, relativePaths) {
  const hash = createHash('sha256');
  for (const relativePath of [...relativePaths].sort((a, b) => a.localeCompare(b))) {
    const safePath = safeRelativePath(relativePath);
    const bytes = await fs.readFile(path.join(root, safePath));
    hash.update(safePath);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Hash the patched Cesium distribution bytes in deterministic path order. */
export async function computeCesiumDistributionDigest({
  root,
  distributionRoot = path.join('node_modules', 'cesium', 'Build', 'Cesium'),
} = {}) {
  const sourceRoot = path.resolve(root || process.cwd(), distributionRoot);
  const files = await listAssetFiles(sourceRoot);
  const digest = await computeContentDigest(sourceRoot, files);
  return {
    schema: CESIUM_DIGEST_SCHEMA,
    digest,
    path: `cesium/${digest}`,
    files: files.length,
  };
}

/** Synchronous variant for Vite config construction before plugin setup. */
export function computeCesiumDistributionDigestSync({
  root,
  distributionRoot = path.join('node_modules', 'cesium', 'Build', 'Cesium'),
} = {}) {
  const sourceRoot = path.resolve(root || process.cwd(), distributionRoot);
  const files = [];
  const visit = (relative = '') => {
    const directory = path.join(sourceRoot, relative);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(sourceRoot, next);
      if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Symlinked asset is not allowed: ${next}`);
      if (statSync(absolute).isDirectory()) visit(next);
      else if (statSync(absolute).isFile()) files.push(safeRelativePath(next));
      else throw new Error(`Unsupported asset entry: ${next}`);
    }
  };
  visit();
  const hash = createHash('sha256');
  for (const relativePath of files.sort((a, b) => a.localeCompare(b))) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(path.join(sourceRoot, relativePath)));
    hash.update('\0');
  }
  const digest = hash.digest('hex');
  return { schema: CESIUM_DIGEST_SCHEMA, digest, path: `cesium/${digest}`, files: files.length };
}

export function isCompressibleAsset(relativePath) {
  return COMPRESSIBLE.has(path.posix.extname(safeRelativePath(relativePath)).toLowerCase());
}

export function classifyAsset(relativePath, { cesiumDigest } = {}) {
  const safePath = safeRelativePath(relativePath);
  const immutable =
    (cesiumDigest && safePath.startsWith(`cesium/${cesiumDigest}/`)) ||
    IMMUTABLE_ASSET.test(safePath);
  return immutable ? 'immutable' : 'revalidate';
}

/** Build deterministic raw/gzip/Brotli metadata without writing application APIs. */
export async function createAssetManifest(root, { cesiumDigest = null } = {}) {
  const absoluteRoot = path.resolve(root);
  const files = await listAssetFiles(absoluteRoot);
  const assets = [];
  for (const relativePath of files) {
    const bytes = await fs.readFile(path.join(absoluteRoot, relativePath));
    const entry = {
      path: relativePath,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType:
        CONTENT_TYPES[path.posix.extname(relativePath).toLowerCase()] ||
        'application/octet-stream',
      cache: classifyAsset(relativePath, { cesiumDigest }),
      contentEncoding: [],
    };
    if (isCompressibleAsset(relativePath)) {
      entry.gzip = gzipSync(bytes, { level: 9, mtime: 0 }).length;
      entry.brotli = brotliCompressSync(bytes).length;
      entry.contentEncoding = ['br', 'gzip'];
    }
    assets.push(entry);
  }
  return {
    schema: ASSET_MANIFEST_SCHEMA,
    cesiumDigest,
    assets,
  };
}

/** Return deterministic raw/gzip/Brotli artifacts for a host or release packager. */
export async function createAssetArtifacts(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const manifest = await createAssetManifest(absoluteRoot, options);
  const artifacts = new Map();
  for (const entry of manifest.assets) {
    const bytes = await fs.readFile(path.join(absoluteRoot, entry.path));
    artifacts.set(entry.path, {
      bytes,
      gzip: entry.contentEncoding.includes('gzip')
        ? gzipSync(bytes, { level: 9, mtime: 0 })
        : null,
      brotli: entry.contentEncoding.includes('br')
        ? brotliCompressSync(bytes)
        : null,
    });
  }
  return { manifest, artifacts };
}
