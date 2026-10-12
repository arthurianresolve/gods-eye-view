# Dense capture boundary failure

[Run 38195133406](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38195133406)
fails at exact application/harness commit
`c21b3f21a8fd7933dc0e52698e2b1175165ef7db`. The baseline build/integration
checks pass, but the candidate actual dense capture fails after its first idle
measurement while waiting for a completed render at the measurement boundary.
No capture sample is accepted.

The complete [raw report](report.json) has SHA-256
`65ddb722e246d61bac729dfa5d40f35f3efec8872e91403c28d3d5112182fdc3`.
The [review](review.json) records 2,500 delivered aircraft with no page or
interception errors. Warmup-boundary settling took 5,618.7 ms. The incomplete
measurement reports two rendered frames over 5,693.9 ms and two long tasks,
the longest 2,620 ms. The held fixture clock reached its declared final epoch.
The host watchdog then failed before observing the boundary render.

The five-second page timeout and one-second host grace remain unchanged.
These observations do not distinguish a delayed page command, CPU/render
progress or a missing final frame. Bounded boundary attribution is required
before changing behavior. No unchanged rerun or deadline extension was used.
The four infrastructure workload passes remain separate evidence; this dense
path failure holds the harness integration. This is software-renderer
correctness evidence, not Windows hardware or performance acceptance.
