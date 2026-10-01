// A page is a screen minus a little, so the line you were reading is still on it after the jump.
const PAGE_OVERLAP = 0.9;

type Scroller = {
    element: HTMLElement;
    follow: (enabled: boolean) => void;
    // The height of the composer standing over the end of the scroller, which a page does not count.
    coveredHeight: () => number;
};

const scrollers = new Map<string, Scroller>();

/* The timeline hands its scroller over so the composer, which never sees it, can page through it. */
export const registerTimeline = (
    chatId: string,
    element: HTMLElement | null,
    follow: Scroller['follow'],
    coveredHeight: Scroller['coveredHeight']
): (() => void) => {
    if (element === null) {
        return () => undefined;
    }
    scrollers.set(chatId, { element, follow, coveredHeight });
    return () => {
        if (scrollers.get(chatId)?.element === element) {
            scrollers.delete(chatId);
            ends.delete(chatId);
        }
    };
};

/* The timeline owns following; the composer subscribes here to show its jump-to-end button. */
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

export const scrollTimelineToEnd = (chatId: string, behavior: ScrollBehavior = 'smooth'): void => {
    const scroller = scrollers.get(chatId);
    if (scroller) {
        scroller.follow(true);
        scroller.element.scrollTo({ top: scroller.element.scrollHeight, behavior });
    }
};

/* Pages the thread of this chat up or down; false when it has no timeline on screen. */
export const pageTimeline = (chatId: string, direction: -1 | 1): boolean => {
    const scroller = scrollers.get(chatId);
    if (!scroller) {
        return false;
    }
    scroller.follow(false);
    const { element } = scroller;
    element.scrollBy({ top: direction * Math.max(0, element.clientHeight - scroller.coveredHeight()) * PAGE_OVERLAP, behavior: 'smooth' });
    return true;
};

/*
 * The keyboard steps from one message of the person to the next through the timeline on screen,
 * which is the only side that knows where its rows start. Keyed with the scope's `keyOf`, the way
 * the app's shortcuts name the chat that has the focus.
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

/*
 * A jump to one message of a chat, asked from outside its thread (the chat's menu). A thread that is
 * not on screen yet gets it when it registers, since the menu may have to show the chat first.
 * Keyed with the scope's `keyOf`, like the steppers.
 */
const jumpers = new Map<string, (itemId: string) => void>();
const waitingJumps = new Map<string, string>();

export const registerItemJumper = (key: string, jump: (itemId: string) => void): (() => void) => {
    jumpers.set(key, jump);
    const waiting = waitingJumps.get(key);
    if (waiting !== undefined) {
        waitingJumps.delete(key);
        jump(waiting);
    }
    return () => {
        if (jumpers.get(key) === jump) {
            jumpers.delete(key);
        }
    };
};

/* False when that chat has no thread on screen; the jump then waits for the next one that registers. */
export const jumpToTimelineItem = (key: string, itemId: string): boolean => {
    const jump = jumpers.get(key);
    if (jump === undefined) {
        waitingJumps.set(key, itemId);
        return false;
    }
    jump(itemId);
    return true;
};

/* How near the top, in screens, the page before is asked for, so it is there before a reader reaches the edge. */
const EARLIER_SCREENS = 1.5;

export const wantsEarlier = (scroller: HTMLElement): boolean => scroller.clientHeight > 0 && scroller.scrollTop < scroller.clientHeight * EARLIER_SCREENS;

/* A row being read and how far below the top of its scroller it starts, so a page going in above leaves it there. */
export interface ReadingAnchor {
    id: string;
    offset: number;
}

/* The first row in view, found by the rows' `data-item-id`, for a thread that keeps every row in the document. */
export const firstRowInView = (scroller: HTMLElement): ReadingAnchor | null => {
    const top = scroller.getBoundingClientRect().top;
    for (const row of scroller.querySelectorAll<HTMLElement>('[data-item-id]')) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > top) {
            return { id: row.dataset.itemId!, offset: rect.top - top };
        }
    }
    return null;
};

/* Puts the anchored row back where it was; nothing moves when that row is gone. */
export const restoreAnchor = (scroller: HTMLElement, anchor: ReadingAnchor): void => {
    const row = scroller.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(anchor.id)}"]`);
    if (row !== null) {
        scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    }
};
