export function waitForPostRenderUntil(viewer, deadline, now, wait) {
  const remainingMs = deadline - now();
  if (!(remainingMs > 0))
    return Promise.reject(
      new Error('Cable frame deadline expired before the next render.'),
    );
  return wait(viewer, remainingMs);
}
