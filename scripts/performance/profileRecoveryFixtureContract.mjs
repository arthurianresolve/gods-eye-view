import { createHash } from 'node:crypto';

export const PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT =
  'Persisted public investigation notes\n';

export const PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256 = createHash('sha256')
  .update(PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT, 'utf8')
  .digest('hex');
