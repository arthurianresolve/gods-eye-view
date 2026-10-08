import { parseWorkspaceDocument } from './document.js';

function freezeState(state) {
  return Object.freeze({ ...state });
}

/** Stage and apply a workspace restore with cancellation and rollback ownership. */
export function createWorkspaceRestoreCoordinator({
  storage,
  inspectAvailability = async () => [],
  prepare = async (document) => document,
  captureCurrent = async () => null,
  apply,
  rollback = async () => {},
  isCurrent = () => true,
} = {}) {
  if (typeof storage?.getWorkspace !== 'function')
    throw new TypeError('Workspace storage is required.');
  if (typeof apply !== 'function')
    throw new TypeError('A workspace apply operation is required.');
  for (const [name, operation] of Object.entries({
    inspectAvailability,
    prepare,
    captureCurrent,
    rollback,
    isCurrent,
  }))
    if (typeof operation !== 'function')
      throw new TypeError(`${name} must be a function.`);

  const listeners = new Set();
  let generation = 0;
  let activeController = null;
  let destroyed = false;
  let state = freezeState({ status: 'idle', workspaceId: null, error: null });

  function publish(next) {
    if (destroyed) return state;
    state = freezeState({ ...state, ...next });
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A status observer cannot own or block restoration.
      }
    }
    return state;
  }

  function current(token, controller) {
    return !destroyed && token === generation && !controller.signal.aborted;
  }

  function finishSuperseded(token, controller) {
    if (token === generation && !destroyed) {
      if (activeController === controller) activeController = null;
      publish({
        status: controller.signal.aborted ? 'cancelled' : 'superseded',
        error: null,
      });
    }
    return { status: 'superseded' };
  }

  function cancel(reason = 'cancelled') {
    if (!activeController) return false;
    generation++;
    activeController.abort(reason);
    activeController = null;
    publish({ status: 'cancelled', error: null });
    return true;
  }

  async function restore(id, { signal, navigationToken } = {}) {
    if (destroyed) return { status: 'destroyed' };
    cancel('superseded');
    const token = ++generation;
    const controller = new AbortController();
    activeController = controller;
    const abortFromCaller = () =>
      controller.abort(signal.reason || 'cancelled');
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const owns = () =>
      current(token, controller) && isCurrent(navigationToken, id) !== false;
    publish({ status: 'loading', workspaceId: String(id), error: null });
    let snapshot;
    let beganApply = false;
    try {
      controller.signal.throwIfAborted();
      const stored = await storage.getWorkspace(id);
      if (!owns()) return finishSuperseded(token, controller);
      if (!stored) {
        publish({ status: 'missing', workspaceId: String(id) });
        return { status: 'missing' };
      }
      const document = parseWorkspaceDocument(stored.document);
      publish({ status: 'inspecting', workspaceId: document.id });
      const availability = await inspectAvailability(document, {
        stored,
        signal: controller.signal,
      });
      if (!owns()) return finishSuperseded(token, controller);
      const staged = await prepare(document, {
        stored,
        availability,
        signal: controller.signal,
      });
      if (!owns()) return finishSuperseded(token, controller);
      snapshot = await captureCurrent({ signal: controller.signal });
      if (!owns()) return finishSuperseded(token, controller);
      publish({ status: 'applying', workspaceId: document.id });
      beganApply = true;
      const result = await apply(staged, {
        document,
        stored,
        availability,
        signal: controller.signal,
        navigationToken,
      });
      if (!owns()) return finishSuperseded(token, controller);
      publish({ status: 'applied', workspaceId: document.id, error: null });
      return { status: 'applied', document, availability, result };
    } catch (error) {
      if (!owns() || error?.name === 'AbortError')
        return finishSuperseded(token, controller);
      let rolledBack = false;
      if (beganApply && snapshot !== undefined && owns()) {
        try {
          await rollback(snapshot, { error, signal: controller.signal });
          rolledBack = true;
        } catch {
          rolledBack = false;
        }
      }
      publish({
        status: 'failed',
        error: String(error?.message || error),
      });
      return {
        status: 'failed',
        error,
        rolledBack,
      };
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
      if (token === generation) activeController = null;
    }
  }

  return Object.freeze({
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('A restore-state listener is required.');
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    restore,
    cancel,
    destroy() {
      if (destroyed) return;
      cancel('destroyed');
      destroyed = true;
      listeners.clear();
    },
  });
}
