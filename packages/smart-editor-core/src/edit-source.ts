import type { VueRegion } from './languages.ts';
import type { DocumentLine } from './rope.ts';
import type { TypingContext } from './typing-context.ts';
import type { Selection, TextEdit } from './types.ts';

/* What the editing features that go by the lines around a caret read from the document. */
export interface EditSource {
    slice(from: number, to: number): string;
    charAt(offset: number): string;
    lineAt(offset: number): number;
    lineCount: number;
    line(index: number): DocumentLine;
    /* The line break of a line. */
    newline(index: number): string;
    context(offset: number): TypingContext;
    region(line: number): VueRegion | null;
    /* Whether a `{` at this offset has no closer anywhere in the document. */
    unmatchedBrace(offset: number): boolean;
}

/* Edits to apply together and the selections that stand after them. */
export interface EditPlan {
    edits: TextEdit[];
    selections: Selection[];
}
