import { readClipboardText } from '@adecore/ui';
import type { ActionInput } from '@ruimte/actions';
import type { StoreApi } from 'zustand';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { readDrawingElements } from '@/drawing/export';
import type { DrawingState, DrawingStyle } from '@/state/drawing';

/* The store is the cell's own, never the focused one, so a split acts where it was asked. */

type DrawingStore = StoreApi<DrawingState>;

function viewOf(store: DrawingStore): string | null {
    return store.getState().viewId;
}

const NO_STYLE: NonNullable<ActionInput<'drawing.updateElements'>['style']> = {
    stroke: null,
    fill: null,
    fillColor: null,
    noteColor: null,
    strokeWidth: null,
    strokeStyle: null,
    roughness: null,
    font: null,
    textSize: null,
    align: null
};

export async function deleteSelection(store: DrawingStore): Promise<void> {
    const viewId = viewOf(store);
    if (viewId !== null) {
        await perform('drawing.deleteElements', { viewId, elementIds: null }).catch(ignoreRefusal);
    }
}

export function duplicateSelection(store: DrawingStore): void {
    const viewId = viewOf(store);
    if (viewId !== null) {
        void perform('drawing.duplicateElements', { viewId, elementIds: null }).catch(ignoreRefusal);
    }
}

export function reorderSelection(store: DrawingStore, to: 'front' | 'back'): void {
    const viewId = viewOf(store);
    if (viewId !== null) {
        void perform('drawing.reorderElements', { viewId, elementIds: null, to }).catch(ignoreRefusal);
    }
}

/* Locks what is selected, or unlocks it when all of it already is. */
export function toggleLockSelection(store: DrawingStore): void {
    const { viewId, elements, selection } = store.getState();
    if (viewId === null) {
        return;
    }
    const locked = elements.some((element) => selection.includes(element.id) && !element.locked);
    void perform('drawing.lockElements', { viewId, elementIds: null, locked }).catch(ignoreRefusal);
}

export function unlockEverything(store: DrawingStore): void {
    const { viewId, elements } = store.getState();
    const locked = elements.filter((element) => element.locked).map((element) => element.id);
    if (viewId !== null && locked.length > 0) {
        void perform('drawing.lockElements', { viewId, elementIds: locked, locked: false }).catch(ignoreRefusal);
    }
}

/* Paints the selection and becomes what the next element is drawn with. */
export function styleSelection(store: DrawingStore, patch: Partial<DrawingStyle>): void {
    const viewId = viewOf(store);
    if (viewId !== null) {
        void perform('drawing.updateElements', { viewId, elementIds: null, style: { ...NO_STYLE, ...patch }, text: null, dx: null, dy: null }).catch(
            ignoreRefusal
        );
    }
}

export function moveSelection(store: DrawingStore, dx: number, dy: number): void {
    const viewId = viewOf(store);
    if (viewId !== null) {
        void perform('drawing.updateElements', { viewId, elementIds: null, style: null, text: null, dx, dy }).catch(ignoreRefusal);
    }
}

export async function copyDrawing(store: DrawingStore, format: 'png' | 'svg' | 'elements'): Promise<boolean> {
    const viewId = viewOf(store);
    return viewId !== null && (await perform('drawing.copy', { viewId, format }).catch(ignoreRefusal)) !== null;
}

export async function cutSelection(store: DrawingStore): Promise<void> {
    if (await copyDrawing(store, 'elements')) {
        await deleteSelection(store);
    }
}

export async function pasteInto(store: DrawingStore): Promise<void> {
    const viewId = viewOf(store);
    const copies = readDrawingElements(await readClipboardText());
    if (viewId !== null && copies !== null && copies.length > 0) {
        await perform('drawing.addElements', { viewId, elements: null, copies }).catch(ignoreRefusal);
    }
}

export function exportDrawing(store: DrawingStore, format: 'png' | 'svg'): void {
    const viewId = viewOf(store);
    if (viewId !== null) {
        void perform('drawing.export', { viewId, format }).catch(ignoreRefusal);
    }
}
