import * as Cesium from 'cesium';

const EMPTY_IDS = Object.freeze({ civil: [], military: [] });
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

function createFrameWaiter(viewer, readLatestFrame, checkRuntime, timeoutMs) {
  return (afterFrame, label, predicate) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let remove = () => {};
      let timeout = null;
      const cleanup = () => {
        if (timeout !== null) clearTimeout(timeout);
        remove();
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const observeLatest = () => {
        if (settled) return;
        try {
          checkRuntime();
          const frame = readLatestFrame();
          if (frame && frame.frameNumber > afterFrame && predicate(frame))
            finish(null, frame);
        } catch (error) {
          finish(error);
        }
      };
      observeLatest();
      if (settled) return;
      timeout = setTimeout(() => {
        finish(new Error(`${label}: no qualifying completed frame`));
      }, timeoutMs);
      remove = viewer.scene.postRender.addEventListener(observeLatest);
      // An event can be delivered as the listener is installed. Recheck the
      // persistent postRender snapshot rather than sampling mutable state here.
      observeLatest();
    });
}

/**
 * Exercise real source removal, bounded empty-idle demand, and recovery on the
 * already-initialized application fleet layers. `setSourceIds` only changes
 * the fixture source's returned records; all state transitions use layer.update.
 */
export async function runFleetEmptyLifecycle({
  viewer,
  layers,
  governor,
  ids,
  setSourceIds,
  errors = () => [],
  idleMs = 10_000,
  maxWaitMs = 8_000,
  maxIdleFrames = 2,
}) {
  check(
    viewer?.scene && layers?.civil && layers?.military,
    'Fleet context required',
  );
  check(
    typeof setSourceIds === 'function',
    'Source population setter required',
  );
  check(
    Array.isArray(ids?.civil) && Array.isArray(ids?.military),
    'Canonical fixture ID lists required',
  );
  check(
    Number.isFinite(idleMs) && idleMs === 10_000,
    'Idle window must be 10 seconds',
  );
  check(
    Number.isInteger(maxIdleFrames) && maxIdleFrames >= 0,
    'Idle frame bound required',
  );

  const idsByKind = {
    civil: new Set(ids.civil.map(String)),
    military: new Set(ids.military.map(String)),
  };
  const report = {
    schema: 'gev-fleet-empty-lifecycle/v1',
    status: 'running',
    requestedIdleMs: idleMs,
    maxIdleFrames,
    phases: [],
    checks: [],
  };
  const pass = (id) => report.checks.push({ id, status: 'passed' });
  let frameNumber = 0;
  let latestCompletedFrame = null;
  let latestFrameError = null;
  const removeCounter = viewer.scene.postRender.addEventListener(() => {
    frameNumber += 1;
    try {
      latestCompletedFrame = sample();
      latestFrameError = null;
    } catch (error) {
      latestFrameError = error;
    }
  });
  const failIfRuntimeError = () => {
    const current = errors();
    check(current.length === 0, current.join('; '));
  };
  const sample = () => {
    const counts = { civil: 0, military: 0 };
    const ready = { civil: true, military: true };
    const shown = { civil: true, military: true };
    for (let p = 0; p < viewer.scene.primitives.length; p++) {
      const collection = viewer.scene.primitives.get(p);
      if (!(collection instanceof Cesium.BillboardCollection)) continue;
      for (let i = 0; i < collection.length; i++) {
        const billboard = collection.get(i);
        if (!billboard) continue;
        const id = String(billboard.id);
        const kind = idsByKind.civil.has(id)
          ? 'civil'
          : idsByKind.military.has(id)
            ? 'military'
            : null;
        if (!kind) continue;
        counts[kind] += 1;
        ready[kind] &&= billboard.ready;
        shown[kind] &&= billboard.show && collection.show;
      }
    }
    return {
      frameNumber,
      population: Object.fromEntries(
        Object.entries(layers).map(([kind, layer]) => [
          kind,
          layer.getStats().count,
        ]),
      ),
      sceneBillboards: counts,
      billboardsReady: ready,
      billboardsShown: shown,
      demand: (() => {
        const diagnostics = governor.getRenderGovernorDiagnostics();
        check(
          Array.isArray(diagnostics.holds) &&
            Array.isArray(diagnostics.scheduledUpdates),
          'Render governor diagnostics are unavailable',
        );
        return {
          mode: diagnostics.mode,
          holds: diagnostics.holds.length,
          scheduledUpdates: diagnostics.scheduledUpdates.length,
        };
      })(),
    };
  };
  const waitForFrame = createFrameWaiter(
    viewer,
    () => {
      if (latestFrameError) throw latestFrameError;
      return latestCompletedFrame;
    },
    failIfRuntimeError,
    maxWaitMs,
  );
  const assertCounts = (observed, expected, label) => {
    for (const kind of ['civil', 'military']) {
      check(
        observed.population[kind] === expected[kind].length,
        `${label}: ${kind} layer population ${observed.population[kind]} != ${expected[kind].length}`,
      );
      check(
        observed.sceneBillboards[kind] === expected[kind].length,
        `${label}: ${kind} rendered billboard count ${observed.sceneBillboards[kind]} != ${expected[kind].length}`,
      );
      if (expected[kind].length > 0) {
        check(
          observed.billboardsReady[kind],
          `${label}: ${kind} billboard not ready`,
        );
        check(
          observed.billboardsShown[kind],
          `${label}: ${kind} billboard not visible`,
        );
      }
    }
  };
  const publishSource = async (sourceIds, label) => {
    await setSourceIds(sourceIds);
    await Promise.all(
      Object.values(layers).map((layer) => layer.update(viewer)),
    );
    failIfRuntimeError();
    return { label, afterPublish: sample() };
  };
  const emptyFleet = async (label) => {
    const phase = { name: label, absentSnapshots: [] };
    report.phases.push(phase);
    for (let absencePoll = 1; absencePoll <= 3; absencePoll++) {
      const frameBeforeUpdate = frameNumber;
      const published = await publishSource(
        EMPTY_IDS,
        `${label}-absence-${absencePoll}`,
      );
      phase.absentSnapshots.push({
        absencePoll,
        counts: published.afterPublish.population,
        sceneBillboards: published.afterPublish.sceneBillboards,
      });
      if (absencePoll === 3) {
        const finalFrame = await waitForFrame(
          frameBeforeUpdate,
          `${label}-last-removal`,
          (frame) =>
            frame.population.civil === 0 &&
            frame.population.military === 0 &&
            frame.sceneBillboards.civil === 0 &&
            frame.sceneBillboards.military === 0,
        );
        phase.finalFrame = finalFrame;
      }
    }
    const drained = sample();
    check(
      drained.demand.holds === 0 && drained.demand.scheduledUpdates === 0,
      `${label}: empty fleets retained render demand`,
    );
    phase.drained = drained;
    return phase;
  };

  try {
    failIfRuntimeError();
    assertCounts(sample(), ids, 'initial');
    pass('initial-population-present');
    await emptyFleet('empty-first');
    pass('empty-final-frame');
    pass('empty-no-periodic-demand');

    const subset = {
      civil: ids.civil.slice(0, 1),
      military: ids.military.slice(0, 1),
    };
    const beforeArrival = frameNumber;
    const arrival = await publishSource(subset, 'repopulate');
    const arrivedFrame = await waitForFrame(
      beforeArrival,
      'repopulate',
      (frame) =>
        frame.population.civil === 1 &&
        frame.population.military === 1 &&
        frame.sceneBillboards.civil === 1 &&
        frame.sceneBillboards.military === 1 &&
        frame.billboardsReady.civil &&
        frame.billboardsReady.military,
    );
    assertCounts(arrivedFrame, subset, 'repopulate');
    check(
      arrivedFrame.demand.scheduledUpdates > 0 &&
        arrivedFrame.demand.holds === 0,
      'Repopulated untracked fleets did not resume scheduled cadence',
    );
    pass('source-rearrival-resumes-cadence');
    report.phases.push({
      name: 'repopulate',
      afterPublish: arrival.afterPublish,
      frame: arrivedFrame,
    });

    const secondEmpty = await emptyFleet('empty-again');
    const idleFramesStart = frameNumber;
    const idleStart = performance.now();
    const idleDemandStart = sample().demand;
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    const idleObservedMs = performance.now() - idleStart;
    const idleFrames = frameNumber - idleFramesStart;
    const idleDemandEnd = sample().demand;
    const idle = {
      requestedMs: idleMs,
      observedMs: idleObservedMs,
      frames: idleFrames,
      maxFrames: maxIdleFrames,
      demandStart: idleDemandStart,
      demandEnd: idleDemandEnd,
      passed: idleObservedMs >= idleMs && idleFrames <= maxIdleFrames,
    };
    secondEmpty.idle = idle;
    check(
      idle.passed,
      `Empty fleet idle produced ${idleFrames} frames in ${idleObservedMs} ms`,
    );
    check(
      idleDemandStart.holds === 0 &&
        idleDemandStart.scheduledUpdates === 0 &&
        idleDemandEnd.holds === 0 &&
        idleDemandEnd.scheduledUpdates === 0,
      'Empty fleet reacquired render demand during idle',
    );
    pass('ten-second-idle-frame-bound');

    const beforeRecovery = frameNumber;
    const recovery = await publishSource(ids, 'recovery');
    const recoveredFrame = await waitForFrame(
      beforeRecovery,
      'recovery',
      (frame) =>
        frame.population.civil === ids.civil.length &&
        frame.population.military === ids.military.length &&
        frame.sceneBillboards.civil === ids.civil.length &&
        frame.sceneBillboards.military === ids.military.length &&
        frame.billboardsReady.civil &&
        frame.billboardsReady.military,
    );
    assertCounts(recoveredFrame, ids, 'recovery');
    check(
      recoveredFrame.demand.scheduledUpdates > 0 &&
        recoveredFrame.demand.holds === 0,
      'Full source recovery did not resume scheduled cadence',
    );
    pass('full-source-recovery');
    report.phases.push({
      name: 'recovery',
      afterPublish: recovery.afterPublish,
      frame: recoveredFrame,
    });
    report.status = 'passed';
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.stack || error).slice(0, 3000);
    if (error && typeof error === 'object') error.lifecycleReport = report;
    throw error;
  } finally {
    removeCounter();
  }
}
