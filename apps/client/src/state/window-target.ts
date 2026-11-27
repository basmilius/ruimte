import { WINDOW_AUX_PARAM, WINDOW_DORMANT_PARAM, WINDOW_PROJECT_PARAM, WINDOW_START_PARAM, WINDOW_VIEW_PARAM } from '@ruimte/desktop-bridge';
import { splitKey } from '@/state/keys';

/*
 * What the address of this page asks it to show: a project, the start screen, or (a bare address)
 * what a cold start opens, the project the last window had open. The desktop shell writes it for a
 * window it opens, and the page keeps it in step with what it shows, so a reload stays put.
 */
export type WindowTarget =
    /* `aux` is the id of an auxiliary window, which shows some views of the project beside the window that has it. */
    { kind: 'project'; endpointId: string; projectId: string; viewId?: string; dormant?: true; aux?: string } | { kind: 'start' } | { kind: 'last' };

export function readWindowTarget(search: string): WindowTarget {
    const query = new URLSearchParams(search);
    const key = query.get(WINDOW_PROJECT_PARAM);
    if (key !== null) {
        const { endpointId, id } = splitKey(key);
        if (endpointId !== '' && id !== '') {
            const viewId = query.get(WINDOW_VIEW_PARAM);
            const dormant = query.has(WINDOW_DORMANT_PARAM);
            const aux = query.get(WINDOW_AUX_PARAM);
            return {
                kind: 'project',
                endpointId,
                projectId: id,
                ...(viewId ? { viewId } : {}),
                ...(dormant ? { dormant: true } : {}),
                ...(aux ? { aux } : {})
            };
        }
    }
    return query.has(WINDOW_START_PARAM) ? { kind: 'start' } : { kind: 'last' };
}

/* The target of this page, and a bare address where there is no page to ask, as in a test. */
export function pageWindowTarget(): WindowTarget {
    return typeof location === 'undefined' ? { kind: 'last' } : readWindowTarget(location.search);
}

let pageAux: string | null | undefined;

/* Null for a window that has projects. Read once, since a page never changes from one into the other. */
export function auxWindowId(): string | null {
    if (pageAux === undefined) {
        const target = pageWindowTarget();
        pageAux = target.kind === 'project' ? (target.aux ?? null) : null;
    }
    return pageAux;
}

/* For a test, which has no address. Undefined reads the address again. */
export function setAuxWindowId(id: string | null | undefined): void {
    pageAux = id;
}

/* The query for a window showing a project (its `endpointKey`) or the start screen (null), keeping whatever else it carried.
   The view the shell asked for goes: it was for the first open, and a reload shows what the window had in front.
   So does dormant: a window that claims its project is awake. */
export function windowSearch(search: string, key: string | null): string {
    const query = new URLSearchParams(search);
    query.delete(WINDOW_PROJECT_PARAM);
    query.delete(WINDOW_START_PARAM);
    query.delete(WINDOW_VIEW_PARAM);
    query.delete(WINDOW_DORMANT_PARAM);
    if (key === null) {
        query.set(WINDOW_START_PARAM, '1');
    } else {
        query.set(WINDOW_PROJECT_PARAM, key);
    }
    return `?${query.toString()}`;
}
