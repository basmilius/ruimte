Reel.add({
    id: 'context-lines',
    title: 'Draw a Line',
    line: 'Draw a line from what you know to the agent that needs it.',
    principles: ['Arcs', 'Secondary action'],
    tech: 'Canvas 2D, edge drawing and particle transfer',
    hint: 'Move near a node to show its ports',
    poster: 13.4,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;
        const TAU = R.TAU;
        const ease = R.ease;
        const SANS = R.fonts.sans;
        const MONO = R.fonts.mono;

        const CYCLE = 16;
        const HEAD = 28;
        const GAP = 9;
        // The context edge: the accent mixed into the ground at 55%, as the client draws it.
        const EDGE_CONTEXT = '#113992';
        const EDGE_DRAG = 'rgba(236,236,241,0.55)';
        const CHIP_BG = 'rgba(21,93,252,0.30)';
        const CHIP_FG = '#d4e3ff';
        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );
        const ARROW = new Path2D('M1.5 1.5 L1.5 19 L6 14.8 L9.2 22 L12.3 20.6 L9.2 13.6 L15.4 13.6 Z');

        const NOTE = { x: 78, y: 86, w: 190, h: 118 };
        const TERM = { x: 292, y: 86, w: 190, h: 118 };
        const CHAT = { x: 106, y: 266, w: 348, h: 170 };
        const END = [CHAT.x + CHAT.w / 2, CHAT.y - GAP];
        const REST = [486, 352];

        // Link 0 runs from the note, link 1 from the terminal; each has the same beats from its own base time.
        const LINKS = [
            { base: 0.6, from: NOTE, lean: 1 },
            { base: 7.3, from: TERM, lean: -1 }
        ];
        for (const link of LINKS) {
            link.start = [link.from.x + link.from.w / 2, link.from.y + link.from.h + GAP];
            link.aim = [END[0] + link.lean * -9, END[1] - 11];
        }
        const RESET = 14.5;

        const N = 56;
        const resample = (points, count) => {
            const lengths = [0];
            for (let i = 1; i < points.length; i++) {
                lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
            }
            const total = lengths[lengths.length - 1] || 1;
            const out = [];
            let j = 1;
            for (let i = 0; i < count; i++) {
                const at = (i / (count - 1)) * total;
                while (j < lengths.length - 1 && lengths[j] < at) {
                    j++;
                }
                const span = lengths[j] - lengths[j - 1] || 1;
                const frac = R.clamp((at - lengths[j - 1]) / span);
                out.push([R.lerp(points[j - 1][0], points[j][0], frac), R.lerp(points[j - 1][1], points[j][1], frac)]);
            }
            out.total = total;
            return out;
        };

        // The route the client draws: out of the side, one rail between, corners rounded.
        const routeOf = (start, end) => {
            const rail = (start[1] + end[1]) / 2;
            const corners = [start, [start[0], rail], [end[0], rail], end];
            const dense = [start];
            for (let i = 1; i < corners.length - 1; i++) {
                const prev = corners[i - 1];
                const cur = corners[i];
                const next = corners[i + 1];
                const inLeg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
                const outLeg = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
                const radius = Math.min(15, inLeg / 2, outLeg / 2);
                const before = [cur[0] - ((cur[0] - prev[0]) / inLeg) * radius, cur[1] - ((cur[1] - prev[1]) / inLeg) * radius];
                const after = [cur[0] + ((next[0] - cur[0]) / outLeg) * radius, cur[1] + ((next[1] - cur[1]) / outLeg) * radius];
                dense.push(before);
                for (let k = 1; k <= 8; k++) {
                    const frac = k / 8;
                    const from = [R.lerp(before[0], cur[0], frac), R.lerp(before[1], cur[1], frac)];
                    const to = [R.lerp(cur[0], after[0], frac), R.lerp(cur[1], after[1], frac)];
                    dense.push([R.lerp(from[0], to[0], frac), R.lerp(from[1], to[1], frac)]);
                }
            }
            dense.push(end);
            return resample(dense, N);
        };
        for (const link of LINKS) {
            link.route = routeOf(link.start, END);
        }

        const arcPoint = (from, to, frac, bend) => {
            const dx = to[0] - from[0];
            const dy = to[1] - from[1];
            const len = Math.hypot(dx, dy) || 1;
            const lift = Math.sin(Math.PI * frac) * bend;
            return [R.lerp(from[0], to[0], frac) + (-dy / len) * lift, R.lerp(from[1], to[1], frac) + (dx / len) * lift];
        };

        /* The cursor, as a pure function of time: moves on arcs, presses at a port, drags, lets go. */
        const cursorAt = (t) => {
            // A resting hand still drifts, on sines that divide the cycle so the loop closes exactly.
            const wave = (TAU * t) / CYCLE;
            const idle = [REST[0] + Math.sin(wave * 3) * 3 + Math.sin(wave * 5 + 1) * 1.5, REST[1] + Math.cos(wave * 2) * 2.5 + Math.sin(wave * 7) * 1];
            for (const link of LINKS) {
                const base = link.base;
                if (t < base) {
                    continue;
                }
                if (t < base + 0.9) {
                    return { p: arcPoint(idle, link.start, ease.inOutCubic((t - base) / 0.9), 46 * link.lean), press: 0 };
                }
                if (t < base + 1.1) {
                    return { p: link.start, press: ease.outQuad((t - base - 0.9) / 0.2) };
                }
                if (t < base + 2.2) {
                    return { p: arcPoint(link.start, link.aim, ease.inOutCubic((t - base - 1.1) / 1.1), -34 * link.lean), press: 1 };
                }
                if (t < base + 2.45) {
                    const frac = ease.outCubic((t - base - 2.2) / 0.25);
                    return { p: [R.lerp(link.aim[0], END[0] + 2, frac), R.lerp(link.aim[1], END[1] + 2, frac)], press: 1 - ease.inQuad((t - base - 2.2) / 0.25) };
                }
                if (t < base + 3.5) {
                    return { p: arcPoint([END[0] + 2, END[1] + 2], idle, ease.inOutCubic((t - base - 2.45) / 1.05), 40 * link.lean), press: 0 };
                }
            }
            return { p: idle, press: 0 };
        };

        /* The shape of a link's edge at time t: a loose curve while dragged, the routed rail once it snaps. */
        const lagged = [0, 0];
        const bezier = new Array(N);
        const shape = new Array(N);
        for (let i = 0; i < N; i++) {
            bezier[i] = [0, 0];
            shape[i] = [0, 0];
        }
        const edgeAt = (link, t) => {
            const base = link.base;
            if (t < base + 1.0 || t > RESET + 1.2) {
                return null;
            }
            const start = link.start;
            let end;
            let morph = 0;
            let color = 0;
            if (t < base + 2.2) {
                end = cursorAt(t).p;
                // The loose end trails the hand a little, so the curve follows through behind it.
                const back = cursorAt(Math.max(base + 1.0, t - 0.14)).p;
                lagged[0] = back[0];
                lagged[1] = back[1];
            } else {
                const snap = ease.outBack((t - base - 2.2) / 0.16, 2.2);
                end = [R.lerp(link.aim[0], END[0], snap), R.lerp(link.aim[1], END[1], snap)];
                lagged[0] = end[0];
                lagged[1] = end[1];
                morph = ease.outBack((t - base - 2.28) / 0.55, 1.4);
                color = ease.inOutSine((t - base - 2.2) / 0.6);
            }
            const reach = Math.max(30, Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.55);
            const c1 = [start[0], start[1] + reach];
            const c2 = [lagged[0] + (start[0] - lagged[0]) * 0.1, lagged[1] - reach * 0.7];
            let prev = start;
            const dense = [start];
            for (let i = 1; i <= 40; i++) {
                const along = i / 40;
                const rest = 1 - along;
                const x = rest * rest * rest * start[0] + 3 * rest * rest * along * c1[0] + 3 * rest * along * along * c2[0] + along * along * along * end[0];
                const y = rest * rest * rest * start[1] + 3 * rest * rest * along * c1[1] + 3 * rest * along * along * c2[1] + along * along * along * end[1];
                if (Math.hypot(x - prev[0], y - prev[1]) > 0.01) {
                    dense.push([x, y]);
                    prev = [x, y];
                }
            }
            const curve = dense.length > 1 ? resample(dense, N) : null;
            for (let i = 0; i < N; i++) {
                const from = curve ? curve[i] : start;
                shape[i][0] = R.lerp(from[0], link.route[i][0], morph);
                shape[i][1] = R.lerp(from[1], link.route[i][1], morph);
            }
            // At the reset the line draws itself back into the node it came from.
            const retract = ease.inOutCubic((t - RESET - (link === LINKS[0] ? 0.25 : 0)) / 0.8);
            return { color, retract, snapped: t >= base + 2.2 };
        };

        /* Secondary action: a node leans a touch toward a line as it is pulled out, and rocks when it snaps. */
        const settle = (since) => (since < 0 ? 0 : Math.exp(-since * 5.5) * Math.sin(since * 17));
        const poseOf = (which, t) => {
            let dx = 0;
            let dy = 0;
            let rot = 0;
            for (const link of LINKS) {
                const base = link.base;
                if (which === link.from) {
                    const pull = t > base + 1.1 && t < base + 2.2 ? Math.sin(Math.PI * ((t - base - 1.1) / 1.1)) : 0;
                    dy += pull * 2.2;
                    rot += pull * 0.012 * link.lean + settle(t - base - 2.2) * 0.02 * link.lean;
                }
                if (which === CHAT) {
                    dy += settle(t - base - 2.24) * 4.5;
                    rot += settle(t - base - 2.24) * -0.006 * link.lean;
                }
            }
            return { dx, dy, rot };
        };

        /* Text layout, redone whenever the web fonts arrive and change the measure. */
        let measured = -1;
        const wrap = (text, font, width) => {
            ctx.font = font;
            const words = text.split(' ');
            const lines = [];
            let line = [];
            let x = 0;
            const space = ctx.measureText(' ').width;
            for (const word of words) {
                const wordWidth = ctx.measureText(word).width;
                if (line.length && x + wordWidth > width) {
                    lines.push(line);
                    line = [];
                    x = 0;
                }
                line.push({ word, x, w: wordWidth });
                x += wordWidth + space;
            }
            lines.push(line);
            return lines;
        };
        const FONT_TEXT = '400 12.5px ' + SANS;
        const FONT_NOTE_B = '600 12.5px ' + SANS;
        const FONT_TERM = '400 11px ' + MONO;
        const FONT_CHIP = '500 9.5px ' + MONO;
        const BODY_W = CHAT.w - 30;
        const THREAD = [
            { kind: 'user', at: -1, text: 'Saved carts expire too soon. Can you fix that?' },
            { kind: 'tool', at: LINKS[0].base + 2.4, live: LINKS[0].base + 4.5, label: 'Read linked context', detail: 'Checkout brief' },
            { kind: 'quote', at: LINKS[0].base + 4.55, text: 'Saved carts: 30 days, keep the API.' },
            { kind: 'text', at: LINKS[0].base + 4.8, text: "Your brief is clear, so I'll keep the API and move the expiry to 30 days." },
            { kind: 'tool', at: LINKS[1].base + 2.4, live: LINKS[1].base + 4.5, label: 'Read linked context', detail: 'checkout tests' },
            { kind: 'text', at: LINKS[1].base + 4.6, text: 'The failing test expects 30 days as well. Fixing cart.ts now.' },
            { kind: 'working', at: LINKS[1].base + 5.9 }
        ];
        const NOTE_LINES = [
            { text: 'Saved carts', font: FONT_NOTE_B, color: '#f1ead0' },
            { text: 'Keep them 30 days.', font: FONT_TEXT, color: '#d9d2b4' },
            { text: 'Keep the API as is.', font: FONT_TEXT, color: '#d9d2b4' }
        ];
        const TERM_LINES = [
            { text: '$ bun test cart', color: pal.termDim },
            { text: 'FAIL saved cart', color: pal.red },
            { text: '  expected 30 days', color: pal.termFg },
            { text: '  received 7 days', color: pal.termDim }
        ];
        const CHIP_WORDS = [
            [
                [0, 0],
                [0, 1],
                [1, 2],
                [1, 3],
                [2, 0],
                [2, 2]
            ],
            [
                [1, 0],
                [1, 1],
                [2, 0],
                [2, 1],
                [2, 2],
                [3, 1],
                [3, 2]
            ]
        ];
        const chips = [[], []];
        const layout = () => {
            ctx.font = FONT_TEXT;
            const probe = ctx.measureText('Saved carts expire').width;
            if (probe === measured) {
                return;
            }
            measured = probe;
            for (const item of THREAD) {
                if (item.text) {
                    const width = item.kind === 'quote' ? BODY_W - 14 : item.kind === 'user' ? BODY_W * 0.72 : BODY_W;
                    item.lines = wrap(item.text, item.kind === 'quote' ? '400 italic 12.5px ' + SANS : FONT_TEXT, width);
                    item.width = Math.max(...item.lines.map((row) => row[row.length - 1].x + row[row.length - 1].w));
                    let index = 0;
                    for (const line of item.lines) {
                        for (const word of line) {
                            word.i = index++;
                        }
                    }
                    item.count = index;
                }
            }
            const noteWords = NOTE_LINES.map((line, i) => ({ words: wrap(line.text, line.font, 999)[0], y: NOTE.y + HEAD + 20 + i * 19, x: NOTE.x + 12, font: line.font }));
            ctx.font = FONT_TERM;
            const termWords = TERM_LINES.map((line, i) => {
                const words = [];
                let x = 0;
                for (const part of line.text.split(/( +)/)) {
                    const partWidth = ctx.measureText(part).width;
                    if (part.trim()) {
                        words.push({ word: part, x, w: partWidth });
                    }
                    x += partWidth;
                }
                return { words, y: TERM.y + HEAD + 18 + i * 17, x: TERM.x + 12, font: FONT_TERM };
            });
            const sources = [noteWords, termWords];
            ctx.font = FONT_CHIP;
            for (let k = 0; k < 2; k++) {
                chips[k] = CHIP_WORDS[k].map(([line, word], i) => {
                    const src = sources[k][line];
                    const entry = src.words[Math.min(word, src.words.length - 1)];
                    const label = entry.word.replace(/[.,:]$/, '');
                    return {
                        word: label,
                        x: src.x + entry.x + entry.w / 2,
                        y: src.y,
                        w: ctx.measureText(label).width + 10,
                        side: i % 2 ? 1 : -1,
                        delay: i * 0.13
                    };
                });
            }
        };

        const dots = env.buffer();
        let dotsReady = false;
        const paintDots = () => {
            const paint = dots.ctx;
            paint.clearRect(0, 0, env.W, env.H);
            paint.fillStyle = '#26262b';
            for (let y = 10; y < env.H; y += 24) {
                for (let x = 16; x < env.W; x += 24) {
                    paint.beginPath();
                    paint.arc(x, y, 1, 0, TAU);
                    paint.fill();
                }
            }
            dotsReady = true;
        };

        const line = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };
        const iconAt = (kind, x, y, color) => {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (kind === 'claude') {
                ctx.translate(x - 6.5, y - 6.5);
                ctx.scale(13 / 24, 13 / 24);
                ctx.fill(CLAUDE);
            } else if (kind === 'terminal') {
                ctx.beginPath();
                ctx.moveTo(x - 5, y - 3.5);
                ctx.lineTo(x - 1.5, y);
                ctx.lineTo(x - 5, y + 3.5);
                ctx.stroke();
                line(x + 0.5, y + 4, x + 5.5, y + 4);
            } else if (kind === 'note') {
                ctx.beginPath();
                ctx.moveTo(x - 5, y - 5);
                ctx.lineTo(x + 5, y - 5);
                ctx.lineTo(x + 5, y + 1.5);
                ctx.lineTo(x + 1.5, y + 5);
                ctx.lineTo(x - 5, y + 5);
                ctx.closePath();
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x + 5, y + 1.5);
                ctx.lineTo(x + 1.5, y + 1.5);
                ctx.lineTo(x + 1.5, y + 5);
                ctx.stroke();
            } else if (kind === 'eye') {
                ctx.beginPath();
                ctx.moveTo(x - 6, y);
                ctx.quadraticCurveTo(x, y - 6.5, x + 6, y);
                ctx.quadraticCurveTo(x, y + 6.5, x - 6, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 1.8, 0, TAU);
                ctx.stroke();
            } else if (kind === 'close') {
                line(x - 3.5, y - 3.5, x + 3.5, y + 3.5);
                line(x + 3.5, y - 3.5, x - 3.5, y + 3.5);
            } else if (kind === 'chevron') {
                ctx.beginPath();
                ctx.moveTo(x - 1.5, y - 3);
                ctx.lineTo(x + 1.5, y);
                ctx.lineTo(x - 1.5, y + 3);
                ctx.stroke();
            }
            ctx.restore();
        };

        const statusColor = { running: pal.running, idle: pal.idle, needs: pal.needs };
        const statusLabel = { running: 'Running', idle: 'Idle', needs: 'Needs you' };
        const pill = (right, cy, status, t) => {
            ctx.font = '500 10.5px ' + SANS;
            const label = statusLabel[status];
            const width = ctx.measureText(label).width + 22;
            const x = right - width;
            R.roundRect(ctx, x, cy - 8.5, width, 17, 8.5);
            ctx.fillStyle = pal.sunken;
            ctx.fill();
            const pulse = status === 'running' ? 0.75 + 0.25 * Math.cos(t * Math.PI) : 1;
            ctx.globalAlpha *= pulse;
            ctx.fillStyle = statusColor[status];
            ctx.beginPath();
            ctx.arc(x + 9, cy, 3, 0, TAU);
            ctx.fill();
            ctx.globalAlpha /= pulse;
            ctx.fillStyle = pal.muted;
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + 16, cy + 0.5);
        };

        const frame = (rect, pose, opts, t) => {
            ctx.save();
            const cx = rect.x + rect.w / 2;
            const cy = rect.y + rect.h;
            ctx.translate(cx + pose.dx, cy + pose.dy);
            ctx.rotate(pose.rot);
            ctx.translate(-cx, -cy);
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 16;
            ctx.shadowOffsetY = 5;
            R.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
            ctx.fillStyle = opts.note ? pal.note : pal.surface;
            ctx.fill();
            ctx.restore();
            ctx.save();
            R.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
            ctx.clip();
            if (!opts.note) {
                ctx.fillStyle = pal.raised;
                ctx.fillRect(rect.x, rect.y, rect.w, HEAD);
            }
            ctx.fillStyle = opts.note ? 'rgba(236,236,241,0.12)' : pal.border;
            ctx.fillRect(rect.x, rect.y + HEAD - 1, rect.w, 1);
            if (opts.body) {
                opts.body();
            }
            ctx.restore();
            R.roundRect(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 9.5);
            ctx.strokeStyle = opts.selected ? mixAccent(opts.selected) : pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            iconAt(opts.icon, rect.x + 14, rect.y + HEAD / 2, opts.note ? '#c9bf94' : pal.muted);
            ctx.font = '500 12px ' + SANS;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = opts.note ? '#f1ead0' : pal.text;
            ctx.fillText(opts.title, rect.x + 27, rect.y + HEAD / 2 + 0.5);
            iconAt('close', rect.x + rect.w - 14, rect.y + HEAD / 2, opts.note ? '#a39b7a' : pal.faint);
            if (opts.status) {
                pill(rect.x + rect.w - 27, rect.y + HEAD / 2, opts.status, t);
            }
            ctx.restore();
        };
        const mixAccent = (amount) => 'rgba(21,93,252,' + (0.12 + 0.5 * amount).toFixed(3) + ')';

        const shineFill = (x, width, t) => {
            const phase = R.fract(t / 1.6);
            const center = x + width * (1.6 - 2.2 * phase);
            const paint = ctx.createLinearGradient(center - width * 0.3, 0, center + width * 0.3, 0);
            paint.addColorStop(0, pal.muted);
            paint.addColorStop(0.5, pal.text);
            paint.addColorStop(1, pal.muted);
            return paint;
        };

        const threadAlpha = (t) => 1 - ease.inOutSine((t - RESET - 0.3) / 0.7);
        const itemHeight = (item) => {
            if (item.kind === 'tool' || item.kind === 'working') {
                return 22;
            }
            if (item.kind === 'quote') {
                return item.lines.length * 18 + 6;
            }
            if (item.kind === 'user') {
                return item.lines.length * 18 + 14;
            }
            return item.lines.length * 18 + 2;
        };

        const drawThread = (t) => {
            const top = CHAT.y + HEAD + 10;
            const left = CHAT.x + 15;
            const avail = CHAT.h - HEAD - 18;
            let total = 0;
            // Once the thread has faded out it starts over from the person's message, which is how the loop closes.
            const cleared = t > RESET + 1.0;
            for (const item of THREAD) {
                const grow = cleared && item.kind !== 'user' ? 0 : ease.inOutCubic((t - item.at) / 0.4);
                item.grow = grow;
                total += (itemHeight(item) + 7) * grow;
            }
            const scroll = Math.max(0, total - avail);
            let y = top - scroll;
            ctx.save();
            ctx.beginPath();
            ctx.rect(CHAT.x, CHAT.y + HEAD, CHAT.w, CHAT.h - HEAD);
            ctx.clip();
            const faded = threadAlpha(t);
            for (const item of THREAD) {
                if (item.grow <= 0) {
                    continue;
                }
                const alpha = cleared ? ease.inOutSine((t - RESET - 1.05) / 0.4) : faded;
                const height = itemHeight(item);
                const appear = ease.outCubic((t - item.at) / 0.35);
                ctx.save();
                ctx.globalAlpha = alpha * (item.kind === 'text' ? 1 : appear);
                ctx.translate(0, (1 - appear) * 5);
                ctx.textBaseline = 'middle';
                if (item.kind === 'user') {
                    const right = CHAT.x + CHAT.w - 15;
                    const bw = item.width + 22;
                    R.roundRect(ctx, right - bw, y, bw, height - 4, 12);
                    ctx.fillStyle = pal.active;
                    ctx.fill();
                    ctx.font = FONT_TEXT;
                    ctx.fillStyle = pal.text;
                    item.lines.forEach((row, li) => {
                        for (const word of row) {
                            ctx.fillText(word.word, right - bw + 11 + word.x, y + 14.5 + li * 18);
                        }
                    });
                } else if (item.kind === 'tool') {
                    const live = t < item.live;
                    iconAt('eye', left + 6, y + 11, live ? '#3b82f6' : pal.muted);
                    ctx.font = '400 12.5px ' + SANS;
                    const lw = ctx.measureText(item.label).width;
                    ctx.fillStyle = live ? shineFill(left + 18, lw, t) : pal.muted;
                    ctx.fillText(item.label, left + 18, y + 11.5);
                    ctx.font = '400 11px ' + MONO;
                    ctx.fillStyle = pal.faint;
                    ctx.fillText(item.detail, left + 26 + lw, y + 11.5);
                    iconAt('chevron', CHAT.x + CHAT.w - 20, y + 11, pal.faint);
                } else if (item.kind === 'working') {
                    ctx.fillStyle = pal.running;
                    ctx.beginPath();
                    ctx.arc(left + 5, y + 11, 3.5, 0, TAU);
                    ctx.fill();
                    ctx.font = '400 12.5px ' + SANS;
                    const lw = ctx.measureText('Working for').width;
                    ctx.fillStyle = shineFill(left + 16, lw, t);
                    ctx.fillText('Working for', left + 16, y + 11.5);
                    ctx.fillStyle = pal.faint;
                    const secs = Math.max(0, Math.floor(t - LINKS[1].base - 2.3));
                    ctx.fillText('00:' + String(secs).padStart(2, '0'), left + 22 + lw, y + 11.5);
                } else {
                    const quote = item.kind === 'quote';
                    if (quote) {
                        ctx.fillStyle = 'rgba(236,236,241,0.16)';
                        ctx.fillRect(left, y + 2, 2, height - 8);
                    }
                    ctx.font = quote ? '400 italic 12.5px ' + SANS : FONT_TEXT;
                    for (let li = 0; li < item.lines.length; li++) {
                        for (const word of item.lines[li]) {
                            const at = item.at + word.i * 0.075;
                            const frac = ease.outCubic((t - at) / 0.22);
                            if (frac <= 0) {
                                continue;
                            }
                            ctx.globalAlpha = alpha * frac;
                            ctx.fillStyle = quote ? '#c7c7d0' : pal.text;
                            ctx.fillText(word.word, left + (quote ? 12 : 0) + word.x, y + 9 + li * 18 + (1 - frac) * 4);
                        }
                    }
                }
                ctx.restore();
                y += (height + 7) * item.grow;
            }
            ctx.globalAlpha = 1;
            // Scrolled text slides under a soft edge, as a thread does under its header.
            const fade = ctx.createLinearGradient(0, CHAT.y + HEAD, 0, CHAT.y + HEAD + 14);
            fade.addColorStop(0, pal.surface);
            fade.addColorStop(1, 'rgba(19,19,22,0)');
            ctx.fillStyle = fade;
            ctx.fillRect(CHAT.x, CHAT.y + HEAD, CHAT.w, 14);
            ctx.restore();
        };

        const chatStatus = (t) => {
            const b0 = LINKS[0].base;
            const b1 = LINKS[1].base;
            if (t >= RESET + 0.6) {
                return 'idle';
            }
            if ((t >= b0 + 2.3 && t < b0 + 6.2) || t >= b1 + 2.3) {
                return 'running';
            }
            return 'idle';
        };

        const drawEdge = (link, t) => {
            const state = edgeAt(link, t);
            if (!state) {
                return;
            }
            const keep = Math.max(0, Math.round((1 - state.retract) * (N - 1)));
            if (keep < 1) {
                return;
            }
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 2;
            ctx.strokeStyle = state.color < 1 ? R.mix('#b8b8c2', EDGE_CONTEXT, state.color, 1) : EDGE_CONTEXT;
            if (state.color <= 0) {
                ctx.strokeStyle = EDGE_DRAG;
            }
            ctx.beginPath();
            ctx.moveTo(shape[0][0], shape[0][1]);
            for (let i = 1; i <= keep; i++) {
                ctx.lineTo(shape[i][0], shape[i][1]);
            }
            ctx.stroke();
            if (state.snapped && state.retract <= 0) {
                // The head marker, a ring in the ground color, lands with a small pop.
                const pop = ease.outBack((t - link.base - 2.2) / 0.3, 3);
                ctx.fillStyle = pal.bg;
                ctx.beginPath();
                ctx.arc(END[0], END[1], 4.5 * pop, 0, TAU);
                ctx.fill();
                ctx.stroke();
                const ring = R.clamp((t - link.base - 2.2) / 0.6);
                if (ring < 1) {
                    ctx.globalAlpha = (1 - ring) * 0.6;
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = '#3b82f6';
                    ctx.beginPath();
                    ctx.arc(END[0], END[1], 5 + ring * 16, 0, TAU);
                    ctx.stroke();
                }
            }
            ctx.restore();
        };

        const pathPoint = (points, frac, out) => {
            const at = R.clamp(frac) * (points.length - 1);
            const i = Math.min(points.length - 2, Math.floor(at));
            const k = at - i;
            out[0] = R.lerp(points[i][0], points[i + 1][0], k);
            out[1] = R.lerp(points[i][1], points[i + 1][1], k);
            out[2] = points[i + 1][0] - points[i][0];
            out[3] = points[i + 1][1] - points[i][1];
            return out;
        };
        const tmp = [0, 0, 0, 0];
        const drawChips = (link, k, t, pointer) => {
            // They pour into the port and are gone: the chat has them now.
            const target = [END[0], END[1] + 6];
            ctx.font = FONT_CHIP;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            for (const chip of chips[k]) {
                const start = link.base + 2.55 + chip.delay;
                const progress = (t - start) / 1.25;
                if (progress <= 0 || progress >= 1) {
                    continue;
                }
                const eased = ease.inOutSine(progress);
                const route = link.route;
                const l1 = Math.hypot(link.start[0] - chip.x, link.start[1] - chip.y) * 1.15;
                const l2 = route.total;
                const l3 = Math.hypot(target[0] - END[0], target[1] - END[1]);
                const at = eased * (l1 + l2 + l3);
                let x;
                let y;
                if (at < l1) {
                    // Out of the text on an arc, the way a word is lifted rather than slid.
                    const point = arcPoint([chip.x, chip.y], link.start, at / l1, 26 * chip.side * link.lean);
                    x = point[0];
                    y = point[1];
                } else if (at < l1 + l2) {
                    const along = (at - l1) / l2;
                    pathPoint(route, along, tmp);
                    const len = Math.hypot(tmp[2], tmp[3]) || 1;
                    const sway = Math.sin(Math.PI * along) * 9 * chip.side;
                    x = tmp[0] + (-tmp[3] / len) * sway;
                    y = tmp[1] + (tmp[2] / len) * sway;
                } else {
                    const along = ease.outQuad((at - l1 - l2) / l3);
                    x = R.lerp(END[0], target[0], along);
                    y = R.lerp(END[1], target[1], along);
                }
                if (pointer.active > 0.01) {
                    const gap = Math.hypot(x - pointer.x, y - pointer.y);
                    if (gap < 70 && gap > 0.01) {
                        const push = ((70 - gap) / 70) * 22 * pointer.active;
                        x += ((x - pointer.x) / gap) * push;
                        y += ((y - pointer.y) / gap) * push;
                    }
                }
                const alpha = R.smoothstep(0, 0.08, progress) * (1 - R.smoothstep(0.9, 1, progress));
                const scale = 1 - 0.6 * R.smoothstep(0.82, 1, progress);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(x, y);
                ctx.scale(scale, scale);
                R.roundRect(ctx, -chip.w / 2, -7.5, chip.w, 15, 7.5);
                ctx.fillStyle = CHIP_BG;
                ctx.fill();
                ctx.fillStyle = CHIP_FG;
                ctx.fillText(chip.word, 0, 0.5);
                ctx.restore();
            }
            ctx.textAlign = 'left';
        };

        const drawPorts = (rect, pointer) => {
            if (pointer.active < 0.02) {
                return;
            }
            const nx = R.clamp(pointer.x, rect.x, rect.x + rect.w);
            const ny = R.clamp(pointer.y, rect.y, rect.y + rect.h);
            const near = 1 - R.smoothstep(10, 70, Math.hypot(pointer.x - nx, pointer.y - ny));
            const alpha = near * pointer.active;
            if (alpha < 0.02) {
                return;
            }
            const ports = [
                [rect.x + rect.w / 2, rect.y - GAP],
                [rect.x + rect.w + GAP, rect.y + rect.h / 2],
                [rect.x + rect.w / 2, rect.y + rect.h + GAP],
                [rect.x - GAP, rect.y + rect.h / 2]
            ];
            ctx.save();
            ctx.lineWidth = 1.5;
            for (const [x, y] of ports) {
                const closeness = 1 - R.smoothstep(0, 60, Math.hypot(pointer.x - x, pointer.y - y));
                ctx.globalAlpha = alpha * (0.55 + 0.45 * closeness);
                ctx.fillStyle = pal.bg;
                ctx.strokeStyle = closeness > 0.4 ? '#3b82f6' : 'rgba(236,236,241,0.5)';
                ctx.beginPath();
                ctx.arc(x, y, 4 + closeness * 1.5, 0, TAU);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        };

        const drawNoteBody = () => {
            ctx.textBaseline = 'middle';
            NOTE_LINES.forEach((entry, i) => {
                ctx.font = entry.font;
                ctx.fillStyle = entry.color;
                ctx.fillText(entry.text, NOTE.x + 12, NOTE.y + HEAD + 20 + i * 19);
            });
        };
        const drawTermBody = (t) => {
            ctx.fillStyle = pal.termBg;
            ctx.fillRect(TERM.x, TERM.y + HEAD, TERM.w, TERM.h - HEAD);
            ctx.font = FONT_TERM;
            ctx.textBaseline = 'middle';
            TERM_LINES.forEach((entry, i) => {
                ctx.fillStyle = entry.color;
                ctx.fillText(entry.text, TERM.x + 12, TERM.y + HEAD + 18 + i * 17);
            });
            if (R.fract(t) < 0.5) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(TERM.x + 12, TERM.y + HEAD + 18 + 4 * 17 - 6, 6.5, 12);
            }
        };

        const drawCursor = (t) => {
            const pose = cursorAt(t);
            const [x, y] = pose.p;
            ctx.save();
            ctx.translate(x, y);
            if (pose.press > 0.01) {
                ctx.fillStyle = 'rgba(236,236,241,' + (0.1 * pose.press).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(0, 0, 9 * pose.press, 0, TAU);
                ctx.fill();
            }
            const scale = 1 - 0.1 * pose.press;
            ctx.scale(scale, scale);
            ctx.translate(-1.5, -1.5);
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            ctx.fillStyle = '#000';
            ctx.fill(ARROW);
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.4;
            ctx.lineJoin = 'round';
            ctx.stroke(ARROW);
            ctx.restore();
        };

        return {
            resize() {
                dotsReady = false;
            },
            draw(time) {
                const t = R.mod(time, CYCLE);
                const pointer = env.pointer;
                layout();
                if (!dotsReady) {
                    paintDots();
                }
                env.clear();
                ctx.drawImage(dots.canvas, 0, 0, env.W, env.H);

                for (let k = 0; k < 2; k++) {
                    drawEdge(LINKS[k], t);
                }
                frame(NOTE, poseOf(NOTE, t), { note: true, icon: 'note', title: 'Checkout brief', body: drawNoteBody }, t);
                frame(TERM, poseOf(TERM, t), { icon: 'terminal', title: 'checkout tests', body: () => drawTermBody(t) }, t);
                const reading = LINKS.reduce((most, link) => Math.max(most, 1 - Math.abs(t - link.base - 3.4) / 1.4), 0);
                frame(CHAT, poseOf(CHAT, t), { icon: 'claude', title: 'Saved carts', status: chatStatus(t), selected: R.clamp(reading) * 0.6, body: () => drawThread(t) }, t);
                drawPorts(NOTE, pointer);
                drawPorts(TERM, pointer);
                drawPorts(CHAT, pointer);
                for (let k = 0; k < 2; k++) {
                    drawChips(LINKS[k], k, t, pointer);
                }
                drawCursor(t);
                env.fadeEdges(0.8, 1.02);
            }
        };
    }
});
