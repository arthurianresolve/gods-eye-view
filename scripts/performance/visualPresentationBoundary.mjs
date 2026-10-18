/** Observe the real HUD phase without freezing timers or changing painted output. */
export function installVisualPresentationBoundaryInPage() {
  const root = document.getElementById('intel-hud');
  if (!root || window.__gevVisualPresentationBoundary)
    throw new Error('Visual presentation observer cannot be installed.');
  let revision = 0;
  const fingerprint = () =>
    JSON.stringify({
      text: root.textContent,
      display: getComputedStyle(root).display,
      visibility: getComputedStyle(root).visibility,
      recording:
        document.getElementById('hud-rec-dot')?.style.visibility || 'visible',
    });
  let previous = fingerprint();
  const refresh = () => {
    const next = fingerprint();
    if (previous !== next) {
      revision++;
      previous = next;
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  window.__gevVisualPresentationBoundary = {
    read() {
      refresh();
      const hud = window.__godsEyeView?.styleManager?.hud;
      const summary = document.getElementById('hud-summary');
      return {
        revision,
        recordingVisible:
          document.getElementById('hud-rec-dot')?.style.visibility !== 'hidden',
        summaryTypingComplete: hud?._summaryTypingInterval == null,
        summary: (summary?.textContent || '').slice(0, 2048),
        documentVisible: document.visibilityState === 'visible',
        documentFocused: document.hasFocus(),
      };
    },
    dispose() {
      observer.disconnect();
      delete window.__gevVisualPresentationBoundary;
    },
  };
}

export function readVisualPresentationBoundaryInPage() {
  const boundary = window.__gevVisualPresentationBoundary;
  if (!boundary)
    throw new Error('Visual presentation observer is unavailable.');
  return boundary.read();
}

export function disposeVisualPresentationBoundaryInPage() {
  window.__gevVisualPresentationBoundary?.dispose();
}

export function presentationStayedSettled(before, after) {
  return (
    Number.isSafeInteger(before?.revision) &&
    before.revision === after?.revision &&
    before.recordingVisible === true &&
    after.recordingVisible === true &&
    before.summaryTypingComplete === true &&
    after.summaryTypingComplete === true &&
    typeof before.summary === 'string' &&
    before.summary.length > 0 &&
    before.summary === after.summary &&
    before.documentVisible === true &&
    after.documentVisible === true &&
    before.documentFocused === true &&
    after.documentFocused === true
  );
}
