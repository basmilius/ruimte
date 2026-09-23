import { create } from 'zustand';
import type { Shortcut } from '@/ui/shortcut';

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

export interface Toast {
    id: string;
    title: string;
    /* The line under the title. The last thing git wrote, or why it stopped. */
    description?: string;
    kind: ToastKind;
    /* Everything the command wrote, behind the copy button of a failure. */
    output?: string;
    action?: ToastAction;
    /* A success that waits to be dismissed, for news that lands while nobody is looking yet. */
    persist?: boolean;
    /* Runs once the toast is gone, whether it ran out or was dismissed. */
    onClose?: () => void;
}

export type ToastInput = Omit<Toast, 'id'> & { id?: string };

interface ToastStore {
    toasts: Toast[];
    /* Puts one up, or moves the one with this id to what it says now; answers its id. */
    show(toast: ToastInput): string;
    update(id: string, patch: Partial<Omit<Toast, 'id'>>): void;
    dismiss(id: string): void;
}

let counter = 0;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/*
 * The one place the app says how something went. Every git action runs through it: one toast that
 * starts as progress, follows the phases while git runs and ends as the summary or the failure, so
 * a person never watches two cards for one push.
 */
export const useToasts = create<ToastStore>((set, get) => {
    /* A toast that went well takes itself away, and so does the offer to undo; a failure and a running action stay. */
    const schedule = (id: string, kind: ToastKind, persist: boolean): void => {
        const running = timers.get(id);
        if (running !== undefined) {
            clearTimeout(running);
            timers.delete(id);
        }
        const lifetime = kind === 'deleted' ? UNDO_MS : kind === 'success' && !persist ? SUCCESS_MS : null;
        if (lifetime === null) {
            return;
        }
        timers.set(
            id,
            setTimeout(() => {
                timers.delete(id);
                get().dismiss(id);
            }, lifetime)
        );
    };

    return {
        toasts: [],
        show(toast) {
            counter += 1;
            const id = toast.id ?? `toast-${counter}`;
            const next: Toast = { ...toast, id };
            const toasts = get().toasts;
            set({ toasts: toasts.some((entry) => entry.id === id) ? toasts.map((entry) => (entry.id === id ? next : entry)) : [...toasts, next] });
            schedule(id, next.kind, next.persist === true);
            return id;
        },
        update(id, patch) {
            const toasts = get().toasts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
            set({ toasts });
            const updated = toasts.find((entry) => entry.id === id);
            if (updated !== undefined) {
                schedule(id, updated.kind, updated.persist === true);
            }
        },
        dismiss(id) {
            const running = timers.get(id);
            if (running !== undefined) {
                clearTimeout(running);
                timers.delete(id);
            }
            const gone = get().toasts.find((entry) => entry.id === id);
            set({ toasts: get().toasts.filter((entry) => entry.id !== id) });
            gone?.onClose?.();
        }
    };
});
