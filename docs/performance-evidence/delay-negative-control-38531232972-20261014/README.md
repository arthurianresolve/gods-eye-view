# Hosted delay negative-control failure

- Workflow: https://github.com/arthurianresolve/gods-eye-view/actions/runs/38531232972
- Tested revision: `2bbb3ed19f1223ac70197e41be2997a3f6ddab07`
- Baseline: `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`
- Harness: `2bbb3ed19f1223ac70197e41be2997a3f6ddab07`
- Requested fixture: `infrastructure-datacenters`
- Requested renderer: macOS native diagnostic (Apple paravirtual Metal)
- Artifact API digest: `sha256:27306a844827f9a02fd208f4ecd0975fbd9e14e385a5188626ad02fc07c813b5`

The first dispatch of this revision used a malformed candidate SHA and failed before checkout; it is not evidence. The corrected run checked out the exact commit and reached the capture. Baseline static smoke passed. The candidate control arm preserved three completed samples and failed during scripted-motion run 2 with `Protocol error (Runtime.callFunctionOn): Target closed`. The captured report shows verified Apple paravirtual Metal and the declared datacenter fixture; its first idle sample reached `usedJsHeapBytes: 307605852` from a startup value of about 50 MB. No delayed arm report was produced, so the negative control is **not passed**.

This packet is retained as a failed lifecycle/retention diagnostic. It does not justify changing the motion threshold, reducing visual settings, or treating the failure as performance acceptance. S49/S47 remain pending until the underlying ownership/retention failure is isolated and a complete control/delayed pair is captured.

All raw files are byte-preserved; verify with `sha256.json`.
