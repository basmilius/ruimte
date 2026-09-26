import type { EditorState, TransactionSpec } from '@codemirror/state';

const isSpace = (text: string): boolean => /^\s/.test(text);

/*
 * Text an app puts in the draft, over the selection, as if it were typed there. A space keeps it apart
 * from a word it would touch, and one after it at the end of the text lets the person type on.
 */
export const insertAtSelection = (state: EditorState, text: string): TransactionSpec => {
    if (text === '') {
        return {};
    }
    const { from, to } = state.selection.main;
    const before = state.doc.sliceString(Math.max(0, from - 1), from);
    const after = state.doc.sliceString(to, to + 1);
    const lead = before !== '' && !isSpace(before) && !isSpace(text) ? ' ' : '';
    const trail = (after === '' || !isSpace(after)) && !/\s$/.test(text) ? ' ' : '';
    const insert = `${lead}${text}${trail}`;
    return { changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input' };
};
