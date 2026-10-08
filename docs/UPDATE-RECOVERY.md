# Release and update recovery

## Release channels

Stable builds are created from a `vMAJOR.MINOR.PATCH` tag matching
`package.json`. The release workflow uses `npm ci`, runs formatting, boundary,
unit and production-build checks, stages `dist/` with the app metadata and
documentation, verifies every staged file's SHA-256, and publishes a
reproducibly ordered `.tar.gz` plus its checksum. Manual workflow runs create
development artifacts and do not publish a GitHub Release. The manifest records
the exact commit, Node requirement and workspace/Director/settings schema
versions.

Download a stable asset and its adjacent `.sha256` file from the same GitHub
Release. On Linux or macOS, check the archive with:

```sh
sha256sum --check gods-eye-view-vX.Y.Z.tar.gz.sha256
tar -xzf gods-eye-view-vX.Y.Z.tar.gz
node scripts/verify-release.mjs --path .
```

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

The automated release workflow covers one Node/Linux artifact build. Windows
and macOS clean-install, upgrade, interrupted-download and browser-storage
rollback checks remain release-candidate acceptance work in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md#s30).
