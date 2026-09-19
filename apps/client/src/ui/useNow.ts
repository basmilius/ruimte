import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/*
 * The clock a surface reads to say how long something has been running. One timer for the whole
 * surface, ticking only while there is something to count, and starting at the time it was mounted
 * so a panel that comes back mid-session does not read zero for a second first.
 */
export const useNow = (intervalMs: number, ticking = true): number => {
    const [now, setNow] = useState(Date.now);

    useEffect(() => {
        if (!ticking) {
            return;
        }
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(timer);
    }, [intervalMs, ticking]);

    return now;
};

/*
 * A timer on one line of a long thread. The text is written straight into the node, because a chat
 * that re-renders every second while an agent works re-renders every row it is drawing with it.
 */
export const useTickingText = (render: () => string, intervalMs = 1000): RefObject<HTMLSpanElement | null> => {
    const ref = useRef<HTMLSpanElement>(null);
    const latest = useRef(render);

    const tick = useCallback((): void => {
        if (ref.current !== null) {
            ref.current.textContent = latest.current();
        }
    }, []);

    useEffect(() => {
        const timer = window.setInterval(tick, intervalMs);
        return () => window.clearInterval(timer);
    }, [intervalMs, tick]);

    /* After every render as well, so the first one writes the line and a language or region change
       lands on it without waiting for the next tick. */
    useEffect(() => {
        latest.current = render;
        tick();
    });

    return ref;
};
