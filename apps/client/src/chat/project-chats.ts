import { designNodeChats, isChatHostView, isHiddenChatView, viewChats, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import type { ProjectChat } from '@adecore/agents-react/chat';
import type { NodesOfView } from '@/project/view-nodes';
import { useSidebarSource } from '@/shell/sidebar-source';

/* Every chat of the project under the name it has right now, node or view, in sidebar order. */
export function projectChats(views: readonly ProjectView[], nodesOf: NodesOfView<Pick<ProjectNode, 'id' | 'kind' | 'title' | 'chats'>>): ProjectChat[] {
    return views.flatMap((view): ProjectChat[] => {
        if (isChatHostView(view)) {
            // The chat an inline edit runs in is no chat a person attaches to a message.
            return isHiddenChatView(view) ? [] : viewChats(view).map((chat) => ({ id: chat.id, title: chat.name }));
        }
        return nodesOf(view).flatMap((node) =>
            node.kind === 'chat' || node.kind === 'design'
                ? [{ id: node.id, title: node.title }, ...designNodeChats(node).map((chat) => ({ id: chat.id, title: chat.name }))]
                : []
        );
    });
}

/* The chats of the open project, renamed the moment a node on a live canvas is. */
export function useProjectChats(): ProjectChat[] {
    const source = useSidebarSource();
    return projectChats(source.views, source.nodesOf);
}
