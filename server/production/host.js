#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_HEADERS } from '../../build/securityHeaders.js';
import { isAllowedHost, resolveAllowedHosts } from '../../build/allowedHosts.js';
import { isEmbedDocumentRequest } from '../../build/embed-framing.js';

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

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

export async function loadOperatorEnv(root) {
  try {
    const values = parseEnvFile(await fs.readFile(path.join(root, '.env'), 'utf8'));
    for (const [key, value] of Object.entries(values))
      if (process.env[key] === undefined) process.env[key] = value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function middlewareStack() {
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
        if (error) return res.destroy(error);
        const entry = entries[index++];
        if (!entry) return;
        const pathname = req.url?.split('?')[0] || '/';
        if (entry.prefix !== '/' && pathname !== entry.prefix && !pathname.startsWith(`${entry.prefix}/`)) return next();
        const previous = req.url;
        if (entry.prefix !== '/') req.url = req.url.slice(entry.prefix.length) || '/';
        let called = false;
        const restore = () => { req.url = previous; };
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

function security(res, requestUrl = '') {
  for (const [key, value] of Object.entries(BROWSER_HEADERS)) res.setHeader(key, value);
  const ancestors = process.env.GEV_EMBED_FRAME_ANCESTORS;
  if (ancestors && isEmbedDocumentRequest(requestUrl)) {
    res.setHeader('Content-Security-Policy', BROWSER_HEADERS['Content-Security-Policy'].replace('frame-ancestors \'none\'', `frame-ancestors ${ancestors}`));
  }
}

function parseAcceptEncoding(header = '') {
  const values = new Map();
  for (const token of header.toLowerCase().split(',')) {
    const [name, ...params] = token.trim().split(';');
    if (!name) continue;
    const q = Number(params.find((item) => item.trim().startsWith('q='))?.split('=')[1] ?? 1);
    values.set(name, Number.isFinite(q) ? q : 0);
  }
  return values;
}

function chooseEncoding(header, available) {
  const values = parseAcceptEncoding(header);
  const quality = (name) => values.get(name) ?? values.get('*') ?? (name === 'identity' ? 1 : 0);
  return [...available, 'identity'].filter((name) => quality(name) > 0).sort((a, b) => quality(b) - quality(a))[0] || null;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return 'invalid';
  end = Math.min(end, size - 1);
  return { start, end };
}

function safePath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function readManifest(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, 'asset-manifest.json'), 'utf8')); }
  catch { return null; }
}

export function createStaticHandler({ root, previousRoots = [] } = {}) {
  const currentRoot = path.resolve(root);
  const previous = previousRoots.map((item) => path.resolve(item));
  let manifestPromise = readManifest(currentRoot);
  const handler = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) return next();
    if (/\/(?:\.env|package\.json|node_modules)(?:\/|$)/.test(url.pathname)) return next();
    let target = safePath(currentRoot, url.pathname);
    if (!target) return next();
    let relative = path.relative(currentRoot, target).replaceAll(path.sep, '/');
    if (!relative) relative = 'index.html';
    target = path.join(currentRoot, relative);
    let manifest = await manifestPromise;
    let servingRoot = currentRoot;
    let record = manifest?.assets?.find((entry) => entry.path === relative);
    if (!record) {
      for (const candidate of previous) {
        const candidateManifest = await readManifest(candidate);
        const candidateRecord = candidateManifest?.assets?.find((entry) => entry.path === relative && entry.cache === 'immutable');
        if (candidateRecord && await fs.stat(path.join(candidate, relative)).catch(() => null)) {
          servingRoot = candidate;
          manifest = candidateManifest;
          record = candidateRecord;
          target = path.join(candidate, relative);
          break;
        }
      }
    }
    if (!record) {
      if (url.pathname === '/' || !path.extname(relative)) {
        relative = 'index.html';
        target = path.join(currentRoot, relative);
        record = manifest?.assets?.find((entry) => entry.path === relative);
      }
    }
    if (!record || !(await fs.stat(target).catch(() => null))) return next();
    const available = [];
    for (const encoding of ['br', 'gzip'])
      if (await fs.stat(`${target}.${encoding === 'br' ? 'br' : 'gz'}`).catch(() => null)) available.push(encoding);
    const encoding = chooseEncoding(req.headers['accept-encoding'], available);
    if (!encoding) { security(res, req.url); res.writeHead(406); return res.end(); }
    const source = encoding === 'br' ? `${target}.br` : encoding === 'gzip' ? `${target}.gz` : target;
    const etagValue = record.sha256 || createHash('sha256').update(await fs.readFile(target)).digest('hex');
    const etag = `"${etagValue}${encoding === 'identity' ? '' : `-${encoding}`}"`;
    security(res, req.url);
    res.setHeader('Content-Type', MIME[path.extname(relative).toLowerCase()] || 'application/octet-stream');
    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', record.cache === 'immutable' ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    const stat = await fs.stat(source);
    const range = parseRange(req.headers.range, stat.size);
    if (range === 'invalid') { res.setHeader('Content-Range', `bytes */${stat.size}`); res.writeHead(416); return res.end(); }
    const status = range ? 206 : 200;
    const length = range ? range.end - range.start + 1 : stat.size;
    res.setHeader('Content-Length', length);
    if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    if (req.method === 'HEAD') { res.writeHead(status); return res.end(); }
    res.writeHead(status);
    createReadStream(source, range ? { start: range.start, end: range.end } : undefined).pipe(res);
  };
  return handler;
}

export async function createProductionServer({ root = process.cwd(), dist, host, port, previousRoots = [] } = {}) {
  await loadOperatorEnv(root);
  dist ??= path.join(root, 'dist');
  host ??= process.env.HOST || '127.0.0.1';
  port ??= Number(process.env.PORT || 4173);
  const stack = middlewareStack();
  const allowedHosts = resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS);
  const { localProviderPlugins } = await import('../providers/local.js');
  const { localMcpPlugin } = await import('../mcp/plugin.js');
  const { standaloneVoiceTools } = await import('../standalone/voiceTools.js');
  const plugins = [...localProviderPlugins({ realtime: { tools: standaloneVoiceTools() } }), localMcpPlugin()]
    .flat(Infinity).filter(Boolean);
  const server = http.createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, allowedHosts, [host])) {
      security(res); res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Blocked request. This host is not allowed.');
    }
    stack.handler(req, res);
  });
  for (const plugin of plugins) plugin.configurePreviewServer?.({ middlewares: stack, httpServer: server, config: { server: { host }, preview: { host } } });
  stack.use('/api', (_req, res) => { security(res); res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Unknown API route' })); });
  stack.use(createStaticHandler({ root: dist, previousRoots }));
  stack.use((_req, res) => { security(res); res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Not found'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, address: server.address(), close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createProductionServer();
  process.once('SIGINT', () => instance.close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => instance.close().finally(() => process.exit(0)));
  console.log(`Production host listening on ${instance.address.address}:${instance.address.port}`);
}
