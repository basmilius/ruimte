import type { ProjectView } from '@ruimte/contracts';
import { ExtensionViewBody } from '@/extensions/ExtensionNodeBody';

export function ExtensionViewKindBody({ view }: { view: Extract<ProjectView, { kind: 'unknown' }> }) {
    return <ExtensionViewBody raw={view.raw} />;
}
