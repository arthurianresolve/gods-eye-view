const MAX_EVENTS = 32;
const MAX_HEARTBEATS = 16;
const MAX_TARGETS = 24;
const MAX_TEXT = 320;

function boundedText(value, limit = MAX_TEXT) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[path]')
    .replace(/([?&][^=\s]+)=([^&\s]+)/g, '$1=[redacted]')
    .slice(0, limit);
}

function locationClass(value, appOrigin) {
  if (!value || value === 'about:blank') return 'blank';
  try {
    const url = new URL(value);
    if (url.origin === appOrigin) return 'app';
    if (
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    )
      return 'local';
  } catch {
    return 'blank';
  }
  return 'external';
}

function safePath(value, appOrigin) {
  const location = locationClass(value, appOrigin);
  if (location !== 'app' && location !== 'local') return null;
  try {
    const url = new URL(value);
    return url.pathname
      .split('/')
      .map((part) =>
        /^[A-Za-z0-9_-]{28,}$/.test(part) ? '[segment]' : part,
      )
      .join('/')
      .slice(0, 180);
  } catch {
    return null;
  }
}

/** Bounded, URL-redacted startup evidence for the profile-recovery fixture. */
export function createStartupDiagnostics(baseUrl) {
  const appOrigin = new URL(baseUrl).origin;
  const heartbeats = [];
  const requests = [];
  const stderr = [];
  let initialTargets = [];

  const push = (list, value, limit = MAX_EVENTS) => {
    list.push(value);
    if (list.length > limit) list.splice(0, list.length - limit);
  };

  return {
    recordHeartbeat(value) {
      push(heartbeats, {
        receivedAt: Date.now(),
        readyState: ['loading', 'interactive', 'complete'].includes(
          value?.readyState,
        )
          ? value.readyState
          : 'unknown',
        appPresent: value?.appPresent === true,
        canvasCount: Number.isSafeInteger(value?.canvasCount)
          ? Math.max(0, value.canvasCount)
          : null,
        loaderText: boundedText(value?.loaderText, 140),
      }, MAX_HEARTBEATS);
    },
    recordRequest({ url, status = null, method = null, resourceType = null, failure = null }) {
      push(requests, {
        at: Date.now(),
        location: locationClass(url, appOrigin),
        path: safePath(url, appOrigin),
        status: Number.isInteger(status) ? status : null,
        method: boundedText(method, 12),
        resourceType: boundedText(resourceType, 24),
        failure: boundedText(failure, 100),
      });
    },
    recordStderr(value) {
      for (const line of boundedText(value, 1200).split(/\r?\n/)) {
        if (line.trim()) push(stderr, { at: Date.now(), text: line }, 16);
      }
    },
    recordInitialTargets(targets) {
      initialTargets = summarizeTargets(targets, appOrigin);
    },
    recordTargets(targets) {
      return summarizeTargets(targets, appOrigin);
    },
    snapshot({
      domState = null,
      targetInventory = [],
      chromeProcessCount = null,
      browserProcessId = null,
    } = {}) {
      const latest = heartbeats.at(-1) || null;
      const heartbeatTail = heartbeats.slice(-8).map((heartbeat, index, tail) => ({
        ...heartbeat,
        ageMs: Math.max(0, Date.now() - heartbeat.receivedAt),
        gapMs:
          index > 0
            ? heartbeat.receivedAt - tail[index - 1].receivedAt
            : null,
      }));
      return {
        rendererResponsive: domState !== null,
        domState,
        lastHeartbeat: latest
          ? {
              ...latest,
              ageMs: Math.max(0, Date.now() - latest.receivedAt),
            }
          : null,
        heartbeatTail,
        heartbeatCount: heartbeats.length,
        requests: [...requests],
        stderr: [...stderr],
        initialTargets: [...initialTargets],
        targetInventory: [...targetInventory],
        chromeProcessCount,
        browserProcessId: Number.isSafeInteger(browserProcessId)
          ? browserProcessId
          : null,
      };
    },
  };
}

function summarizeTargets(targets, appOrigin) {
  return targets.slice(0, MAX_TARGETS).map((target) => {
    const url = typeof target.url === 'function' ? target.url() : target.url;
    return {
      type: boundedText(
        typeof target.type === 'function' ? target.type() : target.type,
        24,
      ),
      location: locationClass(url, appOrigin),
    };
  });
}

/** Evaluate minimal DOM state with a host-side deadline if the renderer is wedged. */
export async function captureBoundedDomState(page, timeoutMs = 5_000) {
  const result = await withHostTimeout(
    () =>
      page.evaluate(() => ({
        readyState: document.readyState,
        appPresent: Boolean(window.__godsEyeView),
        canvasCount: document.querySelectorAll('canvas').length,
        loaderText:
          document
            .querySelector('#loading-screen .loader-status')
            ?.textContent?.trim()
            .slice(0, 140) || '',
      })),
    timeoutMs,
  );
  return result
    ? {
        readyState: result.readyState,
        appPresent: result.appPresent === true,
        canvasCount: Number.isSafeInteger(result.canvasCount)
          ? Math.max(0, result.canvasCount)
          : null,
        loaderText: boundedText(result.loaderText, 140),
      }
    : null;
}

/** Return null instead of waiting indefinitely for a stalled renderer or CDP call. */
export async function withHostTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function sanitizeDiagnosticText(value, limit = MAX_TEXT) {
  return boundedText(value, limit);
}

/** Install a low-rate heartbeat without reading storage or graphics state. */
export async function installStartupHeartbeat(page, diagnostics) {
  await page.exposeFunction('__gevRecoveryHeartbeat', (state) =>
    diagnostics.recordHeartbeat(state),
  );
  const script = await page.evaluateOnNewDocument(() => {
    const send = () => {
      const loaderText =
        document
          .querySelector('#loading-screen .loader-status')
          ?.textContent?.trim()
          .slice(0, 140) || '';
      void window.__gevRecoveryHeartbeat?.({
        readyState: document.readyState,
        appPresent: Boolean(window.__godsEyeView),
        canvasCount: document.querySelectorAll('canvas').length,
        loaderText,
      }).catch(() => {});
    };
    send();
    window.__gevRecoveryHeartbeatTimer = window.setInterval(send, 1000);
  });
  return script?.identifier || null;
}

export async function cleanupStartupHeartbeat(
  page,
  scriptIdentifier,
  timeoutMs = 1000,
) {
  const timerCleared =
    (await withHostTimeout(
      async () => {
        await page.evaluate(() => {
          clearInterval(window.__gevRecoveryHeartbeatTimer);
          delete window.__gevRecoveryHeartbeatTimer;
        });
        return true;
      },
      timeoutMs,
    )) === true;
  const scriptRemoved = scriptIdentifier
    ? (await withHostTimeout(
        async () => {
          await page.removeScriptToEvaluateOnNewDocument(scriptIdentifier);
          return true;
        },
        timeoutMs,
      )) === true
    : true;
  const bindingRemoved =
    (await withHostTimeout(
      async () => {
        await page.removeExposedFunction('__gevRecoveryHeartbeat');
        return true;
      },
      timeoutMs,
    )) === true;
  return { timerCleared, scriptRemoved, bindingRemoved };
}
