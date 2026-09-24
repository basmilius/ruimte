import { isCanvasView } from '@ruimte/contracts';
import { desktop } from '@/desktop/bridge';
import { FILES_VIEW_ID } from '@/shell/files-view';
import { locateView } from '@/shell/split';
import { useDocument } from '@/state/document';

/* Only the part of a `<webview>` this file needs, the id the shell knows its page by once it has one. */
interface GuestElement extends HTMLElement {
    getWebContentsId?(): number;
}

const watched = new Map<HTMLElement, () => void>();
let installed = false;

// Chromium focus behavior varies, so accept both the shell's guest event and the element's captured focus.
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
    if (at === null) {
        return;
    }
    document.focusCellAt(at);
    // The files stand in a cell without being a view of the document, and they are no canvas either.
    const view = document.views.find((candidate) => candidate.id === viewId);
    if (viewId === FILES_VIEW_ID || (view !== undefined && !isCanvasView(view))) {
        useDocument.getState().setBodyFocused(true);
    }
};
