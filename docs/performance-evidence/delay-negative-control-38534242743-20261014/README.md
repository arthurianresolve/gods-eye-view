# Hosted injected-delay negative-control pass

- Workflow: https://github.com/arthurianresolve/gods-eye-view/actions/runs/38534242743
- Tested revision: `8963ea3be95233665f9085169b16381b1963e98a`
- Baseline: `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`
- Harness: `8963ea3be95233665f9085169b16381b1963e98a`
- Fixture: `infrastructure-datacenters`, bundled datacenter fixture SHA `44ee5e37da85bba7fb2b720a1c0e77303f28ad1ae138084a319ac7332f664454`
- Renderer: verified Apple paravirtual Metal on GitHub-hosted macOS; comparison and hardware acceptance remain ineligible
- Artifact API digest: `sha256:8a8623c03b728c1b0c1b601458ac14c5c6e660b792fdb37f8ae8052f381c4501`

The workflow completed successfully. The candidate?s control arm exited 0 with four complete samples and both scripted-motion p95 values below the 250 ms budget (178.8 ms and 92.9 ms). The delayed arm exited 1 with the same build, fixture, renderer, route and settings, an 800 ms injected delay, and two explicit `budget-exceeded` motion samples (836.9 ms and 832.8 ms). Artifacts were preserved and cleanup was confirmed.

This is a diagnostic negative-control pass proving that the frame-budget gate rejects a controlled delay. It is not a dense performance comparison, GPU qualification, retention soak, or visual-parity result. Raw JSON files are byte-preserved; verify them with `sha256.json`.
