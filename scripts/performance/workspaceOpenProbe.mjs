/** Serializable UI observation: latch completion before autosave replaces it. */
export function clickAndWaitForWorkspaceOpen(
  scope = window,
  timeoutMs = 30000,
) {
  const root = scope.document.querySelector('.workspace-library');
  const status = root?.querySelector('[data-status]');
  const button = root?.querySelector('[data-action="open"]');
  const selectedId = root?.querySelector('[data-workspace-select]')?.value;
  const restore = scope.__godsEyeView?.workspaceLibraryPanel?.restore;
  const restoreStateBeforeClick = restore?.getState?.();
  if (!status || !button || button.disabled)
    throw new Error('Workspace open control is unavailable');
  return new Promise((resolve, reject) => {
    let timer, restorePoll;
    const finish = (error) => {
      observer.disconnect();
      scope.clearTimeout(timer);
      if (restorePoll != null) scope.clearInterval(restorePoll);
      if (error) reject(error);
      else resolve();
    };
    const finishFromLatchedRestore = () => {
      const current = restore?.getState?.();
      if (
        current &&
        current !== restoreStateBeforeClick &&
        current.status === 'applied' &&
        current.workspaceId === selectedId
      )
        finish();
    };
    const observer = new scope.MutationObserver((records) => {
      // textContent replacement adds a fresh text node. Read added nodes too:
      // a later status update may already have replaced the completion message.
      const messages = records.flatMap((record) =>
        [...record.addedNodes].map((node) => node.textContent || ''),
      );
      messages.push(status.textContent || '');
      if (messages.some((text) => text.startsWith('Opened'))) finish();
      else if (messages.some((text) => text.startsWith('Could not open')))
        finish(new Error('Workspace restore failed: ' + status.textContent));
    });
    observer.observe(status, { childList: true, subtree: true });
    // The restore coordinator owns a frozen, latched result. Polling that
    // state covers a fast same-workspace restore whose identical final status
    // text produces no useful DOM mutation, while the object-identity check
    // prevents an earlier successful restore from satisfying a new click.
    if (restore?.getState && selectedId)
      restorePoll = scope.setInterval(finishFromLatchedRestore, 50);
    timer = scope.setTimeout(
      () => finish(new Error('Workspace restore completion timed out')),
      timeoutMs,
    );
    try {
      button.click();
      finishFromLatchedRestore();
    } catch (error) {
      finish(error);
    }
  });
}
