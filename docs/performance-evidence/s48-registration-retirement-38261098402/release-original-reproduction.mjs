import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const file = path.join(root, 'scripts/performance/fixtureInterception.mjs');
const { interceptFixtureSession } = await import(pathToFileURL(file));
const client = new EventEmitter();
const commands = [], errors = [];
let enabled = false, stage = 'active', resolveResponse;
const response = new Promise(resolve => { resolveResponse = resolve; });
client.send = async method => {
  commands.push({ method, enabled, stage });
  if (method === 'Fetch.enable') { enabled = true; return; }
  if (method === 'Fetch.disable') { enabled = false; return; }
  if (!enabled) throw new Error(`Protocol error (${method}): Fetch domain is not enabled`);
};
await interceptFixtureSession(client, 'https://fixture.invalid/', () => response,
  (error, context) => errors.push({ message: error.message, ...context }),
  { getErrorContext: () => ({ lifecycleStage: stage }) });
client.emit('Fetch.requestPaused', {
  requestId: 'fixture-pending', request: { url: 'https://fixture.invalid/worker.js', method: 'GET' },
});
await new Promise(resolve => setImmediate(resolve));
stage = 'releasing';
await client.send('Fetch.disable');
resolveResponse(undefined);
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
const report = {
  schema: 'gev-fixture-release-original-reproduction/v1',
  scope: 'real interception implementation with controlled responder and protocol-session stub; no browser or network',
  sourceSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  commands, errors,
  listenerCountAfterDisable: client.listenerCount('Fetch.requestPaused'),
  reproduced: errors.some(e => e.phase === 'command-send' && e.lifecycleStage === 'releasing'
    && e.message.includes('Fetch.continueRequest') && e.message.includes('Fetch domain is not enabled')),
};
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.reproduced ? 0 : 1;
