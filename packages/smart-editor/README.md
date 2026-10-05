# @ruimte/smart-editor

The DOM view of the smart editor. It draws a `DocumentModel` from `@ruimte/smart-editor-core` with its own layout and implements the `EditorEngine` the client mounts a file editor through. It replaces the Monaco based `@ruimte/editor`, which stays until the new editor is confirmed.

```ts
const engine = createSmartEditorEngine({
    tokenizer: shikiTokenizers(() => highlighter),
    handBack: shellShortcuts,
    apple
});
const editor = engine.mount(element, { text, language: 'typescript', theme: 'ruimte-dark' });
```

The element needs a positioned box that its parent sizes, and the page needs `editor.css` and the tokens of `@basmilius/desktop-ui/theme.css` and the client's `styles.css`. The code face is the page's: `--font-mono`, `--code-font-size` and `--code-line-height`. `refreshFont()` reads it again.

## How it is put together

- `layout.ts`: the rows of the document, free of the DOM. A row is a line, a widget or a fold's first line. It owns wrapping into visual lines, tab stops, inlays, folded lines, caret and selection boxes, hit testing and moving by visual line. Only the rows on screen are measured; the others stand on an estimate that the first draw corrects.
- `view.ts`: the DOM, the scroll (native: the gutter and the pinned headers stick to the corner of the one scroll container, and the scroll event draws the rows, a viewport of them on each side, in the frame it shows in), the folds and what is drawn behind and above the text. `paint.ts` holds the drawing of rows, the gutter, the selection and the carets. Rows are absolutely placed runs of text, so the layout decides where each character is.
- `controller.ts`: what a person does. Keys come from one table (`keymap-table.ts`, which the client prints in its menus as well) and are mapped in `keymap.ts` to the model's commands, typing goes through `DocumentModel.typeText`, a paste through `DocumentModel.paste`, the mouse through `pointer.ts`. A copy or cut of a bare caret remembers its text for every editor of the page, and pasting that same text again, in any of them, lands as whole lines. Adding a caret above or below is the double tap of a modifier and an arrow (`modifier-gesture.ts`). The smart keys (`EditorSmartKeys`: pairing, surrounding, tabbing out, smart Enter, indent on paste, the smart semicolon and the camel humps) are options of the editor, set at mounting and changed with `setSmartKeys`; all are on except the camel humps. The textarea (`native-input.ts`) is only the sink for the platform's typing, composition and paste, and carries the text around the caret for assistive technology.
- `tokens.ts` and `shiki.ts`: coloring. A grammar needs the state the previous line ended in, so lines are colored from a frontier down, a slice at a time, on the screen plus a margin. An edit moves the frontier to the changed line and stops as soon as a line ends in the state it had before. The tokenizer is injected (`TokenizerSource`); `shikiTokenizers` adapts the viewer's Shiki highlighter. It loads the languages a grammar embeds only on demand (a style block's `lang="scss"`, a Markdown fence) when the document names them, since Shiki rebuilds the host grammar when one loads later, and a tokenizer says so with `stale` so the colors start over from the top. A language added to a document after it opened (a new fence) is colored once the file opens again. `php-html.ts` is the grammar for a PHP file as a document (HTML with PHP between its tags), which Shiki does not bundle; PHP inside an HTML attribute is not colored.
- `outline.ts`: the blocks of the document with a header line, read from braces and indentation until the host hands over better ones with `setBlocks` (a language server's symbols). Sticky scroll pins the headers of the blocks scrolled out of sight, and `onScope` reports the named blocks around the caret for a breadcrumb.
- `overview.ts`: the ticks in the scroll track for the host's change marks (`setChangeMarks`, also drawn in the gutter) and the find matches.
- `find.ts`: the matches of the host's find bar. They are marked in the editor and never touch the selection until `endFind`.
- `semantic.ts` and `theme-scopes.ts`: what a language server classified, drawn over the grammar's colors. The host hands scopes (`setSemanticTokens`), and the theme's own rules decide the color (`scopeColors`, `shikiScopeColors`), so a class is the theme's class color. A scope the theme says nothing about keeps what the grammar made.
- `scroll.ts` and `scroll-animation.ts`: where a scroll goes (the platform's scrolling model: margins, and a jump a third from the top) and how it gets there, over up to a tenth of a second and never for a line or less.
- `keymap-table.ts`: the keys of every editor and language command for macOS and the other platforms, which the client prints in its menus too (`@ruimte/smart-editor/keymap`).
- `engine.ts`: the `Editor` contract over a model and a view.

## What a language feature gets

The editor knows no language server. It reports every change of the text as LSP content changes (`onTextChange`, with its source), says where the caret is (`getCaret`, `onCaret`) and where a character is on the screen (`rectAt`, in the page's pixels so a popup is right at any canvas zoom), and takes what a host draws or does: `setMarkers` (squiggles, faded and struck text, a lane in the scroll track), `setInlayHints`, `setSemanticTokens`, `setHighlights`, `setBlocks`, `setWidgets` (rows of the host's own DOM under lines, drawn in the layout's block rows), `setCodeVision` (a quiet row above a declaration, see below), `setGutterAction` (one button in the gutter, such as a lightbulb, which `onGutterAction` reports), `setLink` (a name underlined as a link while a modifier is held) and `applyEdits`. A marker's `message` is what the tick of the problem says in the scroll track, where a press on the tick goes to the problem. `getSelection`, `getSelections`, `setSelections` (the last range is the primary one), `getVisibleRange` and `getIndentation` say what a feature asks about, and `setSelection` selects a range, such as the stop of a snippet. `onHover` reports the character under the pointer, `onClick` offers a press on a character first (Mod+click follows a name) and `onContextMenu` asks the host for its menu, which the editor does not draw, `onKeyDown` lets a host take a key before the editor does, and `onViewChange` says when the screen position of a character moved.

`setText` applies the difference as a line diff in one batch (`changedSpans`), one undo step reported as an external change, so a reload from disk or a sync between two editors on a file keeps the scroll, carets, folds, markers, inlays and code vision rows wherever the text around them stayed. A language server hears it as the one stretch from the first change to the last.

`runCommand` runs an editing command by name, which is how a menu or the palette reaches the editor; the folding commands (collapse and expand a region, all, recursively, a selection, documentation comments and "expand all to level 1 through 5") and column mode are the view's own.

A collapsed fold is one row for the line commands, as the platform has it: delete, duplicate, comment, move and a copy or cut with no selection take the whole fold (a moved fold stays collapsed on its new lines), a word move steps over it and add caret above and below skips it. The view hands the commands its rows through `lineSpan`.

Folds are kept by line (`getFolds`, and `folds` on mounting), the way scroll and caret are. A fold has a role (the file header, imports, documentation comments, regions, the body of a function, a method or a class, object and array literals, tags, attributes and so on, `FoldRole` of the core), and `foldDefaults` on mounting lists the roles that fold by themselves in a file that has no folds of its own. `setFoldHints` hands over a language server's symbols and folding ranges, which name the bodies and tags the text cannot, and the defaults fold what they name once: not a fold somebody opened or closed, not one that holds the caret, and nothing after the first edit. `foldOutline` (`off`, `hover` or `always`) says when the arrow shows in the gutter. Indent guides, whitespace and a right margin are options and setters (`guides`, `whitespace`, `rightMargin`). The find takes `inSelection`, `selectFindMatches` puts a caret on every match, `setReplacePreview` draws what a regular expression writes under the current match, and `findFromCursor` steps without a find bar.

`handBack` shortcuts are not handled by the editor and not prevented, so the page's own listeners get them. Mod+S is `onSave`.

## Code vision rows

`setCodeVision` takes a row per declaration: the line, and the entries of the row (`id`, `text`, an optional `user` or `users` icon, and `activate`, which gets the box of the pressed entry in the page's pixels). The row is a block row above the line (`lens` on a `BlockWidget`, `lens.ts` for its buttons), one code line high whatever its entries are, placed at the indentation of the declaration and never measured, so it holds its height with no entries and the text does not move when they arrive. It follows its declaration through edits like every block does, is kept apart from `setWidgets` (a peek under a name never takes a row away), and is drawn again only when the words of its entries change. An entry stands a text size from the next one, is muted, and lights up as a link with an underline under the pointer; a press on it never moves the caret or takes the focus.

## Limits

- No rendered documentation blocks.
- Wrapped lines break at spaces and inside a word that does not fit, and continue at the line's indentation plus two characters. A click past the end of a visual line draws the caret at its end until the caret moves; an arrow key onto that offset draws it at the start of the next line.
- A line over 20,000 characters is not colored.
- Every edit rebuilds the row list, which is linear in the number of lines.
- No bidirectional text, and no screen reader testing beyond the textarea's own context.
