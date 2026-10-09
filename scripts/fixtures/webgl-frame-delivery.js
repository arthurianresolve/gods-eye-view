const DURATION_MS = 5000;
const POINT_COUNT = 5000;
const BUCKET_MS = 1000;
const MAX_EVENTS = 32;

const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const modeSelect = document.querySelector('#mode');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
let canvas = document.querySelector('#surface');
let lastReport = null;
const appCommit =
  typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not allocate a WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message.slice(0, 300));
  }
  return shader;
}

function createPointProgram(gl) {
  let vertex = null;
  let fragment = null;
  let program = null;
  let linked = false;
  try {
    vertex = compileShader(
      gl,
      gl.VERTEX_SHADER,
      `#version 300 es
     precision highp float;
     void main() {
       float index = float(gl_VertexID);
       float column = mod(index, 100.0);
       float row = floor(index / 100.0);
       vec2 grid = (vec2(column, row) + vec2(0.5)) / vec2(100.0, 50.0);
       gl_Position = vec4(grid * 2.0 - 1.0, 0.0, 1.0);
       gl_PointSize = 9.0;
     }`,
    );
    fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      `#version 300 es
     precision highp float;
     out vec4 color;
     void main() { color = vec4(0.0, 1.0, 1.0, 1.0); }`,
    );
    program = gl.createProgram();
    if (!program) throw new Error('Could not allocate a WebGL program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'Program link failed.';
      throw new Error(message.slice(0, 300));
    }
    linked = true;
    return program;
  } finally {
    try {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program && !linked) gl.deleteProgram(program);
    } catch {
      // Context loss may already have invalidated partially built resources.
    }
  }
}

function replaceSurface() {
  const next = document.createElement('canvas');
  next.id = 'surface';
  next.width = 640;
  next.height = 360;
  canvas.replaceWith(next);
  canvas = next;
}

function readRenderer(gl) {
  const started = performance.now();
  try {
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const parameter = extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER;
    return {
      renderer: String(gl.getParameter(parameter) || 'unknown').slice(0, 200),
      rendererReadElapsedMs: performance.now() - started,
    };
  } catch (error) {
    return {
      renderer: null,
      rendererReadElapsedMs: performance.now() - started,
      rendererReadError: String(error?.message || error).slice(0, 200),
    };
  }
}

runButton.addEventListener('click', () => {
  runButton.disabled = downloadButton.disabled = modeSelect.disabled = true;
  result.textContent = '';
  status.textContent = 'Preparing diagnostic';
  replaceSurface();

  const mode = modeSelect.value;
  let gl = null;
  let program = null;
  let rafId = null;
  let endTimer = null;
  let heartbeatTimer = null;
  let contextLost = false;
  let start = 0;
  let previousFrame = null;
  let maximumFrameGapMs = 0;
  let firstFrameAtMs = null;
  let frames = 0;
  let heartbeatTicks = 0;
  let previousHeartbeat = null;
  let maximumHeartbeatGapMs = 0;
  let wallStartedAt = null;
  let focusedAtStart = null;
  let visibilityAtStart = null;
  let active = false;
  const buckets = Array.from({ length: 5 }, (_, index) => ({
    startMs: index * BUCKET_MS,
    endMs: (index + 1) * BUCKET_MS,
    frames: 0,
  }));
  const events = [];
  const recordEvent = (type) => {
    events.push({ type, atMs: Math.max(0, performance.now() - start) });
    if (events.length > MAX_EVENTS) events.shift();
  };
  const onFocus = () => recordEvent('focus');
  const onBlur = () => recordEvent('blur');
  const onVisibility = () =>
    recordEvent(`visibility:${document.visibilityState}`);
  const onPageHide = () => recordEvent('pagehide');
  const onPageShow = () => recordEvent('pageshow');
  const onContextLost = () => {
    contextLost = true;
    recordEvent('webglcontextlost');
  };

  const cleanup = () => {
    active = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (endTimer !== null) clearTimeout(endTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    if (gl && program) {
      try {
        gl.deleteProgram(program);
      } catch {
        // Context loss may already have invalidated the program.
      }
    }
    if (gl) {
      try {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // Resource deletion above remains the fallback cleanup.
      }
    }
  };

  const finish = (outcome, error = null) => {
    if (!active) return;
    const endedAt = performance.now();
    const rafGap = previousFrame === null ? null : endedAt - previousFrame;
    const timerGap =
      previousHeartbeat === null ? null : endedAt - previousHeartbeat;
    const rect = canvas.getBoundingClientRect();
    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
    );
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
    );
    maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, timerGap || 0);
    const report = {
      schema: 'gev-webgl-frame-delivery/v1',
      appCommit,
      harnessCommit: appCommit,
      scope:
        'diagnostic-only browser frame-delivery observation; not performance acceptance',
      mode,
      outcome,
      ...(error
        ? { error: String(error?.message || error).slice(0, 300) }
        : {}),
      startedAt: wallStartedAt,
      elapsedMs: endedAt - start,
      requestedDurationMs: DURATION_MS,
      browser: {
        userAgent: navigator.userAgent.slice(0, 300),
        focusedAtStart,
        visibilityAtStart,
      },
      pointCount: mode === 'webgl2' ? POINT_COUNT : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: {
        width: canvas.width,
        height: canvas.height,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        viewportIntersection: {
          width: visibleWidth,
          height: visibleHeight,
          fraction:
            rect.width > 0 && rect.height > 0
              ? (visibleWidth * visibleHeight) / (rect.width * rect.height)
              : 0,
        },
      },
      contextAttributes: gl?.getContextAttributes() ?? null,
      renderer: gl ? readRenderer(gl) : null,
      rendererMetadataReadAfterWindow: true,
      frames,
      firstFrameAtMs,
      buckets,
      maximumFrameGapMs: frames >= 2 ? maximumFrameGapMs : null,
      trailingFrameGapMs: rafGap,
      frameClock:
        'performance.now sampled inside each native requestAnimationFrame callback',
      timer: {
        intervalMs: 20,
        ticks: heartbeatTicks,
        maximumGapMs: maximumHeartbeatGapMs,
        trailingGapMs: timerGap,
      },
      finalVisibility: document.visibilityState,
      finalFocused: document.hasFocus(),
      contextLost,
      events,
    };
    cleanup();
    lastReport = report;
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = `Diagnostic ${outcome}`;
    downloadButton.disabled = false;
    runButton.disabled = modeSelect.disabled = false;
  };

  try {
    if (mode === 'webgl2') {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
        stencil: true,
      });
      if (!gl) throw new Error('WebGL2 context creation failed.');
      program = createPointProgram(gl);
    }
  } catch (error) {
    start = performance.now();
    wallStartedAt = new Date().toISOString();
    focusedAtStart = document.hasFocus();
    visibilityAtStart = document.visibilityState;
    active = true;
    finish('setup-failed', error);
    return;
  }

  start = performance.now();
  wallStartedAt = new Date().toISOString();
  focusedAtStart = document.hasFocus();
  visibilityAtStart = document.visibilityState;
  active = true;
  previousHeartbeat = start;
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  if (gl) canvas.addEventListener('webglcontextlost', onContextLost);
  heartbeatTimer = setInterval(() => {
    const now = performance.now();
    maximumHeartbeatGapMs = Math.max(
      maximumHeartbeatGapMs,
      now - previousHeartbeat,
    );
    previousHeartbeat = now;
    heartbeatTicks++;
  }, 20);
  endTimer = setTimeout(() => finish('duration-complete'), DURATION_MS);
  status.textContent = `Running ${mode} for five seconds`;

  const frame = () => {
    rafId = null;
    const timestamp = performance.now();
    const elapsed = timestamp - start;
    if (elapsed >= DURATION_MS) return;
    if (firstFrameAtMs === null) firstFrameAtMs = elapsed;
    if (previousFrame !== null)
      maximumFrameGapMs = Math.max(
        maximumFrameGapMs,
        timestamp - previousFrame,
      );
    previousFrame = timestamp;
    frames++;
    const bucket = buckets[Math.floor(elapsed / BUCKET_MS)];
    if (bucket) bucket.frames++;
    try {
      if (gl && program) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.drawArrays(gl.POINTS, 0, POINT_COUNT);
      }
      rafId = requestAnimationFrame(frame);
    } catch (error) {
      finish('frame-error', error);
    }
  };
  rafId = requestAnimationFrame(frame);
});

downloadButton.addEventListener('click', () => {
  if (!lastReport) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(lastReport, null, 2)], {
      type: 'application/json',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `webgl-frame-delivery-${lastReport.appCommit?.slice(0, 7) || 'local'}-${lastReport.mode}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
