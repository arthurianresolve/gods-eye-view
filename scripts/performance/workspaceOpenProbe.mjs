/** Serializable UI observation: latch completion before autosave replaces it. */
export function clickAndWaitForWorkspaceOpen(
  scope = window,
  timeoutMs = 30000,
) {
  const root = scope.document.querySelector('.workspace-library');
  const status = root?.querySelector('[data-status]');
  const button = root?.querySelector('[data-action="open"]');
  if (!status || !button || button.disabled)
    throw new Error('Workspace open control is unavailable');
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      observer.disconnect();
      scope.clearTimeout(timer);
      if (error) reject(error);
      else resolve();
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
    timer = scope.setTimeout(
      () => finish(new Error('Workspace restore completion timed out')),
      timeoutMs,
    );
    try {
      button.click();
    } catch (error) {
      finish(error);
    }
  });
}
