import i18next from 'i18next';
import { runAsPerson } from '@/actions/client-actions';
import { revealNode, showView } from '@/project/views';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { sidebarProjectKey, useSidebarProjects } from './sidebar-projects';

import { sidebarNavigator } from './sidebar-target';
export type { SidebarTarget } from './sidebar-target';

export const openSidebarTarget = sidebarNavigator({
    open: async (endpointId, projectId) => ((await runAsPerson('project.switch', { endpointId, projectId })) === null ? 'failed' : 'done'),
    current: () => ({ endpointId: useProject.getState().currentEndpointId, projectId: useProject.getState().current?.projectId ?? null }),
    reveal(target) {
        const view = useDocument.getState().views.find((view) => view.id === target.viewId);
        const found = view && (!target.nodeId || target.nodeId === view.id || (view.kind === 'canvas' && view.nodes.some((node) => node.id === target.nodeId)));
        if (!found) {
            useToasts.getState().show({ kind: 'error', title: i18next.t('shell:sidebar.targetGone') });
            return;
        }
        showView(target.viewId);
        if (target.nodeId) {
            useSidebarProjects.getState().collapse(sidebarProjectKey(target.endpointId, target.projectId), false);
            const expanded = useUi.getState().sidebarExpanded ?? [];
            useUi.getState().setSidebarExpanded([...new Set([...expanded, target.viewId])]);
            if (view.kind === 'canvas') {
                revealNode(target.nodeId);
            }
        }
    }
});
