# S58 census root validation

Clean source `8d9d79bd62badae6fcecb69304fd6b6aaa02c3b7` emits the retained
[census](census.json). The fixture SHA-256 is
`fc1ff2fe71c4e1f4257bbb160f7aa9dd5b34320b33c4089fedea19783151a2f1`.
The focused tests, full capture no-undef check and targeted formatting checks
all pass; exact commands/results are in [checks.json](checks.json).

Observed enabled style counts are 0, 1, 1, 2, 1. The two-stage state is the
intentional noir-to-thermal crossfade. Thermal retains one animation callback
and one render hold before destruction. Destruction removes all seven owned
stages, retires the callback/hold and restores borrowed bloom settings.
The negative test injects a second settled style and the validator rejects it.

This is a finite ownership check using real Cesium stage objects and the real
application selector/effect owner with a stubbed UI boundary. No collection
update or WebGL rendering occurs. Rendered frames, GPU passes and shader
compilation remain null. It supplies no measured frame-time benefit and does
not validate full weather/wind/effect equivalence on physical Windows. S58
remains partial pending its broader ownership/qualification review.
