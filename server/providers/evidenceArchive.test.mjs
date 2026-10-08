import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { evidenceArchiveProxy } from './evidenceArchive.js';

function invoke(fetchImpl, body, { status = 200, payload } = {}) {
  let handler;
  evidenceArchiveProxy({ fetchImpl }).configureServer({
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
  request.url = '/';
  return handler(request, response).then(() => ({ response, payload }));
}

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
