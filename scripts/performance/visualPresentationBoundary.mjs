/** Observe the real HUD phase without freezing timers or changing painted output. */
export function installVisualPresentationBoundaryInPage() {
  const root = document.getElementById('intel-hud');
  if (!root || window.__gevVisualPresentationBoundary)
    throw new Error('Visual presentation observer cannot be installed.');
  let revision = 0;
  let pointer = null;
  const fingerprint = () =>
    JSON.stringify({
      text: root.textContent,
      display: getComputedStyle(root).display,
      visibility: getComputedStyle(root).visibility,
      opacity: getComputedStyle(root).opacity,
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
  const onPointerMove = (event) => {
    pointer = {
      x: event.clientX,
      y: event.clientY,
      pointerType: String(event.pointerType || 'mouse').slice(0, 16),
    };
  };
  window.addEventListener('pointermove', onPointerMove, {
    capture: true,
    passive: true,
  });
  const readScrollContainer = (id, element) => {
    if (!element) return { id, present: false };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      id,
      present: true,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      scroll: {
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.scrollWidth,
        height: element.scrollHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        offsetWidth: element.offsetWidth,
        offsetHeight: element.offsetHeight,
      },
      computed: {
        display: style.display,
        visibility: style.visibility,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollbarGutter: style.scrollbarGutter,
        scrollbarWidth: style.scrollbarWidth,
      },
    };
  };
  const readCctvScrollContainers = () => {
    const panel = document.getElementById('cctv-panel');
    const inner = panel?.querySelector('.cctv-panel-inner') || null;
    const cyberBody =
      inner?.querySelector('.cyber-panel-body') ||
      panel?.querySelector('.cyber-panel-body') ||
      null;
    return [
      readScrollContainer('cctv-panel', panel),
      readScrollContainer('cctv-panel-inner', inner),
      readScrollContainer('cctv-cyber-panel-body', cyberBody),
    ];
  };
  window.__gevVisualPresentationBoundary = {
    read() {
      refresh();
      const hud = window.__godsEyeView?.styleManager?.hud;
      const summary = document.getElementById('hud-summary');
      const style = getComputedStyle(root);
      return {
        revision,
        hudVisible: hud?.visible === true,
        hudOpacity: Number.parseFloat(style.opacity),
        hudVisibility: style.visibility,
        hudDisplay: style.display,
        recordingVisible:
          document.getElementById('hud-rec-dot')?.style.visibility !== 'hidden',
        summaryTypingComplete: hud?._summaryTypingInterval == null,
        summary: (summary?.textContent || '').slice(0, 2048),
        documentVisible: document.visibilityState === 'visible',
        documentFocused: document.hasFocus(),
        scrollContainers: readCctvScrollContainers(),
        pointer: pointer ? { ...pointer } : null,
        activeElement: document.activeElement
          ? {
              tagName: String(document.activeElement.tagName || '').slice(
                0,
                32,
              ),
              id: String(document.activeElement.id || '').slice(0, 96),
              className: String(document.activeElement.className || '').slice(
                0,
                160,
              ),
            }
          : null,
      };
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove, true);
      delete window.__gevVisualPresentationBoundary;
    },
  };
}

/** Compare the layout/scroll inputs relevant to the CCTV scrollbar pixels. */
export function visualReadinessInputsMatch(
  expected,
  actual,
  expectedPointer = { x: 1, y: 1 },
) {
  const finiteFields = (value, fields) =>
    value && fields.every((field) => Number.isFinite(value[field]));
  const validContainers = (value) => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some(
        (item, index) =>
          item?.id !==
          ['cctv-panel', 'cctv-panel-inner', 'cctv-cyber-panel-body'][index],
      )
    )
      return false;
    if (value[0].present !== true || value[1].present !== true) return false;
    return value.every((item) => {
      if (typeof item.present !== 'boolean') return false;
      if (!item.present) return true;
      return (
        finiteFields(item.rect, [
          'left',
          'top',
          'right',
          'bottom',
          'width',
          'height',
        ]) &&
        finiteFields(item.scroll, [
          'left',
          'top',
          'width',
          'height',
          'clientWidth',
          'clientHeight',
          'offsetWidth',
          'offsetHeight',
        ]) &&
        ['display', 'visibility', 'overflowX', 'overflowY'].every(
          (field) => typeof item.computed?.[field] === 'string',
        ) &&
        typeof item.computed?.scrollbarGutter === 'string' &&
        typeof item.computed?.scrollbarWidth === 'string'
      );
    });
  };
  return Boolean(
    validContainers(expected?.scrollContainers) &&
    validContainers(actual?.scrollContainers) &&
    JSON.stringify(expected.scrollContainers) ===
      JSON.stringify(actual.scrollContainers) &&
    Number.isFinite(expectedPointer?.x) &&
    Number.isFinite(expectedPointer?.y) &&
    expected?.pointer?.x === expectedPointer.x &&
    expected?.pointer?.y === expectedPointer.y &&
    actual?.pointer?.x === expectedPointer.x &&
    actual?.pointer?.y === expectedPointer.y &&
    expected?.pointer?.pointerType === 'mouse' &&
    actual?.pointer?.pointerType === 'mouse' &&
    expected?.activeElement &&
    actual?.activeElement &&
    typeof expected.activeElement.tagName === 'string' &&
    typeof expected.activeElement.id === 'string' &&
    typeof expected.activeElement.className === 'string' &&
    JSON.stringify(expected.activeElement) ===
      JSON.stringify(actual.activeElement),
  );
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

export function presentationStayedSettled(
  before,
  after,
  expectedHudVisible = true,
) {
  const settledHud = (value) =>
    value?.hudVisible === expectedHudVisible &&
    value?.hudDisplay !== 'none' &&
    value?.hudVisibility === (expectedHudVisible ? 'visible' : 'hidden') &&
    Number.isFinite(value?.hudOpacity) &&
    (expectedHudVisible
      ? value.hudOpacity >= 0.999
      : value.hudOpacity <= 0.001);
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
    after.documentFocused === true &&
    visualReadinessInputsMatch(before, after) &&
    settledHud(before) &&
    settledHud(after)
  );
}
