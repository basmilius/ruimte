// A page is a screen minus a little, so the line you were reading is still on it after the jump.
const PAGE_OVERLAP = 0.9;

const scrollers = new Map<string, HTMLElement>();

/* The timeline hands its scroller over so the composer, which never sees it, can page through it. */
export const registerTimeline = (chatId: string, element: HTMLElement | null): (() => void) => {
    if (element === null) {
        return () => undefined;
    }
    scrollers.set(chatId, element);
    return () => {
        if (scrollers.get(chatId) === element) {
            scrollers.delete(chatId);
        }
    };
};

/* Pages the thread of this chat up or down; false when it has no timeline on screen. */
export const pageTimeline = (chatId: string, direction: -1 | 1): boolean => {
    const element = scrollers.get(chatId);
    if (!element) {
        return false;
    }
    element.scrollBy({ top: direction * element.clientHeight * PAGE_OVERLAP, behavior: 'smooth' });
    return true;
};
