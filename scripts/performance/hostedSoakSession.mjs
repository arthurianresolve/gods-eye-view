import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';

export function requireSoakBrowserClose(outcome) {
  if (
    outcome?.closeCompleted !== true ||
    outcome?.forcedProcessTermination !== false
  ) {
    const error = new Error('Owned soak browser did not close normally.');
    error.browserClose = outcome || { closeCompleted: false };
    throw error;
  }
  return outcome;
}

/** One close attempt per owned browser; failures retain the observed outcome. */
export function createOwnedSoakCloser(
  browser,
  { closeBrowser = closeRecoveryBrowser } = {},
) {
  let closing;
  return () =>
    (closing ||= Promise.resolve()
      .then(() =>
        closeBrowser(browser, {
          timeoutMs: 5000,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        }),
      )
      .then(requireSoakBrowserClose));
}

/** Preserve probe and application-browser ownership across the handoff. */
export async function runHostedSoakSession({
  report,
  probeBrowser,
  closeProbeBrowser,
  createDriver,
  runSoak,
  commit,
  progress,
}) {
  try {
    report.probeBrowserClose = await closeProbeBrowser(probeBrowser);
    requireSoakBrowserClose(report.probeBrowserClose);
  } catch (error) {
    report.probeBrowserClose ||= error.browserClose || {
      closeCompleted: false,
    };
    report.cleanupError = 'Probe browser did not close normally.';
    throw error;
  }
  let driver, failure;
  try {
    driver = await createDriver();
    if (!driver.hardwareRenderingValidated)
      throw new Error('Soak browser did not retain verified acceleration');
    report.soak = await runSoak({ driver, progress });
    report.soak.candidateCommit = commit;
    if (!report.soak.fullSoak || report.soak.stability?.status !== 'passed')
      throw new Error(
        'Hosted accelerated soak did not pass stability acceptance',
      );
  } catch (error) {
    failure = error;
    if (error.soakReport) report.soak = error.soakReport;
    if (error.browserClose) report.browserClose = error.browserClose;
    if (error.cleanupError) report.cleanupError = error.cleanupError;
  } finally {
    if (driver) {
      try {
        report.browserClose = await driver.close();
        requireSoakBrowserClose(report.browserClose);
      } catch (error) {
        report.browserClose ||= error.browserClose || { closeCompleted: false };
        report.cleanupError =
          'Application soak browser did not close normally.';
        failure ||= error;
      }
    }
  }
  if (failure) throw failure;
}
