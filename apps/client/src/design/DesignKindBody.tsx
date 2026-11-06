import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { NodeBodyProps } from '@/registry/node-kinds';

const DesignNodeBody = lazyNamed(() => import('@/design/DesignNode'), 'DesignNodeBody');

export function DesignBody({ id, focused }: NodeBodyProps) {
    return (
        <LazyBoundary>
            <DesignNodeBody id={id} focused={focused} />
        </LazyBoundary>
    );
}
