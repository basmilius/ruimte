import { useCallback, useState } from 'react';

export interface ToggleSet {
    ids: ReadonlySet<string>;
    /* Opens what is closed and closes what is open, and tells `onToggle` a person did it. */
    toggle(id: string): void;
    /* Opens one without saying a person asked, for a jump that opens what it lands on. */
    add(id: string): void;
}

/*
 * The ids of the folds a thread has open. `onToggle` is what a thread does about a person opening
 * one, which is to stop following the end: a fold is a deliberate look back, not a reason to jump.
 */
export const useToggleSet = (onToggle?: () => void): ToggleSet => {
    const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

    const toggle = useCallback(
        (id: string): void => {
            setIds((current) => {
                const next = new Set(current);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            });
            onToggle?.();
        },
        [onToggle]
    );

    const add = useCallback((id: string): void => {
        setIds((current) => new Set(current).add(id));
    }, []);

    return { ids, toggle, add };
};
