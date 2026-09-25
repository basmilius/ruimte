import { useLayoutEffect, useRef, useState } from 'react';

// The app-level dialogs open right now. Each one is its own root, so Base UI does not see them as nested.
const open = new Set<symbol>();

/*
 * Whether a dialog opened while another app-level dialog was already up, such as Compare models from
 * the menu bar over Settings. Such a dialog takes the nested steps (`dialog-backdrop-nested`,
 * `dialog-popup-nested`, a forced backdrop), or the one underneath stays on top and keeps taking clicks.
 */
export function useDialogLayer(isOpen: boolean): boolean {
    const id = useRef(Symbol('dialog'));
    // Decided in render at the moment the dialog opens, so its first frame is already on the right step.
    const [seen, setSeen] = useState({ open: false, stacked: false });
    if (seen.open !== isOpen) {
        setSeen({ open: isOpen, stacked: isOpen && open.size > 0 });
    }

    useLayoutEffect(() => {
        if (!isOpen) {
            return;
        }
        const self = id.current;
        open.add(self);
        return () => {
            open.delete(self);
        };
    }, [isOpen]);

    return isOpen && seen.stacked;
}
