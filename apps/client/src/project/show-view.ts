import { isCanvasView, type ProjectView } from '@ruimte/contracts';

/* What a toast calls an agent whose node this client cannot find in the document it holds. */
const SOMEONE = 'An agent';

/*
 * What to call the caller, out of the document this client already has: the title of its node, or
 * the name of the view when it is a session of its own. The event carries an id and never a title,
 * so this is the client's own lookup and it answers null for an id it has not heard of yet.
 */
export const callerName = (views: readonly ProjectView[], by: string): string | null => {
    for (const view of views) {
        if (view.id === by) {
            return view.name ?? null;
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === by);
            if (node) {
                return node.title;
            }
        }
    }
    return null;
};

export interface ShowViewNotice {
    title: string;
    description: string;
    /* Which button the card carries: back to where you were, over to the view, or neither. */
    action: 'back' | 'go-there' | null;
    /* A card the person has to act on stays; one that only reports something takes itself away. */
    stays: boolean;
}

/*
 * What the toast says. Three cases, and the middle one is why `alreadyThere` is asked before
 * anything moves: a view that is already in front is the same story in both settings, and offering
 * to go somewhere the person is standing reads as a bug.
 */
export const showViewNotice = (input: { agent: string | null; view: string; follow: boolean; alreadyThere: boolean }): ShowViewNotice => {
    const who = input.agent ?? SOMEONE;
    if (input.alreadyThere) {
        return { title: `${who} pointed at ${input.view}`, description: 'You were already looking at it.', action: null, stays: false };
    }
    if (input.follow) {
        return { title: `${who} showed ${input.view}`, description: 'It took the place of the view you were in.', action: 'back', stays: false };
    }
    return { title: `${who} asked for ${input.view}`, description: 'Nothing moved, because you turned that off.', action: 'go-there', stays: true };
};
