import type { ProjectLocal, SplitCell } from '@ruimte/contracts';
import { cellViewIds } from '@/shell/split';

/* The id the files cell had in a layout written before every cell could be a tab host. */
export const LEGACY_FILES_ID = 'files';

/* The loose views a project had open, in strip order, and the one that was in front. */
export interface LooseStrip {
    keys: readonly string[];
    active: string | null;
}

export const NO_LOOSE: LooseStrip = { keys: [], active: null };

function hostOf(strip: LooseStrip, size: number): SplitCell {
    return { viewId: strip.active ?? strip.keys[0]!, tabs: [...strip.keys], size };
}

/*
 * What a local file with a files cell means now: the cell becomes a tab host whose tabs are the
 * strip, so every file a person had open stays open in the same order. An empty strip leaves the
 * file alone, and the unknown id drops out of the layout with the next clean.
 */
export function migrateFilesCell<T extends Pick<ProjectLocal, 'activeViewId' | 'layout'>>(local: T, strip: LooseStrip): T {
    if (strip.keys.length === 0) {
        return local;
    }
    if (local.layout) {
        let found = false;
        const columns = local.layout.columns.map((column) => ({
            ...column,
            cells: column.cells.map((cell) => {
                if (!cellViewIds(cell).includes(LEGACY_FILES_ID)) {
                    return cell;
                }
                found = true;
                return hostOf(strip, cell.size);
            })
        }));
        return found ? { ...local, layout: { ...local.layout, columns } } : local;
    }
    if (local.activeViewId === LEGACY_FILES_ID) {
        return { ...local, layout: { columns: [{ size: 1, cells: [hostOf(strip, 1)] }], focus: { column: 0, cell: 0 } } };
    }
    return local;
}
