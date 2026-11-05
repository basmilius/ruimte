import { isCanvasView } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { locateView } from '@/layout/split';
import { useDocument } from '@/state/document';
import { webContentsIdOf } from './preview-guests';

const watched = new Map<HTMLElement, () => void>();
let installed = false;

// Chromium focus behavior varies, so accept both the shell's guest event and the element's captured focus.
function install(): void {
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
            if (webContentsIdOf(element) === webContentsId) {
                onFocus();
            }
        }
    });
}

export function watchGuestFocus(element: HTMLElement, onFocus: () => void): () => void {
    install();
    watched.set(element, onFocus);
    return () => {
        if (watched.get(element) === onFocus) {
            watched.delete(element);
        }
    };
}

/*
 * A page in a view taking the focus is a press in that view's cell. A view of its own also puts the
 * keyboard in its body, the way a press in it would; a page on a canvas leaves the canvas as it is.
 */
export function focusCellOfView(viewId: string): void {
    const document = useDocument.getState();
    const at = document.layout === null ? null : locateView(document.layout, viewId);
    if (at === null) {
        return;
    }
    document.focusCellAt(at);
    // A loose view stands in a cell without being a view of the document, and it is no canvas either.
    const view = document.views.find((candidate) => candidate.id === viewId);
    if (view === undefined || !isCanvasView(view)) {
        useDocument.getState().setBodyFocused(true);
    }
}
