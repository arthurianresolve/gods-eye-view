import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS_FOREGROUND_SCHEMA =
  'gev-windows-owned-browser-foreground-activation/v1';

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
$targetPid = [uint32]0
$targetThread = [GevOwnedBrowserWindow]::GetWindowThreadProcessId($handle, [ref]$targetPid)
$currentThread = [GevOwnedBrowserWindow]::GetCurrentThreadId()
$attachedToPrevious = $false
$attachedToTarget = $false
if ($previousThread -ne 0 -and $previousThread -ne $currentThread) {
  $attachedToPrevious = [GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $previousThread, $true)
}
if ($targetThread -ne 0 -and $targetThread -ne $currentThread -and $targetThread -ne $previousThread) {
  $attachedToTarget = [GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $targetThread, $true)
}
try {
  $focusAttempts = 0
  $shown = $null
  $broughtToTop = $null
  $setForeground = $null
  $foreground = [GevOwnedBrowserWindow]::GetForegroundWindow()
  $foregroundPid = [uint32]0
  [void][GevOwnedBrowserWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $confirmed = $foregroundPid -eq [uint32]$browserPid
  while ((-not $confirmed) -and $focusAttempts -lt 40) {
    $focusAttempts += 1
    $shown = [GevOwnedBrowserWindow]::ShowWindow($handle, 9)
    $broughtToTop = [GevOwnedBrowserWindow]::BringWindowToTop($handle)
    $setForeground = [GevOwnedBrowserWindow]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 50
    $foreground = [GevOwnedBrowserWindow]::GetForegroundWindow()
    $foregroundPid = [uint32]0
    [void][GevOwnedBrowserWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
    $confirmed = $foregroundPid -eq [uint32]$browserPid
  }
} finally {
  if ($attachedToTarget) {
    [void][GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $targetThread, $false)
  }
  if ($attachedToPrevious) {
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
  inputAttached = $attachedToPrevious -or $attachedToTarget
  attachedToPrevious = $attachedToPrevious
  attachedToTarget = $attachedToTarget
  previousThread = $previousThread
  targetThread = $targetThread
  focusAttempts = $focusAttempts
  showWindowAccepted = $shown
  bringWindowToTopAccepted = $broughtToTop
  setForegroundAccepted = $setForeground
  foregroundHandleMatchesTargetHandle = $foreground -eq $handle
  foregroundOwnedByBrowser = $foregroundPid -eq [uint32]$browserPid
  foregroundConfirmed = $confirmed
  foregroundPid = $foregroundPid
  foregroundProcessName = $foregroundProcessName
  desktopState = $desktopState
} | ConvertTo-Json -Compress
if (-not $confirmed) { exit 2 }
`;

async function runPowerShell(browserPid, timeoutMs) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT],
    {
      env: { ...process.env, GEV_OWNED_BROWSER_PID: String(browserPid) },
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    },
  );
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

  // Each PowerShell invocation compiles the small user32 bridge and can spend
  // up to four seconds finding/activating a Chrome window. Two attempts leave
  // enough time for that bounded native work without allowing process startup
  // to consume an artificially tiny per-attempt deadline.
  const maximumAttempts = 2;
  const attempts = [];
  const startedAt = Date.now();
  let stdout;
  let finalCause;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    const remainingAttempts = maximumAttempts - attempt + 1;
    const attemptTimeoutMs = Math.max(
      1,
      Math.floor(remainingMs / remainingAttempts),
    );
    try {
      ({ stdout } = await runner(browserPid, attemptTimeoutMs));
      break;
    } catch (cause) {
      finalCause = cause;
      let evidence = null;
      try {
        evidence = JSON.parse(String(cause?.stdout || '').trim());
      } catch {
        // Preserve a bounded retry record without inventing missing evidence.
      }
      attempts.push({
        attempt,
        timeoutMs: attemptTimeoutMs,
        status: evidence?.status || 'runner-failed-before-evidence',
        desktopState: evidence?.desktopState || null,
        windowHandleAvailable: evidence?.windowHandleAvailable ?? null,
        foregroundPid: evidence?.foregroundPid ?? null,
        runnerFailure: {
          name: String(cause?.name || 'Error').slice(0, 80),
          code:
            typeof cause?.code === 'string' || Number.isInteger(cause?.code)
              ? cause.code
              : null,
          signal: typeof cause?.signal === 'string' ? cause.signal : null,
          killed: cause?.killed === true,
          message: String(cause?.message || cause || '').slice(0, 512),
          stderr:
            String(cause?.stderr || '')
              .trim()
              .slice(-512) || null,
        },
      });
      if (evidence?.desktopState === 'locked') {
        const error = new Error(
          'Windows desktop is locked; foreground hardware capture cannot start.',
          { cause },
        );
        error.name = 'HostWindowActivationError';
        error.evidence = evidence;
        error.activationAttempts = attempts;
        throw error;
      }
      if (attempt < maximumAttempts && Date.now() - startedAt < timeoutMs)
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (stdout == null) {
    const error = new Error(
      'Windows could not activate the owned performance browser window after bounded retries.',
      { cause: finalCause },
    );
    error.name = 'HostWindowActivationError';
    error.evidence = attempts.at(-1) || null;
    error.activationAttempts = attempts;
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
    throw error;
  }
  return evidence;
}

export { WINDOWS_FOREGROUND_SCHEMA };
