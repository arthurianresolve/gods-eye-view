/** Drive a fixture's visible pointer instructions using browser-native input.
 * The fixture owns application behavior and completion; this driver never calls
 * application handlers or changes page globals. Keep partial input evidence on
 * failure so a pointer dispatch is not mistaken for an accepted calibration.
 */
export async function driveNativePointerFixture({
  readResult,
  readInstruction,
  mouse,
  viewport,
  actions = [],
  now = () => Date.now(),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 240_000,
}) {
  const start = now();
  const seen = new Set();
  if (!(viewport?.width > 0 && viewport?.height > 0))
    throw new Error('Native pointer fixture requires a known viewport');
  for (;;) {
    const result = await readResult();
    if (result) return result;
    if (now() - start >= timeoutMs)
      throw new Error('Native pointer fixture timed out');
    const instruction = await readInstruction();
    if (instruction && !seen.has(instruction.id)) {
      const pointInViewport = (point) =>
        Number.isFinite(point?.x) &&
        Number.isFinite(point?.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x < viewport.width &&
        point.y < viewport.height;
      if (
        instruction.kind !== 'drag' ||
        typeof instruction.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(instruction.id) ||
        !pointInViewport(instruction.from) ||
        !pointInViewport(instruction.to) ||
        !Number.isSafeInteger(instruction.steps) ||
        instruction.steps < 1 ||
        instruction.steps > 60 ||
        seen.size >= 64
      )
        throw new Error('Invalid native pointer fixture instruction');
      seen.add(instruction.id);
      const action = {
        id: instruction.id,
        from: { ...instruction.from },
        to: { ...instruction.to },
        steps: instruction.steps,
        startedElapsedMs: now() - start,
        status: 'started',
      };
      actions.push(action);
      let pressed = false;
      try {
        await mouse.move(instruction.from.x, instruction.from.y);
        pressed = true;
        await mouse.down();
        await mouse.move(instruction.to.x, instruction.to.y, {
          steps: instruction.steps,
        });
        await mouse.up();
        pressed = false;
        action.status = 'dispatched';
      } catch (error) {
        action.status = 'failed';
        action.error = String(error.message).slice(0, 500);
        throw error;
      } finally {
        if (pressed) {
          // A failed move must not leave a button held in the owned browser.
          try {
            await mouse.up();
          } catch (error) {
            action.releaseError = String(error.message).slice(0, 500);
          }
        }
        action.finishedElapsedMs = now() - start;
      }
    }
    await delay(100);
  }
}
