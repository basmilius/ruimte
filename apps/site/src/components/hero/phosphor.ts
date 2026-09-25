/** The pointer over the hero, -1..1 across its container, with `active` easing in while it is there. */
export type Pointer = { x: number; y: number; active: number };

/* An oscilloscope in vector mode: one beam traces Lissajous figures, the mark and the word "ruimte", and the
   phosphor fades behind it. It draws in a 560 x 500 box; HeroVisual places that box over its container. */

export const PHOSPHOR_WIDTH = 560;
export const PHOSPHOR_HEIGHT = 500;
// The still for reduced motion: the word, fully written.
export const PHOSPHOR_POSTER = 15.6;

const TAU = Math.PI * 2;
const CX = PHOSPHOR_WIDTH / 2;
const CY = PHOSPHOR_HEIGHT / 2;

// One pass of the beam over a whole figure takes TRACE seconds; the phosphor fades with GLOW.
const TRACE = 0.6;
const GLOW = 0.36;
// Drawing one pass, scaled by the sum of every earlier pass, is the steady glow of a repeating trace.
const REPEAT = 1 / (1 - Math.exp(-TRACE / GLOW));
const POINTS = 720;
const PER_TRACE = 720;
const STEP = TRACE / PER_TRACE;
const SAMPLES = PER_TRACE + 1;
const LEVELS = 18;
const MAX_INTENSITY = 1.8;
// Brightness is energy per length: a beam this many px per sample reads as full strength.
const REFERENCE = 1.9;

const CYCLE = 20;
// [time, shape]: equal neighbors hold a figure, different ones morph between them. 0 and 1 are Lissajous figures.
const KEYS: readonly (readonly [number, number])[] = [
    [0, 0],
    [3.2, 0],
    [4.8, 1],
    [7.4, 1],
    [9.0, 2],
    [11.8, 2],
    [13.4, 3],
    [17.4, 3],
    [19.0, 0],
    [20, 0]
];

const PASSES: readonly (readonly [number, string, number])[] = [
    [11, 'rgb(24,80,255)', 0.13],
    [3.8, 'rgb(60,128,255)', 0.42],
    [1.3, 'rgb(226,237,255)', 1]
];

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mod = (value: number, size: number) => ((value % size) + size) % size;
const smoothstep = (from: number, to: number, value: number) => {
    const amount = clamp((value - from) / (to - from));
    return amount * amount * (3 - 2 * amount);
};
const inOutCubic = (value: number) => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2);

type Piece = { readonly pts: readonly number[]; readonly blank: boolean };

/* Figures drawn from polylines are smoothed per piece, then timed like a vector display timed them: slow into
   every turn and fast over the straights and the blanked moves. */
function catmull(pts: readonly number[], out: number[], blank: boolean): void {
    const count = pts.length / 2;
    if (count === 2 || blank) {
        const steps = 10;
        for (let step = 0; step <= steps; step++) {
            out.push(lerp(pts[0]!, pts[pts.length - 2]!, step / steps), lerp(pts[1]!, pts[pts.length - 1]!, step / steps), blank ? 0 : 1);
        }
        return;
    }
    const at = (index: number) => Math.max(0, Math.min(count - 1, index));
    const steps = 14;
    for (let i = 0; i < count - 1; i++) {
        const i0 = at(i - 1);
        const i1 = i;
        const i2 = i + 1;
        const i3 = at(i + 2);
        for (let step = i === 0 ? 0 : 1; step <= steps; step++) {
            const u1 = step / steps;
            const u2 = u1 * u1;
            const u3 = u2 * u1;
            const b0 = -0.5 * u3 + u2 - 0.5 * u1;
            const b1 = 1.5 * u3 - 2.5 * u2 + 1;
            const b2 = -1.5 * u3 + 2 * u2 + 0.5 * u1;
            const b3 = 0.5 * u3 - 0.5 * u2;
            out.push(
                b0 * pts[i0 * 2]! + b1 * pts[i1 * 2]! + b2 * pts[i2 * 2]! + b3 * pts[i3 * 2]!,
                b0 * pts[i0 * 2 + 1]! + b1 * pts[i1 * 2 + 1]! + b2 * pts[i2 * 2 + 1]! + b3 * pts[i3 * 2 + 1]!,
                1
            );
        }
    }
}

function resample(dense: readonly number[]): Float32Array {
    const count = dense.length / 3;
    const cost = new Float64Array(count);
    let total = 0;
    for (let i = 1; i < count; i++) {
        const ax = dense[(i - 1) * 3]!;
        const ay = dense[(i - 1) * 3 + 1]!;
        const bx = dense[i * 3]!;
        const by = dense[i * 3 + 1]!;
        const length = Math.hypot(bx - ax, by - ay);
        let turn = 0;
        if (i < count - 1) {
            const cx = dense[(i + 1) * 3]!;
            const cy = dense[(i + 1) * 3 + 1]!;
            const before = Math.atan2(by - ay, bx - ax);
            const after = Math.atan2(cy - by, cx - bx);
            turn = Math.abs(mod(after - before + Math.PI, TAU) - Math.PI);
        }
        const lit = dense[i * 3 + 2]! > 0 && dense[(i - 1) * 3 + 2]! > 0;
        if (i < count - 1 && dense[(i + 1) * 3 + 2] === 0) {
            turn = 0;
        }
        // The beam slows into a turn (brighter) and flies across a blanked move.
        total += lit ? length + turn * 16 : length * 0.3;
        cost[i] = total;
    }
    const shape = new Float32Array(POINTS * 3);
    let segment = 1;
    for (let point = 0; point < POINTS; point++) {
        const target = (point / POINTS) * total;
        while (segment < count - 1 && cost[segment]! < target) {
            segment++;
        }
        const span = cost[segment]! - cost[segment - 1]! || 1;
        const blend = clamp((target - cost[segment - 1]!) / span);
        shape[point * 3] = lerp(dense[(segment - 1) * 3]!, dense[segment * 3]!, blend);
        shape[point * 3 + 1] = lerp(dense[(segment - 1) * 3 + 1]!, dense[segment * 3 + 1]!, blend);
        shape[point * 3 + 2] = dense[segment * 3 + 2]! > 0 && dense[(segment - 1) * 3 + 2]! > 0 ? 1 : 0;
    }
    return shape;
}

function build(pieces: readonly Piece[]): Float32Array {
    const dense: number[] = [];
    for (const piece of pieces) {
        catmull(piece.pts, dense, piece.blank);
    }
    return resample(dense);
}

// The word, as a hand would write it: one line through all six letters, then back to cross the t and dot the i.
function word(): Float32Array {
    const unit = 102;
    const originX = CX - 1.85 * unit;
    const base = CY + 58;
    const slant = 0.16;
    const map = (list: readonly number[]) => {
        const pts: number[] = [];
        for (let i = 0; i < list.length; i += 2) {
            const x = list[i]!;
            const y = list[i + 1]!;
            pts.push(originX + (x + y * slant) * unit, base - y * unit);
        }
        return pts;
    };
    const dot: number[] = [];
    for (let i = 0; i <= 24; i++) {
        const angle = -Math.PI / 2 + (i / 24) * TAU * 2;
        dot.push(1.6 + Math.cos(angle) * 0.017, 1.4 + Math.sin(angle) * 0.017);
    }
    const lit = (list: readonly number[]): Piece => ({ pts: map(list), blank: false });
    const move = (list: readonly number[]): Piece => ({ pts: map(list), blank: true });
    const dotEndX = dot[dot.length - 2]!;
    const dotEndY = dot[dot.length - 1]!;
    return build([
        lit([0, 0, 0.1, 0.45, 0.18, 0.85, 0.22, 1.0]),
        lit([0.22, 1.0, 0.28, 0.87]),
        lit([0.28, 0.87, 0.38, 0.95, 0.5, 0.98]),
        lit([0.5, 0.98, 0.49, 0.6, 0.5, 0.25, 0.53, 0.07, 0.6, 0.0, 0.7, 0.08, 0.8, 0.45, 0.86, 1.0]),
        lit([0.86, 1.0, 0.86, 0.35, 0.9, 0.1, 1.0, 0.0, 1.12, 0.08, 1.2, 0.4, 1.25, 1.0]),
        lit([1.25, 1.0, 1.25, 0.3, 1.28, 0.08, 1.36, 0.0, 1.44, 0.06, 1.52, 0.5, 1.57, 1.0]),
        lit([1.57, 1.0, 1.57, 0.3, 1.6, 0.08, 1.68, 0.0, 1.76, 0.08, 1.84, 0.7, 1.92, 0.97, 2.02, 0.95, 2.08, 0.7, 2.09, 0.0]),
        lit([2.09, 0.0, 2.1, 0.55, 2.18, 0.94, 2.28, 0.98, 2.36, 0.75, 2.37, 0.0]),
        lit([2.37, 0.0, 2.38, 0.55, 2.46, 0.94, 2.56, 0.98, 2.64, 0.75, 2.65, 0.25, 2.68, 0.07, 2.76, 0.0, 2.84, 0.06, 2.93, 0.6, 3.0, 1.55]),
        lit([
            3.0, 1.55, 2.99, 0.6, 2.99, 0.25, 3.03, 0.06, 3.12, 0.0, 3.22, 0.08, 3.34, 0.32, 3.52, 0.5, 3.6, 0.72, 3.54, 0.94, 3.4, 0.96, 3.3, 0.78, 3.28, 0.45,
            3.33, 0.15, 3.44, 0.01, 3.58, 0.02, 3.7, 0.14
        ]),
        move([3.7, 0.14, 2.86, 1.0]),
        lit([2.86, 1.0, 3.16, 1.02]),
        move([3.16, 1.02, dot[0]!, dot[1]!]),
        lit(dot),
        move([dotEndX, dotEndY, 0, 0])
    ]);
}

// The mark: the app icon's two rounded parallelograms traced as one line, crossing over where they overlap.
function mark(): Float32Array {
    const outline = (cx: number, cy: number, side: number, skew: number, radius: number) => {
        const corners = [
            [cx - side / 2 + skew, cy - side / 2],
            [cx + side / 2 + skew, cy - side / 2],
            [cx + side / 2 - skew, cy + side / 2],
            [cx - side / 2 - skew, cy + side / 2]
        ] as const;
        const pts: number[] = [];
        for (let i = 0; i < 4; i++) {
            const previous = corners[(i + 3) % 4]!;
            const corner = corners[i]!;
            const next = corners[(i + 1) % 4]!;
            const inLength = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
            const outLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
            const ax = corner[0] + ((previous[0] - corner[0]) / inLength) * radius;
            const ay = corner[1] + ((previous[1] - corner[1]) / inLength) * radius;
            const bx = corner[0] + ((next[0] - corner[0]) / outLength) * radius;
            const by = corner[1] + ((next[1] - corner[1]) / outLength) * radius;
            for (let step = 0; step <= 10; step++) {
                const along = step / 10;
                const rest = 1 - along;
                pts.push(
                    rest * rest * ax + 2 * rest * along * corner[0] + along * along * bx,
                    rest * rest * ay + 2 * rest * along * corner[1] + along * along * by
                );
            }
        }
        return pts;
    };
    const densify = (pts: readonly number[]) => {
        const out: number[] = [];
        const count = pts.length / 2;
        for (let i = 0; i <= count; i++) {
            const from = i % count;
            const to = (i + 1) % count;
            const length = Math.hypot(pts[to * 2]! - pts[from * 2]!, pts[to * 2 + 1]! - pts[from * 2 + 1]!);
            const steps = Math.max(1, Math.round(length / 4));
            for (let step = 0; step < steps; step++) {
                out.push(lerp(pts[from * 2]!, pts[to * 2]!, step / steps), lerp(pts[from * 2 + 1]!, pts[to * 2 + 1]!, step / steps));
            }
        }
        return out;
    };
    const back = densify(outline(CX - 34, CY - 30, 150, 24, 22));
    const front = densify(outline(CX + 34, CY + 30, 150, 24, 22));
    let best = Infinity;
    let backStart = 0;
    let frontStart = 0;
    for (let i = 0; i < back.length / 2; i++) {
        for (let other = 0; other < front.length / 2; other++) {
            const gap = Math.hypot(back[i * 2]! - front[other * 2]!, back[i * 2 + 1]! - front[other * 2 + 1]!);
            // The crossing on the lower left, where the word and the waves begin too.
            if (gap < best && back[i * 2]! < CX && back[i * 2 + 1]! > CY - 20) {
                best = gap;
                backStart = i;
                frontStart = other;
            }
        }
    }
    const flat: number[] = [];
    const backCount = back.length / 2;
    const frontCount = front.length / 2;
    for (let i = 0; i <= backCount; i++) {
        const index = (backStart + i) % backCount;
        flat.push(back[index * 2]!, back[index * 2 + 1]!, 1);
    }
    for (let i = 0; i <= frontCount; i++) {
        const index = (frontStart + i) % frontCount;
        flat.push(front[index * 2]!, front[index * 2 + 1]!, 1);
    }
    return resample(flat);
}

function beamHead(): HTMLCanvasElement {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const paint = canvas.getContext('2d')!;
    const gradient = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(235,242,255,1)');
    gradient.addColorStop(0.12, 'rgba(160,195,255,0.7)');
    gradient.addColorStop(0.4, 'rgba(50,110,255,0.18)');
    gradient.addColorStop(1, 'rgba(30,80,255,0)');
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, size, size);
    return canvas;
}

function lissajousWeight(time: number): number {
    const local = mod(time, CYCLE);
    return local < 9 ? 1 - smoothstep(7.4, 9.0, local) : smoothstep(17.4, 19.0, local);
}

export type Phosphor = {
    /** Advances the frequency knobs. `pointer` is the hero's own, -1..1 over its container. */
    update: (time: number, delta: number, pointer: Pointer) => void;
    /** Draws the frame for `time` into the 560 x 500 box the caller has transformed `ctx` onto. */
    draw: (ctx: CanvasRenderingContext2D, time: number, mono: string) => void;
};

export function createPhosphor(): Phosphor {
    const sampled = [null, null, mark(), word()] as const;
    const head = beamHead();

    // The knobs detune the two channels; their phase is integrated so a turn never makes the figure jump.
    let detuneX = 0;
    let detuneY = 0;
    let driftX = 0;
    let driftY = 0;

    const beam = { x: 0, y: 0, lit: 0 };
    const shapeAt = (shape: number, time: number, age: number) => {
        const progress = time / TRACE;
        if (shape <= 1) {
            const frequencyX = shape === 0 ? 3 : 5;
            const frequencyY = shape === 0 ? 2 : 4;
            const turn = (TAU * time) / (shape === 0 ? 10 : 20);
            const phaseX = driftX - (TAU * detuneX * age) / TRACE;
            const phaseY = driftY - (TAU * detuneY * age) / TRACE;
            beam.x = CX + 158 * Math.sin(TAU * frequencyX * progress + turn + phaseX);
            beam.y = CY - 128 * Math.sin(TAU * frequencyY * progress + phaseY);
            beam.lit = 1;
            return;
        }
        const data = sampled[shape]!;
        const index = (progress - Math.floor(progress)) * POINTS;
        const from = Math.floor(index) % POINTS;
        const to = (from + 1) % POINTS;
        const blend = index - Math.floor(index);
        beam.x = data[from * 3]! + (data[to * 3]! - data[from * 3]!) * blend;
        beam.y = data[from * 3 + 1]! + (data[to * 3 + 1]! - data[from * 3 + 1]!) * blend;
        beam.lit = blend < 0.5 ? data[from * 3 + 2]! : data[to * 3 + 2]!;
    };

    const beamAt = (time: number, age: number) => {
        const local = mod(time, CYCLE);
        let key = 0;
        while (key < KEYS.length - 2 && KEYS[key + 1]![0] <= local) {
            key++;
        }
        const [start, from] = KEYS[key]!;
        const [end, to] = KEYS[key + 1]!;
        if (from === to) {
            shapeAt(from, time, age);
            return;
        }
        const raw = (local - start) / (end - start);
        const eased = inOutCubic(raw);
        shapeAt(from, time, age);
        const ax = beam.x;
        const ay = beam.y;
        const alit = beam.lit;
        shapeAt(to, time, age);
        // The Y gain dips as the figures trade places, the way a scope flattens when the signal changes,
        // so one figure squashes into a bright line and the next one grows out of it.
        const gain = 1 - 0.9 * Math.pow(Math.sin(Math.PI * raw), 1.6);
        beam.x = ax + (beam.x - ax) * eased;
        beam.y = CY + (ay - CY + (beam.y - ay) * eased) * gain;
        beam.lit = alit + (beam.lit - alit) * eased;
    };

    const xs = new Float32Array(SAMPLES);
    const ys = new Float32Array(SAMPLES);
    const lits = new Float32Array(SAMPLES);
    const level = new Uint8Array(SAMPLES);
    const bucketStart = new Int32Array(LEVELS + 2);
    const bucketFill = new Int32Array(LEVELS + 2);
    const sorted = new Int32Array(SAMPLES);

    const drawGraticule = (ctx: CanvasRenderingContext2D) => {
        const left = 80;
        const top = 90;
        const division = 40;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.055)';
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
            ctx.moveTo(left + i * division, top);
            ctx.lineTo(left + i * division, top + 8 * division);
        }
        for (let i = 0; i <= 8; i++) {
            ctx.moveTo(left, top + i * division);
            ctx.lineTo(left + 10 * division, top + i * division);
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        for (let i = 0; i <= 50; i++) {
            const x = left + i * (division / 5);
            ctx.moveTo(x, CY - 3);
            ctx.lineTo(x, CY + 3);
        }
        for (let i = 0; i <= 40; i++) {
            const y = top + i * (division / 5);
            ctx.moveTo(CX - 3, y);
            ctx.lineTo(CX + 3, y);
        }
        ctx.stroke();
    };

    // Dissolves everything drawn so far toward the edges of the box, so it sits on the page without a frame.
    const fadeEdges = (ctx: CanvasRenderingContext2D) => {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.translate(CX, CY);
        ctx.scale(1, PHOSPHOR_HEIGHT / PHOSPHOR_WIDTH);
        const gradient = ctx.createRadialGradient(0, 0, CX * 0.6, 0, 0, CX * 0.97);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(-PHOSPHOR_WIDTH, -PHOSPHOR_WIDTH, PHOSPHOR_WIDTH * 2, PHOSPHOR_WIDTH * 2);
        ctx.restore();
    };

    return {
        update(time, delta, pointer) {
            const weight = lissajousWeight(time) * pointer.active;
            detuneX = pointer.x * 0.45 * weight;
            detuneY = -pointer.y * 0.45 * weight;
            driftX = mod(driftX + (TAU * detuneX * delta) / TRACE, TAU);
            driftY = mod(driftY + (TAU * detuneY * delta) / TRACE, TAU);
        },
        draw(ctx, time, mono) {
            const opacity = ctx.globalAlpha;
            drawGraticule(ctx);

            for (let sample = 0; sample < SAMPLES; sample++) {
                const age = sample * STEP;
                beamAt(time - age, age);
                xs[sample] = beam.x;
                ys[sample] = beam.y;
                lits[sample] = beam.lit;
            }
            // Energy per length: where the beam slows down it writes brighter, as on a real tube. Segments
            // are bucketed by brightness so each level is one stroke.
            bucketFill.fill(0);
            for (let sample = 0; sample < SAMPLES - 1; sample++) {
                const length = Math.max(0.25, Math.hypot(xs[sample]! - xs[sample + 1]!, ys[sample]! - ys[sample + 1]!));
                const decay = Math.exp(-(sample * STEP) / GLOW) * REPEAT;
                const intensity = Math.min(MAX_INTENSITY, (REFERENCE / length) * decay * Math.min(lits[sample]!, lits[sample + 1]!));
                const bucket = Math.round((intensity / MAX_INTENSITY) * LEVELS);
                level[sample] = bucket;
                bucketFill[bucket]!++;
            }
            let run = 0;
            for (let bucket = 0; bucket <= LEVELS; bucket++) {
                bucketStart[bucket] = run;
                run += bucketFill[bucket]!;
                bucketFill[bucket] = bucketStart[bucket]!;
            }
            for (let sample = 0; sample < SAMPLES - 1; sample++) {
                sorted[bucketFill[level[sample]!]!++] = sample;
            }

            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'butt';
            ctx.lineJoin = 'round';
            for (const [width, color, strength] of PASSES) {
                ctx.lineWidth = width;
                ctx.strokeStyle = color;
                for (let bucket = 1; bucket <= LEVELS; bucket++) {
                    const start = bucketStart[bucket]!;
                    const end = bucket < LEVELS ? bucketStart[bucket + 1]! : SAMPLES - 1;
                    if (end <= start) {
                        continue;
                    }
                    ctx.globalAlpha = opacity * Math.min(1, strength * (bucket / LEVELS) * MAX_INTENSITY);
                    ctx.beginPath();
                    for (let slot = start; slot < end; slot++) {
                        const sample = sorted[slot]!;
                        ctx.moveTo(xs[sample + 1]!, ys[sample + 1]!);
                        ctx.lineTo(xs[sample]!, ys[sample]!);
                    }
                    ctx.stroke();
                }
            }
            if (lits[0]! > 0.5) {
                ctx.globalAlpha = opacity * 0.9;
                ctx.drawImage(head, xs[0]! - 18, ys[0]! - 18, 36, 36);
            }
            ctx.globalAlpha = opacity;
            ctx.globalCompositeOperation = 'source-over';

            fadeEdges(ctx);

            const knobs = lissajousWeight(time);
            ctx.font = `500 10px ${mono}`;
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgba(154,154,166,0.5)';
            ctx.fillText('CH1  0.5 V/div', 96, 402);
            ctx.textAlign = 'right';
            ctx.fillText('2 ms/div', 464, 402);
            if (knobs > 0.02) {
                const local = mod(time, CYCLE);
                const large = local >= 3.2 && local < 9;
                const frequencyX = (large ? 5 : 3) + detuneX;
                const frequencyY = (large ? 4 : 2) + detuneY;
                ctx.fillStyle = `rgba(154,154,166,${0.5 * knobs})`;
                ctx.fillText(`X ${frequencyX.toFixed(2)}  Y ${frequencyY.toFixed(2)}`, 464, 112);
            }
            ctx.textAlign = 'left';
        }
    };
}
