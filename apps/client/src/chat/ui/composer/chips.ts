import { Facet, RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { chipRanges } from '@/chat/mentions';
import { CHIP_IN_EDITOR, MENTION_TONE, SKILL_TONE } from '@/chat/ui/chips';

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
    for (const range of chipRanges(state.doc.toString(), mentions, skills)) {
        builder.add(range.from, range.to, range.kind === 'skill' ? skillMark : mentionMark);
    }
    return builder.finish();
};

const chipField = StateField.define<DecorationSet>({
    create: chipMarks,
    update: (marks, tr) => (tr.docChanged || tr.startState.facet(choices) !== tr.state.facet(choices) ? chipMarks(tr.state) : marks),
    provide: (field) => EditorView.decorations.from(field)
});

/* Draws the chosen `@path` and `$name` tokens as chips; a new `ChipChoices` object is what redraws them. */
export const chipDecorations = (value: ChipChoices): Extension => [choices.of(value), chipField];
