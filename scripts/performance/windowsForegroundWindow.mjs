import { execFile, spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS_FOREGROUND_SCHEMA =
  'gev-windows-owned-browser-foreground-activation/v1';

const FOREGROUND_DIAGNOSTIC_SCHEMA =
  'gev-windows-owned-browser-foreground-diagnostic/v1';

function parseEvidence(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function runnerDiagnostic(cause, evidence, category) {
  const timedOut =
    cause?.code === 'ETIMEDOUT' || cause?.name === 'TimeoutError';
  const runnerTimedOut = timedOut || cause?.gevTimeout === true;
  const runnerExited = runnerTimedOut
    ? false
    : evidence ||
        Number.isInteger(cause?.status) ||
        typeof cause?.code === 'number'
      ? true
      : cause?.code === 'ENOENT' || cause?.code === 'EACCES'
        ? false
        : null;
  const diagnostic = {
    schema: FOREGROUND_DIAGNOSTIC_SCHEMA,
    category,
    runnerExited,
    runnerTimedOut,
    runnerKilled: cause?.killed === true,
  };
  const exitCode = Number.isInteger(cause?.status)
    ? cause.status
    : Number.isInteger(cause?.exitCode)
      ? cause.exitCode
      : typeof cause?.code === 'number'
        ? cause.code
        : null;
  if (exitCode !== null) diagnostic.runnerExitCode = exitCode;
  if (typeof cause?.signal === 'string' && /^[A-Z0-9_]+$/.test(cause.signal))
    diagnostic.runnerSignal = cause.signal.slice(0, 32);
  if (typeof cause?.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code))
    diagnostic.runnerErrorCode = cause.code.slice(0, 32);
  if (evidence) {
    for (const key of [
      'browserPid',
      'windowHandleAvailable',
      'windowHandleSource',
      'handlePollAttempts',
      'inputAttached',
      'showWindowAccepted',
      'bringWindowToTopAccepted',
      'setForegroundAccepted',
      'foregroundConfirmed',
      'foregroundPid',
      'foregroundProcessName',
      'desktopState',
      'status',
    ]) {
      if (Object.hasOwn(evidence, key)) diagnostic[key] = evidence[key];
    }
  }
  return diagnostic;
}

function attachDiagnostic(error, cause, evidence, category) {
  error.foregroundActivation = runnerDiagnostic(cause, evidence, category);
  return error;
}

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$browserPid = [int]$env:GEV_OWNED_BROWSER_PID
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class GevOwnedBrowserWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  public static IntPtr FindOwnedBrowserWindow(uint browserPid) {
    IntPtr visible = IntPtr.Zero;
    IntPtr hidden = IntPtr.Zero;
    EnumWindows((handle, _) => {
      uint ownerPid;
      GetWindowThreadProcessId(handle, out ownerPid);
      if (ownerPid != browserPid) return true;
      var className = new StringBuilder(128);
      GetClassName(handle, className, className.Capacity);
      if (!String.Equals(className.ToString(), "Chrome_WidgetWin_1", StringComparison.Ordinal)) return true;
      if (IsWindowVisible(handle)) visible = handle;
      else if (hidden == IntPtr.Zero) hidden = handle;
      return visible == IntPtr.Zero;
    }, IntPtr.Zero);
    return visible != IntPtr.Zero ? visible : hidden;
  }
}
'@
$browser = Get-Process -Id $browserPid -ErrorAction Stop
$attempts = 0
$handleSource = 'process-main-window'
do {
  $attempts += 1
  $browser.Refresh()
  $handle = $browser.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) {
    $handle = [GevOwnedBrowserWindow]::FindOwnedBrowserWindow([uint32]$browserPid)
    if ($handle -ne [IntPtr]::Zero) { $handleSource = 'owned-top-level-enumeration' }
  }
  if ($handle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ($attempts -lt 40)
if ($handle -eq [IntPtr]::Zero) { throw 'Owned browser window handle is unavailable.' }
$previous = [GevOwnedBrowserWindow]::GetForegroundWindow()
$alreadyForeground = $previous -eq $handle
$attached = $false
if ($alreadyForeground) {
  $shown = $true
  $broughtToTop = $true
  $setForeground = $true
} else {
  $shown = [GevOwnedBrowserWindow]::ShowWindowAsync($handle, 9)
  $broughtToTop = $null
  $setForeground = [GevOwnedBrowserWindow]::SetForegroundWindow($handle)
}
Start-Sleep -Milliseconds 100
$foreground = [GevOwnedBrowserWindow]::GetForegroundWindow()
$foregroundPid = [uint32]0
[void][GevOwnedBrowserWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$confirmed = $foreground -eq $handle
$foregroundProcessName = if ($foregroundPid -gt 0) {
  (Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue).ProcessName
} else { $null }
$desktopState = if ($foregroundProcessName -eq 'LockApp') { 'locked' } else { 'interactive' }
[pscustomobject]@{
  schema = '${WINDOWS_FOREGROUND_SCHEMA}'
  status = $(if ($confirmed) { 'foreground-confirmed' } else { 'foreground-not-confirmed' })
  browserPid = $browserPid
  windowHandleAvailable = $handle -ne [IntPtr]::Zero
  windowHandleSource = $handleSource
  handlePollAttempts = $attempts
  inputAttached = $attached
  mutationSkipped = $alreadyForeground
  showWindowAccepted = $(if ($alreadyForeground) { $null } else { $shown })
  bringWindowToTopAccepted = $(if ($alreadyForeground) { $null } else { $broughtToTop })
  setForegroundAccepted = $(if ($alreadyForeground) { $null } else { $setForeground })
  foregroundConfirmed = $confirmed
  foregroundPid = $foregroundPid
  foregroundProcessName = $foregroundProcessName
  desktopState = $desktopState
} | ConvertTo-Json -Compress
if (-not $confirmed) { exit 2 }
`;

async function runPowerShell(browserPid, timeoutMs) {
  try {
    return await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT],
      {
        env: { ...process.env, GEV_OWNED_BROWSER_PID: String(browserPid) },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
    );
  } catch (error) {
    // Node reports execFile's timeout as killed + SIGTERM with no code. Mark
    // this runner-owned timeout explicitly so other process failures are not
    // misclassified as timeouts.
    if (
      error?.killed === true &&
      error?.signal === 'SIGTERM' &&
      error?.code == null
    )
      error.gevTimeout = true;
    throw error;
  }
}

function persistentPowerShellScript() {
  const addTypeStart = POWERSHELL_SCRIPT.indexOf("Add-Type -TypeDefinition @'");
  const addTypeEnd = POWERSHELL_SCRIPT.indexOf("'@\n$browser =", addTypeStart);
  const addType = POWERSHELL_SCRIPT.slice(addTypeStart, addTypeEnd + 2);
  const body = POWERSHELL_SCRIPT.slice(addTypeEnd + 3)
    .replace(/\nif \(-not \$confirmed\) \{ exit 2 \}\s*$/, '\n')
    .replace(/^\$browserPid = .*\n/, '')
    .replace(
      "schema = '${WINDOWS_FOREGROUND_SCHEMA}'",
      "requestId = $requestId\n  schema = '${WINDOWS_FOREGROUND_SCHEMA}'",
    )
    .replace(
      '} | ConvertTo-Json -Compress',
      '} | ConvertTo-Json -Compress\n[Console]::Out.WriteLine($response)',
    )
    .replace('[pscustomobject]@{', '$response = [pscustomobject]@{');
  return String.raw`$ErrorActionPreference = 'Stop'
if (-not ('GevOwnedBrowserWindow' -as [type])) {
${addType}
}
[Console]::Out.WriteLine('{"schema":"${FOREGROUND_DIAGNOSTIC_SCHEMA}","status":"ready"}')
[Console]::Out.Flush()
while (($request = [Console]::In.ReadLine()) -ne $null) {
  try {
    $requestParts = $request -split ':'
    $requestId = [int]$requestParts[0]
    $browserPid = [int]$requestParts[1]
${body}
  } catch {
    $response = [pscustomobject]@{
      requestId = $requestId
      schema = '${WINDOWS_FOREGROUND_SCHEMA}'
      status = 'runner-error'
      browserPid = $browserPid
      foregroundConfirmed = $false
    }
    [Console]::Out.WriteLine($response | ConvertTo-Json -Compress)
  }
  [Console]::Out.Flush()
}
`;
}

export function createWindowsForegroundActivationSession({
  browserPid,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  if (platform !== 'win32')
    return {
      start: async () => {},
      request: async () => ({ stdout: '' }),
      dispose: async () => {},
    };
  if (!Number.isSafeInteger(browserPid) || browserPid < 1)
    throw new TypeError('Owned browser PID must be a positive integer.');
  let child = null;
  let buffer = '';
  let ready = null;
  let pending = null;
  let nextRequestId = 1;
  let disposed = false;
  let unusable = false;
  let disposePromise = null;
  const MAX_BUFFER_BYTES = 64 * 1024;
  const takeLine = () => {
    const index = buffer.indexOf('\n');
    if (index < 0) return null;
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    return line;
  };
  const settle = (operation, method, value) => {
    if (!operation) return;
    if (operation.timer) clearTimeout(operation.timer);
    if (operation.stdinError)
      child?.stdin?.removeListener?.('error', operation.stdinError);
    operation[method](value);
  };
  const fail = (error) => {
    if (unusable) return;
    unusable = true;
    const currentReady = ready;
    const currentPending = pending;
    ready = null;
    pending = null;
    settle(currentReady, 'reject', error);
    settle(currentPending, 'reject', error);
    try {
      child?.kill();
    } catch {}
  };
  const onData = (chunk) => {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer, 'utf8') > MAX_BUFFER_BYTES) {
      fail(new Error('Foreground helper output exceeded its bounded limit.'));
      return;
    }
    let line;
    while ((line = takeLine()) !== null) {
      if (ready) {
        const current = ready;
        ready = null;
        try {
          const parsed = JSON.parse(line);
          if (
            parsed?.schema !== FOREGROUND_DIAGNOSTIC_SCHEMA ||
            parsed?.status !== 'ready'
          )
            throw new Error('Helper startup failed.');
          settle(current, 'resolve');
        } catch (error) {
          settle(current, 'reject', error);
          fail(error);
        }
      } else if (pending) {
        const current = pending;
        pending = null;
        try {
          const parsed = JSON.parse(line);
          if (parsed?.requestId !== current.requestId)
            throw new Error('Foreground helper response sequence mismatch.');
          settle(current, 'resolve', { stdout: line });
        } catch (error) {
          settle(current, 'reject', error);
          fail(error);
        }
      } else {
        fail(new Error('Unexpected foreground helper output.'));
      }
    }
  };
  const start = async ({ timeoutMs = 15_000 } = {}) => {
    if (disposed || unusable)
      throw new Error('Foreground helper is unavailable.');
    if (child) return;
    try {
      child = spawnImpl(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          persistentPowerShellScript(),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
    } catch (error) {
      fail(error);
      throw error;
    }
    child.stdout.on('data', onData);
    const failure = (error) =>
      fail(
        error instanceof Error ? error : new Error('Foreground helper exited.'),
      );
    child.once('error', failure);
    child.once('exit', (code, signal) => {
      if (!disposed && !unusable)
        failure(
          Object.assign(new Error('Foreground helper exited.'), {
            code,
            signal,
          }),
        );
    });
    await new Promise((resolve, reject) => {
      const operation = { resolve, reject, timer: null };
      ready = operation;
      operation.timer = setTimeout(() => {
        if (ready) {
          const error = new Error('Foreground helper startup timed out.');
          error.gevTimeout = true;
          fail(error);
        }
      }, timeoutMs);
      operation.timer.unref?.();
    });
  };
  const request = async (requestedPid, timeoutMs) => {
    if (requestedPid !== browserPid)
      throw new Error('Foreground helper PID mismatch.');
    if (!child || disposed || unusable)
      throw new Error('Foreground helper is unavailable.');
    if (pending) throw new Error('Foreground helper request already pending.');
    const requestId = nextRequestId++;
    const response = new Promise((resolve, reject) => {
      const operation = { resolve, reject, requestId, timer: null };
      pending = operation;
      operation.stdinError = (error) => {
        if (pending === operation) {
          pending = null;
          settle(operation, 'reject', error);
          fail(error);
        }
      };
      child.stdin.once?.('error', operation.stdinError);
      operation.timer = setTimeout(() => {
        if (pending) {
          const error = new Error('Foreground helper request timed out.');
          error.gevTimeout = true;
          fail(error);
        }
      }, timeoutMs);
      operation.timer.unref?.();
    });
    try {
      child.stdin.write(`${requestId}:${requestedPid}\n`);
    } catch (error) {
      fail(error);
      throw error;
    }
    return response;
  };
  const dispose = async () => {
    if (disposePromise) return disposePromise;
    disposed = true;
    const currentReady = ready;
    const currentPending = pending;
    ready = null;
    pending = null;
    settle(currentReady, 'reject', new Error('Foreground helper disposed.'));
    settle(currentPending, 'reject', new Error('Foreground helper disposed.'));
    const ownedChild = child;
    child = null;
    if (!ownedChild) return;
    disposePromise = new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        ownedChild.removeListener?.('exit', finish);
        ownedChild.removeListener?.('close', finish);
        resolve();
      };
      ownedChild.once?.('exit', finish);
      ownedChild.once?.('close', finish);
      try {
        ownedChild.stdin.end();
      } catch {}
      setTimeout(() => {
        try {
          ownedChild.kill();
        } catch {}
        finish();
      }, 1000).unref?.();
    });
    return disposePromise;
  };
  return { start, request, dispose };
}

export async function focusOwnedWindowsBrowserWindow({
  browserPid,
  enabled = true,
  platform = process.platform,
  timeoutMs = 15_000,
  runner = runPowerShell,
} = {}) {
  if (!enabled || platform !== 'win32')
    return {
      schema: WINDOWS_FOREGROUND_SCHEMA,
      status: enabled ? 'unsupported-platform' : 'disabled',
      foregroundConfirmed: null,
    };
  if (!Number.isSafeInteger(browserPid) || browserPid < 1)
    throw new TypeError('Owned browser PID must be a positive integer.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError(
      'Windows foreground activation timeout must be positive.',
    );

  let stdout;
  try {
    ({ stdout } = await runner(browserPid, timeoutMs));
  } catch (cause) {
    const error = new Error(
      'Windows could not activate the owned performance browser window.',
      { cause },
    );
    error.name = 'HostWindowActivationError';
    const rawEvidence = String(cause?.stdout || '').trim();
    const parsedEvidence = parseEvidence(rawEvidence);
    if (parsedEvidence) {
      error.evidence = parsedEvidence;
      attachDiagnostic(
        error,
        cause,
        parsedEvidence,
        parsedEvidence.desktopState === 'locked' ? 'locked' : 'process-exited',
      );
      if (error.evidence?.desktopState === 'locked')
        error.message =
          'Windows desktop is locked; foreground hardware capture cannot start.';
    } else {
      attachDiagnostic(
        error,
        cause,
        null,
        rawEvidence
          ? 'malformed-evidence'
          : cause?.gevTimeout === true ||
              cause?.code === 'ETIMEDOUT' ||
              cause?.name === 'TimeoutError'
            ? 'timeout'
            : 'process-failure',
      );
    }
    throw error;
  }
  let evidence;
  try {
    evidence = JSON.parse(String(stdout).trim());
  } catch (cause) {
    const error = new Error(
      'Windows foreground activation returned malformed evidence.',
      { cause },
    );
    error.name = 'HostWindowActivationError';
    attachDiagnostic(error, cause, null, 'malformed-evidence');
    throw error;
  }
  if (
    evidence?.schema !== WINDOWS_FOREGROUND_SCHEMA ||
    evidence.status !== 'foreground-confirmed' ||
    evidence.browserPid !== browserPid ||
    evidence.foregroundConfirmed !== true
  ) {
    const error = new Error(
      'Windows foreground activation did not confirm the owned browser window.',
    );
    error.name = 'HostWindowActivationError';
    error.evidence = evidence;
    attachDiagnostic(error, null, evidence, 'unconfirmed');
    throw error;
  }
  return evidence;
}

export { WINDOWS_FOREGROUND_SCHEMA, FOREGROUND_DIAGNOSTIC_SCHEMA };
