Reel.add({
    id: 'overnight',
    title: 'Overnight',
    line: 'Close the lid at night. In the morning the work is where you left it.',
    principles: ['Staging', 'Timing', 'Appeal'],
    tech: 'Canvas 2D, oblique projection, illustrated keyframe story',
    hint: 'Move to tilt the scene',
    poster: 7.6,
    create(env) {
        const { R } = env;
        const ctx = env.ctx;
        const pal = R.pal;
        const PI = Math.PI;
        const LOOP = 14;

        const PORT_X = 280;
        const PORT_Y = 250;
        const PORT_R = 194;
        const HORIZON = 272;

        // The laptop in world units: X across, Y up, Z toward the back.
        const LW = 182;
        const LD = 124;
        const LL = 122;
        const BT = 6;
        const LT = 4;
        const OPEN = (108 / 180) * PI;

        const T_CLOSE = 2.3;
        const CLOSE_DUR = 1.0;
        const T_OPEN = 10.9;
        const T_WAKE = 11.35;

        const springStep = (e, omega, zeta) => {
            if (e <= 0) {
                return 0;
            }
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * omega * e) * (Math.cos(wd * e) + ((zeta * omega) / wd) * Math.sin(wd * e));
        };

        /* The lid: pushed shut with a slow start, it taps down and bounces once; lifted open with a spring. */
        const lidAngle = (t) => {
            if (t < T_CLOSE) {
                return OPEN;
            }
            if (t < T_CLOSE + CLOSE_DUR) {
                const progress = (t - T_CLOSE) / CLOSE_DUR;
                return OPEN * (1 - Math.pow(progress, 2.3));
            }
            if (t < T_OPEN) {
                const since = t - T_CLOSE - CLOSE_DUR;
                return 0.06 * Math.exp(-since * 10) * Math.abs(Math.sin((since * PI) / 0.13));
            }
            return OPEN * springStep(t - T_OPEN, 4.6, 0.74);
        };
        const screenLevel = (t, theta) => {
            if (t < T_OPEN) {
                return R.smoothstep(0.35, 0.8, theta);
            }
            return R.smoothstep(T_WAKE, T_WAKE + 0.35, t);
        };

        /* Time of day. */
        const SKY = [
            [0.0, ['#151a2b', '#211e30', '#3a2a34']],
            [2.4, ['#151a2b', '#211e30', '#3a2a34']],
            [4.6, ['#06070d', '#090c17', '#0f1426']],
            [9.6, ['#06070d', '#090c17', '#0f1426']],
            [11.2, ['#0f1628', '#262a3c', '#5a3f2f']],
            [12.4, ['#17213a', '#283049', '#433e46']],
            [14.0, ['#151a2b', '#211e30', '#3a2a34']]
        ];
        const skyColors = ['', '', ''];
        const skyAt = (t) => {
            let k = 0;
            while (k < SKY.length - 2 && t >= SKY[k + 1][0]) {
                k++;
            }
            const from = SKY[k];
            const to = SKY[k + 1];
            const blend = R.smoothstep(from[0], to[0], t);
            for (let i = 0; i < 3; i++) {
                skyColors[i] = R.mix(from[1][i], to[1][i], blend);
            }
            return skyColors;
        };
        const nightness = (t) => R.smoothstep(3.6, 5.0, t) * (1 - R.smoothstep(9.5, 10.8, t));
        const sunset = (t) => Math.max(1 - R.smoothstep(1.8, 3.9, t), R.smoothstep(12.9, 14, t));
        const sunrise = (t) => R.smoothstep(9.3, 11.3, t) * (1 - R.smoothstep(12.2, 13.5, t));

        /* Stars wheel around a pole above the frame; their trails grow through the night like a long exposure. */
        const STAR_COUNT = Math.round(46 + 40 * env.quality);
        const POLE_X = 330;
        const POLE_Y = -40;
        const stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                radius: 110 + env.rand() * 330,
                angle: PI / 2 + (env.rand() - 0.5) * 1.9,
                size: 0.5 + Math.pow(env.rand(), 3) * 1.3,
                twinkle: env.rand() * R.TAU,
                bright: 0.35 + env.rand() * 0.65
            });
        }
        const WHEEL = 0.5;
        const nightProgress = (t) => R.clamp((t - 3.6) / 7);

        /* Projection: an orthographic 3/4 view, turned a little further by the pointer. */
        const view = { ox: 0, oy: 0, exx: 0, exy: 0, ezx: 0, ezy: 0, eyy: -1 };
        const setView = () => {
            const pointer = env.pointer;
            const yaw = -0.3 + 0.12 * pointer.nx * pointer.active;
            const pitch = 0.46 + 0.07 * pointer.ny * pointer.active;
            view.exx = Math.cos(yaw);
            view.exy = Math.sin(yaw) * Math.sin(pitch);
            view.ezx = Math.sin(yaw);
            view.ezy = -Math.cos(yaw) * Math.sin(pitch);
            view.eyy = -Math.cos(pitch);
            // Keep the middle of the laptop where it is while the view turns.
            const cx = LW / 2;
            const cz = LD / 2;
            view.ox = 280 + 4 * pointer.nx * pointer.active - (cx * view.exx + cz * view.ezx);
            view.oy = 326 + 3 * pointer.ny * pointer.active - (cx * view.exy + cz * view.ezy);
        };
        const projected = { x: 0, y: 0 };
        const project = (x, y, depth) => {
            projected.x = view.ox + x * view.exx + depth * view.ezx;
            projected.y = view.oy + x * view.exy + depth * view.ezy + y * view.eyy;
            return projected;
        };
        const pv = (x, y, depth) => [x * view.exx + depth * view.ezx, x * view.exy + depth * view.ezy + y * view.eyy];

        // A face spanned by e1 and e2 from p0, with e1 x e2 pointing outward; visible when it turns to us.
        const face = (p0, e1, e2) => {
            const edgeA = pv(e1[0], e1[1], e1[2]);
            const edgeB = pv(e2[0], e2[1], e2[2]);
            const area = edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0];
            const origin = project(p0[0], p0[1], p0[2]);
            return { x: origin.x, y: origin.y, ax: edgeA[0], ay: edgeA[1], bx: edgeB[0], by: edgeB[1], visible: area > 0 };
        };
        const facePath = (quad) => {
            ctx.beginPath();
            ctx.moveTo(quad.x, quad.y);
            ctx.lineTo(quad.x + quad.ax, quad.y + quad.ay);
            ctx.lineTo(quad.x + quad.ax + quad.bx, quad.y + quad.ay + quad.by);
            ctx.lineTo(quad.x + quad.bx, quad.y + quad.by);
            ctx.closePath();
        };
        const fillFace = (quad, color, stroke) => {
            if (!quad.visible) {
                return false;
            }
            facePath(quad);
            ctx.fillStyle = color;
            ctx.fill();
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
            return true;
        };
        // Draws inside a face with (u, v) running along e1/|e1| and e2/|e2| in world units.
        const inFace = (quad, ulen, vlen, draw) => {
            ctx.save();
            ctx.transform(quad.ax / ulen, quad.ay / ulen, quad.bx / vlen, quad.by / vlen, quad.x, quad.y);
            draw();
            ctx.restore();
        };

        /* The terminal: one stream of lines that repeats every loop, so the last lines on screen always match. */
        const LINES = [
            [0.25, 'pass', 'cart/add.test.ts'],
            [0.8, 'pass', 'cart/checkout.test.ts'],
            [1.35, 'pass', 'api/orders.test.ts'],
            [1.9, 'pass', 'api/refunds.test.ts'],
            [7.9, 'pass', 'e2e/ship.test.ts'],
            [8.3, 'sum', '1284 passed  0 failed'],
            [8.36, 'dim', 'done in 8h 17m'],
            [8.42, 'prompt', ''],
            [13.4, 'run', 'running 1284 tests'],
            [13.75, 'pass', 'auth/session.test.ts']
        ];
        const COMMAND = 'bun test --all';
        const T_TYPE = 12.55;
        const VISIBLE = 8;
        const visibleLines = [];
        const collectLines = (t) => {
            visibleLines.length = 0;
            for (let pass = 0; pass < 2; pass++) {
                for (const line of LINES) {
                    const at = pass === 0 ? line[0] - LOOP : line[0];
                    if (at <= t) {
                        visibleLines.push(line);
                    }
                }
            }
            if (visibleLines.length > VISIBLE) {
                visibleLines.splice(0, visibleLines.length - VISIBLE);
            }
            return visibleLines;
        };
        const running = (t) => t < 8.3 || t >= 13.1;

        const drawScreen = (t, level) => {
            const width = LW - 16;
            const height = LL - 16;
            ctx.fillStyle = '#0b0b0e';
            ctx.fillRect(0, 0, LW, LL);
            R.roundRect(ctx, 8, 7, width, height, 2);
            ctx.fillStyle = R.mix('#050507', pal.termBg, level);
            ctx.fill();
            if (level < 0.01) {
                return;
            }
            ctx.save();
            ctx.globalAlpha *= level;
            ctx.beginPath();
            ctx.rect(8, 7, width, height);
            ctx.clip();
            ctx.fillStyle = pal.surface;
            ctx.fillRect(8, 7, width, 11);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(8, 18, width, 0.6);
            ctx.font = `500 6.4px ${R.fonts.mono}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillStyle = pal.muted;
            ctx.fillText('zsh', 13, 12.8);
            ctx.beginPath();
            ctx.arc(width + 2, 12.6, 1.8, 0, R.TAU);
            ctx.fillStyle = running(t) ? pal.running : pal.idle;
            ctx.fill();
            ctx.textBaseline = 'alphabetic';
            ctx.font = `400 6.6px ${R.fonts.mono}`;
            const lines = collectLines(t);
            let y = 29;
            let caretX = -1;
            let caretY = 0;
            for (const line of lines) {
                const kind = line[1];
                if (kind === 'pass') {
                    ctx.fillStyle = pal.green;
                    ctx.fillText('pass', 13, y);
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText(line[2], 36, y);
                } else if (kind === 'sum') {
                    ctx.fillStyle = pal.green;
                    ctx.fillText(line[2], 13, y);
                } else if (kind === 'dim') {
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText(line[2], 13, y);
                } else if (kind === 'run') {
                    ctx.fillStyle = pal.blue;
                    ctx.fillText(line[2], 13, y);
                } else {
                    ctx.fillStyle = pal.termDim;
                    ctx.fillText('$', 13, y);
                    const since = R.mod(t - T_TYPE, LOOP);
                    const typing = t >= T_TYPE || t < 8.42 ? Math.min(COMMAND.length, Math.floor(Math.max(0, since) * 26)) : 0;
                    const text = t >= 8.42 && t < T_TYPE ? '' : COMMAND.slice(0, typing);
                    ctx.fillStyle = pal.termFg;
                    ctx.fillText(text, 20, y);
                    caretX = 20 + ctx.measureText(text).width + 1;
                    caretY = y;
                }
                y += 10.2;
            }
            if (caretX >= 0 && !running(t) && R.fract(t * 0.95) < 0.6) {
                ctx.fillStyle = pal.termFg;
                ctx.fillRect(caretX, caretY - 5.6, 3.6, 6.8);
            }
            if (running(t)) {
                // The suite is still going: a live cursor under the last line.
                if (R.fract(t * 1.3) < 0.6) {
                    ctx.fillStyle = pal.termFg;
                    ctx.fillRect(13, y - 5.6, 3.6, 6.8);
                }
            }
            ctx.restore();
            // Glass: a soft diagonal reflection across the display.
            const glare = ctx.createLinearGradient(8, 7, 8 + width * 0.8, 7 + height);
            glare.addColorStop(0, 'rgba(255,255,255,0.05)');
            glare.addColorStop(0.45, 'rgba(255,255,255,0.012)');
            glare.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glare;
            ctx.fillRect(8, 7, width, height);
        };

        const drawMark = (size, alpha) => {
            const unit = size;
            ctx.save();
            ctx.transform(1, 0, -0.32, 1, 0, 0);
            R.roundRect(ctx, -unit * 0.62, -unit * 0.62, unit * 0.8, unit * 0.8, unit * 0.14);
            ctx.fillStyle = `rgba(28,34,51,${alpha.toFixed(3)})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.22).toFixed(3)})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
            R.roundRect(ctx, -unit * 0.18, -unit * 0.18, unit * 0.8, unit * 0.8, unit * 0.14);
            ctx.fillStyle = `rgba(217,222,230,${(alpha * 0.55).toFixed(3)})`;
            ctx.fill();
            ctx.restore();
        };

        const drawLaptop = (t, theta, level, warm) => {
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            const dir = [0, sinT, -cosT];
            const nout = [0, cosT, sinT];
            const hinge = [0, BT, LD];
            const add = (base, vec, k) => [base[0] + vec[0] * k, base[1] + vec[1] * k, base[2] + vec[2] * k];
            const across = [LW, 0, 0];

            // Contact shadow on the desk, longer to the left when the morning sun comes from the right.
            const sh = project(LW / 2, 0, LD / 2);
            ctx.save();
            ctx.translate(sh.x - 22 * warm, sh.y + 4);
            ctx.scale(1, 0.34);
            const sg = ctx.createRadialGradient(0, 0, 10, 0, 0, 150 + 40 * warm);
            sg.addColorStop(0, 'rgba(0,0,0,0.55)');
            sg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sg;
            ctx.fillRect(-220, -220, 440, 440);
            ctx.restore();

            const top = face([0, BT, 0], [0, 0, LD], [LW, 0, 0]);
            const front = face([0, 0, 0], [0, BT, 0], [LW, 0, 0]);
            const leftSide = face([0, 0, 0], [0, 0, LD], [0, BT, 0]);
            const rightSide = face([LW, 0, 0], [0, BT, 0], [0, 0, LD]);
            fillFace(leftSide, '#101115', 'rgba(255,255,255,0.05)');
            fillFace(rightSide, '#101115', 'rgba(255,255,255,0.05)');
            fillFace(front, '#15161b', 'rgba(255,255,255,0.08)');
            if (fillFace(top, '#1f2027', 'rgba(255,255,255,0.11)')) {
                inFace(top, LD, LW, () => {
                    // Face space: u runs back along Z, v runs across X.
                    for (let row = 0; row < 5; row++) {
                        for (let col = 0; col < 13; col++) {
                            const along = LD - 16 - row * 11.5;
                            const x = 13 + col * 12.8;
                            ctx.fillStyle = row === 0 && (col === 5 || col === 6) ? '#101116' : '#121318';
                            ctx.fillRect(along - 9, x, 9, 10.5);
                        }
                    }
                    ctx.fillStyle = '#17181e';
                    ctx.fillRect(9, LW * 0.33, LD * 0.34, LW * 0.34);
                    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                    ctx.lineWidth = 0.7;
                    ctx.strokeRect(9, LW * 0.33, LD * 0.34, LW * 0.34);
                    // Light from the screen falls on the keys nearest to it.
                    if (level > 0.01 && theta > 0.5) {
                        const lg = ctx.createLinearGradient(LD, 0, LD * 0.3, 0);
                        lg.addColorStop(0, `rgba(170,190,255,${(0.12 * level).toFixed(3)})`);
                        lg.addColorStop(1, 'rgba(170,190,255,0)');
                        ctx.fillStyle = lg;
                        ctx.fillRect(0, 0, LD, LW);
                    }
                });
            }
            // A sleep light on the front edge breathes while the lid is shut.
            const closed = 1 - R.smoothstep(0.02, 0.3, theta);
            if (closed > 0.01) {
                const led = project(LW * 0.5, BT * 0.5, 0);
                const breathe = 0.5 - 0.5 * Math.cos((R.TAU * t) / 3.5);
                const lx = led.x;
                const ly = led.y;
                const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 6);
                lg.addColorStop(0, `rgba(236,236,241,${(0.5 * breathe * closed).toFixed(3)})`);
                lg.addColorStop(1, 'rgba(236,236,241,0)');
                ctx.fillStyle = lg;
                ctx.fillRect(lx - 6, ly - 6, 12, 12);
                ctx.fillStyle = `rgba(236,236,241,${(0.25 + 0.6 * breathe * closed).toFixed(3)})`;
                ctx.fillRect(lx - 1.2, ly - 0.5, 2.4, 1);
            }

            const free = add(hinge, dir, LL);
            const inner = face(free, across, [0, -dir[1] * LL, -dir[2] * LL]);
            const outer = face(add(hinge, nout, LT), across, [dir[0] * LL, dir[1] * LL, dir[2] * LL]);
            const freeEdge = face(free, [nout[0] * LT, nout[1] * LT, nout[2] * LT], across);
            const lidLeft = face(hinge, [nout[0] * LT, nout[1] * LT, nout[2] * LT], [dir[0] * LL, dir[1] * LL, dir[2] * LL]);
            const lidRight = face(add(hinge, across, 1), [dir[0] * LL, dir[1] * LL, dir[2] * LL], [nout[0] * LT, nout[1] * LT, nout[2] * LT]);
            fillFace(lidLeft, '#121318', 'rgba(255,255,255,0.06)');
            fillFace(lidRight, '#121318', 'rgba(255,255,255,0.06)');
            fillFace(freeEdge, '#1a1b21', 'rgba(255,255,255,0.1)');
            if (inner.visible) {
                facePath(inner);
                ctx.fillStyle = '#0b0b0e';
                ctx.fill();
                inFace(inner, LW, LL, () => {
                    // Face space: u runs across, v runs down the lid from its top edge.
                    drawScreen(t, level);
                });
                facePath(inner);
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
            if (outer.visible) {
                facePath(outer);
                const og = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.ax + outer.bx, outer.y + outer.ay + outer.by);
                og.addColorStop(0, '#1f2129');
                og.addColorStop(1, '#17181e');
                ctx.fillStyle = og;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.11)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
                inFace(outer, LW, LL, () => {
                    // Face space: u across X, v from the hinge toward the front edge.
                    ctx.translate(LW / 2, LL / 2);
                    drawMark(30, 0.9);
                });
                // Morning light rakes across the lid.
                if (warm > 0.01) {
                    facePath(outer);
                    const wg = ctx.createLinearGradient(outer.x + outer.ax, outer.y + outer.ay, outer.x, outer.y);
                    wg.addColorStop(0, `rgba(255,190,120,${(0.1 * warm).toFixed(3)})`);
                    wg.addColorStop(1, 'rgba(255,190,120,0)');
                    ctx.fillStyle = wg;
                    ctx.fill();
                }
            }
            // As the lid comes down, the last light escapes through the closing gap.
            const gap = level * R.smoothstep(0.02, 0.12, theta) * (1 - R.smoothstep(0.25, 0.6, theta));
            if (gap > 0.01) {
                const gapStart = project(6, BT + 1, 2);
                const ax = gapStart.x;
                const ay = gapStart.y;
                const gapEnd = project(LW - 6, BT + 1, 2);
                const bx = gapEnd.x;
                const by = gapEnd.y;
                ctx.save();
                ctx.lineCap = 'round';
                ctx.strokeStyle = `rgba(190,205,255,${(0.28 * gap).toFixed(3)})`;
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(ax, ay + 3);
                ctx.lineTo(bx, by + 3);
                ctx.stroke();
                ctx.strokeStyle = `rgba(220,228,255,${(0.7 * gap).toFixed(3)})`;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
        };

        /* The machine keeps working: a small pill with the daemon glyph, a clock and the test count. */
        const clockAt = (t) => {
            const minutes = 22 * 60 + 48 + 498 * R.ease.inOutSine(R.phase(t, 3.4, 7.5));
            const hh = Math.floor(minutes / 60) % 24;
            const mm = Math.floor(minutes % 60);
            return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
        };
        const drawPill = (t) => {
            const show = R.smoothstep(3.45, 3.95, t) * (1 - R.smoothstep(10.95, 11.3, t));
            if (show < 0.01) {
                return;
            }
            const rise = (1 - R.ease.outCubic(R.smoothstep(3.45, 4.1, t))) * 6;
            const tests = Math.round(312 + 972 * R.ease.inOutSine(R.phase(t, 3.6, 4.8)));
            const done = t >= 8.4;
            const label = done ? '1284 passed' : `${tests} tests`;
            const x = PORT_X;
            const y = 196 + rise;
            ctx.save();
            ctx.globalAlpha = show;
            ctx.font = `500 11px ${R.fonts.mono}`;
            const clock = clockAt(t);
            const cw = ctx.measureText(clock).width;
            const lw = ctx.measureText(label).width;
            const width = 30 + cw + 14 + lw + 12;
            const left = x - width / 2;
            R.roundRect(ctx, left, y - 13, width, 26, 13);
            ctx.fillStyle = 'rgba(19,19,22,0.92)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // The daemon: a little machine whose light keeps blinking all night.
            const gx = left + 16;
            R.roundRect(ctx, gx - 6.5, y - 5, 13, 10, 2.5);
            ctx.strokeStyle = pal.muted;
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx - 3.5, y + 7.5);
            ctx.lineTo(gx + 3.5, y + 7.5);
            ctx.stroke();
            const blink = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(R.TAU * t * 0.9), 3);
            const bg = ctx.createRadialGradient(gx, y, 0, gx, y, 9);
            bg.addColorStop(0, R.rgba(pal.running, 0.45 * blink));
            bg.addColorStop(1, R.rgba(pal.running, 0));
            ctx.fillStyle = bg;
            ctx.fillRect(gx - 9, y - 9, 18, 18);
            ctx.beginPath();
            ctx.arc(gx, y, 1.9, 0, R.TAU);
            ctx.fillStyle = R.mix('#1a2a44', pal.running, blink);
            ctx.fill();
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillStyle = pal.text;
            ctx.fillText(clock, left + 30, y + 0.5);
            ctx.fillStyle = done ? pal.green : pal.muted;
            ctx.fillText(label, left + 30 + cw + 14, y + 0.5);
            ctx.restore();
        };

        const drawSky = (t) => {
            const pointer = env.pointer;
            const px = -8 * pointer.nx * pointer.active;
            const py = -5 * pointer.ny * pointer.active;
            const colors = skyAt(t);
            const gradient = ctx.createLinearGradient(0, PORT_Y - PORT_R, 0, HORIZON);
            gradient.addColorStop(0, colors[0]);
            gradient.addColorStop(0.6, colors[1]);
            gradient.addColorStop(1, colors[2]);
            ctx.fillStyle = gradient;
            ctx.fillRect(PORT_X - PORT_R, PORT_Y - PORT_R, PORT_R * 2, HORIZON - (PORT_Y - PORT_R) + 1);
            const set = sunset(t);
            if (set > 0.01) {
                const sg = ctx.createRadialGradient(150, HORIZON, 0, 150, HORIZON, 170);
                sg.addColorStop(0, `rgba(214,124,92,${(0.24 * set).toFixed(3)})`);
                sg.addColorStop(1, 'rgba(214,124,92,0)');
                ctx.fillStyle = sg;
                ctx.fillRect(PORT_X - PORT_R, HORIZON - 170, PORT_R * 2, 171);
            }
            const rise = sunrise(t);
            if (rise > 0.01) {
                const rg = ctx.createRadialGradient(400, HORIZON + 10, 0, 400, HORIZON + 10, 200);
                rg.addColorStop(0, `rgba(255,178,102,${(0.34 * rise).toFixed(3)})`);
                rg.addColorStop(0.5, `rgba(255,150,90,${(0.1 * rise).toFixed(3)})`);
                rg.addColorStop(1, 'rgba(255,150,90,0)');
                ctx.fillStyle = rg;
                ctx.fillRect(PORT_X - PORT_R, HORIZON - 200, PORT_R * 2, 201);
            }
            const night = nightness(t);
            if (night > 0.01) {
                const turn = WHEEL * nightProgress(t);
                const trailFrom = WHEEL * nightProgress(Math.max(3.9, t - 5));
                ctx.lineCap = 'round';
                for (const star of stars) {
                    const angle = star.angle - turn;
                    const x = POLE_X + px + Math.cos(angle) * star.radius;
                    const y = POLE_Y + py + Math.sin(angle) * star.radius;
                    if (y > HORIZON - 4) {
                        continue;
                    }
                    const tw = 0.75 + 0.25 * Math.sin(t * 3.1 + star.twinkle);
                    if (turn - trailFrom > 0.004) {
                        ctx.beginPath();
                        ctx.arc(POLE_X + px, POLE_Y + py, star.radius, star.angle - turn, star.angle - trailFrom);
                        ctx.strokeStyle = `rgba(210,220,255,${(0.16 * night * star.bright).toFixed(3)})`;
                        ctx.lineWidth = star.size * 0.9;
                        ctx.stroke();
                    }
                    ctx.beginPath();
                    ctx.arc(x, y, star.size, 0, R.TAU);
                    ctx.fillStyle = `rgba(236,240,255,${(night * star.bright * tw).toFixed(3)})`;
                    ctx.fill();
                }
            }
            // The moon crosses on a slow arc through the night.
            const moonLife = R.smoothstep(4.0, 4.8, t) * (1 - R.smoothstep(9.4, 10.3, t));
            if (moonLife > 0.01) {
                const progress = R.clamp((t - 4) / 6.4);
                const mx = 150 + 250 * progress + px * 1.2;
                const my = 236 - 128 * Math.sin(PI * progress) + py * 1.2;
                const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 40);
                mg.addColorStop(0, `rgba(217,222,230,${(0.13 * moonLife).toFixed(3)})`);
                mg.addColorStop(1, 'rgba(217,222,230,0)');
                ctx.fillStyle = mg;
                ctx.fillRect(mx - 40, my - 40, 80, 80);
                ctx.save();
                ctx.beginPath();
                ctx.rect(mx - 20, my - 20, 40, 40);
                ctx.arc(mx + 4.5, my - 2.5, 8.2, 0, R.TAU, true);
                ctx.clip();
                ctx.beginPath();
                ctx.arc(mx, my, 9, 0, R.TAU);
                ctx.fillStyle = `rgba(226,230,238,${(0.92 * moonLife).toFixed(3)})`;
                ctx.fill();
                ctx.restore();
            }
        };

        const drawDesk = (t, level, warm) => {
            const gradient = ctx.createLinearGradient(0, HORIZON, 0, PORT_Y + PORT_R);
            gradient.addColorStop(0, R.mix('#17171c', '#2a241f', warm * 0.8));
            gradient.addColorStop(1, '#0b0b0e');
            ctx.fillStyle = gradient;
            ctx.fillRect(PORT_X - PORT_R, HORIZON, PORT_R * 2, PORT_Y + PORT_R - HORIZON);
            ctx.fillStyle = `rgba(255,255,255,${(0.06 + 0.05 * warm).toFixed(3)})`;
            ctx.fillRect(PORT_X - PORT_R, HORIZON, PORT_R * 2, 1);
            // The screen's cool light pools on the desk in front of the laptop.
            if (level > 0.01) {
                const pool = project(LW * 0.45, 0, -18);
                ctx.save();
                ctx.translate(pool.x, pool.y);
                ctx.scale(1, 0.38);
                const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, 170);
                lg.addColorStop(0, `rgba(150,175,255,${(0.1 * level).toFixed(3)})`);
                lg.addColorStop(1, 'rgba(150,175,255,0)');
                ctx.fillStyle = lg;
                ctx.fillRect(-180, -180, 360, 360);
                ctx.restore();
            }
        };

        const drawScreenGlow = (theta, level) => {
            if (level < 0.01 || theta < 0.5) {
                return;
            }
            const center = project(LW / 2, BT + LL * 0.55, LD + 10);
            const glow = ctx.createRadialGradient(center.x, center.y, 20, center.x, center.y, 150);
            glow.addColorStop(0, `rgba(120,150,255,${(0.1 * level).toFixed(3)})`);
            glow.addColorStop(1, 'rgba(120,150,255,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(center.x - 150, center.y - 150, 300, 300);
        };

        const drawRim = () => {
            // Depth at the rim of the porthole: the scene darkens into the frame.
            const gradient = ctx.createRadialGradient(PORT_X, PORT_Y, PORT_R * 0.72, PORT_X, PORT_Y, PORT_R);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
            ctx.fillStyle = gradient;
            ctx.fillRect(PORT_X - PORT_R, PORT_Y - PORT_R, PORT_R * 2, PORT_R * 2);
        };

        return {
            draw(t) {
                env.clear();
                const local = R.mod(t, LOOP);
                setView();
                const theta = lidAngle(local);
                const level = screenLevel(local, theta);
                const warm = sunrise(local);
                ctx.save();
                ctx.beginPath();
                ctx.arc(PORT_X, PORT_Y, PORT_R, 0, R.TAU);
                ctx.clip();
                drawSky(local);
                drawDesk(local, level * R.smoothstep(0.5, 1.2, theta), warm);
                drawScreenGlow(theta, level);
                drawLaptop(local, theta, level, warm);
                drawPill(local);
                drawRim();
                ctx.restore();
                ctx.beginPath();
                ctx.arc(PORT_X, PORT_Y, PORT_R - 0.5, 0, R.TAU);
                ctx.strokeStyle = 'rgba(255,255,255,0.13)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(PORT_X, PORT_Y, PORT_R + 5, 0, R.TAU);
                ctx.strokeStyle = 'rgba(255,255,255,0.045)';
                ctx.stroke();
                env.fadeEdges(0.84, 1.0);
            }
        };
    }
});
