const clone = (value) => (value == null ? null : structuredClone(value));

/** Bind one Austin document's fixture delivery to its owned CDP-session release. */
export function createAustinOperatingDocumentEvidence({
  documentRole,
  documentId,
  sessionOrdinal,
  delivery,
  releaseRecords,
  disposed,
  disposeReason,
  error,
} = {}) {
  const validIdentity =
    typeof documentRole === 'string' &&
    documentRole.trim().length > 0 &&
    typeof documentId === 'string' &&
    documentId.trim().length > 0 &&
    Number.isSafeInteger(sessionOrdinal) &&
    sessionOrdinal > 0;
  const matches = Array.isArray(releaseRecords)
    ? releaseRecords.filter(
        (record) =>
          record?.documentRole === documentRole &&
          record?.documentId === documentId &&
          record?.sessionOrdinal === sessionOrdinal,
      )
    : [];
  const release = matches.length === 1 ? matches[0] : null;
  const cleanupConfirmed =
    validIdentity &&
    disposed === true &&
    release?.confirmed === true &&
    release?.targetClosed === true &&
    release?.stop?.confirmed === true &&
    Number.isSafeInteger(release?.stop?.pendingAfterDrain) &&
    release.stop.pendingAfterDrain === 0 &&
    release?.interception?.confirmed === true;
  return {
    schema: 'gev-austin-operating-document-evidence/v1',
    documentRole: typeof documentRole === 'string' ? documentRole : null,
    documentId: typeof documentId === 'string' ? documentId : null,
    sessionOrdinal: Number.isSafeInteger(sessionOrdinal)
      ? sessionOrdinal
      : null,
    disposed: disposed === true,
    disposeReason: typeof disposeReason === 'string' ? disposeReason : null,
    delivery: clone(delivery),
    interceptionRelease: clone(release),
    cleanup: {
      status: cleanupConfirmed ? 'confirmed' : 'incomplete',
      confirmed: cleanupConfirmed,
      matchingReleaseCount: matches.length,
    },
    error: error
      ? {
          name: String(error.name || 'Error').slice(0, 80),
          message: String(error.message || error).slice(0, 240),
        }
      : null,
  };
}
