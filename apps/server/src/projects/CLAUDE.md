# Project, drawing and diagram files

The two project files and who closes a project are in the root `CLAUDE.md`.

- A drawing or diagram file follows its view between `.ruimte/<kind>s/` and `.ruimte/private/<kind>s/`, so a private drawing never sits in git.
- A project file whose `version` is newer than this build is refused (`project-too-new`) and left untouched, never set aside as `.corrupt`. Same for a drawing and a diagram.
- The clients that have a project open hold it (`ProjectHolds`) while their socket lives. Only they hear `project.changed`; every other client hears a document change as `project.summary` with its sidebar rows (`announceChange`). `closedAt` in the registry is the machine's own fact, and the sidebar an agent reads filters on it.
- Closing (`ProjectStore.closeProject`) ends the sessions the document holds, read off the index, so a project nobody has on screen closes the same way.
- The private file's `overlayFields` names the node fields a newer Ruimte keeps one person's. `mergeFiles` returns them (declared ones plus any unknown key in the overlay), `OpenProject` remembers them, and every write passes them to `splitContent`. So a save, a verb and an outside edit all keep those fields in the overlay, never the shared file.
- Which node runs on another machine lives in `RemoteStore` under `$RUIMTE_HOME/remote`, never in a project file. `ProjectStore` lays it over a document as `machine` only on the way out (open, `project.changed`); the index and every verb see none. A save that names none keeps the binding; a node leaving the document takes it along; a verb's change keeps the store's machines and drops any other.
- A canvas a machine keeps for another machine's nodes is `hidden` the same way. The daemon lays it over the document, `splitContent` and `mergeFiles` drop it from both files, and a save that shares one is refused (`hidden-view-shared`). A hidden chat view is stored.
- A save binds a node to another machine only for a terminal, chat or device node that started nothing here (no live session, chat record or lineage), never to this machine's own id, and never to another machine than the one it is bound to (`remote-node-invalid`).
