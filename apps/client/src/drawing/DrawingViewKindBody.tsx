import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { ProjectView } from '@ruimte/contracts';

const DrawingView = lazyNamed(() => import('@/drawing/DrawingView'), 'DrawingView');

export function DrawingViewKindBody({ view }: { view: ProjectView }) {
    return (
        <LazyBoundary>
            <DrawingView id={view.id} />
        </LazyBoundary>
    );
}
