import { sameDropPreview, type DropPreviewShape } from '@/shell/tab-drop';

/*
 * The one preview of where a dragged view would land, for the whole grid. A cell says where the
 * pointer is and the preview, drawn once above the parked pages (`shell/DropPreview.tsx`), moves to it.
 * There is one pointer, so there is one drag and one preview: module state, like `dragging()`.
 */
export interface DropPreviewState {
    /* The shape the preview has, or last had: it stays while the preview fades out. */
    shape: DropPreviewShape | null;
    shown: boolean;
    /* Whether this shape follows a shown one, so the outline moves into it instead of appearing there. */
    morph: boolean;
}

/*
 * How long a drag may be over no cell before the preview goes: the pointer crosses a splitter on
 * the way from one cell to the next, and the preview waits there instead of fading out and in.
 */
export const HIDE_GRACE_MS = 80;

const HIDDEN: DropPreviewState = { shape: null, shown: false, morph: false };

let state: DropPreviewState = HIDDEN;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: DropPreviewState): void {
    state = next;
    for (const listener of [...listeners]) {
        listener();
    }
}

function cancelHide(): void {
    if (pending !== null) {
        clearTimeout(pending);
        pending = null;
    }
}

export function subscribeDropPreview(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function dropPreview(): DropPreviewState {
    return state;
}

/* Moves the preview to `shape`. The first shape of a drag is where it fades in; every one after it is a glide. */
export function showDropPreview(shape: DropPreviewShape): void {
    cancelHide();
    if (state.shown && sameDropPreview(state.shape, shape)) {
        return;
    }
    set({ shape, shown: true, morph: state.shown });
}

/*
 * Takes the preview away. With `grace` it waits for the pointer to reach another cell first, which
 * is what a drag leaving a cell does; without, it goes at once, which is what an ended drag does.
 */
export function hideDropPreview(grace = false): void {
    cancelHide();
    if (!state.shown) {
        return;
    }
    if (!grace) {
        set({ ...state, shown: false, morph: false });
        return;
    }
    pending = setTimeout(() => {
        pending = null;
        set({ ...state, shown: false, morph: false });
    }, HIDE_GRACE_MS);
}
