function errorText(error) {
  return String(error?.stack || error?.message || error).slice(0, 3000);
}

export function recordCableLifecycleFailure(report, failure) {
  report.failures ||= [];
  report.failures.push(failure);
  report.status = 'failed';
  if (!report.error) {
    report.failedPhase = `${failure.mode}-${failure.stage}`;
    report.error = failure.message;
  }
}

/** Run one renderer against an owned viewer and report whether teardown is proven. */
export async function runCableLifetimeOnOwnedViewer({
  mode,
  activationOrder,
  report,
  createViewer,
  executeLifetime,
}) {
  report.lifecycleCycles ||= [];
  report.failures ||= [];
  const cycle = {
    mode,
    activationOrder,
    status: 'running',
    stage: 'create-viewer',
    failureStage: null,
    cycleIndex: null,
    stageHistory: [],
    viewerDestroyed: null,
    error: null,
    cleanupError: null,
  };
  report.lifecycleCycles.push(cycle);
  let viewer = null;
  let lifetime = null;
  let failure = null;
  const setStage = (stage, cycleIndex = null) => {
    cycle.stage = String(stage).slice(0, 120);
    cycle.cycleIndex = Number.isSafeInteger(cycleIndex) ? cycleIndex : null;
    if (cycle.stageHistory.length < 64)
      cycle.stageHistory.push({
        stage: cycle.stage,
        cycleIndex: cycle.cycleIndex,
      });
  };

  try {
    viewer = await createViewer({ setStage });
    setStage('renderer-lifetime');
    lifetime = await executeLifetime(viewer, { setStage });
    if (lifetime?.status === 'failed') {
      setStage('lifetime-reported-failure');
      const details = [lifetime.error, lifetime.cleanupError]
        .filter(Boolean)
        .join(' | ');
      throw new Error(details || 'Cable layer lifetime reported failure.');
    }
    cycle.status = 'passed';
  } catch (error) {
    failure = {
      mode,
      activationOrder,
      stage: cycle.stage,
      cycle: cycle.cycleIndex,
      message: errorText(error),
    };
    cycle.status = 'failed';
    cycle.failureStage = cycle.stage;
    cycle.error = failure.message;
    recordCableLifecycleFailure(report, failure);
    lifetime ||= report.lifetimes?.find(
      (row) => row.mode === mode && row.activationOrder === activationOrder,
    );
    if (lifetime) {
      lifetime.lifecycleStage = cycle.stage;
      lifetime.lifecycleCycle = cycle.cycleIndex;
      if (lifetime.readinessFailure && !report.readinessFailure)
        report.readinessFailure = lifetime.readinessFailure;
    }
  } finally {
    setStage('destroy-viewer');
    if (viewer) {
      try {
        if (viewer.isDestroyed?.() === false) viewer.destroy();
      } catch (error) {
        cycle.cleanupError = errorText(error);
      }
      try {
        cycle.viewerDestroyed = viewer.isDestroyed?.() === true;
      } catch (error) {
        cycle.destroyCheckError = errorText(error);
      }
    } else {
      cycle.viewerDestroyed = false;
    }
    if (
      cycle.viewerDestroyed !== true ||
      cycle.cleanupError ||
      cycle.destroyCheckError
    ) {
      cycle.status = 'failed';
      cycle.failureStage ||= 'destroy-viewer';
      const cleanupFailure = {
        mode,
        activationOrder,
        stage: 'destroy-viewer',
        message:
          cycle.cleanupError ||
          cycle.destroyCheckError ||
          'Viewer destruction was not confirmed.',
      };
      recordCableLifecycleFailure(report, cleanupFailure);
    }
    if (lifetime) {
      lifetime.viewerDestruction = {
        attempted: Boolean(viewer),
        confirmed: cycle.viewerDestroyed === true,
        error: cycle.cleanupError || cycle.destroyCheckError,
      };
    }
  }

  return {
    mode,
    activationOrder,
    status: cycle.status,
    viewerDestroyed: cycle.viewerDestroyed === true,
    failure,
    cycle,
    lifetime,
  };
}

/** Keep renderer runs independent and compare whatever evidence both produced. */
export async function runCableRendererLifetimes({
  modes,
  report,
  createViewer,
  executeLifetime,
  compareAvailable,
}) {
  const outcomes = [];
  for (
    let activationOrder = 0;
    activationOrder < modes.length;
    activationOrder++
  ) {
    const mode = modes[activationOrder];
    const outcome = await runCableLifetimeOnOwnedViewer({
      mode,
      activationOrder,
      report,
      createViewer: ({ setStage }) =>
        createViewer(mode, activationOrder, { setStage }),
      executeLifetime: (viewer, { setStage }) =>
        executeLifetime(viewer, mode, activationOrder, { setStage }),
    });
    outcomes.push(outcome);
    if (
      activationOrder + 1 < modes.length &&
      outcome.viewerDestroyed !== true
    ) {
      report.skippedLifetimes = modes
        .slice(activationOrder + 1)
        .map((skipped) => ({
          mode: skipped,
          reason: 'Prior viewer destruction was not confirmed.',
        }));
      break;
    }
  }

  if (typeof compareAvailable === 'function') {
    try {
      await compareAvailable(outcomes);
    } catch (error) {
      recordCableLifecycleFailure(report, {
        mode: 'comparison',
        activationOrder: null,
        stage: 'compare-available-evidence',
        message: errorText(error),
      });
    }
  }
  return outcomes;
}
