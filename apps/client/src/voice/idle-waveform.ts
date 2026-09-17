export interface IdleVoiceBands {
    input: number[];
    output: number[];
}

const TAU = Math.PI * 2;
const PATTERN_SECONDS = 8;
const TRANSITION_SECONDS = 2.4;
const PATTERN_COUNT = 8;

const clamp = (value: number): number => Math.max(0.04, Math.min(0.7, value));
const amplify = (value: number): number => 0.04 + (value - 0.04) * 1.5;
const wave = (turns: number): number => 0.5 + 0.5 * Math.sin(turns * TAU);
const pulse = (distance: number, width: number): number => Math.exp(-(distance * distance) / width);
const loop = (value: number): number => ((value % 1) + 1) % 1;
const wrappedPulse = (x: number, center: number, width: number): number =>
    pulse(x - center, width) + pulse(x - center - 1, width) + pulse(x - center + 1, width);
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
        case 3:
            return [
                0.05 + 0.13 * wave(x * 2.1 + seconds * 0.17) + 0.15 * wave(x * 0.7 - seconds * 0.13) ** 2,
                0.05 + 0.12 * wave(x * 1.7 - seconds * 0.14 + 0.4) + 0.14 * wave(x * 0.55 + seconds * 0.16) ** 2
            ];
        case 4: {
            const left = pulse(x - 0.2, 0.012);
            const center = pulse(x - 0.5, 0.016);
            const right = pulse(x - 0.8, 0.012);
            return [
                0.05 + 0.33 * (left * wave(seconds * 0.18) + center * wave(seconds * 0.18 - 0.33) + right * wave(seconds * 0.18 - 0.66)),
                0.05 + 0.29 * (left * wave(seconds * 0.15 - 0.5) + center * wave(seconds * 0.15 - 0.16) + right * wave(seconds * 0.15 + 0.16))
            ];
        }
        case 5: {
            const inputCenter = loop(seconds * 0.075);
            const outputCenter = loop(1 - seconds * 0.065);
            return [
                0.05 + 0.4 * wrappedPulse(x, inputCenter, 0.009) * (0.55 + 0.45 * wave(x * 2.4 - seconds * 0.11)),
                0.05 + 0.36 * wrappedPulse(x, outputCenter, 0.012) * (0.5 + 0.5 * wave(x * 2 + seconds * 0.1 + 0.3))
            ];
        }
        case 6:
            return [
                0.05 + 0.37 * wave(seconds * 0.22 - x * 0.38) ** 7 * (0.45 + 0.55 * Math.sin(Math.PI * x) ** 2),
                0.05 + 0.32 * wave(seconds * 0.19 + x * 0.34 + 0.45) ** 6 * (0.5 + 0.5 * Math.sin(Math.PI * x) ** 2)
            ];
        default: {
            const inputEnvelope = 0.3 + 0.7 * wave(seconds * 0.055 + x * 0.2);
            const outputEnvelope = 0.3 + 0.7 * wave(seconds * 0.05 - x * 0.18 + 0.5);
            return [
                0.05 + inputEnvelope * (0.11 * wave(x * 3.2 - seconds * 0.12) + 0.16 * wave(x * 0.8 + seconds * 0.08) ** 2),
                0.05 + outputEnvelope * (0.1 * wave(x * 2.7 + seconds * 0.1 + 0.3) + 0.15 * wave(x * 0.7 - seconds * 0.09) ** 2)
            ];
        }
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
        input.push(clamp(amplify(mix(from[0], to[0], transition))));
        output.push(clamp(amplify(mix(from[1], to[1], transition))));
    }
    return { input, output };
};
