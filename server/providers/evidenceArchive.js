import { safeReferenceUrl } from '../../src/evidence/evidence.js';
import {
  archiveTimestamp,
  createArchiveLookup,
} from '../../src/evidence/archiveLookup.js';
import { admitSameSite } from './common/same-site.js';

export const ARCHIVE_AVAILABILITY_URL = 'https://archive.org/wayback/available';
export const ARCHIVE_LOOKUP_TIMEOUT_MS = 10_000;
export const ARCHIVE_RESPONSE_LIMIT_BYTES = 256 * 1024;

function failure(code, message, state = 'failed') {
  return Object.assign(new Error(message), { code, state });
}

async function readBodyCapped(request, signal) {
  let size = 0;
  const chunks = [];
  const abort = () => request.destroy(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of request) {
      signal.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 32 * 1024)
        throw failure('request-too-large', 'Request too large.', 'malformed');
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function readJsonCapped(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader)
    throw failure(
      'malformed-response',
      'Archive response has no body.',
      'malformed',
    );
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > ARCHIVE_RESPONSE_LIMIT_BYTES)
        throw failure(
          'malformed-response',
          'Archive response exceeds 256 KiB.',
          'malformed',
        );
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw failure(
        'malformed-response',
        'Archive response is not JSON.',
        'malformed',
      );
    }
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function normalizeCapture(payload, url, timestamp, now) {
  const snapshots = payload?.archived_snapshots;
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots))
    throw failure(
      'malformed-response',
      'Archive response has no snapshot data.',
      'malformed',
    );
  const closest = snapshots.closest;
  if (closest == null || closest.available === false)
    return {
      state: 'unavailable',
      requestedUrl: url,
      requestedTimestamp: timestamp,
    };
  try {
    if (
      closest.available !== true ||
      String(closest.status) !== '200' ||
      !/^\d{14}$/.test(closest.timestamp)
    )
      throw new Error();
    archiveTimestamp(closest.timestamp);
    const capture = new URL(closest.url);
    // The documented API sometimes returns HTTP Wayback links. Canonicalize only
    // this fixed archive host to HTTPS; never retrieve the link or its contents.
    if (
      !['http:', 'https:'].includes(capture.protocol) ||
      capture.hostname !== 'web.archive.org' ||
      capture.username ||
      capture.password ||
      capture.port ||
      !capture.pathname.startsWith('/web/' + closest.timestamp + '/')
    )
      throw new Error();
    capture.protocol = 'https:';
    const archiveUrl = safeReferenceUrl(capture.href);
    if (!archiveUrl) throw new Error();
    return {
      state: 'available',
      requestedUrl: url,
      requestedTimestamp: timestamp,
      reference: {
        kind: 'archive',
        url: archiveUrl,
        originalUrl: url,
        archiveAt: Date.parse(
          closest.timestamp.replace(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
            '$1-$2-$3T$4:$5:$6Z',
          ),
        ),
        lookedUpAt: now(),
        title: 'Internet Archive capture',
      },
    };
  } catch {
    throw failure(
      'malformed-response',
      'Archive service returned an invalid capture.',
      'malformed',
    );
  }
}

function respond(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** One bounded pool per plugin instance, shared by all browser clients. */
export function evidenceArchiveProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = ARCHIVE_LOOKUP_TIMEOUT_MS,
} = {}) {
  const lookups = createArchiveLookup({
    now,
    timeoutMs,
    requestImpl: async ({ url, timestamp, signal }) => {
      const target = new URL(ARCHIVE_AVAILABILITY_URL);
      target.searchParams.set('url', url);
      if (timestamp) target.searchParams.set('timestamp', timestamp);
      const response = await fetchImpl(target, {
        signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429)
        throw failure(
          'rate-limited',
          'Archive service rate limited the lookup.',
          'rate-limited',
        );
      if (!response.ok)
        throw failure(
          'archive-upstream',
          'Archive service did not return a lookup.',
        );
      return normalizeCapture(
        await readJsonCapped(response, signal),
        url,
        timestamp,
        now,
      );
    },
  });
  const install = ({ middlewares }) => {
    middlewares.use('/api/evidence/archive-lookup', async (req, res) => {
      if ((req.url || '/').split('?')[0] !== '/')
        return respond(res, 404, { error: 'not-found' });
      if (admitSameSite(req, res)) return;
      if (req.method !== 'POST')
        return respond(res, 405, {
          error: 'method-not-allowed',
          message: 'POST is required.',
        });
      const controller = new AbortController();
      const disconnect = () =>
        controller.abort(
          new DOMException('Client disconnected.', 'AbortError'),
        );
      req.on?.('aborted', disconnect);
      res.on?.('close', disconnect);
      let requestBody = true;
      // Bound body receipt as well as the shared provider lookup.
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException('Archive lookup timed out.', 'TimeoutError'),
          ),
        timeoutMs,
      );
      try {
        const body = await readBodyCapped(req, controller.signal);
        const url = safeReferenceUrl(body?.url);
        if (!url)
          return respond(res, 400, {
            state: 'malformed',
            error: 'invalid-url',
            message: 'A public HTTPS URL is required.',
          });
        let timestamp;
        try {
          timestamp = archiveTimestamp(body.timestamp);
        } catch (error) {
          return respond(res, 400, {
            state: 'malformed',
            error: 'invalid-timestamp',
            message: error.message,
          });
        }
        requestBody = false;
        const result = await lookups.lookup({
          url,
          timestamp,
          signal: controller.signal,
        });
        return respond(res, 200, result);
      } catch (error) {
        const timeout = error?.name === 'TimeoutError';
        const malformed =
          error?.state === 'malformed' || error instanceof SyntaxError;
        const status = timeout
          ? 504
          : error?.code === 'rate-limited'
            ? 429
            : error?.code === 'request-too-large'
              ? 413
              : malformed
                ? requestBody
                  ? 400
                  : 502
                : 502;
        return respond(res, status, {
          state: timeout
            ? 'failed'
            : malformed
              ? 'malformed'
              : error?.state || 'failed',
          error: timeout
            ? 'timeout'
            : error?.code ||
              (malformed ? 'malformed-response' : 'archive-lookup-failed'),
          message: timeout
            ? 'Archive lookup timed out.'
            : malformed
              ? 'Archive lookup data was malformed.'
              : 'Archive lookup failed.',
        });
      } finally {
        clearTimeout(timer);
        req.off?.('aborted', disconnect);
        res.off?.('close', disconnect);
      }
    });
  };
  return {
    name: 'evidence-archive-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
