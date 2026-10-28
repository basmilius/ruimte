# Project, drawing and diagram files

The root `CLAUDE.md` names the invariants; this file holds how the two files keep them.

## The two files

- The private file (`.ruimte/private/project.json`) holds the monotonic `rev`, the sidebar order over both files, and per shared node the fields that cannot travel: `resume`, `runtimeMode`, `worktree`, any absolute path, and a name a session gave (the shared file carries the name of the kind). The daemon writes the `.gitignore` beside it once.
- The shared file is written only when its text changes, so moving a private node leaves `git status` alone.
- Schemas parse loose and the types stay the known fields (`keepingUnknown`, `packages/contracts/src/project.ts`). A duplicate copies unknown keys, and a node becoming a view (and back) carries them, so a later field must stay correct when an older Ruimte copies it along.
- A new kind is only safe to write once the previous release already kept unknown kinds. A new field is written only from the release after the first one that keeps it, so 0.19 adds no stored field.
- A new stored field goes at the end of its schema. An older release writes the shared file in the key order it read, so the same order keeps a private change out of `git status`.
- A loose `.pick()` of a node goes through `pickKeepingUnknown`, which drops the keys it did not pick, since loose would keep them unchecked.
- A field that is one person's on a shared view lives in the overlay and is named in the private file's `overlayFields`. A Ruimte that does not know it keeps it in the overlay and never reads it from the shared file. `overlayFields` acts only on keys this version does not know, so a newer release cannot turn off a field an older one depends on. `mergeFiles` returns them, `OpenProject` remembers them, and every write passes them to `splitContent`, so a save, a verb and an outside edit all keep them out of the shared file.
- A drawing or diagram file follows its view between `.ruimte/<kind>s/` and `.ruimte/private/<kind>s/`, so a private drawing never sits in git.
- A project file whose `version` is newer than this build is refused (`project-too-new`) and left untouched, never set aside as `.corrupt`. The same holds for a drawing and a diagram.

## Holding and closing

- Clients with a project open hold it (`ProjectHolds`) while their socket lives. Only they hear `project.changed`; every other client hears `project.summary` with its sidebar rows (`announceChange`). `closedAt` in the registry is the machine's own fact, and the sidebar an agent reads filters on it.
- Closing (`ProjectStore.closeProject`) ends the sessions the document holds, read off the index, so a project nobody has on screen closes the same way.

## Chats outside a project

- A chat outside any project is a chat view in the machine's Chats project at `$RUIMTE_HOME/scratch`, in a folder of its own that no screen shows (`scratch-project.ts`, `scratch` on a summary, `apps/client/src/project/new-chat.ts`). It leaves only through `chat.move` (`apps/server/src/chat/CLAUDE.md`).

## Nodes on another machine

- Which node runs on another machine lives in `RemoteStore` under `$RUIMTE_HOME/remote`, never in a project file. `ProjectStore` lays it over a document as `machine` only on the way out (open, `project.changed`); the index and every verb see none. A save that names none keeps the binding, a node leaving the document takes it along, and a verb's change keeps the store's machines and drops any other.
- A canvas kept for another machine's nodes is `hidden` the same way. `splitContent` and `mergeFiles` drop it from both files, and a save that shares one is refused (`hidden-view-shared`). A hidden chat view is stored.
- A save binds a node to another machine only for a terminal, chat or device node that started nothing here (no live session, chat record or lineage), never to this machine's own id, and never to another machine than the one it is bound to (`remote-node-invalid`).
