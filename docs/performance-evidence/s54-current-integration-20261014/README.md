# Datacenter candidate integrated into current QA

Commit `352d985dfa643852523636810ac793fd70e17cb9` ports only the five reviewed runtime/test files from
`5ba9a940`. All five are byte-identical to that candidate. The factory's
`datacenterSurfaceRenderer` service enables the collection option only for
datacenters. Default datacenters and all dams/cables retain Entity rendering.
Rejected dam/cable runtime changes are excluded.

The collection owner preserves Entity-backed evidence and pick identities,
point/stem appearance, horizon/LOD updates, height placement and rollback.
Current focused tests pass 97/97, including stable identities, native Cesium
collection ownership, partial attachment failure, teardown, re-enable, analyst
queries and package import/build behavior. [Review and source hashes](review.json)
bind this integration. The existing hosted component correctness and benefit
reports retain their original revisions and narrower scope.

Current rendered integration, mixed-layer behavior, physical Windows validation
and final retention remain pending. This port makes the candidate available for
those checks; it does not adopt the optional renderer by default or close S54.
