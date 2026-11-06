import type { KeyboardEvent } from 'react';

/*
 * One Escape clears a pinned comparison. Meant for the capture phase of an element around the chart, since the chart
 * stops an Escape that clears its cursor; stopped there, so a dialog around it stays open.
 */
export function clearOnEscape(reference: string | null, onClear: () => void): (e: KeyboardEvent) => void {
    return (e) => {
        if (e.key === 'Escape' && reference !== null) {
            e.stopPropagation();
            onClear();
        }
    };
}
