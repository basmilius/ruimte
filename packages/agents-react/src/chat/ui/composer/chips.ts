import { syntaxTree } from '@codemirror/language';
import { Facet, RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { chipRanges } from '../../mentions';
import { CHIP_IN_EDITOR, MENTION_TONE, SKILL_TONE } from '../chips';
import { codeRanges } from './editor';

export interface ChipChoices {
    mentions: string[];
    skills: string[];
}

const NO_CHOICES: ChipChoices = { mentions: [], skills: [] };

const choices = Facet.define<ChipChoices, ChipChoices>({ combine: (values) => values[0] ?? NO_CHOICES });

const mentionMark = Decoration.mark({ class: `${MENTION_TONE} ${CHIP_IN_EDITOR}` });
const skillMark = Decoration.mark({ class: `${SKILL_TONE} ${CHIP_IN_EDITOR}` });

const chipMarks = (state: EditorState): DecorationSet => {
    const { mentions, skills } = state.facet(choices);
    const builder = new RangeSetBuilder<Decoration>();
    // `@a.ts` in backticks is code, not a mention.
    for (const range of chipRanges(state.doc.toString(), mentions, skills, codeRanges(state))) {
        builder.add(range.from, range.to, range.kind === 'skill' ? skillMark : mentionMark);
    }
    return builder.finish();
};

const chipField = StateField.define<DecorationSet>({
    create: chipMarks,
    // The parser finishes a long text after the edit that asked for it, and a code span it finds then unmakes a chip.
    update: (marks, tr) =>
        tr.docChanged || tr.startState.facet(choices) !== tr.state.facet(choices) || syntaxTree(tr.startState) !== syntaxTree(tr.state)
            ? chipMarks(tr.state)
            : marks,
    provide: (field) => EditorView.decorations.from(field)
});

/* Draws the chosen `@path` and `$name` tokens as chips; a new `ChipChoices` object is what redraws them. */
export const chipDecorations = (value: ChipChoices): Extension => [choices.of(value), chipField];
