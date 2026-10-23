/** Own file reads by both selected file and the workspace active at selection. */
export function createWorkspaceImportReadOwner() {
  let generation = 0;
  let currentFile = null;

  return Object.freeze({
    begin(file, { workspaceId = null, workspaceGeneration = 0 } = {}) {
      generation++;
      currentFile = file;
      return Object.freeze({
        generation,
        file,
        workspaceId,
        workspaceGeneration,
      });
    },
    isCurrent(
      owner,
      { workspaceId = null, workspaceGeneration = 0, disposed = false } = {},
    ) {
      if (
        disposed ||
        !owner ||
        owner.generation !== generation ||
        owner.file !== currentFile
      )
        return false;
      // A preview started before selecting a destination remains valid. Reads
      // started inside a workspace belong to that workspace generation.
      return (
        owner.workspaceId == null ||
        (owner.workspaceId === workspaceId &&
          owner.workspaceGeneration === workspaceGeneration)
      );
    },
    invalidate() {
      generation++;
      currentFile = null;
    },
  });
}

/** Suppress late file-read success and rejection after ownership is lost. */
export async function readOwnedWorkspaceFile(file, isCurrent) {
  try {
    const text = await file.text();
    return isCurrent() ? { status: 'ready', text } : { status: 'superseded' };
  } catch (error) {
    return isCurrent() ? { status: 'failed', error } : { status: 'superseded' };
  }
}

/** Read bytes for the bounded import decoder without publishing stale files. */
export async function readOwnedWorkspaceBytes(file, isCurrent) {
  try {
    if (typeof file?.arrayBuffer !== 'function')
      throw new TypeError('Import file does not expose arrayBuffer().');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return isCurrent() ? { status: 'ready', bytes } : { status: 'superseded' };
  } catch (error) {
    return isCurrent() ? { status: 'failed', error } : { status: 'superseded' };
  }
}
