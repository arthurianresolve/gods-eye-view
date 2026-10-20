import assert from 'node:assert/strict';
import { calculateLogoGaze } from '../../src/logoGaze.js';
import { readVisibleLogoGazeTargetsInPage } from './visualPresentationBoundary.mjs';
import { assertCanonicalPointerHistory } from './canonicalPointerHistory.mjs';

export const FULL_EXTENT_POINTER_SWEEP_POLICY = 'reachable-logo-extents-v1';

export function createFullExtentPointerSweepPlan() {
  const titleRect = { left: 36, top: 32, width: 52, height: 34.8828125 };
  const contract = createFullExtentPointerSweepContract({
    titleRect,
    viewport: { width: 1440, height: 900 },
    logos: [{ id: '', key: 'logo-0', rect: titleRect }],
  });
  return {
    policy: contract.policy,
    coordinatePolicy: contract.coordinatePolicy,
    titleRect,
    viewport: contract.viewport,
    sourceBounds: contract.sourceBounds,
    stages: contract.stages.map(({ id, pointer }) => ({ id, pointer })),
  };
}

export function createFullExtentPointerSweepContract({
  logos,
  titleRect,
  viewport,
  timeoutMs = 5000,
  maximumMutations = 2048,
}) {
  assert.ok(Array.isArray(logos) && logos.length > 0 && logos.length <= 8);
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 15_000,
  );
  assert.ok(
    Number.isInteger(maximumMutations) &&
      maximumMutations >= 1 &&
      maximumMutations <= 4096,
  );
  // This acquisition method was qualified at this native geometry. A different
  // layout needs its own source-derived extrema proof before acquiring pixels.
  assert.deepEqual(titleRect, {
    left: 36,
    top: 32,
    width: 52,
    height: 34.8828125,
  });
  assert.deepEqual(viewport, { width: 1440, height: 900 });
  const center = {
    x: titleRect.left + titleRect.width / 2,
    y: titleRect.top + titleRect.height / 2,
  };
  const points = [
    { x: 0, y: Math.round(center.y) },
    { x: Math.round(center.x), y: 0 },
    { x: viewport.width - 1, y: Math.round(center.y) },
    { x: Math.round(center.x), y: viewport.height - 1 },
  ];
  assert.ok(
    points.every(
      (point) =>
        Number.isInteger(point.x) &&
        Number.isInteger(point.y) &&
        point.x >= 0 &&
        point.x < viewport.width &&
        point.y >= 0 &&
        point.y < viewport.height,
    ),
  );
  const titleOffsets = points.map((point) =>
    calculateLogoGaze(point.x, point.y, titleRect),
  );
  const paintedBounds = {
    minX: Number(((-center.x * 34) / 320).toFixed(2)),
    maxX: 34,
    minY: Number(((-center.y * 34) / 320).toFixed(2)),
    maxY: 34,
  };
  assert.equal(Number(titleOffsets[0].x.toFixed(2)), paintedBounds.minX);
  assert.equal(Number(titleOffsets[1].y.toFixed(2)), paintedBounds.minY);
  assert.equal(Number(titleOffsets[2].x.toFixed(2)), paintedBounds.maxX);
  assert.equal(Number(titleOffsets[3].y.toFixed(2)), paintedBounds.maxY);
  assert.equal(new Set(logos.map((logo) => logo.key)).size, logos.length);
  return {
    policy: FULL_EXTENT_POINTER_SWEEP_POLICY,
    coordinatePolicy: 'legal-native-viewport-title-gaze-painted-extrema',
    timeoutMs,
    maximumMutations,
    titleRect: { ...titleRect },
    viewport: { ...viewport },
    sourceBounds: {
      equation: '34 * (dx,dy) / max(320,hypot(dx,dy)); toFixed(2)',
      paintedBounds,
      coverage:
        'attainable per-axis title painted extrema; no guarantee of browser filter-cache invalidation',
    },
    stages: ['left', 'top', 'right', 'bottom'].map((id, index) => ({
      id,
      pointer: { ...points[index] },
      logos: logos.map(({ id: logoId, key, rect }) => {
        assert.equal(typeof logoId, 'string');
        assert.match(key, /^logo-[0-9]+$/);
        assert.ok(
          [rect.left, rect.top, rect.width, rect.height].every(
            Number.isFinite,
          ) &&
            rect.width > 0 &&
            rect.height > 0,
        );
        const offset = calculateLogoGaze(
          points[index].x,
          points[index].y,
          rect,
        );
        return {
          id: logoId,
          key,
          rect: { ...rect },
          transform: `translate(${offset.x.toFixed(2)} ${offset.y.toFixed(2)})`,
        };
      }),
    })),
  };
}

/** Observe native input and actual attributes; never write styles or transforms. */
export function installFullExtentPointerSweepInPage(contract) {
  if (
    window.__gevFullExtentPointerSweep ||
    contract?.policy !== 'reachable-logo-extents-v1' ||
    contract.stages?.length !== 4
  )
    throw new Error('Canonical pointer history cannot be installed.');
  let error = null,
    index = -1,
    frame = null,
    timer = null,
    resolveWait = null;
  let mutationSequence = 0;
  const mutations = [],
    pointerEvents = [],
    stages = [],
    rejectedEvents = [];
  const targets = contract.stages[0].logos.map((expected) => {
    const logo = [...document.querySelectorAll('[data-logo-gaze]')][
      Number(expected.key.slice(5))
    ];
    const globe = logo?.querySelector('#globe'),
      cage = logo?.querySelector('#globe_cage');
    if (!logo || !globe || !cage)
      throw new Error('Canonical history requires the real inline SVG.');
    return { ...expected, logo, globe, cage };
  });
  const current = () => stages[index];
  const finishWait = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = timer = null;
    if (resolveWait) {
      const resolve = resolveWait;
      resolveWait = null;
      resolve(read());
    }
  };
  const fail = (reason) => {
    error ||= reason;
    finishWait();
  };
  const environmentReady = () =>
    document.visibilityState === 'visible' && document.hasFocus();
  const readLogos = () =>
    targets.map(({ id, key, logo, globe, cage }) => {
      const bounds = logo.getBoundingClientRect(),
        style = getComputedStyle(logo);
      if (
        !logo.isConnected ||
        logo.querySelector('#globe') !== globe ||
        logo.querySelector('#globe_cage') !== cage ||
        logo.getClientRects().length === 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity) <= 0
      )
        throw new Error('Canonical gaze logo changed or became hidden.');
      return {
        id,
        key,
        rect: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        globeTransform: globe.getAttribute('transform'),
        cageTransform: cage.getAttribute('transform'),
      };
    });
  const collectMutations = (records) => {
    const nextValues = new Map();
    const values = records.map(() => null);
    for (let at = records.length - 1; at >= 0; at--) {
      const record = records[at];
      values[at] = nextValues.has(record.target)
        ? nextValues.get(record.target)
        : record.target.getAttribute('transform');
      nextValues.set(record.target, record.oldValue);
    }
    for (const [at, record] of records.entries()) {
      const target = targets.find(
        (item) => item.globe === record.target || item.cage === record.target,
      );
      if (!target) {
        fail('unexpected-transform-target');
        return;
      }
      mutationSequence++;
      if (mutations.length >= contract.maximumMutations) {
        fail('transform-mutation-bound-exceeded');
        return;
      }
      mutations.push({
        sequence: mutationSequence,
        stage: current()?.id ?? null,
        atMs: performance.now(),
        key: target.key,
        part: target.globe === record.target ? 'globe' : 'cage',
        before: record.oldValue,
        after: values[at],
      });
      if (current()?.status === 'settled') {
        fail('transform-mutated-after-settlement');
        return;
      }
    }
  };
  const observer = new MutationObserver(collectMutations);
  for (const target of targets)
    for (const part of [target.globe, target.cage])
      observer.observe(part, {
        attributes: true,
        attributeFilter: ['transform'],
        attributeOldValue: true,
      });
  const onPointerMove = (event) => {
    const stage = current();
    if (
      !stage ||
      stage.status !== 'waiting' ||
      stage.event ||
      event.isTrusted !== true ||
      event.pointerType !== 'mouse' ||
      event.buttons !== 0 ||
      event.clientX !== stage.pointer.x ||
      event.clientY !== stage.pointer.y
    ) {
      if (rejectedEvents.length < 8)
        rejectedEvents.push({
          type: event.type,
          x: event.clientX,
          y: event.clientY,
          pointerType: event.pointerType,
          trusted: event.isTrusted,
          buttons: event.buttons,
          atMs: performance.now(),
        });
      fail('untrusted-or-unexpected-pointer');
      return;
    }
    stage.event = {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
      trusted: event.isTrusted,
      buttons: event.buttons,
      atMs: performance.now(),
      eventTimeStamp: event.timeStamp,
    };
    pointerEvents.push({ stage: stage.id, ...stage.event });
  };
  const onReset = (event) => {
    // Match logoGaze's native boundary listeners. Non-bubbling descendant
    // pointerleave/blur events are ordinary hover/focus traversal, not resets.
    if (
      (event.type === 'pointerleave' &&
        event.target !== document.documentElement) ||
      (['blur', 'focus'].includes(event.type) && event.target !== window)
    )
      return;
    if (rejectedEvents.length < 8)
      rejectedEvents.push({
        type: event.type,
        targetKind:
          event.target === window
            ? 'window'
            : event.target === document.documentElement
              ? 'document-element'
              : event.target === document
                ? 'document'
                : 'descendant',
        trusted: event.isTrusted === true,
        atMs: performance.now(),
      });
    fail('unexpected-' + event.type);
  };
  const listeners = [
    [window, 'pointermove', onPointerMove],
    [window, 'pointerdown', onReset],
    [window, 'pointerup', onReset],
    [window, 'pointercancel', onReset],
    [window, 'blur', onReset, false],
    [window, 'focus', onReset, false],
    [document, 'visibilitychange', onReset],
    [document, 'focusin', onReset],
    [document, 'focusout', onReset],
    [document.documentElement, 'pointerleave', onReset, false],
  ];
  for (const [target, type, listener, capture = true] of listeners)
    target.addEventListener(type, listener, { capture, passive: true });
  function read() {
    collectMutations(observer.takeRecords());
    if (!environmentReady()) error ||= 'document-not-visible-and-focused';
    let logos = [];
    try {
      logos = readLogos();
    } catch (caught) {
      error ||= caught.message;
    }
    return JSON.parse(
      JSON.stringify({
        schema: 'gev-full-extent-pointer-sweep/v1',
        policy: contract.policy,
        status: error
          ? 'failed'
          : stages.length === 4 && current().status === 'settled'
            ? 'ready'
            : 'running',
        error,
        contract,
        stages,
        pointerEvents,
        rejectedEvents,
        mutations,
        mutationSequence,
        logos,
        documentVisible: document.visibilityState === 'visible',
        documentFocused: document.hasFocus(),
      }),
    );
  }
  const sample = (timestamp) => {
    frame = null;
    collectMutations(observer.takeRecords());
    if (error) {
      finishWait();
      return;
    }
    const stage = current();
    stage.observations++;
    if (!environmentReady() || stage.observations > 1024) {
      fail('canonical-observation-unavailable');
      return;
    }
    let logos;
    try {
      logos = readLogos();
    } catch (caught) {
      fail(caught.message);
      return;
    }
    const matches =
      stage.event &&
      logos.every((logo) => {
        const expected = contract.stages[index].logos.find(
          (item) => item.key === logo.key,
        );
        return (
          expected &&
          JSON.stringify(logo.rect) === JSON.stringify(expected.rect) &&
          logo.globeTransform === expected.transform &&
          logo.cageTransform === expected.transform
        );
      });
    const previous = stage.stableFrames.at(-1);
    if (
      !matches ||
      (previous &&
        (timestamp <= previous.timestamp ||
          mutationSequence !== previous.mutationSequence))
    )
      stage.stableFrames = [];
    if (matches)
      stage.stableFrames.push({
        timestamp,
        atMs: performance.now(),
        mutationSequence,
        logos,
      });
    if (stage.stableFrames.length === 2) {
      stage.status = 'settled';
      finishWait();
      return;
    }
    frame = requestAnimationFrame(sample);
  };
  window.__gevFullExtentPointerSweep = {
    begin(stageIndex) {
      collectMutations(observer.takeRecords());
      if (
        error ||
        stageIndex !== index + 1 ||
        stageIndex > 3 ||
        (index >= 0 && current().status !== 'settled')
      )
        throw new Error(error || 'Canonical stage order is invalid.');
      index = stageIndex;
      stages.push({
        index,
        id: contract.stages[index].id,
        pointer: { ...contract.stages[index].pointer },
        status: 'waiting',
        event: null,
        observations: 0,
        stableFrames: [],
        startedAtMs: performance.now(),
      });
    },
    wait() {
      if (error) return Promise.resolve(read());
      if (resolveWait || current()?.status !== 'waiting')
        throw new Error('Canonical stage is not waiting.');
      return new Promise((resolve) => {
        resolveWait = resolve;
        timer = setTimeout(
          () => fail('canonical-stage-timeout'),
          contract.timeoutMs,
        );
        frame = requestAnimationFrame(sample);
      });
    },
    read,
    dispose() {
      if (resolveWait) fail('canonical-observer-disposed');
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      for (const [target, type, listener, capture = true] of listeners)
        target.removeEventListener(type, listener, capture);
      delete window.__gevFullExtentPointerSweep;
    },
  };
}

export function readFullExtentPointerSweepInPage() {
  if (!window.__gevFullExtentPointerSweep)
    throw new Error('Canonical pointer history is unavailable.');
  return window.__gevFullExtentPointerSweep.read();
}

export function disposeFullExtentPointerSweepInPage() {
  window.__gevFullExtentPointerSweep?.dispose();
  delete window.__gevFullExtentPointerSweepProof;
}

export function assertFullExtentPointerSweep(proof) {
  assert.equal(proof?.schema, 'gev-full-extent-pointer-sweep/v1');
  assert.equal(proof.policy, FULL_EXTENT_POINTER_SWEEP_POLICY);
  assert.equal(
    proof.status,
    'ready',
    proof.error || 'Canonical history is incomplete',
  );
  assert.equal(proof.error, null);
  assert.equal(proof.documentVisible, true);
  assert.equal(proof.documentFocused, true);
  assert.deepEqual(
    proof.stages.map((stage) => stage.id),
    ['left', 'top', 'right', 'bottom'],
  );
  assert.equal(proof.pointerEvents.length, 4);
  assert.deepEqual(proof.rejectedEvents, []);
  assert.deepEqual(
    proof.contract,
    createFullExtentPointerSweepContract({
      logos: proof.contract.stages[0].logos,
      titleRect: proof.contract.titleRect,
      viewport: proof.contract.viewport,
      timeoutMs: proof.contract.timeoutMs,
      maximumMutations: proof.contract.maximumMutations,
    }),
  );
  assert.ok(proof.mutations.length <= proof.contract.maximumMutations);
  assert.equal(proof.mutationSequence, proof.mutations.length);
  const keys = new Set(proof.contract.stages[0].logos.map((logo) => logo.key));
  const previousTransforms = new Map();
  let previousStage = -1;
  let previousMutationTime = -Infinity;
  for (const [at, mutation] of proof.mutations.entries()) {
    assert.equal(mutation.sequence, at + 1);
    const stageIndex =
      mutation.stage === null
        ? -1
        : ['left', 'top', 'right', 'bottom'].indexOf(mutation.stage);
    assert.ok(
      stageIndex >= previousStage &&
        (stageIndex >= 0 || mutation.stage === null),
    );
    previousStage = stageIndex;
    assert.ok(keys.has(mutation.key));
    assert.ok(['globe', 'cage'].includes(mutation.part));
    assert.ok(Number.isFinite(mutation.atMs));
    assert.ok(mutation.atMs >= previousMutationTime);
    previousMutationTime = mutation.atMs;
    assert.ok(mutation.before === null || typeof mutation.before === 'string');
    assert.equal(typeof mutation.after, 'string');
    const identity = mutation.key + ':' + mutation.part;
    if (previousTransforms.has(identity))
      assert.equal(mutation.before, previousTransforms.get(identity));
    previousTransforms.set(identity, mutation.after);
  }
  let previousStageTime = -Infinity;
  let previousSequence = 0;
  for (const [index, stage] of proof.stages.entries()) {
    assert.equal(stage.status, 'settled');
    assert.equal(stage.index, index);
    assert.deepEqual(stage.pointer, proof.contract.stages[index].pointer);
    assert.equal(stage.event?.trusted, true);
    assert.equal(stage.event.pointerType, 'mouse');
    assert.equal(stage.event.buttons, 0);
    assert.equal(stage.event.x, stage.pointer.x);
    assert.equal(stage.event.y, stage.pointer.y);
    assert.ok(
      Number.isFinite(stage.startedAtMs) &&
        stage.startedAtMs >= previousStageTime,
    );
    assert.ok(
      Number.isFinite(stage.event.atMs) &&
        stage.event.atMs >= stage.startedAtMs,
    );
    assert.ok(Number.isFinite(stage.event.eventTimeStamp));
    assert.ok(
      stage.event.eventTimeStamp >= stage.startedAtMs &&
        stage.event.eventTimeStamp <= stage.event.atMs,
    );
    assert.deepEqual(proof.pointerEvents[index], {
      stage: stage.id,
      ...stage.event,
    });
    assert.equal(stage.stableFrames.length, 2);
    const [first, second] = stage.stableFrames;
    assert.ok(
      Number.isFinite(first.timestamp) &&
        Number.isFinite(second.timestamp) &&
        second.timestamp > first.timestamp,
    );
    assert.ok(Number.isFinite(first.atMs) && Number.isFinite(second.atMs));
    assert.ok(first.atMs >= stage.event.atMs && second.atMs >= first.atMs);
    assert.equal(first.mutationSequence, second.mutationSequence);
    assert.ok(
      Number.isInteger(first.mutationSequence) &&
        first.mutationSequence >= 0 &&
        first.mutationSequence <= proof.mutationSequence,
    );
    assert.ok(first.mutationSequence >= previousSequence);
    previousStageTime = second.atMs;
    previousSequence = second.mutationSequence;
    for (const frame of stage.stableFrames)
      assert.equal(
        frame.logos.length,
        proof.contract.stages[index].logos.length,
      );
    for (const frame of stage.stableFrames)
      for (const expected of proof.contract.stages[index].logos) {
        const actual = frame.logos.find((logo) => logo.key === expected.key);
        assert.ok(actual);
        assert.deepEqual(actual.rect, expected.rect);
        assert.equal(actual.globeTransform, expected.transform);
        assert.equal(actual.cageTransform, expected.transform);
      }
    for (const mutation of proof.mutations.filter(
      (value) => value.stage === stage.id,
    )) {
      assert.ok(
        mutation.atMs >= stage.event.atMs && mutation.atMs <= first.atMs,
      );
      assert.ok(mutation.sequence <= first.mutationSequence);
    }
    for (const expected of proof.contract.stages[index].logos)
      for (const part of ['globe', 'cage']) {
        const writes = proof.mutations.filter(
          (value) =>
            value.stage === stage.id &&
            value.key === expected.key &&
            value.part === part,
        );
        assert.ok(
          writes.length > 0,
          'Trusted sweep input must cause the actual application writes',
        );
        assert.equal(writes.at(-1).after, expected.transform);
      }
  }
  assert.deepEqual(proof.logos, proof.stages[3].stableFrames[1].logos);
  assert.equal(
    proof.mutationSequence,
    proof.stages[3].stableFrames[1].mutationSequence,
  );
}

/** The first leftward approach can differ; subsequent writes must agree. */
export function readFullExtentPointerSweepMutationSequence(proof) {
  assertFullExtentPointerSweep(proof);
  return proof.mutations
    .filter((mutation) => ['top', 'right', 'bottom'].includes(mutation.stage))
    .map(({ stage, key, part, before, after }) => ({
      stage,
      key,
      part,
      before,
      after,
    }));
}

export async function acquireFullExtentPointerSweep(page, options = {}) {
  const logos = await page.evaluate(readVisibleLogoGazeTargetsInPage);
  const titleRect = await page.evaluate(() => {
    const rect = document
      .querySelector('#title-bar [data-logo-gaze]')
      ?.getBoundingClientRect();
    if (!rect) throw new Error('Canonical title logo is unavailable.');
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  const contract = createFullExtentPointerSweepContract({
    ...options,
    logos,
    titleRect,
    viewport: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    })),
  });
  await page.evaluate(installFullExtentPointerSweepInPage, contract);
  try {
    for (const [index, stage] of contract.stages.entries()) {
      await page.evaluate(
        (index) => window.__gevFullExtentPointerSweep.begin(index),
        index,
      );
      await page.mouse.move(stage.pointer.x, stage.pointer.y);
      const proof = await page.evaluate(() =>
        window.__gevFullExtentPointerSweep.wait(),
      );
      if (proof.status === 'failed') {
        const error = new Error(proof.error);
        error.pointerHistory = proof;
        throw error;
      }
    }
    const proof = await page.evaluate(readFullExtentPointerSweepInPage);
    assertFullExtentPointerSweep(proof);
    await page.evaluate((value) => {
      window.__gevFullExtentPointerSweep.dispose();
      const freeze = (object) => {
        if (object && typeof object === 'object') {
          for (const child of Object.values(object)) freeze(child);
          Object.freeze(object);
        }
        return object;
      };
      Object.defineProperty(window, '__gevFullExtentPointerSweepProof', {
        value: freeze(value),
        writable: false,
        configurable: true,
      });
    }, proof);
    return proof;
  } catch (error) {
    error.fullExtentPointerSweep ||= await page
      .evaluate(readFullExtentPointerSweepInPage)
      .catch(() => null);
    await page.evaluate(disposeFullExtentPointerSweepInPage).catch(() => {});
    throw error;
  }
}

export function readRetainedFullExtentPointerSweepInPage() {
  if (
    !window.__gevFullExtentPointerSweepProof ||
    window.__gevFullExtentPointerSweep
  )
    throw new Error(
      'Completed, disposed full-extent sweep proof is unavailable.',
    );
  return JSON.parse(JSON.stringify(window.__gevFullExtentPointerSweepProof));
}

export function createFullExtentPointerSweepSnapshotReader(reader) {
  return new Function(
    'args',
    `return { ...(${reader.toString()})(args), fullExtentPointerSweep: (${readRetainedFullExtentPointerSweepInPage.toString()})() };`,
  );
}

/** Link the completed sweep to the live canonical observer guarding the PNG. */
export function assertFullExtentCanonicalContinuity(sweep, canonical) {
  assertFullExtentPointerSweep(sweep);
  assertCanonicalPointerHistory(canonical);
  assert.deepEqual(sweep.contract.titleRect, canonical.contract.titleRect);
  const last = sweep.stages[3].stableFrames[1];
  assert.ok(Number.isFinite(canonical.stages[0].startedAtMs));
  assert.ok(canonical.stages[0].startedAtMs >= last.atMs);
  assert.ok(canonical.stages[0].startedAtMs <= canonical.stages[0].event.atMs);
  assert.deepEqual(
    canonical.contract.stages[0].logos.map(({ id, key, rect }) => ({
      id,
      key,
      rect,
    })),
    sweep.contract.stages[0].logos.map(({ id, key, rect }) => ({
      id,
      key,
      rect,
    })),
  );
  for (const logo of last.logos) {
    for (const [part, field] of [
      ['globe', 'globeTransform'],
      ['cage', 'cageTransform'],
    ]) {
      const firstWrite = canonical.mutations.find(
        (value) => value.key === logo.key && value.part === part,
      );
      assert.ok(
        firstWrite,
        'Canonical acquisition must observe each actual part after the sweep',
      );
      assert.equal(
        firstWrite.before,
        logo[field],
        'Gaze changed between sweep and canonical acquisition',
      );
    }
  }
}
