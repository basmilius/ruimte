/* Only the part of a `<webview>` this file needs, the id the shell knows its page by once it has one. */
interface GuestElement extends HTMLElement {
    getWebContentsId?(): number;
}

/* The id the shell knows a guest's page by, or null while the guest is not attached yet. */
export function webContentsIdOf(element: HTMLElement): number | null {
    try {
        return (element as GuestElement).getWebContentsId?.() ?? null;
    } catch {
        return null;
    }
}

/* The HTML previews on screen. They are not browser nodes, so the registry never sees them, but the
   shell names a right-click in one by its web contents id all the same. */
const previews = new Set<HTMLElement>();

export function registerPreviewGuest(element: HTMLElement): () => void {
    previews.add(element);
    return () => {
        previews.delete(element);
    };
}

export function previewGuestOf(webContentsId: number): HTMLElement | undefined {
    return [...previews].find((element) => webContentsIdOf(element) === webContentsId);
}
