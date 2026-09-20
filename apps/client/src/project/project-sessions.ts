import i18next from 'i18next';
import { sessionNodesOfView, type ProjectView, type ViewSessionNode } from '@ruimte/contracts';

/*
 * Every session a project holds, over every view it has. The views have to be the exported ones
 * (`exportViews`), so the view on screen is counted with what the canvas store has of it rather
 * than with the copy the document was loaded with. What one view holds is the daemon's rule too,
 * since `ruimte-context view delete` ends the same sessions on a canvas it removes.
 */
export const sessionNodesOf = (views: readonly ProjectView[]): ViewSessionNode[] => views.flatMap(sessionNodesOfView);

/*
 * What the confirmation says before a project closes. It counts rather than hedges, since a person
 * about to lose an agent mid-run wants to know how many, and the scrollback of a terminal is gone
 * with the session, which is the part that cannot be undone.
 */
export const closeWarning = (sessions: number): string =>
    sessions === 0 ? i18next.t('project:close.idle') : i18next.t('project:close.ending', { count: sessions });
