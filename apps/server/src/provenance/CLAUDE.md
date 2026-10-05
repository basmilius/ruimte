# Provenance

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/README.md` has the format and the requests.

- It lives under `$RUIMTE_HOME/provenance`, never in a project file, which an agent with a shell can rewrite. The daemon is its only writer: a client reads (`provenance.read`) and sets a review state (`provenance.review`), and no verb reaches it.
- It is an observer (`ChatCore.observe`) and only notes. Nothing in a chat waits on it, nothing acts on what it finds, and a failure is logged and forgotten. A turn sent from inside an event would run in the chat's call stack, so no event handler here starts work beyond its own file.
- A write is found again in the file on disk and never trusted from the tool call alone. The call only says which hunks of the diff are the agent's (`WriteSignature`), so a person's edit saved in the same moment is not claimed. A turn's checkpoint tree is the version to diff against, the file's own record the second choice.
- A run made from the checkpoint alone is `via: 'checkpoint'`. It is a guess about who ran the shell command or the formatter, and a client words it as one.
- Provenance ends where git blame begins: a line the file at HEAD holds unchanged is dropped, whoever wrote it. Never keep a run to show it next to a commit.
- A run is a place and not an identity: it is mapped through every change of the file by line hashes, and a run cut in pieces keeps one id so a review of it reaches every piece. Lines a change replaced lose their run.
- Only a file inside the project's folder counts, and every request is held to that folder and to `MachineHome` like a file request. A chat in a worktree marks files of that worktree, which are not the project's.
- The records are bounded: runs older than 30 days, files that are gone, 300 records per project, 500 runs per file, and `before` only up to 200 lines or 16 KB (it is left out, never cut, since half of it would put back a broken file).
- Nothing here changes a file, and nothing schedules work on a clock.
