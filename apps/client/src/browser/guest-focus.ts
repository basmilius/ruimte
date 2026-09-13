import { isCanvasView } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { locateView } from '@/shell/split';
import { useDocument } from '@/state/document';

/* A <webview> as far as this needs it: the id the shell knows its page by, once it has one. */
interface GuestElement extends HTMLElement {
    getWebContentsId?(): number;
}

const watched = new Map<HTMLElement, () => void>();
let installed = false;

/*
 * A press inside a <webview> never reaches the page around it: the guest keeps its input to itself.
 * Whether its focus does depends on the Chromium under it, so two roads are taken and either is
 * enough. The shell hears every guest take the focus and says which one (`guest:focus`), and the
 * element itself may fire a plain `focus`, which does not bubble and is caught on the way down.
 * Answering twice costs nothing: focusing a cell that already has the focus is a no-op.
 */
const install = (): void => {
    if (installed || typeof window === 'undefined') {
        return;
    }
    installed = true;
    window.addEventListener(
        'focus',
        (event) => {
            watched.get(event.target as HTMLElement)?.();
        },
        true
    );
    desktop()?.onGuestFocus?.((webContentsId) => {
        for (const [element, onFocus] of watched) {
            let id: number | undefined;
            try {
                id = (element as GuestElement).getWebContentsId?.();
            } catch {
                // A guest that has not attached yet has no web contents to compare, so it is not this one.
                continue;
            }
            if (id === webContentsId) {
                onFocus();
            }
        }
    });
};

/* Calls `onFocus` whenever this page takes the focus. Answers the way to stop. */
export const watchGuestFocus = (element: HTMLElement, onFocus: () => void): (() => void) => {
    install();
    watched.set(element, onFocus);
    return () => {
        if (watched.get(element) === onFocus) {
            watched.delete(element);
        }
    };
};

/*
 * A page in a view taking the focus is a press in that view's cell. A view of its own also puts the
 * keyboard in its body, the way a press in it would; a page on a canvas leaves the canvas as it is.
 */
export const focusCellOfView = (viewId: string): void => {
    const document = useDocument.getState();
    const at = document.layout === null ? null : locateView(document.layout, viewId);
    const view = document.views.find((candidate) => candidate.id === viewId);
    if (at === null || !view) {
        return;
    }
    document.focusCellAt(at);
    if (!isCanvasView(view)) {
        useDocument.getState().setBodyFocused(true);
    }
};
