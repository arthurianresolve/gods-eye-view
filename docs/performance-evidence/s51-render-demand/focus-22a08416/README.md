# Independent satellite focus and position deadlines

Root source `22a084168692dc5e79d4d84fb6e7b0c06c98b067` integrates the reviewed
Luna series through `6210f62d`. The five affected source/test files are byte-equal
to that reviewed series. [review.json](review.json) records their hashes.

Core-only satellites keep the independent one-second position/orbit wake.
A separate disposable focus owner requests the immediate target-change frame
and samples active easing at the existing 80 ms cadence. A pending pass survives
the existing throttle, but completed no-op work, empty catalogs, disable and
destroy retire it. Settled dimming is distinct from active animation. Visible
dense populations and tracking retain continuous rendering. The shared focus
subscription is included in the listener inventory and removed on teardown.

Root passes 74 focused checks in ten files, import/package boundaries and
formatting of 1,654 source files. The hidden-point no-op test supplies real
`advanceSpriteFocus` before the renderer captures its dependencies and asserts
that it is called. Other scheduling cases deliberately simulate rendered frames;
they do not claim real GPU performance or all populated scene visuals.

Three isolated negative controls fail at the intended assertions:

- Resetting the core timer on focus change postpones its original deadline.
- Restoring pre-retirement lifecycle `9d43b82a` leaves stale pending work when
  points disappear (byte-equivalent agent source `46f9e788`).
- Restoring `ffe0f49e` requeues a completed no-op pass with a selected target
  (byte-equivalent agent source `e12f9d29`).

Each retained module/test copy uses absolute imports into the tested local
checkout; the only replaced production dependency is its isolated lifecycle
copy. The generated copies are not applied to runtime code. Logs and generated
copies are bound by [files.json](files.json).

The preceding [dense correction and full Windows failure](../dense-cadence-9a2517af/README.md)
remain separate evidence. These scoped passes do not erase its three failed
tests. Current both-base integration and physical Windows qualification are
still pending; no S51 completion or speedup is claimed in this packet.
