import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** Optional operator handoff before navigation or timing. This never replaces
 * the native-window and page-focus checks performed by the capture producer. */
export async function waitForBrowserReadiness({
  file,
  browserPid,
  timeoutMs = 120_000,
  readFile = fs.readFile,
  sleep = delay,
  now = () => performance.now(),
} = {}) {
  if (!file || typeof file !== 'string')
    throw new TypeError('Browser readiness requires a file path.');
  if (!Number.isSafeInteger(browserPid) || browserPid <= 0)
    throw new TypeError('Browser readiness requires the owned browser PID.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new TypeError('Browser readiness timeout must be 1–120000 ms.');
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    let value;
    try {
      value = await readFile(file, { encoding: 'utf8' });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (value !== undefined) {
      if (now() - startedAt >= timeoutMs) break;
      if (value.trim() !== String(browserPid))
        throw new Error(
          'Browser readiness does not identify the owned process.',
        );
      return {
        schema: 'gev-browser-readiness-handoff/v1',
        status: 'operator-ready-native-focus-still-required',
        elapsedMs: now() - startedAt,
      };
    }
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) break;
    await sleep(Math.min(250, remaining));
  }
  throw new Error(
    'Owned browser readiness handoff timed out before navigation.',
  );
}
