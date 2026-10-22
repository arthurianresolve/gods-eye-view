/** Own rail measurement, layout scheduling and dock tray observation. */
import {
  layoutLeftPanelRail,
  layoutRightPanelRail,
  layoutPanelRails,
} from './panelRails.js';
import {
  isRadioPanelPlacementCurrent,
  syncRadioPanelPlacement,
} from './radioPanelPlacement.js';
const COCKPIT_LAYOUT_SETTLE_MS = 240;

function reportedRailBox(entry) {
  const rect = entry?.contentRect;
  const border = entry?.borderBoxSize;
  const content = entry?.contentBoxSize;
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    border?.length !== 1 ||
    content?.length !== 1 ||
    content[0].inlineSize !== rect.width ||
    content[0].blockSize !== rect.height ||
    !Number.isFinite(border[0].inlineSize) ||
    !Number.isFinite(border[0].blockSize) ||
    border[0].inlineSize < rect.width ||
    border[0].blockSize < rect.height
  )
    return null;
  // This proof is limited to the current horizontal-writing Tactical layout.
  // Use physical contentRect dimensions and reject other/fragmented box models.
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderWidth: border[0].inlineSize,
    borderHeight: border[0].blockSize,
  };
}

function settledRailFonts() {
  const fonts = document.fonts;
  if (fonts?.status !== 'loaded' || !fonts[Symbol.iterator]) return null;
  // display:swap can change intrinsic content without a DOM mutation. Compare
  // face identity/status as well, including a load completed between reads.
  // No ready/check call, font load, event listener or layout query is needed.
  return { fonts, faces: [...fonts].map((face) => [face, face.status]) };
}

function sameRailFonts(before, after) {
  return (
    before.fonts === after.fonts &&
    before.faces.length === after.faces.length &&
    before.faces.every(
      ([face, status], index) =>
        face === after.faces[index][0] && status === after.faces[index][1],
    )
  );
}
/**
 * Fixed UI regions that can occupy the left accordion's vertical lane.
 * Rectangles are filtered at runtime for visibility and horizontal overlap,
 * so right-side/center controls do not reduce the lane unless they actually
 * intersect it at the current viewport size.
 */
const LEFT_STACK_OBSTACLE_SELECTOR = [
  '#cockpit-hud .cockpit-topline',
  '#cockpit-hud .cockpit-topline > div',
  '#title-bar',
  '#style-indicator',
  '#top-center-actions',
  '#traffic-sync-chip',
  '#cctv-sync-chip',
  '#intel-hud .hud-top-left',
  '#intel-hud .hud-top-right',
  '#intel-hud .hud-bottom-left',
  '#intel-hud .hud-bottom-right',
  '#intel-hud .hud-top-bar',
  '#intel-hud .hud-bottom-bar',
  '#intel-hud .hud-left-edge',
  '#intel-hud .hud-right-edge',
  '#cockpit-context',
  '#cesium-credits .cesium-credit-logoContainer',
  '#cesium-credits .cesium-credit-textContainer',
  '#location-bar',
  '#control-panel',
  '#gev-voice-control',
  '#pp-toggles',
  '#param-slider-panel',
].join(', ');
/**
 * Fixed UI regions that can occupy the right control lane. Runtime rectangle
 * filtering keeps the rail clear of whichever HUD variant is currently
 * visible without tying the layout to one screen height.
 */
const RIGHT_STACK_OBSTACLE_SELECTOR = [
  '#cockpit-hud .cockpit-topline',
  '#cockpit-hud .cockpit-topline > div',
  '#title-bar',
  '#style-indicator',
  '#top-center-actions',
  '#traffic-sync-chip',
  '#cctv-sync-chip',
  '#intel-hud .hud-top-left',
  '#intel-hud .hud-top-right',
  '#intel-hud .hud-bottom-left',
  '#intel-hud .hud-bottom-right',
  '#intel-hud .hud-top-bar',
  '#intel-hud .hud-bottom-bar',
  '#intel-hud .hud-left-edge',
  '#intel-hud .hud-right-edge',
  '#cockpit-context',
  '#cockpit-signal-stream',
  '#cesium-credits .cesium-credit-logoContainer',
  '#cesium-credits .cesium-credit-textContainer',
  '#command-dock',
  '#gev-voice-control',
].join(', ');
export class PanelLayoutController {
  constructor({
    readHud,
    scheduleCockpitLayout,
    syncPanelCollapseButton,
    readDisplayScrollTop,
  }) {
    this.readHud = readHud;
    this.scheduleCockpitLayout = scheduleCockpitLayout;
    this._syncPanelCollapseButton = syncPanelCollapseButton;
    this.readDisplayScrollTop = readDisplayScrollTop;
    this.destroyed = false;
    this._adaptivePanelSettleTimer = null;
    this._commandDockTrayObserver = null;
    this._leftStackCockpitModeHandler = null;
    this._leftStackCollapsedHeights = new Map();
    this._leftStackHudTransitionHandler = null;
    this._leftStackLayoutFrame = null;
    this._leftStackMutationObserver = null;
    this._leftStackPreferredPanelId = null;
    this._leftStackReconsiderAutoCollapse = false;
    this._leftStackResizeObserver = null;
    this._leftStackResizeBoxes = new WeakMap();
    this._leftStackContentRevision = 0;
    this._leftStackAllocationResponse = null;
    this._rightStackHudTransitionHandler = null;
    this._rightStackLayoutFrame = null;
    this._rightStackMutationObserver = null;
    this._rightStackPreferredPanelId = null;
    this._rightStackReconsiderAutoCollapse = false;
    this._rightStackResizeObserver = null;
    this._cockpitLayoutFrame = null;
    this._cockpitLayoutTimer = null;
    this._leftPanelStack = document.getElementById('left-panel-stack');
    this._rightPanelStack = document.getElementById('right-context-rail');
    this._ppToggles = document.getElementById('pp-toggles');
    this._cctvPanel = document.getElementById('cctv-panel');
    this._weatherPanel = document.getElementById('weather-panel');
    this._recentImageryPanel = document.getElementById('recent-imagery-panel');
    this._streetLevelPanel = document.getElementById('street-level-panel');
    this._sliderPanel = document.getElementById('param-slider-panel');
    this._detectionBtn = document.getElementById('detection-toggle');
  }
  _scheduleAdaptivePanelLayout({ settle = false } = {}) {
    if (this.destroyed) return;
    this._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
    this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
    this.scheduleCockpitLayout();
    if (!settle) return;
    clearTimeout(this._adaptivePanelSettleTimer);
    this._adaptivePanelSettleTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._adaptivePanelSettleTimer = null;
      this._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
      this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
      this.scheduleCockpitLayout();
    }, COCKPIT_LAYOUT_SETTLE_MS);
  }

  _initCommandDockTrayMetrics() {
    if (this.destroyed) return;
    const dock = document.getElementById('command-dock');
    if (!dock) return;
    this._commandDockTrayObserver?.disconnect?.();
    if (typeof ResizeObserver === 'function') {
      this._commandDockTrayObserver = new ResizeObserver(() =>
        this._updateCommandDockTrayStack(),
      );
      dock.querySelectorAll('.dock-popover-content').forEach((tray) => {
        this._commandDockTrayObserver.observe(tray);
      });
    }
    this._updateCommandDockTrayStack();
  }

  _updateCommandDockTrayStack() {
    if (this.destroyed) return;
    const dock = document.getElementById('command-dock');
    if (!dock) return;
    const locationPanel = dock.querySelector(
      '#location-bar.dock-pinned:not(.collapsed)',
    );
    const presetsPanel = dock.querySelector(
      '#control-panel.dock-pinned:not(.collapsed)',
    );
    const locationHeight =
      locationPanel
        ?.querySelector('.dock-popover-content')
        ?.getBoundingClientRect().height || 0;
    const presetsHeight =
      presetsPanel
        ?.querySelector('.dock-popover-content')
        ?.getBoundingClientRect().height || 0;
    const pinnedCount = Number(locationHeight > 0) + Number(presetsHeight > 0);
    const locationHeightPx = Math.ceil(locationHeight);
    const presetsHeightPx = Math.ceil(presetsHeight);
    const topPinnedPanel = dock.querySelector(
      '.dock-pinned-top.dock-pinned:not(.collapsed)',
    );
    const lowerPinnedPanel =
      topPinnedPanel?.id === 'location-bar' ? presetsPanel : locationPanel;
    const lowerPinnedHeight =
      lowerPinnedPanel
        ?.querySelector('.dock-popover-content')
        ?.getBoundingClientRect().height || 0;
    const stackHeight =
      pinnedCount > 1
        ? `calc(${locationHeightPx}px + ${presetsHeightPx}px + 1.2rem)`
        : `${locationHeightPx + presetsHeightPx}px`;
    dock.style.setProperty(
      '--dock-location-pinned-height',
      `${locationHeightPx}px`,
    );
    dock.style.setProperty(
      '--dock-presets-pinned-height',
      `${presetsHeightPx}px`,
    );
    dock.style.setProperty(
      '--dock-lower-pinned-height',
      `${Math.ceil(lowerPinnedHeight)}px`,
    );
    dock.style.setProperty('--dock-pinned-stack-height', stackHeight);
    dock.classList.toggle('dock-has-pinned-tray', pinnedCount > 0);
    dock.classList.toggle('dock-has-two-pinned-trays', pinnedCount > 1);
  }

  _initRightPanelAdaptiveLayout() {
    if (this.destroyed) return;
    const stack = this._rightPanelStack;
    if (!stack || !this._ppToggles) return;

    stack.prepend(this._ppToggles);
    const globalContextPanel = document.getElementById('global-context-panel');
    for (const panel of [
      this._cctvPanel,
      this._weatherPanel,
      this._recentImageryPanel,
      this._streetLevelPanel,
    ]) {
      if (!panel) continue;
      stack.insertBefore(panel, globalContextPanel);
      this._syncPanelCollapseButton(panel);
    }
    if (this._sliderPanel) {
      this._sliderPanel.style.removeProperty('top');
      this._sliderPanel.style.removeProperty('right');
      this._sliderPanel.style.removeProperty('bottom');
      this._sliderPanel.style.removeProperty('left');
      this._sliderPanel.style.removeProperty('max-height');
      const detectionGroup = this._detectionBtn?.closest('.pp-toggle-group');
      if (detectionGroup) detectionGroup.after(this._sliderPanel);
      else this._ppToggles.append(this._sliderPanel);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._rightStackResizeObserver = new ResizeObserver(() => {
        this._scheduleRightPanelLayout();
      });
      this._rightStackResizeObserver.observe(stack);
      for (const panel of [
        this._ppToggles,
        this._cctvPanel,
        this._weatherPanel,
        this._recentImageryPanel,
        this._streetLevelPanel,
        globalContextPanel,
        document.getElementById('radio-panel'),
      ]) {
        if (panel) this._rightStackResizeObserver.observe(panel);
      }
      document
        .querySelectorAll(RIGHT_STACK_OBSTACLE_SELECTOR)
        .forEach((element) => {
          this._rightStackResizeObserver.observe(element);
        });
    }

    if (typeof MutationObserver !== 'undefined') {
      this._rightStackMutationObserver = new MutationObserver(() => {
        this._scheduleRightPanelLayout();
      });
      this._rightStackMutationObserver.observe(stack, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'data-variant'],
      });
      const hud = document.getElementById('intel-hud');
      if (hud) {
        this._rightStackMutationObserver.observe(hud, {
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'hidden', 'data-variant'],
        });
      }
    }

    const transitionHud = document.getElementById('intel-hud');
    if (transitionHud) {
      this._rightStackHudTransitionHandler = (event) => {
        if (
          event.propertyName === 'opacity' ||
          event.propertyName === 'visibility'
        ) {
          this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
        }
      };
      transitionHud.addEventListener(
        'transitionend',
        this._rightStackHudTransitionHandler,
      );
    }

    this._scheduleRightPanelLayout();
  }

  _scheduleRightPanelLayout({ reconsiderAutoCollapse = false } = {}) {
    if (this.destroyed) return;
    if (reconsiderAutoCollapse) this._rightStackReconsiderAutoCollapse = true;
    if (!this._rightPanelStack || this._rightStackLayoutFrame !== null) return;
    const frame = requestAnimationFrame(() => {
      if (this.destroyed || this._rightStackLayoutFrame !== frame) return;
      if (this._tryPendingPanelPair()) return;
      this._rightStackLayoutFrame = null;
      if (this._rightStackReconsiderAutoCollapse) {
        this._rightStackReconsiderAutoCollapse = false;
        for (const panel of this._rightPanelStack.querySelectorAll(
          '.layout-auto-collapsed',
        )) {
          panel.classList.remove('collapsed', 'layout-auto-collapsed');
          this._syncPanelCollapseButton(panel);
        }
      }
      this._syncRightPanelAdaptiveLayout();
    });
    this._rightStackLayoutFrame = frame;
  }

  _syncRightPanelAdaptiveLayout() {
    if (this.destroyed) return;
    syncRadioPanelPlacement(document);
    layoutRightPanelRail(this._rightPanelLayoutOptions());
  }

  _rightPanelLayoutOptions() {
    if (this.destroyed) return { stack: null };
    return {
      stack: this._rightPanelStack,
      obstacles: document.querySelectorAll(RIGHT_STACK_OBSTACLE_SELECTOR),
      windowRef: window,
      hud: this.readHud(),
      preferredPanelId: this._rightStackPreferredPanelId,
      onCollapse: (panel) => this._syncPanelCollapseButton(panel),
      onRetry: () => this._scheduleRightPanelLayout(),
      leftStack: this._leftPanelStack,
      displayPanel: this._ppToggles,
      readDisplayScrollTop: this.readDisplayScrollTop,
    };
  }

  _initLeftPanelAdaptiveLayout() {
    if (this.destroyed) return;
    const stack = this._leftPanelStack;
    if (!stack) return;

    if (typeof ResizeObserver !== 'undefined') {
      let previousRootBox = null;
      this._leftStackResizeObserver = new ResizeObserver((entries) => {
        if (this.destroyed) return;
        const allocationResponse = this._consumeLeftAllocationResponse(entries);
        for (const entry of entries || []) {
          const box = reportedRailBox(entry);
          if (box) this._leftStackResizeBoxes.set(entry.target, box);
          else this._leftStackResizeBoxes.delete(entry.target);
        }
        const entry = entries?.length === 1 ? entries[0] : null;
        const rect = entry?.target === stack ? entry.contentRect : null;
        const rootBox =
          Number.isFinite(rect?.width) &&
          rect.width > 0 &&
          Number.isFinite(rect?.height) &&
          rect.height > 0
            ? { width: rect.width, height: rect.height }
            : null;
        // The left solver uses this root's horizontal extent, not its height.
        // Its top/bottom transition can resize the root without changing any
        // measurement input. Panels, inners and obstacles remain observed, and
        // viewport/DOM/HUD invalidations still schedule their ordinary pass.
        // Current CSS changes the root's x position only with viewport, HUD
        // theme or cockpit changes, which independently invalidate layout.
        // This is that layout contract, not equal width implying equal x.
        // Use the reported physical CSS width, never logical inlineSize or a
        // synchronous layout read. Initial, mixed and ambiguous deliveries
        // retain the full pass and reset this narrow comparison.
        const rootHeightOnly =
          rootBox &&
          previousRootBox &&
          rootBox.width === previousRootBox.width &&
          rootBox.height !== previousRootBox.height;
        previousRootBox = rootBox;
        if (rootHeightOnly || allocationResponse) return;
        this._scheduleLeftPanelLayout();
      });
      this._leftStackResizeObserver.observe(stack);
      stack.querySelectorAll(':scope > [data-panel-id]').forEach((panel) => {
        this._leftStackResizeObserver.observe(panel);
        const inner = [...panel.children].find(
          (child) => !child.classList.contains('panel-glow'),
        );
        if (inner) this._leftStackResizeObserver.observe(inner);
      });
      document
        .querySelectorAll(LEFT_STACK_OBSTACLE_SELECTOR)
        .forEach((element) => {
          this._leftStackResizeObserver.observe(element);
        });
    }

    if (typeof MutationObserver !== 'undefined') {
      this._leftStackMutationObserver = new MutationObserver(() => {
        this._scheduleLeftPanelLayout();
      });
      this._leftStackMutationObserver.observe(stack, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      const hud = document.getElementById('intel-hud');
      if (hud) {
        this._leftStackMutationObserver.observe(hud, {
          attributes: true,
          attributeFilter: ['class', 'data-variant'],
        });
      }
      const credits = document.getElementById('cesium-credits');
      if (credits) {
        this._leftStackMutationObserver.observe(credits, {
          subtree: true,
          childList: true,
        });
      }
    }

    const transitionHud = document.getElementById('intel-hud');
    if (transitionHud) {
      this._leftStackHudTransitionHandler = (event) => {
        if (
          event.propertyName === 'opacity' ||
          event.propertyName === 'visibility'
        ) {
          this._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
          // The Cockpit strip hangs off the HUD's REC readout, so it has to
          // remeasure on the same event: the readout keeps its rect through
          // the whole fade and only stops counting once the HUD has retired.
          this.scheduleCockpitLayout();
        }
      };
      transitionHud.addEventListener(
        'transitionend',
        this._leftStackHudTransitionHandler,
      );
    }

    this._leftStackCockpitModeHandler = () => {
      if (this.destroyed) return;
      // Cockpit mode repositions the peripheral HUD and reveals its own
      // bottom-left context card. Measure after those styles have committed so
      // the accordion remains in the same obstacle-safe lane instead of
      // jumping to a cockpit-specific top anchor.
      this._scheduleLeftPanelLayout();
      if (this._cockpitLayoutFrame !== null)
        cancelAnimationFrame(this._cockpitLayoutFrame);
      this._cockpitLayoutFrame = requestAnimationFrame(() => {
        this._cockpitLayoutFrame = null;
        this._scheduleLeftPanelLayout();
      });
      clearTimeout(this._cockpitLayoutTimer);
      this._cockpitLayoutTimer = setTimeout(() => {
        this._cockpitLayoutTimer = null;
        this._scheduleLeftPanelLayout();
      }, 300);
    };
    window.addEventListener(
      'gev:cockpit-mode-changed',
      this._leftStackCockpitModeHandler,
    );

    this._scheduleLeftPanelLayout();
  }

  _scheduleLeftPanelLayout({ reconsiderAutoCollapse = false } = {}) {
    if (this.destroyed) return;
    this._leftStackContentRevision++;
    this._leftStackAllocationResponse = null;
    if (reconsiderAutoCollapse) this._leftStackReconsiderAutoCollapse = true;
    if (!this._leftPanelStack || this._leftStackLayoutFrame !== null) return;
    const frame = requestAnimationFrame(() => {
      if (this.destroyed || this._leftStackLayoutFrame !== frame) return;
      if (this._tryPendingPanelPair()) return;
      this._leftStackLayoutFrame = null;
      const allocationBefore = this._readLeftAllocationState();
      const revision = this._leftStackContentRevision;
      if (this._leftStackReconsiderAutoCollapse) {
        this._leftStackReconsiderAutoCollapse = false;
        for (const panel of this._leftPanelStack.querySelectorAll(
          '.layout-auto-collapsed',
        )) {
          panel.classList.remove('collapsed', 'layout-auto-collapsed');
          this._syncPanelCollapseButton(panel);
        }
      }
      this._syncLeftPanelAdaptiveLayout();
      this._rememberLeftAllocationResponse(allocationBefore, revision);
    });
    this._leftStackLayoutFrame = frame;
  }

  _tryPendingPanelPair() {
    // Either rail may have been queued first. Consume only these two existing
    // requests, before either measures stale left geometry independently.
    // Disclosure reconsideration retains the ordinary callbacks. The current
    // Tactical desktop widths are independent in layers.css/scenes.css; the
    // paired transaction still reads final right geometry after left applies.
    if (
      this.destroyed ||
      this._leftStackLayoutFrame === null ||
      this._rightStackLayoutFrame === null ||
      this._leftStackReconsiderAutoCollapse ||
      this._rightStackReconsiderAutoCollapse ||
      !window.matchMedia ||
      window.matchMedia('(max-width: 720px)').matches ||
      this.readHud().variant !== 'tactical' ||
      !isRadioPanelPlacementCurrent(document)
    )
      return false;
    cancelAnimationFrame(this._leftStackLayoutFrame);
    cancelAnimationFrame(this._rightStackLayoutFrame);
    this._leftStackLayoutFrame = null;
    this._rightStackLayoutFrame = null;
    try {
      const allocationBefore = this._readLeftAllocationState();
      const revision = this._leftStackContentRevision;
      this._syncPairedPanelAdaptiveLayout();
      this._rememberLeftAllocationResponse(allocationBefore, revision);
    } catch (error) {
      // A failed measurement must not lose the previously owned right request.
      // Requests created during this pass retain their own handles/revisions.
      this._scheduleRightPanelLayout();
      throw error;
    }
    return true;
  }

  _readLeftAllocationState() {
    const stack = this._leftPanelStack;
    if (
      !stack?.classList.contains('layout-focus') ||
      stack.classList.contains('layout-tail') ||
      this.readHud().variant !== 'tactical' ||
      !window.matchMedia ||
      window.matchMedia('(max-width: 720px)').matches
    )
      return null;
    const fonts = settledRailFonts();
    if (!fonts) return null;
    const panels = [...stack.querySelectorAll(':scope > [data-panel-id]')];
    const expanded = panels.filter(
      (panel) => !panel.classList.contains('collapsed'),
    );
    const panel = expanded.length === 1 ? expanded[0] : null;
    const inner =
      panel &&
      [...panel.children].find(
        (child) => !child.classList.contains('panel-glow'),
      );
    const allocation = panel?.style.getPropertyValue(
      '--left-panel-allocated-height',
    );
    if (
      panel?.id !== 'data-panel' ||
      panel.parentElement !== stack ||
      !panel.classList.contains('active') ||
      panel.classList.contains('panel-floating') ||
      !inner?.classList.contains('data-panel-inner') ||
      inner.parentElement !== panel ||
      !/^\d+(?:\.\d+)?px$/.test(allocation) ||
      Number.parseFloat(allocation) <= 0
    )
      return null;
    return {
      stack,
      panel,
      inner,
      panels,
      allocation,
      fonts,
      width: window.innerWidth,
      height: window.innerHeight,
      // No computed style/layout reads. Explicit/DOM/HUD invalidations revoke
      // the revision; these attributes also reject changed placement/overrides.
      attributes: [stack, ...panels, inner].map((node) =>
        ['class', 'style', 'hidden', 'aria-hidden'].map((name) =>
          node.getAttribute(name),
        ),
      ),
    };
  }

  _rememberLeftAllocationResponse(before, revision) {
    if (!before || revision !== this._leftStackContentRevision) return;
    const after = this._readLeftAllocationState();
    if (
      !after ||
      before.panel !== after.panel ||
      before.inner !== after.inner ||
      !sameRailFonts(before.fonts, after.fonts) ||
      before.allocation === after.allocation ||
      ![after.stack, after.panel, after.inner].every((node) =>
        this._leftStackResizeBoxes.has(node),
      )
    )
      return;
    this._leftStackAllocationResponse = { state: after, revision };
  }

  _consumeLeftAllocationResponse(entries) {
    const proof = this._leftStackAllocationResponse;
    // A solve can explain only its next ResizeObserver delivery. Do not turn
    // allocation proportionality into a lasting exemption for content resize.
    this._leftStackAllocationResponse = null;
    if (!proof || proof.revision !== this._leftStackContentRevision)
      return false;
    const state = this._readLeftAllocationState();
    const expected = proof.state;
    if (
      !state ||
      state.panel !== expected.panel ||
      state.inner !== expected.inner ||
      state.width !== expected.width ||
      state.height !== expected.height ||
      state.allocation !== expected.allocation ||
      !sameRailFonts(state.fonts, expected.fonts) ||
      state.panels.length !== expected.panels.length ||
      state.panels.some((panel, index) => panel !== expected.panels[index]) ||
      JSON.stringify(state.attributes) !== JSON.stringify(expected.attributes)
    )
      return false;
    const boxes = new Map();
    for (const entry of entries || []) {
      if (
        ![state.stack, state.panel, state.inner].includes(entry.target) ||
        boxes.has(entry.target)
      )
        return false;
      const box = reportedRailBox(entry);
      const previous = this._leftStackResizeBoxes.get(entry.target);
      if (
        !box ||
        !previous ||
        ['x', 'y', 'width', 'borderWidth'].some(
          (key) => box[key] !== previous[key],
        )
      )
        return false;
      boxes.set(entry.target, box);
    }
    const panel = boxes.get(state.panel);
    const inner = boxes.get(state.inner);
    const root =
      boxes.get(state.stack) || this._leftStackResizeBoxes.get(state.stack);
    const oldPanel = this._leftStackResizeBoxes.get(state.panel);
    const oldInner = this._leftStackResizeBoxes.get(state.inner);
    // scenes.css: the sole expanded focus panel flexes to the root within its
    // owned allocation; its inner has height:100%. layers.css fixes the inner
    // border/padding. Any changed width/inset, intrinsic-only height, obstacle,
    // unknown box or independent invalidation retains the original full pass.
    return !!(
      panel &&
      inner &&
      root &&
      panel.height !== oldPanel.height &&
      panel.height ===
        Math.min(root.height, Number.parseFloat(state.allocation)) &&
      panel.borderHeight === panel.height &&
      inner.borderHeight === panel.height &&
      inner.height - oldInner.height === panel.height - oldPanel.height &&
      inner.borderHeight - inner.height ===
        oldInner.borderHeight - oldInner.height
    );
  }

  _syncLeftPanelAdaptiveLayout() {
    if (this.destroyed) return;
    layoutLeftPanelRail(this._leftPanelLayoutOptions());
  }

  _leftPanelLayoutOptions() {
    return {
      stack: this._leftPanelStack,
      obstacles: document.querySelectorAll(LEFT_STACK_OBSTACLE_SELECTOR),
      windowRef: window,
      hud: this.readHud(),
      preferredPanelId: this._leftStackPreferredPanelId,
      onCollapse: (panel) => this._syncPanelCollapseButton(panel),
      onRetry: () => this._scheduleLeftPanelLayout(),
      collapsedHeights: this._leftStackCollapsedHeights,
      onAligned: () => this._scheduleRightPanelLayout(),
    };
  }

  _syncPairedPanelAdaptiveLayout() {
    if (this.destroyed) return;
    layoutPanelRails({
      left: {
        ...this._leftPanelLayoutOptions(),
        // The right pass below already owns the alignment notification.
        onAligned: undefined,
      },
      readRight: () => this._rightPanelLayoutOptions(),
      syncRightPlacement: () => {
        if (this.destroyed) return false;
        const unchanged = isRadioPanelPlacementCurrent(document);
        syncRadioPanelPlacement(document);
        return unchanged;
      },
    });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const field of [
      '_leftStackLayoutFrame',
      '_rightStackLayoutFrame',
      '_cockpitLayoutFrame',
    ]) {
      if (this[field] !== null) cancelAnimationFrame(this[field]);
      this[field] = null;
    }
    clearTimeout(this._adaptivePanelSettleTimer);
    clearTimeout(this._cockpitLayoutTimer);
    this._adaptivePanelSettleTimer = this._cockpitLayoutTimer = null;
    for (const field of [
      '_commandDockTrayObserver',
      '_leftStackResizeObserver',
      '_leftStackMutationObserver',
      '_rightStackResizeObserver',
      '_rightStackMutationObserver',
    ]) {
      this[field]?.disconnect();
      this[field] = null;
    }
    for (const field of [
      '_leftStackHudTransitionHandler',
      '_rightStackHudTransitionHandler',
    ]) {
      if (this[field])
        document
          .getElementById('intel-hud')
          ?.removeEventListener('transitionend', this[field]);
      this[field] = null;
    }
    if (this._leftStackCockpitModeHandler)
      window.removeEventListener(
        'gev:cockpit-mode-changed',
        this._leftStackCockpitModeHandler,
      );
    this._leftStackCockpitModeHandler = null;
    this._leftStackAllocationResponse = null;
    this._leftStackResizeBoxes = new WeakMap();
  }
}
