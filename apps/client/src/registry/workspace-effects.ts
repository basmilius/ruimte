import { createRegistry } from './create-registry';

interface WorkspaceEffect {
    readonly id: string;
    readonly mounted?: () => void | (() => void);
    readonly folderChanged?: (folder: string | null) => void;
}

export const workspaceEffects = createRegistry<WorkspaceEffect>('workspace effect');
