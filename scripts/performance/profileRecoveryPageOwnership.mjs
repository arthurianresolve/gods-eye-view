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
      return [...createdPageTargets].filter(
        (target) => target !== ownedTarget,
      ).length;
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

export async function closeOwnedRecoveryPage(
  page,
  browser,
  timeoutMs = 2000,
) {
  if (!page)
    return { closeCompleted: false, openPageCount: null };
  const closeCompleted =
    (await withHostTimeout(
      async () => {
        if (!page.isClosed()) await page.close({ runBeforeUnload: false });
        return true;
      },
      timeoutMs,
    )) === true;
  if (!closeCompleted)
    return { closeCompleted: false, openPageCount: null };
  const remainingPages = await withHostTimeout(
    () => browser.pages(),
    timeoutMs,
  );
  return {
    closeCompleted: true,
    openPageCount: Array.isArray(remainingPages)
      ? remainingPages.length
      : null,
  };
}

export async function closeRecoveryBrowser(
  browser,
  { timeoutMs = 5000, forceProcess } = {},
) {
  const closeCompleted =
    (await withHostTimeout(
      async () => {
        await browser.close();
        return true;
      },
      timeoutMs,
    )) === true;
  if (closeCompleted)
    return { closeCompleted: true, forcedProcessTermination: false };
  let forcedProcessTermination = false;
  if (forceProcess) {
    forcedProcessTermination =
      (await withHostTimeout(
        async () => {
          await forceProcess();
          return true;
        },
        timeoutMs,
      )) === true;
  }
  return { closeCompleted: false, forcedProcessTermination };
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
