/* Only the part of a `<webview>` this file needs, the id the shell knows its page by once it has one. */
interface GuestElement extends HTMLElement {
    getWebContentsId(): number;
}

/* The HTML previews on screen. They are not browser nodes, so the registry never sees them, but the
   shell names a right-click in one by its web contents id all the same. */
const previews = new Set<GuestElement>();

/* Answers the way to forget the preview again. */
export const registerPreviewGuest = (element: HTMLElement): (() => void) => {
    const guest = element as GuestElement;
    previews.add(guest);
    return () => {
        previews.delete(guest);
    };
};

export const previewGuestOf = (webContentsId: number): HTMLElement | undefined => {
    for (const element of previews) {
        try {
            if (element.getWebContentsId() === webContentsId) {
                return element;
            }
        } catch {
            // The guest is not attached yet, so it is not the one that asked.
        }
    }
    return undefined;
};
