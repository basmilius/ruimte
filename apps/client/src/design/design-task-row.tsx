import type { HostTaskRow } from '@adecore/agents-react';
import { LazyBoundary, lazyNamed } from '@adecore/ui';
import type { ReactNode } from 'react';
import { useDesignAgentFolder } from '@/design/design-agent';
import { useProject } from '@/state/project';

// Most threads hold no design agent, so the card and the page frame come only once one does.
const DesignTaskCard = lazyNamed(() => import('@/design/DesignTaskCard'), 'DesignTaskCard');

/* The row of a task whose child is a hidden design agent, drawn as its card; null keeps the plain row for any other task. */
export function useDesignTaskRow(row: HostTaskRow): ReactNode {
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const agentId = row.item.childId;
    const folder = useDesignAgentFolder(row.scopeId, projectId, agentId);

    if (folder === null || agentId === undefined) {
        return null;
    }

    return (
        <LazyBoundary fallback={<div className="mb-1 aspect-video w-full rounded-xl border border-border bg-surface-raised bg-clip-padding" />}>
            <DesignTaskCard row={row} agentId={agentId} folder={folder} />
        </LazyBoundary>
    );
}
