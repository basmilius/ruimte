# @ruimte/smart-editor-core

The document model and editing logic of the smart editor, with no DOM and no dependencies. It runs in the browser, Bun and Node. The view that draws it and the language client that feeds it are separate packages (`@ruimte/smart-editor`, `@ruimte/smart-editor-lsp`).

`DocumentModel` holds the text as a persistent rope, the selections, a bounded undo history and the editing commands. Offsets are UTF-16 code units, lines and columns zero-based. A batch of edits is simultaneous and in the coordinates of the text before it.

## API

Everything comes from the package root.

- `DocumentModel`: `getText`, `getLine`, `slice`, `getSelections`, `getSnapshot`, `subscribe`, `applyEdits`, `setText`, `undo`, `redo`, `positionAt`, `offsetAt`, `find`, `findNext`, `replace`, `replaceAll`, `getFoldingRanges`, `typeText` and `execute`.
- `applyEdits` takes `expectedRevision` and refuses the batch if the text moved on. A revision only goes up.
- `typeText` is one keystroke on every caret: it pairs brackets and quotes, types over a closer, wraps a selection and moves a `;` to the end of a call. It reads the language id (`typescript`, `php`, `python`, and so on) to tell code from comments and strings.
- `execute` runs an `EditorCommand`: word and camel-hump movement, smart Home and End, backspace, newline, line duplicate, delete and move, comment toggle, indent, multiple carets, selection expansion and next occurrence.
- `scanBrackets` pairs brackets lexically, for code that does not parse yet.
- `findMatches` and `replacementText` are the search the model uses.
- `isWordBoundary`, `isHumpBoundary` and `wordBoundary` are the word predicates and the navigation on top of them.
- Types for selections, edits, changes, snapshots, commands and options.

## Port scope and provenance

This package comes from a proof of concept editor that ports IntelliJ's editing behavior. Only one thing is ported code: the character-level word-boundary predicates in `src/words.ts` (`isWordBoundary`, `isHumpBound`, `isLowerCaseOrDigit` and `isPunctuation`). Their upstream is `platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java` in JetBrains/intellij-community at `7184b03af6c5370e79a01ded0df68cf56d7669da`, lines 934 through 982, under Apache 2.0. The file keeps the copyright header, and `NOTICE` and `LICENSE.apache-2.0.txt` come with the package.

The branch order, the start and end asymmetry, and the underscore, dollar and acronym rules are kept. Java's character tests are written as Unicode properties plus Java's whitespace and control ranges. Like the upstream char overloads, they look at UTF-16 code units, and a newer Unicode version in the runtime can classify a new character differently than Java does.

The rest is written here: the rope, transactions and history, the commands, search, folding and the lexical scanners. Bracket matching and delimiter typing were checked against IntelliJ's documented behavior and its `TypedParenImpl` and `TypedQuoteImpl` handlers, which depend on PSI and were not copied. Navigation avoids surrogate pairs and CRLF. IntelliJ's token filters, quoted-token policies and visual-line rules are not part of this.

## Known limits

- The scanners are lexical, not parsers. A `/` after an ambiguous construct can read as a regex or a division, and PHP heredocs, JSX text, Python triple quotes and HTML or XML tag pairs are not modeled. `scanStructure`, behind folding and selection expansion, does not know regex literals or template interpolation.
- Language is a string id with a short fixed list of rules (script, hash comments, markup, CSS). An unknown id is treated as a C-like language.
- Smart semicolons only cross a trailing chain of `)` and `]`, and only in TypeScript, JavaScript and PHP.
- Search, folding and selection expansion read the whole document on request, synchronously. A regex has no timeout, so run untrusted patterns in a worker.
- Word navigation reads what it crosses: a single 4 MiB word takes well over half a second. History keeps the last 200 steps. The rope has no size cap and was measured up to 25 MiB (`bun run benchmark`).
- Backspace and delete by grapheme need `Intl.Segmenter`.
- Columns are UTF-16, not graphemes or visual columns, and tab stops only matter for indentation commands and indentation folds.
