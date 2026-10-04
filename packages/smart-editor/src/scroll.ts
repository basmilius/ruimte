/*
 * Where the view scrolls to when a target has to be seen. The rules are the platform's scrolling model
 * with its defaults: a line of margin above and below the target, three characters at its sides, and a
 * target out of reach lands a third of the way down the view.
 */

/*
 * `relative` keeps a caret in view with a margin, the way typing and moving do. `makeVisible` leaves
 * what is in view alone and centers what is not. `center` always puts the target a third from the top,
 * and `centerDown` and `centerUp` do so only when it is out of view or on the wrong side of that mark,
 * so stepping through results in one direction keeps them where the eye expects them.
 */
export type ScrollKind = 'relative' | 'makeVisible' | 'center' | 'centerDown' | 'centerUp';

export interface ScrollRequest {
    /* The top left of the target in the content, as the caret is. */
    readonly target: { readonly x: number; readonly y: number };
    /* What is in view now: the text area, without the gutter. */
    readonly view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    /* How much there is to scroll over. */
    readonly content: { readonly width: number; readonly height: number };
    readonly lineHeight: number;
    readonly charWidth: number;
    /* Where the line above the target's starts, and where the line below it ends; the margin that has to stay in view. */
    readonly topBound: number;
    readonly bottomBound: number;
    /* A jump to a target already in view is handled as `relative`, which leaves it where it is. */
    readonly refrain: boolean;
    /* A wrapped view has nothing to scroll sideways. */
    readonly horizontal: boolean;
    /* How much of the top of the view something else covers, such as pinned headers; `view` is what is left below it. */
    readonly inset?: number;
}

/* The characters kept in view to the left and right of the target. */
const SIDE_MARGIN = 3;

function clamp(value: number, maximum: number): number {
    return Math.min(Math.max(0, value), Math.max(0, maximum));
}

/* The one third mark when the margins fit above it, the middle of the view when they do not. */
function centerOf(request: ScrollRequest): number {
    const { target, view, lineHeight, topBound } = request;
    const third = target.y - Math.trunc(view.height / 3);
    return third < topBound ? third : target.y - Math.trunc(Math.max(0, view.height - lineHeight) / 2);
}

function verticalPosition(request: ScrollRequest, kind: ScrollKind): number {
    const { target, view, content, topBound, bottomBound } = request;
    const height = view.height;
    const center = centerOf(request);
    const above = view.y > topBound;
    const below = view.y + height < bottomBound;
    let position = view.y;
    if (kind === 'center') {
        position = center;
    } else if (kind === 'centerUp') {
        position = above || below || view.y > center ? center : position;
    } else if (kind === 'centerDown') {
        position = above || below || view.y < center ? center : position;
    } else if (kind === 'makeVisible') {
        position = above || below ? center : position;
    } else if (bottomBound - topBound > height) {
        position = center;
    } else if (below) {
        const lowest = target.y + height > content.height ? content.height : target.y + height - (target.y - topBound);
        position = Math.max(bottomBound - height, Math.min(lowest, view.y + height) - height);
    } else if (above) {
        const highest = target.y - height < 0 ? 0 : bottomBound - height;
        position = Math.min(topBound, Math.max(highest, view.y));
    }
    const inset = request.inset ?? 0;
    return Math.min(Math.max(inset, position), Math.max(inset, content.height - height));
}

function horizontalPosition(request: ScrollRequest, kind: ScrollKind): number {
    const { target, view, content, charWidth } = request;
    const width = view.width;
    const left = target.x - SIDE_MARGIN * charWidth;
    const right = target.x + SIDE_MARGIN * charWidth;
    let position = view.x;
    if (right - left > width) {
        position = target.x - Math.trunc(width / 2);
    } else if (left < view.x) {
        position = kind === 'makeVisible' && right < width ? 0 : left;
    } else if (right > view.x + width) {
        position = right - width;
    }
    return clamp(position, content.width - width);
}

/* The scroll position that shows the target the way `kind` asks. */
export function scrollPosition(request: ScrollRequest, kind: ScrollKind): { x: number; y: number } {
    const { target, view } = request;
    const inView = target.x >= view.x && target.x < view.x + view.width && target.y >= view.y && target.y < view.y + view.height;
    const effective: ScrollKind = request.refrain && inView && (kind === 'center' || kind === 'centerDown' || kind === 'centerUp') ? 'relative' : kind;
    return {
        x: request.horizontal ? horizontalPosition(request, effective) : view.x,
        y: verticalPosition(request, effective) - (request.inset ?? 0)
    };
}
