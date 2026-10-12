# Windows recovery: process exit timeout after protocol shutdown

[Run 38203843444](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38203843444)
tests dev `2d18433cfd333691105ab5af2f1af48bddf54906`.
The [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38203843444/job/114662858132)
fails at `prior-install-rollback-same-profile`, during owned-page cleanup.
The application, scripts, workflows and package files are unchanged from
`93c78c8ceeb2641b37b5ddfa8575ee6acd9eb2e2`, whose
[standard run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38202386387)
passed all seven jobs. That earlier pass does not override this failure or
establish that it is caused by the intervening documentation change.

The runner uses Windows Server build 26100, Node 24.14.0, Chrome 152.0.7977.75
and SwiftShader. This is recovery evidence, not physical Windows GPU evidence.
All three reached stages run the prior application at
`6b896e2a8277fba12bc9577ad7772005a71e13c7` in the persisted browser profile.

| Stage | Settings and workspace | Browser exit |
| --- | --- | --- |
| Save prior workspace | Match; asset reopens | Natural, 451.2 ms |
| Interrupted update | Match; asset reopens | Natural, 370.4 ms |
| Rollback, same profile | Match; asset reopens | Five-second timeout; forced termination |

In the failed stage, boot takes 2,770 ms and the late renderer query takes
447 ms. The owned page closes successfully, leaving zero open pages and no
unexpected page targets. Chrome acknowledges `Browser.close` after 7.85 ms
and disconnects after 26.36 ms. The process remains alive beyond the unchanged
5,000 ms shutdown gate. The recorded exit at 5,351.8 ms, code 1, follows the
owned-process forced cleanup and is **not** a successful natural exit.
Later update and verification stages are not reached.

Pinned Puppeteer 25.10.0 waits for both protocol closure and browser-process
exit. The evidence therefore isolates a process-shutdown stall after protocol
shutdown. It does not identify a remaining GPU/utility child or prove a source
defect. The report has page counts but no target-type or process-tree snapshot.
The next diagnostic should capture bounded observations rooted at the owned
Chrome PID before forced cleanup, preserving the five-second failure gate.
Unavailable observations must remain unavailable; forced termination remains
a failure. No unchanged retry or longer deadline is justified by this report.

The [raw report](report.json) is 6,389 bytes, SHA-256
`7f56c2a30aefd7ef359be2d3a573920c3089e65a21c8ad8d31bfd05cbdc25e2b`.
It was extracted from the job's marked evidence record because this ordinary
push run preserves recovery evidence in logs. The [review](review.json) and
[CI metadata](ci-run.json) retain the failed result and exact revision.
