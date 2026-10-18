import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_SIDE_CAR_BYTES = 64 * 1024 * 1024;
const SIDECAR = /\.(?:br|gz)$/;

function safeAssetPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('%'))
    return null;
  const relative = value.replace(/^\/+/, '');
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..'))
    return null;
  return relative;
}

function sendError(res, status, message) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader?.('content-type', 'text/plain; charset=utf-8');
  res.end?.(`${message}\n`);
}

/**
 * Install a test-only Vite preview handler for receipt-listed physical sidecars.
 * Normal app requests fall through unchanged; this endpoint intentionally
 * omits Content-Encoding so provenance verification observes on-disk bytes.
 */
export function installRawReceiptAssetMiddleware({
  middlewares,
  buildRoot,
  receipt,
} = {}) {
  if (!middlewares?.use) throw new TypeError('A Vite middleware stack is required.');
  if (typeof buildRoot !== 'string' || !path.isAbsolute(buildRoot))
    throw new TypeError('An absolute build root is required.');
  const root = path.resolve(buildRoot);
  const allowed = new Map();
  for (const asset of receipt?.assets || []) {
    if (!SIDECAR.test(asset?.path || '')) continue;
    const relative = safeAssetPath(asset.path);
    if (!relative || relative !== asset.path || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > MAX_SIDE_CAR_BYTES)
      throw new Error('Receipt sidecar path or byte length is invalid.');
    allowed.set(relative, asset);
  }
  if (allowed.size === 0) return { allowedPaths: [], root, installed: false };
  let rootReal;
  const ready = fs.realpath(root).then((value) => {
    rootReal = value;
  });
  middlewares.use(async (req, res, next) => {
    const rawUrl = String(req.url || '').split('?', 1)[0];
    if (!SIDECAR.test(rawUrl)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return sendError(res, 405, 'Method not allowed.');
    const relative = safeAssetPath(rawUrl);
    const asset = relative ? allowed.get(relative) : null;
    if (!asset) return sendError(res, 404, 'Receipt sidecar is not allowlisted.');
    try {
      await ready;
      const file = path.resolve(root, relative);
      const relativeCheck = path.relative(rootReal, file);
      if (!relativeCheck || relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck))
        return sendError(res, 404, 'Receipt sidecar path escaped its root.');
      const realFile = await fs.realpath(file);
      const realCheck = path.relative(rootReal, realFile);
      if (!realCheck || realCheck.startsWith('..') || path.isAbsolute(realCheck))
        return sendError(res, 404, 'Receipt sidecar resolved outside its root.');
      const stat = await fs.stat(realFile);
      if (!stat.isFile() || stat.size > MAX_SIDE_CAR_BYTES || stat.size !== asset.bytes)
        return sendError(res, 404, 'Receipt sidecar size is invalid.');
      res.statusCode = 200;
      res.setHeader?.('content-type', 'application/octet-stream');
      res.setHeader?.('content-length', String(stat.size));
      res.setHeader?.('cache-control', 'no-store');
      // Deliberately no Content-Encoding: this is a physical-byte provenance
      // endpoint, never the browser's normal compressed asset path.
      if (req.method === 'HEAD') return res.end?.();
      const stream = createReadStream(realFile);
      res.once?.('close', () => stream.destroy());
      stream.once('error', (error) => {
        if (!res.headersSent) sendError(res, 500, 'Receipt sidecar read failed.');
        else res.destroy?.(error);
      });
      stream.pipe(res);
    } catch {
      sendError(res, 404, 'Receipt sidecar is unavailable.');
    }
  });
  return { allowedPaths: [...allowed.keys()].sort(), root };
}

export const RAW_RECEIPT_ASSET_MAX_BYTES = MAX_SIDE_CAR_BYTES;
