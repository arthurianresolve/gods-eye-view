# Candidate gate at `0d0ac247`

This packet records the refreshed pre-release candidate gate after the
render-resolution harness correction. The raw result is
[`candidate-report.json`](candidate-report.json).

## Automatic result

- Candidate commit: `0d0ac247ac1bccd1e1041a176ea40583246df288`
- Pre-release status: `passed` with zero failures
- Required automatic checks passed: format, package boundaries, all 7,983
  ordinary tests (7,973 passed and 10 skipped), allocation, 13 performance
  suites, and the production build
- Publication phase has no failures but remains pending until a tagged,
  attested artifact is verified

The browser checks that had failed in the earlier report were rerun after a
forced Vite dependency re-optimization and all passed: workspace library,
public references, accessibility automation, evidence panel, panel resize,
and render-resolution. The latter is stabilized by bounded interval polling
in [`qa-render-resolution.mjs`](../../../scripts/qa-render-resolution.mjs).

## Scope boundary

The report remains `pending-evidence` because browser URL, platform-install,
60-minute soak, hardware-matrix, accessibility-review, and publication-tag
evidence are separate gates. This packet does not convert those external or
hardware requirements into passes.
