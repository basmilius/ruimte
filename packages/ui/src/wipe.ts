/* One press of an arrow moves the handle this share of the frame. */
export const WIPE_KEY_STEP = 0.02;

export const clampSplit = (split: number): number => Math.min(1, Math.max(0, split));

/* A frame without a width has no place to point at, so the split stays where it is. */
export const splitAt = (clientX: number, frame: { left: number; width: number }): number | null =>
    frame.width > 0 ? clampSplit((clientX - frame.left) / frame.width) : null;

/* Null for a key the handle does not answer, so it goes on to whatever is around it. */
export const splitForKey = (split: number, key: string): number | null => {
    switch (key) {
        case 'ArrowLeft':
            return clampSplit(split - WIPE_KEY_STEP);
        case 'ArrowRight':
            return clampSplit(split + WIPE_KEY_STEP);
        case 'Home':
            return 0;
        case 'End':
            return 1;
        default:
            return null;
    }
};
