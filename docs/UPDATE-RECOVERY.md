# Release and update recovery

## Release channels

Version tags matching package.json create draft candidates, never automatic
stable publication. Manual development runs produce downloadable artifacts.
To promote a tag, run the release workflow on that tag with publish_stable enabled
and supply its exact-commit pre-release validation manifest. Missing/failed evidence
stops promotion.

The workflow reruns candidate gates, verifies downloaded checksums and contents,
checks the attestation against repository/workflow/source commit, and rechecks
the tag target. It attaches those verified bytes, downloads the draft assets for
another verification, then promotes the draft. Existing stable assets are not
overwritten.

Archive names contain the full source commit. Download the archive and checksum.
On Linux, run sha256sum --check gods-eye-view-COMMIT.tar.gz.sha256; macOS can use
shasum -a 256 -c. Then verify signed provenance:

    gh attestation verify gods-eye-view-COMMIT.tar.gz --repo arthurianresolve/gods-eye-view --signer-workflow arthurianresolve/gods-eye-view/.github/workflows/release.yml --source-digest COMMIT --deny-self-hosted-runners

Replace COMMIT with the expected full source SHA from the tested revision.
Extract the archive, then run:

    node scripts/verify-release.mjs --path .

See [GitHub CLI attestation verification](https://cli.github.com/manual/gh_attestation_verify).

The extracted artifact contains the checksummed production bundle and source
metadata. Use a fresh application directory for the candidate; keep the prior
install until the candidate starts and its workspace opens.

## Pinokio update behavior

The Pinokio updater previews the configured upstream, lists incoming commits
and a diffstat, fetches once, then fast-forwards to the exact commit it showed.
It now stops before fetching or running install scripts when the working tree
has tracked or untracked changes, or when it cannot verify the tree is clean.
Commit or export local source changes and review them before retrying. It does
not change a custom remote or branch.

Before an update that might change browser storage, export each important
workspace from the workspace library to a `.gev-workspace.json` file. The
release manifest identifies the workspace document, Director document and
settings schema versions. Browser storage lives in the browser profile and is
not restored by rolling back application files. The current updater does not
claim to reverse a newer workspace schema; a future incompatible schema change
must include a tested old-reader/backup path before release.

## Failed update

If dependency installation or startup fails, retain the workspace export,
return to the prior known-good application directory or release artifact, and
restore the exported workspace through the library. Do not delete the browser
profile to repair an app-file update. If the old app refuses a workspace, keep
the export unchanged and reopen it with a compatible newer reader. Report the
release tag, manifest commit, operating system and sanitized diagnostics; do not
attach API keys, request headers or raw voice transcripts.

CI runs the real installer and Git updater tests on Windows, macOS and Linux.
The portable recovery fixture rejects incomplete/corrupted artifacts and reopens
a bundle with a verified asset. The browser journey checks IndexedDB reload and
transfer to a fresh profile. The full prior-install and browser-profile recovery
matrix remains acceptance work in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md#s30).
