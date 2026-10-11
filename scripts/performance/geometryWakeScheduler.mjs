/** Owned one-shot MessageChannel tasks for the large-geometry comparison. */
export function createMessageChannelWakeScheduler({
  MessageChannelCtor = globalThis.MessageChannel,
} = {}) {
  if (typeof MessageChannelCtor !== 'function')
    throw new TypeError('MessageChannel is required for this scheduler.');

  const pending = new Set();
  let disposed = false;

  function schedule(callback) {
    if (disposed) throw new Error('The MessageChannel scheduler is disposed.');
    if (typeof callback !== 'function')
      throw new TypeError('A scheduled callback must be a function.');

    const channel = new MessageChannelCtor();
    const handle = { active: true, channel, listener: null };
    const close = () => {
      if (!handle.active) return false;
      handle.active = false;
      pending.delete(handle);
      channel.port1.removeEventListener?.('message', handle.listener);
      channel.port1.onmessage = null;
      channel.port1.close?.();
      channel.port2.close?.();
      handle.channel = null;
      return true;
    };
    handle.cancel = close;
    handle.listener = () => {
      if (!close()) return;
      callback();
    };
    pending.add(handle);
    try {
      if (channel.port1.addEventListener)
        channel.port1.addEventListener('message', handle.listener);
      else channel.port1.onmessage = handle.listener;
      channel.port1.start?.();
      channel.port2.postMessage(0);
    } catch (error) {
      close();
      throw error;
    }
    return handle;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const handle of [...pending]) handle.cancel();
  }

  return Object.freeze({
    schedule,
    cancel: (handle) => handle?.cancel?.(),
    dispose,
    get pendingCount() {
      return pending.size;
    },
  });
}
