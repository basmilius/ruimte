import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { ProjectView } from '@ruimte/contracts';

const DiagramView = lazyNamed(() => import('@/diagram/DiagramView'), 'DiagramView');

export function DiagramViewKindBody({ view }: { view: ProjectView }) {
    return (
        <LazyBoundary>
            <DiagramView id={view.id} />
        </LazyBoundary>
    );
}
