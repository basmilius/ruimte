# Provenance

`apps/server/README.md` has the format and the requests.

- It lives under `$RUIMTE_HOME/provenance`, never in a project file. The daemon is its only writer. A client reads (`provenance.read`) and sets a review state (`provenance.review`); no verb reaches it.
- It is an observer (`ChatCore.observe`) and only notes. Nothing in a chat waits on it, nothing acts on what it finds, and a failure is logged and forgotten. A turn sent from inside an event would run in the chat's call stack, so no handler here starts work beyond its own file.
- A write is found again in the file on disk, never trusted from the tool call alone. The call only says which diff hunks are the agent's (`WriteSignature`), so a person's edit saved at the same moment is not claimed. Diff against the turn's checkpoint tree first, the file's own record second.
- A run made from the checkpoint alone is `via: 'checkpoint'`: a guess about who ran the shell command or formatter, and a client words it as one. When HEAD moved during a turn, a file the move touched gets a checkpoint-only run only if its working copy differs from HEAD after the move, and what the commits hold is dropped from it as usual. A move that cannot be read claims nothing. A run noted over a checkpoint that already differed from the turn's starting HEAD (a person's uncommitted edits) is not dropped against HEAD at note time, since the hunk and the HEAD diff may align a twin of a HEAD line differently.
- Provenance ends where git blame begins: a line HEAD holds unchanged is dropped, whoever wrote it. Never keep a run to show it next to a commit.
- A run is a place, not an identity. It is mapped through every change of the file by line hashes, and a run cut in pieces keeps one id, so a review reaches every piece. Lines a change replaced lose their run.
- Only a file inside the project folder counts, and every request is held to that folder and to `MachineHome` like a file request. A worktree chat marks files of that worktree, which are not the project's.
- The records are bounded: runs older than 30 days, files that are gone and projects that left the registry (`ProjectStore.delete` calls `forget`) are dropped; at most 300 records per project and 500 runs per file; `before` only up to 200 lines or 16 KB (left out, never cut, since half of it would restore a broken file).
- Nothing here changes a file or schedules work on a clock.
