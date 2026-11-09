import { createRegistry } from './create-registry';

/* What a feature does while a workspace is on screen, so the frame starts none of it by name. */
interface WorkspaceEffect {
    readonly id: string;
    /* Once when the workspace shell mounts; the function it returns runs when the shell goes. */
    readonly mounted?: () => void | (() => void);
    /* On mount and whenever the folder the project shows changes. */
    readonly folderChanged?: (folder: string | null) => void;
}

export const workspaceEffects = createRegistry<WorkspaceEffect>('workspace effect');
