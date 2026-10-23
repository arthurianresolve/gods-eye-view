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
| Satellites | Tracked-object and analyst snapshots expose the TLE element epoch and position evaluation time separately; propagated coordinates are labeled predicted, feed refresh remains separate, and catalog coverage is explicitly partial | Expose provider accuracy/license metadata when available. |
| Weather, wind and cyclones | Open-Meteo query results identify their current grid value as predicted/interpolated, with valid time and local receipt kept separate. Wind grid samples and `get_wind` results carry model source, issue time, valid time, grid scope and explicit forecast limitations. NOAA NHC/CPHC cyclone analyst and tool records carry advisory position and issue times, receipt/snapshot times, source links and partial basin coverage. | Weather-map image results and selected radar/satellite cells do not yet have a shared evidence envelope. The available imagery frame time remains visible; missing frames stay gaps. |
| Active fires and earthquakes | NASA FIRMS detections retain acquisition time, source snapshot time, local receipt, per-feed partial status and source attribution in analyst rows and selected fire context. USGS events retain event, generated snapshot and local receipt times in analyst rows. | Fire-perimeter records and source-supplied license/retention metadata remain unsupported. |
| Cameras | Shared inspector and persisted evidence expose agency identity, transport/decode health, attempt/success times, still fallback and synthetic placeholder state. Conclusions expire; receipt/decode are separate from capture time. | Reliable acquisition time, geographic coverage and retention permission stay unknown unless supplied. Verified current production fingerprints and agency spot checks remain pending. |
| Road traffic | Shared feed state and compact snapshot metadata; no record-level evidence envelope. | TomTom traffic observations, tile coverage and source observation time remain unsupported. |
| Imported/static infrastructure | Imported features preserve supplied provenance. Bundled datacenter and dam map selections and analyst results carry stable identity, OSM/OpenInfraMap attribution and ODbL. Legacy query IDs remain supported; extraction/observation dates stay unknown. | Military installations, cables, routes and annotations still need shared evidence adapters. Do not infer retention permission from local availability. |

`no-coverage` is classified as partial, not nominal. `empty` remains a valid
successful empty result only when the source does not explicitly report missing
geographic coverage. A generic refresh timestamp is not treated as observation
time. Wind and Open-Meteo evidence leave `observedAt` empty and keep model valid
time separate; missing issue, license, uncertainty and retention metadata stay
unknown. Do not infer those values from a provider label.

Public references are optional and limited to eight per evidence item. The inspector
previews a Wayback capture before attachment and separates capture/observation time.
Pin updated evidence in a workspace to retain references through reload, profile
transfer and all comparison formats, including unchanged records. PeeringDB links
are explicitly user-linked, with no inferred match or data ingestion. Archived
pages open externally; page bodies and camera images are not stored.
