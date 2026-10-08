import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { evidenceArchiveProxy } from './evidenceArchive.js';

function invoke(
  fetchImpl,
  body,
  { status = 200, payload, headers = {}, timeoutMs, plugin } = {},
) {
  let handler;
  (plugin || evidenceArchiveProxy({ fetchImpl, timeoutMs })).configureServer({
    middlewares: {
      use: (_path, next) => {
        handler = next;
      },
    },
  });
  const response = {
    status,
    headers: null,
    body: '',
    setHeader() {},
    writeHead(code, headers) {
      this.status = code;
      this.headers = headers;
    },
    end(value = '') {
      this.body = value;
    },
  };
  const request = Readable.from([JSON.stringify(body)]);
  request.method = 'POST';
  request.headers = headers;
  request.url = '/';
  return handler(request, response).then(() => ({ response, payload }));
}

test('proxy rejects cross-site calls before consuming or fetching', async () => {
  let calls = 0;
  const { response } = await invoke(
    async () => {
      calls++;
    },
    { url: 'https://example.test' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  );
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 0);
});

test('proxy canonicalizes documented HTTP Wayback URLs and forbids redirects', async () => {
  const { response } = await invoke(
    async (url, options) => {
      assert.equal(new URL(url).origin, 'https://archive.org');
      assert.equal(options.redirect, 'error');
      return Response.json({
        archived_snapshots: {
          closest: {
            available: true,
            status: '200',
            url: 'http://web.archive.org/web/20200101120000/https://example.test/',
            timestamp: '20200101120000',
          },
        },
      });
    },
    { url: 'https://example.test' },
  );
  assert.match(
    JSON.parse(response.body).reference.url,
    /^https:\/\/web\.archive\.org\//,
  );
});

test('proxy distinguishes malformed responses and caps response bytes', async () => {
  for (const body of [
    '{}',
    '{bad',
    JSON.stringify({ archived_snapshots: {}, padding: 'x'.repeat(256 * 1024) }),
  ]) {
    const { response } = await invoke(async () => new Response(body), {
      url: 'https://example.test',
    });
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(response.body).state, 'malformed');
  }
});

test('proxy deadline includes a stalled response body', async () => {
  const { response } = await invoke(
    async () => new Response(new ReadableStream({ start() {} })),
    { url: 'https://example.test' },
    { timeoutMs: 10 },
  );
  assert.equal(response.status, 504);
});

test('server coalesces separate browser clients into one provider call', async () => {
  let calls = 0;
  const plugin = evidenceArchiveProxy({
    fetchImpl: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ archived_snapshots: {} });
    },
  });
  const responses = await Promise.all(
    [1, 2, 3].map(() =>
      invoke(null, { url: 'https://example.test' }, { plugin }),
    ),
  );
  assert.equal(calls, 1);
  assert.ok(responses.every(({ response }) => response.status === 200));
});

test('archive proxy returns a normalized closest capture', async () => {
  let requested;
  const result = await invoke(
    async (url) => {
      requested = new URL(url);
      return new Response(
        JSON.stringify({
          archived_snapshots: {
            closest: {
              available: true,
              url: 'https://web.archive.org/web/20200101120000/https://example.test/page',
              timestamp: '20200101120000',
              status: '200',
            },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
    { url: 'https://example.test/page', timestamp: '20200101' },
  );
  assert.equal(requested.origin, 'https://archive.org');
  assert.equal(requested.pathname, '/wayback/available');
  assert.equal(result.response.status, 200);
  const body = JSON.parse(result.response.body);
  assert.equal(body.state, 'available');
  assert.equal(body.reference.kind, 'archive');
  assert.equal(body.reference.archiveAt, Date.parse('2020-01-01T12:00:00Z'));
});

test('archive proxy distinguishes unavailable and rejects unsafe input', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ archived_snapshots: {} }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const unavailable = await invoke(fetchImpl, {
    url: 'https://example.test/page',
  });
  assert.equal(JSON.parse(unavailable.response.body).state, 'unavailable');
  const unsafe = await invoke(fetchImpl, { url: 'http://127.0.0.1/private' });
  assert.equal(unsafe.response.status, 400);
  assert.equal(calls, 1);
});

test('archive proxy labels rate limits and malformed provider responses', async () => {
  const limited = await invoke(
    async () =>
      new Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    { url: 'https://example.test/page' },
  );
  assert.equal(JSON.parse(limited.response.body).state, 'rate-limited');

  const malformed = await invoke(
    async () =>
      new Response(
        '{"archived_snapshots":{"closest":{"available":true,"url":"javascript:bad"}}}',
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    { url: 'https://example.test/page' },
  );
  assert.equal(malformed.response.status, 502);
  assert.equal(JSON.parse(malformed.response.body).state, 'malformed');
});
