import type { Reachability } from '@ruimte/contracts';
import type { Point } from '@/canvas/math';
import { carriesMentions, droppedMentions } from '@adecore/agents-react/chat/mentions';

/*
 * What a drag inside the app carries for the canvas: the same list the mention type holds, with the
 * trailing slash a directory has still on it. The mention type strips that slash, because a chat
 * mentions a folder as readily as a file, and the canvas is the side that has to tell them apart.
 */
export const PATHS_DRAG_TYPE = 'application/x-ruimte-paths';

/* The part of `DataTransfer` the canvas reads, so the rules below are testable without one. */
export interface DragPayload {
    types: readonly string[];
    getData(type: string): string;
}

/*
 * Whether this drag is one the canvas takes. It reads the types alone, because `dragover` is where
 * the cursor has to be decided and the browser withholds the values until the drop. A file out of
 * Finder carries bytes and no path, so it is not one of these.
 */
export function carriesPaths(types: readonly string[]): boolean {
    return types.includes(PATHS_DRAG_TYPE) || carriesMentions(types);
}

/* Both types spell a list the same way: space separated, which is what the `@` picker settled on
   and what the composer reads. A path with a space in it is beyond either of them. */
function splitPaths(value: string): string[] {
    return value.split(/\s+/).filter((path) => path !== '');
}

/*
 * The files a drop is about, in the order the source wrote them. A directory is left out, since a
 * folder on a canvas would be a file manager. The mention type alone has no slashes left to judge,
 * so it is taken whole.
 */
export function droppedPaths(data: DragPayload): string[] {
    const marked = data.getData(PATHS_DRAG_TYPE);
    if (marked !== '') {
        return splitPaths(marked).filter((path) => !path.endsWith('/') && !path.endsWith('\\'));
    }
    return droppedMentions(data);
}

/*
 * A drag out of the file manager, which carries bytes and a name. Whether there is a path behind
 * them is a second question (`finderRefusal`), but the target has to say yes at `dragover` already,
 * and refusing it there would leave a person dragging at a canvas that never answers.
 */
export function carriesFiles(types: readonly string[]): boolean {
    return types.includes('Files');
}

/* Why a file out of the file manager cannot become a node. */
export type FinderRefusal = 'no-bridge' | 'other-machine';

/*
 * A `File` out of an OS drag has no path in a browser; only the desktop shell can name it. That path
 * is on this machine, so a project on a daemon elsewhere cannot read it either. Null means it can.
 */
export function finderRefusal(canNamePaths: boolean, reachability: Reachability | null): FinderRefusal | null {
    if (!canNamePaths) {
        return 'no-bridge';
    }
    return reachability === 'loopback' ? null : 'other-machine';
}

/*
 * The cursor a drag gets over a target that takes it. An effect the source did not allow is refused
 * by the browser, which then never delivers the drop at all: the files tree allows a move and
 * nothing else (its own rows reorder by moving), so "copy" gives way rather than break the drop.
 */
export function dropEffectFor(effectAllowed: DataTransfer['effectAllowed']): 'copy' | 'move' {
    return effectAllowed === 'move' || effectAllowed === 'linkMove' ? 'move' : 'copy';
}

/* Dropped files stand side by side a step apart, the first on the drop point. The points are middles, which is what `addNode` takes. */
export function dropPoints(at: Point, count: number, step: number): Point[] {
    return Array.from({ length: Math.max(0, count) }, (_unused, index) => ({ x: at.x + index * step, y: at.y }));
}

/*
 * Whether the document takes a drag nobody under the pointer claimed. Left alone, a link or a file
 * dropped there navigates the window away from the app. A text field keeps the text dropped on it,
 * but a file dropped on one would still navigate.
 */
export function catchesStrayDrag(claimed: boolean, overTextField: boolean, types: readonly string[]): boolean {
    return !claimed && !(overTextField && !carriesFiles(types));
}

function isTextField(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea') !== null);
}

/* On the document, so every node's own handler has had the drag first and claimed it if it wanted it. */
export function refuseStrayDrops(root: Document): void {
    const refuse = (event: DragEvent): void => {
        if (!catchesStrayDrag(event.defaultPrevented, isTextField(event.target), [...(event.dataTransfer?.types ?? [])])) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'none';
        }
    };
    root.addEventListener('dragover', refuse);
    root.addEventListener('drop', refuse);
}
