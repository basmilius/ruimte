import { sessionNodesOfView, type ProjectView, type ViewSessionNode } from '@ruimte/contracts';

/*
 * Every session a project holds, over every view it has. The views have to be the exported ones
 * (`exportViews`), so the view on screen is counted with what the canvas store has of it rather
 * than with the copy the document was loaded with. What one view holds is the daemon's rule too,
 * since `ruimte-context view delete` ends the same sessions on a canvas it removes.
 */
export const sessionNodesOf = (views: readonly ProjectView[]): ViewSessionNode[] => views.flatMap(sessionNodesOfView);

/*
 * What the confirmation says before a project closes. It counts rather than hedges: a person who is
 * about to lose an agent mid-run wants to read how many, and the scrollback of a terminal is gone
 * with the session, which is the part that cannot be undone.
 */
export const closeWarning = (sessions: number): string => {
    if (sessions === 0) {
        return 'Nothing in this project is running. It moves to Recent with its canvas as you left it.';
    }
    const what = sessions === 1 ? 'its running session' : `its ${sessions} running sessions`;
    return `Closing ends ${what}. A terminal loses its scrollback and an agent stops. The project moves to Recent with its canvas as you left it.`;
};
