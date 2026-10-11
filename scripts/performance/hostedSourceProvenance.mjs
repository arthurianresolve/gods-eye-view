import { execFileSync } from 'node:child_process';

const SHA1 = /^[a-f0-9]{40}$/;

export function inspectTrackedWorktree({
  cwd = process.cwd(),
  execute = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }),
} = {}) {
  try {
    const head = String(execute(['rev-parse', 'HEAD'])).trim();
    if (!SHA1.test(head)) throw new Error('Git HEAD is not a full SHA.');
    const status = String(
      execute(['status', '--porcelain=v1', '--untracked-files=no']),
    ).trim();
    return { available: true, head, trackedDirty: status.length > 0 };
  } catch (error) {
    return {
      available: false,
      head: null,
      trackedDirty: null,
      error: String(error?.message || error).slice(0, 300),
    };
  }
}

export function assessHostedSourceStart(snapshot, expectedCommit) {
  const usable = snapshot?.available === true;
  const head = usable ? snapshot.head : null;
  const dirty = usable ? snapshot.trackedDirty : null;
  return {
    harnessCommit: head,
    // Application and harness inputs share one checkout, so both booleans
    // reflect cleanliness of its complete tracked tree.
    sourceDirtyAtStart: dirty,
    harnessDirtyAtStart: dirty,
    valid:
      usable &&
      SHA1.test(expectedCommit || '') &&
      head === expectedCommit &&
      dirty === false,
    error: usable
      ? null
      : snapshot?.error || 'Tracked source inspection was unavailable.',
  };
}

export function assessHostedSourceFinish(start, finish) {
  if (start?.available !== true || finish?.available !== true) {
    return {
      sourceChangedDuringRun: null,
      harnessChangedDuringRun: null,
      error:
        finish?.error ||
        start?.error ||
        'Tracked source inspection was unavailable.',
    };
  }
  const changed = start.head !== finish.head || finish.trackedDirty !== false;
  return {
    sourceChangedDuringRun: changed,
    harnessChangedDuringRun: changed,
    error: null,
  };
}
