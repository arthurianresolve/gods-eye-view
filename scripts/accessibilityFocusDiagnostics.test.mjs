import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessibilityFocusProbe } from './accessibilityFocusDiagnostics.mjs';

function makeHarness() {
  const listeners = new Map();
  const removed = [];
  const makeTarget = (tagName, id, classes = []) => ({
    tagName,
    id,
    classList: {
      contains: (value) => classes.includes(value),
      [Symbol.iterator]: () => classes[Symbol.iterator](),
    },
    value: 'sensitive-value-must-not-appear',
    textContent: 'sensitive text must not appear',
    getAttribute: (name) => (name === 'aria-hidden' ? 'false' : null),
  });
  const panel = makeTarget('ASIDE', 'evidence-panel', ['panel-collapsible']);
  panel.hidden = true;
  panel.classList.contains = (value) =>
    value === 'collapsed' || value === 'panel-collapsible';
  const closeButton = makeTarget('BUTTON', 'evidence-panel-close');
  closeButton.disabled = false;
  const technical = makeTarget('DETAILS', '', ['evidence-panel-technical']);
  technical.open = true;
  const documentRef = {
    activeElement: makeTarget('BUTTON', 'evidence-panel-close'),
    addEventListener(type, listener, capture) {
      listeners.set(type, { listener, capture });
    },
    removeEventListener(type, listener, capture) {
      removed.push({ type, listener, capture });
      listeners.delete(type);
    },
    querySelector(selector) {
      return (
        {
          '#evidence-panel': panel,
          '#evidence-panel-close': closeButton,
          '.evidence-panel-technical': technical,
        }[selector] || null
      );
    },
  };
  const windowRef = {
    document: documentRef,
    performance: { now: () => 20 },
  };
  return {
    documentRef,
    listeners,
    removed,
    windowRef,
    makeTarget,
  };
}

test('focus probe reports bounded target and evidence panel state without content', () => {
  const harness = makeHarness();
  const probe = createAccessibilityFocusProbe(harness.windowRef);
  probe.markPhase('wait-evidence-focus-restoration');
  probe.markControl('#evidence-panel-close');
  const target = harness.makeTarget(
    'BUTTON',
    'close-evidence',
    Array.from({ length: 12 }, (_, index) => `class-${index}`),
  );
  harness.documentRef.activeElement = target;
  harness.listeners.get('focusin').listener({
    target,
    relatedTarget: null,
  });

  const snapshot = probe.snapshot();
  assert.equal(snapshot.phase, 'wait-evidence-focus-restoration');
  assert.equal(snapshot.lastControl, '#evidence-panel-close');
  assert.deepEqual(snapshot.activeElement, {
    tag: 'button',
    id: 'close-evidence',
    classes: Array.from({ length: 8 }, (_, index) => `class-${index}`),
  });
  assert.equal(snapshot.evidencePanel.hidden, true);
  assert.equal(snapshot.evidencePanel.collapsed, true);
  assert.equal(snapshot.evidencePanel.pinned, null);
  assert.equal(snapshot.evidencePanel.ariaHidden, 'false');
  assert.equal(snapshot.evidencePanel.closeButtonDisabled, false);
  assert.equal(snapshot.evidencePanel.technicalDetailsOpen, true);
  assert.equal(snapshot.focusEvents.length, 1);
  assert.equal(snapshot.focusEvents[0].type, 'focusin');
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /sensitive-value|sensitive text/,
  );
  assert.equal('value' in snapshot.focusEvents[0].target, false);
});

test('focus probe bounds event history and removes both listeners on dispose', () => {
  const harness = makeHarness();
  const probe = createAccessibilityFocusProbe(harness.windowRef);
  const target = harness.makeTarget('INPUT', 'private-input');
  for (let index = 0; index < 12; index += 1) {
    harness.documentRef.activeElement = target;
    harness.listeners.get('focusin').listener({ target, relatedTarget: null });
  }
  assert.equal(probe.snapshot().focusEventsTruncated, false);
  for (let index = 0; index < 8; index += 1)
    harness.listeners.get('focusin').listener({ target, relatedTarget: null });
  const snapshot = probe.snapshot();
  assert.equal(snapshot.focusEvents.length, 12);
  assert.equal(snapshot.focusEventsTruncated, true);
  probe.dispose();
  probe.dispose();
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.removed.length, 2);
  assert.equal(harness.windowRef.__qaAccessibilityFocus, undefined);
});
