import { useEffect } from 'react';
import { useProject } from '@/state/project';
import { openFileLink } from '@/surface/panels/file-links';
import type { Transport } from '@/transport-api/transport';
import { watchServerPrompts } from './server-prompts';

/* Answers what the language servers of the open project ask, also while no editor is open. Mounted once by the workspace. */
export function useServerPrompts(transport: Transport): void {
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const folder = useProject((state) => state.current?.folder ?? null);

    useEffect(() => {
        if (projectId === null || folder === null) {
            return;
        }

        return watchServerPrompts(transport, projectId, folder, (root, path, line) => void openFileLink(root, { path, line, directory: false }));
    }, [transport, projectId, folder]);
}
