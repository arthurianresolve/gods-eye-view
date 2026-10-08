import test from 'node:test';
import assert from 'node:assert/strict';
import { _syncCctvSourceBadge } from './cctvFrames.js';

test('a failed video source is labeled as a still fallback in the camera panel', () => {
  const badge = { textContent: '', dataset: {} };
  _syncCctvSourceBadge.call(
    {
      _cctvSourceBadge: badge,
      _cctvFrameWrap: { classList: { contains: () => true } },
      _cctvFrame: { dataset: {} },
    },
    { feedType: 'hls', sourceStatus: 'nominal', videoFallback: true },
    true,
  );
  assert.equal(badge.textContent, 'STILL FRAME · FALLBACK');
  assert.equal(badge.dataset.frameState, 'fallback');
  assert.doesNotMatch(badge.textContent, /LIVE|HLS|VIDEO/i);
});
