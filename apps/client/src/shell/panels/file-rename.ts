import { absoluteOf, basenameOf, dirnameOf } from '@/shell/panels/files-tree';

/* A file or folder on its way to another place, by absolute path. */
export interface PlannedMove {
    readonly from: string;
    readonly to: string;
}

/* A row of the tree as a path of the machine, without the slash that marks a folder. */
function absoluteOfRow(folder: string, treePath: string): string {
    return absoluteOf(folder, treePath).replace(/\/+$/, '');
}

/*
 * The moves a drop asks for: the rows that were dragged, each into the folder it was dropped on, or into the
 * project folder when `target` is null. A row dropped where it already is, a folder dropped into itself and a row
 * that a dragged folder carries along anyway are left out.
 */
export function dropMovesOf(folder: string, dragged: readonly string[], target: string | null): PlannedMove[] {
    const destination = absoluteOfRow(folder, target ?? '');
    const sources = [...new Set(dragged.map((treePath) => absoluteOfRow(folder, treePath)))];
    const outermost = sources.filter((path) => !sources.some((other) => path.startsWith(`${other}/`)));
    return outermost
        .filter((path) => dirnameOf(path) !== destination && destination !== path && !destination.startsWith(`${path}/`))
        .map((path) => ({ from: path, to: `${destination}/${basenameOf(path)}` }));
}
