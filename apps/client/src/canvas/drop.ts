import type { Reachability } from '@ruimte/contracts';
import type { Point } from '@/canvas/math';
import { MENTION_DRAG_TYPE } from '@/chat/mentions';

/*
 * What a drag inside the app carries for the canvas: the same list the mention type holds, with the
 * trailing slash a directory has still on it. The mention type strips that slash, because a chat
 * mentions a folder as readily as a file, and the canvas is the side that has to tell them apart.
 */
export const PATHS_DRAG_TYPE = 'application/x-ruimte-paths';

/*
 * What the canvas reads off a drag. The two fields are all of `DataTransfer` that matters here, so
 * the rules below are testable without one and the handler stays a few lines of wiring.
 */
export interface DragPayload {
    types: readonly string[];
    getData(type: string): string;
}

/*
 * Whether this drag is one the canvas takes. It reads the types alone, because `dragover` is where
 * the cursor has to be decided and the browser withholds the values until the drop. A file out of
 * Finder carries bytes and no path, so it is not one of these.
 */
export const carriesPaths = (types: readonly string[]): boolean => types.includes(PATHS_DRAG_TYPE) || types.includes(MENTION_DRAG_TYPE);

/* Both types spell a list the same way: space separated, which is what the `@` picker settled on
   and what the composer reads. A path with a space in it is beyond either of them. */
const splitPaths = (value: string): string[] => value.split(/\s+/).filter((path) => path !== '');

/*
 * The files a drop is about, in the order the source wrote them. A directory is left out rather
 * than made into a node that cannot be read: a folder on a canvas would be a file manager, which
 * this is not. A drag carrying the mention type alone has no slashes left to judge, so it is taken
 * whole.
 */
export const droppedPaths = (data: DragPayload): string[] => {
    const marked = data.getData(PATHS_DRAG_TYPE);
    if (marked !== '') {
        return splitPaths(marked).filter((path) => !path.endsWith('/') && !path.endsWith('\\'));
    }
    return splitPaths(data.getData(MENTION_DRAG_TYPE));
};

/*
 * A drag out of the file manager, which carries bytes and a name. Whether there is a path behind
 * them is a second question (`finderRefusal`), but the target has to say yes at `dragover` already,
 * and refusing it there would leave a person dragging at a canvas that never answers.
 */
export const carriesFiles = (types: readonly string[]): boolean => types.includes('Files');

/* Why a file out of the file manager cannot become a node. Null means it can. */
export type FinderRefusal = 'no-bridge' | 'other-machine';

/*
 * A `File` out of an OS drag has no path in a browser, which is a boundary with no way around it:
 * only the desktop shell can name the file it came from. And a path it names is a path on this
 * machine, so a project running on a daemon elsewhere cannot read it either. Copying the bytes over
 * is a feature about uploading rather than about the canvas, so both cases say so and stop.
 */
export const finderRefusal = (canNamePaths: boolean, reachability: Reachability | null): FinderRefusal | null => {
    if (!canNamePaths) {
        return 'no-bridge';
    }
    return reachability === 'loopback' ? null : 'other-machine';
};

/*
 * The cursor a drag gets over a target that takes it. An effect the source did not allow is refused
 * by the browser, which then never delivers the drop at all: the files tree allows a move and
 * nothing else (its own rows reorder by moving), so "copy" gives way rather than break the drop.
 */
export const dropEffectFor = (effectAllowed: DataTransfer['effectAllowed']): 'copy' | 'move' =>
    effectAllowed === 'move' || effectAllowed === 'linkMove' ? 'move' : 'copy';

/*
 * Where a run of dropped files goes: the first on the point it was let go of, the rest to its right
 * a step apart, so three files at once are three nodes side by side instead of one stack nobody can
 * see into. The points are middles, which is what `addNode` takes.
 */
export const dropPoints = (at: Point, count: number, step: number): Point[] =>
    Array.from({ length: Math.max(0, count) }, (_unused, index) => ({ x: at.x + index * step, y: at.y }));
