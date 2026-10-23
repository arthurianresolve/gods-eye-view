import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS = 5000;
export const NATIVE_WINDOW_MAX_QUERY_ID = 2_147_483_647;
const SESSION_SCHEMA = 'gev-owned-native-window-geometry-session/v1';
const GEOMETRY_SCHEMA = 'gev-owned-windows-window-geometry/v1';
const MAX_BYTES = 64 * 1024;

function boundedText(value) {
  const text = String(value ?? '').replace(
    /(-EncodedCommand\s+)[A-Za-z0-9+/=]+/gi,
    '$1[omitted]',
  );
  return {
    text: text.slice(0, 4096),
    characters: text.length,
    truncated: text.length > 4096,
  };
}

/** Preserve process facts without serializing Node's command-bearing Error. */
export function nativeWindowHostQueryError(cause, context = {}) {
  if (cause?.nativeWindowHostQueryFailure) return cause;
  const detail = {
    schema: 'gev-native-window-host-query-failure/v1',
    status: 'failed',
    phase: context.phase ?? 'query',
    browserPid: context.browserPid ?? null,
    helperPid: context.helperPid ?? null,
    requestId: context.requestId ?? null,
    timeoutMs: context.timeoutMs ?? NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS,
    startedAtUtc: context.startedAtUtc ?? null,
    completedAtUtc: context.completedAtUtc ?? null,
    elapsedMs: context.elapsedMs ?? null,
    code:
      typeof cause?.code === 'number' || typeof cause?.code === 'string'
        ? cause.code
        : null,
    signal:
      typeof cause?.signal === 'string' ? cause.signal.slice(0, 32) : null,
    killed: typeof cause?.killed === 'boolean' ? cause.killed : null,
    timedOut: cause?.gevTimeout === true,
    aborted: cause?.name === 'AbortError' || cause?.code === 'ABORT_ERR',
    errorName: String(cause?.name || 'Error').slice(0, 128),
    message: boundedText(cause?.message),
    stdout: boundedText(context.stdout ?? cause?.stdout),
    stderr: boundedText(context.stderr ?? cause?.stderr),
  };
  const error = new Error(
    `Owned native-window ${detail.phase} failed (code=${detail.code}, signal=${detail.signal}, killed=${detail.killed}, timeout=${detail.timedOut}, elapsedMs=${detail.elapsedMs})`,
  );
  error.name = 'NativeWindowGeometryHelperError';
  error.nativeWindowHostQueryFailure = detail;
  return error;
}

/** Lift only the unchanged declaration; every request executes the exact read body. */
export function createNativeWindowGeometryPowerShellSessionScript(script) {
  const start = script.indexOf("Add-Type -TypeDefinition @'");
  const endMarker = "'@\nfunction RectValue";
  assert.equal(script.split(endMarker).length, 2);
  const end = script.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  const declaration = script.slice(start, end + 2);
  const body = script.slice(end + 3);
  return String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ownedBrowserPid = [int]$env:GEV_NATIVE_WINDOW_BROWSER_PID
${declaration}
function Read-GevOwnedNativeGeometry {
${body}
}
@{ schema='${SESSION_SCHEMA}'; status='ready'; browserPid=$ownedBrowserPid; helperPid=$PID } | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
[Console]::Out.Flush()
while (($request = [Console]::In.ReadLine()) -ne $null) {
  $requestId = 0
  try {
    if ($request -notmatch '^[1-9][0-9]*:[1-9][0-9]*$') { throw 'Invalid geometry request' }
    $parts = $request.Split(':')
    $requestId = [int]$parts[0]
    if ([int]$parts[1] -ne $ownedBrowserPid) { throw 'Geometry request PID mismatch' }
    $queryStartedAtUtc = [DateTime]::UtcNow.ToString('o')
    $geometryJson = Read-GevOwnedNativeGeometry
    $queryCompletedAtUtc = [DateTime]::UtcNow.ToString('o')
    $envelope = @{ schema='${SESSION_SCHEMA}'; status='observed'; browserPid=$ownedBrowserPid; helperPid=$PID;
      requestId=$requestId; queryStartedAtUtc=$queryStartedAtUtc; queryCompletedAtUtc=$queryCompletedAtUtc } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($envelope.Substring(0,$envelope.Length-1) + ',"evidence":' + $geometryJson + '}')
  } catch {
    @{ schema='${SESSION_SCHEMA}'; status='failed'; browserPid=$ownedBrowserPid; helperPid=$PID;
      requestId=$requestId; errorName=$_.Exception.GetType().FullName;
      errorMessage=$_.Exception.Message.Substring(0,[Math]::Min(2048,$_.Exception.Message.Length)) } |
      ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
  }
  [Console]::Out.Flush()
}
`;
}

/** One read-only process, one outstanding fresh query, no cache or restart. */
export function createNativeWindowGeometrySession({
  browserPid,
  geometryScript,
  platform = process.platform,
  spawnImpl = spawn,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => performance.now(),
  utcNow = () => new Date().toISOString(),
  initialRequestId = 1,
} = {}) {
  assert.equal(platform, 'win32', 'Native-window geometry requires Windows');
  assert.ok(Number.isSafeInteger(browserPid) && browserPid > 0);
  assert.ok(
    Number.isSafeInteger(initialRequestId) &&
      initialRequestId > 0 &&
      initialRequestId <= NATIVE_WINDOW_MAX_QUERY_ID,
  );
  const script =
    createNativeWindowGeometryPowerShellSessionScript(geometryScript);
  let child = null,
    pending = null,
    started = false,
    unusable = false,
    disposed = false;
  let closed = false,
    exitCode = null,
    exitSignal = null,
    nextId = initialRequestId;
  let stdout = '',
    stderr = '',
    stderrBytes = 0,
    lastFailure = null;
  let unreportedFailure = null;
  let startPromise = null,
    disposePromise = null,
    cleanup = null;
  let readyAtUtc = null,
    requests = 0,
    forcedTermination = false;
  const decoder = new StringDecoder('utf8');
  const settle = (operation, method, value) => {
    if (!operation) return;
    clearTimer(operation.timer);
    operation.signal?.removeEventListener('abort', operation.cancel);
    operation[method](value);
  };
  const failure = (cause, operation = pending) =>
    nativeWindowHostQueryError(cause, {
      phase: operation?.phase ?? (started ? 'idle' : 'startup'),
      browserPid,
      helperPid: child?.pid ?? null,
      requestId: operation?.requestId ?? null,
      startedAtUtc: operation?.startedAtUtc,
      completedAtUtc: utcNow(),
      elapsedMs: operation ? now() - operation.startedAtMs : null,
      timeoutMs:
        operation?.phase === 'cleanup'
          ? 2000
          : NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS,
      stdout,
      stderr,
    });
  const fail = (cause) => {
    if (unusable || disposed) return;
    unusable = true;
    try {
      if (!closed && child?.kill() === true) {
        forcedTermination = true;
        cause.killed = true;
        cause.signal ??= 'SIGTERM';
      }
    } catch {}
    lastFailure = failure(cause);
    const operation = pending;
    if (!operation) unreportedFailure = lastFailure;
    pending = null;
    settle(operation, 'reject', lastFailure);
  };
  const onError = (error) => fail(error);
  const onExit = (code, signal) => {
    exitCode = code;
    exitSignal = signal;
    if (!disposed)
      fail(
        Object.assign(new Error('Geometry helper exited'), { code, signal }),
      );
  };
  const detach = () => {
    child.stdout.removeListener('data', onData);
    child.stderr.removeListener('data', onStderr);
    child.removeListener('error', onError);
    child.stdin.removeListener('error', onError);
    child.stdout.removeListener('error', onError);
    child.stderr.removeListener('error', onError);
    child.removeListener('exit', onExit);
    child.removeListener('close', onClose);
  };
  const onClose = () => {
    closed = true;
    if (!disposed && !unusable)
      fail(new Error('Geometry helper closed unexpectedly'));
    detach();
  };
  const onStderr = (chunk) => {
    if (disposed || unusable) return;
    stderrBytes += Buffer.byteLength(chunk);
    if (stderrBytes > MAX_BYTES) {
      fail(new Error('Geometry helper stderr exceeded its bound'));
      return;
    }
    stderr += String(chunk);
  };
  const onData = (chunk) => {
    if (disposed || unusable) return;
    stdout += decoder.write(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    );
    if (Buffer.byteLength(stdout) > MAX_BYTES) {
      fail(new Error('Geometry helper stdout exceeded its bound'));
      return;
    }
    const end = stdout.indexOf('\n');
    if (end < 0) return;
    const line = stdout.slice(0, end).replace(/\r$/, '');
    if (stdout.slice(end + 1).length || !pending) {
      fail(new Error('Unexpected geometry helper output'));
      return;
    }
    const operation = pending;
    try {
      if (now() - operation.startedAtMs >= NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS)
        throw Object.assign(new Error('Geometry helper deadline elapsed'), {
          gevTimeout: true,
          code: 'ETIMEDOUT',
        });
      const value = JSON.parse(line);
      assert.equal(value.schema, SESSION_SCHEMA);
      assert.equal(value.browserPid, browserPid);
      assert.equal(value.helperPid, child.pid);
      if (operation.phase === 'startup') {
        assert.equal(value.status, 'ready');
        started = true;
        readyAtUtc = utcNow();
        stdout = '';
        pending = null;
        settle(operation, 'resolve');
      } else {
        assert.equal(value.requestId, operation.requestId);
        assert.equal(
          value.status,
          'observed',
          value.errorMessage || 'Geometry query failed',
        );
        assert.equal(value.evidence?.schema, GEOMETRY_SCHEMA);
        assert.equal(value.evidence.browserPid, browserPid);
        assert.equal(value.evidence.ownerPid, browserPid);
        assert.ok(
          Number.isFinite(Date.parse(value.queryStartedAtUtc)) &&
            Date.parse(value.queryCompletedAtUtc) >=
              Date.parse(value.queryStartedAtUtc),
        );
        const query = {
          schema: SESSION_SCHEMA,
          helperPid: child.pid,
          requestId: operation.requestId,
          timeoutMs: NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS,
          helperReadyAtUtc: readyAtUtc,
          startedAtUtc: operation.startedAtUtc,
          completedAtUtc: utcNow(),
          elapsedMs: now() - operation.startedAtMs,
          hostStartedAtUtc: value.queryStartedAtUtc,
          hostCompletedAtUtc: value.queryCompletedAtUtc,
        };
        requests++;
        stdout = '';
        pending = null;
        settle(operation, 'resolve', { ...value.evidence, query });
      }
    } catch (error) {
      fail(error);
    }
  };
  const operation = (phase, signal, requestId = null) => {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const current = {
        phase,
        requestId,
        signal,
        resolve,
        reject,
        startedAtMs: now(),
        startedAtUtc: utcNow(),
        timer: null,
        cancel: null,
      };
      pending = current;
      current.cancel = () =>
        fail(
          Object.assign(new Error('Geometry helper operation aborted'), {
            name: 'AbortError',
            code: 'ABORT_ERR',
          }),
        );
      signal?.addEventListener('abort', current.cancel, { once: true });
      current.timer = setTimer(
        () =>
          fail(
            Object.assign(new Error('Geometry helper operation timed out'), {
              gevTimeout: true,
              code: 'ETIMEDOUT',
            }),
          ),
        NATIVE_WINDOW_HOST_QUERY_TIMEOUT_MS,
      );
    });
  };
  const start = ({ signal } = {}) => {
    signal?.throwIfAborted();
    if (disposed || unusable) {
      unreportedFailure = null;
      return Promise.reject(
        lastFailure || new Error('Geometry helper unavailable'),
      );
    }
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        // Operation is owned before spawn; synchronous mock or process errors
        // cannot escape startup cancellation/timeout cleanup.
        const ready = operation('startup', signal);
        ready.catch(() => {});
        child = spawnImpl(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              GEV_NATIVE_WINDOW_BROWSER_PID: String(browserPid),
            },
          },
        );
        child.on('error', onError);
        child.once('exit', onExit);
        child.once('close', onClose);
        child.stdin.on('error', onError);
        child.stdout.on('error', onError);
        child.stderr.on('error', onError);
        child.stdout.on('data', onData);
        child.stderr.on('data', onStderr);
        await ready;
      } catch (error) {
        fail(error);
        throw lastFailure || error;
      }
    })();
    return startPromise;
  };
  const query = async (requestedPid, { signal } = {}) => {
    assert.equal(requestedPid, browserPid, 'Geometry helper PID mismatch');
    signal?.throwIfAborted();
    if (!started || disposed || unusable) {
      unreportedFailure = null;
      throw lastFailure || new Error('Geometry helper unavailable');
    }
    assert.equal(pending, null, 'Geometry helper request already pending');
    if (nextId > NATIVE_WINDOW_MAX_QUERY_ID) {
      fail(new Error('Geometry helper request sequence exhausted'));
      unreportedFailure = null;
      throw lastFailure;
    }
    const requestId = nextId++;
    const response = operation('query', signal, requestId);
    try {
      child.stdin.write(`${requestId}:${browserPid}\n`);
    } catch (error) {
      fail(error);
    }
    return response;
  };
  const dispose = () => {
    if (disposePromise) return disposePromise;
    disposed = true;
    const current = pending;
    pending = null;
    settle(
      current,
      'reject',
      failure(
        Object.assign(new Error('Geometry helper disposed'), {
          code: 'ABORT_ERR',
        }),
        current,
      ),
    );
    disposePromise = new Promise((resolve, reject) => {
      let done = false,
        killTimer,
        closeTimer;
      const startedAtMs = now();
      const startedAtUtc = utcNow();
      const finish = (error) => {
        if (done) return;
        done = true;
        if (
          !error &&
          child &&
          closed &&
          (exitCode !== 0 || exitSignal || forcedTermination) &&
          !lastFailure
        )
          error = Object.assign(
            new Error('Geometry helper did not exit normally'),
            { code: exitCode, signal: exitSignal, killed: forcedTermination },
          );
        clearTimer(killTimer);
        clearTimer(closeTimer);
        child?.removeListener('close', onDisposedClose);
        if (closed) detach();
        cleanup = {
          schema: SESSION_SCHEMA,
          status: closed || !child ? 'closed' : 'exit-unconfirmed',
          helperPid: child?.pid ?? null,
          requests,
          exitCode,
          signal: exitSignal,
          forcedTermination,
          elapsedMs: now() - startedAtMs,
        };
        error
          ? reject(
              failure(error, {
                phase: 'cleanup',
                startedAtMs,
                startedAtUtc,
                requestId: null,
              }),
            )
          : unreportedFailure
            ? reject(unreportedFailure)
            : resolve(structuredClone(cleanup));
      };
      const onDisposedClose = () => finish();
      if (!child || closed) {
        finish();
        return;
      }
      child.once('close', onDisposedClose);
      try {
        child.stdin.end();
      } catch {}
      if (done) return;
      killTimer = setTimer(() => {
        try {
          forcedTermination = child.kill() === true;
        } catch {}
        if (!done)
          closeTimer = setTimer(
            () =>
              finish(new Error('Geometry helper did not confirm process exit')),
            1000,
          );
      }, 1000);
    });
    return disposePromise;
  };
  return {
    start,
    query,
    dispose,
    read: () => ({
      schema: SESSION_SCHEMA,
      status: disposed
        ? cleanup?.status || 'disposing'
        : unusable
          ? 'failed'
          : started
            ? 'ready'
            : 'unstarted',
      helperPid: child?.pid ?? null,
      requests,
      readyAtUtc,
      cleanup: cleanup ? structuredClone(cleanup) : null,
      failure: lastFailure
        ? structuredClone(lastFailure.nativeWindowHostQueryFailure)
        : null,
    }),
  };
}
