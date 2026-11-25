import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The notification sounds of the client, synthesized here so no sample of anyone else's is in them.
 * A motif is the notes of one event and a voice is the instrument of one pack, so every pack plays the
 * same five motifs: the motif says what happened, the voice says where. All notes come from one
 * pentatonic scale, so no sound clashes with another that plays right after it. Run
 * `bun scripts/make-sounds.ts` after a change and commit the files it writes.
 */

const OUT = fileURLToPath(new URL('../apps/client/src/attention/sounds/', import.meta.url));

// The usual rate: a mallet's tick and a tine's ping lie above what half of it holds.
const SAMPLE_RATE = 44_100;

// Well under full scale, so a sound never tops whatever else the computer is playing.
const PEAK = 0.4;

// A sound stays under a second whatever its voice sustains.
const LONGEST_SECONDS = 0.98;

// So the file never ends on a step.
const FADE_SECONDS = 0.012;

// The note a mode's ring time is written for; a shorter note of a motif rings shorter.
const REFERENCE_DECAY = 0.12;

const NOTES = { A3: 220, C4: 261.63, D4: 293.66, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880 };

interface Note {
    hertz: number;
    /* When the note starts, in seconds from the start of the sound. */
    at: number;
    /* The seconds in which the note falls to about a third of its loudness. */
    decay: number;
    loudness: number;
}

interface Motif {
    id: string;
    seconds: number;
    notes: readonly Note[];
}

/* What hits: how long the contact lasts, how bright it is, and how much of the contact itself is heard. */
interface Strike {
    milliseconds: number;
    hertz: number;
    click: number;
}

interface Mode {
    /* The mode's pitch as a multiple of the note's; a whole number rings in tune, any other like metal. */
    ratio: number;
    loudness: number;
    /* Seconds it rings before it is gone, for a note of the reference decay at C5. */
    seconds: number;
}

/*
 * Something that is hit: a burst of noise (the mallet, the thumb, the hammer) sets a resonator ringing
 * for every mode of the bar or the tine, and a small room sits behind it. The noise is what keeps it
 * from sounding like a sum of sines.
 */
interface Struck {
    kind: 'struck';
    id: string;
    strike: Strike;
    modes: readonly Mode[];
    /* Moves every note, 0.5 being an octave down. */
    pitch: number;
    /* How much of the small room is mixed in. */
    room: number;
    /* Stretches the sound's length beyond the motif's own; a sound still ends within a second. */
    tail: number;
    /* Its own, so a voice sounds the same after the list around it changes. */
    seed: number;
}

interface Overtone {
    /* The overtone's pitch as a multiple of the note's. */
    multiple: number;
    loudness: number;
    /* How soon it is gone, as a part of the note's own decay. */
    decay: number;
}

/* Sines that die away, one per overtone, with nothing hitting and no room. */
interface Summed {
    kind: 'summed';
    id: string;
    partials: readonly Overtone[];
    attackSeconds: number;
    /* Stretches every note's decay and the sound's length; a sound still ends within a second. */
    sustain: number;
    pitch: number;
}

type Voice = Struck | Summed;

const VOICES: readonly Voice[] = [
    {
        // The marimba's low end: a longer bar over a tube, under a softer mallet.
        kind: 'struck',
        id: 'marimba-low',
        strike: { milliseconds: 5, hertz: 2200, click: 0.04 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.55 },
            { ratio: 4, loudness: 0.28, seconds: 0.09 },
            { ratio: 9.9, loudness: 0.08, seconds: 0.035 }
        ],
        pitch: 0.5,
        room: 0.08,
        tail: 0.9,
        seed: 11_000
    },
    {
        // A rosewood bar under a soft mallet: the fundamental, the overtone two octaves up and a short tick.
        kind: 'struck',
        id: 'marimba',
        strike: { milliseconds: 4, hertz: 3200, click: 0.05 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.42 },
            { ratio: 4, loudness: 0.3, seconds: 0.07 },
            { ratio: 9.9, loudness: 0.1, seconds: 0.03 }
        ],
        pitch: 1,
        room: 0.08,
        tail: 0.8,
        seed: 3000
    },
    {
        // The kalimba's low tines, which sit over the box and sound rounder.
        kind: 'struck',
        id: 'kalimba-low',
        strike: { milliseconds: 1.5, hertz: 6000, click: 0.06 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.8 },
            { ratio: 6.27, loudness: 0.18, seconds: 0.12 }
        ],
        pitch: 0.5,
        room: 0.1,
        tail: 1.1,
        seed: 12_000
    },
    {
        // A steel tine plucked by a thumb: a clear note that lingers, with the tine's own high ping.
        kind: 'struck',
        id: 'kalimba',
        strike: { milliseconds: 1, hertz: 9000, click: 0.07 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.7 },
            { ratio: 6.27, loudness: 0.22, seconds: 0.12 },
            { ratio: 17.5, loudness: 0.05, seconds: 0.03 }
        ],
        pitch: 1,
        room: 0.1,
        tail: 1.1,
        seed: 7000
    },
    {
        // A slit drum an octave down under a soft mallet: a warm, round thud.
        kind: 'struck',
        id: 'log',
        strike: { milliseconds: 6, hertz: 1600, click: 0.04 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.32 },
            { ratio: 2.7, loudness: 0.22, seconds: 0.1 },
            { ratio: 5.2, loudness: 0.08, seconds: 0.05 }
        ],
        pitch: 0.5,
        room: 0.1,
        tail: 0.8,
        seed: 6000
    },
    {
        // An aluminum bar under a soft mallet: the marimba's overtones, but it sings on.
        kind: 'struck',
        id: 'vibes',
        strike: { milliseconds: 4, hertz: 2800, click: 0.03 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 1.1 },
            { ratio: 4, loudness: 0.18, seconds: 0.35 },
            { ratio: 10, loudness: 0.05, seconds: 0.1 }
        ],
        pitch: 1,
        room: 0.1,
        tail: 1.3,
        seed: 13_000
    },
    {
        // The tine of an electric piano an octave down, under a felt hammer: warm, with a faint bell on top.
        kind: 'struck',
        id: 'tine',
        strike: { milliseconds: 3, hertz: 2400, click: 0.03 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 1 },
            { ratio: 2, loudness: 0.12, seconds: 0.4 },
            { ratio: 7.1, loudness: 0.12, seconds: 0.06 }
        ],
        pitch: 0.5,
        room: 0.08,
        tail: 1.2,
        seed: 17_000
    },
    {
        // The comb of a music box an octave up: the kalimba's tine, small and thin.
        kind: 'struck',
        id: 'music-box',
        strike: { milliseconds: 0.8, hertz: 10_000, click: 0.05 },
        modes: [
            { ratio: 1, loudness: 1, seconds: 0.9 },
            { ratio: 6.27, loudness: 0.12, seconds: 0.1 }
        ],
        pitch: 2,
        room: 0.12,
        tail: 1.2,
        seed: 18_000
    },
    {
        // A plucked string an octave down: every overtone of the series, the high ones gone first.
        kind: 'summed',
        id: 'string',
        partials: [
            { multiple: 1, loudness: 1, decay: 1 },
            { multiple: 2, loudness: 0.5, decay: 0.7 },
            { multiple: 3, loudness: 0.33, decay: 0.5 },
            { multiple: 4, loudness: 0.2, decay: 0.38 },
            { multiple: 5, loudness: 0.12, decay: 0.3 },
            { multiple: 6, loudness: 0.07, decay: 0.24 }
        ],
        attackSeconds: 0.002,
        sustain: 1.2,
        pitch: 0.5
    }
];

const MOTIFS: readonly Motif[] = [
    {
        // Two notes up, the way a voice rises at the end of a question.
        id: 'rise',
        seconds: 0.62,
        notes: [
            { hertz: NOTES.E5, at: 0, decay: 0.11, loudness: 0.85 },
            { hertz: NOTES.A5, at: 0.13, decay: 0.15, loudness: 1 }
        ]
    },
    {
        // One note with its octave under it: a bell someone rang on purpose.
        id: 'chime',
        seconds: 0.8,
        notes: [
            { hertz: NOTES.G5, at: 0, decay: 0.2, loudness: 1 },
            { hertz: NOTES.G4, at: 0, decay: 0.24, loudness: 0.5 }
        ]
    },
    {
        // Two notes down and low: something came to rest before it was done.
        id: 'fall',
        seconds: 0.7,
        notes: [
            { hertz: NOTES.A4, at: 0, decay: 0.12, loudness: 0.9 },
            { hertz: NOTES.D4, at: 0.15, decay: 0.18, loudness: 1 }
        ]
    },
    {
        // The same low note twice, short and dry, like a knock on wood.
        id: 'knock',
        seconds: 0.45,
        notes: [
            { hertz: NOTES.A3, at: 0, decay: 0.045, loudness: 1 },
            { hertz: NOTES.A3, at: 0.14, decay: 0.055, loudness: 0.9 }
        ]
    },
    {
        // Three quick notes up to the keynote's fifth: a small flourish for work that is done.
        id: 'trio',
        seconds: 0.75,
        notes: [
            { hertz: NOTES.C5, at: 0, decay: 0.09, loudness: 0.8 },
            { hertz: NOTES.E5, at: 0.09, decay: 0.1, loudness: 0.85 },
            { hertz: NOTES.G5, at: 0.18, decay: 0.17, loudness: 1 }
        ]
    }
];

/* The same numbers on every run, so a sound only changes when its voice does. */
function randomFrom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;

        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function peakOf(samples: Float64Array): number {
    let most = 0;

    for (const sample of samples) {
        most = Math.max(most, Math.abs(sample));
    }

    return most;
}

/* The contact itself: noise under half a sine, rolled off above `hertz`, at a peak of one. */
function burst(strike: Strike, random: () => number): Float64Array {
    const samples = new Float64Array(Math.max(2, Math.round((strike.milliseconds / 1000) * SAMPLE_RATE)));
    const keep = Math.exp((-2 * Math.PI * strike.hertz) / SAMPLE_RATE);
    let last = 0;

    for (let i = 0; i < samples.length; i++) {
        const noise = (random() * 2 - 1) * Math.sin((Math.PI * i) / samples.length);

        last = (1 - keep) * noise + keep * last;
        samples[i] = last;
    }

    const peak = peakOf(samples);

    return samples.map((sample) => sample / peak);
}

/* One mode of the thing that was hit: a resonator the burst sets ringing, gone after `seconds`, at a peak of one. */
function ring(input: Float64Array, hertz: number, seconds: number, length: number): Float64Array {
    const out = new Float64Array(length);
    // 6.91 is the natural logarithm of a thousand, the sixty decibels a ring falls before it counts as gone.
    const radius = Math.exp(-6.91 / (seconds * SAMPLE_RATE));
    const first = 2 * radius * Math.cos((2 * Math.PI * hertz) / SAMPLE_RATE);
    const second = radius * radius;
    let before = 0;
    let twoBefore = 0;

    for (let i = 0; i < length; i++) {
        const now = (i < input.length ? input[i]! : 0) + first * before - second * twoBefore;

        out[i] = now;
        twoBefore = before;
        before = now;
    }

    const peak = peakOf(out);

    return peak === 0 ? out : out.map((sample) => sample / peak);
}

function addAt(mix: Float64Array, start: number, part: Float64Array, loudness: number): void {
    for (let i = 0; i < part.length && start + i < mix.length; i++) {
        mix[start + i]! += part[i]! * loudness;
    }
}

function struck(voice: Struck, note: Note, mix: Float64Array, random: () => number): void {
    const start = Math.round(note.at * SAMPLE_RATE);
    const hertz = note.hertz * voice.pitch;
    const hit = burst(voice.strike, random);
    // A shorter note of the motif rings shorter, and so does a higher bar.
    const shorter = Math.pow(note.decay / REFERENCE_DECAY, 0.7) * Math.pow(NOTES.C5 / note.hertz, 0.35);

    for (const mode of voice.modes) {
        // A mode near half the rate would come back as a lower pitch that is not the instrument's.
        if (hertz * mode.ratio < SAMPLE_RATE * 0.45) {
            addAt(mix, start, ring(hit, hertz * mode.ratio, mode.seconds * shorter, mix.length - start), note.loudness * mode.loudness);
        }
    }

    addAt(mix, start, hit, note.loudness * voice.strike.click);
}

function summed(voice: Summed, note: Note, mix: Float64Array): void {
    const start = Math.round(note.at * SAMPLE_RATE);

    for (let i = start; i < mix.length; i++) {
        const seconds = (i - start) / SAMPLE_RATE;
        const attack = Math.min(1, seconds / voice.attackSeconds);

        for (const partial of voice.partials) {
            const fade = Math.exp(-seconds / (note.decay * voice.sustain * partial.decay));

            mix[i]! += note.loudness * partial.loudness * attack * fade * Math.sin(2 * Math.PI * note.hertz * voice.pitch * partial.multiple * seconds);
        }
    }
}

/* A small room after Schroeder: four short echoes that feed themselves, then two that smear them. */
function room(dry: Float64Array, amount: number): Float64Array {
    const wet = new Float64Array(dry.length);

    for (const [milliseconds, feedback] of [
        [11.3, 0.72],
        [13.7, 0.7],
        [16.1, 0.68],
        [18.9, 0.66]
    ] as const) {
        const delay = Math.round((milliseconds / 1000) * SAMPLE_RATE);
        const line = new Float64Array(dry.length);
        let dull = 0;

        for (let i = 0; i < dry.length; i++) {
            const back = i >= delay ? line[i - delay]! : 0;

            // Each round loses highs, as a wall takes them.
            dull = 0.6 * back + 0.4 * dull;
            line[i] = dry[i]! + feedback * dull;
            wet[i]! += back * 0.25;
        }
    }

    for (const milliseconds of [5.1, 1.7]) {
        const delay = Math.round((milliseconds / 1000) * SAMPLE_RATE);
        const input = Float64Array.from(wet);

        for (let i = 0; i < wet.length; i++) {
            const delayedIn = i >= delay ? input[i - delay]! : 0;
            const delayedOut = i >= delay ? wet[i - delay]! : 0;

            wet[i] = -0.5 * input[i]! + delayedIn + 0.5 * delayedOut;
        }
    }

    return dry.map((sample, i) => sample + amount * wet[i]!);
}

/* The sound faded to nothing at its end and brought to the one peak every sound has. */
function finished(samples: Float64Array): Float64Array {
    const tail = Math.round(FADE_SECONDS * SAMPLE_RATE);

    for (let i = 0; i < tail; i++) {
        samples[samples.length - 1 - i]! *= i / tail;
    }

    const loudest = peakOf(samples);

    return samples.map((sample) => (sample / loudest) * PEAK);
}

function render(motif: Motif, motifIndex: number, voice: Voice): Float64Array {
    const stretch = voice.kind === 'struck' ? voice.tail : voice.sustain;
    const mix = new Float64Array(Math.round(Math.min(LONGEST_SECONDS, motif.seconds * stretch) * SAMPLE_RATE));

    if (voice.kind === 'summed') {
        for (const note of motif.notes) {
            summed(voice, note, mix);
        }

        return finished(mix);
    }

    const random = randomFrom(voice.seed + motifIndex);

    for (const note of motif.notes) {
        struck(voice, note, mix, random);
    }

    return finished(room(mix, voice.room));
}

/* Mono, 16 bits: a WAV every browser and Electron plays without a decoder of its own. */
function wav(samples: Float64Array): Buffer {
    const data = Buffer.alloc(samples.length * 2);

    samples.forEach((sample, i) => data.writeInt16LE(Math.round(sample * 32_767), i * 2));

    const header = Buffer.alloc(44);

    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);

    return Buffer.concat([header, data]);
}

for (const voice of VOICES) {
    mkdirSync(join(OUT, voice.id), { recursive: true });

    MOTIFS.forEach((motif, motifIndex) => {
        const file = wav(render(motif, motifIndex, voice));

        writeFileSync(join(OUT, voice.id, `${motif.id}.wav`), file);
        console.log(`${voice.id}/${motif.id}.wav\t${file.length} bytes`);
    });
}
