import { chatNameOf } from '@ruimte/contracts';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { useWindowTabs } from '@/project/window-tabs';
import { sidebarWaitingNodes } from '@/state/attention';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey, splitKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { nextWaiting, projectWaiting, type Waiting } from '@/state/waiting';
import { showSidebarProject } from './sidebar-navigation';
import { sidebarMachineSnapshot } from './sidebar-projects';

interface ProjectWait extends Waiting {
    endpointId: string;
    projectId: string;
    nodeId: string;
    title: string;
}

let visited: Waiting | null = null;
let navigating = false;

function openProjectWaits(): ProjectWait[] {
    const current = useProject.getState().current;

    if (current === null) {
        return [];
    }

    const endpointId = currentEndpointId();
    const currentKey = endpointKey(endpointId, current.projectId);
    const tabs = useSettings.getState().projectNavigation === 'tabs' ? useWindowTabs.getState().tabs.keys : [currentKey];
    const nodes = projectNodes();
    const live = projectWaiting();
    const snoozes = useSnoozes.getState().byKey;
    const waits: ProjectWait[] = [];

    for (const key of [...new Set([...tabs, currentKey])]) {
        const project = splitKey(key);

        if (key === currentKey) {
            for (const entry of live) {
                waits.push({
                    id: JSON.stringify([endpointId, current.projectId, entry.id]),
                    endpointId,
                    projectId: current.projectId,
                    nodeId: entry.id,
                    since: entry.since,
                    title: nodes.find((node) => node.id === entry.id)?.title ?? chatNameOf(useDocument.getState().views, entry.id) ?? current.name
                });
            }

            continue;
        }

        const snapshot = sidebarMachineSnapshot(project.endpointId);
        const background = snapshot?.projects.find((row) => row.summary.projectId === project.id);

        if (snapshot?.state !== 'ready' || !background?.views || !background.summary.available || background.summary.closedAt != null) {
            continue;
        }

        for (const node of sidebarWaitingNodes(background.views, snapshot.statuses, project.endpointId, snoozes)) {
            waits.push({
                id: JSON.stringify([project.endpointId, project.id, node.id]),
                endpointId: project.endpointId,
                projectId: project.id,
                nodeId: node.id,
                since: snapshot.waitingSince[`${node.kind}:${node.id}`] ?? Infinity,
                title: `${background.summary.name} / ${node.title}`
            });
        }
    }

    return waits.sort((before, next) => (before.since === next.since ? 0 : before.since < next.since ? -1 : 1));
}

/* The oldest wait across this window's observed tabs; a second press advances, while an in-flight switch consumes no new visit. */
export function revealNextWaiting(): boolean {
    if (navigating) {
        return true;
    }

    const target = nextWaiting(openProjectWaits(), visited);

    if (target === null) {
        return false;
    }

    const current = useProject.getState();

    if (current.currentEndpointId === target.endpointId && current.current?.projectId === target.projectId) {
        visited = target;
        revealNode(target.nodeId);
        bringPromptToFront(target.nodeId);

        return true;
    }

    navigating = true;

    void showSidebarProject(target.endpointId, target.projectId)
        .then((shown) => {
            if (!shown) {
                return;
            }

            visited = target;

            if (projectWaiting().some((entry) => entry.id === target.nodeId)) {
                revealNode(target.nodeId);
                bringPromptToFront(target.nodeId);
            }
        })
        .finally(() => {
            navigating = false;
        });

    return true;
}

/* The next destination for the palette; background entries include their project name. */
export function nextWaitingTitle(): string | null {
    return nextWaiting(openProjectWaits(), visited)?.title ?? null;
}
