import { lazyNamed, LazyBoundary } from '@adecore/ui';
import type { NodeBodyProps } from '@/registry/node-kinds';

// Draws what the artifact view draws, which a canvas without one never loads.
const ArtifactNodeBody = lazyNamed(() => import('@/output/ArtifactNode'), 'ArtifactNodeBody');

export function ArtifactBody({ id }: NodeBodyProps) {
    return (
        <LazyBoundary>
            <ArtifactNodeBody id={id} />
        </LazyBoundary>
    );
}
