/** Install a bounded focus probe in the browser document before fixture boot. */
export function createAccessibilityFocusProbe(windowRef = window) {
  const MAX_CLASSES = 8;
  const MAX_CLASS_LENGTH = 48;
  const MAX_ID_LENGTH = 80;
  const MAX_PHASE_LENGTH = 80;
  const MAX_FOCUS_EVENTS = 12;
  const documentRef = windowRef.document;
  const startedAt = windowRef.performance?.now?.() ?? 0;
  const events = [];
  let phase = 'probe-installed';
  let lastControl = null;
  let disposed = false;
  let focusEventsTruncated = false;

  const summarizeTarget = (element) => {
    if (!element || typeof element !== 'object') return null;
    const classes = [];
    if (
      element.classList &&
      typeof element.classList[Symbol.iterator] === 'function'
    ) {
      for (const name of element.classList) {
        if (classes.length >= MAX_CLASSES) break;
        classes.push(String(name).slice(0, MAX_CLASS_LENGTH));
      }
    }
    return {
      tag:
        typeof element.tagName === 'string'
          ? element.tagName.toLowerCase().slice(0, 24)
          : null,
      id:
        typeof element.id === 'string'
          ? element.id.slice(0, MAX_ID_LENGTH)
          : null,
      classes,
    };
  };
  const record = (type, event) => {
    events.push({
      elapsedMs: Math.max(
        0,
        (windowRef.performance?.now?.() ?? startedAt) - startedAt,
      ),
      type,
      target: summarizeTarget(event?.target),
      relatedTarget: summarizeTarget(event?.relatedTarget),
      activeElement: summarizeTarget(documentRef.activeElement),
    });
    if (events.length > MAX_FOCUS_EVENTS) {
      events.shift();
      focusEventsTruncated = true;
    }
  };
  const onFocusIn = (event) => record('focusin', event);
  const onFocusOut = (event) => record('focusout', event);
  documentRef.addEventListener('focusin', onFocusIn, true);
  documentRef.addEventListener('focusout', onFocusOut, true);

  const panelSnapshot = () => {
    const panel = documentRef.querySelector('#evidence-panel');
    const closeButton = documentRef.querySelector('#evidence-panel-close');
    const technical = documentRef.querySelector('.evidence-panel-technical');
    return {
      exists: Boolean(panel),
      hidden: typeof panel?.hidden === 'boolean' ? panel.hidden : null,
      collapsed: panel?.classList?.contains('collapsed') ?? null,
      pinned:
        panel?.dataset?.pinned === 'true'
          ? true
          : panel?.dataset?.pinned === 'false'
            ? false
            : null,
      ariaHidden:
        panel?.getAttribute?.('aria-hidden') === 'true'
          ? 'true'
          : panel?.getAttribute?.('aria-hidden') === 'false'
            ? 'false'
            : null,
      closeButtonExists: Boolean(closeButton),
      closeButtonDisabled:
        typeof closeButton?.disabled === 'boolean'
          ? closeButton.disabled
          : null,
      technicalDetailsOpen:
        typeof technical?.open === 'boolean' ? technical.open : null,
    };
  };

  const probe = {
    markPhase(value) {
      phase = String(value || '').slice(0, MAX_PHASE_LENGTH) || 'unspecified';
    },
    markControl(value) {
      lastControl = String(value || '').slice(0, MAX_PHASE_LENGTH) || null;
    },
    snapshot() {
      return {
        phase,
        lastControl,
        activeElement: summarizeTarget(documentRef.activeElement),
        evidencePanel: panelSnapshot(),
        focusEvents: events.slice(-MAX_FOCUS_EVENTS),
        focusEventsTruncated,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      documentRef.removeEventListener('focusin', onFocusIn, true);
      documentRef.removeEventListener('focusout', onFocusOut, true);
      if (windowRef.__qaAccessibilityFocus === probe)
        delete windowRef.__qaAccessibilityFocus;
    },
  };
  windowRef.__qaAccessibilityFocus = probe;
  return probe;
}
