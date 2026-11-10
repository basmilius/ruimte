import { defaultProjectStore } from '@/state/project';
import type { Transport } from '@/transport-api/transport';
import { useWindow, windowWorkspace } from '@/workspace/window';

interface WindowProject {
    endpointId: string;
    projectId: string;
    folder: string | null;
    transport: Transport;
}

/* The project the window has open; null on the start screen and in the Chats project, which has no databases. */
function windowProject(): WindowProject | null {
    const workspace = windowWorkspace();
    const project = defaultProjectStore.getState().current;
    if (workspace === null || project === null || project.scratch === true) {
        return null;
    }
    return {
        endpointId: workspace.connection.endpointId,
        projectId: project.projectId,
        folder: project.folder ?? null,
        transport: workspace.connection.transport
    };
}

/*
 * Attaches to the project on screen, and from the first call on follows the window to the next project, so
 * a surface that asks once never shows what belonged to the project before.
 */
export function windowProjectFollower(attach: (target: WindowProject | null) => void): () => void {
    let following = false;
    return () => {
        attach(windowProject());
        if (following) {
            return;
        }
        following = true;
        const follow = (): void => attach(windowProject());
        useWindow.subscribe(follow);
        defaultProjectStore.subscribe(follow);
    };
}
