Reel.add({
    id: 'phosphor',
    title: 'Phosphor',
    line: 'One clean signal draws the mark, the word, and back.',
    principles: ['Arcs', 'Timing'],
    tech: 'Canvas 2D, beam persistence with speed-weighted brightness',
    hint: 'Move to turn the two frequency knobs',
    poster: 15.6,
    create(env) {
        const { R, W, H } = env;
        const ctx = env.ctx;
        const CX = W / 2;
        const CY = H / 2;
        const TAU = R.TAU;

        // One pass of the beam over a whole figure takes TRACE seconds; the phosphor fades with GLOW.
        const TRACE = 0.6;
        const GLOW = 0.36;
        // Drawing one pass, scaled by the sum of every earlier pass, is the steady glow of a repeating trace.
        const REPEAT = 1 / (1 - Math.exp(-TRACE / GLOW));
        const POINTS = 720;
        const PER_TRACE = Math.round(460 + 260 * env.quality);
        const STEP = TRACE / PER_TRACE;
        const SAMPLES = PER_TRACE + 1;
        const LEVELS = 18;
        const MAX_INTENSITY = 1.8;
        // Brightness is energy per length: a beam this many px per sample reads as full strength.
        const REFERENCE = 1.9;

        const CYCLE = 20;
        // [time, shape]: equal neighbors hold a figure, different ones morph between them.
        const KEYS = [
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

        /* Figures that are drawn from polylines: smoothed per piece, then timed like a vector display
           timed them, slow into every turn and fast over the straights and the blanked moves. */
        const catmull = (pts, out, blank) => {
            const count = pts.length / 2;
            if (count === 2 || blank) {
                const steps = 10;
                for (let step = 0; step <= steps; step++) {
                    out.push(R.lerp(pts[0], pts[pts.length - 2], step / steps), R.lerp(pts[1], pts[pts.length - 1], step / steps), blank ? 0 : 1);
                }
                return;
            }
            const at = (i) => Math.max(0, Math.min(count - 1, i));
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
                        b0 * pts[i0 * 2] + b1 * pts[i1 * 2] + b2 * pts[i2 * 2] + b3 * pts[i3 * 2],
                        b0 * pts[i0 * 2 + 1] + b1 * pts[i1 * 2 + 1] + b2 * pts[i2 * 2 + 1] + b3 * pts[i3 * 2 + 1],
                        1
                    );
                }
            }
        };

        const resample = (dense) => {
            const count = dense.length / 3;
            const cost = new Float64Array(count);
            let total = 0;
            for (let i = 1; i < count; i++) {
                const ax = dense[(i - 1) * 3];
                const ay = dense[(i - 1) * 3 + 1];
                const bx = dense[i * 3];
                const by = dense[i * 3 + 1];
                const len = Math.hypot(bx - ax, by - ay);
                let turn = 0;
                if (i < count - 1) {
                    const cx = dense[(i + 1) * 3];
                    const cy = dense[(i + 1) * 3 + 1];
                    const a1 = Math.atan2(by - ay, bx - ax);
                    const a2 = Math.atan2(cy - by, cx - bx);
                    turn = Math.abs(R.mod(a2 - a1 + Math.PI, TAU) - Math.PI);
                }
                const lit = dense[i * 3 + 2] > 0 && dense[(i - 1) * 3 + 2] > 0;
                if (i < count - 1 && dense[(i + 1) * 3 + 2] === 0) {
                    turn = 0;
                }
                // The beam slows into a turn (brighter) and flies across a blanked move.
                total += lit ? len + turn * 16 : len * 0.3;
                cost[i] = total;
            }
            const shape = new Float32Array(POINTS * 3);
            let seg = 1;
            for (let k = 0; k < POINTS; k++) {
                const target = (k / POINTS) * total;
                while (seg < count - 1 && cost[seg] < target) {
                    seg++;
                }
                const span = cost[seg] - cost[seg - 1] || 1;
                const blend = R.clamp((target - cost[seg - 1]) / span);
                shape[k * 3] = R.lerp(dense[(seg - 1) * 3], dense[seg * 3], blend);
                shape[k * 3 + 1] = R.lerp(dense[(seg - 1) * 3 + 1], dense[seg * 3 + 1], blend);
                shape[k * 3 + 2] = dense[seg * 3 + 2] > 0 && dense[(seg - 1) * 3 + 2] > 0 ? 1 : 0;
            }
            return shape;
        };

        const build = (pieces) => {
            const dense = [];
            for (const piece of pieces) {
                catmull(piece.pts, dense, piece.blank);
            }
            return resample(dense);
        };

        // The word, as a hand would write it: one line through all six letters, then back to cross the t and dot the i.
        const word = (() => {
            const unit = 102;
            const ox = CX - 1.85 * unit;
            const base = CY + 58;
            const slant = 0.16;
            const map = (list) => {
                const pts = [];
                for (let i = 0; i < list.length; i += 2) {
                    const x = list[i];
                    const y = list[i + 1];
                    pts.push(ox + (x + y * slant) * unit, base - y * unit);
                }
                return pts;
            };
            const dot = [];
            for (let i = 0; i <= 24; i++) {
                const angle = -Math.PI / 2 + (i / 24) * TAU * 2;
                dot.push(1.6 + Math.cos(angle) * 0.017, 1.4 + Math.sin(angle) * 0.017);
            }
            const lit = (list) => ({ pts: map(list), blank: false });
            const move = (list) => ({ pts: map(list), blank: true });
            const dotEnd = [dot[dot.length - 2], dot[dot.length - 1]];
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
                lit([3.0, 1.55, 2.99, 0.6, 2.99, 0.25, 3.03, 0.06, 3.12, 0.0, 3.22, 0.08, 3.34, 0.32, 3.52, 0.5, 3.6, 0.72, 3.54, 0.94, 3.4, 0.96, 3.3, 0.78, 3.28, 0.45, 3.33, 0.15, 3.44, 0.01, 3.58, 0.02, 3.7, 0.14]),
                move([3.7, 0.14, 2.86, 1.0]),
                lit([2.86, 1.0, 3.16, 1.02]),
                move([3.16, 1.02, dot[0], dot[1]]),
                lit(dot),
                move([dotEnd[0], dotEnd[1], 0, 0])
            ]);
        })();

        // The mark: two rounded parallelograms traced as one line, crossing over where they overlap.
        const mark = (() => {
            const outline = (cx, cy, side, skew, radius) => {
                const corners = [
                    [cx - side / 2 + skew, cy - side / 2],
                    [cx + side / 2 + skew, cy - side / 2],
                    [cx + side / 2 - skew, cy + side / 2],
                    [cx - side / 2 - skew, cy + side / 2]
                ];
                const pts = [];
                for (let i = 0; i < 4; i++) {
                    const prev = corners[(i + 3) % 4];
                    const cur = corners[i];
                    const next = corners[(i + 1) % 4];
                    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
                    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
                    const ax = cur[0] + ((prev[0] - cur[0]) / inLen) * radius;
                    const ay = cur[1] + ((prev[1] - cur[1]) / inLen) * radius;
                    const bx = cur[0] + ((next[0] - cur[0]) / outLen) * radius;
                    const by = cur[1] + ((next[1] - cur[1]) / outLen) * radius;
                    for (let step = 0; step <= 10; step++) {
                        const along = step / 10;
                        const rest = 1 - along;
                        pts.push(rest * rest * ax + 2 * rest * along * cur[0] + along * along * bx, rest * rest * ay + 2 * rest * along * cur[1] + along * along * by);
                    }
                }
                return pts;
            };
            const dense = (pts) => {
                const out = [];
                const count = pts.length / 2;
                for (let i = 0; i <= count; i++) {
                    const from = i % count;
                    const to = (i + 1) % count;
                    const len = Math.hypot(pts[to * 2] - pts[from * 2], pts[to * 2 + 1] - pts[from * 2 + 1]);
                    const steps = Math.max(1, Math.round(len / 4));
                    for (let step = 0; step < steps; step++) {
                        out.push(R.lerp(pts[from * 2], pts[to * 2], step / steps), R.lerp(pts[from * 2 + 1], pts[to * 2 + 1], step / steps));
                    }
                }
                return out;
            };
            const back = dense(outline(CX - 34, CY - 30, 150, 24, 22));
            const front = dense(outline(CX + 34, CY + 30, 150, 24, 22));
            let best = Infinity;
            let bi = 0;
            let fi = 0;
            for (let i = 0; i < back.length / 2; i++) {
                for (let j = 0; j < front.length / 2; j++) {
                    const gap = Math.hypot(back[i * 2] - front[j * 2], back[i * 2 + 1] - front[j * 2 + 1]);
                    // The crossing on the lower left, where the word and the waves begin too.
                    if (gap < best && back[i * 2] < CX && back[i * 2 + 1] > CY - 20) {
                        best = gap;
                        bi = i;
                        fi = j;
                    }
                }
            }
            const flat = [];
            const nb = back.length / 2;
            const nf = front.length / 2;
            for (let i = 0; i <= nb; i++) {
                const k = (bi + i) % nb;
                flat.push(back[k * 2], back[k * 2 + 1], 1);
            }
            for (let i = 0; i <= nf; i++) {
                const k = (fi + i) % nf;
                flat.push(front[k * 2], front[k * 2 + 1], 1);
            }
            return resample(flat);
        })();

        const sampled = [null, null, mark, word];

        // The knobs detune the two channels; their phase is integrated so a turn never makes the figure jump.
        let detuneX = 0;
        let detuneY = 0;
        let driftX = 0;
        let driftY = 0;

        const lissajousWeight = (time) => {
            const local = R.mod(time, CYCLE);
            return local < 9 ? 1 - R.smoothstep(7.4, 9.0, local) : R.smoothstep(17.4, 19.0, local);
        };

        const pos = { x: 0, y: 0, lit: 0 };
        const shapeAt = (shape, time, age) => {
            const beam = time / TRACE;
            if (shape <= 1) {
                const fx = shape === 0 ? 3 : 5;
                const fy = shape === 0 ? 2 : 4;
                const turn = (TAU * time) / (shape === 0 ? 10 : 20);
                const px = driftX - (TAU * detuneX * age) / TRACE;
                const py = driftY - (TAU * detuneY * age) / TRACE;
                pos.x = CX + 158 * Math.sin(TAU * fx * beam + turn + px);
                pos.y = CY - 128 * Math.sin(TAU * fy * beam + py);
                pos.lit = 1;
                return;
            }
            const data = sampled[shape];
            const index = R.fract(beam) * POINTS;
            const i0 = Math.floor(index) % POINTS;
            const i1 = (i0 + 1) % POINTS;
            const blend = index - Math.floor(index);
            pos.x = data[i0 * 3] + (data[i1 * 3] - data[i0 * 3]) * blend;
            pos.y = data[i0 * 3 + 1] + (data[i1 * 3 + 1] - data[i0 * 3 + 1]) * blend;
            pos.lit = blend < 0.5 ? data[i0 * 3 + 2] : data[i1 * 3 + 2];
        };

        const beamAt = (time, age) => {
            const local = R.mod(time, CYCLE);
            let k = 0;
            while (k < KEYS.length - 2 && KEYS[k + 1][0] <= local) {
                k++;
            }
            const from = KEYS[k][1];
            const to = KEYS[k + 1][1];
            if (from === to) {
                shapeAt(from, time, age);
                return;
            }
            const raw = (local - KEYS[k][0]) / (KEYS[k + 1][0] - KEYS[k][0]);
            const eased = R.ease.inOutCubic(raw);
            shapeAt(from, time, age);
            const ax = pos.x;
            const ay = pos.y;
            const al = pos.lit;
            shapeAt(to, time, age);
            // The Y gain dips as the figures trade places, the way a scope flattens when the signal changes,
            // so one figure squashes into a bright line and the next one grows out of it.
            const gain = 1 - 0.9 * Math.pow(Math.sin(Math.PI * raw), 1.6);
            pos.x = ax + (pos.x - ax) * eased;
            pos.y = CY + (ay - CY + (pos.y - ay) * eased) * gain;
            pos.lit = al + (pos.lit - al) * eased;
        };

        const sx = new Float32Array(SAMPLES);
        const sy = new Float32Array(SAMPLES);
        const sl = new Float32Array(SAMPLES);
        const level = new Uint8Array(SAMPLES);
        const bucketStart = new Int32Array(LEVELS + 2);
        const bucketFill = new Int32Array(LEVELS + 2);
        const sorted = new Int32Array(SAMPLES);

        const head = (() => {
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const paint = canvas.getContext('2d');
            const grad = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            grad.addColorStop(0, 'rgba(235,242,255,1)');
            grad.addColorStop(0.12, 'rgba(160,195,255,0.7)');
            grad.addColorStop(0.4, 'rgba(50,110,255,0.18)');
            grad.addColorStop(1, 'rgba(30,80,255,0)');
            paint.fillStyle = grad;
            paint.fillRect(0, 0, size, size);
            return canvas;
        })();

        const PASSES = [
            [11, 'rgb(24,80,255)', 0.13],
            [3.8, 'rgb(60,128,255)', 0.42],
            [1.3, 'rgb(226,237,255)', 1]
        ];

        const drawGraticule = () => {
            const left = 80;
            const top = 90;
            const div = 40;
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.055)';
            ctx.beginPath();
            for (let i = 0; i <= 10; i++) {
                ctx.moveTo(left + i * div, top);
                ctx.lineTo(left + i * div, top + 8 * div);
            }
            for (let i = 0; i <= 8; i++) {
                ctx.moveTo(left, top + i * div);
                ctx.lineTo(left + 10 * div, top + i * div);
            }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            for (let i = 0; i <= 50; i++) {
                const x = left + i * (div / 5);
                ctx.moveTo(x, CY - 3);
                ctx.lineTo(x, CY + 3);
            }
            for (let i = 0; i <= 40; i++) {
                const y = top + i * (div / 5);
                ctx.moveTo(CX - 3, y);
                ctx.lineTo(CX + 3, y);
            }
            ctx.stroke();
        };

        return {
            update(t, dt) {
                const pointer = env.pointer;
                const weight = lissajousWeight(t) * pointer.active;
                detuneX = pointer.nx * 0.45 * weight;
                detuneY = -pointer.ny * 0.45 * weight;
                driftX = R.mod(driftX + (TAU * detuneX * dt) / TRACE, TAU);
                driftY = R.mod(driftY + (TAU * detuneY * dt) / TRACE, TAU);
            },
            draw(t) {
                env.clear();
                drawGraticule();

                for (let j = 0; j < SAMPLES; j++) {
                    const age = j * STEP;
                    beamAt(t - age, age);
                    sx[j] = pos.x;
                    sy[j] = pos.y;
                    sl[j] = pos.lit;
                }
                // Energy per length: where the beam slows down it writes brighter, as on a real tube.
                bucketFill.fill(0);
                for (let j = 0; j < SAMPLES - 1; j++) {
                    const len = Math.max(0.25, Math.hypot(sx[j] - sx[j + 1], sy[j] - sy[j + 1]));
                    const decay = Math.exp(-(j * STEP) / GLOW) * REPEAT;
                    const intensity = Math.min(MAX_INTENSITY, (REFERENCE / len) * decay * Math.min(sl[j], sl[j + 1]));
                    const lv = Math.round((intensity / MAX_INTENSITY) * LEVELS);
                    level[j] = lv;
                    bucketFill[lv]++;
                }
                let run = 0;
                for (let lv = 0; lv <= LEVELS; lv++) {
                    bucketStart[lv] = run;
                    run += bucketFill[lv];
                    bucketFill[lv] = bucketStart[lv];
                }
                for (let j = 0; j < SAMPLES - 1; j++) {
                    sorted[bucketFill[level[j]]++] = j;
                }

                ctx.globalCompositeOperation = 'lighter';
                ctx.lineCap = 'butt';
                ctx.lineJoin = 'round';
                for (let pass = 0; pass < PASSES.length; pass++) {
                    const spec = PASSES[pass];
                    ctx.lineWidth = spec[0];
                    ctx.strokeStyle = spec[1];
                    for (let lv = 1; lv <= LEVELS; lv++) {
                        const start = bucketStart[lv];
                        const end = lv < LEVELS ? bucketStart[lv + 1] : SAMPLES - 1;
                        if (end <= start) {
                            continue;
                        }
                        ctx.globalAlpha = Math.min(1, spec[2] * (lv / LEVELS) * MAX_INTENSITY);
                        ctx.beginPath();
                        for (let slot = start; slot < end; slot++) {
                            const j = sorted[slot];
                            ctx.moveTo(sx[j + 1], sy[j + 1]);
                            ctx.lineTo(sx[j], sy[j]);
                        }
                        ctx.stroke();
                    }
                }
                if (sl[0] > 0.5) {
                    ctx.globalAlpha = 0.9;
                    ctx.drawImage(head, sx[0] - 18, sy[0] - 18, 36, 36);
                }
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';

                env.fadeEdges(0.6, 0.97);

                const knobs = lissajousWeight(t);
                ctx.font = '500 10px ' + R.fonts.mono;
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = 'rgba(154,154,166,0.5)';
                ctx.fillText('CH1  0.5 V/div', 96, 402);
                ctx.textAlign = 'right';
                ctx.fillText('2 ms/div', 464, 402);
                if (knobs > 0.02) {
                    const local = R.mod(t, CYCLE);
                    const big = local >= 3.2 && local < 9;
                    const fx = (big ? 5 : 3) + detuneX;
                    const fy = (big ? 4 : 2) + detuneY;
                    ctx.fillStyle = R.rgba(R.pal.muted, 0.5 * knobs);
                    ctx.fillText('X ' + fx.toFixed(2) + '  Y ' + fy.toFixed(2), 464, 112);
                }
                ctx.textAlign = 'left';
            }
        };
    }
});
