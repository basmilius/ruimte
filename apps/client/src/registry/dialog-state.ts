import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface DialogStore<Request> {
    request: Request | null;
}

/* The state of one dialog: what it was asked for, or null while it is closed. The feature that owns the dialog owns this too. */
export interface DialogState<Request> {
    useRequest<Selected>(select: (request: Request | null) => Selected): Selected;
    get(): Request | null;
    open(request: Request): void;
    close(): void;
    /* Replaces the request, null included; for a caller that holds a value that may be none. */
    set(request: Request | null): void;
    readonly store: UseBoundStore<StoreApi<DialogStore<Request>>>;
}

const openChecks: Array<() => boolean> = [];

/* Whether any dialog made with these factories is up, for a key that must wait while a person answers one. */
export function anyDialogOpen(): boolean {
    return openChecks.some((isOpen) => isOpen());
}

export function createDialogState<Request>(): DialogState<Request> {
    const store = create<DialogStore<Request>>(() => ({ request: null }));
    const set = (request: Request | null): void => store.setState({ request });
    openChecks.push(() => store.getState().request !== null);

    return {
        useRequest: (select) => store((state) => select(state.request)),
        get: () => store.getState().request,
        open: (request) => set(request),
        close: () => set(null),
        set,
        store
    };
}

/* A dialog that needs no request: only whether it is up. */
export interface FlagState {
    useOpen(): boolean;
    isOpen(): boolean;
    open(): void;
    close(): void;
    set(open: boolean): void;
    readonly store: UseBoundStore<StoreApi<{ open: boolean }>>;
}

export function createFlagState(): FlagState {
    const store = create<{ open: boolean }>(() => ({ open: false }));
    const set = (open: boolean): void => store.setState({ open });
    openChecks.push(() => store.getState().open);

    return {
        useOpen: () => store((state) => state.open),
        isOpen: () => store.getState().open,
        open: () => set(true),
        close: () => set(false),
        set,
        store
    };
}
