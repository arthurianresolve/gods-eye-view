import { interceptFixtureSession } from './fixtureInterception.mjs';

/** Resolve Cesium worker fetches even when Chromium emits no paired Network event. */
export async function installTrafficFixtureInterception(
  page,
  origin,
  evidence,
) {
  const session = await page.createCDPSession();
  try {
    await interceptFixtureSession(
      session,
      origin,
      (url) => {
        if (
          ['http:', 'https:'].includes(url.protocol) &&
          url.origin !== origin
        ) {
          evidence.externalRequests.push(url.origin);
        } else if (url.pathname.includes('/Workers/')) {
          evidence.workerRequestsObserved++;
        }
        return null;
      },
      (error) =>
        evidence.interceptionErrors.push(
          String(error?.message || error)
            .replace(/(?:https?|blob|data|file):[^\s"'<>]+/gi, '[redacted-url]')
            .slice(0, 240),
        ),
    );
    return session;
  } catch (error) {
    await Promise.resolve(session.detach?.()).catch(() => {});
    throw error;
  }
}
