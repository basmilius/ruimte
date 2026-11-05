interface Entry<T> {
    value: T;
    surface: HTMLElement;
}

export interface FocusRegistry<T> {
    register(value: T, surface: HTMLElement): () => void;
    /* The value whose surface holds the keyboard. The innermost wins when one surface sits inside another. */
    focused(): T | null;
    /* The value that last had the keyboard, when its surface sits in `cell`; null for a cell that never held one. */
    recentIn(cell: Element | null): T | null;
    subscribe(listener: () => void): () => void;
}

/* Remembers which of several editor-bound values has the keyboard, so a command from the palette or the menu finds it. */
export function createFocusRegistry<T>(): FocusRegistry<T> {
    const entries = new Set<Entry<T>>();
    const listeners = new Set<() => void>();
    let recent: Entry<T> | null = null;

    const changed = (): void => {
        for (const listener of [...listeners]) {
            listener();
        }
    };

    return {
        register(value, surface) {
            const entry = { value, surface };
            const remember = (): void => {
                recent = entry;
            };

            entries.add(entry);
            surface.addEventListener('focusin', remember);
            changed();

            return () => {
                entries.delete(entry);
                surface.removeEventListener('focusin', remember);

                if (recent === entry) {
                    recent = null;
                }

                changed();
            };
        },
        focused() {
            const active = document.activeElement;

            if (active === null) {
                return null;
            }

            let found: Entry<T> | null = null;

            for (const entry of entries) {
                if (entry.surface.contains(active) && (found === null || found.surface.contains(entry.surface))) {
                    found = entry;
                }
            }

            return found?.value ?? null;
        },
        recentIn(cell) {
            return cell !== null && recent !== null && entries.has(recent) && cell.contains(recent.surface) ? recent.value : null;
        },
        subscribe(listener) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        }
    };
}
