import { ignoreRefusal, perform } from '@/action-port/perform';
import { openInNewWindow, wantsNewWindow } from '@/project/windows';

/* The switch screen says how an open goes, so a refusal here stays quiet like every other person's action. */
export function openProjectAction(endpointId: string, projectId: string): void {
    void perform('project.switch', { endpointId, projectId }).catch(ignoreRefusal);
}

/* A click on a project row. Cmd-click (Ctrl-click off macOS) opens it in a window of its own. */
export function openProjectClickAction(event: { metaKey: boolean; ctrlKey: boolean }, endpointId: string, projectId: string): void {
    if (wantsNewWindow(event)) {
        openInNewWindow(endpointId, projectId);
        return;
    }
    openProjectAction(endpointId, projectId);
}

export function openFolderAction(endpointId: string, folder: string, createFolder: boolean): void {
    void perform('project.create', { endpointId, folder, createFolder }).catch(ignoreRefusal);
}
