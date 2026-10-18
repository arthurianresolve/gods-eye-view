import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_BROWSER_TRACE_BYTES,
  startBrowserTrace,
} from './captureBrowserTrace.mjs';

async function tempOutput(t, name = 'trace.json') {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gev-browser-trace-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, name);
}

class FakeSession extends EventEmitter {
  constructor({
    chunk = '{"traceEvents":[]}',
    startError = null,
    missingStream = false,
    categories = [],
    earlyCompletion = false,
    dataLossOccurred = false,
    startDelay = 0,
    completionFormat = undefined,
    bufferUsageEvent = null,
  } = {}) {
    super();
    this.chunk = chunk;
    this.startError = startError;
    this.missingStream = missingStream;
    this.categories = categories;
    this.earlyCompletion = earlyCompletion;
    this.dataLossOccurred = dataLossOccurred;
    this.startDelay = startDelay;
    this.completionFormat = completionFormat;
    this.bufferUsageEvent = bufferUsageEvent;
    this.commands = [];
    this.detached = false;
  }

  async send(command, params) {
    this.commands.push([command, params]);
    if (command === 'Tracing.start' && this.startDelay)
      await new Promise((resolve) => setTimeout(resolve, this.startDelay));
    if (command === 'Tracing.start' && this.startError) throw this.startError;
    if (command === 'Tracing.getCategories')
      return { categories: this.categories };
    if (command === 'Tracing.start' && this.earlyCompletion)
      queueMicrotask(() =>
        this.emit('Tracing.tracingComplete', {
          stream: 'stream-1',
          dataLossOccurred: this.dataLossOccurred,
          ...(this.completionFormat
            ? { traceFormat: this.completionFormat }
            : {}),
        }),
      );
    if (command === 'Tracing.start' && this.bufferUsageEvent)
      queueMicrotask(() =>
        this.emit('Tracing.bufferUsage', this.bufferUsageEvent),
      );
    if (command === 'Tracing.end')
      queueMicrotask(() =>
        this.emit(
          'Tracing.tracingComplete',
          this.missingStream
            ? {}
            : { stream: 'stream-1', dataLossOccurred: this.dataLossOccurred },
        ),
      );
    if (command === 'IO.read') return { data: this.chunk, eof: true };
    if (command === 'IO.close') return {};
    return {};
  }

  async detach() {
    this.detached = true;
  }
}

function fakePage(session) {
  return { createCDPSession: async () => session };
}

test('writes bounded trace stream and detaches owned session', async (t) => {
  const session = new FakeSession({
    chunk: '{"traceEvents":[{"name":"Paint"}]}',
    categories: ['cc', 'gpu', 'unrelated'],
  });
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
  });
  const result = await controller.stop();
  assert.equal(result.status, 'completed');
  assert.equal(result.completionBeforeStop, false);
  assert.equal(await fs.readFile(outputPath, 'utf8'), session.chunk);
  assert.equal(session.detached, true);
  const start = session.commands.find(
    ([command]) => command === 'Tracing.start',
  );
  assert.equal(start?.[1]?.transferMode, 'ReturnAsStream');
  assert.equal(start?.[1]?.streamFormat, 'json');
  assert.equal(start?.[1]?.streamCompression, 'none');
  assert.equal(start?.[1]?.bufferUsageReportingInterval, 1000);
  assert.equal(start?.[1]?.traceConfig?.recordMode, 'recordUntilFull');
  assert.equal(start?.[1]?.traceConfig?.traceBufferSizeInKb, 32 * 1024);
  assert.equal(start?.[1]?.traceConfig?.enableArgumentFilter, true);
  assert.ok(start?.[1]?.traceConfig?.includedCategories.includes('cc'));
  assert.ok(start?.[1]?.traceConfig?.includedCategories.includes('viz'));
  assert.ok(start?.[1]?.traceConfig?.includedCategories.includes('gpu'));
  assert.ok(
    start?.[1]?.traceConfig?.includedCategories.includes('renderer.scheduler'),
  );
  assert.ok(start?.[1]?.traceConfig?.excludedCategories.includes('netlog'));
  assert.deepEqual(result.supportedCategories, ['cc', 'gpu']);
  assert.deepEqual(
    session.commands.map(([command]) => command),
    [
      'Tracing.getCategories',
      'Tracing.start',
      'Tracing.end',
      'IO.read',
      'IO.close',
    ],
  );
});

test('consumes an early full-buffer completion without sending a second end', async (t) => {
  const session = new FakeSession({
    earlyCompletion: true,
    dataLossOccurred: true,
  });
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
  });
  const result = await controller.stop();
  assert.equal(result.status, 'truncated');
  assert.equal(result.dataLossOccurred, true);
  assert.deepEqual(
    session.commands.map(([command]) => command),
    ['Tracing.getCategories', 'Tracing.start', 'IO.read', 'IO.close'],
  );
});

test('retains maximum buffer usage and rejects unexpected completion metadata', async (t) => {
  const session = new FakeSession({
    bufferUsageEvent: { percentFull: 0.75, eventCount: 4, value: 9 },
  });
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
  });
  const result = await controller.stop();
  assert.equal(result.bufferUsage.percentFull, 0.75);
  assert.equal(result.dataLossOccurred, false);

  const malformed = new FakeSession({
    earlyCompletion: true,
    completionFormat: 'proto',
  });
  await assert.rejects(
    startBrowserTrace({
      page: fakePage(malformed),
      outputPath: await tempOutput(t, 'malformed.json'),
    }).then((started) => started.stop()),
    /unexpected format/,
  );
});

test('fails closed and removes partial output when the byte bound is exceeded', async (t) => {
  const session = new FakeSession({ chunk: 'x'.repeat(128) });
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
    maxBytes: 64,
  });
  await assert.rejects(controller.stop, /byte bound/);
  await assert.rejects(fs.access(outputPath));
  assert.equal(session.detached, true);
});

test('rejects a missing completion stream and detaches', async (t) => {
  const session = new FakeSession({ missingStream: true });
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
  });
  await assert.rejects(controller.stop, /no stream handle/);
  assert.equal(session.detached, true);
});

test('times out a completion that arrives late and ignores the late event', async (t) => {
  const session = new FakeSession();
  session.send = async (command, params) => {
    session.commands.push([command, params]);
    if (command === 'Tracing.end')
      setTimeout(
        () => session.emit('Tracing.tracingComplete', { stream: 'late' }),
        30,
      );
    return command === 'IO.read' ? { data: '', eof: true } : {};
  };
  const outputPath = await tempOutput(t);
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath,
    timeoutMs: 5,
  });
  await assert.rejects(controller.stop, /deadline/);
  assert.equal(session.detached, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(
    await fs.access(outputPath).then(
      () => true,
      () => false,
    ),
    false,
  );
});

test('rejects a start failure without leaving a session attached', async (t) => {
  const session = new FakeSession({ startError: new Error('start failed') });
  const outputPath = await tempOutput(t);
  await assert.rejects(
    startBrowserTrace({ page: fakePage(session), outputPath }),
    /start failed/,
  );
  assert.equal(session.detached, true);
});

test('ends and detaches a trace whose start reply arrives after the deadline', async () => {
  const session = new FakeSession({ startDelay: 30 });
  await assert.rejects(
    startBrowserTrace({
      page: fakePage(session),
      outputPath: path.join(os.tmpdir(), `late-start-${Date.now()}.json`),
      timeoutMs: 5,
    }),
    /deadline/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    session.commands.map(([command]) => command),
    ['Tracing.getCategories', 'Tracing.start', 'Tracing.end'],
  );
  assert.equal(session.detached, true);
});

test('detaches a late CDP session after session-creation timeout', async () => {
  const lateSession = new FakeSession();
  const page = {
    createCDPSession: () =>
      new Promise((resolve) => setTimeout(() => resolve(lateSession), 30)),
  };
  await assert.rejects(
    startBrowserTrace({
      page,
      outputPath: path.join(os.tmpdir(), `late-${Date.now()}.json`),
      timeoutMs: 5,
    }),
    /deadline/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(lateSession.detached, true);
});

test('does not overwrite a pre-existing output and reports detach failure', async (t) => {
  const session = new FakeSession();
  const outputPath = await tempOutput(t);
  await fs.writeFile(outputPath, 'existing');
  await assert.rejects(
    startBrowserTrace({ page: fakePage(session), outputPath }),
    /already exists/,
  );

  const failingSession = new FakeSession();
  failingSession.detach = async () => {
    throw new Error('detach failed');
  };
  const secondPath = await tempOutput(t, 'second.json');
  const controller = await startBrowserTrace({
    page: fakePage(failingSession),
    outputPath: secondPath,
  });
  await assert.rejects(controller.stop, /cleanup failed/);
  assert.equal(await fs.readFile(secondPath, 'utf8'), '{"traceEvents":[]}');
});

test('rejects invalid bounds and requires absolute output', async () => {
  const session = new FakeSession();
  await assert.rejects(
    startBrowserTrace({ page: fakePage(session), outputPath: 'relative.json' }),
    /absolute path/,
  );
  await assert.rejects(
    startBrowserTrace({
      page: fakePage(session),
      outputPath: path.join(os.tmpdir(), 'trace.json'),
      maxBytes: MAX_BROWSER_TRACE_BYTES + 1,
    }),
    /between 1 and/,
  );
});

test('early completion without loss cannot qualify the full measurement window', async (t) => {
  const session = new FakeSession({ earlyCompletion: true });
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath: await tempOutput(t),
  });
  const result = await controller.stop();
  assert.equal(result.status, 'incomplete');
  assert.equal(result.completionBeforeStop, true);
  assert.equal(
    session.commands.some(([command]) => command === 'Tracing.end'),
    false,
  );
});

test('keeps the peak fractional fullness and unknown loss is unavailable', async (t) => {
  const session = new FakeSession();
  session.dataLossOccurred = undefined;
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath: await tempOutput(t),
  });
  session.emit('Tracing.bufferUsage', { value: 0.8 });
  session.emit('Tracing.bufferUsage', { percentFull: 0.2 });
  const result = await controller.stop();
  assert.equal(result.status, 'incomplete');
  assert.equal(result.dataLossOccurred, null);
  assert.equal(result.bufferUsage.percentFull, 0.8);
});

test('closes a rejected completion stream and leaves existing trace sessions alone', async (t) => {
  const malformed = new FakeSession({
    earlyCompletion: true,
    completionFormat: 'proto',
  });
  const controller = await startBrowserTrace({
    page: fakePage(malformed),
    outputPath: await tempOutput(t),
  });
  await assert.rejects(controller.stop, /unexpected format/);
  assert.equal(
    malformed.commands.filter(([command]) => command === 'IO.close').length,
    1,
  );
  assert.equal(
    malformed.commands.some(([command]) => command === 'Tracing.end'),
    false,
  );
  const occupied = new FakeSession({
    startError: new Error('already tracing'),
  });
  await assert.rejects(
    startBrowserTrace({
      page: fakePage(occupied),
      outputPath: await tempOutput(t),
    }),
    /already tracing/,
  );
  assert.equal(
    occupied.commands.some(([command]) => command === 'Tracing.end'),
    false,
  );
});

test('fails on stream close and preserves a file created during capture', async (t) => {
  const session = new FakeSession();
  const send = session.send.bind(session);
  session.send = (command, params) => {
    if (command === 'IO.close')
      return Promise.reject(new Error('close failed'));
    return send(command, params);
  };
  const controller = await startBrowserTrace({
    page: fakePage(session),
    outputPath: await tempOutput(t),
  });
  await assert.rejects(controller.stop, /cleanup failed/);
  assert.equal(session.detached, true);
  const raced = new FakeSession();
  const outputPath = await tempOutput(t);
  const second = await startBrowserTrace({ page: fakePage(raced), outputPath });
  await fs.writeFile(outputPath, 'preserve');
  await assert.rejects(second.stop, /EEXIST|exist/i);
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'preserve');
  assert.equal(raced.detached, true);
});
