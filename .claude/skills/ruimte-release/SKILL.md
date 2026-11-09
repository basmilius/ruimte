---
name: ruimte-release
description: Cut a release of the Ruimte app (stable or beta) from this repository, with the notes on an annotated tag, and follow it until it is live. Use when Bas names a Ruimte version or asks to release, ship or publish Ruimte, a beta of it or a patch. Use this instead of the global release skill in this repository; that one makes a lightweight tag through gh release create, which loses the notes here. Not for ADE CORE (adecore-release).
---

# Ruimte release

A release runs to the end without asking: Bas names a version, and the next thing he reads is that it is live. Only what Bas alone can decide goes back to him. Rules: "Releasing" in the root `CLAUDE.md`; recipe and secrets: `docs/RELEASE.md`.

## Steps

1. **Version.** Bas names it, or a bump of the latest tag (`git tag --sort=-creatordate | head -5`). A beta is `v<x.y.z>-beta.<n>`, counting on from the last beta of that version.
2. **Main is pushed.** `git fetch origin` and `git status`: the tagged commit is `origin/main`. Work of other agents that is not pushed stays out; never push it for them.
3. **CI on that commit is green.** `gh run list --workflow ci.yml --commit <sha> --json status,conclusion`. While it runs, follow it in the background (`gh run watch <id> --exit-status`). When it is red: fix, push to main, wait for green, and tag the new commit. Nothing is built or tested locally for a release.
4. **Notes.** Write them with the `release-notes` skill from the previous tag of the same track (the last stable for a stable, the last beta for a beta), in the shape of the last tags (`git tag -l --format='%(contents)' <tag>`):
    - A beta opens with the quote block `> Pre-release. Install the \`<version>\` build, from the Pre-release update track in Settings, About, or as \`ruimte@next\` on npm.` and one line on what this beta brings.
    - A stable opens with one quote line on what the release brings.
    - Sections `## 🚀 Features`, `## 🐛 Fixes`, `## ⚡ Performance`, `## 🧹 Chores`, each grouped under bold area names, each item one plain sentence a person understands, ending in `(by @<login>)` for whoever made it. Credit other contributors by their own commits.
    - Run the `unslop` skill over the notes.
5. **Tag and push.** Write the notes to a file outside the repository, then:

    ```sh
    git tag -a v<version> -F <notes-file> --cleanup=verbatim
    git push origin v<version>
    ```

    Without `--cleanup=verbatim` git strips every `##` heading. Never `gh release create`: the `draft` job makes the release from the tag.
6. **Follow `release.yml`** in the background (`gh run list --workflow release.yml --limit 1`, then `gh run watch <id> --exit-status`). The `gate` job stops the release when CI of the tagged commit did not pass. `publish` publishes the draft once macOS, Linux and Windows built: a prerelease for a version with a `-`, otherwise Latest.
7. **After publishing**, check that `npm.yml` ran (`ruimte`, its platform packages and `@ruimte/extension`) and, for a Latest release, `station.yml` and `bench.yml`.
8. **Report** in one or two sentences: the version is live, and anything that failed with what was done about it.

## When something fails

- A red build before `publish`: the release stays a draft. Fix on main, wait for green CI, then tag a new version (a beta counts on); never move a pushed tag.
- `error-tracking` may fail without holding up the release; mention it.
- A missing secret stops `release.yml` before building (`docs/RELEASE.md`, "Secrets in CI"). That is Bas's to fix; say which one.
