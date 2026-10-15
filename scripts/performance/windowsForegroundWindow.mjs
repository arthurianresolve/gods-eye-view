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
using System.Runtime.InteropServices;
public static class GevOwnedBrowserWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
'@
$browser = Get-Process -Id $browserPid -ErrorAction Stop
$attempts = 0
do {
  $attempts += 1
  $browser.Refresh()
  $handle = $browser.MainWindowHandle
  if ($handle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ($attempts -lt 40)
if ($handle -eq [IntPtr]::Zero) { throw 'Owned browser window handle is unavailable.' }
$previous = [GevOwnedBrowserWindow]::GetForegroundWindow()
$previousThread = [GevOwnedBrowserWindow]::GetWindowThreadProcessId($previous, [IntPtr]::Zero)
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
  $confirmed = [GevOwnedBrowserWindow]::GetForegroundWindow() -eq $handle
} finally {
  if ($attached) {
    [void][GevOwnedBrowserWindow]::AttachThreadInput($currentThread, $previousThread, $false)
  }
}
[pscustomobject]@{
  schema = '${WINDOWS_FOREGROUND_SCHEMA}'
  status = $(if ($confirmed) { 'foreground-confirmed' } else { 'foreground-not-confirmed' })
  browserPid = $browserPid
  windowHandleAvailable = $handle -ne [IntPtr]::Zero
  handlePollAttempts = $attempts
  inputAttached = $attached
  showWindowAccepted = $shown
  bringWindowToTopAccepted = $broughtToTop
  setForegroundAccepted = $setForeground
  foregroundConfirmed = $confirmed
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
    throw new TypeError('Windows foreground activation timeout must be positive.');

  let stdout;
  try {
    ({ stdout } = await runner(browserPid, timeoutMs));
  } catch (cause) {
    const error = new Error(
      'Windows could not activate the owned performance browser window.',
      { cause },
    );
    error.name = 'HostWindowActivationError';
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
