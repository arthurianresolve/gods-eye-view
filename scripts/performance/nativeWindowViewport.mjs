import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';

export const NATIVE_WINDOW_VIEWPORT_SCHEMA = 'gev-native-window-viewport/v1';
const executeFile = promisify(execFile);

// This process owns only a temporary DPI-awareness context in its own thread.
// All target-window APIs below are reads; Chrome is maximized through CDP.
const WINDOWS_GEOMETRY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ownedBrowserPid = [int]$env:GEV_NATIVE_WINDOW_BROWSER_PID
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class GevNativeWindowGeometry {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct DisplayMode {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
    public ushort SpecVersion, DriverVersion, Size, DriverExtra; public uint Fields;
    public int PositionX, PositionY; public uint Orientation, FixedOutput;
    public short Color, Duplex, YResolution, TTOption, Collate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string FormName;
    public ushort LogPixels;
    public uint BitsPerPixel, Width, Height, Flags, Frequency, ICMMethod, ICMIntent,
      MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct DisplayDevice {
    public uint Size;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Description;
    public uint State;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Id;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Key;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct MonitorInfo {
    public int Size; public Rect Monitor, Work; public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Device;
  }
  public delegate bool EnumWindowProc(IntPtr handle, IntPtr argument);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr argument);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr handle, StringBuilder name, int maximum);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr handle);
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr handle, ref Point point);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr handle, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool EnumDisplaySettingsEx(string device, int mode, ref DisplayMode data, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice data, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out Rect rect, int bytes);
  public static IntPtr FindUniqueVisibleChromeWindow(uint ownedPid, out int count) {
    IntPtr found = IntPtr.Zero; int matches = 0;
    EnumWindows((handle, _) => {
      uint pid; GetWindowThreadProcessId(handle, out pid);
      if (pid != ownedPid) return true;
      var name = new StringBuilder(128); GetClassName(handle, name, name.Capacity);
      if (IsWindowVisible(handle) && name.ToString() == "Chrome_WidgetWin_1") {
        matches++; found = handle;
      }
      return true;
    }, IntPtr.Zero);
    count = matches; return found;
  }
  public static string FindDisplayAdapter(string monitorDevice) {
    for (uint index=0; index<32; index++) {
      var data = new DisplayDevice(); data.Size = (uint)Marshal.SizeOf(data);
      if (!EnumDisplayDevices(null,index,ref data,0)) break;
      if (data.Name == monitorDevice) return data.Description;
    }
    return null;
  }
}
'@
function RectValue($rect) {
  return @{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom;
    width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) }
}
$previousDpiContext = [GevNativeWindowGeometry]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpiContext -eq [IntPtr]::Zero) { throw 'PMv2 read context unavailable' }
try {
  $ownedProcess = Get-Process -Id $ownedBrowserPid -ErrorAction Stop
  $windowCount = 0
  $handle = [GevNativeWindowGeometry]::FindUniqueVisibleChromeWindow([uint32]$ownedBrowserPid, [ref]$windowCount)
  if ($windowCount -ne 1 -or $handle -eq [IntPtr]::Zero) { throw 'Expected exactly one visible owned Chrome window' }
  $ownerPid = [uint32]0
  [void][GevNativeWindowGeometry]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
  $outer = New-Object GevNativeWindowGeometry+Rect
  $client = New-Object GevNativeWindowGeometry+Rect
  $frame = New-Object GevNativeWindowGeometry+Rect
  if (-not [GevNativeWindowGeometry]::GetWindowRect($handle,[ref]$outer)) { throw 'Window rect unavailable' }
  if (-not [GevNativeWindowGeometry]::GetClientRect($handle,[ref]$client)) { throw 'Client rect unavailable' }
  $origin = New-Object GevNativeWindowGeometry+Point
  if (-not [GevNativeWindowGeometry]::ClientToScreen($handle,[ref]$origin)) { throw 'Client origin unavailable' }
  $client.Left += $origin.X; $client.Right += $origin.X
  $client.Top += $origin.Y; $client.Bottom += $origin.Y
  if ([GevNativeWindowGeometry]::DwmGetWindowAttribute($handle,9,[ref]$frame,16) -ne 0) { throw 'DWM visible frame unavailable' }
  $monitor = [GevNativeWindowGeometry]::MonitorFromWindow($handle,2)
  $info = New-Object GevNativeWindowGeometry+MonitorInfo
  $info.Size = [Runtime.InteropServices.Marshal]::SizeOf($info)
  if (-not [GevNativeWindowGeometry]::GetMonitorInfo($monitor,[ref]$info)) { throw 'Owned-window monitor unavailable' }
  $mode = New-Object GevNativeWindowGeometry+DisplayMode
  $mode.Size = [Runtime.InteropServices.Marshal]::SizeOf($mode)
  if (-not [GevNativeWindowGeometry]::EnumDisplaySettingsEx($info.Device,-1,[ref]$mode,0)) { throw 'Owned-monitor active display mode unavailable' }
  $adapter = [GevNativeWindowGeometry]::FindDisplayAdapter($info.Device)
  if ([String]::IsNullOrWhiteSpace($adapter)) { throw 'Owned-monitor display adapter unavailable' }
  $dpi = [GevNativeWindowGeometry]::GetDpiForWindow($handle)
  $awareness = [GevNativeWindowGeometry]::GetAwarenessFromDpiAwarenessContext([GevNativeWindowGeometry]::GetWindowDpiAwarenessContext($handle))
  @{ schema='gev-owned-windows-window-geometry/v1'; browserPid=$ownedBrowserPid; ownerPid=$ownerPid;
     processName=$ownedProcess.ProcessName; windowHandle=$handle.ToInt64().ToString(); ownedWindowCount=$windowCount;
     physicalPixelReadContext='per-monitor-aware-v2'; targetDpiAwareness=$awareness; dpi=$dpi;
     visible=[GevNativeWindowGeometry]::IsWindowVisible($handle); minimized=[GevNativeWindowGeometry]::IsIconic($handle);
     maximized=[GevNativeWindowGeometry]::IsZoomed($handle); foreground=([GevNativeWindowGeometry]::GetForegroundWindow() -eq $handle);
     windowRect=(RectValue $outer); clientRect=(RectValue $client); visibleFrameRect=(RectValue $frame);
     monitor=@{ device=$info.Device; bounds=(RectValue $info.Monitor); workArea=(RectValue $info.Work);
       displayMode=@{ width=$mode.Width; height=$mode.Height; refreshHz=$mode.Frequency; bitsPerPixel=$mode.BitsPerPixel;
         orientation=$mode.Orientation; positionX=$mode.PositionX; positionY=$mode.PositionY; adapter=$adapter } };
     observedAtUtc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 6 -Compress
} finally {
  [void][GevNativeWindowGeometry]::SetThreadDpiAwarenessContext($previousDpiContext)
}
`;

/** Read the one owned Chrome window; never activate, resize or inspect other apps. */
export async function readOwnedWindowsNativeWindowGeometry(
  browserPid,
  { platform = process.platform, run = executeFile, signal } = {},
) {
  if (platform !== 'win32')
    throw new Error('Native-window geometry requires the Windows desktop');
  if (!Number.isSafeInteger(browserPid) || browserPid < 1)
    throw new TypeError('Native-window browser PID is invalid');
  const result = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(WINDOWS_GEOMETRY_SCRIPT, 'utf16le').toString('base64'),
    ],
    {
      env: {
        ...process.env,
        GEV_NATIVE_WINDOW_BROWSER_PID: String(browserPid),
      },
      timeout: 5000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    },
  );
  const evidence = JSON.parse(String(result.stdout).trim());
  if (
    evidence?.schema !== 'gev-owned-windows-window-geometry/v1' ||
    evidence.browserPid !== browserPid ||
    evidence.ownerPid !== browserPid
  )
    throw new Error(
      'Native-window host evidence is not bound to the owned PID',
    );
  return evidence;
}

/** Serialized read only: no emulation, page scale, CSS or renderer mutation. */
export function readNativeWindowViewportInPage() {
  const viewer = window.__godsEyeView?.viewer;
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  const viewport = window.visualViewport;
  const canvasRect = canvas?.getBoundingClientRect();
  // about:blank may be in quirks mode; CSSOM assigns its viewport client
  // dimensions to body, while the application uses the standards-mode root.
  const viewportElement =
    document.compatMode === 'BackCompat'
      ? document.body
      : document.documentElement;
  return {
    devicePixelRatio: window.devicePixelRatio,
    inner: { width: window.innerWidth, height: window.innerHeight },
    outer: { width: window.outerWidth, height: window.outerHeight },
    screenPosition: { x: window.screenX, y: window.screenY },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availLeft: window.screen.availLeft,
      availTop: window.screen.availTop,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
    visualViewport: viewport
      ? {
          width: viewport.width,
          height: viewport.height,
          scale: viewport.scale,
          offsetLeft: viewport.offsetLeft,
          offsetTop: viewport.offsetTop,
          pageLeft: viewport.pageLeft,
          pageTop: viewport.pageTop,
        }
      : null,
    documentClient: {
      width: viewportElement?.clientWidth,
      height: viewportElement?.clientHeight,
    },
    scroll: { x: window.scrollX, y: window.scrollY },
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    nativeResolution: canvas
      ? {
          devicePixelRatio: window.devicePixelRatio,
          canvas: {
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
          },
          sceneDrawingBuffer: {
            width: scene.drawingBufferWidth,
            height: scene.drawingBufferHeight,
          },
          resolutionScale: viewer.resolutionScale,
          useBrowserRecommendedResolution:
            viewer.useBrowserRecommendedResolution,
          maximumScreenSpaceError: scene.globe?.maximumScreenSpaceError,
        }
      : null,
    canvasRect: canvasRect
      ? {
          left: canvasRect.left,
          top: canvasRect.top,
          right: canvasRect.right,
          bottom: canvasRect.bottom,
          width: canvasRect.width,
          height: canvasRect.height,
        }
      : null,
  };
}

export function resolveNativeWindowBrowserOptions(
  browserOptions,
  { nativeResolution = false, nativeWindowViewport = false } = {},
) {
  assert.equal(
    typeof nativeWindowViewport,
    'boolean',
    'Native window opt-in must be boolean',
  );
  if (!nativeWindowViewport) return { ...browserOptions };
  assert.equal(
    nativeResolution,
    true,
    'Native window requires nativeResolution',
  );
  assert.equal(
    browserOptions.headless,
    false,
    'Native window requires headful Chrome',
  );
  assert.ok(
    browserOptions.defaultViewport == null,
    'Native window requires defaultViewport:null',
  );
  assert.notEqual(
    browserOptions.devtools,
    true,
    'Native window excludes docked DevTools',
  );
  assert.ok(
    !(browserOptions.args || []).some((value) =>
      /^--(?:force-device-scale-factor|high-dpi-support|headless)(?:=|$)/.test(
        value,
      ),
    ),
    'Native window excludes forced DPR/headless arguments',
  );
  return { ...browserOptions, defaultViewport: null };
}

function validateRect(rect, label) {
  assert.ok(
    rect &&
      ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) =>
        Number.isInteger(rect[key]),
      ) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right - rect.left === rect.width &&
      rect.bottom - rect.top === rect.height,
    label + ' physical rectangle is unavailable',
  );
}
const contains = (outer, inner) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.right <= outer.right &&
  inner.bottom <= outer.bottom;

function mapCdpBounds(bounds, host, dpr) {
  for (const rectName of ['windowRect', 'visibleFrameRect']) {
    const physical = host[rectName];
    const enclosed = physicalRectToEnclosingDips(physical, dpr);
    for (const [units, expected] of [
      ['physical-pixels', physical],
      ['native-DIPs', enclosed],
    ])
      if (
        ['left', 'top', 'width', 'height'].every(
          (axis) => bounds[axis] === expected[axis],
        )
      )
        return units + ':' + rectName;
  }
  return null;
}

/** Match Chromium's enclosing rectangle conversion, not rounded size scaling. */
export function physicalRectToEnclosingDips(physical, nativeScale) {
  validateRect(physical, 'Coordinate conversion input');
  assert.ok(
    Number.isFinite(nativeScale) && nativeScale > 0,
    'Native scale is invalid',
  );
  const left = Math.floor(physical.left / nativeScale);
  const top = Math.floor(physical.top / nativeScale);
  const right = Math.ceil(physical.right / nativeScale);
  const bottom = Math.ceil(physical.bottom / nativeScale);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** Refuse missing proof; this contract never substitutes a smaller renderer scale. */
export function assertNativeWindowViewportEvidence(
  evidence,
  { expectedDpr, requireCanvas = true, reference = null } = {},
) {
  assert.equal(evidence?.schema, NATIVE_WINDOW_VIEWPORT_SCHEMA);
  if (evidence.preparation !== undefined) {
    assert.equal(
      evidence.preparation.schema,
      'gev-native-window-preparation/v1',
    );
    assert.equal(evidence.preparation.status, 'passed');
    assert.ok(evidence.preparation.attempts?.length >= 2);
    assert.equal(
      evidence.preparation.acceptedAttempt,
      evidence.preparation.attempts.length,
    );
    assert.equal(evidence.preparation.attempts.at(-1).status, 'coherent');
    assert.equal(evidence.preparation.attempts.at(-2).status, 'coherent');
    assert.equal(evidence.preparation.attempts.at(-1).matchesPrevious, true);
  }
  const { page, host, cdp } = evidence;
  assert.equal(evidence.metricsEmulation, 'cleared-before-navigation');
  assert.equal(
    evidence.puppeteerViewport,
    null,
    'Viewport emulation is active',
  );
  assert.equal(cdp?.windowBounds?.windowState, 'maximized');
  assert.ok(Number.isSafeInteger(cdp.windowId) && cdp.windowId > 0);
  assert.ok(
    ['left', 'top', 'width', 'height'].every((key) =>
      Number.isInteger(cdp.windowBounds[key]),
    ) &&
      cdp.windowBounds.width > 0 &&
      cdp.windowBounds.height > 0,
    'CDP native window bounds are unavailable',
  );
  assert.equal(host?.schema, 'gev-owned-windows-window-geometry/v1');
  assert.ok(
    Number.isSafeInteger(evidence.browserPid) && evidence.browserPid > 0,
  );
  assert.equal(
    host.browserPid,
    evidence.browserPid,
    'Host browser PID changed',
  );
  assert.equal(host.ownerPid, host.browserPid, 'Window owner changed');
  assert.match(host.windowHandle, /^[1-9][0-9]*$/);
  assert.equal(host.ownedWindowCount, 1);
  assert.equal(host.physicalPixelReadContext, 'per-monitor-aware-v2');
  assert.equal(
    host.targetDpiAwareness,
    2,
    'Target window is not per-monitor aware',
  );
  assert.ok(Number.isInteger(host.dpi) && host.dpi >= 96);
  assert.equal(host.visible, true);
  assert.equal(host.minimized, false);
  assert.equal(host.maximized, true);
  for (const [rect, label] of [
    [host.windowRect, 'Outer window'],
    [host.clientRect, 'Mapped client'],
    [host.visibleFrameRect, 'DWM visible frame'],
    [host.monitor?.bounds, 'Monitor'],
    [host.monitor?.workArea, 'Monitor work area'],
  ])
    validateRect(rect, label);
  assert.ok(contains(host.monitor.bounds, host.monitor.workArea));
  assert.equal(host.monitor.displayMode?.width, host.monitor.bounds.width);
  assert.equal(host.monitor.displayMode?.height, host.monitor.bounds.height);
  assert.ok(
    Number.isInteger(host.monitor.displayMode?.refreshHz) &&
      host.monitor.displayMode.refreshHz > 1,
  );
  assert.ok(
    Number.isInteger(host.monitor.displayMode?.bitsPerPixel) &&
      host.monitor.displayMode.bitsPerPixel > 0,
  );
  assert.ok(
    typeof host.monitor.displayMode?.adapter === 'string' &&
      host.monitor.displayMode.adapter.length > 0,
  );
  assert.ok(
    contains(host.monitor.workArea, host.visibleFrameRect) &&
      contains(host.monitor.workArea, host.clientRect),
    'Visible native window/client extends outside the monitor work area',
  );
  const dpr = page?.devicePixelRatio;
  assert.ok(Number.isFinite(expectedDpr) && expectedDpr > 0);
  assert.equal(dpr, expectedDpr, 'Observed native DPR changed');
  assert.equal(
    dpr,
    host.dpi / 96,
    'DPR differs from native window DPI; zoom unproven',
  );
  assert.equal(page?.visualViewport?.scale, 1, 'Visual/pinch scale changed');
  assert.equal(cdp.layoutMetrics?.cssVisualViewport?.scale, 1);
  assert.equal(
    cdp.layoutMetrics?.cssVisualViewport?.zoom,
    1,
    'Desktop page zoom unproven',
  );
  for (const dimension of ['width', 'height']) {
    assert.ok(
      Number.isInteger(page.inner?.[dimension]) && page.inner[dimension] > 0,
    );
    assert.ok(
      Number.isInteger(page.outer?.[dimension]) && page.outer[dimension] > 0,
    );
    assert.ok(page.inner[dimension] <= page.outer[dimension]);
    assert.equal(page.visualViewport[dimension], page.inner[dimension]);
    assert.equal(page.documentClient[dimension], page.inner[dimension]);
    const clientKey = dimension === 'width' ? 'clientWidth' : 'clientHeight';
    assert.equal(
      cdp.layoutMetrics.cssVisualViewport[clientKey],
      page.inner[dimension],
    );
    assert.equal(
      cdp.layoutMetrics.cssLayoutViewport[clientKey],
      page.inner[dimension],
    );
    assert.equal(
      Math.round(page.screen[dimension] * dpr),
      host.monitor.bounds[dimension],
    );
    const availKey = dimension === 'width' ? 'availWidth' : 'availHeight';
    assert.equal(
      Math.round(page.screen[availKey] * dpr),
      host.monitor.workArea[dimension],
    );
    assert.ok(
      Math.round(page.inner[dimension] * dpr) <= host.clientRect[dimension],
      'Native content extends outside the physical client area',
    );
  }
  assert.equal(Math.round(page.inner.width * dpr), host.clientRect.width);
  for (const [axis, key] of [
    ['x', 'availLeft'],
    ['y', 'availTop'],
  ])
    assert.equal(
      Math.round(page.screen[key] * dpr),
      host.monitor.workArea[axis === 'x' ? 'left' : 'top'],
    );
  const boundsMapping = mapCdpBounds(cdp.windowBounds, host, dpr);
  assert.ok(boundsMapping, 'CDP/Win32 window coordinate mapping is unproven');
  assert.equal(evidence.cdpBoundsMapping, boundsMapping);
  assert.deepEqual(page.scroll, { x: 0, y: 0 });
  assert.equal(page.visualViewport.offsetLeft, 0);
  assert.equal(page.visualViewport.offsetTop, 0);
  assert.equal(page.visualViewport.pageLeft, 0);
  assert.equal(page.visualViewport.pageTop, 0);
  for (const key of ['offsetX', 'offsetY', 'pageX', 'pageY'])
    assert.equal(cdp.layoutMetrics.cssVisualViewport[key], 0);
  assert.equal(page.visibilityState, 'visible');
  const native = page.nativeResolution;
  if (requireCanvas) {
    assert.ok(
      native && page.canvasRect,
      'Active native canvas evidence unavailable',
    );
    assert.equal(native.devicePixelRatio, dpr);
    assert.equal(
      native.resolutionScale,
      1,
      'Renderer resolution scale changed',
    );
    assert.equal(native.useBrowserRecommendedResolution, false);
    assert.equal(native.maximumScreenSpaceError, 1, 'Globe detail changed');
    for (const [axis, clientKey] of [
      ['width', 'clientWidth'],
      ['height', 'clientHeight'],
    ]) {
      assert.equal(native.canvas[clientKey], page.inner[axis]);
      assert.equal(native.canvas[axis], Math.floor(page.inner[axis] * dpr));
      assert.equal(native.sceneDrawingBuffer[axis], native.canvas[axis]);
      assert.equal(page.canvasRect[axis], page.inner[axis]);
    }
    assert.equal(page.canvasRect.left, 0);
    assert.equal(page.canvasRect.top, 0);
    assert.equal(page.canvasRect.right, page.inner.width);
    assert.equal(page.canvasRect.bottom, page.inner.height);
  }
  if (reference) assertMatchingNativeWindowViewport(reference, evidence);
  if (evidence.preparation !== undefined)
    assertNativeWindowPreparationTrace(evidence, expectedDpr);
  return evidence;
}

function comparisonGeometry(evidence) {
  const { page, host, cdp } = evidence;
  return {
    devicePixelRatio: page.devicePixelRatio,
    inner: page.inner,
    outer: page.outer,
    screenPosition: page.screenPosition,
    screen: page.screen,
    visualViewport: page.visualViewport,
    documentClient: page.documentClient,
    nativeResolution: page.nativeResolution,
    canvasRect: page.canvasRect,
    hostDpi: host.dpi,
    hostAwareness: host.targetDpiAwareness,
    monitor: host.monitor,
    clientRect: host.clientRect,
    visibleFrameRect: host.visibleFrameRect,
    windowRect: host.windowRect,
    cdpWindowBounds: cdp.windowBounds,
    cdpBoundsMapping: evidence.cdpBoundsMapping,
    cssLayoutViewport: cdp.layoutMetrics.cssLayoutViewport,
    cssVisualViewport: cdp.layoutMetrics.cssVisualViewport,
  };
}

function configurationGeometry(evidence) {
  const { nativeResolution, canvasRect, ...geometry } =
    comparisonGeometry(evidence);
  return geometry;
}

/** Match configured chrome/viewport geometry to another exact proof. */
export function assertNativeWindowConfigurationPair(
  configured,
  evidence,
  { requireCanvas = false } = {},
) {
  const expectedDpr = configured?.page?.devicePixelRatio;
  assertNativeWindowViewportEvidence(configured, {
    expectedDpr,
    requireCanvas: false,
  });
  assertNativeWindowViewportEvidence(evidence, { expectedDpr, requireCanvas });
  assert.deepEqual(
    configurationGeometry(configured),
    configurationGeometry(evidence),
    'Configured native window geometry changed',
  );
  return true;
}

function assertNativeWindowPreparationTrace(configured, expectedDpr) {
  const proof = configured.preparation;
  assert.equal(proof.requiredConsecutiveCoherentProofs, 2);
  assert.equal(proof.intervalMs, 50);
  assert.equal(
    proof.deadlineScope,
    'after-owned-CDP-session-ready-before-navigation',
  );
  assert.ok(
    Number.isSafeInteger(proof.maximumAttempts) &&
      proof.maximumAttempts >= 2 &&
      proof.maximumAttempts <= 40,
  );
  assert.ok(
    Number.isSafeInteger(proof.timeoutMs) &&
      proof.timeoutMs > 0 &&
      proof.timeoutMs <= 30_000,
  );
  assert.ok(
    Number.isFinite(proof.elapsedMs) &&
      proof.elapsedMs >= 0 &&
      proof.elapsedMs < proof.timeoutMs,
  );
  assert.ok(proof.attempts.length <= proof.maximumAttempts);
  let previous = null;
  let previousObservedAt = -Infinity;
  for (const [index, attempt] of proof.attempts.entries()) {
    assert.equal(attempt.attempt, index + 1);
    const evidence = attempt.evidence;
    assert.equal(evidence?.preparation, undefined);
    assert.equal(evidence?.ordinal, index + 1);
    assert.equal(evidence?.browserPid, configured.browserPid);
    const observedAt = Date.parse(evidence.observedAtUtc);
    assert.ok(Number.isFinite(observedAt) && observedAt >= previousObservedAt);
    previousObservedAt = observedAt;
    let coherent = true;
    try {
      assertNativeWindowViewportEvidence(evidence, {
        expectedDpr,
        requireCanvas: false,
      });
    } catch {
      coherent = false;
    }
    assert.equal(attempt.status, coherent ? 'coherent' : 'incoherent');
    if (coherent) {
      assert.equal(evidence.cdp.windowId, configured.cdp.windowId);
      assert.equal(evidence.host.windowHandle, configured.host.windowHandle);
      const geometry = configurationGeometry(evidence);
      const matches =
        previous !== null && isDeepStrictEqual(previous, geometry);
      assert.equal(attempt.matchesPrevious, matches);
      if (matches)
        assert.equal(
          index,
          proof.attempts.length - 1,
          'Preparation must stop at its first complete stable pair',
        );
      previous = geometry;
    } else {
      assert.ok(typeof attempt.error === 'string' && attempt.error.length > 0);
      previous = null;
    }
  }
  const { preparation, ...accepted } = configured;
  assert.deepEqual(
    accepted,
    proof.attempts.at(-1).evidence,
    'Accepted configured proof differs from its retained attempt',
  );
}

/** Strict paired/checkpoint geometry; only ownership identifiers/timestamps differ. */
export function assertMatchingNativeWindowViewport(baseline, candidate) {
  assertNativeWindowViewportEvidence(baseline, {
    expectedDpr: baseline?.page?.devicePixelRatio,
  });
  assertNativeWindowViewportEvidence(candidate, {
    expectedDpr: baseline?.page?.devicePixelRatio,
  });
  assert.deepEqual(
    comparisonGeometry(candidate),
    comparisonGeometry(baseline),
    'Native window geometry/zoom/sharpness changed across checkpoints or roles',
  );
  return true;
}

export { assertMatchingNativeWindowViewport as assertNativeWindowViewportPair };

function waitForNativePreparation(milliseconds, { signal }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/**
 * Settle complete proofs before navigation; never resample a later checkpoint.
 * The local deadline starts after CDP session acquisition. Browser/session
 * acquisition retain the driver's existing protocol and browser-close bounds.
 */
export async function createNativeWindowViewportOwner({
  page,
  browserPid,
  browserOptions,
  readHostWindow = readOwnedWindowsNativeWindowGeometry,
  settleAttempts = 40,
  settleTimeoutMs = 15_000,
  preparationCleanupTimeoutMs = 1000,
  preparationSignal = null,
  wait = waitForNativePreparation,
} = {}) {
  resolveNativeWindowBrowserOptions(browserOptions, {
    nativeResolution: true,
    nativeWindowViewport: true,
  });
  assert.equal(
    page.viewport(),
    null,
    'Native page was created with viewport emulation',
  );
  assert.ok(
    Number.isSafeInteger(settleAttempts) &&
      settleAttempts >= 2 &&
      settleAttempts <= 40,
  );
  assert.ok(
    Number.isSafeInteger(settleTimeoutMs) &&
      settleTimeoutMs > 0 &&
      settleTimeoutMs <= 30_000,
  );
  assert.ok(
    Number.isSafeInteger(preparationCleanupTimeoutMs) &&
      preparationCleanupTimeoutMs > 0 &&
      preparationCleanupTimeoutMs <= 5000,
  );
  preparationSignal?.throwIfAborted();
  const session = await page.createCDPSession();
  let disposed = false;
  let preparing = true;
  let reference = null;
  let configuredGeometry = null;
  let captureCount = 0;
  const preparationStarted = performance.now();
  const preparation = {
    schema: 'gev-native-window-preparation/v1',
    status: 'settling',
    maximumAttempts: settleAttempts,
    timeoutMs: settleTimeoutMs,
    deadlineScope: 'after-owned-CDP-session-ready-before-navigation',
    cleanupTimeoutMs: preparationCleanupTimeoutMs,
    intervalMs: 50,
    requiredConsecutiveCoherentProofs: 2,
    attempts: [],
  };
  const preparationAbort = new AbortController();
  const cancelPreparation = () =>
    preparationAbort.abort(
      preparationSignal.reason instanceof Error
        ? preparationSignal.reason
        : new Error(
            String(
              preparationSignal.reason || 'Native window preparation aborted',
            ),
          ),
    );
  preparationSignal?.addEventListener('abort', cancelPreparation, {
    once: true,
  });
  if (preparationSignal?.aborted) cancelPreparation();
  const preparationTimeout = setTimeout(() => {
    preparationAbort.abort(new Error('Native window preparation timed out'));
  }, settleTimeoutMs);
  let rejectCancellation;
  const cancelled = new Promise((resolve, reject) => {
    rejectCancellation = () => reject(preparationAbort.signal.reason);
    if (preparationAbort.signal.aborted) reject(preparationAbort.signal.reason);
    else
      preparationAbort.signal.addEventListener('abort', rejectCancellation, {
        once: true,
      });
  });
  // Cancellation can occur between observations; always consume its rejection.
  cancelled.catch(() => {});
  const assertActive = () => {
    assert.equal(disposed, false, 'Native window owner disposed');
    if (preparing) {
      if (
        performance.now() - preparationStarted >= settleTimeoutMs &&
        !preparationAbort.signal.aborted
      )
        preparationAbort.abort(
          new Error('Native window preparation timed out'),
        );
      preparationAbort.signal.throwIfAborted();
    }
  };
  const read = async (operation) => {
    assertActive();
    if (!preparing) {
      const value = await operation();
      assertActive();
      return value;
    }
    const pending = Promise.resolve().then(() => {
      assertActive();
      return operation();
    });
    const value = await (preparing
      ? Promise.race([pending, cancelled])
      : pending);
    assertActive();
    return value;
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (preparing && !preparationAbort.signal.aborted)
      preparationAbort.abort(new Error('Native window preparation disposed'));
    try {
      if (preparing) {
        let timer;
        try {
          await Promise.race([
            Promise.resolve().then(() => session.detach()),
            new Promise((resolve, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error('Native preparation CDP cleanup timed out')),
                preparationCleanupTimeoutMs,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } else await session.detach();
    } catch (error) {
      if (!/Target closed|Session closed/i.test(String(error?.message)))
        throw error;
    }
  };
  let lastEvidence = null;
  try {
    const before = await read(() =>
      page.evaluate(readNativeWindowViewportInPage),
    );
    const window = await read(() => session.send('Browser.getWindowForTarget'));
    assert.ok(Number.isSafeInteger(window.windowId) && window.windowId > 0);
    await read(() =>
      session.send('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: { windowState: 'maximized' },
      }),
    );
    await read(() => session.send('Emulation.clearDeviceMetricsOverride'));
    const snapshot = async (label) => {
      assertActive();
      assert.ok(
        typeof label === 'string' && label.length > 0 && label.length <= 96,
      );
      assert.equal(
        page.viewport(),
        null,
        'Viewport emulation was introduced after preparation',
      );
      const evidence = {
        schema: NATIVE_WINDOW_VIEWPORT_SCHEMA,
        browserPid,
        label,
        ordinal: ++captureCount,
        observedAtUtc: new Date().toISOString(),
        units: {
          page: 'CSS pixels',
          hostRects: 'physical pixels under a temporary PMv2 reader',
          cdpWindowBounds:
            'raw protocol pixels; checked against physical identity or exact native-DIP enclosing edges',
          nativeWindowScale:
            'GetDpiForWindow / 96 from a per-monitor-aware target',
          browserZoom: 'Page.getLayoutMetrics.cssVisualViewport.zoom',
          visualScale: 'DOM and CDP visualViewport.scale',
        },
        metricsEmulation: 'cleared-before-navigation',
        puppeteerViewport: page.viewport(),
        observedDprBeforeConfiguration: before.devicePixelRatio,
      };
      lastEvidence = evidence;
      try {
        const currentWindow = await read(() =>
          session.send('Browser.getWindowForTarget'),
        );
        evidence.cdp = {
          windowId: currentWindow.windowId,
          windowBounds: currentWindow.bounds,
        };
        if (currentWindow.windowId !== window.windowId)
          throw new Error('Owned CDP window changed');
        const layout = await read(() => session.send('Page.getLayoutMetrics'));
        evidence.cdp.layoutMetrics = {
          cssLayoutViewport: layout.cssLayoutViewport,
          cssVisualViewport: layout.cssVisualViewport,
          cssContentSize: layout.cssContentSize,
        };
        evidence.host = await read(() =>
          readHostWindow(
            browserPid,
            preparing ? { signal: preparationAbort.signal } : undefined,
          ),
        );
        evidence.page = await read(() =>
          page.evaluate(readNativeWindowViewportInPage),
        );
        evidence.cdpBoundsMapping = mapCdpBounds(
          currentWindow.bounds,
          evidence.host,
          evidence.page.devicePixelRatio,
        );
        return evidence;
      } catch (error) {
        error.nativeWindowViewport = evidence;
        throw error;
      }
    };
    const capture = async (label, { requireCanvas = true } = {}) => {
      const evidence = await snapshot(label);
      try {
        assertNativeWindowViewportEvidence(evidence, {
          expectedDpr: before.devicePixelRatio,
          requireCanvas,
          reference: requireCanvas ? reference : null,
        });
        assert.deepEqual(
          configurationGeometry(evidence),
          configuredGeometry,
          'Configured native window geometry changed',
        );
      } catch (error) {
        error.nativeWindowViewport = evidence;
        throw error;
      }
      if (requireCanvas && !reference) reference = evidence;
      return evidence;
    };
    let configured = null;
    let previousGeometry = null;
    let lastFailure = null;
    for (let index = 0; index < settleAttempts; index++) {
      const attempt = { attempt: index + 1, status: 'reading', evidence: null };
      preparation.attempts.push(attempt);
      try {
        const evidence = await snapshot('native-window-configured');
        attempt.evidence = structuredClone(evidence);
        assertNativeWindowViewportEvidence(evidence, {
          expectedDpr: before.devicePixelRatio,
          requireCanvas: false,
        });
        const geometry = configurationGeometry(evidence);
        attempt.status = 'coherent';
        attempt.matchesPrevious =
          previousGeometry !== null &&
          isDeepStrictEqual(geometry, previousGeometry);
        assertActive();
        if (attempt.matchesPrevious) {
          configured = evidence;
          configuredGeometry = geometry;
          break;
        }
        previousGeometry = geometry;
      } catch (error) {
        attempt.evidence ||= structuredClone(
          error.nativeWindowViewport || lastEvidence,
        );
        attempt.status = 'incoherent';
        attempt.error = error.message;
        previousGeometry = null;
        lastFailure = error;
        if (error.name !== 'AssertionError') throw error;
      }
      if (index + 1 < settleAttempts)
        await read(() => wait(50, { signal: preparationAbort.signal }));
    }
    if (!configured)
      throw new Error(
        'Native window complete proof did not settle' +
          (lastFailure ? ': ' + lastFailure.message : ''),
      );
    assertActive();
    preparation.status = 'passed';
    preparation.elapsedMs = performance.now() - preparationStarted;
    preparation.acceptedAttempt = preparation.attempts.length;
    configured.preparation = structuredClone(preparation);
    assertNativeWindowViewportEvidence(configured, {
      expectedDpr: before.devicePixelRatio,
      requireCanvas: false,
    });
    assertActive();
    return {
      schema: NATIVE_WINDOW_VIEWPORT_SCHEMA,
      configured,
      preparation,
      nativeDpr: before.devicePixelRatio,
      capture,
      dispose,
    };
  } catch (error) {
    preparation.status = 'failed';
    preparation.elapsedMs = performance.now() - preparationStarted;
    const failedEvidence = error.nativeWindowViewport || lastEvidence;
    try {
      await dispose();
      preparation.cleanup = { status: 'completed' };
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
      preparation.cleanup = { status: 'failed', reason: cleanupError.message };
    }
    error.nativeWindowViewport = {
      ...failedEvidence,
      preparation: structuredClone(preparation),
    };
    throw error;
  } finally {
    clearTimeout(preparationTimeout);
    preparationSignal?.removeEventListener('abort', cancelPreparation);
    preparationAbort.signal.removeEventListener('abort', rejectCancellation);
    preparing = false;
  }
}
