const MAX_EVENTS = 24;
const MAX_PENDING = 24;
const MAX_RESULT_TEXT_LENGTH = 256_000;
const MAX_OUTPUT_TEXT_LENGTH = 16_000;
const PAGE_STATE_TIMEOUT_MS = 500;
const SENSITIVE_KEY =
  /(?:url|token|secret|credential|authorization|cookie|body)/i;
const URL_TEXT = /(?:https?:\/\/|data:|file:)[^\s"'<>]*/gi;
const CREDENTIAL_TEXT =
  /\b(?:token|secret|credential|authorization|cookie|password)=?[^\s&,;]*/gi;
const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'EvalError',
  'AggregateError',
]);

function safePath(value, expectedOrigin) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== expectedOrigin) return null;
    return parsed.pathname.slice(0, 240);
  } catch {
    return null;
  }
}

function boundedValue(value, state, depth = 0) {
  if (state.remaining <= 0) return '[omitted]';
  if (depth > 7) return '[depth-limit]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const safe = value
      .replace(URL_TEXT, '[redacted-url]')
      .replace(CREDENTIAL_TEXT, '[redacted]')
      .slice(0, 512);
    state.remaining -= safe.length;
    return safe;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 24)
      .map((item) => boundedValue(item, state, depth + 1));
  }
  if (typeof value !== 'object') return null;
  const output = {};
  for (const key of Object.keys(value).slice(0, 32)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key.slice(0, 80)] = boundedValue(value[key], state, depth + 1);
  }
  return output;
}

/** Puppeteer-serializable projection for the infrastructure fixture's result element. */
export function summarizeInfrastructureResultElement(element) {
  const text =
    typeof element?.textContent === 'string' ? element.textContent : '';
  if (!text) return { resultState: 'missing', result: null };
  if (text.length > 256_000) return { resultState: 'too-large', result: null };
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return { resultState: 'invalid-json', result: null };
  }
  if (!report || typeof report !== 'object' || Array.isArray(report))
    return { resultState: 'invalid-json', result: null };
  const safeText = (value, maximum = 240) =>
    typeof value === 'string'
      ? value
          .replace(/(?:https?:\/\/|data:|file:)[^\s"'<>]*/gi, '[redacted-url]')
          .replace(
            /\b(?:token|secret|credential|authorization|cookie|password)=?[^\s&,;]*/gi,
            '[redacted]',
          )
          .slice(0, maximum)
      : null;
  const safeError = (value) => {
    if (!value || typeof value !== 'object') return null;
    const allowedNames = new Set([
      'Error',
      'TypeError',
      'ReferenceError',
      'SyntaxError',
      'RangeError',
      'DeveloperError',
    ]);
    return {
      name: allowedNames.has(value.name) ? value.name : 'Error',
      message: safeText(value.message),
    };
  };
  const safeCount = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const safeHash = (value) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
  const safeReadiness = (value) => {
    if (!value || typeof value !== 'object') return null;
    const counts = {};
    for (const key of [
      'observations',
      'pixelChanges',
      'geometryChanges',
      'notReadyObservations',
      'readinessResets',
      'invalidSignatures',
    ])
      counts[key] = safeCount(value.counts?.[key]);
    return {
      schema:
        value.schema === 'gev-infrastructure-readiness-history/v1'
          ? value.schema
          : null,
      limit: value.limit === 32 ? 32 : null,
      counts,
      observations: Array.isArray(value.observations)
        ? value.observations.slice(-32).map((row) => ({
            sequence: safeCount(row?.sequence),
            pixelSha256: safeHash(row?.pixelSha256),
            geometrySha256: safeHash(row?.geometrySha256),
            inputsReady:
              typeof row?.inputsReady === 'boolean' ? row.inputsReady : null,
            stableFrames: safeCount(row?.stableFrames),
          }))
        : [],
    };
  };
  const safeFailedSample = (value) => {
    if (!value || typeof value !== 'object') return null;
    const allowedCases = new Set([
      'default-style',
      'camera-lod-update-baseline',
      'camera-lod-update',
    ]);
    const readiness = safeReadiness(value.readinessHistory);
    return {
      caseId: allowedCases.has(value.caseId) ? value.caseId : null,
      pair:
        Number.isInteger(value.pair) && value.pair >= 0 && value.pair < 5
          ? value.pair
          : null,
      stableFrames: safeCount(value.stableFrames),
      completedCaptures: safeCount(value.completedCaptures),
      pickSearches: safeCount(value.pickSearches),
      geometryReady:
        typeof value.geometryReady === 'boolean' ? value.geometryReady : null,
      observedGeometry: safeHash(value.observedGeometry),
      changedGeometryFrom: safeHash(value.changedGeometryFrom),
      sourceReady:
        typeof value.sourceReady === 'boolean' ? value.sourceReady : null,
      sceneReadiness:
        value.sceneReadiness && typeof value.sceneReadiness === 'object'
          ? {
              dataSourcesReady:
                typeof value.sceneReadiness.dataSourcesReady === 'boolean'
                  ? value.sceneReadiness.dataSourcesReady
                  : null,
              globeTilesLoaded:
                typeof value.sceneReadiness.globeTilesLoaded === 'boolean'
                  ? value.sceneReadiness.globeTilesLoaded
                  : null,
            }
          : null,
      readinessHistory: readiness,
    };
  };
  const safeModes = new Set(['entities', 'primitive-collections']);
  const safeStatuses = new Set([
    'running',
    'passed',
    'failed',
    'not-triggered',
    'diagnostic-error',
    'partial-or-diagnostic-error',
  ]);
  return {
    resultState: 'parsed',
    result: {
      schema: safeText(report.schema, 100),
      status: safeStatuses.has(report.status) ? report.status : 'unknown',
      applicationCommit: safeHash(report.applicationCommit),
      harnessCommit: safeHash(report.harnessCommit),
      error: safeError(report.error),
      lifetimes: Array.isArray(report.lifetimes)
        ? report.lifetimes.slice(0, 2).map((lifetime) => ({
            mode: safeModes.has(lifetime?.mode) ? lifetime.mode : 'unknown',
            status: safeStatuses.has(lifetime?.status)
              ? lifetime.status
              : 'unknown',
            error: safeError(lifetime?.error),
            failedSample: safeFailedSample(lifetime?.failedSample),
          }))
        : [],
    },
  };
}

async function readPageState(page) {
  let timer;
  const pageRead = Promise.all([
    page.evaluate(() => ({
      readyState: document.readyState,
      status: (document.querySelector('#status')?.textContent ?? '').slice(
        0,
        512,
      ),
    })),
    page.$eval('#result', summarizeInfrastructureResultElement).catch(() => ({
      resultState: 'missing',
      result: null,
    })),
  ])
    .then(([state, result]) => ({ ...state, ...result }))
    .catch(() => null);
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), PAGE_STATE_TIMEOUT_MS);
  });
  const state = await Promise.race([pageRead, timeout]);
  clearTimeout(timer);
  if (!state) return { available: false };
  const statusBudget = { remaining: 512 };
  return {
    available: true,
    readyState: ['loading', 'interactive', 'complete'].includes(
      state.readyState,
    )
      ? state.readyState
      : 'unknown',
    status: boundedValue(String(state.status || ''), statusBudget),
    resultState: ['missing', 'too-large', 'invalid-json', 'parsed'].includes(
      state.resultState,
    )
      ? state.resultState
      : 'unknown',
    result:
      state.resultState === 'parsed'
        ? boundedValue(state.result, {
            remaining: MAX_OUTPUT_TEXT_LENGTH,
          })
        : null,
  };
}

/** Collects bounded same-origin navigation diagnostics without changing navigation policy. */
export function createHostedNavigationDiagnostics(
  page,
  { origin, now = () => performance.now() } = {},
) {
  const expectedOrigin = new URL(origin).origin;
  const startedAt = now();
  const timings = {};
  const failedRequests = [];
  const moduleErrors = [];
  const pending = new Map();
  const untrackedPending = new WeakSet();
  let omittedFailed = 0;
  let omittedModuleErrors = 0;
  let omittedPending = 0;

  const addBounded = (target, value, onOmitted) => {
    if (target.length < MAX_EVENTS) target.push(value);
    else onOmitted();
  };
  const recordLoad = (event) => {
    timings[event] = Math.max(0, now() - startedAt);
  };
  const onDomContentLoaded = () => recordLoad('domContentLoadedMs');
  const onLoad = () => recordLoad('loadMs');
  const onRequest = (request) => {
    const path = safePath(request.url(), expectedOrigin);
    if (!path) return;
    if (pending.size < MAX_PENDING) {
      pending.set(request, {
        path,
        script: request.resourceType?.() === 'script',
      });
    } else {
      untrackedPending.add(request);
      omittedPending += 1;
    }
  };
  const retirePendingRequest = (request) => {
    pending.delete(request);
    if (untrackedPending.delete(request)) omittedPending -= 1;
  };
  const finishRequest = retirePendingRequest;
  const onRequestFailed = (request) => {
    const entry = pending.get(request);
    retirePendingRequest(request);
    const path = entry?.path || safePath(request.url(), expectedOrigin);
    if (!path) return;
    const codeText = request.failure?.()?.errorText || '';
    const code = /^net::ERR_[A-Z0-9_]{1,80}$/.test(codeText)
      ? codeText
      : 'other';
    addBounded(
      failedRequests,
      {
        path,
        kind:
          (entry?.script ?? request.resourceType?.() === 'script')
            ? 'script'
            : 'request',
        code,
      },
      () => {
        omittedFailed += 1;
      },
    );
  };
  const onResponse = (response) => {
    const request = response.request();
    const entry = pending.get(request);
    if (response.status() < 400) return;
    retirePendingRequest(request);
    const path = entry?.path || safePath(request.url(), expectedOrigin);
    if (!path) return;
    addBounded(
      failedRequests,
      {
        path,
        kind:
          (entry?.script ?? request.resourceType?.() === 'script')
            ? 'script'
            : 'request',
        status: response.status(),
      },
      () => {
        omittedFailed += 1;
      },
    );
  };
  const onConsole = (message) => {
    if (message.type() !== 'error') return;
    const location = message.location?.() || {};
    const path = safePath(location.url, expectedOrigin);
    if (!path) return;
    addBounded(
      moduleErrors,
      {
        kind: 'console-error',
        path,
        line: Number.isInteger(location.lineNumber)
          ? location.lineNumber
          : null,
        column: Number.isInteger(location.columnNumber)
          ? location.columnNumber
          : null,
      },
      () => {
        omittedModuleErrors += 1;
      },
    );
  };
  const onPageError = (error) => {
    const name = ERROR_NAMES.has(error?.name) ? error.name : 'Error';
    const stack = typeof error?.stack === 'string' ? error.stack : '';
    const candidate = stack.match(/https?:\/\/[^\s)]+/)?.[0];
    const path = candidate ? safePath(candidate, expectedOrigin) : null;
    addBounded(moduleErrors, { kind: 'page-error', name, path }, () => {
      omittedModuleErrors += 1;
    });
  };

  page.on('domcontentloaded', onDomContentLoaded);
  page.on('load', onLoad);
  page.on('request', onRequest);
  page.on('requestfinished', finishRequest);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let disposed = false;
  return {
    async snapshot() {
      const pageState = await readPageState(page);
      return {
        schema: 'gev-hosted-navigation-diagnostics/v1',
        lifecycle: {
          domContentLoadedMs: timings.domContentLoadedMs ?? null,
          loadMs: timings.loadMs ?? null,
        },
        requests: {
          pending: [...pending.values()].slice(0, MAX_PENDING),
          pendingOmitted: omittedPending,
          failed: failedRequests.slice(),
          failedOmitted: omittedFailed,
        },
        moduleErrors: moduleErrors.slice(),
        moduleErrorsOmitted: omittedModuleErrors,
        pageState,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off('domcontentloaded', onDomContentLoaded);
      page.off('load', onLoad);
      page.off('request', onRequest);
      page.off('requestfinished', finishRequest);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      pending.clear();
      omittedPending = 0;
    },
  };
}
