import { createHolder } from '@adecore/editor-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { draftFiles } from '@/language/project-files';
import { acquireProjectLanguage, type ProjectLanguage } from '@/language/ruimte-project-language';
import { useProject } from '@/state/project';
import { useWindow, workspaceOf } from '@/transport/window';

/* The language side of the project this window shows, for as long as the tab is up. Null on the start screen, where no project runs a server. */
export function useWindowProjectLanguage(): ProjectLanguage | null {
    const workspace = useWindow((s) => workspaceOf(s.content));
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const [holder] = useState(() => createHolder<ProjectLanguage>());

    useEffect(() => {
        if (workspace === null || projectId === null || folder === null) {
            return;
        }
        const { transport, endpointId } = workspace.connection;
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        holder.set(held.language);
        return () => {
            holder.set(null);
            held.release();
        };
    }, [workspace, projectId, folder, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}
