import { WINDOW_PROJECT_PARAM, WINDOW_START_PARAM, type AgentActivity } from '@ruimte/desktop-bridge';

/*
 * The address a window loads for its key. Without a key it opens on the start screen, except the
 * one window of a start without a session (`first`): that one loads the bare address, where the
 * page opens the project it remembers, as the app did before it had more than one window.
 */
export const windowUrl = (base: string, key: string | null, first: boolean): string => {
    if (key === null && first) {
        return base;
    }
    const url = new URL(base);
    if (key === null) {
        url.searchParams.set(WINDOW_START_PARAM, '1');
    } else {
        url.searchParams.set(WINDOW_PROJECT_PARAM, key);
    }
    return url.toString();
};

/* A key a page may ask for: the page's own, never read here. */
export const isWindowKey = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/* Every window counts the agents of its own project, so the app's share is their sum. */
export const totalActivity = (activities: Iterable<AgentActivity>): AgentActivity => {
    let working = 0;
    let attention = 0;
    for (const activity of activities) {
        working += count(activity.working);
        attention += count(activity.attention);
    }
    return { working, attention };
};
