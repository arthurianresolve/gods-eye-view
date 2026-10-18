import { createHash } from 'node:crypto';
import {
  promises as fs,
  readdirSync,
  lstatSync,
  statSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib';

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
const CONTENT_HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/;
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

const comparePath = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function walk(root, relative = '') {
  const directory = path.join(root, relative);
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => comparePath(left, right));
  const files = [];
  for (const name of names) {
    if (
      name.endsWith('.gz') ||
      name.endsWith('.br') ||
      name === 'asset-manifest.json'
    )
      continue;
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
  return (await walk(path.resolve(root))).sort(comparePath);
}

export async function computeContentDigest(root, relativePaths) {
  const hash = createHash('sha256');
  for (const relativePath of [...relativePaths].sort(comparePath)) {
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
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => comparePath(a.name, b.name),
    )) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(sourceRoot, next);
      if (lstatSync(absolute).isSymbolicLink())
        throw new Error(`Symlinked asset is not allowed: ${next}`);
      if (statSync(absolute).isDirectory()) visit(next);
      else if (statSync(absolute).isFile()) files.push(safeRelativePath(next));
      else throw new Error(`Unsupported asset entry: ${next}`);
    }
  };
  visit();
  const hash = createHash('sha256');
  for (const relativePath of files.sort(comparePath)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(path.join(sourceRoot, relativePath)));
    hash.update('\0');
  }
  const digest = hash.digest('hex');
  return {
    schema: CESIUM_DIGEST_SCHEMA,
    digest,
    path: `cesium/${digest}`,
    files: files.length,
  };
}

export function isCompressibleAsset(relativePath) {
  return COMPRESSIBLE.has(
    path.posix.extname(safeRelativePath(relativePath)).toLowerCase(),
  );
}

export function classifyAsset(
  relativePath,
  { cesiumDigest, immutablePaths } = {},
) {
  const safePath = safeRelativePath(relativePath);
  if (immutablePaths?.has(safePath) && CONTENT_HASHED_ASSET.test(safePath))
    return 'immutable';
  const immutable = Boolean(
    cesiumDigest && safePath.startsWith(`cesium/${cesiumDigest}/`),
  );
  return immutable ? 'immutable' : 'revalidate';
}

/** Build deterministic raw/gzip/Brotli metadata without writing application APIs. */
export async function createAssetManifest(
  root,
  {
    cesiumDigest = null,
    immutablePaths = null,
    brotliQuality = 5,
    includeCompression = true,
  } = {},
) {
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
      cache: classifyAsset(relativePath, { cesiumDigest, immutablePaths }),
      contentEncoding: [],
    };
    if (isCompressibleAsset(relativePath)) {
      entry.contentEncoding = ['br', 'gzip'];
      if (includeCompression) {
        entry.gzip = gzipSync(bytes, { level: 9, mtime: 0 }).length;
        entry.brotli = brotliCompressSync(bytes, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality },
        }).length;
      }
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
        ? brotliCompressSync(bytes, {
            params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: options.brotliQuality ?? 5,
            },
          })
        : null,
    });
  }
  return { manifest, artifacts };
}

/** Emit a manifest and bounded compressed sidecars after Vite writes its output. */
export async function writeAssetArtifacts(
  root,
  {
    cesiumDigest = null,
    immutablePaths = null,
    manifestName = 'asset-manifest.json',
    brotliQuality = 5,
  } = {},
) {
  if (
    !Number.isInteger(brotliQuality) ||
    brotliQuality < 0 ||
    brotliQuality > 11
  )
    throw new Error('Brotli quality must be an integer between 0 and 11.');
  const absoluteRoot = path.resolve(root);
  const manifest = await createAssetManifest(absoluteRoot, {
    cesiumDigest,
    immutablePaths,
    includeCompression: false,
  });
  const sidecars = [];
  for (const entry of manifest.assets) {
    if (!entry.contentEncoding.length) continue;
    const bytes = await fs.readFile(path.join(absoluteRoot, entry.path));
    if (entry.contentEncoding.includes('gzip')) {
      const target = path.join(absoluteRoot, `${entry.path}.gz`);
      const compressed = gzipSync(bytes, { level: 9, mtime: 0 });
      entry.gzip = compressed.length;
      entry.gzipSha256 = createHash('sha256').update(compressed).digest('hex');
      await fs.writeFile(target, compressed);
      sidecars.push(`${entry.path}.gz`);
    }
    if (entry.contentEncoding.includes('br')) {
      const target = path.join(absoluteRoot, `${entry.path}.br`);
      const compressed = brotliCompressSync(bytes, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality },
      });
      entry.brotli = compressed.length;
      entry.brotliSha256 = createHash('sha256')
        .update(compressed)
        .digest('hex');
      await fs.writeFile(target, compressed);
      sidecars.push(`${entry.path}.br`);
    }
  }
  await fs.writeFile(
    path.join(absoluteRoot, manifestName),
    `${JSON.stringify({ ...manifest, sidecars: sidecars.sort(comparePath) }, null, 2)}\n`,
  );
  return { manifest, sidecars: sidecars.sort(comparePath) };
}

export function assetDistributionPlugin({ cesiumDigest = null } = {}) {
  const immutablePaths = new Set();
  let outDir = null;
  return {
    name: 'gev-asset-distribution',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (
          item.type === 'chunk' ||
          (item.type === 'asset' && !/\.html?$/i.test(fileName))
        )
          immutablePaths.add(safeRelativePath(fileName));
      }
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (!outDir)
          throw new Error(
            'Asset distribution output directory was not resolved.',
          );
        await writeAssetArtifacts(outDir, { cesiumDigest, immutablePaths });
      },
    },
  };
}
