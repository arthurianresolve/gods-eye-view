import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sharedPanelKey } from '../../server/mcp/panelKey.js';
import { createLocalMcpServer } from '../../server/mcp/server.js';

const PANEL_KEY_MODULE = new URL(
  '../../server/mcp/panelKey.js',
  import.meta.url,
).href;

function tempKeyFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-panel-key-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state', 'mcp-panel-key');
}

const readPage = async (server) => {
  const page = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: 'ui://gods-eye-view/globe' },
  });
  return page.result.contents[0].text.match(/"panelKey":"([^"]+)"/)[1];
};
const panelRequest = (server, key) =>
  server.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'panel_request',
      arguments: { key, path: '/panel/index.html' },
    },
  });
const serverWith = (panelKey) =>
  createLocalMcpServer({
    apiBase: 'http://127.0.0.1:5000',
    fetchImpl: async () => new Response('ok'),
    ...(panelKey ? { panelKey } : {}),
  });

test('a panel page from one server process is refused by another without a shared key (#927)', async () => {
  const pageServer = serverWith();
  const requestServer = serverWith();
  const key = await readPage(pageServer);
  const refused = await panelRequest(requestServer, key);
  assert.equal(refused.result.isError, true);
  assert.match(
    refused.result.content[0].text,
    /Only the God's Eye View panel may make this request/,
  );
});

test('servers sharing the install key accept each other’s panel page', async (t) => {
  const file = tempKeyFile(t);
  const pageServer = serverWith(sharedPanelKey({ file }));
  const requestServer = serverWith(sharedPanelKey({ file }));
  const key = await readPage(pageServer);
  const opened = await panelRequest(requestServer, key);
  assert.equal(opened.result.isError, false);
});

test('the shared key is created once, kept, and private to the user', (t) => {
  const file = tempKeyFile(t);
  const first = sharedPanelKey({ file });
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sharedPanelKey({ file }), first);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), first);
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // No staging files are left beside it.
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['mcp-panel-key']);
});

test('a malformed key file is replaced', (t) => {
  const file = tempKeyFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not a key\n');
  const key = sharedPanelKey({ file });
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sharedPanelKey({ file }), key);
});

test('when the key cannot be stored, the process uses a key of its own', (t) => {
  const file = tempKeyFile(t);
  // A file where the directory should be makes every write fail.
  fs.writeFileSync(path.dirname(path.dirname(file)) + '/state', 'blocker');
  const logged = [];
  const a = sharedPanelKey({ file, log: (line) => logged.push(line) });
  const b = sharedPanelKey({ file, log: (line) => logged.push(line) });
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /panel key not shared/);
});

test('processes starting at the same moment agree on one key', async (t) => {
  const file = tempKeyFile(t);
  const script =
    `const { sharedPanelKey } = await import(${JSON.stringify(PANEL_KEY_MODULE)});` +
    `process.stdout.write(sharedPanelKey({ file: ${JSON.stringify(file)} }));`;
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', script],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)),
      );
    });
  const keys = await Promise.all(Array.from({ length: 8 }, run));
  assert.equal(new Set(keys).size, 1);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), keys[0]);
});

test('concurrent malformed-file repairs return the same persisted key', async (t) => {
  const file = tempKeyFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not a key\n');
  const script = `
    import fs from 'node:fs';
    const { sharedPanelKey } = await import(${JSON.stringify(PANEL_KEY_MODULE)});
    const [file, marker, other] = process.argv.slice(1);
    const original = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = function (target, ...args) {
      const text = original.call(this, target, ...args);
      if (target === file && ++reads === 2) {
        // Both processes capture the actual malformed contents before either
        // can replace them. The old unchecked rename returns two different keys.
        fs.writeFileSync(marker, 'ready');
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(other)) {
          if (Date.now() >= deadline) throw new Error('repair barrier timed out');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      return text;
    };
    const rename = fs.renameSync;
    fs.renameSync = function (from, to, ...args) {
      if (to === file && from.endsWith('.tmp')) {
        const error = new Error('injected destination replacement failure');
        error.code = 'EPERM';
        throw error;
      }
      return rename.call(this, from, to, ...args);
    };
    const fallbackLogs = [];
    const key = sharedPanelKey({ file, log: (line) => fallbackLogs.push(line) });
    process.stdout.write(key);
    process.stderr.write(JSON.stringify({ fallbackLogs }));
  `;
  const run = (index) =>
    new Promise((resolve, reject) => {
      const marker = (id) => path.join(path.dirname(file), `ready-${id}`);
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          script,
          file,
          marker(index),
          marker(1 - index),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      t.after(() => child.kill());
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`exit ${code}`));
        let diagnostics;
        try {
          diagnostics = JSON.parse(err);
        } catch {
          return reject(new Error('child fallback diagnostics were malformed'));
        }
        resolve({ key: out, diagnostics });
      });
    });
  const children = await Promise.all([run(0), run(1)]);
  const childDiagnostics = children.map(({ diagnostics }, index) => ({
    child: index,
    fallbackLogs: diagnostics.fallbackLogs,
  }));
  const safeDiagnostics = JSON.stringify(childDiagnostics);
  assert.equal(
    children.every(({ key }) => /^[A-Za-z0-9_-]{43}$/.test(key)),
    true,
    `child output was not a panel key; safe fallback diagnostics: ${safeDiagnostics}`,
  );
  assert.equal(
    children.every(({ key }) => !safeDiagnostics.includes(key)),
    true,
    'fallback diagnostics must not contain any panel key values',
  );
  assert.equal(
    new Set(children.map(({ key }) => key)).size,
    1,
    `concurrent panel-key children disagreed; safe fallback diagnostics: ${safeDiagnostics}`,
  );
  assert.equal(
    fs.readFileSync(file, 'utf8').trim() === children[0].key,
    true,
    `persisted panel key disagreed; safe fallback diagnostics: ${safeDiagnostics}`,
  );
  assert.equal(fs.existsSync(`${file}.repair-lock`), false);
  assert.equal(
    fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('malformed-key repair falls back to no-overwrite publication when rename returns EPERM', async (t) => {
  const file = tempKeyFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not a key\n');
  const script = `
    import fs from 'node:fs';
    const { sharedPanelKey } = await import(${JSON.stringify(PANEL_KEY_MODULE)});
    const [file] = process.argv.slice(1);
    const rename = fs.renameSync;
    fs.renameSync = function (from, to, ...args) {
      if (to === file && from.endsWith('.tmp')) {
        const error = new Error('injected destination replacement failure');
        error.code = 'EPERM';
        throw error;
      }
      return rename.call(this, from, to, ...args);
    };
    const fallbackLogs = [];
    const key = sharedPanelKey({ file, log: (line) => fallbackLogs.push(line) });
    process.stdout.write(JSON.stringify({ key, fallbackLogs }));
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script, file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    t.after(() => child.kill());
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`exit ${code}: ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('child repair result was malformed'));
      }
    });
  });
  assert.match(result.key, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(result.fallbackLogs, []);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), result.key);
  assert.equal(fs.existsSync(`${file}.repair-lock`), false);
  assert.equal(
    fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('an unavailable repair lock falls back without hanging or removing its owner’s lock', (t) => {
  const file = tempKeyFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not a key\n');
  fs.writeFileSync(`${file}.repair-lock`, 'held');
  const logged = [];
  const key = sharedPanelKey({ file, log: (line) => logged.push(line) });
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.match(logged[0], /ETIMEDOUT/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a key\n');
  assert.equal(fs.readFileSync(`${file}.repair-lock`, 'utf8'), 'held');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), [
    'mcp-panel-key',
    'mcp-panel-key.repair-lock',
  ]);
});
