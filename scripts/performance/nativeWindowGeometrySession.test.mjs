import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import {
  createNativeWindowGeometrySession,
  createNativeWindowGeometryPowerShellSessionScript,
  nativeWindowHostQueryError,
  NATIVE_WINDOW_MAX_QUERY_ID,
} from './nativeWindowGeometrySession.mjs';
import { getWindowsNativeWindowGeometryScript } from './nativeWindowViewport.mjs';

const SCHEMA = 'gev-owned-native-window-geometry-session/v1';
const tick = () => new Promise((resolve) => queueMicrotask(resolve));
function harness(options = {}) {
  const child = new EventEmitter();
  child.pid = 7001;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const state = {
    spawns: [],
    writes: [],
    kills: 0,
    ends: 0,
    time: 0,
    timers: new Map(),
    nextTimer: 1,
    closed: false,
  };
  const utc = () => new Date(Date.UTC(2026, 9, 20) + state.time).toISOString();
  const close = (code = 0, signal = null) => {
    if (state.closed) return;
    state.closed = true;
    child.emit('exit', code, signal);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code, signal);
  };
  const write = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
  const reply = (id, extra = {}) => {
    const start = utc();
    state.time++;
    write({
      schema: SCHEMA,
      status: 'observed',
      browserPid: 1122,
      helperPid: child.pid,
      requestId: id,
      queryStartedAtUtc: start,
      queryCompletedAtUtc: utc(),
      evidence: {
        schema: 'gev-owned-windows-window-geometry/v1',
        browserPid: 1122,
        ownerPid: 1122,
        sequence: id,
      },
      ...extra,
    });
  };
  child.stdin = new Writable({
    write(bytes, encoding, done) {
      state.writes.push(String(bytes));
      if (options.reply !== false)
        queueMicrotask(() => reply(Number(String(bytes).split(':')[0])));
      done();
    },
    final(done) {
      state.ends++;
      done();
      if (!options.hangOnEnd)
        queueMicrotask(() => close(options.exitCode ?? 0));
    },
  });
  child.kill = () => {
    state.kills++;
    if (!options.hangOnKill)
      queueMicrotask(() =>
        close(
          options.zeroExitOnKill ? 0 : null,
          options.zeroExitOnKill ? null : 'SIGTERM',
        ),
      );
    return true;
  };
  const session = createNativeWindowGeometrySession({
    browserPid: 1122,
    platform: 'win32',
    geometryScript: getWindowsNativeWindowGeometryScript(),
    initialRequestId: options.initialRequestId ?? 1,
    now: () => state.time,
    utcNow: utc,
    setTimer: (fn, ms) => {
      const id = state.nextTimer++;
      state.timers.set(id, { fn, due: state.time + ms, ms });
      return id;
    },
    clearTimer: (id) => state.timers.delete(id),
    spawnImpl: (...args) => {
      state.spawns.push(args);
      if (options.spawnError) throw options.spawnError;
      if (options.ready !== false)
        queueMicrotask(() =>
          write({
            schema: SCHEMA,
            status: 'ready',
            browserPid: 1122,
            helperPid: child.pid,
          }),
        );
      return child;
    },
  });
  const advance = async (ms) => {
    state.time += ms;
    for (const [id, timer] of [...state.timers])
      if (timer.due <= state.time) {
        state.timers.delete(id);
        timer.fn();
      }
    await tick();
  };
  return { child, state, session, reply, write, close, advance };
}

test('the persistent script lifts exactly one unchanged declaration and fresh read body', () => {
  const original = getWindowsNativeWindowGeometryScript();
  const script = createNativeWindowGeometryPowerShellSessionScript(original);
  const start = original.indexOf("Add-Type -TypeDefinition @'");
  const end = original.indexOf("'@\nfunction RectValue");
  assert.equal(script.split(original.slice(start, end + 2)).length, 2);
  assert.equal(script.split(original.slice(end + 3)).length, 2);
  assert.equal(script.split('Add-Type -TypeDefinition').length, 2);
  assert.ok(script.indexOf('Add-Type') < script.indexOf("status='ready'"));
  assert.ok(
    script.indexOf('$geometryJson = Read-GevOwnedNativeGeometry') >
      script.indexOf('while (($request'),
  );
  assert.match(script, /SetThreadDpiAwarenessContext\(\$previousDpiContext\)/);
  assert.doesNotMatch(
    script,
    /SetForegroundWindow|ShowWindow|SendInput|Start-Sleep|requestRender|setView/,
  );
  assert.throws(
    () => createNativeWindowGeometryPowerShellSessionScript('ambiguous'),
    /2|false/,
  );
});

test('one owned process serves separate fresh requests then confirms EOF exit and releases callbacks', async () => {
  const h = harness();
  await h.session.start();
  await h.session.start();
  const first = await h.session.query(1122),
    second = await h.session.query(1122);
  assert.equal(h.state.spawns.length, 1);
  assert.deepEqual(h.state.writes, ['1:1122\n', '2:1122\n']);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.notEqual(first.query.startedAtUtc, second.query.startedAtUtc);
  assert.equal(first.query.helperPid, 7001);
  assert.equal(second.query.requestId, 2);
  assert.equal(first.query.timeoutMs, 5000);
  assert.deepEqual(h.state.spawns[0][2].stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(h.state.spawns[0][2].windowsHide, true);
  const [a, b] = await Promise.all([h.session.dispose(), h.session.dispose()]);
  assert.deepEqual(a, b);
  assert.equal(a.exitCode, 0);
  assert.equal(a.signal, null);
  assert.equal(a.requests, 2);
  assert.equal(h.state.ends, 1);
  assert.equal(h.state.kills, 0);
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.child.listenerCount('error'), 0);
  assert.equal(h.child.stdout.listenerCount('data'), 0);
  await assert.rejects(h.session.query(1122), /unavailable/);
});

test('wrong-PID and overlapping requests never write an extra command or substitute a response', async () => {
  const h = harness({ reply: false });
  await h.session.start();
  await assert.rejects(h.session.query(9999), /PID mismatch/);
  const pending = h.session.query(1122);
  await assert.rejects(h.session.query(1122), /already pending/);
  h.reply(1);
  await pending;
  assert.deepEqual(h.state.writes, ['1:1122\n']);
  await h.session.dispose();
});

test('query errors, invalid sequences, malformed output and unsolicited bytes fail permanently without retry', async () => {
  for (const mode of [
    'query-error',
    'wrong-id',
    'wrong-pid',
    'wrong-helper',
    'wrong-owner',
    'malformed',
    'trailing',
    'late-duplicate',
    'stdout-bound',
    'stderr-bound',
    'child-error',
    'child-exit',
  ]) {
    const h = harness({ reply: false });
    await h.session.start();
    const pending = h.session.query(1122);
    if (mode === 'query-error')
      h.reply(1, {
        status: 'failed',
        errorMessage: 'Owned window unavailable',
      });
    if (mode === 'wrong-id') h.reply(2);
    if (mode === 'wrong-pid') h.reply(1, { browserPid: 333 });
    if (mode === 'wrong-helper') h.reply(1, { helperPid: 333 });
    if (mode === 'wrong-owner')
      h.reply(1, {
        evidence: {
          schema: 'gev-owned-windows-window-geometry/v1',
          browserPid: 1122,
          ownerPid: 333,
        },
      });
    if (mode === 'malformed') h.child.stdout.write('bad-json\n');
    if (mode === 'trailing') h.child.stdout.write('{}\n{}\n');
    if (mode === 'stdout-bound') h.child.stdout.write('x'.repeat(65537));
    if (mode === 'stderr-bound') h.child.stderr.write('x'.repeat(65537));
    if (mode === 'child-error')
      h.child.emit(
        'error',
        Object.assign(new Error('pipe fault'), { code: 'EPIPE' }),
      );
    if (mode === 'child-exit') h.close(7);
    if (mode === 'late-duplicate') {
      h.reply(1);
      await pending;
      h.write({ schema: SCHEMA, status: 'ready' });
    } else
      await assert.rejects(
        pending,
        (error) => {
          assert.equal(error.nativeWindowHostQueryFailure.phase, 'query');
          return true;
        },
        mode,
      );
    await tick();
    if (mode === 'late-duplicate') await assert.rejects(h.session.dispose());
    await assert.rejects(h.session.query(1122));
    await assert.rejects(h.session.start());
    if (mode !== 'late-duplicate')
      assert.equal((await h.session.dispose()).status, 'closed');
    assert.equal(h.state.spawns.length, 1, mode);
    assert.equal(h.state.timers.size, 0, mode);
  }
});

test('missing readiness and stalled query honor the unchanged five-second deadline with structured cause', async () => {
  for (const phase of ['startup', 'query']) {
    const h = harness({ ready: phase !== 'startup', reply: false });
    const pending =
      phase === 'startup'
        ? h.session.start()
        : (await h.session.start(), h.session.query(1122));
    const rejected = assert.rejects(pending, (error) => {
      const detail = error.nativeWindowHostQueryFailure;
      assert.equal(detail.phase, phase);
      assert.equal(detail.code, 'ETIMEDOUT');
      assert.equal(detail.timedOut, true);
      assert.equal(detail.timeoutMs, 5000);
      assert.equal(detail.elapsedMs, 5000);
      assert.equal(detail.killed, true);
      assert.equal(detail.signal, 'SIGTERM');
      assert.doesNotMatch(error.message, /EncodedCommand|Add-Type/);
      return true;
    });
    await h.advance(5000);
    await rejected;
    assert.equal((await h.session.dispose()).status, 'closed');
    assert.equal(h.state.spawns.length, 1);
    assert.equal(h.state.timers.size, 0);
  }
  // A late reply is invalid even when the JS timeout callback itself was delayed.
  const h = harness({ reply: false });
  await h.session.start();
  const pending = h.session.query(1122);
  h.state.time = 5000;
  h.reply(1);
  await assert.rejects(
    pending,
    (error) => error.nativeWindowHostQueryFailure.timedOut === true,
  );
  assert.equal((await h.session.dispose()).status, 'closed');
});

test('cancellation before acquisition spawns nothing; pending startup/query cancellation kills only the owned helper', async () => {
  const early = harness(),
    aborted = new AbortController();
  aborted.abort();
  assert.throws(
    () => early.session.start({ signal: aborted.signal }),
    /abort/i,
  );
  assert.equal(early.state.spawns.length, 0);
  await early.session.dispose();
  for (const phase of ['startup', 'query']) {
    const h = harness({ ready: phase !== 'startup', reply: false }),
      controller = new AbortController();
    const pending =
      phase === 'startup'
        ? h.session.start({ signal: controller.signal })
        : (await h.session.start(),
          h.session.query(1122, { signal: controller.signal }));
    const rejected = assert.rejects(
      pending,
      (error) => error.nativeWindowHostQueryFailure.aborted === true,
    );
    controller.abort();
    await rejected;
    assert.equal((await h.session.dispose()).status, 'closed');
    assert.equal(h.state.kills, 1);
    assert.equal(h.state.timers.size, 0);
    assert.equal(h.child.listenerCount('error'), 0);
  }
});

test('spawn failure is consumed and bounded disposal cannot silently accept an unconfirmed or forced exit', async () => {
  const spawn = harness({
    spawnError: Object.assign(new Error('spawn failure'), { code: 'ENOENT' }),
  });
  await assert.rejects(
    spawn.session.start(),
    (error) => error.nativeWindowHostQueryFailure.code === 'ENOENT',
  );
  assert.equal((await spawn.session.dispose()).status, 'closed');
  assert.equal(spawn.state.timers.size, 0);
  for (const mode of ['unconfirmed', 'forced', 'forced-zero-exit', 'nonzero']) {
    const h = harness({
      hangOnEnd: mode !== 'nonzero',
      hangOnKill: mode === 'unconfirmed',
      exitCode: 4,
      zeroExitOnKill: mode === 'forced-zero-exit',
    });
    await h.session.start();
    const pending = h.session.dispose(),
      rejected = assert.rejects(pending);
    if (mode !== 'nonzero') {
      await h.advance(1000);
      if (mode === 'unconfirmed') await h.advance(1000);
    }
    await rejected;
    assert.equal(h.state.timers.size, 0);
    assert.equal(
      h.session.read().cleanup.status,
      mode === 'unconfirmed' ? 'exit-unconfirmed' : 'closed',
    );
    if (mode === 'unconfirmed') h.close(null, 'SIGTERM');
    assert.equal(h.child.stdout.listenerCount('data'), 0);
  }
});

test('structured failures retain bounded process facts and CLIXML without the encoded command', () => {
  const encoded = 'A'.repeat(20000);
  const error = nativeWindowHostQueryError(
    Object.assign(
      new Error(`Command failed: powershell.exe -EncodedCommand ${encoded}`),
      {
        code: null,
        killed: true,
        signal: 'SIGTERM',
        gevTimeout: true,
        stdout: '',
        stderr: '#< CLIXML\r\n',
      },
    ),
    { phase: 'query', browserPid: 1122, elapsedMs: 5000 },
  );
  assert.equal(error.nativeWindowHostQueryFailure.stderr.text, '#< CLIXML\r\n');
  assert.equal(error.nativeWindowHostQueryFailure.killed, true);
  assert.equal(error.nativeWindowHostQueryFailure.timedOut, true);
  assert.ok(JSON.stringify(error).length < 2000);
  assert.ok(!JSON.stringify(error).includes(encoded));
});

test('a long soak can make more than 128 fresh requests without a new process or retained reply buffer', async () => {
  const h = harness();
  await h.session.start();
  for (let index = 0; index < 512; index++)
    assert.equal((await h.session.query(1122)).query.requestId, index + 1);
  assert.equal((await h.session.dispose()).status, 'closed');
  assert.equal(h.state.writes.length, 512);
  assert.equal(h.state.spawns.length, 1);
  assert.equal(h.state.timers.size, 0);
});

test('request sequence exhausts at the PowerShell Int32 boundary without wrapping or writing an invalid identifier', async () => {
  const h = harness({ initialRequestId: NATIVE_WINDOW_MAX_QUERY_ID });
  await h.session.start();
  assert.equal(
    (await h.session.query(1122)).query.requestId,
    NATIVE_WINDOW_MAX_QUERY_ID,
  );
  await assert.rejects(h.session.query(1122), (error) =>
    error.nativeWindowHostQueryFailure.message.text.includes(
      'sequence exhausted',
    ),
  );
  assert.equal((await h.session.dispose()).status, 'closed');
  assert.deepEqual(h.state.writes, [`${NATIVE_WINDOW_MAX_QUERY_ID}:1122\n`]);
  assert.equal(h.state.spawns.length, 1);
  assert.equal(h.state.timers.size, 0);
  assert.throws(() =>
    harness({ initialRequestId: NATIVE_WINDOW_MAX_QUERY_ID + 1 }),
  );
  assert.throws(() => harness({ initialRequestId: Infinity }));
});
