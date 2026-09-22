# Project, drawing and diagram files

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- A drawing or diagram file follows its view between `.ruimte/<kind>s/` and `.ruimte/private/<kind>s/`, so a private drawing never sits in git either.
- A project file whose `version` is newer than this build is refused (`project-too-new`) and left untouched, never set aside as `.corrupt`. Same for a drawing and a diagram.
- A project is held by the clients that have it open (`ProjectHolds`). A hold lives as long as the socket does, and only the last one going lets the project go: two clients on one project must not undo each other's watcher. `closedAt` in the registry is the machine's own fact, which the sidebar an agent reads is filtered on; which projects a person keeps in their menu is that client's, and the client writes it.
- Closing (`project.close`) ends the sessions the project's document holds, read off the index, and only when the client asking was the last to hold it. A socket that drops never ends anything: a session outlives the client that opened its project.
