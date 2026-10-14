# Current agency placeholder review

The [metadata review](review.json) records five public responses inspected on
13 October 2026. No camera image is committed or included in workspace evidence.
This is a bounded provider check, not a CI fixture or a production acceptance pass.

Two official Caltrans images visibly show construction artwork. Their JPEG hashes
differ because the bottom timestamp changes. A diagnostic decode of the unchanged
320-by-240 interior produces the same RGB hash for both examples. This demonstrates
why adding their complete-file hashes would be ineffective after the next update;
it does not validate a browser pixel fingerprint or authorize a fuzzy matcher.

Three TfL catalog entries marked unavailable still return ordinary road images.
They are negative controls against treating a catalog flag as proof of placeholder
pixels. Repeated frames alone also remain insufficient evidence of failure.

The source adapters already filter catalog-inactive Caltrans and TfL entries.
These observations therefore do not demonstrate a current false-positive camera
selection. They identify the additional contract required for robust recognition
when an already-loaded camera changes state: bounded, provider-specific artwork
matching that excludes the variable footer, preserves successful decode as a
separate fact, and has independently verified browser decoding and recovery tests.

The production whole-file fingerprint registry remains empty. No ephemeral hashes
or new image-decoding dependency are introduced. S42 production recognition remains
pending; the existing selection and synthetic fingerprint tests retain their scope.
