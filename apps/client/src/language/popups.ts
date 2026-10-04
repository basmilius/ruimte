import { createStore, type StoreApi } from 'zustand';
import type { EditorPosition, EditorRange } from '@ruimte/smart-editor';
import type { Location } from '@ruimte/smart-editor-lsp';
import type { Problem } from './diagnostics-model';
import type { HoverText } from './hover-content';
import type { SignatureViewModel } from './signature-model';

/* What a hover card shows for the character under the pointer. */
export interface HoverView {
    /* The card sits under this character, or over it when there is no room below. */
    readonly anchor: EditorPosition;
    /* While the pointer stays in this range the card stays, so moving along a word does not make it blink. */
    readonly subject: EditorRange;
    readonly problems: readonly Problem[];
    /* What the servers say about the symbol, and where it is defined. */
    readonly info: HoverInfo | null;
}

export interface HoverInfo {
    readonly text: HoverText;
    readonly definition: Location | null;
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

export interface PopupState {
    readonly hover: HoverView | null;
    readonly completion: CompletionView | null;
    readonly signature: SignatureView | null;
}

export type PopupStore = StoreApi<PopupState>;

export function createPopupStore(): PopupStore {
    return createStore<PopupState>(() => ({ hover: null, completion: null, signature: null }));
}
