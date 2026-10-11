# Windows frame delivery after Chrome control restoration

The five-second diagnostic started at 2026-10-11T15:53:34.536Z in the authorized
Chrome profile. The downloaded [report](report.json) is preserved without changes;
SHA-256: `28c6126d880a14606f68432e706c7fd4be8a04add2c3e0e9ec21e5e9e5e1626a`.

The fixture reports application and harness revision
`9c482cac36eaa0726e7d90dc6037db63de21c53a`, Chrome 154, and Intel UHD 620 through
ANGLE/D3D11. It drew 5,000 points with antialiasing and framebuffer preservation
enabled. It delivered 48 animation frames in 5,000.9 ms; the largest frame gap
was 1,000.8 ms. In contrast, the 20-ms timer fired 249 times, with a 58.9-ms
maximum gap. No context loss or focus/visibility change was recorded.

This is a scheduling observation on an older fixture, not a current-dev
performance result. Desktop foreground/occlusion was not independently verified,
and only 89.95% of the canvas intersected the viewport. Restoring browser control
did not establish reliable frame delivery. No browser flags, graphics settings,
or application defaults were changed. Hardware acceptance and the 60-minute
physical Windows soak remain pending; this report does not identify a root cause.

The download completed, although the automation download notification timed out.
The file was identified by its matching start time, content and hash in the local
Downloads directory. The subsequent attempt to reclaim the tab reported an
unattached debugger; this is a separate browser-control failure.
