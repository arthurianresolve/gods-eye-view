# S69 native Windows matrix checkpoint — 19 October 2026

Candidate deployment is blocked. Six of eight workload pairs completed, with
dam and cable motion regressions above 10%. The weather baseline failed before
its candidate ran; map streaming is unrun. Production remains at `e7a878e`.

## Revisions and conditions

- Baseline application: `e7a878e168bc97ffedddc27e13bf3e69b7ee6256`.
- Candidate application and build harness: `19065997a3f6360d68cb9ed5b389c4754856b596`.
- Operating capture producer: `19065997a3f6360d68cb9ed5b389c4754856b596`.
- Remaining matrix producer: `d372aaa644e4db2464d70f9611fc11e97beaf951`.
- Physical Windows Intel UHD 620, ANGLE/D3D11 hardware rendering, Chrome for
  Testing 152.0.7977.75, native DPR 2, 1,440 × 900 CSS viewport and 2,880 × 1,800
  drawing buffer. Manual/DENSE/75%, matched fixture populations and settings.
- Each qualification block uses five runs, 30 seconds of warmup and 60 seconds
  of measurement. Instrumented diagnostic runs below are separate.

The matrix plan SHA-256 is
`02d8e0b8d91257bb1450ae21ff1a3ed02ec33b2e89395d3eca4608440491c5e3`.
Builds, dependencies, Linux checks and bulk evidence use VM105. Windows retains
the files required for actual GPU capture and receipt verification. No nested
container or production service change was needed.

## Completed comparisons

Values are median run-level scripted-motion p95, rounded for display. Passing
this individual regression threshold is not full release acceptance.

| Workload                | Baseline ms | Candidate ms | Change | Motion regression threshold      |
| ----------------------- | ----------: | -----------: | -----: | -------------------------------- |
| Operating view          |       456.4 |        454.0 |  -0.5% | no unresolved motion regression  |
| Dense investigation     |       530.2 |        545.7 |  +2.9% | within 10%; 20% objective missed |
| Datacenters             |       317.0 |        317.1 | +0.03% | within 10%                       |
| Dams                    |       300.1 |        409.9 | +36.6% | failed                           |
| Submarine cables        |       339.2 |        549.7 | +62.1% | failed                           |
| Combined infrastructure |       378.3 |        368.1 |  -2.7% | within 10%                       |

Dense selected tracking is 1,364.8 versus 1,368.4 ms (+0.3%); its proposed 20%
objective is also missed. No material performance improvement is claimed.

Operating idle has a separate, hash-bound disposition at `7aa89243`: its raw
+80.8% inter-render interval flag remains preserved. The short production-loop
diagnostic establishes correct satellite motion, intentionally invisible wind at
12 km, and equivalent visible wind geometry/animation at 60 km. It clears only
that pair's idle interval finding, never dam/cable motion or retention.

The [raw-report index](raw-report-index.json) records all 13 original report hashes, exact application and producer revisions, and individual sample values. It includes the failed weather report; no failed report is replaced by a diagnostic success.

## Dam tail diagnosis

Four fixed alternating captures, baseline/candidate/baseline/candidate, use
producer `080d755f5ec1666f66c81f93200b456a50a0b7bb` with bounded frame tracing.
All four retain foreground ownership and untruncated timing records. Their
scripted-motion frame-interval p95 values are 283.8, 462.1, 325.5 and 439.5 ms.
The corresponding `viewer.render` call wall-time p95 values are 16.8, 18.6,
20.7 and 17.6 ms. Most of the added interval lies before the next animation-frame
callback. These wall times do not measure GPU execution or prove a driver,
engine, HUD or browser defect.

Every recorded governor state has no active holds or scheduled updates. The
existing producer disables optional application diagnostics before measurement.
The Cesium distribution and worker source digests are identical across the pair.

The [diagnostic review](dam-trace-review.json) binds the original protocol and
summary by hash. Raw reports and traces are preserved on VM105 under
`/opt/gods-eye-view-validation/s61-s70-20261018/dam-tail-diagnostic-080d755f-20261018T222558Z`.
The trace producer marks these captures comparison-ineligible. They do not
replace the original five-run failures or authorize an acceptance waiver.

A one-change HUD control removes the unchanged-text equality guard at diagnostic
commit `de3c3a654790913dbf97c5b3288fe9a5876a23fe`, retaining all other candidate
behavior. Its first setup attempt stopped before Chrome because npm 11.20.0 did
not match the original build recipe's 11.13.0. A fresh VM build with Node 24.16.0
and npm 11.13.0 produces the same 886 asset bytes and a matching recipe. The
failed setup remains recorded. The control returned a motion p95 of 295.3 ms,
but the immediately following unchanged candidate also returned 299.0 ms. The
[control review](hud-control-review.json) binds both reports and traces. This
does not establish the equality guard as the cause. The experimental removal
is not retained; the earlier failures remain unresolved. Raw evidence is on
VM105 under
`/opt/gods-eye-view-validation/s61-s70-20261018/hud-write-control-fb8a6c33-20261018T225029Z`.

## Weather failure and diagnostic correction

The original baseline report failed in scripted-motion run 2 while entering
`early-history`. Five idle and one motion sample completed before failure. Its
SHA-256 is `a2a6904f03aa5e9c5741d994449da110d4f1d893b7ab94be95108fd25935b690`.
It lacks the failed transition's detailed observation, so its root cause is not
established.

Producer `fb8a6c33285e3a83f92b8d612d55fda21a13c42b` retains bounded expected and
observed timestamps, fixture identity, elapsed time, phase, clock and slider
state. Existing predicates, failure prefixes and deadlines remain unchanged.
Malformed/oversized context is rejected; arbitrary objects and URLs are omitted.
Thirty focused tests pass on VM105 under both Node 24.16.0 and 26.11.0.

All seven selected [CI jobs at this QA revision](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39172161048)
and its [release verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39172161051)
pass. Twelve optional diagnostic jobs are intentionally skipped; they do not
constitute hardware or soak evidence.

One diagnostic run per frozen application completed without reproducing the
failure. Both reports remain comparison-ineligible because this diagnostic uses
a one-second warmup and one repetition. The
[weather diagnostic review](weather-phase-review.json) records exact revisions
and raw hashes. Its VM archive is
`/opt/gods-eye-view-validation/s61-s70-20261018/weather-phase-diagnostic-fb8a6c33-20261018T223553Z`.
The full weather pair and map-streaming pair remain outstanding.

## Completion conditions

Identify the cause of the blocking regressions and fix or reject the affected
optimization, preserving visual detail. Qualify the exact resulting application,
including any newly required comparisons; do not relabel earlier application
evidence. Complete weather and map streaming, then verify the signed VM105
deployment, HTTPS/workspace behavior and final 60-minute native Ampfing soak.
Missing evidence remains pending. Earlier failures and missed objectives remain
visible even when a later corrected run succeeds.
