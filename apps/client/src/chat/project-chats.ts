import { useMemo } from 'react';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import type { ProjectChat } from '@ruimte/agents-react/chat/chat-references';
import { useSidebarSource } from '@/shell/sidebar-source';

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

/* The chats of the open project, renamed the moment a node on a live canvas is. */
export const useProjectChats = (): ProjectChat[] => {
    const source = useSidebarSource();
    return useMemo(() => projectChats(source), [source]);
};
