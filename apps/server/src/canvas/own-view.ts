import {
    isSessionView,
    type ProjectBrowserView,
    type ProjectChatView,
    type ProjectContent,
    type ProjectDeviceView,
    type ProjectTerminalView
} from '@ruimte/contracts';
import { VerbRefusal } from './verb.ts';

/* A chat, terminal, browser or device the project keeps as a view of its own, its session inside it. */
export type OwnView = ProjectBrowserView | ProjectChatView | ProjectDeviceView | ProjectTerminalView;

/* The view an id names when it stands in the sidebar rather than on a canvas; null for every other id. */
export const ownViewOf = (content: Pick<ProjectContent, 'views'>, id: string): OwnView | null => {
    const view = content.views.find((candidate) => candidate.id === id);
    return view !== undefined && isSessionView(view) ? view : null;
};

/*
 * What a verb says about such an id. "Not a node on this canvas" is true and leaves open that it is
 * a node on another one, so an agent goes through every view of the project to find out that it is
 * not; the daemon has the document and can close that question in the sentence itself.
 */
export const refuseOwnView = (view: OwnView, cannot: string, lines: string[] = []): VerbRefusal =>
    new VerbRefusal('not-on-a-canvas', `${view.id} is a ${view.kind} that is a view of its own, not a node on any canvas of this project, so ${cannot}`, lines);

/*
 * The refusal for ids a canvas does not carry, whichever of the two they are. An id that names
 * nothing at all keeps the sentence it has always had, since that is the other case entirely.
 */
export const refuseMissingNodes = (
    content: Pick<ProjectContent, 'views'>,
    missing: readonly string[],
    canvasId: string,
    cannot: string,
    lines: string[] = []
): VerbRefusal => {
    const own = missing.map((id) => ownViewOf(content, id)).filter((view): view is OwnView => view !== null);
    if (missing.length === 1 && own.length === 1) {
        return refuseOwnView(own[0]!, cannot, lines);
    }
    return new VerbRefusal('unknown-node', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a node on ${canvasId}`, [
        // One call named several ids, so the ones the sidebar holds are named under the sentence instead.
        ...own.map((view) => `note\t${view.id} is a ${view.kind} that is a view of its own, not a node on any canvas of this project`),
        ...lines
    ]);
};
