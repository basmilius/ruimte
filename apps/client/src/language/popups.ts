import { createStore, type StoreApi } from 'zustand';
import type { EditorPosition, EditorRange } from '@ruimte/smart-editor';
import type { Location } from '@ruimte/smart-editor-lsp';
import type { Problem } from './diagnostics-model';
import type { PeekFile, PeekSnippet } from './peek-model';
import type { ActionEntry } from './code-actions-model';
import type { SymbolEntry } from './symbol-picker-model';
import type { HoverText } from './hover-content';
import type { SignatureViewModel } from './signature-model';

/* What a hover card shows for the character under the pointer. */
export interface HoverView {
    /* The card sits under this character, or over it when there is no room below. */
    readonly anchor: EditorPosition;
    /* The character the pointer rests on, which a count of references and a peek are asked at. */
    readonly position: EditorPosition;
    /* While the pointer stays in this range the card stays, so moving along a word does not make it blink. */
    readonly subject: EditorRange;
    readonly problems: readonly Problem[];
    /* What the servers say about the symbol, and where it is defined. */
    readonly info: HoverInfo | null;
}

export interface HoverInfo {
    readonly text: HoverText;
    readonly definition: Location | null;
    /* The name under the pointer, which a signature's own symbol is told by. */
    readonly word: string;
    /* How many other places use the symbol, once a server has counted them. */
    readonly references: number | null;
}

/* One line of the suggestions list. */
export interface CompletionRow {
    readonly label: string;
    readonly kind: number | undefined;
    /* The parameters or type the server puts after the label. */
    readonly detail: string;
    readonly deprecated: boolean;
}

/* The suggestions while a word is being typed. */
export interface CompletionView {
    /* The start of the word, which the list is placed under. */
    readonly anchor: EditorPosition;
    readonly rows: readonly CompletionRow[];
    readonly active: number;
    /* Whether the documentation of the active row is shown beside the list. */
    readonly detailsOpen: boolean;
    readonly docs: { readonly signature: string; readonly markdown: string } | null;
    /* The server the suggestions came from. */
    readonly server: string;
    /* The shiki id of the file's language, for the signature in the documentation. */
    readonly highlightLanguage: string;
}

/* The signature of the call the caret is in. */
export interface SignatureView {
    /* Where the call opened, so the card stays put while the arguments are typed. */
    readonly anchor: EditorPosition;
    readonly model: SignatureViewModel;
}

/* One line of a list the person picks from, such as a code action or a place a name is defined. */
export interface PickRow {
    readonly id: string;
    readonly label: string;
    /* What stands at the end of the line, such as a folder. */
    readonly detail: string;
    /* The detail is a path, which gives way from its start before the label gives way at all. */
    readonly path?: boolean;
}

export interface PickGroup {
    readonly title: string | null;
    readonly rows: readonly PickRow[];
}

/* The change an action would make, as the lines it takes away and the lines it puts in their place. */
export interface PickPreview {
    readonly removed: readonly string[];
    readonly added: readonly string[];
    /* Other places the change reaches, such as the files besides this one. */
    readonly note: string | null;
}

/* A list under a character of the editor; Enter takes the active row, Escape closes it. */
export interface PickView {
    readonly anchor: EditorPosition;
    readonly groups: readonly PickGroup[];
    readonly active: string;
    readonly preview: PickPreview | null;
    readonly title: string | null;
}

/* One file of a rename in the preview: the lines it changes. */
export interface RenameFileView {
    readonly uri: string;
    readonly rows: readonly { readonly line: number; readonly before: string; readonly after: string }[];
}

/*
 * The input over the symbol being renamed. In the preview phase the new name stays in the input,
 * read only, and the lines the rename changes are listed under it until Enter applies them.
 */
export interface RenameView {
    readonly phase: 'input' | 'preview';
    readonly range: EditorRange;
    /* The name in the text, and the one the input starts with. */
    readonly original: string;
    readonly placeholder: string;
    /* How many places the name has, once the servers said. */
    readonly occurrences: { readonly count: number; readonly files: number } | null;
    /* A request is out, so the input waits. */
    readonly busy: boolean;
    readonly name: string;
    readonly files: readonly RenameFileView[];
}

/* The references of a name between the lines of the file: a list of places and the code around the one that is active. */
export interface PeekView {
    /* The row the editor draws it in, which the editor makes again when it scrolls back into view. */
    readonly container: HTMLElement | null;
    readonly files: readonly PeekFile[];
    readonly active: string;
    readonly count: number;
    readonly preview: (PeekSnippet & { readonly uri: string }) | null;
}

/* The picker that jumps to a symbol of the file, over the symbols the servers know in it. */
export interface SymbolsView {
    /* The file's name, for the placeholder. */
    readonly file: string;
    readonly entries: readonly SymbolEntry[];
}

/* The context menu of the editor, asked for at a point of the page. */
export interface MenuView {
    readonly x: number;
    readonly y: number;
    /* The refactors the servers offer at the caret, once they have said. */
    readonly refactors: readonly ActionEntry[];
}

export interface PopupState {
    readonly hover: HoverView | null;
    readonly completion: CompletionView | null;
    readonly signature: SignatureView | null;
    readonly pick: PickView | null;
    readonly rename: RenameView | null;
    readonly peek: PeekView | null;
    readonly symbols: SymbolsView | null;
    readonly menu: MenuView | null;
}

export type PopupStore = StoreApi<PopupState>;

export function createPopupStore(): PopupStore {
    return createStore<PopupState>(() => ({ hover: null, completion: null, signature: null, pick: null, rename: null, peek: null, symbols: null, menu: null }));
}
