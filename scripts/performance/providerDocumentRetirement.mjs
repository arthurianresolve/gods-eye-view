/**
 * Close one measured provider document only after its final observations.
 * Retiring its render loop first keeps fixture interception active while the
 * document is still capable of issuing requests. No stage may proceed after
 * retirement is unconfirmed.
 */
export async function retireProviderDocument({
  retireRenderer,
  auditWorkers,
  disposeProgressBinding,
  releaseInterception,
  closeDocument,
}) {
  for (const [name, operation] of [
    ['renderer retirement', retireRenderer],
    ['worker audit', auditWorkers],
    ['progress binding disposal', disposeProgressBinding],
    ['fixture interception release', releaseInterception],
    ['document close', closeDocument],
  ]) {
    if (typeof operation !== 'function')
      throw new TypeError(`Provider document ${name} callback is required.`);
    const result = await operation();
    if (name === 'renderer retirement' && result !== true)
      throw new Error(
        'Provider document renderer retirement was not confirmed.',
      );
  }
  return { retired: true, closed: true };
}
