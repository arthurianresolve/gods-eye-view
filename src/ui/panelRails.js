export { layoutLeftPanelRail } from './leftPanelRail.js';
export { layoutRightPanelRail } from './rightPanelRail.js';
export { measurePanelNaturalHeight } from './panelMeasurement.js';
export {
  resolveHudRailLayout,
  shouldHideCollapsedRightPanels,
} from './panelRailGeometry.js';
export {
  allocatePanelStackHeights,
  panelStackAutoCollapseIndices,
  resolveLeftStackBottomBoundary,
  resolvePanelStackCorridor,
} from '../panelStackLayout.js';
import { layoutLeftPanelRail } from './leftPanelRail.js';
import {
  layoutRightPanelRail,
  prepareRightRailIntrinsicMeasurement,
} from './rightPanelRail.js';

/**
 * Consume an already-requested pair in one synchronous callback. Only intrinsic
 * heights are shared. Both original solvers and the right rail's final left-top,
 * obstacle, width and constrained scroll reads retain left-then-right ordering.
 * There is no cache beyond this call. The controller's read-only scroll getter
 * stays at its original point; disclosure callbacks and placement invalidate.
 */
export function layoutPanelRails({ left, readRight, syncRightPlacement }) {
  let snapshot = null;
  let invalidated = false;
  const invalidate = () => {
    invalidated = true;
    snapshot?.invalidate();
  };
  const callback =
    (fn) =>
    (...args) => {
      invalidate();
      return fn?.(...args);
    };
  layoutLeftPanelRail({
    ...left,
    onCollapse: callback(left.onCollapse),
    onRetry: callback(left.onRetry),
    // A controller-owned pair already includes alignment. A caller supplying
    // its own callback may mutate right inputs, so it gets the full fallback.
    onAligned: left.onAligned ? callback(left.onAligned) : () => {},
    measureIntrinsicHeights(measureLeft) {
      if (!invalidated)
        snapshot = prepareRightRailIntrinsicMeasurement(readRight());
      const stacks = [left.stack, ...(snapshot ? [snapshot.stack] : [])];
      const restored = [];
      const errors = [];
      let heights;
      try {
        for (const stack of stacks) {
          restored.push([stack, stack.getAttribute('data-rail-measuring')]);
          stack.setAttribute('data-rail-measuring', '');
        }
        heights = measureLeft();
        snapshot?.measure();
      } catch (error) {
        errors.push(error);
      } finally {
        for (const [stack, previous] of restored) {
          try {
            if (previous == null) stack.removeAttribute('data-rail-measuring');
            else stack.setAttribute('data-rail-measuring', previous);
          } catch (error) {
            errors.push(error);
          }
        }
        try {
          snapshot?.restoreScroll();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, 'Rail intrinsic restoration failed');
      return heights;
    },
  });
  if (syncRightPlacement && !syncRightPlacement()) invalidate();
  const right = readRight();
  layoutRightPanelRail({
    ...right,
    intrinsicMeasurement: snapshot,
    onCollapse: callback(right.onCollapse),
  });
}
