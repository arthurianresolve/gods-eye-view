const TARGET_ALREADY_ABSENT_MESSAGE =
  'Protocol error (Target.closeTarget): No target with given id found';

export function isReceiptOnlyTargetAlreadyAbsentError(error) {
  return String(error?.message || '').trim() === TARGET_ALREADY_ABSENT_MESSAGE;
}

export async function closeReceiptOnlyAuditPage(page) {
  if (!page || typeof page.isClosed !== 'function')
    throw new Error('Receipt-only audit page owner is unavailable.');
  if (page.isClosed())
    return {
      status: 'already-closed',
      confirmed: true,
    };
  try {
    await page.close();
  } catch (error) {
    if (!isReceiptOnlyTargetAlreadyAbsentError(error)) throw error;
    return {
      status: 'target-already-absent',
      confirmed: true,
    };
  }
  if (!page.isClosed())
    throw new Error('Receipt-only audit page closure was not confirmed.');
  return {
    status: 'closed',
    confirmed: true,
  };
}
