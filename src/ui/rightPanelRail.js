import {
  allocatePanelStackHeights,
  panelStackAutoCollapseIndices,
} from '../panelStackLayout.js';
import {
  resolveHudRailLayout,
  shouldHideCollapsedRightPanels,
} from './panelRailGeometry.js';

import { displayPanelScroller } from './displayPanelScroll.js';

const pendingCollapseRetries = new WeakSet();

function rightRailPanels(stack, getComputedStyle) {
  return [...stack.children].filter(
    (panel) =>
      panel.matches('[data-panel-id]:not(.panel-floating)') &&
      !panel.hidden &&
      ((stack.classList.contains('layout-exclusive') &&
        panel.classList.contains('collapsed')) ||
        getComputedStyle(panel).display !== 'none'),
  );
}

function measuredRightPanels(panels, exclusive) {
  return panels.filter(
    (panel) =>
      !exclusive ||
      !panel.classList.contains('collapsed') ||
      panel.classList.contains('layout-auto-collapsed'),
  );
}

function measureRightHeights(panels) {
  return new Map(
    panels.map((panel) => [
      panel,
      Math.max(
        panel.getBoundingClientRect().height,
        panel.scrollHeight || 0,
        panel.classList.contains('collapsed') ? 42 : 0,
      ),
    ]),
  );
}

function railInputState(node) {
  return [
    node.parentElement,
    node.hidden,
    node.getAttribute('class'),
    node.getAttribute('style'),
    node.getAttribute('aria-hidden'),
  ];
}

/**
 * One synchronous intrinsic snapshot, never retained between callbacks.
 * Tactical desktop roots have independent widths (layers.css #left-panel-stack
 * and #right-context-rail); scenes.css's left allocation/focus/tail selectors
 * affect only left descendants, as do panel-surfaces.css's left rules.
 * This is the current CSS contract, not a generic property of sibling rails.
 * Right obstacle geometry
 * is deliberately NOT captured here and must still be read after left apply.
 * Disclosure/placement/caller mutations invalidate the transaction in its owner.
 */
export function prepareRightRailIntrinsicMeasurement({
  stack,
  windowRef,
  hud,
  getComputedStyle = (element) => windowRef.getComputedStyle(element),
}) {
  if (
    !stack ||
    hud.variant !== 'tactical' ||
    windowRef.matchMedia('(max-width: 720px)').matches ||
    stack.getAttribute('data-rail-measuring') != null
  )
    return null;
  const panels = rightRailPanels(stack, getComputedStyle);
  if (
    !panels.length ||
    panels.some(
      (panel) =>
        panel.classList.contains('layout-auto-collapsed') ||
        panel.classList.contains('cyber-accordion-collapsed'),
    )
  )
    return null;
  const exclusive = panels.some(
    (panel) => !panel.classList.contains('collapsed'),
  );
  if (stack.classList.contains('layout-exclusive') !== exclusive) return null;
  // The ordinary pass normalizes ARIA before measuring. A restored/stale value
  // may also participate in CSS, so do not sample before that write occurs.
  if (
    panels.some((panel) =>
      exclusive && panel.classList.contains('collapsed')
        ? panel.getAttribute('aria-hidden') !== 'true'
        : panel.getAttribute('aria-hidden') != null,
    )
  )
    return null;
  const measuredPanels = measuredRightPanels(panels, exclusive);
  const inputStates = [stack, ...panels].map(railInputState);
  const viewport = [windowRef.innerWidth, windowRef.innerHeight];
  const presentation = [hud.visible, hud.variant];
  const children = [...stack.children];
  const scrollers = [
    ...(stack.querySelectorAll?.('[data-rail-scroller]') || []),
  ]
    .map((node) => [node, node.scrollTop || 0])
    .filter(([, top]) => top > 0);
  let valid = true;
  let naturalHeights;
  return {
    stack,
    measure() {
      naturalHeights = measureRightHeights(measuredPanels);
    },
    restoreScroll() {
      const errors = [];
      for (const [node, top] of scrollers) {
        try {
          if (node.scrollTop !== top) node.scrollTop = top;
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, 'Rail scroll restoration failed');
    },
    invalidate() {
      valid = false;
    },
    take(currentPanels, currentMeasuredPanels, currentHud, currentWindow) {
      const canReuse =
        valid &&
        naturalHeights &&
        viewport[0] === currentWindow.innerWidth &&
        viewport[1] === currentWindow.innerHeight &&
        presentation[0] === currentHud.visible &&
        presentation[1] === currentHud.variant &&
        children.length === stack.children.length &&
        children.every((node, index) => node === stack.children[index]) &&
        panels.length === currentPanels.length &&
        panels.every((node, index) => node === currentPanels[index]) &&
        measuredPanels.length === currentMeasuredPanels.length &&
        measuredPanels.every(
          (node, index) => node === currentMeasuredPanels[index],
        ) &&
        [stack, ...panels].every((node, index) =>
          railInputState(node).every(
            (value, key) => value === inputStates[index][key],
          ),
        );
      valid = false;
      return canReuse ? naturalHeights : null;
    },
  };
}

/**
 * Where the left rail's top will settle, not where it is mid-transition:
 * nothing re-runs this pass when the `top` animation ends (ResizeObserver
 * ignores moves). Returns NaN when there is no left rail.
 */
function settledLeftRailTop(leftStack, viewportHeight, getComputedStyle) {
  const top = leftStack?.getBoundingClientRect().top;
  if (!Number.isFinite(top)) return NaN;
  const transition = leftStack
    .getAnimations?.()
    .find((animation) => animation.transitionProperty === 'top');
  if (!transition) return top;
  const keyframes = transition.effect?.getKeyframes?.() || [];
  const targetTop = parseFloat(keyframes.at(-1)?.top);
  const currentTop = parseFloat(getComputedStyle(leftStack).top);
  // The rect and the computed `top` move together; keep any offset between them.
  if (Number.isFinite(targetTop) && Number.isFinite(currentTop))
    return top + targetTop - currentTop;
  const targetPct = parseFloat(leftStack.dataset?.safeTopPct);
  return Number.isFinite(targetPct) ? (targetPct * viewportHeight) / 100 : top;
}

/**
 * Measure and place the right panel rail for one synchronous layout pass.
 * The caller owns scheduling, obstacle selection, disclosure preferences and
 * persistence. Auto-collapse is presentation only and reports through callbacks.
 * @param {object} options Live DOM and caller policy.
 * @param {HTMLElement} options.stack Rail element.
 * @param {Iterable<HTMLElement>} options.obstacles Caller-selected obstacle nodes.
 * @param {Window} options.windowRef Viewport and style reader.
 * @param {{visible: boolean, variant: string}} options.hud Current HUD presentation.
 * @param {string} options.preferredPanelId Most recently opened panel.
 * @param {Function} options.onCollapse Update a panel's disclosure chrome.
 * @param {Function} options.onRetry Request another pass after automatic collapse.
 * @param {Function} [options.getComputedStyle] Optional DOM style reader override.
 * @param {HTMLElement} options.leftStack Rail supplying the shared top baseline.
 * @param {HTMLElement} options.displayPanel Panel whose allocation owns its scroll.
 * @param {Function} options.readDisplayScrollTop Read the caller's scroll restoration value.
 * @param {Document} [options.documentRef] Document supplying current keyboard focus.
 */
export function layoutRightPanelRail({
  stack,
  obstacles,
  windowRef,
  hud,
  preferredPanelId,
  onCollapse,
  onRetry,
  leftStack,
  displayPanel,
  readDisplayScrollTop,
  intrinsicMeasurement,
  documentRef = stack?.ownerDocument,
  getComputedStyle = (element) => windowRef.getComputedStyle(element),
}) {
  if (!stack) return;
  // A collapse may schedule one follow-up, which only measures and allocates.
  const isCollapseRetry = pendingCollapseRetries.delete(stack);

  // A floating (lifted-out) panel is not laid out by the rail. Neither is one
  // that other CSS hides, such as an event view. Exclusive presentation hides
  // collapsed panels itself; those stay in the rail so they can be restored.
  const panels = rightRailPanels(stack, getComputedStyle);
  if (!hud.visible || hud.variant !== 'tactical') {
    for (const panel of panels.filter((item) =>
      item.classList.contains('layout-auto-collapsed'),
    )) {
      panel.classList.remove('collapsed', 'layout-auto-collapsed');
      onCollapse(panel);
    }
  }
  // Normalize restored state and theme entry without overwriting saved panel
  // preferences. This marker is distinct from Tactical's space-based collapse.
  if (hud.variant === 'cyber') {
    const expanded = panels.filter(
      (panel) => !panel.classList.contains('collapsed'),
    );
    const owner =
      expanded.find((panel) => panel.id === preferredPanelId) ||
      expanded.find((panel) => panel.contains(documentRef?.activeElement)) ||
      expanded[0];
    for (const panel of expanded) {
      if (panel === owner) continue;
      panel.classList.add('collapsed', 'cyber-accordion-collapsed');
      onCollapse(panel);
    }
  } else {
    for (const panel of panels) {
      if (!panel.classList.contains('cyber-accordion-collapsed')) continue;
      panel.classList.remove('collapsed', 'cyber-accordion-collapsed');
      onCollapse(panel);
    }
  }
  const isMobile = windowRef.matchMedia('(max-width: 720px)').matches;
  const hasExpandedPanel = panels.some(
    (panel) =>
      !panel.classList.contains('collapsed') &&
      (!isMobile || panel.id !== 'pp-toggles'),
  );
  const exclusive = shouldHideCollapsedRightPanels({
    hudVariant: hud.variant,
    hasExpandedPanel,
  });
  stack.classList.toggle('layout-exclusive', exclusive);
  for (const panel of panels) {
    if (exclusive && panel.classList.contains('collapsed')) {
      if (panel.getAttribute('aria-hidden') !== 'true')
        panel.setAttribute('aria-hidden', 'true');
    } else if (panel.getAttribute('aria-hidden') != null)
      panel.removeAttribute('aria-hidden');
  }

  if (isMobile) {
    stack.classList.remove('layout-focus');
    for (const property of [
      '--right-stack-safe-top',
      '--right-stack-max-height',
    ])
      if (stack.style.getPropertyValue(property))
        stack.style.removeProperty(property);
    for (const panel of panels)
      if (panel.style.getPropertyValue('--right-panel-allocated-height'))
        panel.style.removeProperty('--right-panel-allocated-height');
    if (stack.dataset.layoutMode !== 'mobile')
      stack.dataset.layoutMode = 'mobile';
    return;
  }

  const viewportHeight = Math.max(1, windowRef.innerHeight);
  const safeGap = Math.max(8, viewportHeight * 0.012);
  const stackRect = stack.getBoundingClientRect();
  const leftStackTop = settledLeftRailTop(
    leftStack,
    viewportHeight,
    getComputedStyle,
  );
  // The rail writes its top at 0.1 CSS-pixel precision below. Use that same
  // coordinate for allocation: a transition target (21.48px) and its settled
  // layout-unit rect (21.46875px) otherwise both write 21.5px but alternate
  // between 494.0px and 494.1px of height in a 537px viewport. That changes the
  // allocation and wakes observers despite an unchanged painted top.
  const alignedTop = Number(
    (Number.isFinite(leftStackTop)
      ? leftStackTop
      : viewportHeight * 0.26
    ).toFixed(1),
  );
  const obstacleRects = [];

  for (const obstacle of obstacles) {
    if (stack.contains(obstacle)) continue;
    let hiddenByAncestor = false;
    for (let element = obstacle; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        hiddenByAncestor = true;
        break;
      }
    }
    if (hiddenByAncestor) continue;
    const rect = obstacle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    obstacleRects.push({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
  }

  // Auto-collapsed headers contribute the same need even when exclusive
  // presentation hides them. Manually collapsed launchers keep their policy.
  const measuredPanels = measuredRightPanels(panels, exclusive);
  const visiblePanels = panels.filter(
    (panel) => !exclusive || !panel.classList.contains('collapsed'),
  );
  const displayScrollTop = readDisplayScrollTop();
  // Measuring lifts each opted-in scroller's max-height, which clamps its
  // scroll offset; remember the offsets to put back afterwards.
  const scrollers = [
    ...(stack.querySelectorAll?.('[data-rail-scroller]') || []),
  ]
    .map((node) => [node, node.scrollTop || 0])
    .filter(([, top]) => top > 0);
  // Measuring does not change the gap. Read it before lifting allocations,
  // avoiding a style/layout read after the constrained presentation returns.
  const gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
  // Remove live height allocations through a synchronous CSS override. Keeping
  // the stored properties intact avoids REMOVE/SET churn on unchanged panels.
  // Do not toggle layout classes here: the class observer schedules new passes.
  let naturalHeights = intrinsicMeasurement?.take(
    panels,
    measuredPanels,
    hud,
    windowRef,
  );
  if (!naturalHeights) {
    stack.setAttribute('data-rail-measuring', '');
    try {
      naturalHeights = measureRightHeights(measuredPanels);
    } finally {
      stack.removeAttribute('data-rail-measuring');
      for (const [node, top] of scrollers)
        if (node.scrollTop !== top) node.scrollTop = top;
    }
  }
  const naturalHeight =
    measuredPanels.reduce(
      (total, panel) => total + naturalHeights.get(panel),
      0,
    ) +
    gap * Math.max(0, measuredPanels.length - 1);
  const layout = resolveHudRailLayout({
    viewportHeight,
    panelHeight: naturalHeight,
    laneLeft: stackRect.left,
    laneRight: stackRect.right,
    obstacles: obstacleRects,
    baseTop: alignedTop,
    baseBottom: viewportHeight * 0.96,
    gap: safeGap,
    align: 'start',
  });
  if (!layout) return;
  const { safeTop, safeBottom, maxHeight: availableHeight } = layout;
  const stabilityBand = Math.max(48, viewportHeight * 0.06);
  const wasFocused = stack.classList.contains('layout-focus');
  const shouldFocus = wasFocused
    ? naturalHeight >= availableHeight - stabilityBand
    : naturalHeight > availableHeight;
  const layoutTop = shouldFocus ? safeTop : layout.top;
  const collapsedHeight = visiblePanels.reduce(
    (total, panel) =>
      panel.classList.contains('collapsed')
        ? total + naturalHeights.get(panel)
        : total,
    0,
  );
  const expandedPanelsInDomOrder = visiblePanels.filter(
    (panel) => !panel.classList.contains('collapsed'),
  );
  const focusedExpandedPanel = expandedPanelsInDomOrder.find((panel) =>
    panel.contains(documentRef.activeElement),
  );
  const preferredExpandedPanel =
    expandedPanelsInDomOrder.find((panel) => panel.id === preferredPanelId) ||
    focusedExpandedPanel;
  // Match the left lane: allocation order follows the latest explicit
  // disclosure, not DOM order. A focused panel is the fallback owner so
  // temporary presentation collapse never strands keyboard focus.
  const expandedPanels = preferredExpandedPanel
    ? [
        preferredExpandedPanel,
        ...expandedPanelsInDomOrder.filter(
          (panel) => panel !== preferredExpandedPanel,
        ),
      ]
    : expandedPanelsInDomOrder;
  const expandedAvailableHeight = Math.max(
    0,
    safeBottom -
      layoutTop -
      collapsedHeight -
      gap * Math.max(0, visiblePanels.length - 1),
  );
  const expandedHeights = allocatePanelStackHeights({
    naturalHeights: expandedPanels.map((panel) => naturalHeights.get(panel)),
    availableHeight: expandedAvailableHeight,
  });
  // Other HUD variants restore automatic collapse at the start of each pass.
  // Do not immediately collapse those panels again and schedule a loop.
  const autoCollapseIndices =
    hud.visible && hud.variant === 'tactical'
      ? panelStackAutoCollapseIndices({
          naturalHeights: expandedPanels.map((panel) =>
            naturalHeights.get(panel),
          ),
          allocatedHeights: expandedHeights,
          collapseLaterPanels: shouldFocus && hud.variant === 'tactical',
        })
      : [];
  if (!isCollapseRetry && autoCollapseIndices.length) {
    for (const index of autoCollapseIndices) {
      const panel = expandedPanels[index];
      panel.classList.add('collapsed', 'layout-auto-collapsed');
      onCollapse(panel);
    }
    pendingCollapseRetries.add(stack);
    onRetry();
    return;
  }
  // Write-if-changed. This pass runs on the 500 ms stats cadence. Rewriting
  // an unchanged allocation wakes the world-overlay occluder observer and
  // defeats parked-idle render savings. Measurement leaves these values intact.
  expandedPanels.forEach((panel, index) => {
    const next = `${expandedHeights[index].toFixed(1)}px`;
    if (
      panel.style.getPropertyValue('--right-panel-allocated-height') !== next
    ) {
      panel.style.setProperty('--right-panel-allocated-height', next);
    }
  });
  for (const panel of panels) {
    if (expandedPanels.includes(panel)) continue;
    if (panel.style.getPropertyValue('--right-panel-allocated-height'))
      panel.style.removeProperty('--right-panel-allocated-height');
  }

  const topValue = `${layoutTop.toFixed(1)}px`;
  const maxHeightValue = `${Math.max(0, safeBottom - layoutTop).toFixed(1)}px`;
  if (stack.style.getPropertyValue('--right-stack-safe-top') !== topValue)
    stack.style.setProperty('--right-stack-safe-top', topValue);
  if (
    stack.style.getPropertyValue('--right-stack-max-height') !== maxHeightValue
  )
    stack.style.setProperty('--right-stack-max-height', maxHeightValue);
  stack.classList.toggle('layout-focus', shouldFocus);
  const metadata = {
    layoutMode: shouldFocus ? 'focus' : 'normal',
    safeTop: layoutTop.toFixed(1),
    safeBottom: safeBottom.toFixed(1),
    availableHeight: availableHeight.toFixed(1),
    requiredHeight: naturalHeight.toFixed(1),
    expandedCount: String(expandedPanels.length),
  };
  for (const [key, value] of Object.entries(metadata))
    if (stack.dataset[key] !== value) stack.dataset[key] = value;

  if (displayPanel && expandedPanels.includes(displayPanel)) {
    const scroller = displayPanelScroller(displayPanel);
    const maxScrollTop = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );
    scroller.scrollTop = Math.min(displayScrollTop, maxScrollTop);
  }
}
