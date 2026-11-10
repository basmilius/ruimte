import { ArtifactView } from '@/output/ArtifactView';
import type { ArtifactTab } from '@/state/files';

export function ArtifactTabBody({ tab }: { tab: ArtifactTab }) {
    return <ArtifactView artifactId={tab.artifactId} {...(tab.machineId === undefined ? {} : { machineId: tab.machineId })} />;
}
