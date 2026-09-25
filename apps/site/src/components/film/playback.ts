import { createContext, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

export const EASE = [0.22, 1, 0.36, 1] as const;

export interface Playback {
    /** On screen and allowed to move. */
    readonly playing: boolean;
    /** Reduced motion: every scene shows its last step and stays there. */
    readonly still: boolean;
}

export const PlaybackContext = createContext<Playback>({ playing: false, still: true });

export function usePlayback(): Playback {
    return useContext(PlaybackContext);
}

/**
 * Walks a scene through its steps, one duration (ms) each, and starts over after the last. A scene
 * off screen holds its step, so it never runs where nobody looks. Pass a module constant: a new
 * array per render restarts the step.
 */
export function useTimeline(durations: readonly number[]): number {
    const { playing, still } = usePlayback();
    const [step, setStep] = useState(0);
    const last = durations.length - 1;

    useEffect(() => {
        if (!playing || still) {
            return;
        }
        const timer = window.setTimeout(() => setStep((current) => (current >= last ? 0 : current + 1)), durations[step]);
        return () => window.clearTimeout(timer);
    }, [playing, still, step, last, durations]);

    return still ? last : step;
}

export interface FilmPosition {
    readonly chapter: number;
    readonly step: number;
    readonly jump: (chapter: number) => void;
}

/**
 * The same walk over chapters: the last step of one leads into the first of the next, and a person
 * can jump to a chapter, which starts it over.
 */
export function useFilm(chapters: readonly (readonly number[])[]): FilmPosition {
    const { playing, still } = usePlayback();
    const [position, setPosition] = useState({ chapter: 0, step: 0 });
    const durations = chapters[position.chapter];

    useEffect(() => {
        if (!playing || still) {
            return;
        }
        const timer = window.setTimeout(() => {
            setPosition(({ chapter, step }) => {
                if (step < chapters[chapter].length - 1) {
                    return { chapter, step: step + 1 };
                }
                return { chapter: (chapter + 1) % chapters.length, step: 0 };
            });
        }, durations[position.step]);
        return () => window.clearTimeout(timer);
    }, [playing, still, position, durations, chapters]);

    const jump = useCallback((chapter: number) => setPosition({ chapter, step: 0 }), []);

    if (still) {
        return { chapter: position.chapter, step: chapters[position.chapter].length - 1, jump };
    }
    return { chapter: position.chapter, step: position.step, jump };
}

/**
 * Whether a scene may move: while a third of `ref` is on screen, and never under reduced motion.
 */
export function useStagePlayback(ref: RefObject<HTMLElement | null>): Playback {
    const [visible, setVisible] = useState(false);
    const reduced = useReducedMotion() ?? false;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const view = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
        view.observe(element);
        return () => view.disconnect();
    }, [ref]);

    return { playing: visible && !reduced, still: reduced };
}
