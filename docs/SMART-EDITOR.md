# Smart editor

The plan for the code editor that replaces the previous engine (`packages/editor`): an editor of our own with language servers as its brain. It started as a proof of concept in a separate repository (`~/Development/Projects/ruimte-editor`) and was brought in on 2026-10-04. The approved designs are "Ruimte Code Editor" and "Ruimte Code Editor AI"; where this plan and a design disagree, the design wins.

## Packages

- `packages/smart-editor-core`: the document without a DOM: rope, history, commands, word navigation, brackets, typing context, search and folding. Its README holds the port scope and provenance.
- `packages/smart-editor-lsp`: the LSP 3.17 client and the `LanguageService` seam the view consumes. Runs on the daemon.
- `packages/smart-editor`: the view (own layout, input through a hidden textarea, Shiki coloring, virtualization) and the `EditorEngine` the client mounts.
- `apps/server/src/language`: the daemon runs the language servers and is their client, one server per project per kind, shared by every client of that project.
- `apps/client/src/language`: the binding between an open editor and the language service, and the surfaces around it (hover, completion, status bar, problems).

## Decisions

- The keymap follows the platform's macOS keymap wherever it does not collide with Ruimte's own shortcuts; every shortcut keeps a modifier.
- Camel-hump word movement is off by default and a setting.

- The daemon is the brain. A client never talks to a language server itself.
- Language servers are installed only when a person asks, pinned, under `$RUIMTE_HOME/language-servers`, and run on the daemon's own Bun. A project's own `typescript` comes first.
- A Vue project runs one TypeScript server with the Vue plugin for every script, so a `.ts` file sees the types of a `.vue` file.
- Completion follows design 1c (documentation beside the list), diagnostics follow 1e (calm: squiggles, the message in the hover and in Problems).
- Tabs (1a) and a file per view (1b) both exist in Ruimte, so the editor carries both the breadcrumb and sticky scroll.
- An edit across files lands as unsaved drafts; nothing is written to disk on a server's word alone.
- The file tree no longer follows the open file.
- Inline edit (⌘I) follows design 2b: the proposal sits under the selection, and the code stays untouched until Apply.
- Agent changes in open files follow the settings design: Off, Gutter (2c) or Review (2d).

## Phases

| Phase | What | State |
| --- | --- | --- |
| 1 | Core package | Done |
| 2 | LSP package, the daemon's host, the wire | Done |
| 3a | The view in the app | Done |
| 3b | Folding, wrap, editorconfig, sticky scroll, breadcrumb, git markers, scroll track, find and replace | Done |
| 4a | Binding, status bar, diagnostics, semantic tokens, inlay hints, hover, completion, signature help, highlights, symbols, Vue | Done |
| 4b | Workspace edits and commands, code actions, rename, go to definition, peek references, go to symbol, Problems, context menu, clickable names in the hover | Done |
| Test round | A round of testing the editor without AI before building on it | Now |
| Platform parity | The gaps a comparison with the platform's sources found: typing and editing (A), code insight (C), then carets, mouse and view (B) with the keymap | Now |
| 5 | AI in the editor | After the test round |
| 6 | On the device | After 5 |
| Cleanup | Remove the previous engine, close the known limits | When parity is confirmed |

### Test round

Bas tests the editor without AI features. Findings are fixed before phase 5 starts. Areas:

- Typing, IME and dead keys, copy, cut and paste, undo and redo, multiple carets.
- Scrolling with a trackpad (native again, with the gutter and the pinned headers stuck to the scroll container's corner), sticky scroll, folding, soft wrap.
- Nodes on the canvas below 100% zoom (the zoom limit for editing was removed).
- Every language feature on TypeScript, Vue and PHP projects, including install, restart and a crashed server.
- Edits across files through rename and code actions, and saving the drafts they leave.

### Phase 5: AI in the editor

From the "Code Editor AI" design:

- Selection to chat: ⌥⌘L puts the selection as a code block in the draft of a linked chat, without sending it.
- Inline prompt (⌘I, 2b): pick the agent per request; the selection and the problems on those lines go along as context. The work runs as a chat in the project, and the result comes back under the selection.
- Agent changes in open files: Off, Gutter (a chip in the header, a named cursor, a bar in the agent's color on changed lines) or Review (Keep, Undo or Comment per change; a comment goes to the chat as a draft with file and line).
- Provenance: hovering the colored bar shows the chat and the turn that wrote those lines, with the prompt.
- Conflict with unsaved work: when an agent writes while a person has unsaved changes, nothing is overwritten; per block a person picks the version that stays.
- Ask Claude Code and Ask Codex in the context menu and the problem card.
- Settings: Editor → AI.

The hard part sits in the daemon (chats, outbox, lineage); its brief gets written with care first.

### Phase 6: on the device

On-device model (Apple Foundation Models), code never leaves the Mac:

- Explain in the hover.
- Name suggestions in rename.
- Ghost text only on ⌥\, since the first text takes two to three seconds.

### Open questions

- Formatting follows the language server's own style, with only the tab size and indent style from `.editorconfig`. Options: configure the servers' formatter settings, run the project's own formatter (oxfmt, prettier, php-cs-fixer) with the repository's config, or a code style setting of Ruimte translated for each server. The second looks most worth it, since projects already record their style.

### Cleanup

- Remove `packages/editor` and its dependency once Bas confirms parity.
- Known limits:
  - Snippets have tab stops (Tab and Shift+Tab, Escape ends them), but a mirror of a stop is not edited along, a multi-line snippet is not re-indented and accepting a suggestion inside a stop ends the outer snippet.
  - The status bar shows no progress percentage (the servers send none).
  - Semantic tokens go without deltas.
  - Workspace edits refuse creating, renaming and deleting files.
  - Problems lists only open files, since servers report only on documents they were given.
  - A link to another file opens on its line, not its column (`file.preview` knows only a line).
  - Peek marks the line of a reference, not the match, and reads at most 30 files.
  - Mod plus hover does not underline names in the editor itself yet.
  - The code lens above functions ("N references") is not built.
