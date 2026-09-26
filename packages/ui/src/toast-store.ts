import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Shortcut } from './shortcut.ts';

// How long a toast that went well stays up; a failure waits for the person instead.
export const SUCCESS_MS = 4000;

// How long a deletion can still be taken back.
export const UNDO_MS = 8000;

/* `deleted` says something went that can still come back, which is what its action is for. */
export type ToastKind = 'progress' | 'success' | 'error' | 'deleted';

export interface ToastAction {
    label: string;
    run(): void;
    /* The key that does the same, printed beside the label. The key itself is bound elsewhere. */
    shortcut?: Shortcut;
}

/* When a toast that goes by itself started counting and when it goes, as epoch milliseconds. */
export interface ToastDeadline {
    start: number;
    end: number;
}

/* How far into its lifetime a toast is at `now`, held inside that lifetime. */
export const elapsedOf = (deadline: ToastDeadline, now: number): number => Math.min(Math.max(now - deadline.start, 0), deadline.end - deadline.start);

/* An app that carries more on a toast extends this and hands its own type to `createToastStore`. */
export interface Toast {
    id: string;
    title: string;
    /* The line under the title, often the one that says why something stopped. */
    description?: string;
    kind: ToastKind;
    action?: ToastAction;
    /* A success that waits to be dismissed, for news that lands while nobody is looking yet. */
    persist?: boolean;
    /* Runs once the toast is gone, whether it ran out or was dismissed. */
    onClose?: () => void;
    /* Set by the store from the timer that takes the toast away, so what counts down on screen is that timer. */
    deadline?: ToastDeadline;
}

export type ToastInput<T extends Toast = Toast> = Omit<T, 'id' | 'deadline'> & { id?: string };

export type ToastPatch<T extends Toast = Toast> = Partial<Omit<T, 'id' | 'deadline'>>;

export interface ToastStore<T extends Toast = Toast> {
    toasts: T[];
    /* Puts one up, or moves the one with this id to what it says now; answers its id. */
    show(toast: ToastInput<T>): string;
    update(id: string, patch: ToastPatch<T>): void;
    dismiss(id: string): void;
}

export type ToastStoreHook<T extends Toast = Toast> = UseBoundStore<StoreApi<ToastStore<T>>>;

/*
 * The one place an app says how something went that no surface on screen shows. A long action keeps
 * one id from progress to its outcome, so a person never watches two cards for one thing.
 */
export const createToastStore = <T extends Toast = Toast>(): ToastStoreHook<T> => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let counter = 0;

    return create<ToastStore<T>>((set, get) => {
        const stop = (id: string): void => {
            clearTimeout(timers.get(id));
            timers.delete(id);
        };

        /* A toast that went well takes itself away, and so does the offer to undo; a failure and a running action stay. */
        const schedule = (id: string, kind: ToastKind, persist: boolean): ToastDeadline | undefined => {
            stop(id);
            const lifetime = kind === 'deleted' ? UNDO_MS : kind === 'success' && !persist ? SUCCESS_MS : null;
            if (lifetime === null) {
                return undefined;
            }
            timers.set(
                id,
                setTimeout(() => {
                    timers.delete(id);
                    get().dismiss(id);
                }, lifetime)
            );
            const start = Date.now();
            return { start, end: start + lifetime };
        };

        return {
            toasts: [],
            show(toast) {
                counter += 1;
                const id = toast.id ?? `toast-${counter}`;
                const next = { ...toast, id, deadline: schedule(id, toast.kind, toast.persist === true) } as T;
                const toasts = get().toasts;
                set({ toasts: toasts.some((entry) => entry.id === id) ? toasts.map((entry) => (entry.id === id ? next : entry)) : [...toasts, next] });
                return id;
            },
            update(id, patch) {
                const current = get().toasts.find((entry) => entry.id === id);
                if (current === undefined) {
                    return;
                }
                const merged: T = { ...current, ...patch };
                const next: T = { ...merged, deadline: schedule(id, merged.kind, merged.persist === true) };
                set({ toasts: get().toasts.map((entry) => (entry.id === id ? next : entry)) });
            },
            dismiss(id) {
                stop(id);
                const gone = get().toasts.find((entry) => entry.id === id);
                set({ toasts: get().toasts.filter((entry) => entry.id !== id) });
                gone?.onClose?.();
            }
        };
    });
};
