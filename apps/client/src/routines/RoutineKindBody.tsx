import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { NodeBodyProps } from '@/registry/node-kinds';

const RoutineNodeBody = lazyNamed(() => import('@/routines/RoutineNode'), 'RoutineNodeBody');

export function RoutineBody({ id }: NodeBodyProps) {
    return (
        <LazyBoundary>
            <RoutineNodeBody id={id} />
        </LazyBoundary>
    );
}
