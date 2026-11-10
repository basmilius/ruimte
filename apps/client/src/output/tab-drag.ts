import { carriesArtifact, dropArtifactTab, droppedArtifact } from '@/output/artifact-drag';
import type { TabDragKind } from '@/surface/tab-drags';
import { dragging } from '@/surface/view-drag';

export const ARTIFACT_TAB_DRAG: TabDragKind = {
    id: 'artifact',
    carries: carriesArtifact,
    drop(transfer, at, zone, indexFor) {
        const artifact = droppedArtifact(transfer);
        if (artifact === null) {
            return false;
        }
        dropArtifactTab(artifact, at, zone, indexFor(dragging() ?? ''));
        return true;
    }
};
