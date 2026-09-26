import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { Language, defineLanguageFacet, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Annotation, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tagHighlighter, tags } from '@lezer/highlight';
import { Strikethrough, Table, parser } from '@lezer/markdown';

/* Marks a transaction that brings the editor in line with a value set from outside, so it is not reported back. */
export const externalChange = Annotation.define<boolean>();

/*
 * The markdown grammar in a Language of our own. `@codemirror/lang-markdown` builds the same thing
 * but creates the HTML language and autocomplete at module level, which tree shaking cannot drop.
 */
export const markdownLanguage = new Language(defineLanguageFacet(), parser.configure([Strikethrough, Table]), [], 'markdown');

/* Classes rather than generated styles, so the look lives in `styles.css` on the theme's tokens. */
const markdownClasses = tagHighlighter([
    { tag: tags.strong, class: 'cm-md-strong' },
    { tag: tags.emphasis, class: 'cm-md-emphasis' },
    { tag: tags.strikethrough, class: 'cm-md-strike' },
    { tag: tags.heading, class: 'cm-md-heading' },
    { tag: [tags.link, tags.url], class: 'cm-md-link' },
    { tag: tags.processingInstruction, class: 'cm-md-mark' }
]);

export interface CodeRange {
    from: number;
    to: number;
    kind: 'inline' | 'fence';
}

/* The code spans and fenced blocks between `from` and `to`, as far as the parser has got. */
export const codeRanges = (state: EditorState, from = 0, to = state.doc.length): CodeRange[] => {
    const found: CodeRange[] = [];
    syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
            if (node.name === 'InlineCode' || node.name === 'FencedCode') {
                found.push({ from: node.from, to: node.to, kind: node.name === 'InlineCode' ? 'inline' : 'fence' });
                return false;
            }
            return undefined;
        }
    });
    return found;
};

const inlineCodeMark = Decoration.mark({ class: 'cm-md-code' });

const fenceLine = (first: boolean, last: boolean): Decoration =>
    Decoration.line({ class: ['cm-md-fence', first ? 'cm-md-fence-start' : '', last ? 'cm-md-fence-end' : ''].join(' ').trim() });

/*
 * Code is decorated from the tree rather than highlighted per token: the highlighter styles the
 * backticks apart from what they wrap, and a block's background belongs to its whole lines.
 */
const codeDecorations = (view: EditorView): DecorationSet => {
    const { state } = view;
    const decorations: Array<Range<Decoration>> = [];
    const fenceLines = new Set<number>();
    for (const visible of view.visibleRanges) {
        for (const range of codeRanges(state, visible.from, visible.to)) {
            if (range.kind === 'inline') {
                decorations.push(inlineCodeMark.range(range.from, range.to));
                continue;
            }
            const first = state.doc.lineAt(range.from).number;
            const last = state.doc.lineAt(range.to).number;
            const start = state.doc.lineAt(Math.max(range.from, visible.from)).number;
            const end = state.doc.lineAt(Math.min(range.to, visible.to)).number;
            for (let number = start; number <= end; number++) {
                if (!fenceLines.has(number)) {
                    fenceLines.add(number);
                    decorations.push(fenceLine(number === first, number === last).range(state.doc.line(number).from));
                }
            }
        }
    }
    return Decoration.set(decorations, true);
};

const codeDecorationPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = codeDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
                this.decorations = codeDecorations(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations }
);

/*
 * What every composer editor carries. The standard keymap rather than the default one: the default
 * adds code editor commands (move a line, indent, select the syntax parent) on keys a prompt box
 * has no business taking.
 */
export const composerEditorExtensions = (): Extension => [
    history(),
    keymap.of([...standardKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    // What Tab and Shift+Tab in a fence add and take away, so a selection indents in the same steps as a caret.
    indentUnit.of('    '),
    markdownLanguage,
    syntaxHighlighting(markdownClasses),
    codeDecorationPlugin
];
