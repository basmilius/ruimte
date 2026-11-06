import { carriesDatabase, droppedDatabase } from '@/database/drag';
import { dropDatabaseTab } from '@/database/open';
import type { TabDragKind } from '@/surface/tab-drags';
import { dragging } from '@/surface/view-drag';

export const DATABASE_TAB_DRAG: TabDragKind = {
    id: 'database',
    carries: carriesDatabase,
    drop(transfer, at, zone, indexFor) {
        const database = droppedDatabase(transfer);
        if (database === null) {
            return false;
        }
        dropDatabaseTab(database, at, zone, indexFor(dragging() ?? ''));
        return true;
    }
};
