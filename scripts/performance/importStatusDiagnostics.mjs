/** Install a bounded, disposable observer for the workspace import status. */
export function installImportStatusDiagnosticsInPage(scope = window) {
  const OBSERVER_KEY = '__gevImportStatusDiagnostics';
  const SEQUENCE_KEY = '__gevImportStatusDiagnosticsSequence';
  const MAX_STATUS_SNAPSHOTS = 16;
  const MAX_STATUS_LENGTH = 240;
  const isTerminalImportStatus = (text) =>
    text.startsWith('Imported ') || text.startsWith('Import was not applied');
  const previous = scope[OBSERVER_KEY];
  if (previous)
    throw new Error('Import status diagnostics already has an owner.');

  const document = scope.document;
  const root = document?.querySelector('.workspace-library');
  if (
    !root ||
    !root.querySelector('[data-import-status]') ||
    typeof scope.MutationObserver !== 'function'
  ) {
    return { installed: false };
  }

  const sequence = (Number(scope[SEQUENCE_KEY]) || 0) + 1;
  scope[SEQUENCE_KEY] = sequence;
  const ownerToken = `${scope.performance?.timeOrigin ?? 0}:${sequence}`;
  const timeOriginMs = Number.isFinite(scope.performance?.timeOrigin)
    ? scope.performance.timeOrigin
    : null;
  const snapshots = [];
  let droppedSnapshots = 0;
  let lastText = null;
  let initialStatus = null;
  let terminalSnapshot = null;
  let waitReference = null;
  const capture = () => {
    const status = document
      .querySelector('.workspace-library')
      ?.querySelector('[data-import-status]');
    const rawText = status?.textContent ?? '';
    const text =
      typeof rawText === 'string'
        ? rawText
            .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
            .slice(0, MAX_STATUS_LENGTH)
        : '';
    if (lastText === null) initialStatus = text;
    if (text === lastText) return;
    lastText = text;
    const now = scope.performance?.now?.();
    const performanceNowMs = Number.isFinite(now) ? now : null;
    const snapshot = {
      performanceNowMs,
      epochTimeMs:
        timeOriginMs !== null && performanceNowMs !== null
          ? timeOriginMs + performanceNowMs
          : null,
      text,
      terminal: isTerminalImportStatus(text),
    };
    snapshots.push(snapshot);
    if (snapshot.terminal) terminalSnapshot = snapshot;
    if (snapshots.length > MAX_STATUS_SNAPSHOTS) {
      snapshots.shift();
      droppedSnapshots += 1;
    }
  };
  const observer = new scope.MutationObserver(capture);
  const state = {
    ownerToken,
    observer,
    markStatusWaitReference(timeoutMs) {
      if (waitReference) return;
      const now = scope.performance?.now?.();
      const performanceNowMs = Number.isFinite(now) ? now : null;
      const boundedTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.max(0, Math.min(120_000, timeoutMs))
        : null;
      waitReference = {
        clockDomain: 'browser-performance-epoch-estimate',
        referenceKind: 'pre-wait-conservative',
        performanceNowMs,
        epochTimeMs:
          timeOriginMs !== null && performanceNowMs !== null
            ? timeOriginMs + performanceNowMs
            : null,
        timeoutMs: boundedTimeoutMs,
      };
    },
    snapshot() {
      const records = snapshots.map((entry) => ({ ...entry }));
      const terminal = records.findLast((entry) => entry.terminal) || null;
      const terminalTimeMs =
        terminalSnapshot?.epochTimeMs ?? terminal?.epochTimeMs ?? null;
      const conservativeReferenceDeadlineEpochTimeMs =
        waitReference &&
        waitReference.epochTimeMs !== null &&
        waitReference.timeoutMs !== null
          ? waitReference.epochTimeMs + waitReference.timeoutMs
          : null;
      return {
        timeOriginMs,
        initialStatus,
        terminalStatus: terminalSnapshot?.text ?? terminal?.text ?? null,
        terminalPerformanceNowMs:
          terminalSnapshot?.performanceNowMs ??
          terminal?.performanceNowMs ??
          null,
        statusWait: waitReference ? { ...waitReference } : null,
        conservativeReferenceDeadlineEpochTimeMs,
        terminalBeforeConservativeReferenceDeadline:
          terminalTimeMs !== null &&
          conservativeReferenceDeadlineEpochTimeMs !== null
            ? terminalTimeMs <= conservativeReferenceDeadlineEpochTimeMs
            : null,
        droppedSnapshots,
        snapshots: records,
      };
    },
  };
  observer.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scope[OBSERVER_KEY] = state;
  capture();
  return { installed: true, ownerToken };
}

/** Record a conservative browser-clock reference before starting the host wait. */
export function markImportStatusWaitReferenceInPage(
  ownerToken,
  timeoutMs,
  scope = window,
) {
  const state = scope.__gevImportStatusDiagnostics;
  if (!state || state.ownerToken !== ownerToken) return false;
  state.markStatusWaitReference(timeoutMs);
  return true;
}

/** Stop observing and release the page-owned reference on success or failure. */
export function cleanupImportStatusDiagnosticsInPage(
  ownerToken,
  scope = window,
) {
  const OBSERVER_KEY = '__gevImportStatusDiagnostics';
  const state = scope[OBSERVER_KEY];
  if (!state || state.ownerToken !== ownerToken) return false;
  state?.observer?.disconnect();
  delete scope[OBSERVER_KEY];
  return true;
}

/** Release only this import's observer and preserve primary operation errors. */
export async function withImportStatusDiagnostics(page, install, operation) {
  let ownerToken = null;
  let primaryError = null;
  let operationFailed = false;
  try {
    const installation = await install();
    ownerToken = installation?.ownerToken ?? null;
    return await operation(ownerToken);
  } catch (error) {
    primaryError = error;
    operationFailed = true;
    throw error;
  } finally {
    if (ownerToken !== null) {
      try {
        const cleaned = await page.evaluate(
          cleanupImportStatusDiagnosticsInPage,
          ownerToken,
        );
        if (cleaned !== true) {
          throw new Error(
            'Import status diagnostics ownership was lost before cleanup.',
          );
        }
      } catch (cleanupError) {
        if (!operationFailed) throw cleanupError;
        try {
          Object.defineProperty(
            primaryError,
            'importStatusDiagnosticsCleanupError',
            { configurable: true, value: cleanupError },
          );
        } catch {
          try {
            primaryError.message += `; status observer cleanup failed: ${cleanupError.message}`;
          } catch {
            // Preserve the original thrown value if it cannot accept diagnostics.
          }
        }
      }
    }
  }
}

/** Dispose the status wait root without masking the wait's primary failure. */
export async function withImportStatusWaitRoot(root, operation) {
  let primaryError;
  let operationFailed = false;
  try {
    return await operation(root);
  } catch (error) {
    primaryError = error;
    operationFailed = true;
    throw error;
  } finally {
    try {
      await root.dispose();
    } catch (disposeError) {
      if (!operationFailed) throw disposeError;
      try {
        Object.defineProperty(
          primaryError,
          'importStatusWaitRootDisposeError',
          {
            configurable: true,
            value: disposeError,
          },
        );
      } catch {
        try {
          primaryError.message += `; wait-root disposal failed: ${disposeError.message}`;
        } catch {
          // Preserve the original thrown value if it cannot accept diagnostics.
        }
      }
    }
  }
}
