import i18next from 'i18next';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { nodesOfView } from '@/project/view-nodes';
import { revealNode, showView } from '@/project/views';
import { useDocument, viewOfNode } from '@/state/document';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { sidebarProjectKey, useSidebarProjects } from './sidebar-projects';

import { sidebarNavigator } from './sidebar-target';
export type { SidebarTarget } from './sidebar-target';

async function openProject(endpointId: string, projectId: string): Promise<'done' | 'failed'> {
    return (await perform('project.switch', { endpointId, projectId }).catch(ignoreRefusal)) === null ? 'failed' : 'done';
}

function currentProject(): { endpointId: string | null; projectId: string | null } {
    return { endpointId: useProject.getState().currentEndpointId, projectId: useProject.getState().current?.projectId ?? null };
}

/* True once this window shows the project, which it may not when the project went to another window. */
export async function showSidebarProject(endpointId: string, projectId: string): Promise<boolean> {
    if ((await openProject(endpointId, projectId)) !== 'done') {
        return false;
    }
    const current = currentProject();
    return current.endpointId === endpointId && current.projectId === projectId;
}

export const openSidebarTarget = sidebarNavigator({
    open: openProject,
    current: currentProject,
    reveal(target) {
        const view = useDocument.getState().views.find((view) => view.id === target.viewId);
        // A later chat of a design is found where its design is.
        const found = view && (!target.nodeId || viewOfNode([view], nodesOfView, target.nodeId) !== null);
        if (!found) {
            useToasts.getState().show({ kind: 'error', title: i18next.t('shell:sidebar.targetGone') });
            return;
        }
        showView(target.viewId);
        if (target.nodeId) {
            useSidebarProjects.getState().collapse(sidebarProjectKey(target.endpointId, target.projectId), false);
            const expanded = useUi.getState().sidebarExpanded ?? [];
            useUi.getState().setSidebarExpanded([...new Set([...expanded, target.viewId])]);
            if (view.kind === 'canvas' || view.kind === 'design') {
                revealNode(target.nodeId);
            }
        }
    }
});
