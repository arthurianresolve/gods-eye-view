# Implementation baseline for slices S00–S07

Captured against commit `3f73b92dc61d582afad70a39b14f30bea1a0ab95` on branch
`dev` (2026-10-08). This records the code and available validation paths before
the first implementation slices. It is not a fresh runtime or hardware capture.

## Existing repeatable evidence

| Journey | Existing owner | Current evidence |
| --- | --- | --- |
| App startup and composition | `scripts/qa-application.mjs`, `src/app/application.js` | Application lifecycle harness covers startup/teardown; Node matrix builds production app. |
| First use | `scripts/qa-firstrun.mjs` | Real-browser first-run entry point. |
| Failure states | `scripts/qa-failstate-b10.mjs` | Existing failure-state browser gate. |
| Tracking | `npm run test:track`, `scripts/qa-focus-evidence.mjs`, `scripts/qa-height-datum.mjs` | Data fixtures exist; the track gate needs a running candidate app. |
| Layer-source traces | `src/data/fixtures/README.md` | Fixtures include captured aircraft data and traffic examples with provenance/licensing notes. |
| Director imports/sharing | `scripts/qa-director-sharing.mjs`, `scripts/qa-director-packs.mjs` | Validated import, integrity and file sharing journeys exist. |
| Layer failures and transitions | `scripts/qa-weather-journey.mjs`, `scripts/qa-weather-swap.mjs`, `scripts/qa-weather-teardown.mjs`, `scripts/qa-cctv-v2.mjs` | Fixture-backed focused gates already exist for several important source families. |
| Browser evidence | `scripts/qa-browserEvidence.mjs` | Shared console/render error capture helper. |
| Performance | `docs/PERFORMANCE.md`, `scripts/qa-perf.mjs`, `scripts/qa-weather-perf.mjs` | The report records an M5 hardware capture; `qa-perf` exercises render-governor behavior and is not a general FPS benchmark. |
| CI | `.github/workflows/ci.yml` | Node 24/26 policy, format, boundary, unit and build gates; Windows onboarding; hermetic Street Level and panel browser gates. |

## Existing data semantics to preserve

- Civil flight snapshots expose an upstream `observedAtMs`; individual OpenSky
  state vectors can carry a separate position epoch and contact/message epoch.
- Military snapshots also expose an observation epoch. A record's position fix
  may predate the containing snapshot.
- Aircraft display state smooths and dead-reckons between reports. A rendered
  position is therefore not a fresh source observation.
- A failed refresh can leave prior records visible; an incomplete aircraft
  snapshot must not prove a contact absent.
- The feed classifier already emits `partial`. The layer snapshot roster and
  severity map do not currently enumerate that state; S02 must make all surfaces
  agree.
- Existing weather observation playback selects provider frames; forecast issue
  and valid times are separate. Director shot playback has an independent clock.
- Existing Director bundles permit bounded scene assets but are transient session
  state; S00–S07 do not change storage or publish new history claims.

## Standard local validation commands

```sh
npm run doctor -- --json
npm run format:check
npm run check:boundaries
npm test
npm run build
```

For a running application on port 4173, use the focused browser gate for each
changed behavior. Tracking changes also use `npm run test:track`. For hardware
performance, compare the same browser, renderer, resolution, data population,
camera path, warm-up and foreground state. Headless software rendering establishes
behavior only. Record a renderer and exact workload before writing an FPS claim.

## Known baseline gaps for this work

- There is no fixture-driven cross-source evidence inspector.
- The existing tracked readout is a world overlay and lacks a source-time
  inspector.
- `docs/PERFORMANCE.md` explicitly leaves Windows GPUs and several renderer paths
  unmeasured. Its capture artifacts are not part of the report.
- `scripts/qa-perf.mjs` uses deterministic render-count assertions for
  request-render mode; it does not report frame-time percentiles, startup stages,
  or a comparable multi-layer live-data population.
- CI currently checks the main branch on push and assumes `main` when checking
  layer-token allocations. S01 enables integration branch `dev` and compares a
  PR against its actual base branch.

