import assert from 'node:assert/strict';

export const BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS = 5_000;
export const BROWSER_SHUTDOWN_CONTROLS = Object.freeze([
  { id: 'blank-normal', document: 'blank', treatment: 'normal' },
  { id: 'blank-unload', document: 'blank', treatment: 'navigation-first' },
  { id: 'webgl2-normal', document: 'webgl2', treatment: 'normal' },
  { id: 'webgl2-unload', document: 'webgl2', treatment: 'navigation-first' },
  { id: 'cesium-normal', document: 'cesium', treatment: 'normal' },
  { id: 'cesium-unload', document: 'cesium', treatment: 'navigation-first' },
]);

const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

export function createBrowserShutdownReport(identity) {
  assertShutdownIdentity(identity);
  return {
    schema: 'gev-browser-shutdown-controls/v2',
    status: 'running',
    scope: 'owned-chrome-close-controls; diagnostic-only',
    closeDeadlineMs: BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS,
    identity: { ...identity },
    controls: [],
    blockedControls: [],
    failure: null,
  };
}

function assertShutdownIdentity(identity) {
  if (
    !SHA1.test(identity?.sourceCommit || '') ||
    !SHA1.test(identity?.harnessCommit || '') ||
    identity.sourceCommit !== identity.harnessCommit ||
    identity.sourceCleanAtStart !== true ||
    (identity.sourceCleanAtEnd != null &&
      typeof identity.sourceCleanAtEnd !== 'boolean') ||
    typeof identity.nodeVersion !== 'string' ||
    !/^v\d+\.\d+\.\d+/.test(identity.nodeVersion) ||
    identity.platform !== 'win32' ||
    typeof identity.osRelease !== 'string' ||
    identity.osRelease.length < 1 ||
    identity.osRelease.length > 80 ||
    typeof identity.osVersion !== 'string' ||
    identity.osVersion.length < 1 ||
    identity.osVersion.length > 160 ||
    typeof identity.cesiumVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(identity.cesiumVersion) ||
    !SHA256.test(identity.cesiumBundleSha256 || '') ||
    !SHA256.test(identity.fixtureSha256 || '') ||
    identity.fixtureIdentity !== 'blank-webgl2-cesium-installed-build-v1' ||
    identity.fixtureBuildRecipe !==
      'direct-installed-cesium-static-tree-no-app-build' ||
    identity.rendererMode?.softwareRendering !== true ||
    identity.rendererMode?.webglOnly !== true ||
    !Array.isArray(identity.launchFlags) ||
    identity.launchFlags.length > 16 ||
    identity.launchFlags.some(
      (flag) => typeof flag !== 'string' || flag.length > 100,
    ) ||
    ![
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
    ].every((flag) => identity.launchFlags.includes(flag))
  )
    throw new Error('Browser shutdown source or fixture identity is invalid.');
}

export function classifyBrowserShutdownControl(result) {
  if (
    result?.setupCompleted !== true ||
    result.freshProfile !== true ||
    result.documentReady !== true ||
    result.browserVersionConsistent !== true ||
    typeof result.browserVersion !== 'string' ||
    result.browserVersion.length > 100 ||
    result.pageCloseCompleted !== true ||
    result.openPageCountAfterClose !== 0 ||
    result.browserCloseCompleted !== true ||
    result.forcedProcessTermination !== false ||
    result.processExitConfirmed !== true ||
    result.processExitScope !==
      'browser-parent-process-only; descendants-unobserved' ||
    !Number.isFinite(result.elapsedMs) ||
    result.elapsedMs < 0 ||
    result.closeObservation?.closeStatus !== 'completed' ||
    result.closeObservation?.closeDeadlineMs !==
      BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    !Number.isFinite(result.closeObservation?.closeElapsedMs) ||
    result.closeObservation.closeElapsedMs < 0 ||
    result.closeObservation.closeElapsedMs >
      BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    result.closeObservation?.forceProcessAttempted !== false ||
    !result.closeObservation?.processExit ||
    (result.closeObservation.processExit.code == null &&
      result.closeObservation.processExit.signal == null) ||
    result.closeTrace?.browserCloseRequestSeen !== true ||
    !Number.isFinite(result.closeTrace?.browserCloseRequestElapsedMs) ||
    result.closeTrace.browserCloseRequestElapsedMs < 0 ||
    result.closeTrace.browserCloseRequestElapsedMs >
      BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    result.closeTrace?.browserCloseAcknowledgementSeen !== true ||
    !Number.isFinite(result.closeTrace?.browserCloseAcknowledgementElapsedMs) ||
    result.closeTrace.browserCloseAcknowledgementElapsedMs < 0 ||
    result.closeTrace.browserCloseAcknowledgementElapsedMs >
      BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    result.closeTrace?.browserCloseAcknowledgementError !== false ||
    result.closeTrace?.browserCloseAcknowledgementLate !== false ||
    result.closeTrace?.browserDisconnected !== true ||
    !Number.isFinite(result.closeTrace?.browserDisconnectedElapsedMs) ||
    result.closeTrace.browserDisconnectedElapsedMs < 0 ||
    result.closeTrace.browserDisconnectedElapsedMs >
      BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    result.closeTrace?.malformedCloseMessage !== false ||
    result.closeTrace?.protocolObservationComplete !== true ||
    result.error != null ||
    !Number.isSafeInteger(result.pageErrorCount) ||
    result.pageErrorCount !== 0 ||
    !Array.isArray(result.pageErrors) ||
    result.pageErrors.length > 8 ||
    result.pageErrors.length > result.pageErrorCount ||
    result.pageErrors.some(
      (message) => typeof message !== 'string' || message.length > 300,
    ) ||
    result.pageErrorsTruncated !==
      result.pageErrorCount > result.pageErrors.length
  )
    return 'failed';
  if (result.document === 'blank' && result.readiness?.blank !== true)
    return 'failed';
  if (
    result.document === 'webgl2' &&
    (result.readiness?.webgl2 !== true ||
      !hasUsableRenderingContext(result.readiness))
  )
    return 'failed';
  if (
    result.document === 'cesium' &&
    (result.readiness?.cesium !== true ||
      result.readiness?.contextAvailable !== true ||
      !hasUsableRenderingContext(result.readiness))
  )
    return 'failed';
  if (
    result.elapsedMs !== null &&
    (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0)
  )
    return 'failed';
  if (
    result.treatment === 'navigation-first' &&
    (result.navigationToBlankCompleted !== true ||
      result.pageHideObserved !== true ||
      result.pageHideObservation?.scope !== 'fixture-server-sendBeacon' ||
      !Number.isSafeInteger(result.pageHideObservation?.count) ||
      result.pageHideObservation.count < 1 ||
      typeof result.pageHideObservation.persisted !== 'boolean' ||
      !Number.isFinite(result.pageHideObservation.deliveryElapsedMs) ||
      result.pageHideObservation.deliveryElapsedMs < 0 ||
      result.pageHideObservation.receivedWithinDeadline !== true ||
      result.pageHideObservation.deadlineMs !== 1_000 ||
      result.pageHideObservation.deliveryElapsedMs > 1_000 ||
      result.pageHideObservedAfterDeadline !== false ||
      result.pageHideFailureReason !== null)
  )
    return 'failed';
  return 'passed';
}

function hasUsableRenderingContext(readiness) {
  return (
    Number.isSafeInteger(readiness?.canvasWidth) &&
    readiness.canvasWidth > 0 &&
    Number.isSafeInteger(readiness?.canvasHeight) &&
    readiness.canvasHeight > 0 &&
    Number.isFinite(readiness?.readyFrameElapsedMs) &&
    readiness.readyFrameElapsedMs >= 0 &&
    typeof readiness?.renderingContext?.version === 'string' &&
    readiness.renderingContext.version.length > 0 &&
    typeof readiness.renderingContext.vendor === 'string' &&
    readiness.renderingContext.vendor.length > 0 &&
    typeof readiness.renderingContext.renderer === 'string' &&
    readiness.renderingContext.renderer.length > 0 &&
    typeof readiness.renderingContext.debugRendererInfoAvailable ===
      'boolean' &&
    (readiness.renderingContext.debugRendererInfoAvailable
      ? typeof readiness.renderingContext.unmaskedVendor === 'string' &&
        readiness.renderingContext.unmaskedVendor.length > 0 &&
        typeof readiness.renderingContext.unmaskedRenderer === 'string' &&
        readiness.renderingContext.unmaskedRenderer.length > 0
      : readiness.renderingContext.unmaskedVendor === null &&
        readiness.renderingContext.unmaskedRenderer === null) &&
    Number.isFinite(readiness.renderingContext.rendererQueryDurationMs) &&
    readiness.renderingContext.rendererQueryDurationMs >= 0 &&
    typeof readiness.renderingContext.antialias === 'boolean' &&
    typeof readiness.renderingContext.alpha === 'boolean'
  );
}

export async function runBrowserShutdownControlMatrix({
  identity,
  runControl,
  onControl = () => {},
}) {
  assertShutdownIdentity(identity);
  if (typeof runControl !== 'function')
    throw new TypeError('Browser shutdown runner requires a control callback.');
  const report = createBrowserShutdownReport(identity);
  for (const specification of BROWSER_SHUTDOWN_CONTROLS) {
    let result;
    try {
      result = await runControl({ ...specification });
    } catch (error) {
      result = {
        ...specification,
        setupCompleted: false,
        documentReady: false,
        pageCloseCompleted: false,
        openPageCountAfterClose: null,
        browserCloseCompleted: false,
        forcedProcessTermination: false,
        processExitConfirmed: false,
        error: sanitizeShutdownError(error),
      };
    }
    if (
      !report.identity.browserVersion &&
      typeof result?.browserVersion === 'string'
    )
      report.identity.browserVersion = result.browserVersion;
    const browserVersionConsistent =
      typeof result?.browserVersion === 'string' &&
      result.browserVersion === report.identity.browserVersion;
    const status = classifyBrowserShutdownControl({
      ...specification,
      ...result,
      browserVersionConsistent,
    });
    const row = {
      ...specification,
      ...result,
      browserVersionConsistent,
      status,
    };
    report.controls.push(row);
    await onControl(row, report);
    if (row.processExitConfirmed !== true) {
      report.blockedControls = BROWSER_SHUTDOWN_CONTROLS.slice(
        report.controls.length,
      ).map(({ id }) => id);
      report.failure = 'owned-browser-process-exit-unconfirmed';
      break;
    }
  }
  report.status =
    report.controls.length === BROWSER_SHUTDOWN_CONTROLS.length &&
    report.controls.every((row) => row.status === 'passed')
      ? 'passed'
      : 'failed';
  if (report.status === 'failed' && !report.failure)
    report.failure = 'one-or-more-shutdown-controls-failed';
  return report;
}

export function validateBrowserShutdownReport(report) {
  assertShutdownIdentity(report?.identity);
  if (
    report.schema !== 'gev-browser-shutdown-controls/v2' ||
    report.scope !== 'owned-chrome-close-controls; diagnostic-only' ||
    report.closeDeadlineMs !== BROWSER_SHUTDOWN_CLOSE_DEADLINE_MS ||
    !['passed', 'failed'].includes(report.status) ||
    !Array.isArray(report.controls) ||
    !Array.isArray(report.blockedControls) ||
    report.controls.length > BROWSER_SHUTDOWN_CONTROLS.length
  )
    throw new Error('Browser shutdown report envelope is invalid.');
  for (let index = 0; index < report.controls.length; index++) {
    const expected = BROWSER_SHUTDOWN_CONTROLS[index];
    const row = report.controls[index];
    if (
      row.id !== expected.id ||
      row.document !== expected.document ||
      row.treatment !== expected.treatment ||
      row.browserVersionConsistent !==
        (typeof row.browserVersion === 'string' &&
          row.browserVersion === report.identity.browserVersion) ||
      row.status !== classifyBrowserShutdownControl(row)
    )
      throw new Error(`Browser shutdown control is invalid: ${expected.id}.`);
    if (index < report.controls.length - 1 && row.processExitConfirmed !== true)
      throw new Error('A later control ran before the owned process exited.');
  }
  if (report.blockedControls.length) {
    const expectedBlocked = BROWSER_SHUTDOWN_CONTROLS.slice(
      report.controls.length,
    ).map(({ id }) => id);
    assert.deepEqual(report.blockedControls, expectedBlocked);
    if (report.controls.at(-1)?.processExitConfirmed === true)
      throw new Error(
        'Controls were blocked after process exit was confirmed.',
      );
  }
  if (report.status === 'passed') {
    if (
      report.controls.length !== BROWSER_SHUTDOWN_CONTROLS.length ||
      report.controls.some((row) => row.status !== 'passed') ||
      report.blockedControls.length !== 0 ||
      report.failure !== null ||
      report.identity.sourceCleanAtEnd !== true ||
      report.identity.sourceCommitAtEnd !== report.identity.sourceCommit ||
      typeof report.identity.browserVersion !== 'string'
    )
      throw new Error('Passing browser shutdown report is incomplete.');
  } else if (!report.failure) {
    throw new Error('Failed browser shutdown report lacks a failure reason.');
  }
  return report;
}

export function sanitizeShutdownError(error) {
  const message = String(error?.message || error || 'unknown failure')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[A-Z]:\\[^\s"'<>]+/gi, '[path]')
    .replace(/\b(?:\\\\|\/)[^\s"'<>]+/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
  return message || 'unknown failure';
}
