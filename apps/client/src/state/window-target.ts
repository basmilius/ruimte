import { WINDOW_PROJECT_PARAM, WINDOW_START_PARAM, WINDOW_VIEW_PARAM } from '@ruimte/desktop-bridge';
import { splitKey } from '@/state/keys';

/*
 * What the address of this page asks it to show: a project, the start screen, or (a bare address)
 * what a cold start opens, the project the last window had open. The desktop shell writes it for a
 * window it opens, and the page keeps it in step with what it shows, so a reload stays put.
 */
export type WindowTarget = { kind: 'project'; endpointId: string; projectId: string; viewId?: string } | { kind: 'start' } | { kind: 'last' };

export function readWindowTarget(search: string): WindowTarget {
    const query = new URLSearchParams(search);
    const key = query.get(WINDOW_PROJECT_PARAM);
    if (key !== null) {
        const { endpointId, id } = splitKey(key);
        if (endpointId !== '' && id !== '') {
            const viewId = query.get(WINDOW_VIEW_PARAM);
            return { kind: 'project', endpointId, projectId: id, ...(viewId ? { viewId } : {}) };
        }
    }
    return query.has(WINDOW_START_PARAM) ? { kind: 'start' } : { kind: 'last' };
}

/* The target of this page, and a bare address where there is no page to ask, as in a test. */
export function pageWindowTarget(): WindowTarget {
    return typeof location === 'undefined' ? { kind: 'last' } : readWindowTarget(location.search);
}

/* The query for a window showing a project (its `endpointKey`) or the start screen (null), keeping whatever else it carried.
   The view the shell asked for goes: it was for the first open, and a reload shows what the window had in front. */
export function windowSearch(search: string, key: string | null): string {
    const query = new URLSearchParams(search);
    query.delete(WINDOW_PROJECT_PARAM);
    query.delete(WINDOW_START_PARAM);
    query.delete(WINDOW_VIEW_PARAM);
    if (key === null) {
        query.set(WINDOW_START_PARAM, '1');
    } else {
        query.set(WINDOW_PROJECT_PARAM, key);
    }
    return `?${query.toString()}`;
}
