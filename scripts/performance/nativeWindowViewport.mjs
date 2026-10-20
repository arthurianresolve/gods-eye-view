import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  { platform = process.platform, run = executeFile } = {},
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
  for (const rectName of ['windowRect', 'visibleFrameRect'])
    for (const units of ['physical-pixels', 'native-DIPs'])
      if (
        ['left', 'top', 'width', 'height'].every(
          (axis) =>
            Math.round(bounds[axis] * (units === 'native-DIPs' ? dpr : 1)) ===
            host[rectName][axis],
        )
      )
        return units + ':' + rectName;
  return null;
}

/** Refuse missing proof; this contract never substitutes a smaller renderer scale. */
export function assertNativeWindowViewportEvidence(
  evidence,
  { expectedDpr, requireCanvas = true, reference = null } = {},
) {
  assert.equal(evidence?.schema, NATIVE_WINDOW_VIEWPORT_SCHEMA);
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

/** Configure one owned page before navigation, then retain read-only checkpoints. */
export async function createNativeWindowViewportOwner({
  page,
  browserPid,
  browserOptions,
  readHostWindow = readOwnedWindowsNativeWindowGeometry,
  settleAttempts = 40,
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
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
  const session = await page.createCDPSession();
  let disposed = false;
  let reference = null;
  let configuredGeometry = null;
  let captureCount = 0;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      await session.detach();
    } catch (error) {
      if (!/Target closed|Session closed/i.test(String(error?.message)))
        throw error;
    }
  };
  try {
    const before = await page.evaluate(readNativeWindowViewportInPage);
    const window = await session.send('Browser.getWindowForTarget');
    assert.ok(Number.isSafeInteger(window.windowId) && window.windowId > 0);
    await session.send('Browser.setWindowBounds', {
      windowId: window.windowId,
      bounds: { windowState: 'maximized' },
    });
    await session.send('Emulation.clearDeviceMetricsOverride');
    let previous = null;
    let settled = false;
    for (let attempt = 0; attempt < settleAttempts; attempt++) {
      const bounds = await session.send('Browser.getWindowBounds', {
        windowId: window.windowId,
      });
      const observed = await page.evaluate(readNativeWindowViewportInPage);
      const key = JSON.stringify({
        inner: observed.inner,
        outer: observed.outer,
        bounds: bounds.bounds,
      });
      if (bounds.bounds.windowState === 'maximized' && key === previous) {
        settled = true;
        break;
      }
      previous = key;
      if (attempt + 1 < settleAttempts) await wait(50);
    }
    assert.ok(settled, 'Native maximization geometry did not settle');
    const capture = async (label, { requireCanvas = true } = {}) => {
      assert.equal(disposed, false, 'Native window owner disposed');
      assert.ok(
        typeof label === 'string' && label.length > 0 && label.length <= 96,
      );
      assert.equal(
        page.viewport(),
        null,
        'Viewport emulation was introduced after preparation',
      );
      const currentWindow = await session.send('Browser.getWindowForTarget');
      assert.equal(
        currentWindow.windowId,
        window.windowId,
        'Owned CDP window changed',
      );
      const layout = await session.send('Page.getLayoutMetrics');
      const host = await readHostWindow(browserPid);
      const observed = await page.evaluate(readNativeWindowViewportInPage);
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
            'raw protocol pixels; not assumed equal to physical pixels',
          nativeWindowScale:
            'GetDpiForWindow / 96 from a per-monitor-aware target',
          browserZoom: 'Page.getLayoutMetrics.cssVisualViewport.zoom',
          visualScale: 'DOM and CDP visualViewport.scale',
        },
        metricsEmulation: 'cleared-before-navigation',
        puppeteerViewport: page.viewport(),
        observedDprBeforeConfiguration: before.devicePixelRatio,
        page: observed,
        host,
        cdpBoundsMapping: mapCdpBounds(
          currentWindow.bounds,
          host,
          observed.devicePixelRatio,
        ),
        cdp: {
          windowId: currentWindow.windowId,
          windowBounds: currentWindow.bounds,
          layoutMetrics: {
            cssLayoutViewport: layout.cssLayoutViewport,
            cssVisualViewport: layout.cssVisualViewport,
            cssContentSize: layout.cssContentSize,
          },
        },
      };
      try {
        assertNativeWindowViewportEvidence(evidence, {
          expectedDpr: before.devicePixelRatio,
          requireCanvas,
          reference: requireCanvas ? reference : null,
        });
        const { nativeResolution, canvasRect, ...geometry } =
          comparisonGeometry(evidence);
        if (configuredGeometry)
          assert.deepEqual(
            geometry,
            configuredGeometry,
            'Configured native window geometry changed',
          );
        else configuredGeometry = geometry;
      } catch (error) {
        error.nativeWindowViewport = evidence;
        throw error;
      }
      if (requireCanvas && !reference) reference = evidence;
      return evidence;
    };
    const configured = await capture('native-window-configured', {
      requireCanvas: false,
    });
    return {
      schema: NATIVE_WINDOW_VIEWPORT_SCHEMA,
      configured,
      nativeDpr: before.devicePixelRatio,
      capture,
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}
