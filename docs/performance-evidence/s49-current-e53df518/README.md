# Current S49 lifecycle reproductions

Application and harness are clean frozen source
`e53df5188d1f416acd4c9319b6efb5d5b2068f65` throughout all three runs.

| Run | Environment | Result |
| --- | --- | --- |
| [Import/workspace 38507366933](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38507366933) | Linux Chrome 152 / SwiftShader | Five 512-record native import/clear cycles, five persisted workspace replacements, and five controlled cancellations/supersessions pass. Exact replacement IDs and empty/loaded scene checkpoints agree. |
| [CCTV 38507370727](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38507370727) | Linux Chrome / SwiftShader | Five toggles, disabled-module reinitialization and rapid geometry revisions pass with unchanged strict ownership/drain checks. |
| [Terrain/picking 38507373874](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38507373874) | Hosted macOS / paravirtual Metal | Five terrain cycles, ten streamed switches and three active/retired selection cycles pass. First terrain transition completes all 174 submitted jobs; cleanup leaves zero pending worker jobs and no owned map/cable resources. |

Root downloaded all three artifact ZIPs, verified their REST digests, bounded
extraction, and replayed all three unmodified report validators against the raw
JSON. Source/harness identities match the declared commit. Worker asset delivery
and task completion pass. Owned browsers close without forced termination.
Raw reports, metadata, compressed job logs and ZIPs are retained with
[hashes](files.json); [review.json](review.json) gives scoped summaries.

Raw browser listener totals are diagnostic: native import changes 599 to 609,
while workspace replacement changes 804 to 704. They are not application-owner
gauges or proof of a plateau. Point-in-time heap values have no forced-GC or
sixty-minute interpretation. Application-declared scene/queue/owner checkpoints
pass; no arbitrary Cesium listeners or shared workers were removed to lower
counters. Controlled supersession uses an explicitly labeled scheduler and does
not claim native timing.

This completes current short reproduction evidence for the engineering review.
It does not qualify the physical Windows full-application journeys or final
sixty-minute retention gate. Historical failures and unexplained prior Windows
frame/recovery failures remain recorded.
