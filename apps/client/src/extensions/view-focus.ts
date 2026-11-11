import { focusCellOfView } from '@/surface/guest-focus';

/* How a view on screen takes the keyboard, by its id, from whatever draws it: a chat's composer, a terminal's cell. */
const focusers = new Map<string, () => void>();

export function provideViewFocus(viewId: string, focus: () => void): () => void {
    focusers.set(viewId, focus);

    return () => {
        if (focusers.get(viewId) === focus) {
            focusers.delete(viewId);
        }
    };
}

/* `views.focus`: the view's own way in, or else a press in its cell. */
export function focusView(viewId: string): void {
    const focus = focusers.get(viewId);

    if (focus === undefined) {
        focusCellOfView(viewId);

        return;
    }

    focus();
}
