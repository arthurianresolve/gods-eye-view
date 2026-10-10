import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const POSITION_TOLERANCE_M = 1e-6;
const ORIENTATION_TOLERANCE = 1e-12;

function vectorEquivalent(actual, expected, tolerance) {
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object'
  )
    return false;
  for (const axis of ['x', 'y', 'z']) {
    if (
      !Number.isFinite(actual[axis]) ||
      !Number.isFinite(expected[axis]) ||
      Math.abs(actual[axis] - expected[axis]) > tolerance
    )
      return false;
  }
  const extra = (value) => {
    const copy = { ...value };
    delete copy.x;
    delete copy.y;
    delete copy.z;
    return copy;
  };
  return isDeepStrictEqual(extra(actual), extra(expected));
}

function transformEquivalent(actual, expected) {
  if (
    !Array.isArray(actual) ||
    !Array.isArray(expected) ||
    actual.length !== 16 ||
    expected.length !== 16
  )
    return false;
  return actual.every((value, index) => {
    const other = expected[index];
    const tolerance =
      index >= 12 && index <= 14 ? POSITION_TOLERANCE_M : ORIENTATION_TOLERANCE;
    return (
      Number.isFinite(value) &&
      Number.isFinite(other) &&
      Math.abs(value - other) <= tolerance
    );
  });
}

/** Compare route descriptors exactly except for bounded camera pose roundoff. */
export function routeDescriptorsEquivalent(actual, expected) {
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    !actual.start ||
    !expected.start
  )
    return false;
  const hasNonFiniteNumber = (value, seen = new WeakSet()) => {
    if (typeof value === 'number') return !Number.isFinite(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((entry) =>
      hasNonFiniteNumber(entry, seen),
    );
  };
  if (hasNonFiniteNumber(actual) || hasNonFiniteNumber(expected)) return false;
  const { start: actualStart, ...actualRoute } = actual;
  const { start: expectedStart, ...expectedRoute } = expected;
  if (!isDeepStrictEqual(actualRoute, expectedRoute)) return false;
  const startExtras = (start) => {
    const copy = { ...start };
    for (const key of ['position', 'direction', 'up', 'transform'])
      delete copy[key];
    return copy;
  };
  return (
    isDeepStrictEqual(startExtras(actualStart), startExtras(expectedStart)) &&
    vectorEquivalent(
      actualStart.position,
      expectedStart.position,
      POSITION_TOLERANCE_M,
    ) &&
    vectorEquivalent(
      actualStart.direction,
      expectedStart.direction,
      ORIENTATION_TOLERANCE,
    ) &&
    vectorEquivalent(actualStart.up, expectedStart.up, ORIENTATION_TOLERANCE) &&
    transformEquivalent(actualStart.transform, expectedStart.transform)
  );
}

export function assertRouteDescriptorsEquivalent(actual, expected, label) {
  if (routeDescriptorsEquivalent(actual, expected)) return;
  throw new assert.AssertionError({
    message: label || 'Route descriptors differ beyond camera pose roundoff.',
    actual,
    expected,
    operator: 'routePoseEquivalent',
  });
}
