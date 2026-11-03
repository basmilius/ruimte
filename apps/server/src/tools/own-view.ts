import {
    chatHostOf,
    isSessionView,
    type ProjectBrowserView,
    type ProjectChatView,
    type ProjectContent,
    type ProjectDesignView,
    type ProjectDeviceView,
    type ProjectTerminalView
} from '@ruimte/contracts';
import { VerbRefusal } from './verb.ts';

/* A chat, design, terminal, browser or device the project keeps as a view of its own, its session inside it. */
type OwnView = ProjectBrowserView | ProjectChatView | ProjectDesignView | ProjectDeviceView | ProjectTerminalView;

/*
 * The view an id names when it stands in the sidebar rather than on a canvas, or the view that holds it
 * as a later chat (of a design view, say); null for every other id.
 */
export function ownViewOf(content: Pick<ProjectContent, 'views'>, id: string): OwnView | null {
    const view = content.views.find((candidate) => candidate.id === id);
    if (view !== undefined && isSessionView(view)) {
        return view;
    }
    return chatHostOf(content.views, id)?.view ?? null;
}

/* What the refusal says the id is: the view itself, or a chat that view holds. */
function ownViewSentence(view: OwnView, id: string): string {
    return id === view.id
        ? `${view.id} is a ${view.kind} that is a view of its own`
        : `${id} is a chat of the ${view.kind} ${view.id}, which is a view of its own`;
}

/*
 * "Not a node on this canvas" would send an agent through every view of the project looking for it,
 * so the refusal says the id is a view of its own.
 */
export function refuseOwnView(view: OwnView, cannot: string, lines: string[] = [], id: string = view.id): VerbRefusal {
    return new VerbRefusal('not-on-a-canvas', `${ownViewSentence(view, id)}, not a node on any canvas of this project, so ${cannot}`, lines);
}

/*
 * The refusal for ids a canvas does not carry, whichever of the two they are. An id that names
 * nothing at all keeps the sentence it has always had, since that is the other case entirely.
 */
export function refuseMissingNodes(
    content: Pick<ProjectContent, 'views'>,
    missing: readonly string[],
    canvasId: string,
    cannot: string,
    lines: string[] = []
): VerbRefusal {
    const own = missing.flatMap((id) => {
        const view = ownViewOf(content, id);
        return view === null ? [] : [{ id, view }];
    });
    if (missing.length === 1 && own.length === 1) {
        return refuseOwnView(own[0]!.view, cannot, lines, own[0]!.id);
    }
    return new VerbRefusal('unknown-node', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a node on ${canvasId}`, [
        // One call named several ids, so the ones the sidebar holds are named under the sentence instead.
        ...own.map(({ id, view }) => `note\t${ownViewSentence(view, id)}, not a node on any canvas of this project`),
        ...lines
    ]);
}
