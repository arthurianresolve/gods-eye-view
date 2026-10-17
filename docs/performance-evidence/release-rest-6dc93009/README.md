# Direct REST release-artifact verification

[Run 38447239483](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38447239483)
passes on exact source `6dc93009efd2c80fd1b3a72fd7f1ba8f3b748100`.
This is a manually dispatched candidate build with stable publication disabled,
not a tag promotion or hardware acceptance run.

The upload finalized candidate artifact **11838652515** at 18:34:20.216 UTC.
The corrected helper fetched its metadata and ZIP directly by ID and verified it
at 18:34:21.812 UTC. The ZIP contains 19,864,114 bytes with SHA-256
`47f1ea8f57c03faeb588de145358cc604dcde83d4896876105847fafecc7ea3d`.
The retained [REST verification metadata](artifact-rest-metadata.json) binds this
artifact to the expected workflow run, repository and source commit.

The same job passes formatting, package boundaries, the full Node suite,
production build, staged release verification, downloaded archive checksum,
GitHub attestation verification restricted to the expected repository/workflow/
source commit and GitHub-hosted runners, and the downloaded manifest/source check.
No publication steps ran. The raw job log and terminal step metadata retain the
commands and their conclusions.

Root separately verifies the small evidence artifact ZIP against its REST digest
and extracts only its two exact observed evidence paths; the [extraction review](extraction-review.json)
records their repository-directory prefix and local name mapping. The attestation
command's stdout file is empty; the passing job step and retained command flags
establish this check, not the empty file. The earlier [ID-discovery failure](../representative-pr-d6a97e46/README.md)
remains failed; later success does not establish the service-side cause.

The 12 root release tests cover identity mismatches, digest/size mismatches,
malformed input, unexpected archive entries and unchanged inner verification.
Upload output is strict raw SHA-256 hex; REST metadata remains strict
`sha256:<hex>`. No retry or timeout expansion was added.

[files.json](files.json) records raw artifact, job and report byte counts/digests.
This closes the reproduced artifact handoff repair for this tested revision.
Final candidate release readiness and post-publication acceptance remain separate.
