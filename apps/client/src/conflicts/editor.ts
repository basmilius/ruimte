import { StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { MergeBlockKind, MergeSpan } from '@ruimte/merge';

/* Where a block sits in the document being edited, and whether anyone has settled it yet. */
export interface LiveSpan {
    block: number;
    kind: MergeBlockKind;
    from: number;
    to: number;
    settled: boolean;
}

/* One file halfway through: the text as it stands and where every block sits in it. */
export interface ConflictDraft {
    text: string;
    spans: LiveSpan[];
}

export const setSpans = StateEffect.define<LiveSpan[]>();
export const settleBlock = StateEffect.define<number>();

/* The first position of a line, counted from zero, clamped to the end of a shorter document. */
const startOf = (doc: Text, line: number): number => (line >= doc.lines ? doc.length : doc.line(line + 1).from);

/* The spans a fresh file starts with: line numbers as positions, nothing settled. */
export const spansOf = (doc: Text, spans: readonly MergeSpan[]): LiveSpan[] =>
    spans.map((span) => ({ block: span.block, kind: span.kind, from: startOf(doc, span.from), to: startOf(doc, span.to), settled: false }));

/*
 * Every block's place while the file is edited. CodeMirror maps the positions through each change,
 * so a block keeps its place whatever is typed above it, and a change that lands inside an open
 * conflict settles that conflict: writing the answer by hand is answering it.
 */
export const spansField = StateField.define<LiveSpan[]>({
    create: () => [],
    update(spans, transaction) {
        let next = spans;
        if (transaction.docChanged) {
            next = next.map((span) => {
                let settled = span.settled;
                if (!settled && span.kind === 'conflict') {
                    transaction.changes.iterChangedRanges((from, to) => {
                        if (from >= span.from && to <= span.to) {
                            settled = true;
                        }
                    });
                }
                return {
                    ...span,
                    settled,
                    from: transaction.changes.mapPos(span.from, -1),
                    to: transaction.changes.mapPos(span.to, 1)
                };
            });
        }
        for (const effect of transaction.effects) {
            if (effect.is(setSpans)) {
                next = effect.value;
            }
            if (effect.is(settleBlock)) {
                next = next.map((span) => (span.block === effect.value ? { ...span, settled: true } : span));
            }
        }
        return next;
    }
});

const LINE_CLASS: Record<Exclude<MergeBlockKind, 'stable'>, string> = {
    ours: 'cm-merge-ours',
    theirs: 'cm-merge-theirs',
    both: 'cm-merge-both',
    conflict: 'cm-merge-conflict'
};

// A stretch longer than this is drawn by its first lines alone; nobody reads a thousand marked rows.
const MAX_MARKED_LINES = 200;

const decorationsOf = (state: EditorState): DecorationSet => {
    const marks = [];
    for (const span of state.field(spansField)) {
        if (span.kind === 'stable') {
            continue;
        }
        const settled = span.kind !== 'conflict' || span.settled;
        const decoration = Decoration.line({ class: `${LINE_CLASS[span.kind]}${settled ? '' : ' cm-merge-open'}` });
        const first = state.doc.lineAt(Math.min(span.from, state.doc.length)).number;
        const last = state.doc.lineAt(Math.min(Math.max(span.to - 1, span.from), state.doc.length)).number;
        for (let line = first; line <= Math.min(last, first + MAX_MARKED_LINES); line += 1) {
            marks.push(decoration.range(state.doc.line(line).from));
        }
    }
    return Decoration.set(marks, true);
};

export const mergeDecorations: Extension = EditorView.decorations.compute([spansField], decorationsOf);

/* The block the cursor is in, so the panes below the editor follow what a person is reading. */
export const blockAt = (state: EditorState, position: number): number | null => {
    for (const span of state.field(spansField)) {
        if (span.kind === 'conflict' && position >= span.from && position <= span.to) {
            return span.block;
        }
    }
    return null;
};

export const spanOf = (state: EditorState, block: number): LiveSpan | undefined => state.field(spansField).find((span) => span.block === block);

/* One block replaced by the lines a person picked, and settled in the same step. */
export const applyBlock = (view: EditorView, block: number, lines: readonly string[]): void => {
    const span = spanOf(view.state, block);
    if (span === undefined) {
        return;
    }
    const { doc } = view.state;
    const ends = span.to >= doc.length;
    const body = lines.join('\n');
    // A stretch that holds no line at the end of the file needs the break that would have preceded it.
    const lead = lines.length > 0 && span.from === span.to && span.from === doc.length && doc.length > 0 ? '\n' : '';
    const insert = lines.length === 0 ? '' : `${lead}${body}${ends ? '' : '\n'}`;
    view.dispatch({
        changes: { from: span.from, to: span.to, insert },
        effects: settleBlock.of(block),
        scrollIntoView: true
    });
};

/* Brings a block into view and puts the caret at its first line. */
export const revealBlock = (view: EditorView, block: number): void => {
    const span = spanOf(view.state, block);
    if (span === undefined) {
        return;
    }
    view.dispatch({ selection: { anchor: span.from }, effects: EditorView.scrollIntoView(span.from, { y: 'center' }) });
    view.focus();
};
