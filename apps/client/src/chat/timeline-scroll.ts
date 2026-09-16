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
            ends.delete(chatId);
        }
    };
};

/*
 * Whether the thread sits at its end. The timeline knows (it follows the tail while it is there),
 * the composer draws the button that goes back, and the two never meet: this is where they agree.
 */
const ends = new Map<string, boolean>();
const listeners = new Set<() => void>();

export const setTimelineAtEnd = (chatId: string, atEnd: boolean): void => {
    if (ends.get(chatId) === atEnd) {
        return;
    }
    ends.set(chatId, atEnd);
    for (const listener of listeners) {
        listener();
    }
};

export const subscribeTimelineEnd = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/* A thread nobody has scrolled is at its end, so the button stays away until there is a way back. */
export const timelineAtEnd = (chatId: string): boolean => ends.get(chatId) ?? true;

export const scrollTimelineToEnd = (chatId: string): void => {
    const element = scrollers.get(chatId);
    element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
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

/*
 * The keyboard steps from one message of the person to the next through the timeline on screen,
 * which is the only side that knows where its rows start. Keyed with `endpointKey`, the way the
 * workspace's shortcuts name the chat that has the focus.
 */
const steppers = new Map<string, (direction: -1 | 1) => boolean>();

export const registerMessageStepper = (key: string, step: (direction: -1 | 1) => boolean): (() => void) => {
    steppers.set(key, step);
    return () => {
        if (steppers.get(key) === step) {
            steppers.delete(key);
        }
    };
};

/* False when that chat has no timeline on screen or no message in that direction. */
export const stepTimelineMessage = (key: string, direction: -1 | 1): boolean => steppers.get(key)?.(direction) ?? false;
