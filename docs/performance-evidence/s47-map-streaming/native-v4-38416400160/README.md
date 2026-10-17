# Native v4 delivery succeeds; candidate report validation fails

[Run 38416400160](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38416400160)
is **failed**, using application/harness `f50565a094d583820a661849d9b888c5a65b0ae8`
and baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. It uses the free standard
hosted macOS native diagnostic backend, not physical Windows qualification.
The workload selector remains `austin-map-streaming-v1`; its corpus is v4 with
manifest SHA-256 `0d739d9e4830faff2751d40945870eb7b56b9b76dc65e8cd64cb7deb5cb9b033`.

The baseline variant passes. Both native journeys record the prescribed
photoreal → Esri imagery → OSM → photoreal transitions. Baseline delivery records
236 acknowledgements from 236 requests; candidate main-document delivery records
237 from 237. Both have zero missing-path observations, pending requests or
delivery errors, with confirmed fixture cleanup. These are delivery observations;
the delivery object itself does not claim browser decode or rendered readiness.

The candidate capture CLI completed four samples in one measured document.
Its two owned documents are `startup-1` / `startup-document-1` and `main-setup` /
`main-measured-document`; both report confirmed renderer-probe cleanup. The outer
validator instead generates four additional `provider-sample-*` document identities
and fails with “Every owned capture document must have exactly one cleanup record.”
This identifies a producer/validator topology mismatch. Correcting it must retain
strict ownership, missing/duplicate cleanup, worker audit and delivery checks.
The failed run stays failed; a later corrected validator replay is a separate
result, and a new merged candidate needs a fresh run.

Preserved artifact 11824018400 contains the following original bytes:

| Artifact                                                                                          |  Bytes | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                                      | 361381 | `6c108652122ee9de703315834ec45ade96ac2d65be19619b1f6fbfcd414adc13` |
| [Completed candidate CLI sidecar](performance-build-smoke.json.capture-cli-report-candidate.json) | 392710 | `eedb5df55316c6460a3ff6837d7a125c626695fc4f9dad5c1dd8eb1e076dc0c9` |

The outer report's bounded inline summary omits the full CLI report; the sidecar
preserves it below the unchanged 8 MiB sidecar limit. This is not missing raw
evidence and is not a reason to relax artifact limits.
