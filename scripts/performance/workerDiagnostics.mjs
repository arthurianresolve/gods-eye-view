/** Serializable, opt-in retention instrumentation. Never installs in product code. */
export function installWorkerDiagnostics(scope = window) {
  const NativeWorker = scope.Worker;
  const records = [];
  let overflow = false;
  const now = () => scope.performance.now();
  class ObservedWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (records.length >= 64) {
        overflow = true;
        return;
      }
      // No URLs, parameters, results, native workers or callbacks in records.
      const name = String(url).split(/[?#]/)[0].split('/').at(-1);
      const record = {
        kind: /^[a-zA-Z][a-zA-Z0-9_-]*\.js$/.test(name)
          ? name
          : 'opaque-worker',
        submitted: 0,
        completed: 0,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        terminated: false,
        pending: new Map(),
      };
      records.push(record);
      const onMessage = (event) => {
        const id = event.data?.id;
        if (!record.pending.delete(id)) return;
        record.completed++;
        if (event.data?.error != null) record.taskErrors++;
      };
      const onError = () => {
        record.workerErrors++;
      };
      this.addEventListener('message', onMessage);
      this.addEventListener('error', onError);
      this.addEventListener('messageerror', onError);
      const post = this.postMessage;
      this.postMessage = function (...args) {
        const id = args[0]?.id;
        const tracked = Number.isSafeInteger(id);
        if (tracked) {
          record.submitted++;
          if (record.pending.size >= 1024 || record.pending.has(id))
            overflow = true;
          else record.pending.set(id, now());
        }
        try {
          return post.apply(this, args);
        } catch (error) {
          record.postErrors++;
          if (tracked) record.pending.delete(id);
          throw error;
        }
      };
      const terminate = this.terminate;
      this.terminate = function (...args) {
        record.terminated = true;
        record.cancelled += record.pending.size;
        record.pending.clear();
        this.removeEventListener('message', onMessage);
        this.removeEventListener('error', onError);
        this.removeEventListener('messageerror', onError);
        return terminate.apply(this, args);
      };
    }
  }
  scope.Worker = ObservedWorker;
  scope.__gevSoakWorkers = {
    snapshot() {
      const time = now();
      const workers = records.map(({ pending, ...record }) => ({
        ...record,
        pending: pending.size,
        oldestPendingMs: pending.size
          ? time - Math.min(...pending.values())
          : 0,
      }));
      return {
        instrumented: true,
        overflow,
        pending: workers.reduce((sum, worker) => sum + worker.pending, 0),
        workers,
      };
    },
  };
}
