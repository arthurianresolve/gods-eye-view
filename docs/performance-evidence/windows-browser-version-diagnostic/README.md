# Optional Windows browser-version diagnostic

Implementation `77110352`, corrected at `4b6be47f` and integrated at
`5070ebe2`, adds an exact Chrome for Testing selector to manual
`windows-profile-recovery` jobs on the free standard Windows runner. Blank
selection retains Puppeteer's existing pinned Chrome 152 default. The five
recovery stages, software-renderer flags, five-second close deadline and owned
cleanup remain unchanged.

Root review rejected the initial binary probe before any hosted run. It used
`chrome.exe --version`; the [exact Chrome 155 source](https://chromium.googlesource.com/chromium/src/+/155.0.8059.39/chrome/app/chrome_main_delegate.cc)
guards the handler with `IS_POSIX`. Current Chromium main has a different
Windows implementation and is not evidence that this target binary supports
the switch. The correction reads numeric Windows executable metadata with a
bounded PowerShell helper and does not launch Chrome for this check. Recovery
also verifies the launched browser's exact protocol version before page setup.

Root passes 82 focused tests, including actual native Windows metadata and
PowerShell ownership paths, 24 capture-harness lint targets and formatting of
1,634 files. An independent metadata read of the locally installed Chrome
returns `154.0.8037.98`; its mismatch against the requested diagnostic version
is rejected. Puppeteer's installed configuration and installer enums are also
checked without downloading or launching a browser.

The [official Chrome for Testing manifest](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json)
at `2026-10-12T20:23:08.979Z` identifies stable `155.0.8059.39`, revision
`1697595`. A separate explicitly selected run is still needed. A passing run
on this version alone cannot establish the cause of earlier intermittent
Chrome 152 shutdown failures, or demonstrate hardware rendering acceptance.
