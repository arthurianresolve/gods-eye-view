import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const INTERACTION_EVENT_TIMING_PLAN_V2 = Object.freeze({
  policy: 'trusted-click-event-timing-visible-intent-v2',
  sampleCount: 20,
  durationThresholdMs: 16,
  durationQuantumMs: 8,
  actionDrainMs: 1000,
  nextInputGuardMs: 8,
  maximumEntries: 128,
  maximumObservations: 1024,
  maximumMutationCallbacks: 4096,
  maximumMutationRecords: 65536,
  maximumGeometryProofsPerAction: 2,
});
export const INTERACTION_EVENT_TIMING_PROTOCOL =
  'trusted-click-event-timing-visible-intent-v3';
export const INTERACTION_EVENT_TIMING_PLAN = Object.freeze({
  ...INTERACTION_EVENT_TIMING_PLAN_V2,
  policy: INTERACTION_EVENT_TIMING_PROTOCOL,
  measurementRestoration: 'source-owned-left-rail-render-boundary-v1',
  maximumMutationReasonsPerObservation: 8,
  maximumRenderBoundaryProofsPerAction: 8,
});

// Explicit prospective policy. Observation work is unchanged, and the observer
// keeps its v3 default; old evidence is never implicitly reinterpreted.
export const INTERACTION_EVENT_TIMING_PLAN_V4 = Object.freeze({
  ...INTERACTION_EVENT_TIMING_PLAN,
  policy: 'trusted-click-event-timing-visible-intent-v4',
  feedbackReproof: 'same-intent-current-geometry-raf-or-owned-ro-v1',
});

// A current visible control may move during legitimate panel allocation. V5
// proves current visibility after every uncertainty; it does not claim exact
// restoration, stationary pixels, or an unobserved physical presentation.
// V2–V4 remain immutable acquisition/interpretation contracts.
export const INTERACTION_EVENT_TIMING_PLAN_V5 = Object.freeze({
  ...INTERACTION_EVENT_TIMING_PLAN_V4,
  policy: 'trusted-click-event-timing-visible-intent-v5',
  feedbackReproof: 'same-intent-current-visible-geometry-owned-ro-v2',
});

// Prospective native next-paint latency plus observed acknowledgement
// correctness. DOM observations do not identify the content of a presented
// compositor frame. V2–V5 retain their original continuity requirements.
export const INTERACTION_EVENT_TIMING_PLAN_V6 = Object.freeze({
  ...INTERACTION_EVENT_TIMING_PLAN,
  policy: 'trusted-click-event-timing-observed-acknowledgement-v6',
  semantic:
    'native-next-paint-latency-plus-observed-acknowledgement-correctness',
  acknowledgementProof: 'same-intent-current-visible-natural-raf-v1',
  measurementRestoration: 'not-acquired',
  maximumRenderBoundaryProofsPerAction: 0,
  compositorAttribution: Object.freeze({
    status: 'unavailable',
    reason: 'no-acknowledgement-to-presented-frame-binding',
  }),
});

function eventTimingPlan(policy) {
  return policy === INTERACTION_EVENT_TIMING_PLAN_V2.policy
    ? INTERACTION_EVENT_TIMING_PLAN_V2
    : policy === INTERACTION_EVENT_TIMING_PLAN_V4.policy
      ? INTERACTION_EVENT_TIMING_PLAN_V4
      : policy === INTERACTION_EVENT_TIMING_PLAN_V5.policy
        ? INTERACTION_EVENT_TIMING_PLAN_V5
        : policy === INTERACTION_EVENT_TIMING_PLAN_V6.policy
          ? INTERACTION_EVENT_TIMING_PLAN_V6
          : INTERACTION_EVENT_TIMING_PLAN;
}

/** Old evidence retains the original strict continuity policy. */
export function assertInteractionEventTimingPlan(plan) {
  const expected = eventTimingPlan(plan?.policy);
  assert.deepEqual(plan, expected);
  return expected;
}

/** Serialized into the page. It observes native input; it never creates input. */
export function installInteractionEventTimingInPage(options = {}) {
  if (window.__qualificationEventTiming)
    throw new Error('Qualification Event Timing already owned');
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (name) => !['policy', 'instrumentationWarmupActions'].includes(name),
    )
  )
    throw new Error('Event Timing installer options are invalid');
  const instrumentationWarmupActions =
    options.instrumentationWarmupActions ?? 0;
  if (![0, 2].includes(instrumentationWarmupActions))
    throw new Error('Event Timing installer instrumentation warmup is invalid');
  const actionLimit = 20 + instrumentationWarmupActions;
  const policy = Object.hasOwn(options, 'policy')
    ? options.policy
    : 'trusted-click-event-timing-visible-intent-v3';
  const currentGeometryPolicy =
    policy === 'trusted-click-event-timing-visible-intent-v5';
  const observedAcknowledgementPolicy =
    policy === 'trusted-click-event-timing-observed-acknowledgement-v6';
  const freshReproofPolicy =
    policy === 'trusted-click-event-timing-visible-intent-v4' ||
    currentGeometryPolicy;
  if (
    policy !== 'trusted-click-event-timing-visible-intent-v3' &&
    !freshReproofPolicy &&
    !observedAcknowledgementPolicy
  )
    throw new Error('Event Timing installer policy is unsupported');
  const selector = '[data-layer-id="local-datacenters"] .data-toggle-btn';
  const button = document.querySelector(selector);
  if (!button) throw new Error('Event Timing control is missing');
  const layoutRoot = button.closest('#left-panel-stack');
  if (!layoutRoot)
    throw new Error('Event Timing control layout root is missing');
  const manager = window.__godsEyeView?.dataManager;
  if (
    typeof MutationObserver !== 'function' ||
    (!observedAcknowledgementPolicy && typeof ResizeObserver !== 'function') ||
    typeof manager?.subscribeVisibilityRequests !== 'function'
  )
    throw new Error(
      'Event Timing needs owned geometry and intent continuity observers',
    );
  const supported =
    typeof PerformanceObserver === 'function' &&
    PerformanceObserver.supportedEntryTypes?.includes('event') === true;
  const installedAtMs = performance.now();
  const actions = [];
  const entries = [];
  const observations = [];
  let overflow = false;
  let disposed = false;
  let timer = null;
  let settleDrain = null;
  let performanceObserver = null;
  let mutationObserver = null;
  let renderBoundaryObserver = null;
  let pendingRenderBoundary = null;
  let removeIntent = null;
  const removers = [];
  const work = {
    mutationCallbacks: 0,
    mutationRecords: 0,
    continuityChecks: 0,
    geometryChecks: 0,
    restoredMeasurementTransactions: 0,
    renderBoundaryArms: 0,
    renderBoundaryCallbacks: 0,
    overhead: { status: 'unavailable', reason: 'not-measured' },
  };
  const active = () => actions.at(-1);
  function failOverflow() {
    overflow = true;
    renderBoundaryObserver?.disconnect();
    pendingRenderBoundary = null;
  }
  function observe(value) {
    if (observations.length >= 1024) {
      failOverflow();
      return;
    }
    const observation = { atMs: performance.now(), ...value };
    observations.push(observation);
    return observation;
  }
  // These are the exact presentation classes owned by LayerPanel. Unknown
  // styling cannot inherit the first RAF's visibility proof.
  const buttonClasses = new Set([
    'data-toggle-btn',
    'active',
    'transitioning',
    'enabling',
    'disabling',
    'feed-nominal',
    'feed-loading',
    'feed-degraded',
    'feed-stale',
    'feed-partial',
    'feed-fallback',
    'feed-unavailable',
  ]);
  function knownClasses(value) {
    const classes = (value || '').trim().split(/\s+/);
    return (
      classes.includes('data-toggle-btn') &&
      classes.every((name) => buttonClasses.has(name))
    );
  }
  function geometryClasses(value) {
    // radio.css's active rules change only paint. Status/feed classes and text
    // can change widths or adjacent counts, so they cannot share this exemption.
    return (value || '')
      .trim()
      .split(/\s+/)
      .filter((name) => name !== 'active')
      .sort()
      .join(' ');
  }
  function buttonIntentStateMatches(action) {
    work.continuityChecks++;
    const layer = manager?.layers?.get?.('local-datacenters');
    const transition = action.expected ? 'enabling' : 'disabling';
    return Boolean(
      button.isConnected === true &&
      document.querySelector(selector) === button &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      button.disabled === false &&
      button.textContent.trim().length > 0 &&
      button.children.length === 0 &&
      knownClasses(button.getAttribute('class')) &&
      layer?.visibilityIntentEpoch === action.witness?.intentEpoch &&
      layer?.visibilityIntentEnabled === action.expected &&
      ((button.dataset?.feedState === transition &&
        button.classList.contains('transitioning') &&
        button.classList.contains(transition) &&
        button.getAttribute('aria-busy') === 'true' &&
        button.getAttribute('aria-disabled') === 'true') ||
        (manager?.isEnabled('local-datacenters') === action.expected &&
          button.classList.contains('active') === action.expected &&
          !button.classList.contains('transitioning'))),
    );
  }
  function buttonGeometryMatches(action, result) {
    work.geometryChecks++;
    if (
      !buttonIntentStateMatches(action) ||
      typeof button.checkVisibility !== 'function' ||
      !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return false;
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    const clip = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(window.innerWidth, rect.right),
      bottom: Math.min(window.innerHeight, rect.bottom),
    };
    const scrollOffsets = [];
    for (
      let ancestor = button.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      if (scrollOffsets.length >= 64) return false;
      const offset = {
        left: ancestor.scrollLeft,
        top: ancestor.scrollTop,
      };
      if (!Object.values(offset).every(Number.isFinite)) return false;
      scrollOffsets.push(offset);
      if (
        ancestorStyle.display === 'none' ||
        ['hidden', 'collapse'].includes(ancestorStyle.visibility) ||
        Number(ancestorStyle.opacity) === 0 ||
        ancestorStyle.contentVisibility === 'hidden'
      )
        return false;
      const parentRect = ancestor.getBoundingClientRect();
      if (
        ['hidden', 'clip', 'scroll', 'auto'].includes(ancestorStyle.overflowX)
      ) {
        clip.left = Math.max(clip.left, parentRect.left);
        clip.right = Math.min(clip.right, parentRect.right);
      }
      if (
        ['hidden', 'clip', 'scroll', 'auto'].includes(ancestorStyle.overflowY)
      ) {
        clip.top = Math.max(clip.top, parentRect.top);
        clip.bottom = Math.min(clip.bottom, parentRect.bottom);
      }
    }
    const center = {
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2,
    };
    const visible =
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) > 0 &&
      button.disabled === false &&
      button.textContent.trim().length > 0 &&
      center.x >= clip.left &&
      center.x < clip.right &&
      center.y >= clip.top &&
      center.y < clip.bottom;
    result.geometry = {
      controlRect: Object.fromEntries(
        ['left', 'top', 'right', 'bottom', 'width', 'height'].map((key) => [
          key,
          rect[key],
        ]),
      ),
      clipRect: clip,
      scrollOffsets,
    };
    return Boolean(visible);
  }
  function mutationTarget(target) {
    if (target === button) return 'control';
    if (target === layoutRoot) return 'layout-root';
    if (
      target?.parentElement === layoutRoot &&
      ['data-panel', 'cctv-panel', 'scene-panel'].includes(target.id) &&
      target.getAttribute('data-panel-id') === target.id
    )
      return 'left-panel';
    return 'other';
  }
  function restoredMeasurement(target, name, changes) {
    const changed = changes.filter(({ before, after }) => before !== after);
    if (changed.length < 2) return false;
    const initial = changed.at(-1).before,
      final = changed[0].after;
    if (initial !== final) return false;
    // Recognize only the two source-owned intrinsic-height measurements.
    // Even a complete restoration can clamp scroll offsets, so recognition
    // requests a post-layout proof; it never proves geometry by itself.
    if (target === layoutRoot && name === 'data-rail-measuring')
      return (
        initial === null &&
        changed.every(({ before, after }) =>
          [before, after].every((value) => value === null || value === ''),
        )
      );
    if (
      name !== 'style' ||
      mutationTarget(target) !== 'left-panel' ||
      !target.classList ||
      target.classList.contains('collapsed') ||
      target.classList.contains('panel-floating')
    )
      return false;
    const allocationOnly = (value) =>
      value === null ||
      value === '' ||
      (typeof value === 'string' &&
        value.length <= 256 &&
        /^\s*--left-panel-allocated-height\s*:\s*\d+(?:\.\d+)?px\s*;?\s*$/.test(
          value,
        ));
    return changed.every(
      ({ before, after }) => allocationOnly(before) && allocationOnly(after),
    );
  }
  function requestRenderBoundary(action, observation) {
    if (
      observedAcknowledgementPolicy ||
      !observation ||
      disposed ||
      overflow ||
      action.drainEndedAtMs !== null
    )
      return;
    if (
      freshReproofPolicy &&
      (currentGeometryPolicy ||
        observation.mutation.reasonCount !==
          observation.mutation.restoredMeasurementTransactions) &&
      (action.witnesses.some((proof) => !proof.visible || !proof.focused) ||
        action.renderBoundaryProofs.some(
          (proof) =>
            !proof.visible ||
            !proof.focused ||
            (!currentGeometryPolicy && proof.restoredGeometry === false),
        ) ||
        observations.some(
          (prior) =>
            prior.generation === action.generation &&
            prior.invalid &&
            ['foreground', 'contrary-intent', 'contrary-button-state'].includes(
              prior.kind,
            ),
        ))
    )
      return;
    if (pendingRenderBoundary) {
      pendingRenderBoundary.sourceMutationCallback =
        observation.mutation.callback;
      return;
    }
    if (action.renderBoundaryArms >= 8) {
      failOverflow();
      return;
    }
    const prior = [
      ...action.witnesses.map((proof, index) => ({
        proof,
        kind: 'raf',
        ordinal: index + 1,
      })),
      ...action.renderBoundaryProofs.map((proof) => ({
        proof,
        kind: 'resize-observer-initial',
        ordinal: proof.ordinal,
      })),
    ]
      .filter(({ proof }) => proof.completedAtMs <= observation.atMs)
      .sort((a, b) => a.proof.completedAtMs - b.proof.completedAtMs)
      .at(-1);
    // A negative or incomplete prior proof cannot be skipped to obtain a
    // convenient baseline. Its geometry remains unproven.
    if (
      !prior?.proof.visible ||
      !prior.proof.focused ||
      !prior.proof.geometry ||
      (!currentGeometryPolicy && prior.proof.restoredGeometry === false)
    )
      return;
    action.renderBoundaryArms++;
    work.renderBoundaryArms++;
    pendingRenderBoundary = {
      generation: action.generation,
      ordinal: action.renderBoundaryArms,
      armedAtMs: performance.now(),
      armedByMutationCallback: observation.mutation.callback,
      sourceMutationCallback: observation.mutation.callback,
      baseline: { kind: prior.kind, ordinal: prior.ordinal },
      baselineGeometry: prior.proof.geometry,
    };
    try {
      // A new observation has no reported size, so its initial notification
      // follows natural style/layout even if the button's size is unchanged.
      // No RAF, task, render request or geometry read occurs in this microtask.
      renderBoundaryObserver.observe(button, { box: 'border-box' });
    } catch {
      failOverflow();
    }
  }
  function observeRenderBoundary(entries) {
    if (disposed || overflow) return;
    // An earlier rendering observer may have changed the DOM. Classify all
    // pending records first; v4 needs a complete positive current-state read
    // to reprove uncertainty, while v3 retains its source-only recovery.
    const pendingMutations = mutationObserver?.takeRecords() || [];
    if (pendingMutations.length) observeMutations(pendingMutations);
    const pending = pendingRenderBoundary;
    pendingRenderBoundary = null;
    renderBoundaryObserver.unobserve(button);
    const action = active();
    work.renderBoundaryCallbacks++;
    if (
      !pending ||
      !action ||
      pending.generation !== action.generation ||
      action.drainEndedAtMs !== null ||
      entries.length !== 1 ||
      entries[0].target !== button ||
      work.renderBoundaryCallbacks > 160
    ) {
      failOverflow();
      return;
    }
    const { baselineGeometry, ...identity } = pending;
    const proof = {
      ...identity,
      kind: 'resize-observer-initial',
      observedThroughMutationCallback: work.mutationCallbacks,
      atMs: performance.now(),
      intentEpoch: action.witness.intentEpoch,
      expected: action.expected,
      state: button.classList.contains('transitioning')
        ? 'transition'
        : 'settled',
      focused: document.hasFocus(),
      geometry: null,
    };
    proof.visible = buttonGeometryMatches(action, proof);
    proof.restoredGeometry =
      proof.geometry !== null &&
      JSON.stringify(proof.geometry) === JSON.stringify(baselineGeometry);
    proof.completedAtMs = performance.now();
    action.renderBoundaryProofs.push(proof);
  }
  function observeMutations(records) {
    if (disposed || overflow) return;
    work.mutationCallbacks++;
    if (
      work.mutationCallbacks > 4096 ||
      records.length > 65536 - work.mutationRecords
    ) {
      failOverflow();
      mutationObserver?.disconnect();
      return;
    }
    work.mutationRecords += records.length;
    const action = active();
    if (!action?.witness) return;
    // Mutation delivery is a microtask. No geometry/style/visibility API may
    // run here: that would force layout inside the measured click interval.
    let uncertain = false,
      restored = 0,
      reasonCount = 0;
    const reasons = [];
    const note = (target, name, reason) => {
      reasonCount++;
      if (reasons.length < 8)
        reasons.push({
          target: mutationTarget(target),
          attribute: [
            'class',
            'style',
            'data-rail-measuring',
            'data-feed-state',
            'aria-busy',
            'aria-disabled',
            'aria-label',
            'title',
          ].includes(name)
            ? name
            : name == null
              ? 'none'
              : 'other',
          reason,
        });
    };
    const afterByNode = new Map();
    const attributeChanges = new Map();
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index];
      if (record.type === 'attributes') {
        let afterByName = afterByNode.get(record.target);
        if (!afterByName) {
          afterByName = new Map();
          afterByNode.set(record.target, afterByName);
        }
        const name = record.attributeName;
        const after = afterByName.has(name)
          ? afterByName.get(name)
          : record.target.getAttribute(name);
        afterByName.set(name, record.oldValue);
        let groups = attributeChanges.get(record.target);
        if (!groups) {
          groups = new Map();
          attributeChanges.set(record.target, groups);
        }
        let changes = groups.get(name);
        if (!changes) {
          changes = [];
          groups.set(name, changes);
        }
        changes.push({ before: record.oldValue, after });
      } else if (record.type === 'childList') {
        // Only identical plain text replacement preserves layout inputs.
        // Even a known status transition can change width or clipping.
        const plainText = [...record.addedNodes, ...record.removedNodes].every(
          (node) => node.nodeType === 3,
        );
        const unchangedText =
          plainText &&
          [...record.addedNodes].map((node) => node.data).join('') ===
            [...record.removedNodes].map((node) => node.data).join('');
        if (!unchangedText) {
          uncertain = true;
          note(record.target, null, 'child-list');
        }
      } else if (record.type === 'characterData') {
        const after = afterByNode.has(record.target)
          ? afterByNode.get(record.target)
          : record.target.data;
        afterByNode.set(record.target, record.oldValue);
        if (record.oldValue !== after) {
          uncertain = true;
          note(record.target, null, 'text-changed');
        }
      } else {
        uncertain = true;
        note(record.target, null, 'unknown-record');
      }
    }
    for (const [target, groups] of attributeChanges)
      for (const [name, changes] of groups) {
        if (changes.every(({ before, after }) => before === after)) continue;
        if (restoredMeasurement(target, name, changes)) {
          restored++;
          note(target, name, 'restored-measurement');
          continue;
        }
        const unsafe =
          target !== button ||
          changes.some(
            ({ before, after }) =>
              before !== after &&
              (name === 'class'
                ? !knownClasses(after) ||
                  geometryClasses(before) !== geometryClasses(after)
                : ![
                    'data-feed-state',
                    'aria-busy',
                    'aria-disabled',
                    'aria-label',
                    'title',
                  ].includes(name)),
          );
        if (unsafe) {
          uncertain = true;
          note(
            target,
            name,
            changes.at(-1).before === changes[0].after
              ? 'unrecognized-restoration'
              : 'changed-attribute',
          );
        }
      }
    // V4 may arm an owned post-layout proof for a mixed measurement batch.
    // Check only live identity/intent/state here, never geometry or style.
    // V3 retains its unsafe-batch short circuit and original acquisition work.
    const mixedMeasurement =
      freshReproofPolicy &&
      uncertain &&
      (restored > 0 || currentGeometryPolicy);
    const stateMatches = observedAcknowledgementPolicy
      ? buttonIntentStateMatches(action)
      : (uncertain && !mixedMeasurement) || buttonIntentStateMatches(action);
    if (!stateMatches) note(button, null, 'control-state');
    work.restoredMeasurementTransactions += restored;
    if (uncertain || !stateMatches || restored > 0) {
      const observation = observe({
        kind: !stateMatches ? 'contrary-button-state' : 'unproven-geometry',
        generation: action.generation,
        invalid: true,
        reason: 'mutation-batch',
        mutation: {
          callback: work.mutationCallbacks,
          recordCount: records.length,
          restoredMeasurementTransactions: restored,
          reasonCount,
          reasons,
          reasonsTruncated: reasonCount > reasons.length,
        },
      });
      if (
        (!uncertain || mixedMeasurement) &&
        stateMatches &&
        (restored > 0 || (currentGeometryPolicy && uncertain))
      )
        requestRenderBoundary(action, observation);
    }
  }
  function collect(list) {
    if (disposed) return;
    for (const entry of list) {
      if (entry.entryType !== 'event' || entry.name !== 'click') continue;
      if (entries.length >= 128) {
        failOverflow();
        continue;
      }
      const matches = actions.filter(
        (action) =>
          action.clickAtMs === entry.startTime &&
          action.target === entry.target,
      );
      entries.push({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        interactionId: entry.interactionId,
        deliveredAtMs: performance.now(),
        targetMatched: matches.length === 1,
        generation: matches.length === 1 ? matches[0].generation : null,
      });
    }
  }
  const api = {
    registerClick(sample, event) {
      if (disposed || actions.length >= actionLimit)
        throw new Error('Event Timing action ownership exceeded');
      if (active() && active().drainEndedAtMs == null)
        throw new Error('Previous Event Timing action drain is incomplete');
      if (pendingRenderBoundary) {
        failOverflow();
      }
      if (
        event.isTrusted !== true ||
        event.type !== 'click' ||
        event.timeStamp !== sample.clickAtMs ||
        (event.target !== button && !button.contains(event.target))
      )
        throw new Error(
          'Event Timing requires the exact trusted control click',
        );
      actions.push({
        generation: sample.generation,
        clickAtMs: sample.clickAtMs,
        expected: sample.expected,
        target: event.target,
        targetMatched: true,
        trusted: true,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        witness: null,
        witnesses: [],
        renderBoundaryArms: 0,
        renderBoundaryProofs: [],
        renderBoundaryPendingAtDrainEnd: false,
        drainStartedAtMs: null,
        drainEndedAtMs: null,
      });
    },
    witness(sample, timestamp, state, observedAtMs) {
      const action = active();
      if (
        !action ||
        action.generation !== sample.generation ||
        action.witnesses.length >= 2
      )
        return;
      const witness = {
        atMs: observedAtMs,
        rafTimestampMs: timestamp,
        intentEpoch: sample.acceptedIntentEpoch,
        expected: sample.expected,
        state,
        generation: sample.generation,
        visible: true,
        focused: document.hasFocus(),
        geometry: null,
      };
      action.witness ??= witness;
      action.witnesses.push(witness);
      if (!buttonGeometryMatches(action, witness)) witness.visible = false;
      witness.completedAtMs = performance.now();
    },
    drain(generation) {
      const action = active();
      if (
        disposed ||
        timer != null ||
        !action ||
        action.generation !== generation ||
        action.drainStartedAtMs != null
      )
        throw new Error('Event Timing drain ownership mismatch');
      action.drainStartedAtMs = performance.now();
      return new Promise((resolve, reject) => {
        settleDrain = reject;
        timer = setTimeout(() => {
          timer = null;
          settleDrain = null;
          const pendingMutations = mutationObserver?.takeRecords() || [];
          if (pendingMutations.length) observeMutations(pendingMutations);
          collect(performanceObserver?.takeRecords() || []);
          if (pendingRenderBoundary) {
            action.renderBoundaryPendingAtDrainEnd = true;
            renderBoundaryObserver.unobserve(button);
            pendingRenderBoundary = null;
          }
          action.drainEndedAtMs = performance.now();
          resolve();
        }, 1000);
      });
    },
    read() {
      const pendingMutations = mutationObserver?.takeRecords() || [];
      if (pendingMutations.length) observeMutations(pendingMutations);
      collect(performanceObserver?.takeRecords() || []);
      return {
        policy,
        instrumentationWarmupActions,
        ...(observedAcknowledgementPolicy
          ? {
              semantic:
                'native-next-paint-latency-plus-observed-acknowledgement-correctness',
              acknowledgementProof:
                'same-intent-current-visible-natural-raf-v1',
              compositorAttribution: {
                status: 'unavailable',
                reason: 'no-acknowledgement-to-presented-frame-binding',
              },
            }
          : {}),
        ...(freshReproofPolicy
          ? {
              feedbackReproof: currentGeometryPolicy
                ? 'same-intent-current-visible-geometry-owned-ro-v2'
                : 'same-intent-current-geometry-raf-or-owned-ro-v1',
            }
          : {}),
        status: supported ? 'observed' : 'unavailable',
        installedAtMs,
        durationThresholdMs: 16,
        durationQuantumMs: 8,
        actionDrainMs: 1000,
        maximumEntries: 128,
        maximumObservations: 1024,
        maximumMutationCallbacks: 4096,
        maximumMutationRecords: 65536,
        maximumGeometryProofsPerAction: 2,
        measurementRestoration: observedAcknowledgementPolicy
          ? 'not-acquired'
          : 'source-owned-left-rail-render-boundary-v1',
        maximumMutationReasonsPerObservation: 8,
        maximumRenderBoundaryProofsPerAction: observedAcknowledgementPolicy
          ? 0
          : 8,
        work: { ...work, overhead: { ...work.overhead } },
        overflow,
        actions: actions.map(({ target, ...action }) => ({ ...action })),
        entries: entries.map((entry) => ({ ...entry })),
        observations: observations.map((observation) => ({ ...observation })),
      };
    },
    dispose() {
      if (disposed) return;
      collect(performanceObserver?.takeRecords() || []);
      performanceObserver?.disconnect();
      mutationObserver?.disconnect();
      renderBoundaryObserver?.disconnect();
      pendingRenderBoundary = null;
      removeIntent?.();
      for (const remove of removers) remove();
      if (timer != null) clearTimeout(timer);
      timer = null;
      settleDrain?.(new Error('Event Timing disposed during action drain'));
      settleDrain = null;
      disposed = true;
      if (window.__qualificationEventTiming === api)
        delete window.__qualificationEventTiming;
    },
  };
  try {
    if (!observedAcknowledgementPolicy)
      renderBoundaryObserver = new ResizeObserver(observeRenderBoundary);
    if (supported) {
      performanceObserver = new PerformanceObserver((list) =>
        collect(list.getEntries()),
      );
      performanceObserver.observe({
        type: 'event',
        buffered: false,
        durationThreshold: 16,
      });
    }
    for (const name of ['blur', 'focus', 'visibilitychange']) {
      const target = name === 'visibilitychange' ? document : window;
      const listener = (event) => {
        const targetKind =
          event.target === window
            ? 'window'
            : event.target === document
              ? 'document'
              : event.target === button || button.contains(event.target)
                ? 'intended-control'
                : 'other-element';
        observe({
          kind: 'foreground',
          eventType: event.type,
          trusted: event.isTrusted === true,
          targetKind,
          visible: document.visibilityState === 'visible',
          focused: document.hasFocus(),
          invalid:
            document.visibilityState !== 'visible' ||
            !document.hasFocus() ||
            (event.type === 'blur' && targetKind === 'window'),
        });
      };
      target.addEventListener(name, listener, true);
      removers.push(() => target.removeEventListener(name, listener, true));
    }
    for (const name of ['scroll', 'resize']) {
      const listener = () => {
        const action = active();
        if (action?.witness)
          observe({
            kind: 'unproven-geometry',
            generation: action.generation,
            invalid: true,
            reason: name === 'scroll' ? 'window-scroll' : 'window-resize',
          });
      };
      window.addEventListener(name, listener, true);
      removers.push(() => window.removeEventListener(name, listener, true));
    }
    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(observeMutations);
      mutationObserver.observe(layoutRoot, {
        attributes: true,
        attributeOldValue: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      });
      for (
        let ancestor = layoutRoot.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      )
        mutationObserver.observe(ancestor, {
          attributes: true,
          attributeOldValue: true,
          childList: true,
        });
    }
    if (typeof manager?.subscribeVisibilityRequests === 'function')
      removeIntent = manager.subscribeVisibilityRequests((change) => {
        const action = active();
        if (
          action?.witness &&
          change?.layerId === 'local-datacenters' &&
          (change.intentEpoch !== action.witness.intentEpoch ||
            change.enabled !== action.expected)
        )
          observe({
            kind: 'contrary-intent',
            generation: action.generation,
            invalid: true,
          });
      });
    window.__qualificationEventTiming = api;
  } catch (error) {
    api.dispose();
    throw error;
  }
}

function sourceMeasurementOnly(observation) {
  const detail = observation.mutation;
  return Boolean(
    observation.kind === 'unproven-geometry' &&
    observation.invalid === true &&
    detail?.restoredMeasurementTransactions > 0 &&
    detail.reasonCount === detail.restoredMeasurementTransactions &&
    detail.reasons.every((reason) => reason.reason === 'restored-measurement'),
  );
}

function recoverableSourceMeasurement(
  observation,
  freshReproofPolicy,
  currentGeometryPolicy = false,
) {
  return (
    sourceMeasurementOnly(observation) ||
    Boolean(
      freshReproofPolicy &&
      observation.kind === 'unproven-geometry' &&
      observation.invalid === true &&
      observation.mutation &&
      (currentGeometryPolicy ||
        (observation.mutation.restoredMeasurementTransactions > 0 &&
          observation.mutation.reasons.some(
            (reason) => reason.reason === 'restored-measurement',
          ))) &&
      !observation.mutation.reasons.some(
        (reason) => reason.reason === 'control-state',
      ),
    )
  );
}

function assertGeometrySnapshot(proof) {
  if (proof.geometry === null) {
    assert.equal(proof.visible, false);
    return;
  }
  const geometry = proof.geometry;
  assert.deepEqual(
    Object.keys(geometry).sort(),
    ['controlRect', 'clipRect', 'scrollOffsets'].sort(),
  );
  for (const [key, fields] of [
    ['controlRect', ['left', 'top', 'right', 'bottom', 'width', 'height']],
    ['clipRect', ['left', 'top', 'right', 'bottom']],
  ]) {
    assert.deepEqual(Object.keys(geometry[key]).sort(), fields.sort());
    assert.ok(Object.values(geometry[key]).every(Number.isFinite));
  }
  assert.ok(
    Array.isArray(geometry.scrollOffsets) &&
      geometry.scrollOffsets.length > 0 &&
      geometry.scrollOffsets.length <= 64,
  );
  for (const offset of geometry.scrollOffsets) {
    assert.deepEqual(Object.keys(offset).sort(), ['left', 'top']);
    assert.ok(Object.values(offset).every(Number.isFinite));
  }
  if (proof.visible) {
    assert.ok(
      geometry.controlRect.width > 0 && geometry.controlRect.height > 0,
    );
    const center = {
      x: (geometry.controlRect.left + geometry.controlRect.right) / 2,
      y: (geometry.controlRect.top + geometry.controlRect.bottom) / 2,
    };
    assert.ok(
      center.x >= geometry.clipRect.left &&
        center.x < geometry.clipRect.right &&
        center.y >= geometry.clipRect.top &&
        center.y < geometry.clipRect.bottom,
    );
  }
}

/** All entries, including late old entries, are evaluated after the fixed cohort. */
export function validateInteractionEventTiming(
  capture,
  samples,
  { instrumentationWarmupSamples = [] } = {},
) {
  assert.ok(Array.isArray(instrumentationWarmupSamples));
  assert.ok(Array.isArray(samples));
  assert.equal(samples.length, 20);
  assert.ok(
    instrumentationWarmupSamples.length === 0 ||
      instrumentationWarmupSamples.length === 2,
    'Instrumentation warmup must be absent or exactly one ON/OFF pair',
  );
  const allSamples = [...instrumentationWarmupSamples, ...samples];
  const actionCount = allSamples.length;
  const plan = eventTimingPlan(capture?.policy);
  assert.equal(capture?.policy, plan.policy);
  const restoredPolicy = plan !== INTERACTION_EVENT_TIMING_PLAN_V2;
  const currentGeometryPolicy = plan === INTERACTION_EVENT_TIMING_PLAN_V5;
  const observedAcknowledgementPolicy =
    plan === INTERACTION_EVENT_TIMING_PLAN_V6;
  const freshReproofPolicy =
    plan === INTERACTION_EVENT_TIMING_PLAN_V4 || currentGeometryPolicy;
  assert.equal(capture.status, 'observed', 'Browser Event Timing unavailable');
  for (const key of [
    'durationThresholdMs',
    'durationQuantumMs',
    'actionDrainMs',
    'maximumEntries',
    'maximumObservations',
    'maximumMutationCallbacks',
    'maximumMutationRecords',
    'maximumGeometryProofsPerAction',
  ])
    assert.equal(capture[key], plan[key]);
  if (restoredPolicy)
    for (const key of [
      'measurementRestoration',
      'maximumMutationReasonsPerObservation',
      'maximumRenderBoundaryProofsPerAction',
    ])
      assert.equal(capture[key], plan[key]);
  if (freshReproofPolicy)
    assert.equal(capture.feedbackReproof, plan.feedbackReproof);
  if (observedAcknowledgementPolicy) {
    assert.equal(capture.semantic, plan.semantic);
    assert.equal(capture.acknowledgementProof, plan.acknowledgementProof);
    assert.deepEqual(capture.compositorAttribution, plan.compositorAttribution);
  }
  assert.equal(capture.overflow, false);
  assert.equal(
    capture.instrumentationWarmupActions ?? 0,
    instrumentationWarmupSamples.length,
  );
  assert.equal(capture.actions?.length, actionCount);
  if (instrumentationWarmupSamples.length > 0)
    assert.equal(
      capture.entries?.length,
      actionCount,
      'Warmup and measured controls require exactly one entry per action',
    );
  assert.ok(
    capture.entries?.length <= 128 && capture.observations?.length <= 1024,
  );
  assert.ok(Number.isFinite(capture.installedAtMs));
  assert.deepEqual(capture.work?.overhead, {
    status: 'unavailable',
    reason: 'not-measured',
  });
  const boundaryCallbacks = restoredPolicy
    ? capture.work.renderBoundaryCallbacks
    : 0;
  assert.equal(
    capture.work.geometryChecks,
    actionCount * 2 + boundaryCallbacks,
  );
  for (const [key, maximum] of [
    ['mutationCallbacks', 4096],
    ['mutationRecords', 65536],
    [
      'continuityChecks',
      4136 + (restoredPolicy && !observedAcknowledgementPolicy ? 160 : 0),
    ],
  ])
    assert.ok(
      Number.isSafeInteger(capture.work[key]) &&
        capture.work[key] >=
          (key === 'continuityChecks' ? actionCount * 2 : 0) &&
        capture.work[key] <= maximum,
    );
  const mutationByCallback = new Map();
  if (restoredPolicy) {
    for (const key of ['renderBoundaryArms', 'renderBoundaryCallbacks'])
      assert.ok(
        Number.isSafeInteger(capture.work[key]) &&
          capture.work[key] >= 0 &&
          capture.work[key] <=
            plan.maximumRenderBoundaryProofsPerAction * actionCount,
      );
    assert.equal(
      capture.work.renderBoundaryCallbacks,
      capture.work.renderBoundaryArms,
      'Every armed render-boundary proof must finish within its action drain',
    );
    assert.equal(
      capture.actions.reduce(
        (sum, action) => sum + action.renderBoundaryProofs?.length,
        0,
      ),
      boundaryCallbacks,
    );
    assert.equal(
      capture.actions.reduce(
        (sum, action) => sum + action.renderBoundaryArms,
        0,
      ),
      capture.work.renderBoundaryArms,
    );
    assert.ok(
      Number.isSafeInteger(capture.work.restoredMeasurementTransactions) &&
        capture.work.restoredMeasurementTransactions >= 0 &&
        capture.work.restoredMeasurementTransactions <=
          capture.work.mutationRecords / 2,
    );
    let restored = 0;
    for (const observation of capture.observations) {
      if (observation.mutation !== undefined) {
        const detail = observation.mutation;
        assert.equal(observation.reason, 'mutation-batch');
        assert.ok(
          ['unproven-geometry', 'contrary-button-state'].includes(
            observation.kind,
          ),
        );
        assert.equal(observation.invalid, true);
        assert.deepEqual(
          Object.keys(detail).sort(),
          [
            'recordCount',
            'callback',
            'restoredMeasurementTransactions',
            'reasonCount',
            'reasons',
            'reasonsTruncated',
          ].sort(),
        );
        assert.ok(
          Number.isSafeInteger(detail.callback) &&
            detail.callback > 0 &&
            detail.callback <= capture.work.mutationCallbacks &&
            !mutationByCallback.has(detail.callback),
        );
        mutationByCallback.set(detail.callback, observation);
        assert.ok(
          Number.isSafeInteger(detail.recordCount) &&
            detail.recordCount > 0 &&
            detail.recordCount <= 65536,
        );
        assert.ok(
          Number.isSafeInteger(detail.restoredMeasurementTransactions) &&
            detail.restoredMeasurementTransactions >= 0 &&
            detail.restoredMeasurementTransactions <= detail.recordCount / 2,
        );
        assert.ok(
          Number.isSafeInteger(detail.reasonCount) &&
            detail.reasonCount > 0 &&
            detail.reasonCount <= detail.recordCount + 1,
        );
        assert.ok(
          Array.isArray(detail.reasons) &&
            detail.reasons.length === Math.min(detail.reasonCount, 8),
        );
        assert.equal(
          detail.reasonsTruncated,
          detail.reasonCount > detail.reasons.length,
        );
        for (const reason of detail.reasons) {
          assert.deepEqual(
            Object.keys(reason).sort(),
            ['target', 'attribute', 'reason'].sort(),
          );
          assert.ok(
            ['control', 'layout-root', 'left-panel', 'other'].includes(
              reason.target,
            ),
          );
          assert.ok(
            [
              'class',
              'style',
              'data-rail-measuring',
              'data-feed-state',
              'aria-busy',
              'aria-disabled',
              'aria-label',
              'title',
              'none',
              'other',
            ].includes(reason.attribute),
          );
          assert.ok(
            [
              'restored-measurement',
              'unrecognized-restoration',
              'changed-attribute',
              'child-list',
              'text-changed',
              'unknown-record',
              'control-state',
            ].includes(reason.reason),
          );
          if (reason.reason === 'restored-measurement')
            assert.ok(
              (reason.target === 'layout-root' &&
                reason.attribute === 'data-rail-measuring') ||
                (reason.target === 'left-panel' &&
                  reason.attribute === 'style'),
            );
        }
        restored += detail.restoredMeasurementTransactions;
      } else if (observation.kind === 'unproven-geometry')
        assert.ok(
          ['window-scroll', 'window-resize'].includes(observation.reason),
          'Geometry invalidation reason is missing',
        );
    }
    assert.equal(capture.work.restoredMeasurementTransactions, restored);
  }
  if (observedAcknowledgementPolicy) {
    const actionByGeneration = new Map();
    for (const [index, action] of capture.actions.entries()) {
      assert.ok(
        Number.isSafeInteger(action.generation) && action.generation > 0,
      );
      assert.equal(actionByGeneration.has(action.generation), false);
      actionByGeneration.set(action.generation, { action, index });
    }
    for (const observation of capture.observations) {
      if (observation.kind !== 'unproven-geometry') continue;
      assert.equal(observation.invalid, true);
      assert.ok(
        Number.isSafeInteger(observation.generation) &&
          observation.generation > 0,
      );
      const owned = actionByGeneration.get(observation.generation);
      assert.ok(owned, 'Geometry diagnostic has no owned action generation');
      assert.ok(
        Number.isFinite(observation.atMs) &&
          observation.atMs >= owned.action.clickAtMs,
        'Geometry diagnostic precedes its owned click',
      );
      // active() intentionally retains the last action after its drain. Such
      // diagnostic observations may precede registration of the next click.
      // Use receipt time: the next native event can already be queued while
      // the previous action still owns a main-thread mutation delivery.
      const next = allSamples[owned.index + 1];
      if (next)
        assert.ok(
          Number.isFinite(next.clickReceivedAtMs) &&
            observation.atMs <= next.clickReceivedAtMs,
          'Geometry diagnostic outlives its owned action generation',
        );
    }
  }
  const interactionIds = new Set();
  const durations = allSamples.map((sample, index) => {
    const action = capture.actions[index];
    assert.equal(action.generation, sample.generation);
    assert.equal(action.clickAtMs, sample.clickAtMs);
    assert.equal(action.expected, sample.expectedLayerEnabled);
    assert.equal(
      action.expected,
      index % 2 === 0,
      'The predeclared local-control cohort must alternate ON/OFF',
    );
    assert.equal(action.targetMatched, true);
    assert.equal(action.trusted, true);
    assert.equal(action.visible, true);
    assert.equal(action.focused, true);
    assert.ok(capture.installedAtMs <= sample.armedAtMs);
    assert.ok(
      Number.isFinite(action.drainStartedAtMs) &&
        Number.isFinite(action.drainEndedAtMs) &&
        action.drainStartedAtMs >= sample.renderedFrameAtMs &&
        action.drainStartedAtMs >= sample.buttonFeedbackAtMs &&
        action.drainEndedAtMs - action.drainStartedAtMs >= 1000,
      'Each primary action requires its fixed one-second delivery drain',
    );
    if (index > 0)
      assert.ok(
        capture.actions[index - 1].drainEndedAtMs <= sample.pointerDownAtMs,
      );
    const matches = capture.entries.filter(
      (entry) => entry.startTime === sample.clickAtMs,
    );
    assert.equal(
      matches.length,
      1,
      'Exactly one delivered click Event Timing entry is required',
    );
    const entry = matches[0];
    assert.equal(entry.name, 'click');
    assert.equal(entry.entryType, 'event');
    assert.equal(entry.targetMatched, true);
    assert.equal(entry.generation, sample.generation);
    for (const key of [
      'startTime',
      'duration',
      'processingStart',
      'processingEnd',
      'deliveredAtMs',
    ])
      assert.ok(Number.isFinite(entry[key]));
    assert.ok(entry.duration >= 16 && entry.duration % 8 === 0);
    assert.ok(
      Number.isSafeInteger(entry.interactionId) && entry.interactionId > 0,
    );
    assert.equal(
      interactionIds.has(entry.interactionId),
      false,
      'Interaction ID reused',
    );
    interactionIds.add(entry.interactionId);
    const earliestEnd = entry.startTime + entry.duration - 4;
    const latestEnd = entry.startTime + entry.duration + 4;
    assert.ok(
      entry.startTime <= entry.processingStart &&
        entry.processingStart <= sample.clickReceivedAtMs &&
        sample.clickReceivedAtMs <= entry.processingEnd &&
        entry.processingEnd <= latestEnd &&
        entry.deliveredAtMs >= entry.processingEnd &&
        entry.deliveredAtMs >= earliestEnd &&
        entry.deliveredAtMs <= action.drainEndedAtMs,
      'Event Timing chronology or declared delivery drain is invalid',
    );
    assert.equal(action.witnesses?.length, 2);
    assert.deepEqual(action.witness, action.witnesses[0]);
    const expectedFrames = [
      [
        sample.buttonFeedbackFirstFrameAtMs,
        sample.buttonFeedbackFirstRafTimestampMs,
        sample.buttonFeedbackFirstState,
      ],
      [
        sample.buttonFeedbackAtMs,
        sample.buttonFeedbackSecondRafTimestampMs,
        sample.buttonFeedbackState,
      ],
    ];
    for (const [index, proof] of action.witnesses.entries()) {
      assert.equal(proof.generation, sample.generation);
      assert.equal(proof.intentEpoch, sample.acceptedIntentEpoch);
      assert.equal(proof.expected, sample.expectedLayerEnabled);
      assert.equal(typeof proof.visible, 'boolean');
      assert.equal(typeof proof.focused, 'boolean');
      if (restoredPolicy) assertGeometrySnapshot(proof);
      assert.deepEqual(
        [proof.atMs, proof.rafTimestampMs, proof.state],
        expectedFrames[index],
      );
      assert.ok(['transition', 'settled'].includes(proof.state));
      assert.ok(
        Number.isFinite(proof.atMs) &&
          Number.isFinite(proof.rafTimestampMs) &&
          proof.rafTimestampMs <= proof.atMs &&
          Number.isFinite(proof.completedAtMs) &&
          proof.completedAtMs >= proof.atMs &&
          proof.atMs >= sample.acceptedIntentAtMs &&
          proof.atMs >= sample.clickReceivedAtMs,
      );
      if (index > 0)
        assert.ok(
          proof.atMs > action.witnesses[index - 1].atMs &&
            proof.atMs >= action.witnesses[index - 1].completedAtMs &&
            proof.rafTimestampMs > action.witnesses[index - 1].rafTimestampMs,
          'The two existing natural RAF proofs must advance',
        );
    }
    const proofs = action.witnesses.map((proof, index) => ({
      proof,
      kind: 'raf',
      ordinal: index + 1,
    }));
    if (restoredPolicy) {
      assert.ok(
        Number.isSafeInteger(action.renderBoundaryArms) &&
          action.renderBoundaryArms >= 0 &&
          action.renderBoundaryArms <=
            plan.maximumRenderBoundaryProofsPerAction,
      );
      assert.equal(action.renderBoundaryPendingAtDrainEnd, false);
      assert.equal(
        action.renderBoundaryProofs?.length,
        action.renderBoundaryArms,
      );
      for (const [index, proof] of action.renderBoundaryProofs.entries()) {
        assert.equal(proof.kind, 'resize-observer-initial');
        assert.equal(proof.ordinal, index + 1);
        assert.equal(proof.generation, sample.generation);
        assert.equal(proof.intentEpoch, sample.acceptedIntentEpoch);
        assert.equal(proof.expected, sample.expectedLayerEnabled);
        assert.ok(['transition', 'settled'].includes(proof.state));
        for (const field of ['visible', 'focused', 'restoredGeometry'])
          assert.equal(typeof proof[field], 'boolean');
        for (const field of ['armedAtMs', 'atMs', 'completedAtMs'])
          assert.ok(Number.isFinite(proof[field]));
        assert.ok(
          proof.armedAtMs >= action.witnesses[0].completedAtMs &&
            proof.atMs >= proof.armedAtMs &&
            proof.completedAtMs >= proof.atMs &&
            proof.completedAtMs <= action.drainEndedAtMs,
        );
        const armedBy = mutationByCallback.get(proof.armedByMutationCallback);
        const source = mutationByCallback.get(proof.sourceMutationCallback);
        assert.ok(
          Number.isSafeInteger(proof.observedThroughMutationCallback) &&
            proof.observedThroughMutationCallback >=
              proof.sourceMutationCallback &&
            proof.observedThroughMutationCallback <=
              capture.work.mutationCallbacks,
        );
        for (const observation of [armedBy, source]) {
          assert.ok(
            observation &&
              recoverableSourceMeasurement(
                observation,
                freshReproofPolicy,
                currentGeometryPolicy,
              ),
          );
          assert.equal(observation.generation, sample.generation);
          assert.ok(observation.atMs <= proof.atMs);
        }
        assert.ok(
          armedBy.atMs <= proof.armedAtMs &&
            source.mutation.callback >= armedBy.mutation.callback,
        );
        if (freshReproofPolicy)
          assert.equal(
            capture.observations.some(
              (observation) =>
                observation.generation === sample.generation &&
                recoverableSourceMeasurement(
                  observation,
                  true,
                  currentGeometryPolicy,
                ) &&
                observation.mutation.callback > armedBy.mutation.callback &&
                observation.atMs < proof.armedAtMs,
            ),
            false,
            'Render-boundary arm must bind its current measurement callback',
          );
        const coalesced = capture.observations.filter(
          (observation) =>
            observation.generation === sample.generation &&
            recoverableSourceMeasurement(
              observation,
              freshReproofPolicy,
              currentGeometryPolicy,
            ) &&
            observation.mutation.callback >= armedBy.mutation.callback &&
            observation.mutation.callback <=
              proof.observedThroughMutationCallback &&
            observation.atMs <= proof.atMs,
        );
        assert.equal(
          proof.sourceMutationCallback,
          Math.max(
            ...coalesced.map((observation) => observation.mutation.callback),
          ),
          'Render-boundary proof must bind the latest coalesced measurement',
        );
        if (index > 0)
          assert.ok(
            proof.armedAtMs >=
              action.renderBoundaryProofs[index - 1].completedAtMs &&
              proof.armedByMutationCallback >
                action.renderBoundaryProofs[index - 1].sourceMutationCallback,
          );
        assertGeometrySnapshot(proof);
        proofs.push({
          proof,
          kind: 'resize-observer-initial',
          ordinal: proof.ordinal,
        });
      }
      for (const observation of capture.observations)
        if (
          !observedAcknowledgementPolicy &&
          observation.generation === sample.generation &&
          observation.atMs >= sample.clickAtMs &&
          observation.atMs <= latestEnd &&
          (observation.mutation?.restoredMeasurementTransactions > 0 ||
            (currentGeometryPolicy &&
              observation.kind === 'unproven-geometry' &&
              observation.invalid &&
              observation.mutation))
        )
          // v4 reproof concerns the complete current read, not which batch
          // armed it. A recognized measurement still needs a timely owned RO;
          // a later RAF alone never discharges that post-layout obligation.
          // V5 gives every uncertain mutation batch the same owned-RO duty,
          // including child-list-only changes without a recognized transaction.
          assert.ok(
            (freshReproofPolicy
              ? observation.kind === 'unproven-geometry'
              : sourceMeasurementOnly(observation)) &&
              action.renderBoundaryProofs.some(
                (proof) =>
                  (freshReproofPolicy
                    ? proof.observedThroughMutationCallback >=
                      observation.mutation.callback
                    : proof.armedByMutationCallback <=
                        observation.mutation.callback &&
                      proof.sourceMutationCallback >=
                        observation.mutation.callback) &&
                  proof.atMs >= observation.atMs &&
                  proof.completedAtMs <= earliestEnd &&
                  proof.visible &&
                  proof.focused &&
                  (currentGeometryPolicy || proof.restoredGeometry),
              ),
            'Source-owned measurement needs an eligible post-layout proof before rendering',
          );
      proofs.sort((a, b) => a.proof.atMs - b.proof.atMs);
      for (const [index, descriptor] of proofs.entries()) {
        const proof = descriptor.proof;
        if (index > 0)
          assert.ok(
            proof.atMs >= proofs[index - 1].proof.completedAtMs,
            'Geometry proof intervals overlap',
          );
        if (descriptor.kind !== 'resize-observer-initial') continue;
        const armedBy = mutationByCallback.get(proof.armedByMutationCallback);
        const prior = proofs.findLast(
          (candidate) =>
            candidate !== descriptor &&
            candidate.proof.completedAtMs <= armedBy.atMs,
        );
        assert.ok(
          prior?.proof.visible &&
            prior.proof.focused &&
            prior.proof.geometry &&
            (currentGeometryPolicy || prior.proof.restoredGeometry !== false),
          'Render-boundary recovery needs its latest positive premeasurement proof',
        );
        assert.deepEqual(proof.baseline, {
          kind: prior.kind,
          ordinal: prior.ordinal,
        });
        assert.equal(
          proof.restoredGeometry,
          isDeepStrictEqual(proof.geometry, prior.proof.geometry),
          'Restoration must preserve the control rect, clip and scroll offsets',
        );
      }
    }
    const selected = proofs.findLast(
      ({ proof }) => proof.completedAtMs <= earliestEnd,
    );
    const witness = selected?.proof;
    assert.ok(
      witness,
      'Same-intent visible feedback must precede the earliest quantized rendering endpoint',
    );
    assert.ok(
      witness.visible &&
        witness.focused &&
        (currentGeometryPolicy || witness.restoredGeometry !== false),
      'Latest eligible geometry proof does not establish visible feedback',
    );
    for (const { proof } of proofs)
      if (
        proof.atMs >=
          (restoredPolicy ? sample.clickReceivedAtMs : witness.completedAtMs) &&
        proof.atMs <= latestEnd
      )
        assert.ok(
          proof.visible &&
            proof.focused &&
            (currentGeometryPolicy || proof.restoredGeometry !== false),
          'A later geometry proof contradicts visible feedback before rendering',
        );
    for (const observation of capture.observations) {
      assert.ok(Number.isFinite(observation.atMs));
      if (observation.atMs < sample.clickAtMs || observation.atMs > latestEnd)
        continue;
      assert.ok(
        [
          'foreground',
          'contrary-intent',
          'contrary-button-state',
          'unproven-geometry',
        ].includes(observation.kind),
      );
      if (observation.kind === 'foreground')
        assert.ok(
          observation.visible && observation.focused && !observation.invalid,
          'Foreground was lost during click-to-render interval',
        );
      else if (
        (freshReproofPolicy || observedAcknowledgementPolicy) &&
        ['contrary-intent', 'contrary-button-state'].includes(observation.kind)
      )
        assert.equal(
          observation.invalid,
          false,
          'A known contrary intent or button state cannot be erased by reproof',
        );
      else if (
        observedAcknowledgementPolicy &&
        observation.kind === 'unproven-geometry'
      ) {
        // Main-thread mutation/scroll/resize uncertainty cannot identify what
        // a queued compositor frame presented. It remains bounded diagnostic
        // evidence, not an observed negative or a new RO deadline.
      } else if (
        selected.kind === 'resize-observer-initial' &&
        observation.atMs >=
          action.witnesses.findLast(
            (proof) => proof.completedAtMs <= witness.armedAtMs,
          ).completedAtMs &&
        observation.atMs < witness.completedAtMs &&
        observation.invalid
      )
        assert.ok(
          (freshReproofPolicy
            ? observation.kind === 'unproven-geometry' &&
              observation.generation === sample.generation
            : sourceMeasurementOnly(observation)) &&
            observation.atMs <= witness.atMs &&
            (freshReproofPolicy && observation.mutation === undefined
              ? true
              : observation.mutation.callback <=
                witness.observedThroughMutationCallback),
          freshReproofPolicy
            ? 'Fresh render-boundary proof does not cover the invalidation'
            : 'Render-boundary recovery cannot erase an unknown or contrary change',
        );
      else if (observation.atMs >= witness.completedAtMs)
        assert.equal(
          observation.invalid,
          false,
          'Visible feedback or intent changed before rendering',
        );
    }
    const nextInput = allSamples[index + 1]?.pointerDownAtMs;
    if (nextInput != null)
      assert.ok(
        entry.startTime + entry.duration + 8 < nextInput,
        'Event rendering interval overlaps the next input',
      );
    return entry.duration;
  });
  return durations.slice(instrumentationWarmupSamples.length);
}
