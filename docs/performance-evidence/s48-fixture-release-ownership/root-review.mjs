import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const file = path.join(root, 'scripts/performance/fixtureInterception.mjs');
const { interceptFixtureSession } = await import(pathToFileURL(file));
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = url => ({ requestId: 'owned-request', request: { url, method: 'GET' } });
const results = [];
async function check(name, execute) {
  try { results.push({ name, status: 'passed', evidence: await execute() }); }
  catch (error) { results.push({ name, status: 'failed', error: error.stack }); }
}
function makeClient() {
  const client = new EventEmitter();
  const commands = [], errors = [];
  let targetClosed = false;
  client.send = async method => {
    commands.push(method);
    assert.equal(targetClosed, false, 'No protocol commands after target closure');
    assert.notEqual(method, 'Fetch.disable', 'Keep isolation until target closure');
  };
  return { client, commands, errors, close() { targetClosed = true; commands.push('target-close'); } };
}

await check('cancel delayed external and API preparation before target closure', async () => {
  const observations = [];
  for (const url of ['https://external.invalid/data', 'https://fixture.invalid/api/private']) {
    const harness = makeClient();
    let resolveResponse;
    let signal;
    const otherListener = () => {};
    harness.client.on('Fetch.requestPaused', otherListener);
    const controller = await interceptFixtureSession(harness.client, 'https://fixture.invalid/',
      (_url, request) => { signal = request.signal; return new Promise(resolve => { resolveResponse = resolve; }); },
      error => harness.errors.push(error.message));
    harness.client.emit('Fetch.requestPaused', event(url));
    await tick();
    const stopped = await controller.stopAndDrain();
    assert.equal(stopped.confirmed, true);
    assert.equal(stopped.pendingPreparationsAfterDrain, 0);
    assert.deepEqual(harness.client.listeners('Fetch.requestPaused'), [otherListener]);
    assert.equal(signal.aborted, true);
    harness.close();
    const release = await controller.releaseSession({ targetClosed: true });
    assert.equal(release.confirmed, true);
    resolveResponse({ status: 200, body: 'retired response' });
    await tick();
    assert.deepEqual(harness.commands, ['Fetch.enable', 'target-close']);
    assert.deepEqual(harness.errors, []);
    observations.push({ kind: url.includes('/api/') ? 'same-origin-api' : 'external', commands: harness.commands, stopped, release });
  }
  return observations;
});

await check('completed requests release abort subscriptions while session stays active', async () => {
  const harness = makeClient();
  const signals = new Set();
  const controller = await interceptFixtureSession(harness.client, 'https://fixture.invalid/',
    (_url, request) => { signals.add(request.signal); return { status: 200, body: 'fixture' }; },
    error => harness.errors.push(error.message));
  for (let index = 0; index < 50; index++) {
    harness.client.emit('Fetch.requestPaused', event('https://fixture.invalid/api/data'));
    await tick();
  }
  assert.ok(signals.size);
  for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0);
  const stopped = await controller.stopAndDrain();
  assert.equal(stopped.confirmed, true);
  assert.equal(stopped.pendingPreparationsAfterDrain, 0);
  return { requests: 50, abortListenerCountAfterRequests: 0, errorCount: harness.errors.length, stopped };
});

await check('issued command failure is drained and retained in evidence', async () => {
  const harness = makeClient();
  let rejectCommand;
  harness.client.send = async method => {
    harness.commands.push(method);
    if (method === 'Fetch.fulfillRequest') return new Promise((_resolve, reject) => { rejectCommand = reject; });
  };
  const controller = await interceptFixtureSession(harness.client, 'https://fixture.invalid/',
    () => ({ status: 200, body: 'fixture' }), error => harness.errors.push(error.message));
  harness.client.emit('Fetch.requestPaused', event('https://fixture.invalid/api/data'));
  await tick();
  assert.equal(typeof rejectCommand, 'function');
  let drained = false;
  const pendingStop = controller.stopAndDrain().then(result => { drained = true; return result; });
  await tick();
  assert.equal(drained, false);
  rejectCommand(new Error('sentinel-issued-command-failure'));
  const stopped = await pendingStop;
  assert.equal(stopped.confirmed, false, 'Issued command failures must not become passes');
  assert.equal(stopped.pendingCommandsAfterDrain, 0);
  assert.equal(stopped.pendingPreparationsAfterDrain, 0);
  assert.ok(harness.errors.includes('sentinel-issued-command-failure'));
  harness.close();
  const release = await controller.releaseSession({ targetClosed: true });
  assert.equal(release.confirmed, false);
  return { commands: harness.commands, errors: harness.errors, stopped, release };
});

await check('copied late listener cannot command a closed target', async () => {
  const harness = makeClient();
  const controller = await interceptFixtureSession(harness.client, 'https://fixture.invalid/',
    () => null, error => harness.errors.push(error.message));
  const listener = harness.client.listeners('Fetch.requestPaused')[0];
  await controller.stopAndDrain();
  harness.close();
  await controller.releaseSession({ targetClosed: true });
  await listener(event('https://external.invalid/late'));
  await tick();
  assert.deepEqual(harness.commands, ['Fetch.enable', 'target-close']);
  return { commands: harness.commands, errors: harness.errors };
});

const report = {
  schema: 'gev-fixture-release-root-review/v1',
  scope: 'actual interception module; controlled responder and protocol session, no browser/network',
  sourceSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  results, passed: results.every(result => result.status === 'passed'),
};
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
