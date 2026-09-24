import { isCanvasView, type ProjectView } from '@ruimte/contracts';

export interface ProjectChat {
    id: string;
    title: string;
}

/* The views of a project, with the nodes of every canvas that is live in this window, whose titles run ahead of the document's. */
export interface ChatSource {
    views: readonly ProjectView[];
    canvases: Readonly<Record<string, ReadonlyArray<{ id: string; kind: string; title: string }>>>;
}

/* Every chat of the project under the name it has right now, node or view, in sidebar order. */
export const projectChats = (source: ChatSource): ProjectChat[] =>
    source.views.flatMap((view): ProjectChat[] => {
        if (view.kind === 'chat') {
            return [{ id: view.id, title: view.name }];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return (source.canvases[view.id] ?? view.nodes).filter((node) => node.kind === 'chat').map((node) => ({ id: node.id, title: node.title }));
    });

/* The chats an `@query` offers: never the chat typing it or one already attached. */
export const chatSuggestions = (chats: readonly ProjectChat[], query: string, exclude: readonly string[], limit: number): ProjectChat[] => {
    const needle = query.toLowerCase();
    return chats.filter((chat) => !exclude.includes(chat.id) && chat.title.toLowerCase().includes(needle)).slice(0, limit);
};
