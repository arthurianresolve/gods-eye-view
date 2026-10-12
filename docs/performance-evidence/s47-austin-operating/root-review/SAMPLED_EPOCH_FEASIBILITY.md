# Satellite sampled-epoch feasibility

Root independently exercised the native satellite rendering and public controls
against all 828 identities in the pinned Austin TLE catalogs. The
[source](satellite-sampled-epoch-feasibility.mjs) uses the production phased clock
and simulated 16, 33 and 120 ms frame delivery. Point setters clone positions as
Cesium does; no browser, WebGL context, GPU or production setting is changed.

At each held boundary, the audit derives a candidate epoch from the public cached
ISS position by searching the preceding 1,000 integer milliseconds. It then checks
every observed position against a separate catalog propagated at that epoch. The
private native timestamp is used only afterward to check the feasibility result,
never as an input to derivation.

All six derived epochs equal native ground truth. Each fleet has 828 matching
positions; the greatest Cartesian residual is about 3.15 micrometers, below the
experimental 1 mm tolerance. Raw position hashes are retained and differ across
frame cadences. Missing and duplicate identities, a fleet older than its cadence,
a one-meter displacement, a mixed epoch, and a distinct wrong orbit are rejected.
The [raw report](satellite-sampled-epoch-feasibility.json) is 5,985 bytes with SHA-256
`ed7c70f1b14cbb4b74f3d4649064cace21a8ae2ba4069d3a0f8a5a709ca1e030`.

An initial wrong-orbit negative substituted ISS for POISK. Those two source
records share the same physical trajectory, so no position mismatch resulted.
The report records this correction and uses CSS versus ISS for the distinct-orbit
negative. Source hashes and identity validation remain independently necessary.

This is a feasibility result, not a benchmark change or acceptance. Browser versus
Node numerical behavior, immutable baseline compatibility, complete cached-position
capture, bounded serialization, and paired visual checks still need validation.
The satellite cadence blocker must remain until that integration passes. No
existing position checksum or source-identity requirement should be discarded.

# Subsequent hosted readiness failure

Run [38309379042](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38309379042)
at `eeb6dfdd7fad7eaf8b556ad542e250536c88f0af` passes the baseline smoke and initial
Austin scene setup. It then times out after the unchanged 60-second deadline in
`configure-austin-operating-sample-document` for the first fresh idle sample.
Both candidate documents acknowledge all 12 primary assets and 12 ALPR tiles;
cleanup is confirmed. There are no completed measurements. The report does not
identify which native layer failed readiness, so no further cause is claimed.

The [original failed report](hosted-smoke-38309379042-failed.json) is retained
byte-for-byte: 129,611 bytes, SHA-256
`46d168e2ee74defe091d586554aa0e8c1dae7377afebc5bbf052863c3fec4db7`.
Its truncated diagnostic envelope is not full performance evidence. A bounded
per-layer observation on readiness failure is the next diagnostic step; increasing
the deadline or relaxing readiness would not establish the cause.
