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

export async function closeRecoveryBrowser(
  browser,
  { timeoutMs = 5000, forceProcess, now = () => performance.now() } = {},
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
  if (processExit) processExit = { ...processExit, elapsedMs: 0 };
  const onExit = (code, signal) => {
    processExit = { code, signal, elapsedMs: Math.max(0, now() - startedAt) };
  };
  if (!processExit) child?.once?.('exit', onExit);

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
  try {
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
      const forceStartedAt = now();
      const forceResult = await settleWithin(forceProcess);
      forceProcessElapsedMs = Math.max(0, now() - forceStartedAt);
      forceProcessStatus =
        forceResult.kind === 'resolved'
          ? 'completed'
          : forceResult.kind === 'timeout'
            ? 'timed-out'
            : 'rejected';
      forcedProcessTermination = forceResult.kind === 'resolved';
    }

    processExit ||= initialExit();
    if (processExit && processExit.elapsedMs == null)
      processExit = { ...processExit, elapsedMs: 0 };
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
        forceProcessStatus,
        forceProcessElapsedMs,
      },
    };
  } finally {
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
