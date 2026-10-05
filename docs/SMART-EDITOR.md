# Smart editor

The plan for the code editor that replaces the previous engine (`packages/editor`): an editor of our own with language servers as its brain. It started as a proof of concept in a separate repository (`~/Development/Projects/ruimte-editor`) and was brought in on 2026-10-04. The approved designs are "Ruimte Code Editor" and "Ruimte Code Editor AI"; where this plan and a design disagree, the design wins.

## Packages

- `packages/smart-editor-core`: the document without a DOM: rope, history, commands, word navigation, brackets, typing context, search and folding. Its README holds the port scope and provenance.
- `packages/smart-editor-lsp`: the LSP 3.17 client and the `LanguageService` seam the view consumes. Runs on the daemon.
- `packages/smart-editor`: the view (own layout, input through a hidden textarea, Shiki coloring, virtualization) and the `EditorEngine` the client mounts.
- `apps/server/src/language`: the daemon runs the language servers and is their client, one server per project per kind, shared by every client of that project.
- `apps/client/src/language`: the binding between an open editor and the language service, and the surfaces around it (hover, completion, status bar, problems).

## Decisions

- The keymap follows the platform's macOS keymap wherever it does not collide with Ruimte's own shortcuts; every shortcut keeps a modifier. See "Keymap".
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

## Keymap

One table, `KEYMAP` in `packages/smart-editor/src/keymap-table.ts`, holds the key of every editor and language command for macOS and for the other platforms. The editor binds its keys from it, and the client prints the same keys in the Code and Go menus, the palette, the context menu and the Keyboard pane (`apps/client/src/shell/editor-keymap.ts`), so a printed key is the key that answers. macOS gets the platform's macOS keymap and the other platforms its default keymap. A test (`editor-keymap.test.ts`) holds the table against the shortcuts Ruimte answers from anywhere, so a collision fails the run.

Where Ruimte's own shortcut holds a key, the entry says which key the platform has and what holds it (`takenMac`, `takenOther`), and its chord is the closest free one:

| Command | Platform | Ruimte's | Chosen |
| --- | --- | --- | --- |
| Go to definition | Cmd+B, Ctrl+B | Toggle sidebar | Alt+Shift+D |
| Go to implementation | Cmd+Alt+B, Ctrl+Alt+B | Toggle panel | Alt+Shift+I |
| Quick definition, other platforms | Ctrl+Shift+I | Developer tools | Alt+Shift+P |
| Extend selection, other platforms | Ctrl+W | Close cell | Alt+Up (Alt+Down shrinks, as on macOS) |
| Match brace, other platforms | Ctrl+Shift+M | Voice control | Ctrl+M |
| Back and forward, other platforms | Ctrl+Alt+Left and Right | Focus the cell beside | Ctrl+[ and Ctrl+] |
| Next problem | F2 | Every shortcut needs a modifier | Alt+F2 (Alt+Shift+F2 for the previous one) |

Three entries differ from the platform for a reason other than a collision. Shrink selection stays Alt+Down off macOS, so it pairs with extend selection (the platform's Ctrl+Shift+W is free). Previous problem is Alt+Shift+F2, so it pairs with Alt+F2. Column mode is Cmd+Shift+8 off macOS too, since the platform's Alt+Shift+Insert is a key the shortcut notation has no name for. Move statement (Cmd+Shift+Up and Down) is not built, since it needs a syntax tree; those chords select to the ends of the text.

Find (Cmd+F) and Replace (Cmd+Shift+H) are Ruimte's, for every surface with a find bar; the editor adds the platform's Replace (Cmd+R, Ctrl+R) and find next and previous (Cmd+G and Cmd+Shift+G, Ctrl+L and Ctrl+Shift+L). Adding a caret above or below is a gesture and has no chord: tap Option twice on macOS (Ctrl elsewhere), hold it and press Up or Down; the Code menu has both commands. Text motion (arrows, Home, End, Page Up and Down, Enter, Tab, Backspace, Delete, Escape, and Cmd+Up and Down for the ends of the text on macOS) is the same everywhere and not in the table.

The macOS key of Reformat (Option+Cmd+L) is also the one the AI design gives to sending the selection to a chat, so phase 5 needs another key for one of the two.

## Carets, mouse and view

What the editor does that a person notices, and the rule behind it:

- The caret added last is the primary one. The view scrolls to it, a language feature reads it, Escape keeps the oldest.
- A double click selects an identifier (not a word break) and a drag after it grows by words; a triple click and a press on a line number select lines and a drag grows by lines, Shift on a number grows or shrinks the selected lines.
- Selected text can be carried: a press on a selection waits for the pointer to move five pixels, then shows a drop caret; the copy key (Option on macOS, Ctrl elsewhere) at the drop copies. A press that does not move puts the caret there.
- Scrolling follows the platform's scrolling model: a line of margin when a caret is kept in view, a third from the top for a jump to something out of view, and Page Up and Down move whole lines with the caret on the same row. A jump to something already in view leaves the view alone (`REFRAIN_FROM_SCROLLING` in `view.ts`; the platform's own default would move it). A scroll over more than a line takes up to a tenth of a second, a wheel or a touch ends it, and reduced motion turns it off.
- Word moves stop at the end of a word, then at the start of the next line, and on an empty line; deleting by word stops at both edges. Camel humps are a setting.
- Home and End go by the rows of a wrapped line; Home inside the indentation goes to the start of the line.
- Folds: brackets, block comments, indentation, import lists, runs of line comments and `region` markers. The import list folds when a file opens for the first time, and what is folded is kept per file with the scroll and the caret. Fold selection folds whole lines, so a selection inside one line has nothing to fold.
- Selecting text marks its other occurrences (up to 50, one line, not blank), with ticks in the scroll track.
- Indent guides are on, with the guide of the caret's scope stronger. The right margin is the `max_line_length` of `.editorconfig` and is off without one. Whitespace is a setting, off.

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
| Platform parity | The gaps a comparison with the platform's sources found: typing and editing (A), code insight (C), then carets, mouse and view (B) with the keymap | Done, being tested |
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
  - The code lens above functions ("N references") is not built.
