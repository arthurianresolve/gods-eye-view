import { createHash } from 'node:crypto';
import { safeReferenceUrl } from '../../../src/evidence/evidence.js';

// No verified current provider samples have been supplied. Never guess hashes
// from repeated frames or manufacture a production fingerprint from a fixture.
export const VERIFIED_PLACEHOLDERS = Object.freeze([]);

/** Exact, provider-scoped matches only; metadata records the verification trail. */
export function createPlaceholderMatcher(entries = VERIFIED_PLACEHOLDERS) {
  if (!Array.isArray(entries) || entries.length > 256)
    throw new TypeError('Placeholder registry must be a bounded list.');
  const providers = new Map();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.provider !== 'string' ||
      !entry.provider.trim() ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || '') ||
      !Number.isFinite(Date.parse(entry.verifiedAt || '')) ||
      !safeReferenceUrl(entry.exampleUrl)
    )
      throw new TypeError(
        'Placeholder fingerprints require a provider, SHA-256, verification date and public example URL.',
      );
    const hashes = providers.get(entry.provider) || new Set();
    hashes.add(entry.sha256);
    providers.set(entry.provider, hashes);
  }
  return (provider, bytes) => {
    const hashes = providers.get(provider);
    return Boolean(
      hashes &&
      bytes &&
      hashes.has(createHash('sha256').update(bytes).digest('hex')),
    );
  };
}
