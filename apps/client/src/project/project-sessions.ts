import { isCanvasView, isSessionView, type NodeKind, type ProjectView } from '@ruimte/contracts';

/* A node with a session behind it: the id the machine knows it by, and the kind that says how to end it. */
export interface SessionNode {
    id: string;
    kind: NodeKind;
}

/*
 * The kinds that keep something alive on the machine the project was opened on: a shell for a
 * terminal, a CLI for a chat. A browser is a page inside this client, and a group, a note or a
 * drawing is canvas and nothing else, so none of them is a session anybody has to be warned about.
 */
const SESSION_KINDS: readonly NodeKind[] = ['terminal', 'chat'];

/*
 * Every session a project holds, over every view it has. The views have to be the exported ones
 * (`exportViews`), so the view on screen is counted with what the canvas store has of it rather
 * than with the copy the document was loaded with.
 */
export const sessionNodesOf = (views: readonly ProjectView[]): SessionNode[] =>
    views.flatMap<SessionNode>((view) => {
        // A standalone view is one node without a canvas, under the same id as its session.
        if (isSessionView(view)) {
            return SESSION_KINDS.includes(view.kind) ? [{ id: view.id, kind: view.kind }] : [];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return view.nodes.filter((node) => SESSION_KINDS.includes(node.kind)).map((node) => ({ id: node.id, kind: node.kind }));
    });

/*
 * What the confirmation says before a project closes. It counts rather than hedges: a person who is
 * about to lose an agent mid-run wants to read how many, and the scrollback of a terminal is gone
 * with the session, which is the part that cannot be undone.
 */
export const closeWarning = (sessions: number): string => {
    if (sessions === 0) {
        return 'Nothing in this project is running. It drops under Recent and comes back with the canvas as you leave it.';
    }
    const what = sessions === 1 ? 'the session this project holds' : `the ${sessions} sessions this project holds`;
    return `Closing ends ${what}. A terminal loses its scrollback and an agent stops where it is. The project drops under Recent and comes back with the canvas as you leave it.`;
};
