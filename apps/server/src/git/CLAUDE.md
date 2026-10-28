# Git

Worktrees and an agent's merge are in the root `CLAUDE.md`; `apps/server/README.md` ("Git", "Worktrees") has the requests. The panel is `apps/client/src/shell/panels/GitPanel.tsx`, the conflict overlay `apps/client/src/conflicts`.

- A project folder holds one or more checkouts: its repository, initialized submodules, and repositories one level down (`repos.ts`).
- The panel has no active repository. One message commits every repository with something staged; nothing staged with several repositories changed commits nothing. Everything else in the panel covers every repository at once, except what names one repository (merge, rebase, stash, a branch, a pull request), which sits on its row and its own branch-menu level. A folder with one repository keeps the single-repository panel, chip and actions menu included.
- A conflict is worked out in the app, never through markers in a file. `git.conflict` hands over the three index versions, and a resolution is written over the digest it was read at, so a file that moved since refuses.
- `git.status` reports a stopped operation (`operation`), which reopens the overlay anywhere. Finishing or aborting, a worktree merge included, is `git.operation`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A pull only fast-forwards until a person says how a branch that moved on both sides comes together.
- An agent CLI may propose a resolution, one stretch at a time or over every file at once. A proposal is an edit in the overlay: nothing is written, staged or committed on an agent's word alone.
