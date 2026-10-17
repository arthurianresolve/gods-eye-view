import { msg } from '../../i18n/marker.js';

/** A classified road failure with a display-safe reason and machine-readable status. */
export class RoadRequestError extends Error {
  constructor(message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'RoadRequestError';
    this.status = status;
  }
}

/** Name the road upstream without exposing raw transport errors or missing codes. */
export function roadRequestError(status, cause) {
  const code = Number.isFinite(status) ? status : null;
  const message =
    code === 429
      ? msg('OpenFreeMap tiles rate-limited')
      : code === 504 || cause?.name === 'TimeoutError'
        ? msg('OpenFreeMap tiles timed out')
        : code === null
          ? msg('OpenFreeMap tiles unavailable')
          : `OpenFreeMap tiles unavailable (HTTP ${code})`;
  return Object.assign(new RoadRequestError(message, { status: code, cause }), {
    retryable: cause?.retryable !== false,
    code: cause?.code,
  });
}
