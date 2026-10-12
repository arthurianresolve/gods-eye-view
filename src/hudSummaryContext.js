export const HUD_SUMMARY_CONTEXT_SKIPPED = Symbol(
  'HUD_SUMMARY_CONTEXT_SKIPPED',
);

/**
 * Share one summary-context operation among callers for the same revision.
 * A changed revision may start a separate operation so an obsolete build
 * cannot block a context that reflects newer layer or camera state.
 */
export function getHudSummaryContextForRevision(owner, revision, build) {
  let pending = owner._summaryContextBuild;
  if (!pending || pending.revision !== revision) {
    pending = {
      revision,
      promise: Promise.resolve().then(() => {
        if (
          !isHudSummaryContextCurrent(owner, revision) ||
          !canBuildHudSummaryContext(owner)
        )
          return HUD_SUMMARY_CONTEXT_SKIPPED;
        return build();
      }),
    };
    owner._summaryContextBuild = pending;
  }
  return pending.promise.finally(() => {
    if (owner._summaryContextBuild === pending)
      owner._summaryContextBuild = null;
  });
}

/** Whether a summary context is still useful to its owning HUD. */
export function isHudSummaryContextCurrent(owner, revision) {
  return !owner._destroyed && owner._summaryRevision === revision;
}

/** Skip context work while destroyed or while a summary request is active. */
export function canBuildHudSummaryContext(owner) {
  return !owner._destroyed && !owner._summaryRequest;
}
