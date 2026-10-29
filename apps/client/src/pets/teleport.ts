import { useEffect, useState } from 'react';
import { BEAM_MS } from '@/pets/beam';

export interface Teleport<T> {
    /* What to draw: what is there, or for the length of its way out, what was there last. */
    shown: T | null;
    /* Which way it is beamed while it comes or goes (`PetFigure`'s `beam`); none while it simply stands there. */
    beam: 'in' | 'out' | undefined;
}

/*
 * A pet that comes is beamed in, and one that goes is drawn a moment longer, beamed out as it was last
 * seen. A pet that comes into view again on a pan mounts no new figure and is never beamed: only a
 * change of what is there is. With reduced motion it is there or gone at once.
 */
export function useTeleport<T>(value: T | null, same: (one: T, other: T) => boolean, still: boolean): Teleport<T> {
    const [kept, setKept] = useState<T | null>(value);
    const [arriving, setArriving] = useState(value !== null);

    // Kept up to date while it is there, compared by what it shows, so a new object with the same picture renders nothing more.
    if (value !== null && (kept === null || !same(kept, value))) {
        if (kept === null) {
            setArriving(true);
        }

        setKept(value);
    }

    const leaving = value === null && kept !== null;

    useEffect(() => {
        if (!leaving && !arriving) {
            return;
        }

        const timer = setTimeout(
            () => {
                if (leaving) {
                    setKept(null);
                }

                setArriving(false);
            },
            still ? 0 : BEAM_MS
        );

        return () => clearTimeout(timer);
    }, [leaving, arriving, still]);

    return { shown: value ?? kept, beam: leaving ? 'out' : arriving ? 'in' : undefined };
}

/*
 * The ids to draw a pet for: every one there, and for a beam's length every one that left, so its pet
 * beams out where it stood (`gone`).
 */
export function useDeparting(ids: readonly string[]): { all: string[]; gone: ReadonlySet<string> } {
    const [drawn, setDrawn] = useState<readonly string[]>(ids);
    const all = [...ids, ...drawn.filter((id) => !ids.includes(id))];

    if (all.join('\n') !== drawn.join('\n')) {
        setDrawn(all);
    }

    const departed = drawn.filter((id) => !ids.includes(id)).join('\n');

    useEffect(() => {
        if (departed === '') {
            return;
        }

        const left = departed.split('\n');
        const timer = setTimeout(() => setDrawn((current) => current.filter((id) => !left.includes(id))), BEAM_MS);

        return () => clearTimeout(timer);
    }, [departed]);

    return { all, gone: new Set(departed === '' ? [] : departed.split('\n')) };
}

/*
 * Whether something that was on is still drawn: while it is on, and for a beam's length after, so what
 * it holds can beam out before it unmounts. Turning pets off goes through this.
 */
export function useLinger(on: boolean): boolean {
    const [was, setWas] = useState(on);
    const [lingering, setLingering] = useState(false);

    if (was !== on) {
        setWas(on);
        setLingering(!on);
    }

    useEffect(() => {
        if (!lingering) {
            return;
        }

        const timer = setTimeout(() => setLingering(false), BEAM_MS);

        return () => clearTimeout(timer);
    }, [lingering]);

    return on || lingering;
}
