import { useSyncExternalStore } from 'react';

export interface Registry<Item extends { readonly id: string }> {
    /* Adds items in the order they are given; the same id twice is a wiring mistake and throws. */
    add(...items: readonly Item[]): void;
    all(): readonly Item[];
    find(id: string): Item | undefined;
    /* The items as a render sees them: a feature that registers later redraws what read the list. */
    use(): readonly Item[];
    /* Empties the registry, for a test that registers its own items. */
    clear(): void;
}

/*
 * A list that features fill from their own folder and that the shell only reads. Items keep the order of
 * registration, which is the order the wiring (`wiring/`) names the features in.
 */
export function createRegistry<Item extends { readonly id: string }>(name: string): Registry<Item> {
    let items: readonly Item[] = [];
    const listeners = new Set<() => void>();

    const subscribe = (listener: () => void): (() => void) => {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    };

    return {
        add(...added) {
            for (const item of added) {
                if (items.some((existing) => existing.id === item.id)) {
                    throw new Error(`The ${name} "${item.id}" is registered twice.`);
                }
            }
            items = [...items, ...added];
            for (const listener of listeners) {
                listener();
            }
        },
        all: () => items,
        find: (id) => items.find((item) => item.id === id),
        use: () => useSyncExternalStore(subscribe, () => items),
        clear() {
            items = [];
            for (const listener of listeners) {
                listener();
            }
        }
    };
}
