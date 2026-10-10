import { spawn as defaultSpawn } from 'node:child_process';
import { withHostTimeout } from './startupDiagnostics.mjs';

function applicationPages(pages, baseUrl) {
  const appOrigin = new URL(baseUrl).origin;
  return pages.filter((page) => {
    try {
      return new URL(page.url()).origin === appOrigin;
    } catch {
      return false;
    }
  });
}

export function countRecoveryApplicationPages(pages, baseUrl) {
  return applicationPages(pages, baseUrl).length;
}

export function createRecoveryPageTargetGuard(browser) {
  const createdPageTargets = new Set();
  const onTargetCreated = (target) => {
    if (target.type() === 'page') createdPageTargets.add(target);
  };
  browser.on('targetcreated', onTargetCreated);
  return {
    unexpectedPageTargetCount(page) {
      const ownedTarget = page?.target?.();
      return [...createdPageTargets].filter((target) => target !== ownedTarget)
        .length;
    },
    assertOnlyOwnedPageTarget(page) {
      const unexpected = this.unexpectedPageTargetCount(page);
      if (unexpected)
        throw new Error(
          `Unexpected page targets were created during this recovery stage (${unexpected}).`,
        );
      return createdPageTargets.size;
    },
    dispose() {
      browser.off('targetcreated', onTargetCreated);
    },
  };
}

export function assertInitialRecoveryPage(pages, baseUrl) {
  const applicationCount = countRecoveryApplicationPages(pages, baseUrl);
  if (
    pages.length !== 1 ||
    pages[0].url() !== 'about:blank' ||
    applicationCount !== 0
  )
    throw new Error(
      `Expected exactly one initial about:blank page and no restored app pages; found ${pages.length} pages (${applicationCount} app pages).`,
    );
  return pages[0];
}

export function assertOwnedRecoveryPage(pages, ownedPage, baseUrl) {
  const ownedUrl = ownedPage?.url?.() || '';
  const application = applicationPages(pages, baseUrl);
  if (
    pages.length !== 1 ||
    application.length !== 1 ||
    application[0] !== ownedPage ||
    new URL(ownedUrl).origin !== new URL(baseUrl).origin
  )
    throw new Error(
      `Expected exactly one app page owned by this recovery stage; found ${pages.length} pages (${application.length} app pages).`,
    );
  return application.length;
}

export async function closeOwnedRecoveryPage(page, browser, timeoutMs = 2000) {
  if (!page) return { closeCompleted: false, openPageCount: null };
  const closeCompleted =
    (await withHostTimeout(async () => {
      if (!page.isClosed()) await page.close({ runBeforeUnload: false });
      return true;
    }, timeoutMs)) === true;
  if (!closeCompleted) return { closeCompleted: false, openPageCount: null };
  const remainingPages = await withHostTimeout(
    () => browser.pages(),
    timeoutMs,
  );
  return {
    closeCompleted: true,
    openPageCount: Array.isArray(remainingPages) ? remainingPages.length : null,
  };
}

const CDP_SEND_PREFIX = 'puppeteer:protocol:SEND';
const CDP_RECEIVE_PREFIX = 'puppeteer:protocol:RECV';
const MAX_CLOSE_PROTOCOL_MESSAGES = 64;
const MAX_CLOSE_PROTOCOL_MESSAGE_LENGTH = 32_768;

/** Keep only bounded Browser.close protocol milestones while close is active. */
export function createRecoveryBrowserCloseTrace({
  now = () => performance.now(),
} = {}) {
  let active = false;
  let startedAt = null;
  let messageCount = 0;
  let overflow = false;
  let malformedCloseMessage = false;
  let browserCloseRequestId = null;
  let requestElapsedMs = null;
  let acknowledgementElapsedMs = null;
  let acknowledgementError = null;
  let disconnectedElapsedMs = null;
  let finished = false;

  const elapsed = () => Math.max(0, now() - startedAt);
  const logProtocol = (direction, args) => {
    if (!active) return;
    if (messageCount >= MAX_CLOSE_PROTOCOL_MESSAGES) {
      overflow = true;
      return;
    }
    messageCount += 1;
    const raw = args[0];
    if (
      typeof raw !== 'string' ||
      raw.length > MAX_CLOSE_PROTOCOL_MESSAGE_LENGTH
    ) {
      overflow = true;
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      if (raw.includes('Browser.close')) malformedCloseMessage = true;
      return;
    }
    if (direction === 'send' && message?.method === 'Browser.close') {
      if (
        !Number.isSafeInteger(message.id) ||
        message.id < 0 ||
        message.sessionId !== undefined
      ) {
        malformedCloseMessage = true;
        return;
      }
      browserCloseRequestId = message.id;
      requestElapsedMs ??= elapsed();
      return;
    }
    if (
      direction === 'receive' &&
      browserCloseRequestId !== null &&
      message?.sessionId === undefined &&
      message?.method === undefined &&
      Number.isSafeInteger(message?.id) &&
      message.id >= 0 &&
      message?.id === browserCloseRequestId &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      acknowledgementElapsedMs ??= elapsed();
      acknowledgementError ??= Object.hasOwn(message, 'error');
    }
  };

  return {
    logger(prefix) {
      if (typeof prefix !== 'string') return undefined;
      if (prefix.startsWith(CDP_SEND_PREFIX))
        return (...args) => logProtocol('send', args);
      if (prefix.startsWith(CDP_RECEIVE_PREFIX))
        return (...args) => logProtocol('receive', args);
      return undefined;
    },
    begin() {
      if (active || finished) throw new Error('Close trace is not reusable.');
      startedAt = now();
      active = true;
    },
    recordDisconnected() {
      if (active) disconnectedElapsedMs ??= elapsed();
    },
    finish(deadlineMs = null) {
      if (finished) return null;
      active = false;
      finished = true;
      return {
        scope: 'owned-browser-close-only',
        browserCloseRequestSeen: requestElapsedMs !== null,
        browserCloseRequestElapsedMs: requestElapsedMs,
        browserCloseAcknowledgementSeen: acknowledgementElapsedMs !== null,
        browserCloseAcknowledgementElapsedMs: acknowledgementElapsedMs,
        browserCloseAcknowledgementLate:
          acknowledgementElapsedMs !== null &&
          Number.isFinite(deadlineMs) &&
          acknowledgementElapsedMs > deadlineMs,
        browserCloseAcknowledgementError: acknowledgementError,
        browserDisconnected: disconnectedElapsedMs !== null,
        browserDisconnectedElapsedMs: disconnectedElapsedMs,
        malformedCloseMessage,
        protocolMessageCount: messageCount,
        protocolMessageOverflow: overflow,
        protocolObservationComplete: !overflow,
      };
    },
  };
}

/** Stop only the supplied browser process tree and report observed confirmation. */
export async function stopOwnedRecoveryProcessTree(
  child,
  {
    platform = process.platform,
    spawnImpl = defaultSpawn,
    killProcess = process.kill,
    helperTimeoutMs = 2000,
    exitTimeoutMs = 1500,
  } = {},
) {
  if (!child)
    return { attempted: false, confirmed: false, reason: 'missing-process' };
  if (child.exitCode != null || child.signalCode != null)
    return { attempted: false, confirmed: true, reason: 'already-exited' };
  if (!Number.isInteger(child.pid) || child.pid < 1)
    return { attempted: false, confirmed: false, reason: 'missing-pid' };

  let terminationRequested = false;
  if (platform === 'win32') {
    const code = await new Promise((resolve) => {
      let killer;
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killer?.off('error', onError);
        killer?.off('exit', onExit);
        resolve(result);
      };
      const onError = () => finish(null);
      const onExit = (value) => finish(value);
      try {
        killer = spawnImpl(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
          },
        );
      } catch {
        finish(null);
        return;
      }
      timer = setTimeout(() => {
        finish(null);
        try {
          killer.kill();
        } catch {}
      }, helperTimeoutMs);
      killer.once('error', onError);
      killer.once('exit', onExit);
    });
    terminationRequested = code === 0;
    if (!terminationRequested)
      return {
        attempted: true,
        confirmed: false,
        reason:
          child.exitCode != null || child.signalCode != null
            ? 'exit-during-failed-request'
            : 'request-failed',
      };
  } else {
    try {
      killProcess(-child.pid, 'SIGTERM');
      terminationRequested = true;
    } catch {
      return { attempted: true, confirmed: false, reason: 'request-failed' };
    }
  }

  const exitObserved = await new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null)
      return resolve(true);
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, exitTimeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
  return {
    attempted: terminationRequested,
    confirmed: exitObserved,
    reason: exitObserved ? 'process-exit-observed' : 'exit-not-observed',
  };
}

export async function closeRecoveryBrowser(
  browser,
  {
    timeoutMs = 5000,
    forceProcess,
    now = () => performance.now(),
    closeTrace = null,
  } = {},
) {
  const child = browser.process?.() ?? null;
  const startedAt = now();
  let processExit = null;
  const initialExit = () => {
    const code = child?.exitCode;
    const signal = child?.signalCode;
    return code != null || signal != null ? { code, signal } : null;
  };
  processExit = initialExit();
  const processExitedBeforeClose = processExit !== null;
  if (processExit) processExit = { ...processExit, elapsedMs: null };
  const onExit = (code, signal) => {
    processExit = { code, signal, elapsedMs: Math.max(0, now() - startedAt) };
  };
  if (!processExit) child?.once?.('exit', onExit);
  const onDisconnected = () => closeTrace?.recordDisconnected?.();

  const settleWithin = async (operation) => {
    let timer;
    const settled = Promise.resolve()
      .then(operation)
      .then(
        (value) => ({ kind: 'resolved', value }),
        (error) => ({ kind: 'rejected', error }),
      );
    try {
      return await Promise.race([
        settled,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  let forcedProcessTermination = false;
  let forceProcessStatus = forceProcess ? 'not-needed' : 'not-configured';
  let forceProcessAttempted = false;
  let forceProcessCallbackInvoked = false;
  try {
    browser.on?.('disconnected', onDisconnected);
    closeTrace?.begin?.();
    const closeResult = await settleWithin(() => browser.close());
    const closeCompleted = closeResult.kind === 'resolved';
    const closeStatus = closeCompleted
      ? 'completed'
      : closeResult.kind === 'timeout'
        ? 'timed-out'
        : 'rejected';
    const closeSettledAt = now();
    const closeElapsedMs = Math.max(0, closeSettledAt - startedAt);
    let closeRejectionName = null;
    let forceProcessElapsedMs = null;

    if (closeResult.kind === 'rejected') {
      const name = closeResult.error?.name;
      closeRejectionName =
        typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name)
          ? name.slice(0, 48)
          : 'Error';
    }

    if (!closeCompleted && forceProcess) {
      const currentExit = initialExit();
      if (currentExit) {
        forceProcessStatus = 'already-exited';
      } else {
        forceProcessCallbackInvoked = true;
        forceProcessAttempted = true;
        const forceStartedAt = now();
        const forceResult = await settleWithin(forceProcess);
        forceProcessElapsedMs = Math.max(0, now() - forceStartedAt);
        if (forceResult.kind === 'timeout') {
          forceProcessStatus = 'timed-out';
        } else if (forceResult.kind === 'rejected') {
          forceProcessStatus = 'rejected';
        } else if (
          forceResult.value?.reason === 'already-exited' ||
          (forceResult.value?.attempted === false &&
            forceResult.value?.confirmed === true)
        ) {
          forceProcessAttempted = false;
          forceProcessStatus = 'already-exited';
        } else if (
          forceResult.value?.attempted === true &&
          forceResult.value?.confirmed === true
        ) {
          forceProcessStatus = 'confirmed';
          forcedProcessTermination = true;
        } else {
          forceProcessStatus = 'unconfirmed';
        }
      }
    }

    processExit ||= initialExit();
    const protocolCloseTrace = closeTrace?.finish?.(timeoutMs) ?? null;
    return {
      closeCompleted,
      forcedProcessTermination,
      observation: {
        closeStatus,
        closeDeadlineMs: timeoutMs,
        closeStartHostMs: startedAt,
        closeSettledHostMs: closeSettledAt,
        closeElapsedMs,
        closeRejectionName,
        processExitedBeforeClose,
        processExit,
        protocolCloseTrace,
        forceProcessStatus,
        forceProcessAttempted,
        forceProcessCallbackInvoked,
        forceProcessElapsedMs,
      },
    };
  } finally {
    closeTrace?.finish?.(timeoutMs);
    browser.off?.('disconnected', onDisconnected);
    child?.off?.('exit', onExit);
  }
}

export function applyRecoveryCleanupFailure(check, cleanupError) {
  if (!check) return { becamePrimaryFailure: false, shouldThrow: false };
  check.pageOwnership ||= {};
  check.pageOwnership.cleanupError = cleanupError.message.slice(0, 240);
  if (check.status !== 'passed')
    return { becamePrimaryFailure: false, shouldThrow: false };
  check.status = 'failed';
  check.step = 'owned-page-cleanup';
  check.error = cleanupError.message;
  return { becamePrimaryFailure: true, shouldThrow: true };
}

export function recoveryPageCleanupError({
  closeCompleted,
  openPageCount,
  unexpectedCreatedPageTargets,
  browserCloseCompleted,
}) {
  if (!closeCompleted || openPageCount !== 0)
    return new Error(
      `Owned fixture page cleanup failed before browser close (closed=${closeCompleted}, remaining=${openPageCount}).`,
    );
  if (unexpectedCreatedPageTargets > 0)
    return new Error(
      `Unexpected page targets were created during this recovery stage (${unexpectedCreatedPageTargets}).`,
    );
  if (browserCloseCompleted === false)
    return new Error('Graceful browser close did not complete.');
  return null;
}
