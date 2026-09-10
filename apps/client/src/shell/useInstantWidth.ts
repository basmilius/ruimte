import { useEffect, useState } from 'react';
import { useProject } from '@/state/project';

/*
 * Whether a column has to land at its width instead of sliding to it. A panel opens because someone
 * asked for it, or because a project brought it along: opening a project applies a stored panel
 * state, and that has to be on screen at its final width from the first paint. True while such a
 * state is being applied and until the frame after it, false again once a person is in charge.
 */
export function useInstantWidth(): boolean {
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const switching = useProject((s) => s.switching);
    const [instant, setInstant] = useState(true);
    const [applied, setApplied] = useState(projectId);
    const applying = switching || applied !== projectId;

    /* Adjusted during the render, so the flag reaches the DOM in the same commit as the width the
       project brings; a frame in between is the animation this exists to keep off the screen. */
    if (applied !== projectId) {
        setApplied(projectId);
    }
    if (applying && !instant) {
        setInstant(true);
    }

    useEffect(() => {
        if (!instant || applying) {
            return;
        }
        /* Two frames: the first paints the applied width with the transition off, the second turns
           it back on, once a value change can no longer land in that same style recalculation. */
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setInstant(false));
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
    }, [applying, instant]);

    return instant;
}
