import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256,
  PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT,
} from './profileRecoveryFixtureContract.mjs';

test('workspace asset digest matches the exact UTF-8 bytes seeded by recovery', () => {
  const serializedAsset = new TextEncoder().encode(
    PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT,
  );
  const measuredDigest = createHash('sha256').update(serializedAsset).digest('hex');
  assert.equal(measuredDigest, PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256);
  assert.equal(
    measuredDigest,
    '0de37a471d02bb57a555ac30082025624f55ddc576d312db772d9deb62f66fcc',
  );
});
