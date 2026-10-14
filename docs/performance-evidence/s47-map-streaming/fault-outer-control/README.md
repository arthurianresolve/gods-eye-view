# Fresh-document map fault control review

Root reviewed and integrated source commits `187ef40b` and `c1f5b26d` as
`9c0bdf44` and `cc3328e13acf6e056e876d8c844e22ad54fcf769`. The outer smoke runner now
owns three separate candidate browser contexts for the declared missing, corrupt
and delayed Esri metadata scenarios. It uses the existing page controls and
production map controller, then validates the actual renderer, fixture delivery,
worker bodies, build receipt, recovery observations and completed cleanup.

Each stage is bounded by the existing outer deadline; cleanup retains its reserve.
On a timed-out page evaluation the owned context is closed before attempting
page-side cleanup. Late context creation is also retired. The added blob-request
listener is removed on exit. The original baseline/candidate healthy journeys and
candidate capture CLI remain mandatory. These fault documents are diagnostic and
cannot serve as performance comparisons or physical Windows GPU qualification.

Review corrected the local receipt's profile and asset field mapping, restricted
that projection to map workloads inside the existing error boundary, retained
completed page-control evidence on later failure, and bound inner scenario and
fixture identity to their outer document. Non-map workloads retain their path.

Root independently passes **98/98** focused map page, fixture-delivery and outer
smoke checks, including a hung journey, owned-context retirement, malformed
identity and receipt projections, and existing non-map capture validation.
Capture lint (25 files), package boundaries, import directions (1,015 modules,
80 portable entries), changed JavaScript formatting and diff whitespace pass.
[Review metadata](review.json) binds the original [test output](focused-tests.log)
to its checksum and tested revision.

Implemented and locally validated: outer document ownership, report binding,
bounded timeout and cleanup controls. Still pending: rendered execution of the
three fault journeys at this candidate. M3, S47 and S57 are not closed by unit
tests. Fresh standard and native diagnostic CI must identify their exact tested
commit; historical runs are unchanged.
