/** Probe only processors owned by this check; never dispose scene/shared workers. */
export async function probeWorkerCompletion({
  createProcessor,
  tasks,
  timeoutMs = 10000,
  now = () => performance.now(),
}) {
  const processor = createProcessor();
  const startedAt = now();
  const results = [];
  try {
    for (const task of tasks) {
      let timer;
      const work = processor.scheduleTask(task.parameters);
      if (!work) throw new Error('Worker probe task was not accepted.');
      try {
        let outcome = 'resolved';
        try {
          await Promise.race([
            work,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                const error = new Error(
                  'Worker completion timed out: ' + task.id,
                );
                error.code = 'WORKER_PROBE_TIMEOUT';
                reject(error);
              }, timeoutMs);
            }),
          ]);
        } catch (error) {
          if (error.code === 'WORKER_PROBE_TIMEOUT') throw error;
          if (
            !task.expectError ||
            !task.expectError.test(String(error.message))
          )
            throw error;
          outcome = 'rejected-as-expected';
        }
        if (task.expectError && outcome !== 'rejected-as-expected')
          throw new Error('Worker failed to reject invalid task: ' + task.id);
        if (processor._activeTasks !== 0)
          throw new Error(
            'Worker probe retained active tasks after settlement.',
          );
        results.push({ id: task.id, outcome });
      } finally {
        clearTimeout(timer);
      }
    }
    return { status: 'passed', durationMs: now() - startedAt, tasks: results };
  } finally {
    processor.destroy();
  }
}
