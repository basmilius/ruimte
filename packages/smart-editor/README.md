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
- `view.ts`: the DOM, the scroll (the gutter sticks to the left of the text inside one scroll container, and the wheel scrolls in script so the text, the pinned headers and the rows move in one frame), the folds and what is drawn behind and above the text. `paint.ts` holds the drawing of rows, the gutter, the selection and the carets. Rows are absolutely placed runs of text, so the layout decides where each character is.
- `controller.ts`: what a person does. Keys are mapped in `keymap.ts` to the model's commands, typing goes through `DocumentModel.typeText`, the mouse through `pointer.ts`. The textarea (`native-input.ts`) is only the sink for the platform's typing, composition and paste, and carries the text around the caret for assistive technology.
- `tokens.ts` and `shiki.ts`: coloring. A grammar needs the state the previous line ended in, so lines are colored from a frontier down, a slice at a time, on the screen plus a margin. An edit moves the frontier to the changed line and stops as soon as a line ends in the state it had before. The tokenizer is injected (`TokenizerSource`); `shikiTokenizers` adapts the viewer's Shiki highlighter.
- `outline.ts`: the blocks of the document with a header line, read from braces and indentation until the host hands over better ones with `setBlocks` (a language server's symbols). Sticky scroll pins the headers of the blocks scrolled out of sight, and `onScope` reports the named blocks around the caret for a breadcrumb.
- `overview.ts`: the ticks in the scroll track for the host's change marks (`setChangeMarks`, also drawn in the gutter) and the find matches.
- `find.ts`: the matches of the host's find bar. They are marked in the editor and never touch the selection until `endFind`.
- `engine.ts`: the `Editor` contract over a model and a view.

`handBack` shortcuts are not handled by the editor and not prevented, so the page's own listeners get them. Mod+S is `onSave`.

## Limits

- No rendered documentation blocks, and no language features yet: diagnostics, completion and hover come with `@ruimte/smart-editor-lsp`. The layout already carries inlays and widget rows for them.
- Wrapped lines break at spaces and inside a word that does not fit, and continue at the line's indentation plus two characters. A click past the end of a visual line draws the caret at its end until the caret moves; an arrow key onto that offset draws it at the start of the next line.
- A line over 20,000 characters is not colored.
- Every edit rebuilds the row list, which is linear in the number of lines.
- No bidirectional text, and no screen reader testing beyond the textarea's own context.
