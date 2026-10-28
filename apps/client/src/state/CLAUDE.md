# Client state

- State about a machine is keyed on the id it mints, never its address; only `keys.ts` writes `${endpointId}:${nodeId}`.
- Attention is counted once in `attention.ts`, and `agent-work.ts` defines "working". The shell never counts.
- A key for the whole app (machines, settings, theme) is reread when another window writes it (`shared-storage.ts`), and a new such key joins the list there. What a window keeps for itself stays per page.
- A loose view (file, diff, commit, database) lives only in the layout, never in `project.json`. The layout owns where it stands and which tab is in front; `files.ts` owns what it shows. The pool never holds one the layout does not place (`pruneLoose`), and every open goes through `showLoose`. The layout loads before the panels.
- Closing cells goes through `cell-close.ts`, which asks each loose tab's own question and stops when a person keeps one; the pure grid operations ask nothing. Loose bodies stay mounted, hidden, behind a project view.
- A table promoted to a project view (`promoteLooseDatabase`) shares `useFiles.unsubmitted` with its loose tab. Only a person's `project.save` shares one, and not while its connection is private (`database/view-sharing.ts`).
