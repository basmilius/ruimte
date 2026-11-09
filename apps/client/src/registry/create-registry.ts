import { useSyncExternalStore } from 'react';

export interface Registry<Item extends { readonly id: string }> {
    /* Adds items in the order they are given; the same id twice is a wiring mistake and throws, except under a dev server that replaces modules, where the new item takes the place of the old. */
    add(...items: readonly Item[]): void;
    all(): readonly Item[];
    find(id: string): Item | undefined;
    /* The items as a render sees them: a feature that registers later redraws what read the list. */
    useAll(): readonly Item[];
    clear(): void;
}

/*
 * A list that features fill from their own folder and that the shell only reads. Items keep the order of
 * registration, which is the order the wiring (`wiring/`) names the features in.
 *
 * Vite runs the wiring again when a feature module changes, against the registry that still holds the
 * first run's items. With `import.meta.hot` the new item replaces the old one in its place; a build and the
 * tests have none, so there an id twice still throws. `replacing` is the seam for a test.
 */
export function createRegistry<Item extends { readonly id: string }>(name: string, replacing: boolean = import.meta.hot !== undefined): Registry<Item> {
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
            if (replacing) {
                for (const item of added) {
                    const at = items.findIndex((existing) => existing.id === item.id);
                    items = at === -1 ? [...items, item] : items.with(at, item);
                }
            } else {
                for (const item of added) {
                    if (items.some((existing) => existing.id === item.id)) {
                        throw new Error(`The ${name} "${item.id}" is registered twice.`);
                    }
                }
                items = [...items, ...added];
            }
            for (const listener of listeners) {
                listener();
            }
        },
        all: () => items,
        find: (id) => items.find((item) => item.id === id),
        useAll: () => useSyncExternalStore(subscribe, () => items),
        clear() {
            items = [];
            for (const listener of listeners) {
                listener();
            }
        }
    };
}
