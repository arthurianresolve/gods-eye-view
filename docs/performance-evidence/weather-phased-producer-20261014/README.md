# Weather phase producer integration

Source `a046c1d3` integrates the v2 phased weather fixture and corrections from
review. The producer selects all three pinned history observations through
the application timeline at 0, 20 and 40 seconds, checks exact source times,
and resets Latest before every sample's warmup. It uses the actual weather
clock semantics, including history mode when selecting the final slider item.

Host scheduling observes sample rejection immediately and releases pending
timers. Page phase selection checks measurement ownership after waits so a
retired sample cannot make later timeline changes. Asset identities remain
exact; cumulative delivery counters must be positive, monotonic and bounded
by final totals. Unrelated infrastructure delivery equality is preserved.

The ordinary smoke remains two one-second samples per scenario. The explicit
weather producer diagnostic uses one 60-second sample each for idle and motion,
with a one-second warmup. It stays comparison-ineligible under the existing
180-second child timeout. The separate full comparison still requires five
runs per scenario, 30-second warmup and 60-second measurement. Historical v1
reports retain their original outcomes and do not become v2 evidence.

Root validation passes 80 focused tests, including real clock/panel behavior,
cancellation, stale-owner, malformed evidence and duration controls. The
measured duration retains fractional completed-frame overhead; the requested
window stays exactly 60 seconds. Forty-file capture lint, 1,657-file formatting
and package boundary checks pass. Production runtime defaults are unchanged.

Hosted producer validation and physical Windows comparison remain pending.
This packet does not close S47 or claim weather performance improvement.
