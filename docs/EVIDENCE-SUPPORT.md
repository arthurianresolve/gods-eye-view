# Evidence support status

S00–S07 establish the shared envelope, aircraft adapters, feed vocabulary and
inspector. A layer can have a useful common feed state without yet having
observation-level provenance. The inspector only opens for records carrying a
versioned evidence envelope; unsupported selections close it instead of showing
an empty-looking all-clear.

| Source family | Current support | Remaining work |
| --- | --- | --- |
| Civil aircraft | Per-record position time, local receipt and feed-snapshot time; provider source; smoothed/interpolated or dead-reckoned display method; query reference and regional scope; analyst-result evidence can be pinned | Carry explicit provider license and accuracy metadata when available. |
| Military aircraft | Same envelope and separate position/feed timestamps; known provider homepage for recognized feed labels; analyst-result evidence can be pinned | Preserve richer fallback provenance where the selected record does not name the active feed. |
| Live vessels | Per-record AIS position time and local receipt, MMSI source reference, AISStream attribution, sparse-report limitation and explicit partial coverage; selected and analyst-result evidence can be inspected or pinned | Carry a provider-supplied geographic coverage shape and explicit license metadata when available. |
| Satellites | Propagated display position is distinct from source elements in the implementation | Surface TLE/OMM element epoch and propagation time before exposing object evidence. |
| Weather and wind | Shared feed state; weather already reports selected observation time; wind UI distinguishes model issue and valid times | Attach forecast/observation evidence to query results and selected raster/model cells; keep missing frames as gaps. |
| Cameras, traffic, fires, earthquakes and imported/static data | Common feed-state and compact snapshot metadata only | Add per-family acquisition time, coverage, still/forecast/fallback labeling, attribution and retention policy. |

`no-coverage` is classified as partial, not nominal. `empty` remains a valid
successful empty result only when the source does not explicitly report missing
geographic coverage. A generic refresh timestamp is not treated as observation
time. Do not infer uncertainty, source license, or retention permission from a
provider label.
