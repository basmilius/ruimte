import { createStore, type StoreApi } from 'zustand';
import type { EditorPosition, EditorRange } from '@ruimte/smart-editor';
import type { Problem } from './diagnostics-model';

/* What a hover card shows for the character under the pointer. */
export interface HoverView {
    /* The card sits under this character, or over it when there is no room below. */
    readonly anchor: EditorPosition;
    /* While the pointer stays in this range the card stays, so moving along a word does not make it blink. */
    readonly subject: EditorRange;
    readonly problems: readonly Problem[];
}

export interface PopupState {
    readonly hover: HoverView | null;
}

export type PopupStore = StoreApi<PopupState>;

export function createPopupStore(): PopupStore {
    return createStore<PopupState>(() => ({ hover: null }));
}
