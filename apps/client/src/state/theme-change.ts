const ATTRIBUTE = 'data-theme-changing';

let pending: number | null = null;

/*
 * A change of theme swaps every color at once, and an element with a color transition would fade from
 * the old theme into the new one, each at its own pace. While the attribute is on, nothing transitions
 * (`styles.css`). It goes two frames later: the first paints the new colors, and only after it is a
 * transition free to start from them.
 */
export function withoutTransitions(change: () => void): void {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') {
        change();

        return;
    }

    const root = document.documentElement;

    if (pending !== null) {
        cancelAnimationFrame(pending);
    }

    root.setAttribute(ATTRIBUTE, '');
    change();

    pending = requestAnimationFrame(() => {
        pending = requestAnimationFrame(() => {
            pending = null;
            root.removeAttribute(ATTRIBUTE);
        });
    });
}
