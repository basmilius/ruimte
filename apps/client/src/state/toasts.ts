import { create } from 'zustand';

// How long a toast that went well stays up; a failure waits for the person instead.
export const SUCCESS_MS = 4000;

/* `notice` is something that happened elsewhere: it carries no verdict, so it neither spins nor
   warns, and like a success it takes itself away. Nothing that waits for an answer is a toast at
   all; that is the banner over the views, where a person already looks for a decision. */
export type ToastKind = 'progress' | 'success' | 'error' | 'notice';

export interface ToastAction {
    label: string;
    run(): void;
}

export interface Toast {
    id: string;
    title: string;
    /* The line under the title: the last thing git wrote, or why it stopped. */
    description?: string;
    kind: ToastKind;
    /* Everything the command wrote, behind the copy button of a failure. */
    output?: string;
    action?: ToastAction;
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
    /* A toast that went well or only reports takes itself away; a failure and a running action stay. */
    const schedule = (id: string, kind: ToastKind): void => {
        const running = timers.get(id);
        if (running !== undefined) {
            clearTimeout(running);
            timers.delete(id);
        }
        if (kind !== 'success' && kind !== 'notice') {
            return;
        }
        timers.set(
            id,
            setTimeout(() => {
                timers.delete(id);
                get().dismiss(id);
            }, SUCCESS_MS)
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
            schedule(id, next.kind);
            return id;
        },
        update(id, patch) {
            const toasts = get().toasts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
            set({ toasts });
            const kind = toasts.find((entry) => entry.id === id)?.kind;
            if (kind !== undefined) {
                schedule(id, kind);
            }
        },
        dismiss(id) {
            const running = timers.get(id);
            if (running !== undefined) {
                clearTimeout(running);
                timers.delete(id);
            }
            set({ toasts: get().toasts.filter((entry) => entry.id !== id) });
        }
    };
});
