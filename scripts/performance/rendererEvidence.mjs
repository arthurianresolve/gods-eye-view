import os from 'node:os';

export function isSoftwareRenderer(renderer) {
  return /swiftshader|software|llvmpipe|softpipe|basic render|warp/i.test(
    String(renderer || ''),
  );
}

/** A renderer name alone does not establish that Chrome enabled acceleration. */
export function classifyRenderer(renderer, graphics = null) {
  const text = String(renderer || '');
  const software = isSoftwareRenderer(text);
  // Apple's documented paravirtual graphics path is Metal accelerated. Keep it
  // separate from physical desktop coverage and other unverified virtual GPUs.
  const appleVirtual = /ANGLE Metal Renderer: Apple Paravirtual device/i.test(
    text,
  );
  const native =
    /Intel|NVIDIA|AMD|Apple|Radeon/i.test(text) && !/virtual/i.test(text);
  // Current Chromium reports one accelerated-WebGL status. Older versions
  // additionally reported webgl2. Absence of that retired field is not a
  // software fallback; an explicit disabled value must still fail closed.
  const enabled =
    graphics?.featureStatus?.webgl === 'enabled' &&
    (graphics.featureStatus.webgl2 == null ||
      graphics.featureStatus.webgl2 === 'enabled');
  return {
    kind: software
      ? 'software'
      : appleVirtual
        ? 'apple-paravirtual-metal'
        : native
          ? 'native-gpu'
          : 'unknown',
    accelerationVerified: !software && (native || appleVirtual) && enabled,
    physicalDesktopCoverage:
      !software && native && enabled && !process.env.GITHUB_ACTIONS,
  };
}

/** Bound and redact the browser-level report: no command line, URLs or machine ID. */
export async function readBrowserGraphicsInfo(browser) {
  let session;
  try {
    session = await browser.target().createCDPSession();
    const { gpu } = await session.send('SystemInfo.getInfo');
    return {
      featureStatus: Object.fromEntries(
        ['webgl', 'webgl2', 'gpu_compositing', 'opengl'].map((key) => [
          key,
          gpu?.featureStatus?.[key] ?? null,
        ]),
      ),
      devices: (gpu?.devices || []).slice(0, 4).map((device) => ({
        vendor: String(device.vendorString || '').slice(0, 160),
        device: String(device.deviceString || '').slice(0, 160),
        driver: String(device.driverVersion || '').slice(0, 80),
      })),
    };
  } catch {
    return null;
  } finally {
    await session?.detach().catch(() => {});
  }
}

export function readHostEnvironment() {
  return {
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model || null,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    hosted: process.env.GITHUB_ACTIONS === 'true',
    runnerImage: process.env.ImageOS || null,
    runnerImageVersion: process.env.ImageVersion || null,
  };
}
