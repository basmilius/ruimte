import {
    splitAuxWindowKey,
    WINDOW_AUX_PARAM,
    WINDOW_DORMANT_PARAM,
    WINDOW_PROJECT_PARAM,
    WINDOW_START_PARAM,
    WINDOW_STATE_PARAM,
    WINDOW_VIEW_PARAM,
    type AgentActivity
} from '@ruimte/desktop-bridge';

/*
 * The address a window loads for its key. Without a key it opens on the start screen, except the
 * one window of a start without a session (`first`): that one loads the bare address, where the
 * page opens the project it remembers. A `dormant` window leaves its project closed until it has
 * the focus.
 */
export function windowUrl(base: string, key: string | null, first: boolean, view: string | null = null, state: string | null = null, dormant = false): string {
    if (key === null && first && state === null) {
        return base;
    }
    const url = new URL(base);
    if (key === null) {
        if (!first) {
            url.searchParams.set(WINDOW_START_PARAM, '1');
        }
    } else {
        // The page splits a key at its first colon, which the key of an auxiliary window would not survive.
        const aux = splitAuxWindowKey(key);
        url.searchParams.set(WINDOW_PROJECT_PARAM, aux?.project ?? key);
        if (aux !== null) {
            url.searchParams.set(WINDOW_AUX_PARAM, aux.id);
        }
        if (view !== null) {
            url.searchParams.set(WINDOW_VIEW_PARAM, view);
        }
        if (dormant) {
            url.searchParams.set(WINDOW_DORMANT_PARAM, '1');
        }
    }
    if (state !== null) {
        url.searchParams.set(WINDOW_STATE_PARAM, state);
    }
    return url.toString();
}

/* What a page may keep for its window across a quit. The shell never reads it, so only its size is checked. */
export function isWindowState(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && value.length <= 8192);
}

function isFiniteNumber(value: unknown): value is number {
    return Number.isFinite(value);
}

/* Where a page draws its tab strip, in its own coordinates; null for anything else, and for a page without one. */
export function tabStripOf(value: unknown): { x: number; y: number; width: number; height: number } | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const { x, y, width, height } = value as Record<string, unknown>;
    return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && isFiniteNumber(height) && width > 0 && height > 0
        ? { x, y, width, height }
        : null;
}

/* A point on the screen a new window's corner goes to, from a page that dragged something out. */
export function windowPointOf(value: unknown): { x: number; y: number } | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const { x, y } = value as Record<string, unknown>;
    return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : undefined;
}

/* A key a page may ask for: the page's own, never read here. */
export function isWindowKey(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= 512;
}

/* What one window posts to another, which the shell hands on unread. */
export function isWindowMessage(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= 262_144;
}

export function auxIdsOf(keys: Iterable<string | null>, project: string): string[] {
    const ids: string[] = [];
    for (const key of keys) {
        const aux = key === null ? null : splitAuxWindowKey(key);
        if (aux !== null && aux.project === project) {
            ids.push(aux.id);
        }
    }
    return ids;
}

/* A view a page asks a window to show, as opaque to the shell as a key. */
export function isWindowView(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= 256;
}

function count(value: unknown): number {
    return isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;
}

/* Every window counts the agents of its own project, so the app's share is their sum. */
export function totalActivity(activities: Iterable<AgentActivity>): AgentActivity {
    let working = 0;
    let attention = 0;
    for (const activity of activities) {
        working += count(activity.working);
        attention += count(activity.attention);
    }
    return { working, attention };
}
