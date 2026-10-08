import { safeReferenceUrl } from '../../src/evidence/evidence.js';

export const ARCHIVE_AVAILABILITY_URL = 'https://archive.org/wayback/available';
export const ARCHIVE_LOOKUP_TIMEOUT_MS = 10_000;
export const ARCHIVE_RESPONSE_LIMIT_BYTES = 256 * 1024;

async function readBodyCapped(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit)
      throw Object.assign(new Error('Request too large.'), {
        code: 'request-too-large',
      });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonCapped(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > ARCHIVE_RESPONSE_LIMIT_BYTES)
      throw new Error('Archive response too large.');
    return JSON.parse(text);
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ARCHIVE_RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error('Archive response too large.');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function respond(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

export function evidenceArchiveProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const install = ({ middlewares }) => {
    middlewares.use('/api/evidence/archive-lookup', async (req, res) => {
      if (req.method !== 'POST')
        return respond(res, 405, {
          error: 'method-not-allowed',
          message: 'POST is required.',
        });
      try {
        const body = JSON.parse(await readBodyCapped(req, 32 * 1024));
        const url = safeReferenceUrl(body?.url);
        if (!url)
          return respond(res, 400, {
            error: 'invalid-url',
            message: 'A public HTTPS URL is required.',
          });
        const timestamp =
          body.timestamp == null
            ? null
            : String(body.timestamp).replace(/\D/g, '').slice(0, 14);
        const target = new URL(ARCHIVE_AVAILABILITY_URL);
        target.searchParams.set('url', url);
        if (timestamp) target.searchParams.set('timestamp', timestamp);
        const response = await fetchImpl(target, {
          signal: AbortSignal.timeout(ARCHIVE_LOOKUP_TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        });
        if (response.status === 429)
          return respond(res, 429, {
            state: 'rate-limited',
            error: 'rate-limited',
            message: 'Archive service rate limited the lookup.',
          });
        if (!response.ok)
          return respond(res, 502, {
            state: 'failed',
            error: 'archive-upstream',
            message: 'Archive service did not return a lookup.',
          });
        const payload = await readJsonCapped(response);
        const closest = payload?.archived_snapshots?.closest;
        if (!closest?.available || typeof closest.url !== 'string')
          return respond(res, 200, { state: 'unavailable', requestedUrl: url });
        const archiveUrl = safeReferenceUrl(closest.url);
        if (!archiveUrl)
          return respond(res, 502, {
            state: 'malformed',
            error: 'malformed-response',
            message: 'Archive service returned an unsafe URL.',
          });
        return respond(res, 200, {
          state: 'available',
          requestedUrl: url,
          reference: {
            kind: 'archive',
            url: archiveUrl,
            originalUrl: url,
            archiveAt: /^\d{8,14}$/.test(String(closest.timestamp))
              ? Date.parse(
                  String(closest.timestamp)
                    .padEnd(14, '0')
                    .replace(
                      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
                      '$1-$2-$3T$4:$5:$6Z',
                    ),
                )
              : null,
            lookedUpAt: Date.now(),
            title: 'Internet Archive capture',
          },
        });
      } catch (error) {
        const code =
          error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'timeout'
            : error?.code === 'request-too-large' ||
                error instanceof SyntaxError
              ? 'malformed'
              : error?.code || 'archive-lookup-failed';
        return respond(
          res,
          code === 'malformed' ? 400 : code === 'timeout' ? 504 : 502,
          {
            state: code === 'malformed' ? 'malformed' : 'failed',
            error: code,
            message:
              code === 'malformed'
                ? 'Archive lookup request or response was malformed.'
                : code === 'timeout'
                  ? 'Archive lookup timed out.'
                  : 'Archive lookup failed.',
          },
        );
      }
    });
  };
  return {
    name: 'evidence-archive-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
