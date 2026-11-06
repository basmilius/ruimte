import type { KeyboardEvent } from 'react';

/* A field's keys stay in the field, except Escape, which must reach the dialog's own listener so it closes like any other. */
export function submitOnEnter(submit: () => void): (event: KeyboardEvent) => void {
    return (event) => {
        if (event.key !== 'Escape') {
            event.stopPropagation();
        }

        if (event.key === 'Enter') {
            submit();
        }
    };
}
