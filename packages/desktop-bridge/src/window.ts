/*
 * What a window shows, in the query of the address it loads. The shell writes it for a window it
 * opens and the page keeps it in step with what it shows, so a reload lands where the window was.
 * The shell never reads a key: it is the page's `${endpointId}:${projectId}`, carried whole.
 */
export const WINDOW_PROJECT_PARAM = 'project';

/* A window opened on the start screen, rather than on the project a cold start would open again. */
export const WINDOW_START_PARAM = 'start';

/* The view a window opened on a project shows first, once. The page drops it from the address as it claims the project. */
export const WINDOW_VIEW_PARAM = 'view';

/* What the page keeps of itself across a reload and a quit (`setWindowState`), opaque to the shell. */
export const WINDOW_STATE_PARAM = 'state';

/* The id of an auxiliary window, which shows some views of a project beside the window that has it. */
export const WINDOW_AUX_PARAM = 'aux';

/* The unit separator, which no project key and no id contains. */
const AUX_KEY_MARK = '\u001f';

/* A key of its own, so the project's key stays with the window that has the project. */
export function auxWindowKey(project: string, id: string): string {
    return `${project}${AUX_KEY_MARK}${id}`;
}

/* Null for the key of a project. */
export function splitAuxWindowKey(key: string): { project: string; id: string } | null {
    const at = key.lastIndexOf(AUX_KEY_MARK);
    if (at <= 0 || at === key.length - 1) {
        return null;
    }
    return { project: key.slice(0, at), id: key.slice(at + 1) };
}

/* A window the shell brought back from the last session, which opens its project only once it has the focus. */
export const WINDOW_DORMANT_PARAM = 'dormant';
