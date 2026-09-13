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
    /* The line under it, which only a toast has room for. */
    description?: string;
    /*
     * Where it lands. Something that already happened is a card in the corner and takes itself away;
     * a request that waits for an answer is the banner over the views, which is where this app puts
     * every other decision (the save conflict, the failure) and where a person looks for one.
     */
    where: 'toast' | 'banner';
    /* Whether that toast carries the way back; the banner's own buttons are the banner's. */
    back: boolean;
}

/*
 * What the message says. Three cases, and the middle one is why `alreadyThere` is asked before
 * anything moves: a view that is already in front is the same story in both settings, and offering
 * to go somewhere the person is standing reads as a bug.
 */
export const showViewNotice = (input: { agent: string | null; view: string; follow: boolean; alreadyThere: boolean }): ShowViewNotice => {
    const who = input.agent ?? SOMEONE;
    if (input.alreadyThere) {
        return { title: `${who} pointed at ${input.view}`, description: 'You were already looking at it.', where: 'toast', back: false };
    }
    if (input.follow) {
        return { title: `${who} showed ${input.view}`, description: 'It took the place of the view you were in.', where: 'toast', back: true };
    }
    // One line and no second one: the banner is a single row, and what is left to say the buttons say.
    return { title: `${who} asked you to look at ${input.view}`, where: 'banner', back: false };
};
