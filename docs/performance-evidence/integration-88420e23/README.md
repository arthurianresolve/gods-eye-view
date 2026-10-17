# Standard v3 integration passes at 88420e23

[Run 38410018148](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38410018148)
passes all seven selected jobs at exact revision
`88420e2372c68268f6aa0b8cd39d081759571c37`: Node 24/26 full suites and builds,
Windows onboarding, Windows/macOS/Linux installation and persisted-profile
recovery, and the complete standard browser journey job.

The three operating-system recovery jobs also run the v3 map fixture tests.
They verify the same manifest hash
`fdd277b9107d59a8efd96a151b5f9770e646bbe6598f73ef862b6c5a50cbd6ac`,
pinned imagery bytes, pixel mapping, mutation isolation and native Cesium
parser compatibility. This establishes cross-platform automatic validation of
the v3 corpus, including the level-13-through-15 extension.

The [unaltered terminal summary](run-summary.json) records all job and step
results, URLs and revision: 24,836 bytes, SHA-256
`050bde483faa97069829649890d7ff183632f19af971507e8feb638113d6e384`.
Optional native/soak jobs were not selected. The published layer-token check is
skipped for this manual standard dispatch; no new pull-request check is claimed.

The separate [native map run](../s47-map-streaming/native-38409997486/README.md)
at the same commit fails on eleven missing lower-level imagery requests.
Standard success does not override that result, verify the later construction
fallback retry correction, or establish physical Windows/performance acceptance.
