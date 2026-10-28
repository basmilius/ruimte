# Editor templates

- A person's templates live in `$RUIMTE_HOME/editor-templates.json` (0600), out of reach of client file requests. A project's live only in `.ruimte/templates.json`, with no private twin; `disabled` and `settings` are never written there.
- Any client of the owner edits a person's templates, since a template executes nothing; no peer does. A project's templates are read and written only by a client that holds the project. `template.changed` goes to the holders, or for a person's templates to every client.
- Agents only list templates and add to the person's own set (`ruimte-context template`, `canvas/template-verb.ts`). `TemplateStore.addByAgent` marks `addedBy`, changes and removes nothing, never writes the project file, and refuses a key any enabled template of that kind and language has (`template-key-taken`), built-in ones included (`packages/contracts/src/built-in-templates.ts`, held against ADE CORE's lists by a test).
- No template body leaves the machine.
- Every write goes against the revision read (`rev-conflict`). Outside edits move it too, and revisions start from the daemon's start time, so none repeats.
- A file with a newer `version` is refused (`templates-too-new`) and left untouched; `template.list` still answers a person's templates with `projectTooNew: true`. A JSON file that breaks the schema is refused the same way (`templates-invalid`). Only a non-JSON file is set aside as `.corrupt-<timestamp>`.
- Files are read loose and unknown entries written back in place. A save changes only the fields it names, and the project file is written only when its text changes.
- The daemon checks the key, body length and languages (`template-check.ts`), never the snippet syntax.
