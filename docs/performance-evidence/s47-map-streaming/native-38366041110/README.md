# Native map live terrain ancestry

[Run 38366041110](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38366041110)
fails at exact candidate/harness `7fbbf1fa56fe3d9c746827be0b501b7b31cfb87e`.
The baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`; the candidate
journey does not run. Hosted SwiftShader is not physical-hardware evidence.

The [raw report](performance-build-smoke.json) is 41,249 bytes, SHA-256
`de9b0814abfc68db0b55129d2455e0c28c8aa518c6ac05d9ca52031ec27a297b`.
Artifact `11797500750` (`performance-build-smoke-38366041110`) has archive
digest `2d049efd4821660f88662c812534604443603792c9f7a55ab32cc515ba11fc90`.

## Observed boundary

Initial photoreal readiness passes. The first Esri switch reaches the ready
map controller and native terrain/imagery providers, but the required ready
renders do not complete within the unchanged limit. The failed journey lasts
57,408 ms; the final route checkpoint is at 48,731.6 ms. Page and interception
error lists are empty. All 51 fixture requests are acknowledged, with zero
pending, cancelled or errored deliveries.

The globe has 47 medium- and 21 low-priority queued tiles, zero high-priority
tiles and 12 rendered tiles. The first queued sample remains
`(59940,43502,17)`. Its complete 18-row ancestor chain is retained without
truncation, cycles or unsupported fields:

| Tile | Terrain state | Observed ownership |
| --- | --- | --- |
| `(59940,43502,17)` | `FAILED` (0) | No terrain data or mesh; waiting on parent is permitted by the pinned state machine |
| `(29970,21751,16)` | `TRANSFORMING` (4) | Terrain data exists, but its mesh and the surface mesh are absent; `canUpsample` is false |
| Level 15 through level 0 ancestors | `READY` (6) | Both meshes exist and `canUpsample` is true |

The pinned `GlobeSurfaceTile.transform` sets `TRANSFORMING` after receiving a
mesh promise, then sets `TRANSFORMED` on fulfillment or `FAILED` on rejection.
This locates an outstanding mesh preparation boundary at level sixteen in
the final snapshot. It does not establish when that task began, how long it
has been outstanding, or whether it is abandoned. The independently passing
[source/minified CPU replay](../native-38361544218/terrain-chain-probe.json)
does not test browser scheduling or transport.

## Cleanup and next discrimination

Operation disposal is confirmed. Probe cleanup takes 4.863 ms within its
one-second bound; both owned listeners are removed, the hook restored, the
render loop retired and the future-document registration removed. Context
closure and interception retirement are confirmed, with zero owned pending
commands, preparations, abort subscriptions or unexpected late requests.

The next check must distinguish continued terrain progress under the moving
camera from a persistently unresolved mesh promise. Prefer bounded temporal
observations and existing worker diagnostics before introducing additional
instrumentation. No timeout increase, readiness relaxation, terrain detail
change or engine patch is justified by this single snapshot. The run remains
failed and does not complete M3, S47 or hardware acceptance.
