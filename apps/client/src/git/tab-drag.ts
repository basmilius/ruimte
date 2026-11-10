import { carriesDiff, droppedDiff } from '@/git/diff-drag';
import { useFiles, tabKey } from '@/state/files';
import { useSettings } from '@/state/settings';
import type { TabDragKind } from '@/surface/tab-drags';

export const DIFF_TAB_DRAG: TabDragKind = {
    id: 'diff',
    carries: carriesDiff,
    drop(transfer, at, zone, indexFor) {
        const diff = droppedDiff(transfer);
        if (diff === null) {
            return false;
        }
        useFiles.getState().dropDiff(diff.path, diff.view, useSettings.getState().filesTabLimit, at, zone, indexFor(tabKey(diff.path, diff.view)));
        return true;
    }
};
