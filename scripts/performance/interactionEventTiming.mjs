import assert from 'node:assert/strict';

export const INTERACTION_EVENT_TIMING_PROTOCOL =
  'trusted-click-event-timing-visible-intent-v2';
export const INTERACTION_EVENT_TIMING_PLAN = Object.freeze({
  policy: INTERACTION_EVENT_TIMING_PROTOCOL,
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

/** Serialized into the page. It observes native input; it never creates input. */
export function installInteractionEventTimingInPage() {
  if (window.__qualificationEventTiming)
    throw new Error('Qualification Event Timing already owned');
  const selector = '[data-layer-id="local-datacenters"] .data-toggle-btn';
  const button = document.querySelector(selector);
  if (!button) throw new Error('Event Timing control is missing');
  const layoutRoot = button.closest('#left-panel-stack');
  if (!layoutRoot)
    throw new Error('Event Timing control layout root is missing');
  const manager = window.__godsEyeView?.dataManager;
  if (
    typeof MutationObserver !== 'function' ||
    typeof manager?.subscribeVisibilityRequests !== 'function'
  )
    throw new Error(
      'Event Timing needs owned button and intent continuity observers',
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
  let removeIntent = null;
  const removers = [];
  const work = {
    mutationCallbacks: 0,
    mutationRecords: 0,
    continuityChecks: 0,
    geometryChecks: 0,
    overhead: { status: 'unavailable', reason: 'not-measured' },
  };
  const active = () => actions.at(-1);
  function observe(value) {
    if (observations.length >= 1024) {
      overflow = true;
      return;
    }
    observations.push({ atMs: performance.now(), ...value });
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
  function buttonGeometryMatches(action) {
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
    for (
      let ancestor = button.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const ancestorStyle = window.getComputedStyle(ancestor);
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
    return Boolean(visible);
  }
  function observeMutations(records) {
    if (disposed || overflow) return;
    work.mutationCallbacks++;
    if (
      work.mutationCallbacks > 4096 ||
      records.length > 65536 - work.mutationRecords
    ) {
      overflow = true;
      mutationObserver?.disconnect();
      return;
    }
    work.mutationRecords += records.length;
    const action = active();
    if (!action?.witness) return;
    // Mutation delivery is a microtask. No geometry/style/visibility API may
    // run here: that would force layout inside the measured click interval.
    let uncertain = false;
    const afterByNode = new Map();
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
        if (record.oldValue === after) continue;
        if (record.target !== button) uncertain = true;
        else if (name === 'class')
          uncertain ||=
            !knownClasses(after) ||
            geometryClasses(record.oldValue) !== geometryClasses(after);
        else if (
          ![
            'data-feed-state',
            'aria-busy',
            'aria-disabled',
            'aria-label',
            'title',
          ].includes(name)
        )
          uncertain = true;
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
        if (!unchangedText) uncertain = true;
      } else if (record.type === 'characterData') {
        const after = afterByNode.has(record.target)
          ? afterByNode.get(record.target)
          : record.target.data;
        afterByNode.set(record.target, record.oldValue);
        if (record.oldValue !== after) uncertain = true;
      } else uncertain = true;
    }
    if (uncertain || !buttonIntentStateMatches(action))
      observe({
        kind: uncertain ? 'unproven-geometry' : 'contrary-button-state',
        generation: action.generation,
        invalid: true,
      });
  }
  function collect(list) {
    if (disposed) return;
    for (const entry of list) {
      if (entry.entryType !== 'event' || entry.name !== 'click') continue;
      if (entries.length >= 128) {
        overflow = true;
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
      if (disposed || actions.length >= 20)
        throw new Error('Event Timing action ownership exceeded');
      if (active() && active().drainEndedAtMs == null)
        throw new Error('Previous Event Timing action drain is incomplete');
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
      };
      action.witness ??= witness;
      action.witnesses.push(witness);
      if (!buttonGeometryMatches(action)) witness.visible = false;
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
          collect(performanceObserver?.takeRecords() || []);
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
        policy: 'trusted-click-event-timing-visible-intent-v2',
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

/** All entries, including late old entries, are evaluated after the fixed cohort. */
export function validateInteractionEventTiming(capture, samples) {
  assert.equal(capture?.policy, INTERACTION_EVENT_TIMING_PROTOCOL);
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
    assert.equal(capture[key], INTERACTION_EVENT_TIMING_PLAN[key]);
  assert.equal(capture.overflow, false);
  assert.equal(capture.actions?.length, 20);
  assert.equal(samples?.length, 20);
  assert.ok(
    capture.entries?.length <= 128 && capture.observations?.length <= 1024,
  );
  assert.ok(Number.isFinite(capture.installedAtMs));
  assert.deepEqual(capture.work?.overhead, {
    status: 'unavailable',
    reason: 'not-measured',
  });
  assert.equal(capture.work.geometryChecks, 40);
  for (const [key, maximum] of [
    ['mutationCallbacks', 4096],
    ['mutationRecords', 65536],
    ['continuityChecks', 4136],
  ])
    assert.ok(
      Number.isSafeInteger(capture.work[key]) &&
        capture.work[key] >= (key === 'continuityChecks' ? 40 : 0) &&
        capture.work[key] <= maximum,
    );
  const interactionIds = new Set();
  return samples.map((sample, index) => {
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
    const witness = action.witnesses.findLast(
      (proof) => proof.completedAtMs <= earliestEnd,
    );
    assert.ok(
      witness,
      'Same-intent visible feedback must precede the earliest quantized rendering endpoint',
    );
    assert.ok(
      witness.visible && witness.focused,
      'Latest eligible geometry proof does not establish visible feedback',
    );
    for (const proof of action.witnesses)
      if (proof.atMs >= witness.completedAtMs && proof.atMs <= latestEnd)
        assert.ok(
          proof.visible && proof.focused,
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
      else if (observation.atMs >= witness.completedAtMs)
        assert.equal(
          observation.invalid,
          false,
          'Visible feedback or intent changed before rendering',
        );
    }
    const nextInput = samples[index + 1]?.pointerDownAtMs;
    if (nextInput != null)
      assert.ok(
        entry.startTime + entry.duration + 8 < nextInput,
        'Event rendering interval overlaps the next input',
      );
    return entry.duration;
  });
}
