import type { EditorRect } from '@adecore/editor';

export interface PopupSize {
    readonly width: number;
    readonly height: number;
}

export interface PopupPlacement {
    readonly left: number;
    readonly top: number;
    /* What is left of the window on the chosen side, for a popup that scrolls inside it. */
    readonly maxHeight: number;
    readonly side: 'above' | 'below';
}

export interface PlaceOptions {
    /* The space between the popup and the character it belongs to. */
    gap?: number;
    /* The space kept to the window's edge. */
    margin?: number;
    prefer?: 'above' | 'below';
}

/*
 * Where a popup goes next to a character: under it when it fits there, over it when it does not and
 * there is room, and otherwise on the side with more room, shortened to fit. Aligned with the
 * character's left edge, and pushed back in when that would leave the window. The anchor and the window
 * are the page's own pixels, so a canvas's scale never enters.
 */
export function placePopup(anchor: EditorRect, size: PopupSize, window: PopupSize, options: PlaceOptions = {}): PopupPlacement {
    const gap = options.gap ?? 4;
    const margin = options.margin ?? 8;
    const roomBelow = window.height - margin - (anchor.bottom + gap);
    const roomAbove = anchor.top - gap - margin;
    const fitsBelow = size.height <= roomBelow;
    const fitsAbove = size.height <= roomAbove;
    const below = options.prefer === 'above' ? !fitsAbove && (fitsBelow || roomBelow >= roomAbove) : fitsBelow || (!fitsAbove && roomBelow >= roomAbove);
    const maxHeight = Math.max(0, below ? roomBelow : roomAbove);
    const height = Math.min(size.height, maxHeight);
    const left = Math.max(margin, Math.min(anchor.left, window.width - size.width - margin));
    return { left, top: below ? anchor.bottom + gap : anchor.top - gap - height, maxHeight, side: below ? 'below' : 'above' };
}

/*
 * A second box beside a first, such as the documentation of the highlighted suggestion: to the right
 * of it when it fits, to the left when only that fits, and under it, at its left edge, when neither does.
 */
export function placeBeside(
    first: { left: number; top: number; width: number; height: number },
    size: PopupSize,
    window: PopupSize,
    margin = 8,
    gap = 4
): PopupPlacement {
    const fitsRight = first.left + first.width + gap + size.width <= window.width - margin;
    const fitsLeft = first.left - gap - size.width >= margin;
    if (fitsRight || fitsLeft) {
        const top = Math.max(margin, Math.min(first.top, window.height - size.height - margin));
        return { left: fitsRight ? first.left + first.width + gap : first.left - gap - size.width, top, maxHeight: window.height - margin * 2, side: 'below' };
    }
    const top = first.top + first.height + gap;
    const maxHeight = Math.max(0, window.height - margin - top);
    return { left: Math.max(margin, Math.min(first.left, window.width - size.width - margin)), top, maxHeight, side: 'below' };
}
