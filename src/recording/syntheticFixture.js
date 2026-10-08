/** Deterministic source snapshots for recording, replay and retention tests. */
export function createSyntheticAircraftFrames({
  startAt = 0,
  sampleCount = 60,
  intervalMs = 60_000,
  center = { latitude: 0, longitude: 179.7 },
} = {}) {
  const frames = [];
  let previous = null;
  for (let index = 0; index < sampleCount; index++) {
    const observedAt = startAt + index * intervalMs;
    const longitude =
      ((((center.longitude + index * 0.01 + 180) % 360) + 360) % 360) - 180;
    const current = {
      id: 'SYNTH-001',
      observedAt,
      latitude: center.latitude + Math.sin(index / 10) * 0.02,
      longitude,
      altitudeM: 8000 + index * 3,
      velocityMps: 210,
      headingDeg: 90,
      callsign: 'SYNTHETIC',
    };
    const observations = [current];
    if (index === 1 && previous) observations.push({ ...previous });
    if (index === 2 && previous)
      observations.push({ ...previous, altitudeM: previous.altitudeM + 250 });
    if (index === 3)
      observations.push({
        ...current,
        id: 'SYNTH-OUTSIDE',
        latitude: 80,
        longitude: 20,
      });
    frames.push({ receivedAt: observedAt, observations });
    previous = current;
  }
  return frames;
}
