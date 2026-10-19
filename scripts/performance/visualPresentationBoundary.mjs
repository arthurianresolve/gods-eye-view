/** Observe the real HUD phase without freezing timers or changing painted output. */
export function installVisualPresentationBoundaryInPage() {
  const root = document.getElementById('intel-hud');
  if (!root || window.__gevVisualPresentationBoundary)
    throw new Error('Visual presentation observer cannot be installed.');
  let revision = 0;
  let pointer = null;
  let pointerMoveSequence = 0;
  let resetSequence = 0;
  let expectedGaze = null;
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
    pointerMoveSequence++;
    pointer = {
      x: event.clientX,
      y: event.clientY,
      pointerType: String(event.pointerType || 'mouse').slice(0, 16),
    };
  };
  const onGazeReset = () => {
    resetSequence = pointerMoveSequence;
  };
  window.addEventListener('pointermove', onPointerMove, {
    capture: true,
    passive: true,
  });
  window.addEventListener('blur', onGazeReset, { capture: true });
  document.documentElement.addEventListener('pointerleave', onGazeReset, {
    capture: true,
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
  const readGaze = () => {
    const allLogos = [...document.querySelectorAll('[data-logo-gaze]')].slice(
      0,
      9,
    );
    const visibleLogos = allLogos
      .map((logo, index) => ({ logo, index }))
      .filter(({ logo }) => {
        const style = getComputedStyle(logo);
        const rect = logo.getBoundingClientRect();
        return (
          logo.getClientRects().length > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity) > 0
        );
      });
    const logos = visibleLogos.slice(0, 8).map(({ logo, index }) => {
      const svg = logo.querySelector('svg');
      const globe = svg?.querySelector('#globe') || null;
      const cage = svg?.querySelector('#globe_cage') || null;
      const rect = logo.getBoundingClientRect();
      const styleOf = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          transform: style.transform,
          filter: style.filter,
          transitionProperty: style.transitionProperty,
          transitionDuration: style.transitionDuration,
          transitionDelay: style.transitionDelay,
          animationName: style.animationName,
          animationDuration: style.animationDuration,
        };
      };
      const image = logo.querySelector('img');
      return {
        id: String(logo.id || '').slice(0, 96),
        key: `logo-${index}`,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        mode: svg ? 'inline-svg' : image ? 'fallback-image' : 'unavailable',
        image: image
          ? {
              complete: image.complete === true,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            }
          : null,
        globeTransform: globe?.getAttribute('transform') || null,
        cageTransform: cage?.getAttribute('transform') || null,
        style: styleOf(logo),
        globeStyle: styleOf(globe),
        cageStyle: styleOf(cage),
      };
    });
    const reducedMotion = Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    );
    const expected = expectedGaze;
    const titleBar = document.getElementById('title-bar');
    const badge = document.getElementById('cctv-source-badge');
    const cctvPanel = document.getElementById('cctv-panel');
    const cctvInner = cctvPanel?.querySelector('.cctv-panel-inner') || null;
    const cyberBody =
      cctvInner?.querySelector('.cyber-panel-body') ||
      cctvPanel?.querySelector('.cyber-panel-body') ||
      null;
    const cctvTargets = [
      ['cctv-panel', cctvPanel],
      ['cctv-panel-inner', cctvInner],
      ['cctv-cyber-panel-body', cyberBody],
    ];
    const cctvEffects = cctvTargets.map(([id, element]) => {
      if (!element) return { id, present: false };
      const style = getComputedStyle(element);
      return {
        id,
        present: true,
        filter: style.filter,
        backdropFilter: style.backdropFilter,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
      };
    });
    const relevantAnimations = document.getAnimations().filter((animation) => {
      const target = animation.effect?.target;
      return (
        target &&
        (visibleLogos.some(
          ({ logo }) => logo === target || logo.contains(target),
        ) ||
          target === titleBar ||
          target === badge ||
          badge?.contains(target) ||
          cctvTargets.some(
            ([, element]) =>
              element && (target === element || element.contains(target)),
          ))
      );
    });
    const activeAnimations = relevantAnimations
      .slice(0, 12)
      .map((animation) => ({
        playState: String(animation.playState).slice(0, 16),
        target: {
          tagName: String(animation.effect?.target?.tagName || '').slice(0, 32),
          id: String(animation.effect?.target?.id || '').slice(0, 96),
        },
      }));
    const titleStyle = titleBar ? getComputedStyle(titleBar) : null;
    const badgeRect = badge?.getBoundingClientRect?.();
    const badgeStyle = badge ? getComputedStyle(badge) : null;
    const ready = Boolean(
      expected &&
      pointer?.x === expected.pointer.x &&
      pointer?.y === expected.pointer.y &&
      pointer?.pointerType === 'mouse' &&
      pointerMoveSequence > resetSequence &&
      allLogos.length <= 8 &&
      logos.length > 0 &&
      expected.logos.length === logos.length &&
      relevantAnimations.length <= 12 &&
      titleStyle &&
      badgeRect &&
      badgeStyle &&
      activeAnimations.every(
        (animation) => animation.playState !== 'running',
      ) &&
      logos.every((logo) => {
        const target = expected.logos.find((item) => item.key === logo.key);
        if (!target) return false;
        if (reducedMotion)
          return (
            logo.mode === 'fallback-image' &&
            logo.image?.complete === true &&
            logo.image.naturalWidth > 0 &&
            logo.image.naturalHeight > 0
          );
        return (
          logo.mode === 'inline-svg' &&
          logo.globeTransform === target.transform &&
          logo.cageTransform === target.transform &&
          JSON.stringify(logo.rect) === JSON.stringify(target.rect)
        );
      }),
    );
    return {
      status: ready
        ? 'ready'
        : allLogos.length > 8
          ? 'logo-bound-exceeded'
          : !logos.length
            ? 'logo-unavailable'
            : pointerMoveSequence <= resetSequence
              ? 'pointer-reset-after-positioning'
              : logos.some((logo) => logo.mode === 'fallback-image') &&
                  !reducedMotion
                ? 'inline-logo-not-ready'
                : 'gaze-not-settled',
      reducedMotion,
      pointerMoveSequence,
      resetSequence,
      expected: expected
        ? {
            pointer: { ...expected.pointer },
            logos: expected.logos.map((item) => ({ ...item })),
          }
        : null,
      logos,
      activeAnimations,
      animationOverflow: relevantAnimations.length > 12,
      titleStyle: titleStyle
        ? {
            filter: titleStyle.filter,
            transitionProperty: titleStyle.transitionProperty,
            transitionDuration: titleStyle.transitionDuration,
            animationName: titleStyle.animationName,
            animationDuration: titleStyle.animationDuration,
          }
        : null,
      cctvEffects,
      sourceBadge:
        badgeRect && badgeStyle
          ? {
              rect: {
                left: badgeRect.left,
                top: badgeRect.top,
                right: badgeRect.right,
                bottom: badgeRect.bottom,
                width: badgeRect.width,
                height: badgeRect.height,
              },
              filter: badgeStyle.filter,
              backdropFilter: badgeStyle.backdropFilter,
              borderRadius: badgeStyle.borderRadius,
              transitionProperty: badgeStyle.transitionProperty,
              transitionDuration: badgeStyle.transitionDuration,
              animationName: badgeStyle.animationName,
            }
          : null,
    };
  };
  window.__gevVisualPresentationBoundary = {
    setExpectedGaze(value) {
      expectedGaze = value;
    },
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
        gaze: readGaze(),
      };
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('blur', onGazeReset, true);
      document.documentElement.removeEventListener(
        'pointerleave',
        onGazeReset,
        true,
      );
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
  const validGaze = (value) => {
    const gaze = value?.gaze;
    return Boolean(
      gaze?.status === 'ready' &&
      gaze.expected?.pointer?.x === expectedPointer?.x &&
      gaze.expected?.pointer?.y === expectedPointer?.y &&
      Number.isSafeInteger(gaze.pointerMoveSequence) &&
      Number.isSafeInteger(gaze.resetSequence) &&
      gaze.pointerMoveSequence > gaze.resetSequence &&
      Array.isArray(gaze.logos) &&
      gaze.logos.length > 0 &&
      gaze.logos.length <= 8 &&
      gaze.logos.every((logo) => {
        if (
          typeof logo.id !== 'string' ||
          typeof logo.key !== 'string' ||
          !finiteFields(logo.rect, ['left', 'top', 'width', 'height']) ||
          logo.rect.width <= 0 ||
          logo.rect.height <= 0
        )
          return false;
        const target = gaze.expected?.logos?.find(
          (item) => item.key === logo.key,
        );
        if (
          !target ||
          JSON.stringify(logo.rect) !== JSON.stringify(target.rect)
        )
          return false;
        if (logo.mode === 'fallback-image')
          return (
            gaze.reducedMotion === true &&
            logo.image?.complete === true &&
            logo.image.naturalWidth > 0 &&
            logo.image.naturalHeight > 0
          );
        if (gaze.reducedMotion === true) return false;
        return (
          logo.mode === 'inline-svg' &&
          typeof logo.globeTransform === 'string' &&
          logo.globeTransform === logo.cageTransform &&
          logo.globeTransform === target?.transform &&
          JSON.stringify(logo.rect) === JSON.stringify(target?.rect)
        );
      }) &&
      Array.isArray(gaze.expected?.logos) &&
      gaze.expected.logos.length === gaze.logos.length &&
      new Set(gaze.logos.map((logo) => logo.key)).size === gaze.logos.length &&
      new Set(gaze.expected.logos.map((logo) => logo.key)).size ===
        gaze.expected.logos.length &&
      Array.isArray(gaze.activeAnimations) &&
      gaze.activeAnimations.length <= 12 &&
      gaze.animationOverflow === false &&
      Array.isArray(gaze.cctvEffects) &&
      gaze.cctvEffects.length === 3 &&
      gaze.cctvEffects.every((effect, index) => {
        if (
          effect.id !==
          ['cctv-panel', 'cctv-panel-inner', 'cctv-cyber-panel-body'][index]
        )
          return false;
        if (!effect.present) return index === 2;
        return [
          'filter',
          'backdropFilter',
          'transitionProperty',
          'transitionDuration',
          'transitionDelay',
          'animationName',
          'animationDuration',
        ].every((field) => typeof effect[field] === 'string');
      }) &&
      gaze.activeAnimations.every(
        (animation) => animation.playState !== 'running',
      ) &&
      gaze.titleStyle &&
      [
        'filter',
        'transitionProperty',
        'transitionDuration',
        'animationName',
        'animationDuration',
      ].every((field) => typeof gaze.titleStyle[field] === 'string') &&
      gaze.sourceBadge &&
      finiteFields(gaze.sourceBadge.rect, [
        'left',
        'top',
        'right',
        'bottom',
        'width',
        'height',
      ]) &&
      [
        'filter',
        'backdropFilter',
        'borderRadius',
        'transitionProperty',
        'transitionDuration',
        'animationName',
      ].every((field) => typeof gaze.sourceBadge[field] === 'string'),
    );
  };
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
    validGaze(expected) &&
    validGaze(actual) &&
    JSON.stringify(expected.gaze) === JSON.stringify(actual.gaze) &&
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

export function readVisibleLogoGazeTargetsInPage() {
  return [...document.querySelectorAll('[data-logo-gaze]')]
    .slice(0, 9)
    .map((logo, index) => ({ logo, index }))
    .filter(({ logo }) => {
      const style = getComputedStyle(logo);
      const rect = logo.getBoundingClientRect();
      return (
        logo.getClientRects().length > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity) > 0
      );
    })
    .map(({ logo, index }) => {
      const rect = logo.getBoundingClientRect();
      return {
        id: String(logo.id || '').slice(0, 96),
        key: `logo-${index}`,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      };
    });
}

export function setExpectedLogoGazeInPage(value) {
  const boundary = window.__gevVisualPresentationBoundary;
  if (!boundary)
    throw new Error('Visual presentation observer is unavailable.');
  boundary.setExpectedGaze(value);
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
