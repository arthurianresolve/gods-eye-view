/** Create an owned cancellable scheduler for one cooperative macrotask. */
export function createMacrotaskScheduler({
  scheduler = globalThis.scheduler,
  MessageChannelCtor = globalThis.MessageChannel,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let lastBackend = null;
  function timerTask(callback) {
    lastBackend = 'setTimeout';
    const handle = { kind: 'timer', active: true, id: null };
    try {
      handle.id = setTimer(() => {
        if (!handle.active) return;
        handle.active = false;
        callback();
      }, 0);
    } catch (error) {
      handle.active = false;
      throw error;
    }
    return handle;
  }

  function channelTask(callback) {
    let channel;
    try {
      channel = new MessageChannelCtor();
    } catch {
      return timerTask(callback);
    }
    const handle = { kind: 'channel', active: true, channel, listener: null };
    lastBackend = 'MessageChannel';
    const close = () => {
      if (!handle.active) return false;
      handle.active = false;
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
    try {
      if (channel.port1.addEventListener)
        channel.port1.addEventListener('message', handle.listener);
      else channel.port1.onmessage = handle.listener;
      channel.port1.start?.();
      channel.port2.postMessage(0);
      return handle;
    } catch {
      close();
      return timerTask(callback);
    }
  }

  function schedule(callback) {
    if (typeof callback !== 'function')
      throw new TypeError('A scheduled callback must be a function.');
    if (
      typeof scheduler?.postTask === 'function' &&
      typeof AbortController === 'function'
    ) {
      const controller = new AbortController();
      const handle = {
        kind: 'postTask',
        active: true,
        controller,
        ran: false,
        fallback: null,
      };
      let task;
      try {
        task = scheduler.postTask(
          () => {
            if (!handle.active) return;
            handle.active = false;
            handle.ran = true;
            callback();
          },
          { priority: 'user-visible', signal: controller.signal },
        );
        lastBackend = 'scheduler.postTask';
      } catch {
        handle.active = false;
        return channelTask(callback);
      }
      // postTask rejects when aborted, and when its callback throws. Consume
      // both rejections; only a rejection before invocation should fall back.
      Promise.resolve(task).catch(() => {
        if (!handle.active || handle.ran) return;
        handle.fallback = channelTask(() => {
          if (!handle.active) return;
          handle.active = false;
          handle.ran = true;
          callback();
        });
      });
      return handle;
    }
    if (typeof MessageChannelCtor === 'function') return channelTask(callback);
    return timerTask(callback);
  }

  function cancel(handle) {
    if (!handle?.active) return;
    if (handle.kind === 'postTask') {
      handle.active = false;
      handle.controller.abort();
      if (handle.fallback) cancel(handle.fallback);
    } else if (handle.kind === 'channel') handle.cancel();
    else if (handle.kind === 'timer') {
      handle.active = false;
      clearTimer(handle.id);
    }
  }

  return {
    schedule,
    cancel,
    get lastBackend() {
      return lastBackend;
    },
  };
}
