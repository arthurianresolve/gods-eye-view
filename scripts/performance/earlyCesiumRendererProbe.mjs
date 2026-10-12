import { createFixtureInterceptionErrorRecorder } from './fixtureInterception.mjs';

const STATE_KEY = '__gevRecoveryEarlyRendererProbe';
const CLEANUP_PROOF_KEY = '__gevRecoveryEarlyRendererProbeCleanupProof';

/** Install an opt-in, one-shot hook on Cesium's real widget canvas only. */
export async function installEarlyCesiumRendererProbe(
  page,
  { shaderProgramAttribution = false } = {},
) {
  const handle = await page.evaluateOnNewDocument(
    earlyRendererDocumentHook,
    CLEANUP_PROOF_KEY,
    shaderProgramAttribution === true,
  );
  const identifier = handle?.identifier || null;
  if (identifier) scriptRemovalEntries(page).delete(identifier);
  return identifier;
}

/** Self-contained page hook, exported so tests execute the exact serialized producer. */
export function earlyRendererDocumentHook(
  proofKey,
  shaderProgramAttributionEnabled = false,
) {
  function installShaderProgramAttribution(context) {
    const MAX_PROGRAM_ROWS = 128;
    const MAX_PNAMES_PER_PROGRAM = 4;
    const METHODS = [
      ['createProgram', null],
      ['linkProgram', 0],
      ['getProgramParameter', 0],
      ['deleteProgram', 0],
    ];
    const names = new Map();
    for (const name of [
      'LINK_STATUS',
      'ACTIVE_UNIFORMS',
      'ACTIVE_ATTRIBUTES',
      'VALIDATE_STATUS',
    ]) {
      const value = context?.[name];
      if (Number.isSafeInteger(value)) names.set(value, name);
    }
    const programs = new WeakMap();
    const rows = [];
    const wrappers = [];
    const totals = Object.fromEntries(
      METHODS.map(([name]) => [
        name,
        { calls: 0, errors: 0, elapsedSumMs: 0, maxElapsedMs: 0 },
      ]),
    );
    let nextProgramId = 1;
    let untrackedProgramOperationCount = 0;
    let pnameRowsOverflow = 0;
    let installFailed = false;
    let diagnosticFailed = false;
    let ownerChanged = false;
    let disposed = false;

    const makeProgramRow = (program) => {
      if (
        !program ||
        (typeof program !== 'object' && typeof program !== 'function')
      )
        return null;
      const existing = programs.get(program);
      if (existing) return existing;
      if (rows.length >= MAX_PROGRAM_ROWS) {
        untrackedProgramOperationCount += 1;
        return null;
      }
      const row = {
        programId: nextProgramId++,
        createCalls: 0,
        linkCalls: 0,
        deleteCalls: 0,
        parameterQueries: 0,
        linkStatusKnown: null,
        parameterNames: [],
      };
      programs.set(program, row);
      rows.push(row);
      return row;
    };
    const parameterRow = (row, pname) => {
      if (!row) return null;
      const numeric = Number.isSafeInteger(pname) ? pname : null;
      const existing = row.parameterNames.find(
        (entry) => entry.pname === numeric,
      );
      if (existing) return existing;
      if (row.parameterNames.length >= MAX_PNAMES_PER_PROGRAM) {
        pnameRowsOverflow += 1;
        return null;
      }
      const entry = {
        pname: numeric,
        name: names.get(numeric) || 'other',
        calls: 0,
        firstQueries: 0,
        repeatedQueries: 0,
        linkCallBeforeQuery: 0,
        linkConfirmedBeforeQuery: 0,
        trueResults: 0,
        falseResults: 0,
        numericResults: 0,
        otherResults: 0,
        elapsedSumMs: 0,
        maxElapsedMs: 0,
      };
      row.parameterNames.push(entry);
      return entry;
    };
    const recordElapsed = (target, elapsed) => {
      if (!target || !Number.isFinite(elapsed) || elapsed < 0) return;
      target.elapsedSumMs += elapsed;
      target.maxElapsedMs = Math.max(target.maxElapsedMs, elapsed);
    };
    for (const [name, programArgumentIndex] of METHODS) {
      const original = context?.[name];
      if (typeof original !== 'function') {
        installFailed = true;
        break;
      }
      const ownDescriptor =
        Object.getOwnPropertyDescriptor(context, name) || null;
      const wrapped = function (...args) {
        if (disposed || this !== context)
          return Reflect.apply(original, this, args);
        let total = null;
        let row = null;
        let pname = null;
        let queryPname = null;
        let started = null;
        try {
          total = totals[name];
          total.calls += 1;
          queryPname = name === 'getProgramParameter' ? args[1] : null;
          const program =
            programArgumentIndex === null ? null : args[programArgumentIndex];
          row = program ? makeProgramRow(program) : null;
          pname =
            name === 'getProgramParameter'
              ? parameterRow(row, queryPname)
              : null;
          const repeatedQuery = Boolean(pname && pname.calls > 0);
          if (pname) {
            pname.calls += 1;
            if (repeatedQuery) pname.repeatedQueries += 1;
            else pname.firstQueries += 1;
            if (row?.linkCalls > 0) pname.linkCallBeforeQuery += 1;
            if (row?.linkStatusKnown === true)
              pname.linkConfirmedBeforeQuery += 1;
          }
          if (name === 'linkProgram' && row) {
            row.linkCalls += 1;
            row.linkStatusKnown = null;
          }
          if (name === 'deleteProgram' && row) row.deleteCalls += 1;
          if (name === 'getProgramParameter' && row) row.parameterQueries += 1;
          started = performance.now();
        } catch {
          diagnosticFailed = true;
        }
        let result;
        let didThrow = false;
        let thrown;
        try {
          result = Reflect.apply(original, this, args);
        } catch (error) {
          didThrow = true;
          thrown = error;
        }
        try {
          if (didThrow && total) total.errors += 1;
          if (started !== null) {
            const elapsed = Math.max(0, performance.now() - started);
            recordElapsed(total, elapsed);
            recordElapsed(pname, elapsed);
          }
          if (name === 'createProgram' && result) {
            row = makeProgramRow(result);
            if (row) row.createCalls += 1;
          }
          if (
            name === 'getProgramParameter' &&
            queryPname === context.LINK_STATUS &&
            typeof result === 'boolean' &&
            row
          )
            row.linkStatusKnown = result;
          if (pname && !didThrow) {
            if (result === true) pname.trueResults += 1;
            else if (result === false) pname.falseResults += 1;
            else if (typeof result === 'number') pname.numericResults += 1;
            else pname.otherResults += 1;
          }
        } catch {
          diagnosticFailed = true;
        }
        if (didThrow) throw thrown;
        return result;
      };
      try {
        Object.defineProperty(context, name, {
          ...(ownDescriptor || {
            configurable: true,
            enumerable: false,
            writable: true,
          }),
          value: wrapped,
        });
        if (context[name] !== wrapped)
          throw new Error('method wrapper refused');
        wrappers.push({ name, original, ownDescriptor, wrapped });
      } catch {
        installFailed = true;
        break;
      }
    }

    const restore = () => {
      let restored = 0;
      let changedOwnerCount = 0;
      for (const entry of [...wrappers].reverse()) {
        try {
          if (context[entry.name] !== entry.wrapped) {
            changedOwnerCount += 1;
            continue;
          }
          if (entry.ownDescriptor)
            Object.defineProperty(context, entry.name, entry.ownDescriptor);
          else if (!delete context[entry.name])
            throw new Error('delete refused');
          if (context[entry.name] !== entry.original)
            throw new Error('method restoration refused');
          restored += 1;
        } catch {
          changedOwnerCount += 1;
        }
      }
      ownerChanged ||= changedOwnerCount > 0;
      return {
        requestedMethodCount: METHODS.length,
        installedMethodCount: wrappers.length,
        restoredMethodCount: restored,
        changedOwnerCount,
        confirmed: changedOwnerCount === 0 && restored === wrappers.length,
      };
    };
    const installationCleanup = installFailed ? restore() : null;

    return {
      snapshotAndDispose() {
        if (disposed)
          return {
            schema: 'gev-shader-program-lifecycle/v1',
            status: 'unavailable',
            error: 'observer-already-disposed',
            cleanup: { confirmed: false },
          };
        disposed = true;
        const programRows = rows.map((row) => ({
          programId: row.programId,
          createCalls: row.createCalls,
          linkCalls: row.linkCalls,
          deleteCalls: row.deleteCalls,
          parameterQueries: row.parameterQueries,
          linkStatusKnown: row.linkStatusKnown,
          parameterNames: row.parameterNames.map((entry) => ({
            pname: entry.pname,
            name: entry.name,
            calls: entry.calls,
            firstQueries: entry.firstQueries,
            repeatedQueries: entry.repeatedQueries,
            linkCallBeforeQuery: entry.linkCallBeforeQuery,
            linkConfirmedBeforeQuery: entry.linkConfirmedBeforeQuery,
            trueResults: entry.trueResults,
            falseResults: entry.falseResults,
            numericResults: entry.numericResults,
            otherResults: entry.otherResults,
            elapsedSumMs: entry.elapsedSumMs,
            maxElapsedMs: entry.maxElapsedMs,
          })),
        }));
        const cleanup = installationCleanup || restore();
        const truncated =
          untrackedProgramOperationCount > 0 || pnameRowsOverflow > 0;
        const cleanupFailed = cleanup.confirmed !== true;
        return {
          schema: 'gev-shader-program-lifecycle/v1',
          status:
            installFailed || diagnosticFailed || cleanupFailed
              ? 'unavailable'
              : truncated
                ? 'truncated'
                : 'complete',
          ...(installFailed || diagnosticFailed || cleanupFailed
            ? {
                error: installFailed
                  ? 'method-install-failed'
                  : cleanupFailed
                    ? 'wrapper-owner-changed'
                    : 'diagnostic-recording-failed',
              }
            : {}),
          scope:
            'owned WebGL context synchronous main-thread wrapper elapsed time; not GPU execution time or performance acceptance',
          limits: {
            maxProgramRows: MAX_PROGRAM_ROWS,
            maxPnamesPerProgram: MAX_PNAMES_PER_PROGRAM,
            untrackedProgramOperationCount,
            pnameRowsOverflow,
            truncated,
          },
          totals: Object.fromEntries(
            METHODS.map(([name]) => [
              name,
              {
                calls: totals[name].calls,
                errors: totals[name].errors,
                elapsedSumMs: totals[name].elapsedSumMs,
                maxElapsedMs: totals[name].maxElapsedMs,
              },
            ]),
          ),
          programs: programRows,
          cleanup,
          ownerChanged,
        };
      },
    };
  }
  // Puppeteer runs evaluateOnNewDocument in subframes too. The probe belongs
  // to the top-level Cesium viewer document only.
  if (window !== window.top) return;
  const key = '__gevRecoveryEarlyRendererProbe';
  delete window[proofKey];
  const prototype = HTMLCanvasElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
  const nativeGetContext = descriptor?.value;
  if (typeof nativeGetContext !== 'function') {
    window[key] = { error: 'native getContext unavailable' };
    return;
  }

  const state = (window[key] = {
    captured: false,
    contextLost: false,
    contextRestored: false,
    renderer: null,
    vendor: null,
    contextAttributes: null,
    parameterQueryCount: 0,
    queryDurationMs: null,
    error: null,
    nativeGetContext,
    canvas: null,
    context: null,
    listeners: [],
    shaderProgramAttributionEnabled: shaderProgramAttributionEnabled === true,
    shaderProgramAttribution: null,
  });
  let active = true;
  function restore() {
    if (!active) return;
    active = false;
    Object.defineProperty(prototype, 'getContext', descriptor);
  }
  state.restore = restore;
  Object.defineProperty(prototype, 'getContext', {
    ...descriptor,
    value: function (...args) {
      const context = Reflect.apply(nativeGetContext, this, args);
      if (
        active &&
        context &&
        this instanceof HTMLCanvasElement &&
        this.closest('.cesium-widget') &&
        /^(webgl2?|experimental-webgl)$/i.test(String(args[0]))
      ) {
        restore();
        state.captured = true;
        state.canvas = this;
        state.context = context;
        if (state.shaderProgramAttributionEnabled)
          state.shaderProgramAttribution =
            installShaderProgramAttribution(context);
        const onLost = (event) => {
          state.contextLost = true;
        };
        const onRestored = () => {
          state.contextRestored = true;
        };
        try {
          state.listeners.push(['webglcontextlost', onLost]);
          this.addEventListener('webglcontextlost', onLost);
          state.listeners.push(['webglcontextrestored', onRestored]);
          this.addEventListener('webglcontextrestored', onRestored);
        } catch (error) {
          state.error = String(error?.message || error).slice(0, 240);
        }
        try {
          const started = performance.now();
          const attributes = context.getContextAttributes?.();
          if (!attributes)
            throw new Error('WebGL context attributes unavailable');
          state.contextAttributes = Object.fromEntries(
            [
              'alpha',
              'antialias',
              'depth',
              'failIfMajorPerformanceCaveat',
              'powerPreference',
              'premultipliedAlpha',
              'preserveDrawingBuffer',
              'stencil',
              'desynchronized',
            ]
              .filter((key) => key in attributes)
              .map((key) => [key, attributes[key]]),
          );
          const extension = context.getExtension('WEBGL_debug_renderer_info');
          state.renderer = context.getParameter(
            extension?.UNMASKED_RENDERER_WEBGL || context.RENDERER,
          );
          state.parameterQueryCount += 1;
          state.vendor = context.getParameter(
            extension?.UNMASKED_VENDOR_WEBGL || context.VENDOR,
          );
          state.parameterQueryCount += 1;
          state.queryDurationMs = performance.now() - started;
        } catch (error) {
          state.error = String(error?.message || error).slice(0, 240);
        }
      }
      return context;
    },
  });
}

/** Verify early evidence against Cesium's live scene without querying GL again. */
export async function readEarlyCesiumRendererProbe(page, timeoutMs = 5_000) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate((key) => {
        const state = window[key];
        const scene = window.__godsEyeView?.viewer?.scene;
        if (!state?.captured || !state.canvas || !state.context)
          throw new Error('early renderer context was not captured');
        if (state.error)
          throw new Error('early renderer query failed: ' + state.error);
        if (state.contextLost || state.contextRestored)
          throw new Error('early renderer context was lost or restored');
        if (state.context?.isContextLost?.() === true)
          throw new Error('early renderer context is currently lost');
        if (state.canvas !== scene?.canvas)
          throw new Error('early renderer canvas does not match Cesium scene');
        const cesiumContext = scene?.context;
        const original = cesiumContext?._originalGLContext;
        if (!original)
          throw new Error('Cesium original WebGL context identity unavailable');
        if (state.context !== original)
          throw new Error('early renderer context does not match Cesium scene');
        if (
          !Number.isFinite(state.queryDurationMs) ||
          state.queryDurationMs < 0
        )
          throw new Error('early renderer query duration is invalid');
        if (
          !state.contextAttributes ||
          typeof state.contextAttributes.antialias !== 'boolean' ||
          typeof state.renderer !== 'string' ||
          !state.renderer.trim() ||
          !Number.isSafeInteger(state.parameterQueryCount) ||
          state.parameterQueryCount !== 2
        )
          throw new Error('early renderer context evidence is incomplete');
        return {
          renderer: String(state.renderer || ''),
          vendor:
            typeof state.vendor === 'string' && state.vendor
              ? state.vendor
              : null,
          contextAttributes: { ...state.contextAttributes },
          parameterQueryCount: state.parameterQueryCount,
          queryDurationMs: state.queryDurationMs,
          canvasMatchesScene: true,
          contextMatchesScene: true,
          contextLost: state.contextLost,
          contextRestored: state.contextRestored,
        };
      }, STATE_KEY),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('early renderer verification timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const SCRIPT_REMOVALS = new WeakMap();

function cleanupStage(status = 'pending') {
  return {
    status,
    elapsedMs: null,
    pageExecutionElapsedMs: null,
    errorKind: null,
    errorDetail: null,
    lateCompletion: null,
    lateHostReceiptElapsedMs: null,
    lateHostReceiptScope:
      'host stage start to acknowledgement receipt; includes page execution, protocol delivery, and host scheduling',
    lateOutcome: null,
    lateErrorKind: null,
    lateErrorDetail: null,
  };
}

const LATE_DOCUMENT_STATUSES = new Set([
  'confirmed',
  'already-confirmed',
  'unavailable',
  'error',
]);
const LATE_DOCUMENT_ERROR_KINDS = new Set([
  'cleanup-state-not-found',
  'hook-restore-unconfirmed',
  'listener-removal-unconfirmed',
  'cleanup-state-delete-unconfirmed',
]);
const RENDER_LOOP_RETIREMENT_STATUSES = new Set([
  'confirmed',
  'already-disabled',
  'not-applicable-no-viewer',
  'not-applicable-page-closed',
  'viewer-render-loop-unavailable',
  'viewer-render-loop-not-disabled',
  'viewer-render-loop-set-failed',
  'not-attempted',
]);

export function boundedShaderProgramAttribution(value) {
  const allowedStatuses = new Set(['complete', 'truncated', 'unavailable']);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schema !== 'gev-shader-program-lifecycle/v1' ||
    !allowedStatuses.has(value.status)
  )
    return null;
  const boundedCount = (count, max = 10_000_000) =>
    Number.isSafeInteger(count) && count >= 0 && count <= max;
  const boundedElapsed = (elapsed, max = 3_600_000) =>
    Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= max;
  const cleanup = value.cleanup;
  if (
    !cleanup ||
    typeof cleanup !== 'object' ||
    Array.isArray(cleanup) ||
    typeof cleanup.confirmed !== 'boolean' ||
    !boundedCount(cleanup.requestedMethodCount, 4) ||
    cleanup.requestedMethodCount !== 4 ||
    !boundedCount(cleanup.installedMethodCount, 4) ||
    !boundedCount(cleanup.restoredMethodCount, 4) ||
    !boundedCount(cleanup.changedOwnerCount, 4) ||
    cleanup.confirmed !==
      (cleanup.changedOwnerCount === 0 &&
        cleanup.installedMethodCount === cleanup.restoredMethodCount)
  )
    return null;
  if (value.status === 'unavailable') {
    if (
      ![
        'method-install-failed',
        'observer-already-disposed',
        'observer-not-installed',
        'snapshot-failed',
        'diagnostic-recording-failed',
        'wrapper-owner-changed',
      ].includes(value.error)
    )
      return null;
    return {
      schema: value.schema,
      status: value.status,
      error: value.error,
      cleanup: {
        confirmed: cleanup.confirmed,
        requestedMethodCount: cleanup.requestedMethodCount,
        installedMethodCount: cleanup.installedMethodCount,
        restoredMethodCount: cleanup.restoredMethodCount,
        changedOwnerCount: cleanup.changedOwnerCount,
      },
      ownerChanged: value.ownerChanged === true,
    };
  }
  if (
    value.scope !==
      'owned WebGL context synchronous main-thread wrapper elapsed time; not GPU execution time or performance acceptance' ||
    !value.limits ||
    typeof value.limits !== 'object' ||
    value.limits.maxProgramRows !== 128 ||
    value.limits.maxPnamesPerProgram !== 4 ||
    !boundedCount(value.limits.untrackedProgramOperationCount) ||
    !boundedCount(value.limits.pnameRowsOverflow) ||
    typeof value.limits.truncated !== 'boolean' ||
    value.limits.truncated !==
      (value.limits.untrackedProgramOperationCount > 0 ||
        value.limits.pnameRowsOverflow > 0) ||
    (value.status === 'truncated' && value.limits.truncated !== true) ||
    (value.status === 'complete' && value.limits.truncated !== false) ||
    !Array.isArray(value.programs) ||
    value.programs.length > value.limits.maxProgramRows ||
    !value.totals ||
    typeof value.totals !== 'object' ||
    Array.isArray(value.totals) ||
    ![
      'createProgram',
      'linkProgram',
      'getProgramParameter',
      'deleteProgram',
    ].every((name) => {
      const row = value.totals[name];
      return (
        row &&
        boundedCount(row.calls) &&
        boundedCount(row.errors) &&
        row.errors <= row.calls &&
        boundedElapsed(row.elapsedSumMs) &&
        boundedElapsed(row.maxElapsedMs, 60_000) &&
        row.maxElapsedMs <= row.elapsedSumMs
      );
    })
  )
    return null;
  const ids = new Set();
  const validProgram = (program) => {
    if (
      !program ||
      typeof program !== 'object' ||
      !boundedCount(program.programId, Number.MAX_SAFE_INTEGER) ||
      program.programId < 1 ||
      ids.has(program.programId) ||
      !['createCalls', 'linkCalls', 'deleteCalls', 'parameterQueries'].every(
        (key) => boundedCount(program[key]),
      ) ||
      ![null, true, false].includes(program.linkStatusKnown) ||
      !Array.isArray(program.parameterNames) ||
      program.parameterNames.length > value.limits.maxPnamesPerProgram
    )
      return false;
    ids.add(program.programId);
    const pnames = new Set();
    const namesValid = program.parameterNames.every((pname) => {
      if (
        !pname ||
        typeof pname !== 'object' ||
        ![
          null,
          ...[
            'LINK_STATUS',
            'ACTIVE_UNIFORMS',
            'ACTIVE_ATTRIBUTES',
            'VALIDATE_STATUS',
            'other',
          ],
        ].includes(pname.name) ||
        !(pname.pname === null || boundedCount(pname.pname, 0xffff)) ||
        pnames.has(pname.pname) ||
        ![
          'calls',
          'firstQueries',
          'repeatedQueries',
          'linkCallBeforeQuery',
          'linkConfirmedBeforeQuery',
          'trueResults',
          'falseResults',
          'numericResults',
          'otherResults',
        ].every((key) => boundedCount(pname[key])) ||
        pname.calls < 1 ||
        pname.firstQueries !== 1 ||
        pname.firstQueries + pname.repeatedQueries !== pname.calls ||
        pname.linkCallBeforeQuery > pname.calls ||
        pname.linkConfirmedBeforeQuery > pname.calls ||
        pname.trueResults +
          pname.falseResults +
          pname.numericResults +
          pname.otherResults >
          pname.calls ||
        !boundedElapsed(pname.elapsedSumMs) ||
        !boundedElapsed(pname.maxElapsedMs, 60_000) ||
        pname.maxElapsedMs > pname.elapsedSumMs
      )
        return false;
      pnames.add(pname.pname);
      return true;
    });
    if (!namesValid) return false;
    const attributedParameterQueries = program.parameterNames.reduce(
      (sum, pname) => sum + pname.calls,
      0,
    );
    return value.limits.pnameRowsOverflow > 0
      ? attributedParameterQueries <= program.parameterQueries
      : attributedParameterQueries === program.parameterQueries;
  };
  if (!value.programs.every(validProgram)) return null;
  const aggregateCounts = {
    createProgram: 0,
    linkProgram: 0,
    getProgramParameter: 0,
    deleteProgram: 0,
  };
  for (const program of value.programs) {
    aggregateCounts.createProgram += program.createCalls;
    aggregateCounts.linkProgram += program.linkCalls;
    aggregateCounts.getProgramParameter += program.parameterQueries;
    aggregateCounts.deleteProgram += program.deleteCalls;
  }
  if (
    Object.entries(aggregateCounts).some(
      ([name, count]) => count > value.totals[name].calls,
    ) ||
    cleanup.confirmed !==
      (cleanup.changedOwnerCount === 0 &&
        cleanup.installedMethodCount === cleanup.restoredMethodCount)
  )
    return null;
  if (
    value.status === 'complete' &&
    (value.limits.truncated ||
      !cleanup.confirmed ||
      cleanup.installedMethodCount !== 4 ||
      cleanup.restoredMethodCount !== 4 ||
      cleanup.changedOwnerCount !== 0 ||
      value.ownerChanged !== false)
  )
    return null;
  return {
    schema: value.schema,
    status: value.status,
    scope: value.scope,
    limits: {
      maxProgramRows: value.limits.maxProgramRows,
      maxPnamesPerProgram: value.limits.maxPnamesPerProgram,
      untrackedProgramOperationCount:
        value.limits.untrackedProgramOperationCount,
      pnameRowsOverflow: value.limits.pnameRowsOverflow,
      truncated: value.limits.truncated,
    },
    totals: Object.fromEntries(
      [
        'createProgram',
        'linkProgram',
        'getProgramParameter',
        'deleteProgram',
      ].map((name) => [
        name,
        {
          calls: value.totals[name].calls,
          errors: value.totals[name].errors,
          elapsedSumMs: value.totals[name].elapsedSumMs,
          maxElapsedMs: value.totals[name].maxElapsedMs,
        },
      ]),
    ),
    programs: value.programs.map((program) => ({
      programId: program.programId,
      createCalls: program.createCalls,
      linkCalls: program.linkCalls,
      deleteCalls: program.deleteCalls,
      parameterQueries: program.parameterQueries,
      linkStatusKnown: program.linkStatusKnown,
      parameterNames: program.parameterNames.map((pname) => ({
        pname: pname.pname,
        name: pname.name,
        calls: pname.calls,
        firstQueries: pname.firstQueries,
        repeatedQueries: pname.repeatedQueries,
        linkCallBeforeQuery: pname.linkCallBeforeQuery,
        linkConfirmedBeforeQuery: pname.linkConfirmedBeforeQuery,
        trueResults: pname.trueResults,
        falseResults: pname.falseResults,
        numericResults: pname.numericResults,
        otherResults: pname.otherResults,
        elapsedSumMs: pname.elapsedSumMs,
        maxElapsedMs: pname.maxElapsedMs,
      })),
    })),
    cleanup: {
      confirmed: cleanup.confirmed,
      requestedMethodCount: cleanup.requestedMethodCount,
      installedMethodCount: cleanup.installedMethodCount,
      restoredMethodCount: cleanup.restoredMethodCount,
      changedOwnerCount: cleanup.changedOwnerCount,
    },
    ownerChanged: value.ownerChanged === true,
  };
}

export function createShaderProgramAttributionEnvelope(
  cleanupRows,
  expectedDocumentCount,
) {
  const expectedCount =
    Number.isSafeInteger(expectedDocumentCount) &&
    expectedDocumentCount >= 0 &&
    expectedDocumentCount <= 40
      ? expectedDocumentCount
      : null;
  const rows = Array.isArray(cleanupRows) ? cleanupRows : [];
  const documents = rows
    .filter((entry) => entry?.document?.shaderProgramAttribution)
    .map((entry) => {
      const attribution = boundedShaderProgramAttribution(
        entry.document.shaderProgramAttribution,
      );
      return {
        documentRole:
          typeof entry.documentRole === 'string'
            ? entry.documentRole.slice(0, 80)
            : null,
        documentId:
          typeof entry.documentId === 'string'
            ? entry.documentId.slice(0, 100)
            : null,
        status: attribution?.status || 'unavailable',
        cleanupConfirmed:
          entry.confirmed === true && attribution?.cleanup.confirmed === true,
        totals: attribution?.totals || null,
        trackedProgramCount: attribution?.programs?.length ?? null,
        limits: attribution?.limits
          ? {
              untrackedProgramOperationCount:
                attribution.limits.untrackedProgramOperationCount,
              pnameRowsOverflow: attribution.limits.pnameRowsOverflow,
            }
          : null,
      };
    });
  const identities = new Set(
    documents.map((entry) => `${entry.documentRole}\u0000${entry.documentId}`),
  );
  const complete =
    expectedCount !== null &&
    documents.length === expectedCount &&
    identities.size === expectedCount &&
    documents.every(
      (entry) =>
        typeof entry.documentRole === 'string' &&
        typeof entry.documentId === 'string' &&
        entry.status === 'complete' &&
        entry.cleanupConfirmed,
    );
  return {
    enabled: true,
    schema: 'gev-shader-program-attribution/v1',
    status: complete ? 'complete' : 'incomplete',
    performanceAcceptanceEligible: false,
    scope:
      'whole owned dense-investigation document lifetime from Cesium WebGL context acquisition through the existing document cleanup callback; it is not isolated to warmup or measurement and is not GPU execution time',
    expectedDocumentCount: expectedCount,
    documents,
  };
}

function boundedLateDocumentOutcome(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !LATE_DOCUMENT_STATUSES.has(value.status)
  )
    return null;
  const booleanOrNull = (field) =>
    typeof value[field] === 'boolean' ? value[field] : null;
  const boundedCount = (field) =>
    Number.isSafeInteger(value[field]) &&
    value[field] >= 0 &&
    value[field] <= 64
      ? value[field]
      : null;
  const elapsed = value.pageExecutionElapsedMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000) return null;
  let renderLoopRetirement = null;
  if (
    typeof value.renderLoopRetirement !== 'undefined' &&
    value.renderLoopRetirement !== null
  ) {
    const retirement = value.renderLoopRetirement;
    if (
      !retirement ||
      typeof retirement !== 'object' ||
      Array.isArray(retirement) ||
      retirement.requested !== true ||
      !RENDER_LOOP_RETIREMENT_STATUSES.has(retirement.status) ||
      ![null, true, false].includes(retirement.before) ||
      ![null, true, false].includes(retirement.after) ||
      typeof retirement.confirmed !== 'boolean' ||
      !Number.isFinite(retirement.pageExecutionElapsedMs) ||
      retirement.pageExecutionElapsedMs < 0 ||
      retirement.pageExecutionElapsedMs > 60_000
    )
      return null;
    renderLoopRetirement = {
      requested: true,
      status: retirement.status,
      before: retirement.before,
      after: retirement.after,
      confirmed: retirement.confirmed,
      pageExecutionElapsedMs: retirement.pageExecutionElapsedMs,
    };
  }
  return {
    status: value.status,
    pageExecutionElapsedMs: elapsed,
    statePresent: booleanOrNull('statePresent'),
    hookRestoreAttempted: booleanOrNull('hookRestoreAttempted'),
    hookRestored: booleanOrNull('hookRestored'),
    listenerCount: boundedCount('listenerCount'),
    listenerRemovalAttemptedCount: boundedCount(
      'listenerRemovalAttemptedCount',
    ),
    listenerRemovalConfirmedCount: boundedCount(
      'listenerRemovalConfirmedCount',
    ),
    listenerRemovalFailedCount: boundedCount('listenerRemovalFailedCount'),
    stateDeleted: booleanOrNull('stateDeleted'),
    renderLoopRetirement,
    ...(typeof value.shaderProgramAttribution === 'undefined'
      ? {}
      : {
          shaderProgramAttribution: boundedShaderProgramAttribution(
            value.shaderProgramAttribution,
          ),
        }),
    errorKind: LATE_DOCUMENT_ERROR_KINDS.has(value.errorKind)
      ? value.errorKind
      : null,
  };
}

function scriptRemovalEntries(page) {
  let entries = SCRIPT_REMOVALS.get(page);
  if (!entries) {
    entries = new Map();
    SCRIPT_REMOVALS.set(page, entries);
  }
  return entries;
}

/** Remove only the future-document hook, leaving this document's observer live. */
export async function removeEarlyCesiumRendererProbeRegistrationWithEvidence(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
) {
  const startedAt = performance.now();
  const evidence = {
    schema: 'gev-early-renderer-registration-removal/v1',
    confirmed: false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : null,
    elapsedMs: 0,
    currentDocumentUntouched: true,
    scriptRegistration: {
      ...cleanupStage(scriptIdentifier ? 'pending' : 'not-registered'),
      verification: scriptIdentifier
        ? 'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable'
        : null,
    },
  };
  const stage = evidence.scriptRegistration;
  if (!scriptIdentifier) {
    evidence.confirmed = true;
    return evidence;
  }
  if (!page || (typeof page !== 'object' && typeof page !== 'function')) {
    stage.status = 'unavailable';
    stage.errorKind = 'page-api-unavailable';
    evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
    return evidence;
  }

  const entries = scriptRemovalEntries(page);
  let entry = entries.get(scriptIdentifier);
  let newAttempt = false;
  if (!entry) {
    if (typeof page.removeScriptToEvaluateOnNewDocument !== 'function') {
      stage.status = 'unavailable';
      stage.errorKind = 'page-api-unavailable';
      evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
      return evidence;
    }
    newAttempt = true;
    entry = { status: 'pending', errorKind: null, errorDetail: null };
    entries.set(scriptIdentifier, entry);
    entry.promise = Promise.resolve()
      .then(() => page.removeScriptToEvaluateOnNewDocument(scriptIdentifier))
      .then(
        () => {
          entry.status = 'confirmed';
          return { status: 'confirmed' };
        },
        (error) => {
          entry.status = 'error';
          entry.errorKind = safeCleanupErrorKind(error, true);
          entry.errorDetail = safeCleanupErrorDetail(error);
          return {
            status: 'error',
            errorKind: entry.errorKind,
            errorDetail: entry.errorDetail,
          };
        },
      );
  }

  if (entry.status === 'confirmed') {
    stage.status = newAttempt ? 'confirmed' : 'already-confirmed';
    evidence.confirmed = true;
  } else if (entry.status === 'error') {
    stage.status = 'error';
    stage.errorKind = entry.errorKind;
    stage.errorDetail = entry.errorDetail;
  } else {
    const boundedMs =
      Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;
    let timer;
    let timedOut = false;
    const completion = entry.promise.then((result) => {
      if (timedOut) {
        stage.lateCompletion = result.status;
        stage.lateHostReceiptElapsedMs = Math.max(
          0,
          performance.now() - startedAt,
        );
        if (result.status !== 'confirmed') {
          stage.lateErrorKind =
            result.errorKind || 'registration-removal-error';
          stage.lateErrorDetail = result.errorDetail || null;
        }
      }
      return result;
    });
    const result = await Promise.race([
      completion,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), boundedMs);
      }),
    ]);
    clearTimeout(timer);
    if (result.status === 'timeout') {
      timedOut = true;
      stage.status = 'timeout';
      stage.errorKind = 'operation-timeout';
      stage.lateCompletion = 'pending';
    } else {
      stage.status =
        result.status === 'confirmed' && !newAttempt
          ? 'already-confirmed'
          : result.status;
      stage.errorKind = result.errorKind || null;
      stage.errorDetail = result.errorDetail || null;
      evidence.confirmed = result.status === 'confirmed';
    }
  }
  stage.elapsedMs = Math.max(0, performance.now() - startedAt);
  evidence.elapsedMs = stage.elapsedMs;
  return evidence;
}

/**
 * Remove the document hook/listeners and target registration as separately
 * bounded operations. It preserves the original document-then-registration
 * order and total timeout. Returned records contain no target URLs or raw
 * protocol error strings.
 */
export async function cleanupEarlyCesiumRendererProbeWithEvidence(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
  {
    retireViewerRenderLoop = false,
    requireShaderProgramAttribution = false,
  } = {},
) {
  const startedAt = performance.now();
  const evidence = {
    schema: 'gev-early-renderer-probe-cleanup/v1',
    confirmed: false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : null,
    elapsedMs: 0,
    document: {
      ...cleanupStage('not-attempted'),
      statePresent: null,
      hookRestoreAttempted: false,
      hookRestored: null,
      listenerCount: null,
      listenerRemovalAttemptedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 0,
      stateDeleted: null,
      renderLoopRetirement: retireViewerRenderLoop
        ? {
            requested: true,
            status: 'not-attempted',
            before: null,
            after: null,
            confirmed: false,
            pageExecutionElapsedMs: null,
          }
        : null,
    },
    scriptRegistration: {
      ...cleanupStage(scriptIdentifier ? 'not-attempted' : 'not-registered'),
      verification: scriptIdentifier
        ? 'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable'
        : null,
    },
  };
  const boundedMs =
    Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;
  const remaining = () =>
    Math.max(0, boundedMs - (performance.now() - startedAt));
  const runStage = async (stage, operation, onConfirmed = () => {}) => {
    const operationStartedAt = performance.now();
    let timedOut = false;
    let operationRejected = false;
    let timer;
    const task = Promise.resolve()
      .then(operation)
      .then((result) => {
        const status = result?.status || 'confirmed';
        if (status === 'confirmed' || status === 'already-confirmed')
          onConfirmed(result);
        if (timedOut) {
          stage.lateCompletion = status;
          stage.lateHostReceiptElapsedMs = Math.max(
            0,
            performance.now() - operationStartedAt,
          );
          if (stage === evidence.document) {
            stage.lateOutcome = boundedLateDocumentOutcome(result);
            if (!stage.lateOutcome) {
              stage.lateCompletion = 'invalid-result';
              stage.lateErrorKind = 'invalid-late-document-result';
            } else if (
              !['confirmed', 'already-confirmed'].includes(
                stage.lateOutcome.status,
              )
            ) {
              stage.lateErrorKind =
                stage.lateOutcome.errorKind || 'cleanup-incomplete';
            }
          } else if (Number.isFinite(result?.pageExecutionElapsedMs)) {
            stage.pageExecutionElapsedMs = result.pageExecutionElapsedMs;
            if (!['confirmed', 'already-confirmed'].includes(status))
              stage.lateErrorKind = result?.errorKind || 'cleanup-incomplete';
          } else if (stage !== evidence.document) {
            if (!['confirmed', 'already-confirmed'].includes(status))
              stage.lateErrorKind = result?.errorKind || 'cleanup-incomplete';
          }
          if (stage === evidence.document) stage.lateErrorDetail = null;
          else if (stage.lateErrorKind)
            stage.lateErrorDetail = result?.errorDetail || null;
          return result;
        }
        stage.status = status;
        for (const [key, value] of Object.entries(result || {}))
          if (
            key !== 'status' &&
            (key in stage || key === 'shaderProgramAttribution')
          ) {
            if (key === 'shaderProgramAttribution') {
              const bounded = boundedShaderProgramAttribution(value);
              stage[key] = bounded || {
                schema: 'gev-shader-program-lifecycle/v1',
                status: 'unavailable',
                error: 'snapshot-failed',
                cleanup: {
                  confirmed: false,
                  requestedMethodCount: 4,
                  installedMethodCount: 0,
                  restoredMethodCount: 0,
                  changedOwnerCount: 0,
                },
                ownerChanged: false,
              };
              if (
                requireShaderProgramAttribution &&
                (!bounded || bounded.cleanup.confirmed !== true)
              ) {
                stage.status = 'error';
                stage.errorKind = bounded
                  ? 'shader-wrapper-cleanup-unconfirmed'
                  : 'shader-attribution-evidence-invalid';
              }
              continue;
            }
            stage[key] = value;
          }
        stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
        return result;
      })
      .catch((error) => {
        operationRejected = true;
        if (timedOut) {
          stage.lateCompletion = 'error';
          stage.lateHostReceiptElapsedMs = Math.max(
            0,
            performance.now() - operationStartedAt,
          );
          stage.lateErrorKind = safeCleanupErrorKind(
            error,
            stage === evidence.scriptRegistration,
          );
          stage.lateErrorDetail = safeCleanupErrorDetail(error);
          return null;
        }
        stage.status = 'error';
        stage.errorKind = safeCleanupErrorKind(
          error,
          stage === evidence.scriptRegistration,
        );
        stage.errorDetail = safeCleanupErrorDetail(error);
        stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
        return null;
      });
    const outcome = await Promise.race([
      task.then((value) => ({ kind: 'settled', value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), remaining());
      }),
    ]);
    clearTimeout(timer);
    if (outcome.kind === 'timeout') {
      timedOut = true;
      stage.status = 'timeout';
      stage.errorKind = 'operation-timeout';
      stage.lateCompletion = 'pending';
      stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
      return { settled: false, result: null };
    }
    return {
      settled: !operationRejected,
      result: outcome.value,
    };
  };

  let pageClosed = false;
  let documentOperationSettled = true;
  try {
    pageClosed = page?.isClosed?.() === true;
  } catch (error) {
    evidence.document.status = 'error';
    evidence.document.errorKind = 'page-state-error';
    evidence.document.errorDetail = safeCleanupErrorDetail(error);
  }
  if (pageClosed) {
    evidence.document.status = 'page-closed';
    evidence.document.hookRestored = null;
    evidence.document.stateDeleted = null;
    if (retireViewerRenderLoop)
      evidence.document.renderLoopRetirement = {
        requested: true,
        status: 'not-applicable-page-closed',
        before: null,
        after: null,
        confirmed: true,
        pageExecutionElapsedMs: 0,
      };
  } else if (page && typeof page.evaluate === 'function') {
    evidence.document.status = 'pending';
    const documentResult = await runStage(evidence.document, () =>
      page.evaluate(
        (
          key,
          proofKey,
          shouldRetireViewerRenderLoop,
          requireShaderProgramAttribution,
        ) => {
          const pageExecutionStartedAt = performance.now();
          const renderLoopRetirement = shouldRetireViewerRenderLoop
            ? {
                requested: true,
                status: 'not-attempted',
                before: null,
                after: null,
                confirmed: false,
                pageExecutionElapsedMs: null,
              }
            : null;
          if (renderLoopRetirement) {
            const retirementStartedAt = performance.now();
            try {
              const viewer = window.__godsEyeView?.viewer;
              if (!viewer) {
                renderLoopRetirement.status = 'not-applicable-no-viewer';
                renderLoopRetirement.confirmed = true;
              } else if (typeof viewer.useDefaultRenderLoop !== 'boolean') {
                renderLoopRetirement.status = 'viewer-render-loop-unavailable';
              } else {
                renderLoopRetirement.before = viewer.useDefaultRenderLoop;
                if (renderLoopRetirement.before)
                  viewer.useDefaultRenderLoop = false;
                renderLoopRetirement.after = viewer.useDefaultRenderLoop;
                renderLoopRetirement.confirmed =
                  renderLoopRetirement.after === false;
                renderLoopRetirement.status = renderLoopRetirement.confirmed
                  ? renderLoopRetirement.before
                    ? 'confirmed'
                    : 'already-disabled'
                  : 'viewer-render-loop-not-disabled';
              }
            } catch {
              renderLoopRetirement.status = 'viewer-render-loop-set-failed';
            }
            renderLoopRetirement.pageExecutionElapsedMs = Math.max(
              0,
              performance.now() - retirementStartedAt,
            );
          }
          const finish = (record) => {
            record.pageExecutionElapsedMs = Math.max(
              0,
              performance.now() - pageExecutionStartedAt,
            );
            return record;
          };
          const state = window[key];
          const proof = window[proofKey];
          const prototype = HTMLCanvasElement.prototype;
          const record = {
            status: 'error',
            statePresent: Boolean(state),
            hookRestoreAttempted: false,
            hookRestored: false,
            listenerCount: Array.isArray(state?.listeners)
              ? state.listeners.length
              : 0,
            listenerRemovalAttemptedCount: 0,
            listenerRemovalConfirmedCount: 0,
            listenerRemovalFailedCount: 0,
            stateDeleted: false,
            renderLoopRetirement,
          };
          let shaderProgramAttributionCleanupConfirmed = true;
          if (state?.shaderProgramAttributionEnabled === true) {
            try {
              record.shaderProgramAttribution =
                state.shaderProgramAttribution?.snapshotAndDispose?.() || {
                  schema: 'gev-shader-program-lifecycle/v1',
                  status: 'unavailable',
                  error: 'observer-not-installed',
                  cleanup: { confirmed: false },
                };
            } catch {
              record.shaderProgramAttribution = {
                schema: 'gev-shader-program-lifecycle/v1',
                status: 'unavailable',
                error: 'snapshot-failed',
                cleanup: { confirmed: false },
              };
            }
            shaderProgramAttributionCleanupConfirmed =
              record.shaderProgramAttribution.cleanup?.confirmed === true;
          } else if (requireShaderProgramAttribution) {
            shaderProgramAttributionCleanupConfirmed = false;
            record.shaderProgramAttribution = {
              schema: 'gev-shader-program-lifecycle/v1',
              status: 'unavailable',
              error: 'observer-not-installed',
              cleanup: { confirmed: false },
            };
          }
          if (!state) {
            const proofMatches =
              proof &&
              Number.isFinite(proof.documentTimeOrigin) &&
              proof.documentTimeOrigin === performance.timeOrigin &&
              typeof proof.nativeGetContext === 'function' &&
              Object.getOwnPropertyDescriptor(prototype, 'getContext')
                ?.value === proof.nativeGetContext;
            record.status = requireShaderProgramAttribution
              ? 'unavailable'
              : proofMatches
                ? 'already-confirmed'
                : 'unavailable';
            record.errorKind = requireShaderProgramAttribution
              ? 'shader-attribution-state-not-found'
              : proofMatches
                ? null
                : 'cleanup-state-not-found';
            record.hookRestored = Boolean(proofMatches);
            record.stateDeleted = true;
            return finish(record);
          }
          delete window[proofKey];
          record.hookRestoreAttempted = true;
          try {
            state.restore?.();
          } catch {
            // Keep attempting listener removal and verify the hook separately.
          }
          record.hookRestored =
            typeof state.nativeGetContext === 'function' &&
            Object.getOwnPropertyDescriptor(prototype, 'getContext')?.value ===
              state.nativeGetContext;

          const remainingListeners = [];
          for (const entry of Array.isArray(state.listeners)
            ? state.listeners
            : []) {
            const [event, listener] = Array.isArray(entry) ? entry : [];
            record.listenerRemovalAttemptedCount += 1;
            try {
              if (
                typeof event !== 'string' ||
                typeof listener !== 'function' ||
                !state.canvas ||
                typeof state.canvas.removeEventListener !== 'function'
              )
                throw new Error('listener removal unavailable');
              state.canvas.removeEventListener(event, listener);
              record.listenerRemovalConfirmedCount += 1;
            } catch {
              record.listenerRemovalFailedCount += 1;
              remainingListeners.push(entry);
            }
          }
          state.listeners = remainingListeners;
          const complete =
            record.hookRestored &&
            record.listenerRemovalFailedCount === 0 &&
            remainingListeners.length === 0 &&
            shaderProgramAttributionCleanupConfirmed;
          if (!complete)
            record.errorKind = !record.hookRestored
              ? 'hook-restore-unconfirmed'
              : 'listener-removal-unconfirmed';
          if (complete) {
            record.status = 'confirmed';
            delete window[key];
            record.stateDeleted = !(key in window);
            if (!record.stateDeleted) {
              record.status = 'error';
              record.errorKind = 'cleanup-state-delete-unconfirmed';
            } else
              window[proofKey] = {
                nativeGetContext: state.nativeGetContext,
                documentTimeOrigin: performance.timeOrigin,
              };
          }
          return finish(record);
        },
        STATE_KEY,
        CLEANUP_PROOF_KEY,
        retireViewerRenderLoop,
        requireShaderProgramAttribution,
      ),
    );
    if (
      requireShaderProgramAttribution &&
      !evidence.document.shaderProgramAttribution
    ) {
      evidence.document.shaderProgramAttribution = {
        schema: 'gev-shader-program-lifecycle/v1',
        status: 'unavailable',
        error: 'observer-not-installed',
        cleanup: {
          confirmed: false,
          requestedMethodCount: 4,
          installedMethodCount: 0,
          restoredMethodCount: 0,
          changedOwnerCount: 0,
        },
        ownerChanged: false,
      };
      if (!['timeout', 'error'].includes(evidence.document.status)) {
        evidence.document.status = 'error';
        evidence.document.errorKind = 'shader-attribution-evidence-missing';
      }
    }
    documentOperationSettled = documentResult.settled;
    if (!documentResult.settled) {
      evidence.scriptRegistration.status = scriptIdentifier
        ? 'not-attempted'
        : 'not-registered';
      evidence.scriptRegistration.errorKind = scriptIdentifier
        ? 'document-stage-did-not-settle'
        : null;
    }
  } else {
    evidence.document.status = 'unavailable';
    evidence.document.errorKind = 'page-api-unavailable';
    documentOperationSettled = false;
  }

  if (scriptIdentifier && documentOperationSettled) {
    const registrationEvidence =
      await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
        page,
        scriptIdentifier,
        remaining(),
      );
    evidence.scriptRegistration = registrationEvidence.scriptRegistration;
  } else if (
    scriptIdentifier &&
    evidence.scriptRegistration.status === 'not-attempted'
  ) {
    // Preserve document-stage failure attribution; registration removal was
    // not reached under the original sequential cleanup order.
  } else if (!scriptIdentifier) {
    evidence.scriptRegistration.status = 'not-registered';
  }
  evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
  evidence.confirmed =
    ['confirmed', 'page-closed', 'already-confirmed'].includes(
      evidence.document.status,
    ) &&
    ['confirmed', 'not-registered', 'already-confirmed'].includes(
      evidence.scriptRegistration.status,
    ) &&
    (!retireViewerRenderLoop ||
      evidence.document.renderLoopRetirement?.confirmed === true);
  return evidence;
}

/** The capture CLI uses this when retiring its single-use owned page. */
export function retireEarlyCesiumRendererProbeForCapturePage(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
  options = {},
) {
  return cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    scriptIdentifier,
    timeoutMs,
    { ...options, retireViewerRenderLoop: true },
  );
}

function safeCleanupErrorKind(error, isScriptRegistration = false) {
  if (error?.name === 'TimeoutError') return 'operation-timeout';
  if (error?.name === 'TargetClosedError' || error?.name === 'PageClosedError')
    return 'target-closed';
  const message = String(error?.message || error || '');
  if (isScriptRegistration && /unknown|not found|identifier/i.test(message))
    return 'unknown-script-registration';
  return isScriptRegistration
    ? 'registration-removal-error'
    : 'page-evaluation-error';
}

function safeCleanupErrorDetail(error) {
  const recorder = createFixtureInterceptionErrorRecorder({ limit: 1 });
  recorder.onError(error);
  return recorder.records[0]?.message || 'Cleanup operation failed.';
}

/** Legacy boolean API retained for recovery callers. */
export async function cleanupEarlyCesiumRendererProbe(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
) {
  const evidence = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    scriptIdentifier,
    timeoutMs,
  );
  return evidence.confirmed;
}
