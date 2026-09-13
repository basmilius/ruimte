import { useEffect, useRef, useState } from 'react';

/* How long a word takes to fade in. `.chat-fade` in styles.css carries the same number. */
export const REVEAL_FADE_MS = 300;

/* The time constant of the catch-up: after this long about two thirds of what was behind is on screen. */
export const REVEAL_TAU_MS = 250;

// Without a floor the last few characters of a gap crawl, since the exponential step shrinks with the gap.
export const REVEAL_MIN_CPS = 40;

// Once the item is done nothing more arrives to wait for, so the tail is closed faster.
export const REVEAL_FINISH_MIN_CPS = 120;

// A tab that comes back hands one frame the whole time it was away; it would show everything at once.
export const REVEAL_MAX_FRAME_MS = 100;

// A word this long (a URL, a line of CJK) would otherwise hold everything behind it until it ends.
export const REVEAL_MAX_HELD_WORD = 32;

// The span mounts a commit after the frame that grew the text, so its fade ends a little later than that frame plus the duration.
const FADE_SETTLE_MS = REVEAL_FADE_MS + 50;

const isSpace = (text: string, index: number): boolean => index >= 0 && index < text.length && /\s/.test(text[index]);

/*
 * Where the reveal stands `elapsedMs` after it stood at `position`, with `target` characters
 * received. The exponential part composes over frames, so the pace does not depend on the refresh
 * rate of the screen.
 */
export const advanceReveal = (position: number, target: number, elapsedMs: number, finished: boolean): number => {
    if (position >= target) {
        return target;
    }
    const elapsed = Math.min(Math.max(elapsedMs, 0), REVEAL_MAX_FRAME_MS);
    const eased = (target - position) * (1 - Math.exp(-elapsed / REVEAL_TAU_MS));
    const floor = ((finished ? REVEAL_FINISH_MIN_CPS : REVEAL_MIN_CPS) * elapsed) / 1000;
    return Math.min(target, position + Math.max(eased, floor));
};

/*
 * How much of `text` to draw for a reveal at `position`: back to the last word boundary, because a
 * span that starts with half a word shows the rest of its letters at whatever opacity it already
 * reached. The last word of a text that is still arriving may still grow, so it waits for the
 * whitespace after it.
 */
export const revealBoundary = (text: string, position: number, complete: boolean): number => {
    const end = Math.min(text.length, Math.max(0, Math.floor(position)));
    if (end === text.length && complete) {
        return end;
    }
    let cut = end;
    while (cut > 0 && !isSpace(text, cut) && !isSpace(text, cut - 1)) {
        cut -= 1;
    }
    if (end - cut <= REVEAL_MAX_HELD_WORD) {
        return cut;
    }
    // Half of a surrogate pair renders as a replacement box.
    const last = text.charCodeAt(end - 1);
    return last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
};

export interface RevealedText {
    text: string;
    /* True until the reveal caught up with a finished text and its last fade is over; spans are needed until then. */
    active: boolean;
}

/*
 * The part of a streaming text that is on screen, catching up with what arrived over time. It starts
 * at whatever was there on mount, so reopening a thread mid-reply does not replay it, and a text that
 * was already done on mount is shown whole at once.
 */
export const useRevealedText = (text: string, streaming: boolean): RevealedText => {
    const [active, setActive] = useState(streaming);
    const [shown, setShown] = useState(() => revealBoundary(text, text.length, !streaming));
    const latest = useRef({ text, streaming });
    const position = useRef(text.length);
    const shownRef = useRef(shown);
    const activeRef = useRef(active);

    useEffect(() => {
        latest.current = { text, streaming };
    });

    // Turning streaming on for a text that stood still (the setting flipped mid-reply) starts from what is there.
    useEffect(() => {
        if (!streaming || activeRef.current) {
            return;
        }
        position.current = latest.current.text.length;
        shownRef.current = revealBoundary(latest.current.text, position.current, false);
        activeRef.current = true;
        setShown(shownRef.current);
        setActive(true);
    }, [streaming]);

    useEffect(() => {
        if (!active) {
            return;
        }
        let frame = 0;
        let previous: number | null = null;
        let grewAt = -Infinity;
        const tick = (now: number) => {
            const elapsed = previous === null ? 0 : now - previous;
            previous = now;
            const current = latest.current;
            const finished = !current.streaming;
            position.current = advanceReveal(position.current, current.text.length, elapsed, finished);
            const length = revealBoundary(current.text, position.current, finished);
            if (length !== shownRef.current) {
                shownRef.current = length;
                grewAt = now;
                setShown(length);
            }
            if (finished && length >= current.text.length && now - grewAt >= FADE_SETTLE_MS) {
                activeRef.current = false;
                setActive(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [active]);

    if (!active) {
        return { text, active: false };
    }
    return { text: text.slice(0, Math.min(shown, text.length)), active: true };
};
