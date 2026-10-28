# Git

Worktrees and an agent's merge are in the root `CLAUDE.md`; `apps/server/README.md` ("Git", "Worktrees") has the requests. The panel is `apps/client/src/shell/panels/GitPanel.tsx`, the conflict overlay `apps/client/src/conflicts`.

- A project folder holds one or more checkouts: the repository it is in, its initialized submodules, and repositories one level down beside it (`repos.ts`).
- The git panel has no active repository. The staged files say where a commit lands, so one message commits every repository with something staged. Nothing staged with more than one repository changed is nothing to commit yet. Changes, the commit log, the header counts, fetch, pull and push all cover every repository at once.
- What names one repository (merge, rebase, stash, a branch, a pull request) sits on that repository's row and in its own level of the branch menu, one level in, since `main` says nothing about which repository. A folder with exactly one repository reads as the panel always did, chip and actions menu included.
- A conflict is worked out in the app, never through a marker in a file. The daemon hands over the three versions in git's index (`git.conflict`), and a resolution is written over the digest it was read at, so a file that moved since refuses instead of losing the change.
- The checkout reports what stopped in it (`operation` on `git.status`), which reopens the overlay after a reload, on a second client and after a terminal left a merge halfway. Finishing or aborting is one verb (`git.operation`), and a worktree merge aborts through the same call.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A pull only fast-forwards until a person says how a branch that moved on both sides comes together, since an unasked merge commit is a commit to undo.
- An agent CLI may propose a resolution, one stretch at a time or over every file at once. A proposal is an edit in the overlay: nothing is written to a file, staged or committed on an agent's word alone.
