# Language

- The editor's language classes are ADE CORE's, composed and never subclassed. `RuimteProject` (`ruimte-project.ts`) holds a shared `ProjectLanguage` over the wire service beside Ruimte's trackers; `createEditorLanguage` (`ruimte-editor-language.ts`) builds a shared `EditorLanguage` whose `app` holds the AI features (`explain`, `ghost`, `selectionChat`, `inlineEdit`) and the project. A feature takes the shared `EditorLanguage` and reads what it needs of the project through its constructor, not through `language.project`.
- Ghost text has one owner, the shared `language.inlineCompletion`. The AI ghost (`ghost-text.ts`) is a source it asks; a feature never calls `editor.setGhostText` itself, and Tab has the owner's one handler.
- A feature that needs a language server behind the document binds its key with `language.onServedKey` and gates its own availability on `language.served` only where it shows a command or a card.
