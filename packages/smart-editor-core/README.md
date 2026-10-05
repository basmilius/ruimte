# @ruimte/smart-editor-core

The document model and editing logic of the smart editor, with no DOM and no dependencies. It runs in the browser, Bun and Node. The view that draws it and the language client that feeds it are separate packages (`@ruimte/smart-editor`, `@ruimte/smart-editor-lsp`).

`DocumentModel` holds the text as a persistent rope, the selections, a bounded undo history and the editing commands. Offsets are UTF-16 code units, lines and columns zero-based. A batch of edits is simultaneous and in the coordinates of the text before it.

## API

Everything comes from the package root.

- `DocumentModel`: `getText`, `getLine`, `slice`, `getSelections`, `getPrimary`, `getSnapshot`, `subscribe`, `applyEdits`, `setText`, `undo`, `redo`, `positionAt`, `offsetAt`, `find`, `findNext`, `replace`, `replaceAll`, `getFoldingRanges`, `typeText`, `paste`, `execute`, and `wordSelectionAt`, `wordStartBefore` and `wordEndAfter` for the mouse.
- The selections are in the order they were added, and the last is the primary caret; a merge that takes it in keeps it last.
- `applyEdits` takes `expectedRevision` and refuses the batch if the text moved on. A revision only goes up.
- `typeText` is one keystroke on every caret. It pairs brackets and quotes (each with its own option, and not in plain text), pairs a bracket only when the text after it has no closer for it, pairs a quote only when no identifier character follows, types over a closer, wraps a selection in a bracket, `<` or quote and swaps the quotes of a string when one of them is selected, sends a closing bracket alone on its line back to the indentation of its opener, leaves a Python docstring opener at three quotes and moves a `;` to the end of a call. It reads the language id (`typescript`, `php`, `python`, and so on) to tell code from comments and strings.
- `paste` takes one line for each caret when the counts match, puts text copied from a bare caret (`wholeLines`) above the line of each bare caret, and moves a pasted block to the indentation of the line it lands on.
- `execute` runs an `EditorCommand`: word and camel-hump movement, smart Home and End, backspace, Enter and its variants (start a line below or above, split a line), Tab, join lines, toggle case, auto-indent, line duplicate, delete and move, line and block comment toggles, indent, multiple carets (add above and below, which takes them back when pressed the other way, and one per selected line), selection expansion and the occurrence commands (next, unselect and all).
- A word move stops at the end of a word, then at the start of the next line, and on an empty line, going back at the start of a word and then the end of the line above; deleting by word stops at both edges of a word. Camel humps are off unless `camelCase` is true. Home and End take `visualLine`, so a wrapped row is an edge of its own, and Home inside the indentation goes to the start of the line.
- Select next occurrence selects the word at the caret, then whole words with the same case; from a selection it finds the text inside other words too. The end of the text is said (`occurrencesExhausted`) and the press after it starts again.
- `getFoldingRanges` also reads, with a language, runs of import lines, runs of line comments and `region` markers (`lexicalFolds`), and the whole-line blocks of Markdown (front matter, code fences, tables, the section under a heading) and PHP (heredocs and nowdocs, `<?php ... ?>` blocks between markup) in `blockFolds`.
- A range may carry a `role`, which is what the settings fold by when a file opens: the file header, a documentation comment, imports, a region, an object or array literal in a script and a PHP attribute list are read off the text (`fold-roles.ts`). The body of a function, a method or a class, and the tag a server's range starts with, come from `hints` in the options, which a host fills from a language server's symbols and folding ranges as offsets. A symbol names the bracket pair that closes where it ends, or the indented block that does; a range the text has no fold for becomes a `server` fold, one per line it starts on.
- `replace` and `replaceAll` can give the replacement the case of the match (`preserveCase`).
- Enter works from the lexer's state at the caret. It continues a line comment when text follows the caret, closes and continues `/*` and `/**` comments with the stars lined up under the opener's first star, splits a string literal with the language's concatenation, closes a brace nothing closes, indents after an opener, `def f():`, a YAML `key:`, a `case` label, an open tag and a statement left unfinished, and replaces the whitespace after the caret by the indentation it computes.
- Comment toggles use a table of markers per language (`commentSyntax`), with the region of a Vue file picked by the caret's line. Line comments go in at the smallest indentation of the lines, and a lone caret moves down a line. A language with block comments only wraps each line.
- Backspace at the start of a line also takes the whitespace that trails the line above. Tab inserts up to the next tab stop, or steps over a closer the editor added.
- `scanBrackets` pairs brackets lexically, for code that does not parse yet.
- `findMatches` and `replacementText` are the search the model uses.
- `isWordBoundary`, `isHumpBoundary` and `wordBoundary` are the word predicates and the navigation on top of them.
- Types for selections, edits, changes, snapshots, commands and options.

## Port scope and provenance

This package comes from a proof of concept editor that ports IntelliJ's editing behavior. Only one thing is ported code: the character-level word-boundary predicates in `src/words.ts` (`isWordBoundary`, `isHumpBound`, `isLowerCaseOrDigit` and `isPunctuation`). Their upstream is `platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java` in JetBrains/intellij-community at `7184b03af6c5370e79a01ded0df68cf56d7669da`, lines 934 through 982, under Apache 2.0. The file keeps the copyright header, and `NOTICE` and `LICENSE.apache-2.0.txt` come with the package.

The branch order, the start and end asymmetry, and the underscore, dollar and acronym rules are kept. Java's character tests are written as Unicode properties plus Java's whitespace and control ranges. Like the upstream char overloads, they look at UTF-16 code units, and a newer Unicode version in the runtime can classify a new character differently than Java does.

The rest is written here: the rope, transactions and history, the commands, search, folding and the lexical scanners. Bracket matching and delimiter typing were checked against IntelliJ's documented behavior and its `TypedParenImpl` and `TypedQuoteImpl` handlers, which depend on PSI and were not copied. Enter, comment toggling, join lines, paste and the handlers for typing over a selection follow the behavior of the same editor's handlers, with the lexer standing in for the syntax tree and no formatter; none of their code is used. Navigation avoids surrogate pairs and CRLF. IntelliJ's token filters, quoted-token policies and visual-line rules are not part of this.

## Known limits

- The scanners are lexical, not parsers. A `/` after an ambiguous construct can read as a regex or a division, and PHP heredocs, JSX text, Python triple quotes and HTML or XML tag pairs are not modeled. `scanStructure`, behind folding and selection expansion, does not know regex literals or template interpolation.
- Language is a string id with a short fixed list of rules for the lexer (script, hash comments, markup, CSS) and a table of comment markers. An unknown id is treated as a C-like language. Indentation is worked out from brackets, keywords and the end of the previous line, not by a formatter, so Auto-indent Lines leaves languages without braces alone.
- Smart semicolons only cross a trailing chain of `)` and `]`, and only in TypeScript, JavaScript and PHP.
- Search, folding and selection expansion read the whole document on request, synchronously. A regex has no timeout, so run untrusted patterns in a worker.
- Word navigation reads what it crosses: a single 4 MiB word takes well over half a second. History keeps the last 200 steps. The rope has no size cap and was measured up to 25 MiB (`bun run benchmark`).
- Backspace and delete by grapheme need `Intl.Segmenter`.
- Columns are UTF-16, not graphemes or visual columns, and tab stops only matter for indentation commands and indentation folds.
