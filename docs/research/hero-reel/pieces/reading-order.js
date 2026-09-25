Reel.add({
    id: 'reading-order',
    title: 'In Order',
    line: 'Sketch it, and the agent reads it in the order you meant.',
    principles: ['Staging', 'Timing'],
    tech: 'Canvas 2D, reading order and transcript',
    hint: 'Point at the sketch to look closer',
    poster: 11.8,
    create(env) {
        const ctx = env.ctx;
        const R = env.R;
        const pal = R.pal;
        const TAU = R.TAU;
        const ease = R.ease;
        const SANS = R.fonts.sans;
        const MONO = R.fonts.mono;
        const HAND = R.fonts.hand;

        const CLAUDE = new Path2D(
            'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
        );

        const CYCLE = 16;
        const HEAD = 28;
        const DRAW = { x: 56, y: 52, w: 448, h: 236 };
        const CHAT = { x: 115, y: 322, w: 330, h: 140 };
        const OX = DRAW.x;
        const OY = DRAW.y + HEAD;
        const EDGE_CONTEXT = '#113992';
        const SCALE = 0.93;
        const pointer = { x: 0, y: 0, active: 0 };
        const INK = '#e6e6ec';

        /* The sketch, in the drawing body's own coordinates: rough strokes and words in Kalam. */
        const EL = {
            web: { d: 'M 26 72 C 56 69, 88 71, 114 70 C 116 92, 115 112, 116 134 C 88 136, 56 133, 25 135 C 23 112, 26 92, 27 70', label: 'web', lx: 70, ly: 103, c: [70, 102] },
            api: { d: 'M 180 70 C 210 68, 244 71, 274 69 C 276 92, 273 114, 275 134 C 244 136, 210 133, 179 135 C 177 112, 180 92, 181 68', label: 'api', lx: 227, ly: 103, c: [227, 102] },
            db: {
                d: 'M 344 32 C 344 20, 418 18, 420 32 C 422 44, 346 46, 344 32 M 344 32 C 342 54, 343 72, 345 86 C 354 98, 414 98, 420 86 C 422 68, 421 50, 420 32',
                label: 'db',
                lx: 382,
                ly: 66,
                c: [382, 60]
            },
            mail: { d: 'M 344 124 C 372 122, 398 125, 424 123 C 426 144, 424 162, 425 180 C 398 182, 370 179, 343 181 C 341 162, 344 144, 345 122', label: 'mail', lx: 384, ly: 153, c: [384, 152] },
            a1: { d: 'M 120 104 C 136 102, 152 105, 172 103 M 161 96 L 173 103 L 161 111', path: [[120, 104], [146, 104], [172, 103]], label: 'GET /cart', lx: 146, ly: 88, size: 14, c: [146, 100] },
            a2: { d: 'M 280 84 C 300 72, 318 62, 338 54 M 326 50 L 339 54 L 332 65', path: [[280, 84], [310, 68], [338, 54]], c: [310, 68] },
            a3: { d: 'M 280 118 C 298 128, 316 140, 336 150 M 323 152 L 337 151 L 331 139', path: [[280, 118], [308, 134], [336, 150]], c: [308, 134] },
            ring: {
                d: 'M 184 92 C 186 64, 114 60, 110 92 C 108 124, 184 128, 186 100 C 186 92, 182 86, 176 82',
                path: [[184, 92], [150, 66], [111, 92], [150, 122], [186, 100]],
                c: [148, 94]
            },
            note: { d: 'M 104 168 C 110 154, 116 140, 126 124', label: 'cache this?', lx: 64, ly: 182, size: 19, c: [66, 180] }
        };
        for (const key of Object.keys(EL)) {
            EL[key].stroke = new Path2D(EL[key].d);
            EL[key].key = key;
        }

        // The order the person meant: follow the arrows out of web, then the note that points back at the first one.
        const STEPS = [
            { at: 1.5, from: 'web', via: 'a1', to: 'api', badge: [146, 118], text: 'web calls api: GET /cart' },
            { at: 3.7, from: 'api', via: 'a2', to: 'db', badge: [300, 52], text: 'api reads the cart from db' },
            { at: 5.9, from: 'api', via: 'a3', to: 'mail', badge: [298, 148], text: 'api sends a reminder mail' },
            { at: 8.1, from: 'note', via: 'ring', to: 'a1', badge: [126, 186], text: 'note on 1: cache this?' }
        ];
        const STEP_LEN = 2.2;
        const DONE = 10.3;
        const ANSWER = 'So I will cache GET /cart in the web app.';
        const OUT = 13.7;

        const lerp2 = (from, to, frac) => [R.lerp(from[0], to[0], frac), R.lerp(from[1], to[1], frac)];
        const along = (points, frac) => {
            const last = points.length - 1;
            const at = R.clamp(frac) * last;
            const i = Math.min(last - 1, Math.floor(at));
            return lerp2(points[i], points[i + 1], at - i);
        };

        /* Where the reading highlight is, and what it is looking at, as a pure function of time. */
        const readAt = (t) => {
            if (t < STEPS[0].at) {
                const spot = EL.web.c;
                return { p: spot, focus: null, on: ease.inOutSine((t - 0.7) / 0.6) };
            }
            for (let k = 0; k < STEPS.length; k++) {
                const step = STEPS[k];
                const since = t - step.at;
                if (since < 0 || since >= STEP_LEN) {
                    continue;
                }
                const from = EL[step.from].c;
                const via = EL[step.via];
                const to = EL[step.to].c;
                const next = STEPS[k + 1];
                if (since < 0.35) {
                    return { p: from, focus: step, on: 1 };
                }
                if (since < 1.25) {
                    // Along the stroke itself, so the reading follows the arrow the way an eye does.
                    const frac = ease.inOutSine((since - 0.35) / 0.9);
                    const path = [from, ...via.path, to];
                    return { p: along(path, frac), focus: step, on: 1 };
                }
                if (since < 1.65 || !next) {
                    return { p: to, focus: step, on: next ? 1 : 1 - ease.inOutSine((since - 1.45) / 0.5) };
                }
                const frac = ease.inOutCubic((since - 1.65) / 0.55);
                const target = EL[next.from].c;
                const mid = lerp2(to, target, frac);
                const lift = Math.sin(Math.PI * frac) * 30;
                return { p: [mid[0], mid[1] - lift], focus: null, on: 1 };
            }
            return { p: EL.a1.c, focus: null, on: 0 };
        };

        const badgeScale = (k, t) => {
            const pop = ease.outBack((t - STEPS[k].at - 0.55) / 0.4, 2.4);
            const out = ease.inBack((t - OUT - (STEPS.length - 1 - k) * 0.12) / 0.35);
            return Math.max(0, pop * (1 - out));
        };

        const brightness = (key, t, read, pointer) => {
            // Staging: while one relation is read the rest of the sketch steps back.
            let reading = 0;
            let quiet = 0;
            for (const step of STEPS) {
                const since = t - step.at;
                const weight = R.smoothstep(0, 0.3, since) * (1 - R.smoothstep(1.6, 2.0, since));
                if (weight > 0) {
                    quiet = Math.max(quiet, weight);
                    if (step.from === key || step.via === key || step.to === key || (step.via === 'ring' && key === 'label-a1')) {
                        reading = Math.max(reading, weight);
                    }
                }
            }
            let base = 0.9 - quiet * 0.5 + reading * 0.6;
            if (pointer.active > 0.01) {
                const spot = EL[key].c;
                const gap = Math.hypot(OX + spot[0] - pointer.x, OY + spot[1] - pointer.y);
                base += (1 - R.smoothstep(20, 90, gap)) * 0.35 * pointer.active;
            }
            return R.clamp(base, 0.2, 1);
        };

        let measured = -1;
        let charW = 6.6;
        let answerWords = [];
        const layout = () => {
            ctx.font = '400 11.5px ' + MONO;
            const probe = ctx.measureText('0000000000').width;
            if (probe === measured) {
                return;
            }
            measured = probe;
            charW = probe / 10;
            ctx.font = '400 12.5px ' + SANS;
            const space = ctx.measureText(' ').width;
            let x = 0;
            answerWords = ANSWER.split(' ').map((word) => {
                const entry = { word, x };
                x += ctx.measureText(word).width + space;
                return entry;
            });
        };

        const dots = env.buffer();
        let dotsReady = false;
        const paintDots = () => {
            const paint = dots.ctx;
            paint.clearRect(0, 0, env.W, env.H);
            paint.fillStyle = '#26262b';
            for (let y = 6; y < env.H; y += 24) {
                for (let x = 8; x < env.W; x += 24) {
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
            } else if (kind === 'pen') {
                ctx.beginPath();
                ctx.moveTo(x - 5, y + 5);
                ctx.lineTo(x - 3.5, y - 1);
                ctx.lineTo(x + 1, y - 5);
                ctx.lineTo(x + 5, y - 1);
                ctx.lineTo(x + 1, y + 3.5);
                ctx.closePath();
                ctx.stroke();
                line(x - 5, y + 5, x - 1, y + 1);
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
            }
            ctx.restore();
        };
        const shineFill = (x, width, t) => {
            const phase = R.fract(t / 1.6);
            const center = x + width * (1.6 - 2.2 * phase);
            const paint = ctx.createLinearGradient(center - width * 0.3, 0, center + width * 0.3, 0);
            paint.addColorStop(0, pal.muted);
            paint.addColorStop(0.5, pal.text);
            paint.addColorStop(1, pal.muted);
            return paint;
        };
        const frame = (rect, icon, title, status, t) => {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 16;
            ctx.shadowOffsetY = 5;
            R.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
            ctx.fillStyle = pal.surface;
            ctx.fill();
            ctx.restore();
            ctx.save();
            R.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
            ctx.clip();
            ctx.fillStyle = pal.raised;
            ctx.fillRect(rect.x, rect.y, rect.w, HEAD);
            ctx.fillStyle = pal.border;
            ctx.fillRect(rect.x, rect.y + HEAD - 1, rect.w, 1);
            ctx.restore();
            iconAt(icon, rect.x + 14, rect.y + HEAD / 2, pal.muted);
            ctx.font = '500 12px ' + SANS;
            ctx.textBaseline = 'middle';
            ctx.fillStyle = pal.text;
            ctx.fillText(title, rect.x + 27, rect.y + HEAD / 2 + 0.5);
            iconAt('close', rect.x + rect.w - 14, rect.y + HEAD / 2, pal.faint);
            if (status) {
                ctx.font = '500 10.5px ' + SANS;
                const label = status === 'running' ? 'Running' : 'Idle';
                const width = ctx.measureText(label).width + 22;
                const x = rect.x + rect.w - 27 - width;
                const cy = rect.y + HEAD / 2;
                R.roundRect(ctx, x, cy - 8.5, width, 17, 8.5);
                ctx.fillStyle = pal.sunken;
                ctx.fill();
                ctx.globalAlpha = status === 'running' ? 0.75 + 0.25 * Math.cos(t * Math.PI) : 1;
                ctx.fillStyle = status === 'running' ? pal.running : pal.idle;
                ctx.beginPath();
                ctx.arc(x + 9, cy, 3, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = pal.muted;
                ctx.fillText(label, x + 16, cy + 0.5);
            }
        };
        const border = (rect) => {
            R.roundRect(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 9.5);
            ctx.strokeStyle = pal.border;
            ctx.lineWidth = 1;
            ctx.stroke();
        };

        const badge = (x, y, number, scale, small) => {
            if (scale <= 0.001) {
                return;
            }
            const radius = small ? 7 : 9.5;
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.fillStyle = pal.accent;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(13,13,16,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = (small ? '600 9.5px ' : '600 12px ') + SANS;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(number), 0, 0.5);
            ctx.restore();
        };

        const drawSketch = (t, read, pointer) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(DRAW.x, DRAW.y + HEAD, DRAW.w, DRAW.h - HEAD);
            ctx.clip();
            ctx.drawImage(dots.canvas, 0, 0, env.W, env.H);
            // The reading light: a soft pool that glides over the sketch, under the ink.
            if (read.on > 0.01) {
                const [x, y] = read.p;
                const glow = ctx.createRadialGradient(OX + x, OY + y, 0, OX + x, OY + y, 46);
                glow.addColorStop(0, 'rgba(96,165,250,' + (0.2 * read.on).toFixed(3) + ')');
                glow.addColorStop(0.5, 'rgba(96,165,250,' + (0.07 * read.on).toFixed(3) + ')');
                glow.addColorStop(1, 'rgba(96,165,250,0)');
                ctx.fillStyle = glow;
                ctx.fillRect(OX + x - 46, OY + y - 46, 92, 92);
            }
            ctx.translate(OX, OY);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = INK;
            ctx.fillStyle = INK;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const key of Object.keys(EL)) {
                const el = EL[key];
                ctx.globalAlpha = brightness(key, t, read, pointer);
                ctx.lineWidth = 2.2;
                ctx.stroke(el.stroke);
                if (el.label) {
                    ctx.font = '400 ' + (el.size || 21) + 'px ' + HAND;
                    ctx.fillText(el.label, el.lx, el.ly);
                }
            }
            ctx.restore();
            ctx.globalAlpha = 1;
            // The pen tip of the reader: a small bright point riding the stroke.
            if (read.on > 0.01 && read.focus) {
                ctx.fillStyle = 'rgba(191,219,254,' + (0.9 * read.on).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(OX + read.p[0], OY + read.p[1], 2.6, 0, TAU);
                ctx.fill();
            }
            STEPS.forEach((step, k) => {
                badge(OX + step.badge[0], OY + step.badge[1], k + 1, badgeScale(k, t), false);
            });
        };

        const drawChat = (t) => {
            const top = CHAT.y + HEAD + 8;
            const left = CHAT.x + 15;
            const fade = 1 - ease.inOutSine((t - OUT) / 0.8);
            const rows = [];
            rows.push({ kind: 'tool', at: 0.8, h: 24 });
            STEPS.forEach((step, k) => rows.push({ kind: 'line', at: step.at + 0.6, h: 19, k }));
            rows.push({ kind: 'answer', at: DONE + 0.2, h: 26 });
            let total = 0;
            for (const row of rows) {
                row.grow = ease.inOutCubic((t - row.at) / 0.35);
                total += row.h * row.grow;
            }
            const scroll = Math.max(0, total - (CHAT.h - HEAD - 14));
            ctx.save();
            ctx.beginPath();
            ctx.rect(CHAT.x, CHAT.y + HEAD, CHAT.w, CHAT.h - HEAD);
            ctx.clip();
            let y = top - scroll;
            ctx.textBaseline = 'middle';
            for (const row of rows) {
                if (row.grow <= 0) {
                    continue;
                }
                const appear = ease.outCubic((t - row.at) / 0.3);
                ctx.globalAlpha = fade * appear;
                const cy = y + row.h / 2 + (1 - appear) * 4;
                if (row.kind === 'tool') {
                    const live = t < DONE;
                    iconAt('eye', left + 6, cy, live ? '#3b82f6' : pal.muted);
                    ctx.font = '400 12.5px ' + SANS;
                    const label = 'Read the drawing';
                    const lw = ctx.measureText(label).width;
                    ctx.fillStyle = live ? shineFill(left + 18, lw, t) : pal.muted;
                    ctx.fillText(label, left + 18, cy + 0.5);
                    ctx.font = '400 11px ' + MONO;
                    ctx.fillStyle = pal.faint;
                    ctx.fillText('Checkout flow', left + 26 + lw, cy + 0.5);
                } else if (row.kind === 'line') {
                    const step = STEPS[row.k];
                    badge(left + 6, cy, row.k + 1, ease.outBack((t - row.at) / 0.35, 2), true);
                    ctx.font = '400 11.5px ' + MONO;
                    ctx.fillStyle = pal.termFg;
                    const count = Math.floor(R.clamp((t - row.at - 0.05) / 0.7) * step.text.length);
                    ctx.fillText(step.text.slice(0, count), left + 20, cy + 0.5);
                    if (count < step.text.length && count > 0) {
                        ctx.fillRect(left + 20 + count * charW + 1, cy - 6, 6, 12);
                    }
                } else {
                    ctx.font = '400 12.5px ' + SANS;
                    for (let i = 0; i < answerWords.length; i++) {
                        const frac = ease.outCubic((t - row.at - i * 0.07) / 0.22);
                        if (frac <= 0) {
                            break;
                        }
                        ctx.globalAlpha = fade * frac;
                        ctx.fillStyle = pal.text;
                        ctx.fillText(answerWords[i].word, left + answerWords[i].x, cy + 3 + (1 - frac) * 4);
                    }
                }
                y += row.h * row.grow;
            }
            ctx.restore();
            ctx.globalAlpha = 1;
        };

        return {
            resize() {
                dotsReady = false;
            },
            draw(time) {
                const t = R.mod(time, CYCLE);
                // The whole scene sits a little smaller than its layout, so both nodes stay clear of the soft edge.
                const raw = env.pointer;
                pointer.x = (raw.x - 280) / SCALE + 280;
                pointer.y = (raw.y - 256) / SCALE + 256;
                pointer.active = raw.active;
                layout();
                if (!dotsReady) {
                    paintDots();
                }
                env.clear();
                ctx.save();
                ctx.translate(280, 256);
                ctx.scale(SCALE, SCALE);
                ctx.translate(-280, -256);
                const read = readAt(t);

                // The context line between the drawing and the chat is simply there: this take is about the reading.
                const ex = DRAW.x + DRAW.w / 2;
                ctx.strokeStyle = EDGE_CONTEXT;
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                line(ex, DRAW.y + DRAW.h + 9, ex, CHAT.y - 9);
                ctx.fillStyle = pal.bg;
                ctx.beginPath();
                ctx.arc(ex, CHAT.y - 9, 4.5, 0, TAU);
                ctx.fill();
                ctx.stroke();
                // Each relation read travels down the line as a small spark, just before its line is written.
                for (const step of STEPS) {
                    const progress = (t - step.at - 0.25) / 0.4;
                    if (progress > 0 && progress < 1) {
                        const y = R.lerp(DRAW.y + DRAW.h + 9, CHAT.y - 9, ease.inOutSine(progress));
                        ctx.fillStyle = 'rgba(147,197,253,' + (0.9 * Math.sin(Math.PI * progress)).toFixed(3) + ')';
                        ctx.beginPath();
                        ctx.arc(ex, y, 2.5, 0, TAU);
                        ctx.fill();
                    }
                }

                frame(DRAW, 'pen', 'Checkout flow', null, t);
                drawSketch(t, read, pointer);
                border(DRAW);
                frame(CHAT, 'claude', 'Checkout', t > 0.8 && t < DONE ? 'running' : 'idle', t);
                drawChat(t);
                border(CHAT);
                ctx.restore();
                env.fadeEdges(0.8, 1.03);
            }
        };
    }
});
