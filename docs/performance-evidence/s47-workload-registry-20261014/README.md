# S47 workload-registry engineering closure

The tested code revision is `d1fc068a1de735487cb7e5d25046e3ff8b2d45d2`.
This packet closes the remaining candidate-manifest identity gap in S47; it is
not a performance or hardware qualification result.

The timed map producer emits `austin-map-streaming-v1`, while the acceptance
registry requires the family name `map-streaming`. Candidate evidence now maps
that one registered producer identity to the required family. The map row still
has to pass the existing five-run, 30-second warmup, 60-second measurement,
fixture-delivery, build-provenance, environment, settings and transition-timing
validation before it contributes coverage. Arbitrary map-like identifiers do
not receive the alias.

The shared paired-report test fixture now exposes the same map report builder to
the candidate evidence tests. A complete physical-Windows manifest containing
all timed families, all four infrastructure variants and the standalone
retention result reaches `passed`; removing or corrupting map evidence retains
the existing pending or failed behavior. Lifecycle stress remains exclusively
owned by the separate full-soak retention gate.

Validation on the clean tested revision:

- 154 capture, candidate, paired-report, comparison-contract and Austin
  producer tests passed with zero failures.
- The narrower contract selection passed 86 tests with zero failures.
- Formatting checked 1,678 source files.
- Import-direction and package-boundary checks passed for 1,025 modules and 80
  portable entries.
- `git diff --check` passed.

The earlier deterministic CLI delay-control run and its retained negative arm
remain the execution evidence for the injected-delay requirement. This change
does not relabel that historical artifact or any prior map diagnostic.

S47 engineering is closed. Final qualification still requires the five matched
baseline/candidate runs for every timed family on the primary Windows machine,
including the new map family row, plus the separately required 60-minute
retention run on the frozen candidate. See [review.json](review.json) for the
source identities and exact commands.
