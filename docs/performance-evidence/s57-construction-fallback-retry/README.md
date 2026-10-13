# Explicit source selection recovers after construction fallback

Correction `e5ff5303` (source `6cb55a5d`) fixes a provider-cache ownership error:
after Esri construction failed, its successful OSM fallback was stored under
both source IDs. A later explicit Esri selection reused the fallback indefinitely,
even after Esri became available. Users had to reload to try constructing Esri
again.

Root independently ran the new recovery regression against the unmodified
controller at `88420e23`. It failed at the retry assertion: the Esri factory was
called once when two calls were required. The affected `_getImageryProvider`
body is byte-identical in frozen baseline `eb8c682`, fork main
`8b8ccc9a`, refreshed upstream main `9beadbda` and dev `e8ccc268`. The extracted body between its declaration and
`_watchProvider` has SHA-256
`0c045106b0657541536656964dde95fd28656de70514e2fd3f85e668bc84a21d`.
This defect predates the current QA work.

The correction removes only the failed requested-source alias after fallback
resolution. Promise identity prevents an old completion from evicting a newer
cache entry. The actual fallback provider retains its own cache ownership;
healthy providers still reuse their existing entries. The change does not add
background retries. A later explicit source selection may retry construction.

Root passes all 50 map tests, including the 30 controller cases. The new tests
exercise concurrent failed selections sharing one request, a second explicit
failure using the same live OSM provider, eventual Esri recovery, healthy cache
reuse, and destruction while fallback construction is pending. The late provider
is disposed exactly once and cannot activate after destruction. Existing tests
cover stale generations, terrain supersession, source attribution and imagery
comparison ownership.

This is a reviewed production correction with focused automatic coverage.
Exact-commit integration and a native browser fault/recovery journey remain
pending. It does not resolve the separate synthetic map imagery coverage gap
or complete S57 performance, retention or hardware acceptance.
