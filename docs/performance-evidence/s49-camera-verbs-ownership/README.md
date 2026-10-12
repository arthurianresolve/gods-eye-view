# S49 shared camera-verb ownership

The repair is implemented at dev `4d077c7f558444b0cce6a1d889eb986315597b5b` (review branch
`58205d2b33367d6d8c556f515190b2d437ce1723`). Shared Voice and Directions consumers keep one registration
per viewer. The application scene owner releases camera motion, the render hold,
the clock listener and both input handlers before destroying that viewer.
Replacement clears old motion; a registration token also rejects callbacks and
deferred camera/route starts or stops from a retired registration, including
dispose/reinitialize of the same viewer object.

This is inherited behavior: `src/cameraVerbs.js` is byte-identical at recorded
upstream `591f299d11f38a612629a274463196d57ae3862e` and baseline
`6cc3cd0f5c69555640a64bd958819056d27fa43c`, SHA-256
`c75702426300dd14ed32c5fad3ce7616a57cabce509f0d33384d99570373a35d`.

Root replayed the same [independent reproduction](reproduce.mjs) using real
Cesium.Event instances and minimal camera/canvas owners:

| Observation | Original | Candidate |
| --- | ---: | ---: |
| Motion carried into replacement | active | none |
| Camera writes before a new motion is requested | 1 | 0 |
| Writes caused by a copied old tick callback | 1 | 0 |
| New motion survives copied old input callback | no | yes |
| Old registered tick/input handlers remaining | 0 / 0 | 0 / 0 |

[Original observations](original.json) fail the expected ownership assertions;
[candidate observations](candidate.json) pass. Exact source hashes are retained
in both files and [review metadata](review.json). Reproduce from a repository
root with `node docs/performance-evidence/s49-camera-verbs-ownership/reproduce.mjs . output.json`;
pass an old checkout as the first argument for the negative control.

All [180 focused checks](focused-tests.txt) pass, covering shared consumers,
replacement, same-viewer reinitialization, late callbacks, deferred starts/stops,
render-hold release, production scene cleanup ordering and continued teardown
after a listener-removal failure, plus existing route, handoff and action tests.
Formatting, syntax, import directions and package boundaries pass. Standard
integration CI is pending for this revision.

Code is implemented and focused automatic validation passes. Hardware validation
and full S49/S55/S60 acceptance remain pending. This proves a specific ownership
defect and repair; it does not establish the historical Windows frame stall's
cause or explain the entire earlier listener/heap growth.
