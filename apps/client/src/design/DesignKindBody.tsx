import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { ProjectDesignView } from '@ruimte/contracts';
import type { NodeBodyProps } from '@/registry/node-kinds';

const DesignNodeBody = lazyNamed(() => import('@/design/DesignNode'), 'DesignNodeBody');

export function DesignBody({ id, focused }: NodeBodyProps) {
    return (
        <LazyBoundary>
            <DesignNodeBody id={id} focused={focused} />
        </LazyBoundary>
    );
}

const AgentDesign = lazyNamed(() => import('@/design/AgentDesignBody'), 'AgentDesignBody');

/* The design of a hidden design agent in its parent chat's place (`provideAgentDesignBody`). */
export function AgentDesignKindBody({ chatId, focused }: { chatId: string; focused: boolean }) {
    return (
        <LazyBoundary>
            <AgentDesign chatId={chatId} focused={focused} />
        </LazyBoundary>
    );
}

const DesignView = lazyNamed(() => import('@/design/DesignView'), 'DesignView');

export function DesignViewKindBody({ view, focused }: { view: ProjectDesignView; focused: boolean }) {
    return (
        <LazyBoundary>
            <DesignView view={view} focused={focused} />
        </LazyBoundary>
    );
}
