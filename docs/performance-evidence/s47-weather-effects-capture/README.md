# S47 weather/effects capture integration

This packet adds the opt-in `austin-weather-effects-v1` workload to the existing full-application capture CLI and its hosted build smoke. The default dense workload and application rendering defaults are unchanged.

## Implemented scope

The fixture supplies hash-pinned radar, regional-cloud and lightning history at 11:50, 11:55 and 12:00 UTC on 8 October 2026, plus a fixed GFS field. It serves only exact same-origin fixture routes. The application selects each history frame through its existing timeline controls and starts native playback with wind animation enabled. Harness wall time and Cesium time stay fixed at 12:00; source observations keep their actual historical timestamps.

The report records the observed Austin camera, source populations, weather/wind parameters and before/after state. Delivery evidence binds response bytes to the fixture and accepts increasing cumulative request counts while rejecting decreases, altered hashes and counts beyond the final aggregate. Validation requires all four ordered samples, complete source timestamps, exact fixed clocks, and owned worker/document cleanup.

Pending delivery waits are abortable and release timers/listeners on cancellation or disposal. Existing producer helpers supply CLI expectations and lifecycle evidence to regression fixtures, reducing producer/validator contract drift.

## Validation

Root independently ran five focused Node 24.16.0 suites: **59 passed, zero failures, zero skips**. The [validation record](local-validation.json) contains the exact command, source hashes, log hash and timing; the [raw log](local-validation.log.gz) is compressed without editing. Source hashes were unchanged during the run. Luna also checked formatting, syntax, import directions and package boundaries.

Hosted application validation and the new standard CI run are pending. Local source/contract checks do not prove that the full browser journey passes.

## Remaining scope

This is a short integration diagnostic, always ineligible for performance acceptance or matched comparison. Native two-second playback is not a deterministic matched history route. S47 still requires five matched 30-second warmup/60-second measurement runs, complete weather/effects coverage, the Austin operating and map-streaming workloads, negative controls and physical Windows evidence. S58 and S60 remain partial. No performance benefit or hardware acceptance is claimed.
