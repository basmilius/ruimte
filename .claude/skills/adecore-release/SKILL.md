---
name: adecore-release
description: Take finished ADE CORE work to npm and bump Ruimte onto it, in one run. Push ADE CORE, wait for its CI, release it, wait for npm, bump the catalog in Ruimte, check, commit, push and follow CI. Use when Bas asks to release ADE CORE, to publish a change made in ../adecore, or to bump Ruimte to a new ADE CORE version.
---

# ADE CORE release and Ruimte bump

ADE CORE (`../adecore`, `basmilius/adecore`) releases every package under one version. Ruimte pins that version in the catalog of its root `package.json`. Rules: `../adecore/CLAUDE.md` ("Releases") and `docs/ADECORE-DEVELOPMENT.md`. Follow every wait in the background (`run_in_background` or `Monitor`) and report only outcomes; never poll with `sleep`.

## In ADE CORE

1. **Commit and push.** Commit only your own work, then `git -C ../adecore push`. Every commit passes `bun run check`, `bun run test` and `bun run build` there first.
2. **CI green.** `gh run list --repo basmilius/adecore --workflow ci.yml --commit <sha>`, then `gh run watch <id> --repo basmilius/adecore --exit-status`. A red run is fixed and pushed before anything else.
3. **Version.** `gh release list --repo basmilius/adecore --limit 1`. While the version is `0.x`, a breaking change bumps the minor and everything else the patch.
4. **Release.** Notes with the `release-notes` skill from the previous ADE CORE release, then:

    ```sh
    gh release create v<version> --repo basmilius/adecore --draft --notes-file <notes>
    gh workflow run release.yml --repo basmilius/adecore -f version=<version>
    ```

    Follow that run until it ends. A version already on npm is skipped, so a failed run can run again while the release is a draft.
5. **npm.** npm validates a publish for up to about five minutes after the run is green. `adecore:bump` waits for every tarball itself (up to ten minutes), so start it rather than checking npm by hand.

## In Ruimte

6. **Bump.** If ADE CORE is linked (`bun run adecore:status --brief`), first `bun run adecore:npm`; the bump refuses a linked checkout. Tell agents that work in this checkout, since both commands change resolution for them. Then `bun run adecore:bump <version>`.
7. **Check.** `bun run check` and the tests that touch what changed in ADE CORE.
8. **Commit together.** `package.json`, `apps/server/docker/workspace-package.json` and `bun.lock`, plus any Ruimte code that uses the new API, as `chore: bump ADE CORE to <version>`, or a commit that names what the new API brings.
9. **Push and follow CI** of that commit until it ends. Relink with `bun run adecore:link` only if it was linked before.
10. **Report** in one or two sentences: the version on npm, the bump on main, and CI's outcome.
