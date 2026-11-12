import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Half the usual rate halves the files, and the highest overtone of any voice still lies well under half of it.
const SAMPLE_RATE = 22_050;

// Well under full scale, so a sound never tops whatever else the computer is playing.
const PEAK = 0.4;

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

interface Overtone {
    /* The overtone's pitch as a multiple of the note's; a whole number rings in tune, any other like metal or glass. */
    multiple: number;
    loudness: number;
    /* How soon it is gone, as a part of the note's own decay. */
    decay: number;
}

interface Voice {
    id: string;
    partials: readonly Overtone[];
    attackSeconds: number;
    /* Stretches every note's decay and the sound's length; a sound still ends within a second. */
    sustain: number;
    /* Moves every note, 0.5 being an octave down. */
    pitch: number;
}

// A sound stays under a second whatever its voice sustains.
const LONGEST_SECONDS = 0.98;

const VOICES: readonly Voice[] = [
    {
        // A struck metal bar: round, with two soft overtones in tune.
        id: 'bar',
        partials: [
            { multiple: 1, loudness: 1, decay: 1 },
            { multiple: 2, loudness: 0.22, decay: 0.55 },
            { multiple: 3, loudness: 0.07, decay: 0.35 }
        ],
        attackSeconds: 0.006,
        sustain: 1,
        pitch: 1
    },
    {
        // A small bell: overtones out of tune with the note, which is what makes glass ring.
        id: 'glass',
        partials: [
            { multiple: 1, loudness: 1, decay: 1 },
            { multiple: 2.76, loudness: 0.3, decay: 0.7 },
            { multiple: 5.4, loudness: 0.08, decay: 0.3 }
        ],
        attackSeconds: 0.003,
        sustain: 1.3,
        pitch: 1
    },
    {
        // A marimba: the overtone two octaves up is a short tick of the mallet, and the note is dry.
        id: 'wood',
        partials: [
            { multiple: 1, loudness: 1, decay: 1 },
            { multiple: 4, loudness: 0.35, decay: 0.12 },
            { multiple: 9.2, loudness: 0.08, decay: 0.05 }
        ],
        attackSeconds: 0.003,
        sustain: 0.6,
        pitch: 1
    },
    {
        // A plucked string an octave down: every overtone of the series, the high ones gone first.
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
    },
    {
        // A breath of a flute: almost a pure tone that swells in and lingers.
        id: 'air',
        partials: [
            { multiple: 1, loudness: 1, decay: 1 },
            { multiple: 2, loudness: 0.08, decay: 0.8 }
        ],
        attackSeconds: 0.035,
        sustain: 1.5,
        pitch: 1
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

function render(motif: Motif, voice: Voice): Float64Array {
    const samples = new Float64Array(Math.round(Math.min(LONGEST_SECONDS, motif.seconds * voice.sustain) * SAMPLE_RATE));

    for (const note of motif.notes) {
        const start = Math.round(note.at * SAMPLE_RATE);

        for (let i = start; i < samples.length; i++) {
            const seconds = (i - start) / SAMPLE_RATE;
            const attack = Math.min(1, seconds / voice.attackSeconds);

            for (const partial of voice.partials) {
                const fade = Math.exp(-seconds / (note.decay * voice.sustain * partial.decay));

                samples[i]! += note.loudness * partial.loudness * attack * fade * Math.sin(2 * Math.PI * note.hertz * voice.pitch * partial.multiple * seconds);
            }
        }
    }

    // A hundredth of a second, so the file never ends on a step.
    return finished(samples, 0.01);
}

/* The sound faded to nothing over its last `fadeSeconds` and brought to the one peak every sound has. */
function finished(samples: Float64Array, fadeSeconds: number): Float64Array {
    const tail = Math.round(fadeSeconds * SAMPLE_RATE);

    for (let i = 0; i < tail; i++) {
        samples[samples.length - 1 - i]! *= i / tail;
    }

    const loudest = samples.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);

    return samples.map((sample) => (sample / loudest) * PEAK);
}

/*
 * The packs of recorded instruments play the same motifs on the CC0 instrument pack AfterMotion builds
 * (`packages/instruments/dist` there, each instrument's source and license in its `instrument.json`).
 * The pack is not in this repository, so without it only the synthesized voices are written.
 */
const INSTRUMENTS = process.env.INSTRUMENT_PACK ?? fileURLToPath(new URL('../../aftermotion/packages/instruments/dist/', import.meta.url));

interface Region {
    file: string;
    keys: [number, number];
    root: number;
    velocity: [number, number];
    articulation: string;
    take: number;
    trigger: string;
    /* Decibels that bring the recording to the level of its neighbors. */
    volume: number;
    /* Cents the recording is off its root. */
    tune: number;
}

interface Part {
    /* The instrument's folder in the pack: `keys/grand`. */
    instrument: string;
    /* Octaves the part plays above or below the motif. */
    octaves: number;
    velocity: number;
    loudness: number;
    /* Hertz above which the part is rolled off, which takes the bite out of a pluck or a hammer; absent leaves it as recorded. */
    cutoff?: number;
    /* Seconds a note swells in over, which rounds the pick or the hammer off; absent starts it as recorded. */
    attack?: number;
}

interface Ensemble {
    id: string;
    /* One or two instruments, each playing every note of the motif. */
    parts: readonly Part[];
}

const ENSEMBLES: readonly Ensemble[] = [
    { id: 'grand', parts: [{ instrument: 'keys/grand', octaves: 0, velocity: 80, loudness: 1 }] },
    { id: 'felt', parts: [{ instrument: 'keys/upright', octaves: 0, velocity: 40, loudness: 1, cutoff: 2200, attack: 0.008 }] },
    { id: 'nylon', parts: [{ instrument: 'guitar/nylon', octaves: 0, velocity: 60, loudness: 1, cutoff: 3000, attack: 0.006 }] },
    { id: 'steel', parts: [{ instrument: 'guitar/steel', octaves: 0, velocity: 60, loudness: 1, cutoff: 2600, attack: 0.008 }] },
    {
        id: 'duo',
        parts: [
            { instrument: 'keys/grand', octaves: 0, velocity: 50, loudness: 1, cutoff: 3000 },
            { instrument: 'guitar/nylon', octaves: -1, velocity: 60, loudness: 0.5, cutoff: 2400, attack: 0.01 }
        ]
    }
];

const regions = new Map<string, Region[]>();
const recordings = new Map<string, Float32Array>();

function regionFor(part: Part, key: number): Region {
    let listed = regions.get(part.instrument);

    if (listed === undefined) {
        listed = (JSON.parse(readFileSync(join(INSTRUMENTS, part.instrument, 'instrument.json'), 'utf8')) as { regions: Region[] }).regions;
        regions.set(part.instrument, listed);
    }

    const found = listed
        .filter((region) => region.trigger === 'attack' && region.articulation === 'sustain')
        .filter((region) => region.keys[0] <= key && key <= region.keys[1] && region.velocity[0] <= part.velocity && part.velocity <= region.velocity[1])
        // The narrowest layer that holds the velocity, and its first take.
        .sort((a, b) => a.velocity[1] - a.velocity[0] - (b.velocity[1] - b.velocity[0]) || a.take - b.take)[0];

    if (found === undefined) {
        throw new Error(`${part.instrument} has no sustained note at key ${key} and velocity ${part.velocity}`);
    }

    return found;
}

/* A recording as mono samples at this script's rate, from its first sound on, so a note starts when the motif says. */
function recording(path: string): Float32Array {
    const known = recordings.get(path);

    if (known !== undefined) {
        return known;
    }

    const decoded = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-']);

    if (decoded.exitCode !== 0) {
        throw new Error(`ffmpeg does not decode ${path}: ${decoded.stderr.toString()}`);
    }

    const samples = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, Math.floor(decoded.stdout.byteLength / 4));
    const loudest = samples.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);
    const first = samples.findIndex((sample) => Math.abs(sample) > loudest * 0.02);
    const trimmed = samples.slice(Math.max(0, first - Math.round(0.002 * SAMPLE_RATE)));

    recordings.set(path, trimmed);

    return trimmed;
}

/* One note of a part mixed into the sound: its recording played faster or slower to reach the key, damped when the note is a dry one. */
function play(samples: Float64Array, part: Part, key: number, at: number, loudness: number, damp: number | null): void {
    const region = regionFor(part, key);
    const source = recording(join(INSTRUMENTS, part.instrument, region.file));
    const rate = 2 ** ((key - region.root - region.tune / 100) / 12);
    const gain = loudness * part.loudness * 10 ** (region.volume / 20);
    const start = Math.round(at * SAMPLE_RATE);
    // How far a one-pole low-pass moves toward each new sample; 1 passes everything.
    const follow = part.cutoff === undefined ? 1 : 1 - Math.exp((-2 * Math.PI * part.cutoff) / SAMPLE_RATE);
    let filtered = 0;

    for (let i = start; i < samples.length; i++) {
        const position = (i - start) * rate;
        const whole = Math.floor(position);

        if (whole + 1 >= source.length) {
            break;
        }

        const seconds = (i - start) / SAMPLE_RATE;
        const between = source[whole]! + (source[whole + 1]! - source[whole]!) * (position - whole);
        const swell = part.attack === undefined ? 1 : Math.min(1, seconds / part.attack);
        const fade = damp === null ? 1 : Math.exp(-seconds / damp);

        filtered += follow * (between - filtered);
        samples[i]! += gain * swell * fade * filtered;
    }
}

function keyOf(hertz: number): number {
    return Math.round(69 + 12 * Math.log2(hertz / 440));
}

function perform(motif: Motif, ensemble: Ensemble): Float64Array {
    const samples = new Float64Array(Math.round(Math.min(LONGEST_SECONDS, motif.seconds * 1.4) * SAMPLE_RATE));
    // The knock is two dry notes, so a recorded one is damped where it would ring.
    const damp = motif.id === 'knock' ? 0.09 : null;

    for (const part of ensemble.parts) {
        for (const note of motif.notes) {
            play(samples, part, keyOf(note.hertz) + 12 * part.octaves, note.at, note.loudness, damp);
        }
    }

    // A recorded note rings for seconds, so it leaves over a quarter of one instead of being cut.
    return finished(samples, 0.25);
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

function write(pack: string, motif: Motif, samples: Float64Array): void {
    const file = wav(samples);

    mkdirSync(join(OUT, pack), { recursive: true });
    writeFileSync(join(OUT, pack, `${motif.id}.wav`), file);
    console.log(`${pack}/${motif.id}.wav\t${file.length} bytes`);
}

for (const voice of VOICES) {
    for (const motif of MOTIFS) {
        write(voice.id, motif, render(motif, voice));
    }
}

if (existsSync(INSTRUMENTS)) {
    for (const ensemble of ENSEMBLES) {
        for (const motif of MOTIFS) {
            write(ensemble.id, motif, perform(motif, ensemble));
        }
    }
} else {
    console.log(`No instrument pack at ${INSTRUMENTS}, so the recorded packs stay as they are`);
}
