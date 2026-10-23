test('S52 placement behavior restores choices after occlusion, visibility, and anchor-radius changes', (t) => {
  const env = installMockEnvironment({
    width: 400,
    height: 300,
    dpr: 1,
    occluderRect: { left: 2, top: 2, width: 12, height: 12 },
  });
  t.after(() => env.cleanup());
  initWorldOverlay(env.viewer);

  let anchor = positionAtScreen(205, 128);
  const entry = selectedEntry('placement-behavior', {
    position: () => anchor,
    title: 'PLACEMENT BEHAVIOR',
    interactive: true,
    anchorRadiusPx: 0,
    minAnchorGapPx: 0,
    anchorGapPaddingPx: 0,
    gapPx: 12,
    leaderOffsetPx: 0,
    placement: 'auto',
  });
  setOverlayEntries('s52-placement-behavior', [entry]);

  const capture = () => {
    env.postRender.raise();
    const liveRect = getOverlayPaintRect(
      's52-placement-behavior',
      'placement-behavior',
    );
    const rect = liveRect && {
      x: liveRect.x,
      y: liveRect.y,
      w: liveRect.w,
      h: liveRect.h,
      anchorX: liveRect.anchorX,
      anchorY: liveRect.anchorY,
    };
    const hit =
      liveRect &&
      hitTestWorldOverlay(
        liveRect.x + liveRect.w / 2,
        liveRect.y + liveRect.h / 2,
        {
          sourceId: 's52-placement-behavior',
        },
      );
    return { rect, hit };
  };

  const initial = capture();
  assert.ok(initial.rect && initial.hit?.entryId === 'placement-behavior');
  const liveEntry = initial.hit.entry;
  liveEntry.anchorRadiusPx = 18;
  liveEntry.minAnchorGapPx = 3;
  liveEntry.anchorGapPaddingPx = 5;
  const radiusGeometry = capture();
  assert.ok(
    radiusGeometry.rect && radiusGeometry.hit?.entryId === 'placement-behavior',
  );
  assert.notDeepEqual(
    { x: radiusGeometry.rect.x, y: radiusGeometry.rect.y },
    { x: initial.rect.x, y: initial.rect.y },
    'anchor radius and its derived gap/leader offset change the actual chosen geometry',
  );

  const title = env.document.getElementById('title-bar');
  const beforeOcclusion = radiusGeometry.rect;
  title._rect = {
    left: beforeOcclusion.x - 8,
    top: beforeOcclusion.y - 8,
    width: beforeOcclusion.w + 16,
    height: beforeOcclusion.h + 16,
  };
  for (const observer of env.mutationObservers) {
    observer.callback([{ type: 'attributes', target: title }]);
  }
  env.advanceTime(120);
  const obstructed = capture();
  assert.ok(
    obstructed.rect && obstructed.hit?.entryId === 'placement-behavior',
  );
  assert.notDeepEqual(
    { x: obstructed.rect.x, y: obstructed.rect.y },
    { x: beforeOcclusion.x, y: beforeOcclusion.y },
    'current UI occlusion can reject the prior placement and choose another valid one',
  );

  title._rect = { left: 2, top: 2, width: 12, height: 12 };
  for (const observer of env.mutationObservers) {
    observer.callback([{ type: 'attributes', target: title }]);
  }
  env.advanceTime(120);
  const restoredAfterOcclusion = capture();
  assert.deepEqual(
    { x: restoredAfterOcclusion.rect.x, y: restoredAfterOcclusion.rect.y },
    { x: beforeOcclusion.x, y: beforeOcclusion.y },
    'the full candidate set is available again when the occluder moves away',
  );
  assert.equal(restoredAfterOcclusion.hit?.entryId, 'placement-behavior');

  anchor = positionAtScreen(650, 270);
  const offscreen = capture();
  assert.equal(offscreen.rect, null);
  assert.equal(
    hitTestWorldOverlay(beforeOcclusion.x + 1, beforeOcclusion.y + 1, {
      sourceId: 's52-placement-behavior',
    }),
    null,
    'an offscreen entry publishes no stale hit target',
  );

  anchor = positionAtScreen(205, 128);
  const visibleAgain = capture();
  assert.deepEqual(
    { x: visibleAgain.rect.x, y: visibleAgain.rect.y },
    { x: beforeOcclusion.x, y: beforeOcclusion.y },
    'the same dynamic entry restores the same geometry and hit after returning onscreen',
  );
  assert.equal(visibleAgain.hit?.entryId, 'placement-behavior');
});

test('S52 placement behavior restores ambient eligibility after a protected footprint moves', (t) => {
  const env = installMockEnvironment({ width: 800, height: 600, dpr: 1 });
  t.after(() => env.cleanup());
  initWorldOverlay(env.viewer);

  let protectedPosition = positionAtScreen(260, 180, 800, 600);
  const ambientPosition = positionAtScreen(260, 180, 800, 600);
  setOverlayEntries(
    'ambient-placement',
    [
      selectedEntry('ambient', {
        position: ambientPosition,
        title: 'AMBIENT',
        interactive: true,
        selected: false,
        protected: false,
        collisionGroup: 'ambient-card',
        verticalOnly: true,
        placement: 'auto',
      }),
    ],
    { cohortLimit: 1, collisionCapacity: 1, moving: true, solveIntervalMs: 16 },
  );

  const capture = () => {
    env.postRender.raise();
    env.advanceTime(200);
    env.postRender.raise();
    const liveRect = getOverlayPaintRect('ambient-placement', 'ambient');
    const rect = liveRect && {
      x: liveRect.x,
      y: liveRect.y,
      w: liveRect.w,
      h: liveRect.h,
    };
    const hit =
      liveRect &&
      hitTestWorldOverlay(
        liveRect.x + liveRect.w / 2,
        liveRect.y + liveRect.h / 2,
        {
          sourceId: 'ambient-placement',
        },
      );
    return { rect, hit };
  };
  const intersects = (a, b) =>
    a &&
    b &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;

  const unprotectedChoice = capture();
  assert.ok(
    unprotectedChoice.rect && unprotectedChoice.hit?.entryId === 'ambient',
  );

  const protectedEntry = selectedEntry('tracked', {
    position: () => protectedPosition,
    title: 'TRACKED',
    variant: 'tracked',
    tracked: true,
    selected: true,
    protected: true,
    paintLane: 'tracked',
    collisionGroup: 'ambient-card',
    verticalOnly: true,
  });
  setOverlayEntries('tracked-placement', [protectedEntry], {
    cohortLimit: 1,
    collisionCapacity: 0,
  });
  const protectedFrameChoice = capture();
  const protectedRectLive = getOverlayPaintRect('tracked-placement', 'tracked');
  const protectedRect = protectedRectLive && {
    x: protectedRectLive.x,
    y: protectedRectLive.y,
    w: protectedRectLive.w,
    h: protectedRectLive.h,
  };
  assert.ok(protectedRect, 'the protected owner publishes its footprint');
  assert.equal(
    intersects(unprotectedChoice.rect, protectedRect),
    true,
    'the protected footprint vetoes the previous ambient option',
  );
  assert.ok(
    protectedFrameChoice.rect &&
      protectedFrameChoice.hit?.entryId === 'ambient',
    'the unchanged ambient entry remains eligible through its other placement options',
  );
  assert.equal(
    intersects(protectedFrameChoice.rect, protectedRect),
    false,
    'the ambient choice does not cover the protected card',
  );

  // Move the protected rectangle over the only surviving ambient alternative.
  // This forces the unchanged entry to restore its previously filtered choice.
  const shift = protectedFrameChoice.rect.y - protectedRect.y;
  protectedPosition = positionAtScreen(260, 180 + shift, 800, 600);
  const movedProtectedFrameChoice = capture();
  const movedProtectedRectLive = getOverlayPaintRect(
    'tracked-placement',
    'tracked',
  );
  const movedProtectedRect = movedProtectedRectLive && {
    x: movedProtectedRectLive.x,
    y: movedProtectedRectLive.y,
    w: movedProtectedRectLive.w,
    h: movedProtectedRectLive.h,
  };
  assert.ok(
    movedProtectedRect,
    'the moved protected owner still publishes its footprint',
  );
  assert.equal(
    intersects(protectedFrameChoice.rect, movedProtectedRect),
    true,
    'the moved owner now vetoes the formerly surviving alternative',
  );
  assert.ok(
    movedProtectedFrameChoice.rect &&
      movedProtectedFrameChoice.hit?.entryId === 'ambient',
    'the same ambient entry remains painted and pickable after protected options are restored',
  );
  assert.notDeepEqual(
    movedProtectedFrameChoice.rect,
    protectedFrameChoice.rect,
    'the filtered choice is restored without replacing or moving the ambient entry',
  );
  assert.equal(
    intersects(movedProtectedFrameChoice.rect, movedProtectedRect),
    false,
    'the restored ambient placement remains clear of the moved protected footprint',
  );
});
