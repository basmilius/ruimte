export { DocumentModel } from './document.ts';
export type { DocumentEditOptions, DocumentLine, ReplaceAllOptions, ReplaceOptions, TypeTextOptions } from './document.ts';
export { scanBrackets, type BracketIndex } from './brackets.ts';
export { replaceWithCaseRespect } from './preserve-case.ts';
export { findMatches, replacementText, type FindMatch, type FindNextOptions, type FindOptions } from './search.ts';
export { indentationColumn } from './structure.ts';
export type { FoldingOptions, FoldingRange } from './structure.ts';
export { isHumpBoundary, isWordBoundary, wordBoundary, type WordText } from './words.ts';
export type {
    ChangeSource,
    CommandOptions,
    ContentEdit,
    Disposable,
    DocumentChange,
    EditOptions,
    EditorCommand,
    EditorSnapshot,
    Position,
    Selection,
    TextEdit
} from './types.ts';
export { changedSpan, type TextSpan } from './text-span.ts';
