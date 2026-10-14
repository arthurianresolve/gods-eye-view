# Both-base integration at e53df518

The frozen source is `e53df5188d1f416acd4c9319b6efb5d5b2068f65`, including
upstream GBFS merge `b6d30c37` and the S53/S58 audit additions.

| Base | Standard CI | Release-artifact verification | Tested merge |
| --- | --- | --- | --- |
| dev | [38505961701](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38505961701) | [38505961793](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38505961793) | `d02eef0b9414be89aab4994e218a9eedb60b53af` |
| main | [38505965518](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38505965518) | [38505965510](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38505965510) | `c1378b0eb7f41688947e3b5781f182252b374800` |

All seven selected CI jobs pass per base: Node 24/26, browser journeys, Windows
onboarding and three operating-system recovery jobs. Each ordinary Node suite
has 7,837 passes, five skips and no failures; Node 24 additionally passes fourteen
allocation checks. All thirty recovery records preserve settings, workspaces
and assets, render the imported feature, close owned pages and exit naturally.
Both published-token checks find 29 published tokens and zero newly allocated.

Each merge tree equals the source tree. The base mapping is checked against
job checkout/token output, not the run API's unordered pull-request list.
Both release jobs verify 446 files, download the candidate artifact, and check
the archive, checksum manifest and attestation against repository, workflow and
tested merge commit. The small evidence ZIP digests were independently checked.
Empty attestation stdout files are not proof by themselves; the completed job
and retained raw verification logs provide the evidence. Large candidate ZIPs
were verified in CI, not independently redownloaded in this review.

The [review](review.json), recovery records, raw compressed job logs and
[file hashes](files.json) retain the exact source and scope. These hosted checks
do not establish physical Windows performance, visual equivalence or a retained
heap plateau. No stable release, dev/main promotion or VM deployment occurred.
