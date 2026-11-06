import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { ProjectDatabaseView } from '@ruimte/contracts';

const DatabaseViewBody = lazyNamed(() => import('@/database/DatabaseViewBody'), 'DatabaseViewBody');

export function DatabaseViewKindBody({ view }: { view: ProjectDatabaseView }) {
    return (
        <LazyBoundary>
            <DatabaseViewBody view={view} />
        </LazyBoundary>
    );
}
