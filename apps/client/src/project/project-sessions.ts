import i18next from 'i18next';
import { sessionNodesOfView, type ProjectClosingResult, type ProjectView, type ViewSessionNode } from '@ruimte/contracts';

/*
 * Every session a project holds, over every view it has. Pass the exported views (`exportViews`), so
 * the view on screen counts what its canvas store holds. The daemon's `view delete` ends the same set.
 */
export function sessionNodesOf(views: readonly ProjectView[]): ViewSessionNode[] {
    return views.flatMap(sessionNodesOfView);
}

/*
 * What the confirmation counts. The document on screen wins, since a node made a moment ago has not
 * been saved yet. A project another client keeps loses nothing either way.
 */
export function closingCount(answer: ProjectClosingResult, local: number | null): ProjectClosingResult {
    return answer.otherClients > 0 || local === null ? answer : { ...answer, sessions: local };
}

/*
 * What the confirmation says before a project closes: how many sessions end, since their scrollback
 * cannot come back. A project another client still has open loses nothing, so it says that instead.
 */
export function closeWarning(sessions: number, otherClients = 0): string {
    if (otherClients > 0) {
        return i18next.t('project:close.held', { count: otherClients });
    }
    return sessions === 0 ? i18next.t('project:close.idle') : i18next.t('project:close.ending', { count: sessions });
}
