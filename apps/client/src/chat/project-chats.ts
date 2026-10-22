import type { ProjectNode, ProjectView } from '@ruimte/contracts';
import type { ProjectChat } from '@adecore/agents-react/chat';
import type { NodesOfView } from '@/project/view-nodes';
import { useSidebarSource } from '@/shell/sidebar-source';

/* Every chat of the project under the name it has right now, node or view, in sidebar order. */
export function projectChats(views: readonly ProjectView[], nodesOf: NodesOfView<Pick<ProjectNode, 'id' | 'kind' | 'title'>>): ProjectChat[] {
    return views.flatMap((view): ProjectChat[] => {
        if (view.kind === 'chat') {
            // The chat an inline edit runs in is no chat a person attaches to a message.
            return view.hidden === true ? [] : [{ id: view.id, title: view.name }];
        }
        return nodesOf(view)
            .filter((node) => node.kind === 'chat')
            .map((node) => ({ id: node.id, title: node.title }));
    });
}

/* The chats of the open project, renamed the moment a node on a live canvas is. */
export function useProjectChats(): ProjectChat[] {
    const source = useSidebarSource();
    return projectChats(source.views, source.nodesOf);
}
