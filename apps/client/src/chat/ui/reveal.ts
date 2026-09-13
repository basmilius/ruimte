import { useEffect, useState } from 'react';

/* Each frame closes this part of the gap, so a single delta lands in about 100 ms and a large chunk
   eases in instead of arriving in one jump. */
const REVEAL_DIVISOR = 6;
const REVEAL_MIN_STEP = 2;

/* How much of `text` is on screen one frame after `shown` characters were. */
export const nextRevealLength = (text: string, shown: number): number => {
    if (shown >= text.length) {
        return text.length;
    }
    const lag = text.length - shown;
    let next = Math.min(text.length, shown + Math.max(REVEAL_MIN_STEP, Math.ceil(lag / REVEAL_DIVISOR)));
    // Half of a surrogate pair renders as a replacement box for one frame.
    const last = text.charCodeAt(next - 1);
    if (next < text.length && last >= 0xd800 && last <= 0xdbff) {
        next += 1;
    }
    return next;
};

/*
 * The part of a streaming text that is on screen, catching up with what arrived once per animation
 * frame. It starts at whatever was there on mount, so reopening a thread mid-reply does not replay
 * it, and once `streaming` is false everything is shown at once.
 */
export const useRevealedText = (text: string, streaming: boolean): string => {
    const [shown, setShown] = useState(text.length);
    const target = text.length;

    useEffect(() => {
        if (!streaming || shown >= target) {
            return;
        }
        const frame = requestAnimationFrame(() => setShown((current) => nextRevealLength(text, current)));
        return () => cancelAnimationFrame(frame);
    }, [text, streaming, shown, target]);

    if (!streaming) {
        return text;
    }
    return text.slice(0, Math.min(shown, target));
};
