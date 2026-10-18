#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseEnv as parseDotEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BROWSER_HEADERS } from '../../build/securityHeaders.js';
import {
  isAllowedHost,
  resolveAllowedHosts,
} from '../../build/allowedHosts.js';
import { embedFramingPlugin } from '../../build/embed-framing.js';

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ktx2': 'image/ktx2',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
});

export async function loadOperatorEnv(root) {
  try {
    const values = parseDotEnv(
      await fs.readFile(path.join(root, '.env'), 'utf8'),
    );
    for (const [key, value] of Object.entries(values))
      if (process.env[key] === undefined) process.env[key] = value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function middlewareStack() {
  const entries = [];
  return {
    use(prefix, handler) {
      if (typeof prefix === 'function') {
        handler = prefix;
        prefix = '/';
      }
      entries.push({ prefix, handler });
    },
    handler(req, res) {
      let index = 0;
      const next = (error) => {
        if (error) {
          if (res.headersSent) return res.destroy();
          security(res);
          res.writeHead(500, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          return res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        const entry = entries[index++];
        if (!entry) return;
        const pathname = req.url?.split('?')[0] || '/';
        if (
          entry.prefix !== '/' &&
          pathname !== entry.prefix &&
          !pathname.startsWith(`${entry.prefix}/`)
        )
          return next();
        const previous = req.url;
        req.originalUrl ??= req.url;
        if (entry.prefix !== '/') {
          req.url = req.url.slice(entry.prefix.length) || '/';
          if (req.url.startsWith('?')) req.url = `/${req.url}`;
        }
        let called = false;
        const restore = () => {
          req.url = previous;
        };
        const proceed = (errorValue) => {
          if (called) return;
          called = true;
          restore();
          next(errorValue);
        };
        try {
          const result = entry.handler(req, res, proceed);
          if (result?.then) result.catch(proceed);
        } catch (caught) {
          proceed(caught);
        }
      };
      next();
    },
  };
}

function security(res) {
  for (const [key, value] of Object.entries(BROWSER_HEADERS))
    res.setHeader(key, value);
}

function parseAcceptEncoding(header = '') {
  const values = new Map();
  for (const token of header.toLowerCase().split(',')) {
    const [name, ...params] = token.trim().split(';');
    if (!name) continue;
    const q = Number(
      params.find((item) => item.trim().startsWith('q='))?.split('=')[1] ?? 1,
    );
    values.set(name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0);
  }
  return values;
}

function chooseEncoding(header, available) {
  const values = parseAcceptEncoding(header);
  const quality = (name) =>
    values.get(name) ?? values.get('*') ?? (name === 'identity' ? 1 : 0);
  return (
    [...available, 'identity']
      .filter((name) => quality(name) > 0)
      .sort((a, b) => quality(b) - quality(a))[0] || null
  );
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';
  const suffix = !match[1];
  let start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  let end = suffix ? size - 1 : match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return 'invalid';
  end = Math.min(end, size - 1);
  return { start, end };
}

function safePath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(`${root}${path.sep}`)
    ? target
    : null;
}

async function readManifest(root, { required = false } = {}) {
  try {
    const file = path.join(root, 'asset-manifest.json');
    if ((await fs.stat(file)).size > 16 * 1024 * 1024)
      throw new Error('Asset manifest exceeds size limit');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      manifest.schema !== 'gev-asset-manifest/v1' ||
      !Array.isArray(manifest.assets) ||
      manifest.assets.length > 100000
    )
      throw new Error('Invalid asset manifest schema');
    const seen = new Set();
    for (const entry of manifest.assets) {
      if (
        typeof entry.path !== 'string' ||
        entry.path.startsWith('/') ||
        entry.path.includes('\\') ||
        entry.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        !safePath(root, `/${entry.path}`) ||
        seen.has(entry.path)
      )
        throw new Error('Invalid or duplicate asset manifest path');
      if (
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        !['immutable', 'revalidate'].includes(entry.cache)
      )
        throw new Error('Invalid asset manifest metadata');
      seen.add(entry.path);
    }
    return manifest;
  } catch (error) {
    if (required || error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function regularFile(file, root = null) {
  if (root) {
    const realRoot = await fs.realpath(root).catch(() => null);
    const realFile = await fs.realpath(file).catch(() => null);
    if (
      !realRoot ||
      !realFile ||
      (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`))
    )
      return null;
  }
  const info = await fs.lstat(file).catch(() => null);
  return info?.isFile() && !info.isSymbolicLink() ? info : null;
}

export function createStaticHandler({ root, previousRoots = [] } = {}) {
  const currentRoot = path.resolve(root);
  const previous = previousRoots.map((item) => path.resolve(item));
  if (previous.length > 2)
    throw new Error('At most two verified previous asset roots are supported');
  const ready = Promise.all(
    [currentRoot, ...previous].map(async (directory) => ({
      root: directory,
      records: new Map(
        (await readManifest(directory, { required: true })).assets.map(
          (entry) => [entry.path, entry],
        ),
      ),
    })),
  );
  // A standalone handler may not be requested immediately. Expose startup
  // readiness without allowing an unhandled rejection before the host awaits it.
  ready.catch(() => {});
  const handler = async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // WHATWG URL parsing normalizes dot segments, so reject them before it can
    // turn a malformed asset request into a successful application document.
    let decoded;
    try {
      decoded = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      return next();
    }
    if (
      decoded.includes('\\') ||
      decoded.includes('\0') ||
      decoded.split('/').some((part) => part === '.' || part === '..')
    )
      return next();
    const url = new URL(req.url || '/', 'http://localhost');
    if (/^\/(?:api|mcp)(?:\/|$)/.test(url.pathname)) return next();
    if (/\/(?:\.env|package\.json|node_modules)(?:\/|$)/.test(decoded))
      return next();
    let target = safePath(currentRoot, url.pathname);
    if (!target) return next();
    let relative = path.relative(currentRoot, target).replaceAll(path.sep, '/');
    if (!relative) relative = 'index.html';
    target = path.join(currentRoot, relative);
    const [current, ...older] = await ready;
    let servingRoot = currentRoot;
    const records = current.records;
    let record = records.get(relative);
    if (!record) {
      for (const { root: candidate, records: candidateIndex } of older) {
        const candidateRecord = candidateIndex.get(relative);
        if (
          candidateRecord?.cache === 'immutable' &&
          (await regularFile(path.join(candidate, relative), candidate))
        ) {
          record = candidateRecord;
          servingRoot = candidate;
          target = path.join(candidate, relative);
          break;
        }
      }
    }
    if (!record) {
      if (url.pathname === '/' || !path.extname(relative)) {
        relative = 'index.html';
        target = path.join(currentRoot, relative);
        record = records.get(relative);
      }
    }
    if (!record || !(await regularFile(target, servingRoot))) return next();
    const available = [];
    for (const encoding of ['br', 'gzip'])
      if (
        record.contentEncoding?.includes(encoding) &&
        (await regularFile(
          `${target}.${encoding === 'br' ? 'br' : 'gz'}`,
          servingRoot,
        ))
      )
        available.push(encoding);
    const encoding = chooseEncoding(req.headers['accept-encoding'], available);
    if (!encoding) {
      security(res, req.url);
      res.writeHead(406);
      return res.end();
    }
    const source =
      encoding === 'br'
        ? `${target}.br`
        : encoding === 'gzip'
          ? `${target}.gz`
          : target;
    const etagValue =
      encoding === 'br'
        ? record.brotliSha256
        : encoding === 'gzip'
          ? record.gzipSha256
          : record.sha256;
    const etag = `"${
      etagValue ||
      createHash('sha256')
        .update(await fs.readFile(source))
        .digest('hex')
    }"`;
    security(res, req.url);
    res.setHeader(
      'Content-Type',
      MIME[path.extname(relative).toLowerCase()] || 'application/octet-stream',
    );
    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader(
      'Cache-Control',
      record.cache === 'immutable'
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
    if (
      req.headers['if-none-match']
        ?.split(',')
        .some(
          (value) =>
            value.trim() === '*' || value.trim().replace(/^W\//, '') === etag,
        )
    ) {
      res.writeHead(304);
      return res.end();
    }
    const stat = await regularFile(source, servingRoot);
    if (!stat) return next();
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    const ifRange = req.headers['if-range'];
    const rangeAllowed =
      !ifRange ||
      ifRange === etag ||
      (Number.isFinite(Date.parse(ifRange)) &&
        Math.floor(stat.mtimeMs / 1000) <=
          Math.floor(Date.parse(ifRange) / 1000));
    const range =
      req.method === 'GET' && rangeAllowed
        ? parseRange(req.headers.range, stat.size)
        : null;
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.writeHead(416);
      return res.end();
    }
    const status = range ? 206 : 200;
    const length = range ? range.end - range.start + 1 : stat.size;
    res.setHeader('Content-Length', length);
    if (range)
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${stat.size}`,
      );
    if (req.method === 'HEAD') {
      res.writeHead(status);
      return res.end();
    }
    res.writeHead(status);
    const stream = createReadStream(
      source,
      range ? { start: range.start, end: range.end } : undefined,
    );
    stream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(500);
      res.destroy(error);
    });
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  };
  handler.ready = ready;
  return handler;
}

export async function createProductionServer({
  root = process.cwd(),
  dist,
  host,
  port,
  previousRoots,
  plugins: suppliedPlugins,
  shutdownMs = 5000,
} = {}) {
  await loadOperatorEnv(root);
  dist ??= path.join(root, 'dist');
  host ??= process.env.HOST || '127.0.0.1';
  port ??= Number(process.env.PORT || 4173);
  previousRoots ??= (process.env.GEV_PREVIOUS_ASSET_ROOTS || '')
    .split(path.delimiter)
    .filter(Boolean);
  const staticHandler = createStaticHandler({ root: dist, previousRoots });
  await staticHandler.ready;
  const stack = middlewareStack();
  const allowedHosts = resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS);
  let plugins = suppliedPlugins;
  if (!plugins) {
    const { localProviderPlugins } = await import('../providers/local.js');
    const { localMcpPlugin } = await import('../mcp/plugin.js');
    const { standaloneVoiceTools } =
      await import('../standalone/voiceTools.js');
    plugins = [
      ...localProviderPlugins({ realtime: { tools: standaloneVoiceTools() } }),
      localMcpPlugin(),
    ];
  }
  const server = http.createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, allowedHosts, [host])) {
      security(res);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Blocked request. This host is not allowed.');
    }
    stack.handler(req, res);
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const context = {
    middlewares: stack,
    httpServer: server,
    config: { server: { host }, preview: { host } },
  };
  embedFramingPlugin().configurePreviewServer?.(context);
  stack.use((_req, res, next) => {
    security(res);
    next();
  });
  for (const plugin of plugins.flat(Infinity).filter(Boolean))
    await plugin.configurePreviewServer?.(context);
  stack.use('/api', (_req, res) => {
    security(res);
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Unknown API route' }));
  });
  stack.use(staticHandler);
  stack.use((_req, res) => {
    security(res);
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end('Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  let closing;
  const close = () =>
    (closing ??= new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
      }, shutdownMs);
      deadline.unref();
      server.close((error) => {
        clearTimeout(deadline);
        if (error) reject(error);
        else resolve();
      });
    }));
  return { server, address: server.address(), close };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const instance = await createProductionServer();
  process.once('SIGINT', () => instance.close().finally(() => process.exit(0)));
  process.once('SIGTERM', () =>
    instance.close().finally(() => process.exit(0)),
  );
  console.log(
    `Production host listening on ${instance.address.address}:${instance.address.port}`,
  );
}
