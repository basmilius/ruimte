# Provenance

`apps/server/README.md` has the format and the requests.

- It lives under `$RUIMTE_HOME/provenance`, written only by the daemon. A client reads it and sets a review state; no verb reaches it.
- It is an observer (`ChatCore.observe`) and only notes: nothing waits on it, nothing acts on it, a failure is logged and forgotten, and no handler starts work beyond its own file.
- A write is found again on disk, never trusted from the tool call, which only says which hunks are the agent's (`WriteSignature`). Diff against the turn's checkpoint tree first, the file's record second.
- A run from the checkpoint alone is `via: 'checkpoint'`, a guess. When HEAD moved in a turn, a touched file gets such a run only if it differs from the new HEAD, and an unreadable move claims nothing. A run noted over a checkpoint that already differed from the turn's starting HEAD is not dropped against HEAD at note time.
- Provenance ends where git blame begins: a line HEAD holds unchanged is dropped, whoever wrote it. Never keep a run to show it next to a commit.
- A run is a place, mapped through every change by line hashes, one id across its pieces. Replaced lines lose their run.
- Only files inside the project folder count, and every request is held to that folder and `MachineHome`. A worktree chat's files are not the project's.
- Bounds: runs past 30 days, gone files and forgotten projects (`forget`) are dropped; 300 records per project, 500 runs per file; `before` up to 200 lines or 16 KB, left out above that, never cut.
- Nothing here changes a file or schedules work on a clock.
