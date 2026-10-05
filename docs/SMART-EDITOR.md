# Smart editor

The plan for the code editor that replaces the previous engine (`packages/editor`): an editor of our own with language servers as its brain. It started as a proof of concept in a separate repository (`~/Development/Projects/ruimte-editor`) and was brought in on 2026-10-04. The approved designs are "Ruimte Code Editor" and "Ruimte Code Editor AI"; where this plan and a design disagree, the design wins.

## Packages

- `packages/smart-editor-core`: the document without a DOM: rope, history, commands, word navigation, brackets, typing context, search and folding. Its README holds the port scope and provenance.
- `packages/smart-editor-lsp`: the LSP 3.17 client and the `LanguageService` seam the view consumes. Runs on the daemon.
- `packages/smart-editor`: the view (own layout, input through a hidden textarea, Shiki coloring, virtualization) and the `EditorEngine` the client mounts.
- `apps/server/src/language`: the daemon runs the language servers and is their client, one server per project per kind, shared by every client of that project.
- `apps/client/src/language`: the binding between an open editor and the language service, and the surfaces around it (hover, completion, status bar, problems).

## Decisions

- Option+Cmd+L is Reformat, as on the platform; the AI features of phase 5 get keys of their own.

- The keymap follows the platform's macOS keymap wherever it does not collide with Ruimte's own shortcuts; every shortcut keeps a modifier. See "Keymap".
- Camel-hump word movement is off by default and a setting.

- The daemon is the brain. A client never talks to a language server itself.
- Language servers are installed only when a person asks, pinned, under `$RUIMTE_HOME/language-servers`, and run on the daemon's own Bun, except TypeScript, whose `typescript` 7 package brings a native server that runs as it is. A project's own `typescript` comes first when it is 7 or newer.
- Accepting a function, method or constructor (or a class after `new`) adds `()` on the client, whatever the server sends (`apps/client/src/language/completion-call.ts`), as the platform's parentheses handler does: the caret goes inside when the item has parameters or the server does not say, behind when it has none, nothing is added when a parenthesis already follows (Tab then goes inside it), the item is a snippet or holds a parenthesis, the caret is in an import or export list, a PHP `use` or attribute, after `typeof` and the like or in a JSX tag, or `(` itself commits the item. Parameter info opens as if `(` was typed, and the item's `editor.action.triggerParameterHints` command does the same. Languages: TypeScript, JavaScript, Vue, PHP and Python.
- A Vue project runs one TypeScript server with the Vue plugin for every script, so a `.ts` file sees the types of a `.vue` file. That server is a tsserver of TypeScript 6 behind typescript-language-server, since TypeScript 7 has no plugin API.
- TypeScript and JavaScript run the native TypeScript 7 server, which diagnoses by pull and has no completion of a function as a call, no refactors and no `local` modifier in its semantic tokens. Extend Selection grows through the ranges it gives.
- A file that changes on disk reaches the servers: an agent, git, composer or an editor elsewhere creating, changing or deleting a file in the project becomes `workspace/didChangeWatchedFiles` for each server whose registered patterns name it, so a class created on disk is in completion and symbols without reopening anything. The daemon watches the project folder only while a server has registered, and `node_modules`, `vendor` and `.git` are reported only to a pattern that names the folder. Events are batched per burst by the same settle timer the other watchers use (`apps/server/src/language/file-watch.ts`).
- The catalog of servers (TypeScript, Vue, PHP, CSS, HTML, JSON, YAML, Python, Bash, Dockerfile, plus ESLint and Tailwind CSS beside the server of the language) is `apps/server/src/language/profiles.ts`; `apps/server/README.md` has what each serves and how it is configured.
- A document can have several servers. Completion, code actions and hover are merged across them; any other feature is the first server's that offers it. ESLint and Tailwind CSS only serve a project that has an ESLint config or uses Tailwind.
- A person can add servers of their own (a command, its arguments and environment, the languages and file patterns it serves, optionally the projects it runs for) in Settings, Editor, Language servers. They live under `$RUIMTE_HOME`, only the local secret saves them, and a save approves exactly that command.
- Schemas for JSON and YAML are fetched from their hosts when a matching file opens. The YAML schema store is off, since it downloads its whole catalog when the server starts.
- Completion follows design 1c (documentation beside the list), diagnostics follow 1e (calm: squiggles, the message in the hover and in Problems).
- Tabs (1a) and a file per view (1b) both exist in Ruimte, so the editor carries both the breadcrumb and sticky scroll.
- An edit across files lands as unsaved drafts; nothing is written to disk on a server's word alone.
- The file tree no longer follows the open file.
- Inline edit (⌘I) follows design 2b: the proposal sits under the selection, and the code stays untouched until Apply.
- Agent changes in open files follow the settings design: Off, Gutter (2c) or Review (2d).
- The editor's settings are one section, Editor, with a tab per kind (General, Smart keys, Language servers); the AI tab arrives with phase 5. The code font face stays under Appearance because terminals share it.

## Code vision

A quiet row above each declaration with how often it is used and who wrote it, after the platform's code vision: the usage count first, the author after, a text size apart, muted, and an underlined link under the pointer. Both are switches in Settings, Editor, General (`codeVisionUsages` and `codeVisionAuthors`, on by default).

- The rows are drawn by the editor's layout (`setCodeVision`, `packages/smart-editor/README.md`): one code line high, at the indentation of the declaration, and holding their height with no entries, so the text does not move when the counts arrive. The platform also offers a position next to the declaration and at the scroll bar; here the row is always above it.
- A declaration is a class, interface, enum, struct, function or method, and for usages also the property or constant of a class (`apps/client/src/language/code-vision-model.ts`). A constructor has authors and no usages, a name that starts with `__` has no usages, and anything inside the body of a function gets no row. The row sits above the declaration once the comments before it are passed (a docblock stays above the row, a decorator or an attribute stays under it), and only for a declaration that starts its line. A language server that names a variable (`const rank = () => ...`) gets no row, since a variable is no declaration here.
- Usages come from `textDocument/references` without the declaration, for every server. Of the servers in the catalog only the native TypeScript server has a code lens at all, and only when its `referencesCodeLens.enabled` setting is on; intelephense and the Vue server have none. References work the same everywhere and count the same places the peek lists. They are asked lazily for the declarations in view and 40 lines around them, three at a time, after the text has settled (the symbols are read 500 ms after the last edit), and a scroll empties the queue behind the questions in flight. A count stays on its row until the new one arrives. A file past 20,000 lines or with more than 3,000 declarations gets no rows.
- Authors come from `git.blame`, asked once for the text on disk and again when that text or the head of the checkout changes. Text typed since is mapped through a line diff against the text on disk (`mapBlame`): a line the editor still has from there keeps its commit, a line typed or replaced since has none. As on the platform, a line with no commit counts for no author and marks the row with a star (`Ada *`), and a declaration with no committed line at all reads `new *`. The author is the one with most lines in the range from the name to the last line that holds more than closing brackets, blank lines left out, the first by name when two tie, and `+N` counts the others. A file git has no history for gets no authors. An uncommitted line is never counted as the person at the keyboard, since the blame cannot know who commits it.
- A press on the usages opens the peek of the references under the declaration. A press on the authors opens a card with each author's lines, the lines not committed yet and the newest commit that wrote a line of the range, with a button that opens that commit in the git panel.

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

The AI design gave Option+Cmd+L to sending the selection to a chat; Reformat keeps it, and phase 5 picks another key.

## Carets, mouse and view

What the editor does that a person notices, and the rule behind it:

- The caret added last is the primary one. The view scrolls to it, a language feature reads it, Escape keeps the oldest.
- A double click selects an identifier (not a word break) and a drag after it grows by words; a triple click and a press on a line number select lines and a drag grows by lines, Shift on a number grows or shrinks the selected lines.
- Selected text can be carried: a press on a selection waits for the pointer to move five pixels, then shows a drop caret; the copy key (Option on macOS, Ctrl elsewhere) at the drop copies. A press that does not move puts the caret there.
- Scrolling follows the platform's scrolling model: a line of margin when a caret is kept in view, a third from the top for a jump, also to something already in view (the platform's default), and Page Up and Down move whole lines with the caret on the same row. A scroll over more than a line takes up to a tenth of a second, a wheel or a touch ends it, and reduced motion turns it off.
- Word moves stop at the end of a word, then at the start of the next line, and on an empty line; deleting by word stops at both edges. Camel humps are a setting.
- Home and End go by the rows of a wrapped line; Home inside the indentation goes to the start of the line.
- Folds: brackets, block comments, indentation, import lists, runs of line comments and `region` markers, read off the text. A language server adds the ranges it folds (`textDocument/foldingRange`, which is how an HTML element or a JSX element folds) and names the bodies of its symbols (`textDocument/documentSymbol`). What is folded is kept per file with the scroll and the caret. Fold selection folds whole lines, so a selection inside one line has nothing to fold.
- Fold by default: a fold has a role, and Settings, Editor, Code folding says which roles fold by themselves when a file opens for the first time in a window and has no remembered folds. A file whose folds a person changed keeps its own. The defaults are the platform's: the file header and the imports fold, and documentation comments, function and method bodies, custom regions and the language options below wait for a person, except Markdown front matter, which folds. Read off the text: the file header, imports, documentation comments (`/**`), regions, object and array literals in a script, PHP attribute lists, PHP tags between markup, heredocs, and Markdown front matter, code fences and tables. From a server: function, method and class bodies (the bracket pair that closes where the symbol ends, or the indented block that does) and tags. A server's answer folds what it names once, never a fold somebody opened or closed, never one that holds the caret, never after the first edit, and without moving the scroll. PHP has its own switches for function, method and class bodies; the general method bodies apply to every other language. The commands that follow the platform are collapse and expand a region, recursively, all and by selection, plus collapse and expand documentation comments and expand all to level 1 through 5, which sit in Code, Folding and in the palette; the levels have no key, since the platform binds them to a chord of two strokes. The gutter arrow shows on hover, always or never.
- Not folded: a one-line function or a placeholder that rewrites text inside a line (an XML entity, a data URI, the key count of a JSON object, a YAML value shortened to a length), since a fold hides whole lines; the Markdown table of contents and links; the platform's separate switch for a single PHP attribute next to the attribute list.
- Selecting text marks its other occurrences (up to 50, one line, not blank), with ticks in the scroll track.
- Indent guides are on, with the guide of the caret's scope stronger. The right margin is the `max_line_length` of `.editorconfig` and is off without one. Whitespace is a setting, off.

## Code colors

The two code themes (`apps/client/src/shell/panels/code-themes.ts`) carry the colors of the platform's default color schemes, Islands Dark and its light counterpart, resolved with what the language plugins add for PHP, TypeScript and JavaScript, CSS, HTML, YAML and Markdown. A role holds one color per side and a list of TextMate scopes. Where the scheme colors one language apart from the rest (a PHP variable or constant, a static call, a local variable in TypeScript), the scope leads with the root scope of that grammar. What a language server classifies maps onto the same roles through scopes of its own (`apps/client/src/language/semantic-model.ts`). Three colors stand a step off the scheme to keep the contrast floors that `code-themes.test.ts` holds.

Left out: effects a scope cannot carry (the underline under a TypeScript parameter in the light scheme, the ground behind Markdown code) and the `<?php` tag, which Shiki's PHP grammar does not recognize, so it draws as an operator and a constant.

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

- Selection to chat (a key of its own, since Option+Cmd+L is Reformat) puts the selection as a code block in the draft of a linked chat, without sending it.
- Inline prompt (2b): pick the agent per request; the selection and the problems on those lines go along as context. The work runs as a chat in the project, and the result comes back under the selection.
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

### Servers that need a native binary

Not in the catalog yet, since the catalog installs npm packages and runs them on the daemon's own Bun (TypeScript 7 is the one exception: an npm package whose platform package holds the executable, verified with `--version` after the install). Worth adding, with how each would arrive:

- Rust (`rust-analyzer`), TOML (`taplo`), Lua (`lua-language-server`), Zig (`zls`): a download pinned by version and checksum under `$RUIMTE_HOME/language-servers/<kind>`, verified before it runs, only on a person's Install. `rust-analyzer` and `taplo` publish release archives per platform that fit this.
- Go (`gopls`), Swift (`sourcekit-lsp`, which comes with Xcode): found on the PATH of the machine (`xcrun --find sourcekit-lsp` for Swift), since both are tied to the toolchain a person already has. A kind whose command is found counts as installed and has no Install button.
- Markdown: `vscode-markdown-languageserver` starts under Bun but needs the client to answer `markdown/parse` with markdown-it tokens and its `markdown/fs/*` requests, so it waits for a client that does; Marksman is a native binary and fits the download way.

Until then a person can add any of these as a server of their own.

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
