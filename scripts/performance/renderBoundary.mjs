import { randomUUID } from 'node:crypto';
import { settleCompletedRender } from './productionFlightFixture.mjs';

/** Bound protocol dispatch and page rendering separately, outside measured time.
 * A failure is terminal for the capture; its caller must dispose the document.
 * The page enforces its own monotonic render deadline even if timers are delayed.
 */
export async function settlePageRenderBoundary(
  page,
  {
    label = 'Render boundary',
    timeoutMs = 5000,
    entryTimeoutMs = 5000,
    deliveryGraceMs = 1000,
    diagnostic = {},
    verbose = false,
  } = {},
) {
  for (const value of [timeoutMs, entryTimeoutMs, deliveryGraceMs]) {
    if (!Number.isFinite(value) || value <= 0)
      throw new TypeError('Render boundary deadlines must be positive.');
  }
  const boundaryId = randomUUID();
  const startedAt = performance.now();
  Object.assign(diagnostic, {
    label,
    timeoutMs,
    entryTimeoutMs,
    deliveryGraceMs,
    entryElapsedMs: null,
    hostElapsedMs: null,
    events: [],
  });
  let timer = null;
  let entered = false;
  let finished = false;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const fail = (message) => rejectDeadline(new Error(`${label}: ${message}`));
  const onConsole = (message) => {
    if (finished) return;
    let row;
    try {
      const prefix = '[gev-render-boundary] ';
      const text = message.text();
      if (!text.startsWith(prefix)) return;
      row = JSON.parse(text.slice(prefix.length));
    } catch {
      return;
    }
    if (row.boundaryId !== boundaryId || !Number.isFinite(row.pageNowMs))
      return;
    if (
      ![
        'entered',
        'armed',
        'requested',
        'preUpdate',
        'postUpdate',
        'preRender',
        'completed',
        'timeout',
        'failed',
      ].includes(row.phase)
    )
      return;
    const receivedAfterMs = performance.now() - startedAt;
    if (diagnostic.events.length < 12)
      diagnostic.events.push({
        phase: row.phase,
        pageNowMs: row.pageNowMs,
        receivedAfterMs,
      });
    if (row.phase !== 'entered' || entered) return;
    entered = true;
    diagnostic.entryElapsedMs = receivedAfterMs;
    clearTimeout(timer);
    if (receivedAfterMs > entryTimeoutMs) {
      fail(`browser callback entry exceeded ${entryTimeoutMs}ms.`);
      return;
    }
    timer = setTimeout(
      () =>
        fail(
          `completed render result was not delivered within ${timeoutMs}ms plus ${deliveryGraceMs}ms protocol grace after callback entry.`,
        ),
      timeoutMs + deliveryGraceMs,
    );
  };
  page.on('console', onConsole);
  timer = setTimeout(
    () => fail(`browser callback did not enter within ${entryTimeoutMs}ms.`),
    entryTimeoutMs,
  );
  try {
    const result = await Promise.race([
      page.evaluate(
        settleCompletedRender,
        timeoutMs,
        undefined,
        null,
        verbose ? true : 'entry',
        boundaryId,
      ),
      deadline,
    ]);
    if (!entered || diagnostic.entryElapsedMs > entryTimeoutMs)
      throw new Error(
        `${label}: completed render has no timely callback entry.`,
      );
    if (
      !Number.isFinite(result?.settleElapsedMs) ||
      result.settleElapsedMs < 0 ||
      result.settleElapsedMs > timeoutMs
    )
      throw new Error(
        `${label}: completed render exceeded its page deadline or has no duration.`,
      );
    if (
      performance.now() - startedAt - diagnostic.entryElapsedMs >
      timeoutMs + deliveryGraceMs
    )
      throw new Error(
        `${label}: completed render result exceeded its delivery deadline.`,
      );
    return result;
  } finally {
    finished = true;
    clearTimeout(timer);
    page.off('console', onConsole);
    diagnostic.hostElapsedMs = performance.now() - startedAt;
  }
}
