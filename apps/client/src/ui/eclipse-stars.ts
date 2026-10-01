export type StarTone = 'white' | 'cool' | 'warm';

export interface Star {
    /* Percent of the scene, from its left and its top edge. */
    left: number;
    top: number;
    /* Whole pixels: the scene keeps to them as the rest of the interface does. */
    size: 1 | 2;
    tone: StarTone;
    alpha: number;
    /* A glint flares up and glows; every other star only twinkles. */
    glint: boolean;
    /* Seconds. The delay is negative, so every star is somewhere in its cycle from the first frame. */
    duration: number;
    delay: number;
}

/* Mulberry32: a few lines, and the same sky on every draw and every machine. */
const randomFrom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
};

const rounded = (value: number, digits: number): number => Number(value.toFixed(digits));

/* The stars of one scene, laid out from a seed: mostly white, a few cool and warm, about one in five a glint. */
export const starsOf = (count: number, seed: number): Star[] => {
    const random = randomFrom(seed);
    return Array.from({ length: count }, (): Star => {
        const left = rounded(random() * 100, 1);
        const top = rounded(random() * 100, 1);
        const toneRoll = random();
        const glint = random() < 0.2;
        return {
            left,
            top,
            size: random() < 0.15 ? 2 : 1,
            tone: toneRoll < 0.6 ? 'white' : toneRoll < 0.8 ? 'cool' : 'warm',
            alpha: rounded(0.18 + random() * 0.32, 2),
            glint,
            duration: glint ? 6 + Math.floor(random() * 4) : 4 + Math.floor(random() * 4),
            delay: -Math.floor(random() * 9)
        };
    });
};
