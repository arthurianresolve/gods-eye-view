import { execFile } from 'node:child_process';
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
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
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
$previousPid = [uint32]0
$previousThread = [GevOwnedBrowserWindow]::GetWindowThreadProcessId($previous, [ref]$previousPid)
$currentThread = [GevOwnedBrowserWindow]::GetCurrentThreadId()
$attached = $false
if ($previousThread -ne 0 -and $previousThread -ne $currentThread) {
  $attached = [GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $previousThread, $true)
}
try {
  $shown = [GevOwnedBrowserWindow]::ShowWindow($handle, 9)
  $broughtToTop = [GevOwnedBrowserWindow]::BringWindowToTop($handle)
  $setForeground = [GevOwnedBrowserWindow]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 100
  $foreground = [GevOwnedBrowserWindow]::GetForegroundWindow()
  $foregroundPid = [uint32]0
  [void][GevOwnedBrowserWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $confirmed = $foreground -eq $handle
} finally {
  if ($attached) {
    [void][GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $previousThread, $false)
  }
}
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
  showWindowAccepted = $shown
  bringWindowToTopAccepted = $broughtToTop
  setForegroundAccepted = $setForeground
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
