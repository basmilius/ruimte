import type { RemoteLink } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useProject } from '@/state/project';
import { machineAnswers } from '@/transport/features';
import { useWorkspace } from '@/workspace/connections';

const NO_LINKS: readonly RemoteLink[] = [];

export function useLinkedMachines(): readonly RemoteLink[] {
    const workspace = useWorkspace();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [held, setHeld] = useState<{ key: string; links: readonly RemoteLink[] } | null>(null);
    const key = `${workspace?.connection.endpointId ?? ''}\n${projectId ?? ''}`;
    useEffect(() => {
        if (workspace === null || projectId === null || !machineAnswers(workspace.connection.transport.connection, 'remote.list')) {
            return;
        }
        let current = true;
        workspace.connection.transport.request('remote.list', { projectId }).then(
            (answer) => current && setHeld({ key, links: answer.links }),
            () => undefined
        );
        return () => {
            current = false;
        };
    }, [workspace, projectId, key]);
    return held !== null && held.key === key ? held.links : NO_LINKS;
}
