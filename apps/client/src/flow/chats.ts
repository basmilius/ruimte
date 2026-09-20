import { isCanvasView, type ProjectView } from '@ruimte/contracts';

/* Every chat in the project, wherever it stands, for a card that has to name one. */
export const chatChoices = (views: readonly ProjectView[]): { id: string; name: string }[] => {
    const chats: { id: string; name: string }[] = [];
    for (const view of views) {
        if (view.kind === 'chat') {
            // A chat view has no node id of its own: the view is the chat.
            chats.push({ id: view.id, name: view.name });
        } else if (isCanvasView(view)) {
            chats.push(...view.nodes.filter((node) => node.kind === 'chat').map((node) => ({ id: node.id, name: node.title || view.name })));
        }
    }
    return chats;
};
