export const PREWARM_WORKER_AUDIT_BOUNDARY =
  'after-warmup-and-completed-render-before-measurement';

/** Run the warmup/render boundary and only then validate prewarmed worker bodies. */
export async function runWorkerAuditAtWarmupBoundary({
  auditMode,
  warmupMs,
  readWarmupBoundary,
  settleCompletedRender,
  audit,
}) {
  if (!['diagnostic', 'prewarm'].includes(auditMode))
    throw new Error('Worker audit mode must be diagnostic or prewarm.');
  if (
    typeof readWarmupBoundary !== 'function' ||
    typeof settleCompletedRender !== 'function'
  )
    throw new Error('Worker audit boundary callbacks are required.');
  const warmupBoundary = await readWarmupBoundary();
  const completedRender = await settleCompletedRender(warmupBoundary);
  if (auditMode !== 'prewarm')
    return { warmupBoundary, completedRender, timingBoundary: null };
  if (
    !Number.isSafeInteger(warmupMs) ||
    warmupMs < 0 ||
    warmupBoundary?.phase !== 'warmup-held' ||
    warmupBoundary.elapsedMs !== warmupMs ||
    !Number.isFinite(completedRender?.settleElapsedMs) ||
    completedRender.settleElapsedMs < 0
  )
    throw new Error(
      'Prewarm worker audit requires the declared warmup and a completed boundary render.',
    );
  const result = await audit();
  if (!result?.inventory || !result.documentAudit?.validation)
    throw new Error('Provider sample has no validated prewarm worker set.');
  return {
    ...result,
    warmupBoundary,
    completedRender,
    timingBoundary: {
      phase: PREWARM_WORKER_AUDIT_BOUNDARY,
      configuredWarmupMs: warmupMs,
      fixtureClockElapsedMs: warmupBoundary.elapsedMs,
      completedRenderSettleMs: completedRender.settleElapsedMs,
    },
  };
}
