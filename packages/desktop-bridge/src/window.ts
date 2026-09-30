/*
 * What a window shows, in the query of the address it loads. The shell writes it for a window it
 * opens and the page keeps it in step with what it shows, so a reload lands where the window was.
 * The shell never reads a key: it is the page's `${endpointId}:${projectId}`, carried whole.
 */
export const WINDOW_PROJECT_PARAM = 'project';

/* A window opened on the start screen, rather than on the project a cold start would open again. */
export const WINDOW_START_PARAM = 'start';
