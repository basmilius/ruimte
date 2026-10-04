export { DocumentModel } from './document.ts';
export type { DocumentEditOptions, DocumentLine, ReplaceAllOptions, ReplaceOptions, TypeTextOptions } from './document.ts';
export { scanBrackets, type BracketIndex } from './brackets.ts';
export { findMatches, replacementText, type FindMatch, type FindNextOptions, type FindOptions } from './search.ts';
export type { FoldingOptions, FoldingRange } from './structure.ts';
export { isHumpBoundary, isWordBoundary, wordBoundary, type WordText } from './words.ts';
export type {
    ChangeSource,
    CommandOptions,
    Disposable,
    DocumentChange,
    EditOptions,
    EditorCommand,
    EditorSnapshot,
    Position,
    Selection,
    TextEdit
} from './types.ts';
