export interface IdleVoiceBands {
    input: number[];
    output: number[];
}

const TAU = Math.PI * 2;
const PATTERN_SECONDS = 8;
const TRANSITION_SECONDS = 2.4;
const PATTERN_COUNT = 4;

const clamp = (value: number): number => Math.max(0.04, Math.min(0.4, value));
const wave = (turns: number): number => 0.5 + 0.5 * Math.sin(turns * TAU);
const pulse = (distance: number, width: number): number => Math.exp(-(distance * distance) / width);
const smooth = (value: number): number => value * value * (3 - 2 * value);
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const pattern = (index: number, x: number, seconds: number): [number, number] => {
    switch (index) {
        case 0: {
            const envelope = 0.35 + 0.65 * Math.sin(Math.PI * x) ** 2;
            return [0.05 + 0.3 * envelope * wave(seconds * 0.14 + x * 0.18), 0.05 + 0.24 * envelope * wave(seconds * 0.11 - x * 0.22 + 0.35)];
        }
        case 1:
            return [0.05 + 0.32 * wave(x * 1.25 - seconds * 0.22) ** 2, 0.05 + 0.28 * wave(x * 1.05 + seconds * 0.18 + 0.2) ** 3];
        case 2: {
            const inputCenter = 0.5 + 0.34 * Math.sin(seconds * 0.7);
            const outputCenter = 0.5 + 0.34 * Math.sin(seconds * 0.61 + Math.PI);
            return [0.05 + 0.34 * pulse(x - inputCenter, 0.025), 0.05 + 0.3 * pulse(x - outputCenter, 0.032)];
        }
        default:
            return [
                0.05 + 0.13 * wave(x * 2.1 + seconds * 0.17) + 0.15 * wave(x * 0.7 - seconds * 0.13) ** 2,
                0.05 + 0.12 * wave(x * 1.7 - seconds * 0.14 + 0.4) + 0.14 * wave(x * 0.55 + seconds * 0.16) ** 2
            ];
    }
};

export const idleVoiceBands = (atMs: number, count: number): IdleVoiceBands => {
    const seconds = atMs / 1_000;
    const cycle = seconds / PATTERN_SECONDS;
    const current = Math.floor(cycle) % PATTERN_COUNT;
    const elapsed = seconds % PATTERN_SECONDS;
    const transition = smooth(Math.max(0, Math.min(1, (elapsed - (PATTERN_SECONDS - TRANSITION_SECONDS)) / TRANSITION_SECONDS)));
    const input: number[] = [];
    const output: number[] = [];
    for (let index = 0; index < count; index += 1) {
        const x = count <= 1 ? 0.5 : index / (count - 1);
        const from = pattern(current, x, seconds);
        const to = pattern((current + 1) % PATTERN_COUNT, x, seconds);
        input.push(clamp(mix(from[0], to[0], transition)));
        output.push(clamp(mix(from[1], to[1], transition)));
    }
    return { input, output };
};
