import i18next from 'i18next';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';

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
    /* One line, because the banner is one row: what is left to say the buttons say. */
    message: string;
    /* The way out it offers: over to the view, back out of the one that was shown, or nothing at all. */
    action: 'go' | 'back' | null;
}

/*
 * What an agent's `view open` says, in all three cases. Every one of them is the banner over the views:
 * whether the view moved or not, it is the same agent speaking about the same thing, and a message
 * that changes place with a setting is two features to learn instead of one. `alreadyThere` is asked
 * before anything moves, since offering a way back to where the person is standing reads as a bug.
 */
export const showViewNotice = (input: { agent: string | null; view: string; follow: boolean; alreadyThere: boolean }): ShowViewNotice => {
    // What a toast calls an agent whose node this client cannot find in the document it holds.
    const agent = input.agent ?? i18next.t('project:showView.someone');
    if (input.alreadyThere) {
        return { message: i18next.t('project:showView.alreadyThere', { agent, view: input.view }), action: null };
    }
    if (input.follow) {
        return { message: i18next.t('project:showView.follow', { agent, view: input.view }), action: 'back' };
    }
    return { message: i18next.t('project:showView.go', { agent, view: input.view }), action: 'go' };
};
