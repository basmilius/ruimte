import { moveViewAction } from '@/actions/client-actions';
import type { CellAt, SplitZone } from '@/layout/split';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useDocument } from '@/state/document';
import { artifactTabKey, openArtifactTab, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';

/*
 * An artifact of this machine's Output dragged out of the panel. It travels as a view drag of the key
 * its loose tab has, so the grid draws where it would land, and carries what the tab or a view of the
 * project needs. Another machine's artifact is never dragged: it cannot become a view here.
 */
const ARTIFACT_DRAG_TYPE = 'application/x-ruimte-artifact';

interface DraggedArtifact {
    artifactId: string;
    title: string;
}

export function startArtifactDrag(transfer: Pick<DataTransfer, 'setData' | 'effectAllowed'>, artifact: DraggedArtifact): void {
    const key = artifactTabKey(artifact.artifactId);
    transfer.setData(VIEW_DRAG_TYPE, key);
    transfer.setData(ARTIFACT_DRAG_TYPE, JSON.stringify({ artifactId: artifact.artifactId, title: artifact.title }));
    transfer.effectAllowed = 'move';
    setDragging(key);
}

/* `getData` is empty during dragover, so the types decide. */
export function carriesArtifact(transfer: Pick<DataTransfer, 'types'>): boolean {
    return transfer.types.includes(ARTIFACT_DRAG_TYPE);
}

/* Null for a drag without an artifact, or with one another window wrote in a shape this one cannot read. */
export function droppedArtifact(transfer: Pick<DataTransfer, 'types' | 'getData'>): DraggedArtifact | null {
    if (!carriesArtifact(transfer)) {
        return null;
    }
    try {
        const raw = JSON.parse(transfer.getData(ARTIFACT_DRAG_TYPE)) as { artifactId?: unknown; title?: unknown };
        return typeof raw.artifactId === 'string' && raw.artifactId !== '' && typeof raw.title === 'string'
            ? { artifactId: raw.artifactId, title: raw.title }
            : null;
    } catch {
        return null;
    }
}

/* Opens the artifact as a loose tab in the cell it was dropped on, or beside it, the way a dropped file opens. */
export function dropArtifactTab(artifact: DraggedArtifact, at: CellAt, zone: SplitZone, index: number | null = null): boolean {
    const files = useFiles.getState();
    return files.dropTab(openArtifactTab(files, artifact.artifactId, artifact.title), useSettings.getState().filesTabLimit, at, zone, index);
}

/* The artifact as a view of the project, under `after` (null for the top, absent for last), without opening it. */
export async function addArtifactToSidebar(artifact: DraggedArtifact, after?: string | null): Promise<string> {
    const id = useDocument.getState().addArtifactView(artifact.title || artifact.artifactId, { id: artifact.artifactId }, false);
    if (after !== undefined) {
        await moveViewAction(id, after);
    }
    return id;
}
